import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const app = express()
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || 'helplagbe-school-project-secret'
const rawConfiguredOrigins = process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:4173'
const allowedOrigins = [...new Set(rawConfiguredOrigins.split(',').map((value) => value.trim()).filter(Boolean))]

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
})

async function ensureNotificationTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    message VARCHAR(500) NOT NULL,
    read_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id),
    KEY idx_notifications_user (user_id, created_at),
    CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_user_controls (
    user_id INT NOT NULL,
    status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    updated_by INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT admin_controls_user_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    audit_id INT NOT NULL AUTO_INCREMENT,
    admin_id INT NOT NULL,
    action VARCHAR(80) NOT NULL,
    target_type VARCHAR(40) NOT NULL,
    target_id INT NULL,
    details VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (audit_id),
    KEY idx_admin_audit_created (created_at),
    CONSTRAINT admin_audit_admin_fk FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS task_messages (
    message_id INT NOT NULL AUTO_INCREMENT,
    task_id INT NOT NULL,
    sender_id INT NOT NULL,
    body VARCHAR(1000) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id),
    KEY idx_task_messages_task (task_id, created_at),
    CONSTRAINT task_messages_task_fk FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    CONSTRAINT task_messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS archived_users (
    archive_id INT NOT NULL AUTO_INCREMENT,
    original_user_id INT NOT NULL,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL,
    archive_reason VARCHAR(160) NOT NULL,
    snapshot LONGTEXT NOT NULL,
    archived_by INT NOT NULL,
    archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (archive_id),
    KEY idx_archived_users_date (archived_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

async function createNotification(userId, type, title, message) {
  if (!userId) return
  await pool.execute('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)', [userId, type, title, message])
}

async function createAudit(adminId, action, targetType, targetId, details) {
  await pool.execute(
    'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, action, targetType, targetId || null, details || null],
  )
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '8mb' }))
app.use('/uploads', express.static(resolve(process.cwd(), '../uploads')))

function authenticate(request, response, next) {
  const header = request.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  try {
    request.user = jwt.verify(token, jwtSecret)
    next()
  } catch (error) {
    response.status(401).json({ message: 'Please log in first.' })
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return response.status(403).json({ message: 'Admin access required.' })
  next()
}

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ ok: true, database: 'connected' })
  } catch (error) {
    response.status(503).json({ ok: false, database: 'unavailable' })
  }
})

app.get('/api/notifications', authenticate, async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT notification_id AS id, type, title, message, read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
      [request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load notifications.' })
  }
})

app.patch('/api/notifications/:notificationId/read', authenticate, async (request, response) => {
  try {
    const [result] = await pool.execute(
      'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE notification_id = ? AND user_id = ?',
      [request.params.notificationId, request.user.userId],
    )
    if (!result.affectedRows) return response.status(404).json({ message: 'Notification not found.' })
    response.json({ message: 'Notification marked as read.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not update notification.' })
  }
})

app.get('/api/messages', authenticate, async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.task_id AS taskId, p.Post_detail AS detail, t.task_status AS status,
              customer.username AS customerName, tech.Full_Name AS technicianName,
              MAX(m.created_at) AS lastMessageAt
       FROM tasks t JOIN posts p ON p.post_id = t.post_id
       JOIN users customer ON customer.user_id = p.user_id
       JOIN technician tech ON tech.technician_id = t.technician_id
       LEFT JOIN task_messages m ON m.task_id = t.task_id
       WHERE t.task_status IN ('accepted', 'in_progress', 'completed')
         AND (p.user_id = ? OR tech.user_id = ?)
       GROUP BY t.task_id, p.Post_detail, t.task_status, customer.username, tech.Full_Name
       ORDER BY COALESCE(lastMessageAt, t.updated_at) DESC LIMIT 30`,
      [request.user.userId, request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load conversations.' })
  }
})

app.get('/api/messages/:taskId', authenticate, async (request, response) => {
  try {
    const [access] = await pool.execute(
      `SELECT t.task_id FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND t.task_status IN ('accepted', 'in_progress', 'completed') AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1`,
      [request.params.taskId, request.user.userId, request.user.userId],
    )
    if (!access[0]) return response.status(404).json({ message: 'Conversation not found.' })
    const [rows] = await pool.execute(
      `SELECT m.message_id AS id, m.sender_id AS senderId, u.username AS senderName, m.body, m.created_at AS createdAt
       FROM task_messages m JOIN users u ON u.user_id = m.sender_id WHERE m.task_id = ? ORDER BY m.created_at ASC LIMIT 100`,
      [request.params.taskId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load messages.' })
  }
})

app.post('/api/messages/:taskId', authenticate, async (request, response) => {
  const body = typeof request.body?.body === 'string' ? request.body.body.trim() : ''
  if (!body || body.length > 1000) return response.status(400).json({ message: 'Message must be between 1 and 1000 characters.' })
  try {
    const [access] = await pool.execute(
      `SELECT t.task_id, p.user_id AS customerId, tech.user_id AS technicianUserId, p.Post_detail
       FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND t.task_status IN ('accepted', 'in_progress', 'completed') AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1`,
      [request.params.taskId, request.user.userId, request.user.userId],
    )
    if (!access[0]) return response.status(404).json({ message: 'Conversation not found.' })
    await pool.execute('INSERT INTO task_messages (task_id, sender_id, body) VALUES (?, ?, ?)', [request.params.taskId, request.user.userId, body])
    const recipient = Number(access[0].customerId) === Number(request.user.userId) ? access[0].technicianUserId : access[0].customerId
    await createNotification(recipient, 'message', 'New task message', `You have a new message about: ${access[0].Post_detail}`)
    response.status(201).json({ message: 'Message sent.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not send message.' })
  }
})

app.get('/api/posts', async (_request, response) => {
  try {
    const [rows] = await pool.execute(
      'SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category, p.`Sub-Category` AS subCategory, p.Image AS image, p.created_at AS createdAt FROM posts p ORDER BY p.created_at DESC LIMIT 30',
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load service requests.' })
  }
})

app.get('/api/technicians', async (_request, response) => {
  try {
    const [rows] = await pool.execute(
            `SELECT tech.technician_id AS id, tech.Full_Name AS name,
              tech.Skill_details AS skills, COUNT(CASE WHEN t.task_status = 'completed' THEN 1 END) AS completedJobs,
              ROUND(AVG(tf.consumer_rating), 1) AS averageRating,
              COUNT(tf.consumer_rating) AS reviewCount
       FROM technician tech
       LEFT JOIN tasks t ON t.technician_id = tech.technician_id
             LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
       WHERE tech.status = 'approved'
       GROUP BY tech.technician_id, tech.Full_Name, tech.Skill_details
       ORDER BY completedJobs DESC, tech.Full_Name ASC LIMIT 50`,
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load technicians.' })
  }
})

app.post('/api/posts', authenticate, async (request, response) => {
  const { detail, category, subCategory, imageData } = request.body

  if (!detail || !category) {
    return response.status(400).json({ message: 'Request details and category are required.' })
  }

  try {
    let imagePath = null
    if (imageData) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageData)
      if (!match) return response.status(400).json({ message: 'Attach a JPG, PNG, or WebP image.' })
      const imageBuffer = Buffer.from(match[2], 'base64')
      if (imageBuffer.length > 5 * 1024 * 1024) return response.status(400).json({ message: 'Image must be 5MB or smaller.' })
      const extension = match[1].split('/')[1].replace('jpeg', 'jpg')
      const uploadDirectory = resolve(process.cwd(), '../uploads')
      await mkdir(uploadDirectory, { recursive: true })
      const fileName = `request_${randomUUID()}.${extension}`
      await writeFile(resolve(uploadDirectory, fileName), imageBuffer)
      imagePath = `uploads/${fileName}`
    }
    const [result] = await pool.execute(
      'INSERT INTO posts (Post_detail, Category, `Sub-Category`, Image, user_id) VALUES (?, ?, ?, ?, ?)',
      [detail.trim(), category.trim(), subCategory?.trim() || null, imagePath, request.user.userId],
    )
    response.status(201).json({ id: result.insertId, message: 'Service request posted.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not create service request.' })
  }
})

app.get('/api/technician/requests', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') {
    return response.status(403).json({ message: 'Only technicians can view this workspace.' })
  }

  try {
    const [rows] = await pool.execute(
      'SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category, p.`Sub-Category` AS subCategory, p.Image AS image, p.created_at AS createdAt FROM posts p WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.post_id = p.post_id AND t.task_status IN (\'accepted\', \'in_progress\', \'completed\')) ORDER BY p.created_at DESC LIMIT 30',
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load technician requests.' })
  }
})

app.post('/api/tasks/bid', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') {
    return response.status(403).json({ message: 'Only technicians can place bids.' })
  }

  const { postId, price } = request.body
  if (!Number.isInteger(Number(postId)) || !Number.isFinite(Number(price)) || Number(price) < 0) {
    return response.status(400).json({ message: 'A valid request and price are required.' })
  }

  try {
    const [technicians] = await pool.execute(
      'SELECT technician_id FROM technician WHERE user_id = ? AND status = \'approved\' LIMIT 1',
      [request.user.userId],
    )
    const technician = technicians[0]
    if (!technician) return response.status(403).json({ message: 'Your technician account is not approved.' })

    await pool.execute(
      'INSERT INTO tasks (task_status, price, post_id, technician_id) VALUES (\'pending\', ?, ?, ?)',
      [Number(price), Number(postId), technician.technician_id],
    )
    const [postRows] = await pool.execute('SELECT user_id, Post_detail FROM posts WHERE post_id = ?', [postId])
    if (postRows[0]) await createNotification(postRows[0].user_id, 'new_bid', 'New bid received', `A technician placed a bid on: ${postRows[0].Post_detail}`)
    response.status(201).json({ message: 'Bid placed successfully.' })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'You already bid on this request.' })
    response.status(500).json({ message: 'Could not place bid.' })
  }
})

app.patch('/api/technician/tasks/:taskId/bid', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  const price = Number(request.body?.price)
  if (!Number.isFinite(price) || price < 0) return response.status(400).json({ message: 'Enter a valid bid amount.' })

  try {
    const [result] = await pool.execute(
      `UPDATE tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       SET t.price = ?, t.updated_at = NOW()
       WHERE t.task_id = ? AND tech.user_id = ? AND t.task_status = 'pending'`,
      [price, request.params.taskId, request.user.userId],
    )
    if (!result.affectedRows) return response.status(409).json({ message: 'Only pending bids can be edited.' })
    response.json({ message: 'Bid updated.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not update bid.' })
  }
})

app.get('/api/technician/tasks', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })

  try {
    const [rows] = await pool.execute(
      `SELECT t.task_id AS id, t.task_status AS status, t.price, t.accepted_at AS acceptedAt,
              t.completed_at AS completedAt, p.Post_detail AS detail, p.Category AS category
       FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       JOIN posts p ON p.post_id = t.post_id
       WHERE tech.user_id = ? ORDER BY t.updated_at DESC`,
      [request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load technician tasks.' })
  }
})

app.patch('/api/technician/tasks/:taskId/status', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  const { status } = request.body
  if (!['in_progress', 'completed'].includes(status)) return response.status(400).json({ message: 'Invalid task status.' })

  try {
    const timestampColumn = status === 'in_progress' ? 'accepted_at' : 'completed_at'
    const requiredStatus = status === 'in_progress' ? 'accepted' : 'in_progress'
    const [result] = await pool.execute(
      `UPDATE tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       SET t.task_status = ?, t.${timestampColumn} = COALESCE(t.${timestampColumn}, NOW()), t.updated_at = NOW()
       WHERE t.task_id = ? AND tech.user_id = ? AND t.task_status = ?`,
      [status, request.params.taskId, request.user.userId, requiredStatus],
    )
    if (!result.affectedRows) return response.status(409).json({ message: 'Task is not in the required state.' })
    if (status === 'completed') {
      const [taskRows] = await pool.execute(
        'SELECT p.user_id, p.Post_detail FROM tasks t JOIN posts p ON p.post_id = t.post_id WHERE t.task_id = ?',
        [request.params.taskId],
      )
      if (taskRows[0]) await createNotification(taskRows[0].user_id, 'task_completed', 'Task completed', `Your technician marked this task complete: ${taskRows[0].Post_detail}`)
    }
    response.json({ message: status === 'completed' ? 'Task completed.' : 'Task started.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not update task.' })
  }
})

app.get('/api/admin/overview', authenticate, requireAdmin, async (_request, response) => {
  try {
    const [countRows] = await pool.query(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM technician) AS technicians,
      (SELECT COUNT(*) FROM technician WHERE status = 'pending') AS pendingTechnicians,
      (SELECT COUNT(*) FROM posts) AS requests,
      (SELECT COUNT(*) FROM tasks) AS tasks,
      (SELECT COUNT(*) FROM tasks WHERE task_status = 'completed') AS completedTasks`)
    const counts = countRows[0]
    const [pendingTechnicians] = await pool.query(
      `SELECT technician_id AS id, Full_Name AS name, national_id AS nationalId,
              Skill_details AS skills, address, status
       FROM technician WHERE status = 'pending' ORDER BY created_at DESC`,
    )
    const [users] = await pool.query(
      `SELECT u.user_id AS id, u.username AS name, u.email, u.phone_no AS phone,
              CASE WHEN u.admin_id IS NOT NULL THEN 'admin'
                   WHEN tech.technician_id IS NOT NULL THEN 'technician'
                   ELSE 'customer' END AS role,
              u.created_at AS createdAt
       FROM users u LEFT JOIN technician tech ON tech.user_id = u.user_id
       ORDER BY u.created_at DESC LIMIT 50`,
    )
    const [tasks] = await pool.query(
      `SELECT t.task_id AS id, t.task_status AS status, t.price,
              p.Post_detail AS detail, p.Category AS category,
              customer.username AS customerName, tech.Full_Name AS technicianName,
              t.created_at AS createdAt
       FROM tasks t
       JOIN posts p ON p.post_id = t.post_id
       JOIN users customer ON customer.user_id = p.user_id
       JOIN technician tech ON tech.technician_id = t.technician_id
       ORDER BY t.created_at DESC LIMIT 50`,
    )
     const [posts] = await pool.query(
      `SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category,
            p.created_at AS createdAt, u.username AS postedBy,
            COUNT(t.task_id) AS bidCount
       FROM posts p JOIN users u ON u.user_id = p.user_id
       LEFT JOIN tasks t ON t.post_id = p.post_id
       GROUP BY p.post_id ORDER BY p.created_at DESC LIMIT 50`,
     )
     const [technicians] = await pool.query(
      `SELECT technician_id AS id, Full_Name AS name, national_id AS nationalId,
            Skill_details AS skills, address, status, user_id AS userId
       FROM technician ORDER BY created_at DESC LIMIT 50`,
     )
     response.json({ counts, pendingTechnicians, users, tasks, posts, technicians })
  } catch (error) {
    response.status(500).json({ message: 'Could not load admin overview.' })
  }
})

app.get('/api/admin/audit-log', authenticate, requireAdmin, async (_request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.audit_id AS id, a.action, a.target_type AS targetType, a.target_id AS targetId,
              a.details, a.created_at AS createdAt, u.username AS adminName
       FROM admin_audit_log a JOIN users u ON u.user_id = a.admin_id
       ORDER BY a.created_at DESC LIMIT 50`,
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load audit log.' })
  }
})

app.patch('/api/admin/users/:userId/status', authenticate, requireAdmin, async (request, response) => {
  const status = request.body?.status
  if (!['active', 'suspended'].includes(status)) return response.status(400).json({ message: 'Invalid user status.' })
  if (Number(request.params.userId) === Number(request.user.userId)) return response.status(400).json({ message: 'You cannot suspend your own admin account.' })
  try {
    const [users] = await pool.execute('SELECT user_id, username, admin_id FROM users WHERE user_id = ? LIMIT 1', [request.params.userId])
    if (!users[0] || users[0].admin_id) return response.status(404).json({ message: 'User not found or protected.' })
    await pool.execute(
      `INSERT INTO admin_user_controls (user_id, status, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [request.params.userId, status, request.user.userId],
    )
    await createAudit(request.user.userId, `user_${status}`, 'user', request.params.userId, `${users[0].username} marked ${status}`)
    response.json({ message: `User ${status}.` })
  } catch (error) {
    response.status(500).json({ message: 'Could not update user status.' })
  }
})

app.patch('/api/admin/technicians/:technicianId/status', authenticate, requireAdmin, async (request, response) => {
  const rawStatus = request.body?.status
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : ''
  const validStatuses = ['pending', 'approved', 'rejected']

  if (!validStatuses.includes(status)) {
    return response.status(400).json({ message: 'Invalid technician status.' })
  }

  try {
    const [result] = await pool.execute(
      'UPDATE technician SET status = ?, updated_at = NOW() WHERE technician_id = ?',
      [status, request.params.technicianId],
    )
    if (!result.affectedRows) return response.status(404).json({ message: 'Technician not found.' })
    const [technicianRows] = await pool.execute('SELECT user_id FROM technician WHERE technician_id = ?', [request.params.technicianId])
    if (technicianRows[0]) await createNotification(technicianRows[0].user_id, 'technician_status', 'Application status updated', `Your technician application was ${status}.`)
    response.json({ message: `Technician ${status}.` })
  } catch (error) {
    response.status(500).json({ message: 'Could not update technician.' })
  }
})

app.patch('/api/admin/tasks/:taskId/status', authenticate, requireAdmin, async (request, response) => {
  const { status } = request.body
  if (!['pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    return response.status(400).json({ message: 'Invalid task status.' })
  }

  try {
    const [result] = await pool.execute(
      `UPDATE tasks SET task_status = ?,
       accepted_at = CASE WHEN ? IN ('accepted', 'in_progress', 'completed') THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
       completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
       updated_at = NOW() WHERE task_id = ?`,
      [status, status, status, request.params.taskId],
    )
    if (!result.affectedRows) return response.status(404).json({ message: 'Task not found.' })
    response.json({ message: 'Task status updated.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not update task status.' })
  }
})

app.delete('/api/admin/posts/:postId', authenticate, requireAdmin, async (request, response) => {
  try {
    const [result] = await pool.execute('DELETE FROM posts WHERE post_id = ?', [request.params.postId])
    if (!result.affectedRows) return response.status(404).json({ message: 'Request not found.' })
    response.json({ message: 'Request removed.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not remove request.' })
  }
})

app.delete('/api/admin/users/:userId', authenticate, requireAdmin, async (request, response) => {
  if (Number(request.params.userId) === Number(request.user.userId)) {
    return response.status(400).json({ message: 'You cannot remove your own admin account.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.execute(
      `SELECT u.user_id AS id, u.username, u.email, u.phone_no AS phone, u.address, u.admin_id,
              tech.technician_id AS technicianId, tech.Full_Name AS technicianName,
              tech.Skill_details AS technicianSkills, tech.status AS technicianStatus
       FROM users u LEFT JOIN technician tech ON tech.user_id = u.user_id
       WHERE u.user_id = ? LIMIT 1`,
      [request.params.userId],
    )
    const user = users[0]
    if (!user || user.admin_id) return response.status(404).json({ message: 'User not found or protected.' })

    const [posts] = await connection.execute('SELECT * FROM posts WHERE user_id = ?', [request.params.userId])
    const [customerTasks] = await connection.execute(
      `SELECT t.* FROM tasks t JOIN posts p ON p.post_id = t.post_id WHERE p.user_id = ?`,
      [request.params.userId],
    )
    const [technicianTasks] = user.technicianId
      ? await connection.execute('SELECT * FROM tasks WHERE technician_id = ?', [user.technicianId])
      : [[]]
    const [feedback] = customerTasks.length
      ? await connection.execute('SELECT * FROM task_feedback WHERE task_id IN (?)', [customerTasks.map((task) => task.task_id)])
      : [[]]
    const role = user.technicianId ? 'technician' : 'customer'
    const snapshot = { user, posts, customerTasks, technicianTasks, feedback }
    await connection.execute(
      'INSERT INTO archived_users (original_user_id, username, email, role, archive_reason, snapshot, archived_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user.id, user.username, user.email, role, 'Removed by administrator', JSON.stringify(snapshot), request.user.userId],
    )
    await connection.execute('DELETE FROM users WHERE user_id = ? AND admin_id IS NULL', [request.params.userId])
    await connection.commit()
    await createAudit(request.user.userId, 'user_archived', 'user', user.id, `${user.username} archived before removal`)
    response.json({ message: 'User archived and removed.' })
  } catch (error) {
    await connection.rollback()
    response.status(500).json({ message: 'Could not archive and remove user.' })
  } finally {
    connection.release()
  }
})

app.get('/api/admin/archived-users', authenticate, requireAdmin, async (_request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT archive_id AS id, original_user_id AS originalUserId, username, email, role,
              archive_reason AS reason, archived_at AS archivedAt
       FROM archived_users ORDER BY archived_at DESC LIMIT 50`,
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load archived users.' })
  }
})

app.get('/api/customer/posts', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') {
    return response.status(403).json({ message: 'Only customers can view their requests.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category,
              p.created_at AS createdAt, p.Image AS image, t.task_id AS taskId, t.price,
              t.task_status AS status, CONCAT(tech.Full_Name, ' (Verified)') AS technicianName,
              tech.Skill_details AS technicianSkills, tech.status AS technicianStatus,
              tf.consumer_rating AS reviewRating, tf.consumer_feedback AS reviewText
       FROM posts p
       LEFT JOIN tasks t ON t.post_id = p.post_id
       LEFT JOIN technician tech ON tech.technician_id = t.technician_id
            LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC, t.created_at DESC`,
      [request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load your requests.' })
  }
})

app.post('/api/tasks/:taskId/review', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') {
    return response.status(403).json({ message: 'Only customers can review tasks.' })
  }

  const rating = Number(request.body?.rating)
  const review = typeof request.body?.review === 'string' ? request.body.review.trim() : ''
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return response.status(400).json({ message: 'Choose a rating from 1 to 5.' })
  }
  if (review.length > 500) return response.status(400).json({ message: 'Review must be 500 characters or fewer.' })

  try {
    const [tasks] = await pool.execute(
      `SELECT t.task_id, t.technician_id, p.Post_detail FROM tasks t JOIN posts p ON p.post_id = t.post_id
       WHERE t.task_id = ? AND p.user_id = ? AND t.task_status = 'completed' LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    if (!tasks[0]) return response.status(404).json({ message: 'Only completed jobs can be reviewed.' })

    const [existing] = await pool.execute('SELECT feedback_id FROM task_feedback WHERE task_id = ? LIMIT 1', [request.params.taskId])
    if (existing[0]) {
      await pool.execute(
        'UPDATE task_feedback SET consumer_rating = ?, consumer_feedback = ?, updated_at = NOW() WHERE task_id = ?',
        [rating, review || null, request.params.taskId],
      )
    } else {
      await pool.execute(
        'INSERT INTO task_feedback (consumer_rating, consumer_feedback, task_id) VALUES (?, ?, ?)',
        [rating, review || null, request.params.taskId],
      )
    }
    response.json({ message: 'Review saved.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not save review.' })
  }
})

app.patch('/api/tasks/:taskId/status', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') {
    return response.status(403).json({ message: 'Only customers can manage bids.' })
  }

  const { status } = request.body
  if (!['accepted', 'rejected'].includes(status)) {
    return response.status(400).json({ message: 'Invalid bid status.' })
  }

  try {
    const [tasks] = await pool.execute(
      `SELECT t.task_id FROM tasks t JOIN posts p ON p.post_id = t.post_id
       WHERE t.task_id = ? AND p.user_id = ? LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    if (!tasks[0]) return response.status(404).json({ message: 'Bid not found.' })

    if (status === 'accepted') {
      await pool.execute(
        `UPDATE tasks SET task_status = 'rejected' WHERE post_id =
         (SELECT post_id FROM (SELECT post_id FROM tasks WHERE task_id = ?) AS selected_task)
         AND task_id != ? AND task_status = 'pending'`,
        [request.params.taskId, request.params.taskId],
      )
    }
    await pool.execute('UPDATE tasks SET task_status = ? WHERE task_id = ?', [status, request.params.taskId])
    const [technicians] = await pool.execute(
      'SELECT user_id FROM technician WHERE technician_id = ?',
      [tasks[0].technician_id],
    )
    if (technicians[0]) await createNotification(technicians[0].user_id, status === 'accepted' ? 'bid_accepted' : 'bid_rejected', status === 'accepted' ? 'Bid accepted' : 'Bid not selected', `Your bid was ${status === 'accepted' ? 'accepted' : 'not selected'} for: ${tasks[0].Post_detail}`)
    response.json({ message: `Bid ${status}.` })
  } catch (error) {
    response.status(500).json({ message: 'Could not update bid.' })
  }
})

app.post('/api/auth/register', async (request, response) => {
  const { username, email, phone, password, address } = request.body

  if (!username || !email || !password) {
    return response.status(400).json({ message: 'Name, email, and password are required.' })
  }

  if (password.length < 6) {
    return response.status(400).json({ message: 'Password must be at least 6 characters.' })
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const [result] = await pool.execute(
      'INSERT INTO users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), phone || null, passwordHash, address || null],
    )

    response.status(201).json({ userId: result.insertId, message: 'Account created.' })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return response.status(409).json({ message: 'An account with that email already exists.' })
    }
    response.status(500).json({ message: 'Could not create account.' })
  }
})

app.post('/api/auth/register-technician', async (request, response) => {
  const { username, email, phone, password, address, nationalId, skills } = request.body

  if (!username || !email || !password || !nationalId || !skills) {
    return response.status(400).json({ message: 'Name, email, password, national ID, and skills are required.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const passwordHash = await bcrypt.hash(password, 10)
    const [userResult] = await connection.execute(
      'INSERT INTO users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), phone || null, passwordHash, address || null],
    )
    await connection.execute(
      'INSERT INTO technician (national_id, Full_Name, Skill_details, address, user_id, status) VALUES (?, ?, ?, ?, ?, \'pending\')',
      [nationalId.trim(), username.trim(), skills.trim(), address || null, userResult.insertId],
    )
    await connection.commit()
    response.status(201).json({ message: 'Technician application submitted for approval.' })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'Email or national ID already exists.' })
    response.status(500).json({ message: 'Could not submit technician application.' })
  } finally {
    connection.release()
  }
})

app.post('/api/auth/login', async (request, response) => {
  const { email, password } = request.body

  if (!email || !password) {
    return response.status(400).json({ message: 'Email and password are required.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.user_id, u.username, u.email, u.password, u.admin_id, t.technician_id,
          COALESCE(controls.status, 'active') AS accountStatus
       FROM users u LEFT JOIN technician t ON t.user_id = u.user_id
       LEFT JOIN admin_user_controls controls ON controls.user_id = u.user_id
       WHERE u.email = ? LIMIT 1`,
      [email.trim().toLowerCase()],
    )
    const user = rows[0]

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return response.status(401).json({ message: 'Invalid email or password.' })
    }
    if (user.accountStatus === 'suspended') return response.status(403).json({ message: 'This account is suspended. Contact support.' })

    const role = user.admin_id ? 'admin' : user.technician_id ? 'technician' : 'customer'
    const token = jwt.sign({ userId: user.user_id, role }, jwtSecret, { expiresIn: '2h' })
    response.json({ token, user: { id: user.user_id, name: user.username, email: user.email, role } })
  } catch (error) {
    response.status(500).json({ message: 'Could not log in.' })
  }
})

ensureNotificationTable()
  .then(() => app.listen(port, () => console.log(`HelpLagbe API listening on port ${port}`)))
  .catch((error) => {
    console.error('Could not initialize notifications table.', error.message)
    process.exitCode = 1
  })
