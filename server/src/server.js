import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, unlink, writeFile, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT || 4000)
const isProduction = process.env.NODE_ENV === 'production'
if (isProduction) app.set('trust proxy', 1)
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production.')
}
const jwtSecret = process.env.JWT_SECRET || 'helplagbe-local-development-secret'
const reviewCompliments = new Set([
  'On time',
  'Great communication',
  'Professional',
  'Quality work',
  'Fair price',
  'Clean and careful',
  'Friendly and respectful',
  'Went above and beyond',
])
const rawConfiguredOrigins = process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:4173'
const allowedOrigins = [...new Set(rawConfiguredOrigins.split(',').map((value) => value.trim()).filter(Boolean))]
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
let httpServer

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null
const databaseCa = process.env.DB_SSL_CA_PATH
  ? readFileSync(process.env.DB_SSL_CA_PATH, 'utf8')
  : process.env.DB_SSL_CA || undefined
const pool = mysql.createPool({
  host: databaseUrl ? databaseUrl.hostname : process.env.DB_HOST,
  port: Number(databaseUrl ? databaseUrl.port || 3306 : process.env.DB_PORT || 3306),
  database: databaseUrl ? decodeURIComponent(databaseUrl.pathname.slice(1)) : process.env.DB_NAME,
  user: databaseUrl ? decodeURIComponent(databaseUrl.username) : process.env.DB_USER,
  password: databaseUrl ? decodeURIComponent(databaseUrl.password) : process.env.DB_PASSWORD,
  ...(process.env.DB_SSL === 'true' ? {
    ssl: {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(databaseCa ? { ca: databaseCa } : {}),
    },
  } : {}),
  waitForConnections: true,
  connectionLimit: 10,
})
let usesTiDBSequences = /tidb/i.test(databaseUrl?.hostname || process.env.DB_HOST || '')

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few moments and try again.' },
  statusCode: 429,
})
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
})

async function ensureTiDBIdSequences() {
  const [versionRows] = await pool.query('SELECT VERSION() AS version')
  usesTiDBSequences = String(versionRows[0]?.version || '').toLowerCase().includes('tidb')
  await ensureNotificationTable()
  if (!usesTiDBSequences) return

  const idColumns = [
    ['admin', 'admin_id'],
    ['admin_dashboard', 'ad_id'],
    ['contact', 'contact_id'],
    ['payment', 'payment_id'],
    ['posts', 'post_id'],
    ['tasks', 'task_id'],
    ['task_feedback', 'feedback_id'],
    ['technician', 'technician_id'],
    ['technician_dashboard', 'td_id'],
    ['users', 'user_id'],
    ['website_feedback', 'feedback_id'],
  ]

  for (const [tableName, columnName] of idColumns) {
    const sequenceName = `helplagbe_${tableName}_${columnName}_seq`
    const [columns] = await pool.execute(
      `SELECT EXTRA, COLUMN_DEFAULT AS columnDefault FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [tableName, columnName],
    )
    if (!columns[0] || String(columns[0].EXTRA).toLowerCase().includes('auto_increment')) continue
    if (String(columns[0].columnDefault || '').toLowerCase().includes(sequenceName.toLowerCase())) continue

    const [maxRows] = await pool.query(`SELECT COALESCE(MAX(\`${columnName}\`), 0) + 1 AS nextId FROM \`${tableName}\``)
    const nextId = Number(maxRows[0]?.nextId || 1)
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS \`${sequenceName}\` START WITH ${nextId} CACHE 1`)
    await pool.query(
      `ALTER TABLE \`${tableName}\` ALTER COLUMN \`${columnName}\` SET DEFAULT (NEXT VALUE FOR \`${sequenceName}\`)`,
    )
  }
}

async function nextGeneratedId(connection, sequenceName) {
  if (!usesTiDBSequences) return null
  const [rows] = await connection.query(`SELECT NEXTVAL(\`${sequenceName}\`) AS generatedId`)
  return Number(rows[0]?.generatedId)
}

function sanitizeText(value, maxLength = 250) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength)
}

function decodeImageDataUrl(value) {
  const match = typeof value === 'string' && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (!match || match[2].length % 4 !== 0) return null
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.toString('base64') !== match[2]) return null
  if (buffer.length > 5 * 1024 * 1024) return { error: 'Image must be 5MB or smaller.' }
  const valid = match[1] === 'image/jpeg'
    ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : match[1] === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (!valid) return { error: 'Image contents do not match the selected file type.' }
  return { buffer, extension: match[1].split('/')[1].replace('jpeg', 'jpg') }
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function isValidPassword(value) {
  return typeof value === 'string'
    && value.length >= 8
    && Buffer.byteLength(value, 'utf8') <= 72
    && /[A-Za-z]/.test(value)
    && /\d/.test(value)
}

function parsePagination(request, defaultLimit = 20) {
  const page = Math.max(1, Number.parseInt(request.query.page || '1', 10) || 1)
  const limit = Math.min(50, Math.max(1, Number.parseInt(request.query.limit || String(defaultLimit), 10) || defaultLimit))
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

function normalizeFutureDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?Z$/.test(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value.slice(0, -1)) || date.getTime() <= Date.now()) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

async function ensureNotificationTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    message VARCHAR(500) NOT NULL,
    read_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    target_type VARCHAR(40) NULL,
    target_id INT NULL,
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
  await pool.query(`CREATE TABLE IF NOT EXISTS task_lifecycle_events (
    event_id INT NOT NULL AUTO_INCREMENT,
    task_id INT NOT NULL,
    actor_id INT NULL,
    event_type VARCHAR(40) NOT NULL,
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NULL,
    scheduled_for DATETIME NULL,
    reason VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id),
    KEY idx_task_lifecycle_task (task_id, created_at),
    CONSTRAINT task_lifecycle_task_fk FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    CONSTRAINT task_lifecycle_actor_fk FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_reports (
    report_id INT NOT NULL AUTO_INCREMENT,
    reporter_id INT NULL,
    task_id INT NULL,
    target_user_id INT NULL,
    message_id INT NULL,
    report_type ENUM('dispute', 'profile', 'message', 'task') NOT NULL,
    category VARCHAR(60) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    task_detail VARCHAR(2000) NULL,
    reported_content VARCHAR(1000) NULL,
    status ENUM('open', 'reviewing', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
    resolution_note VARCHAR(500) NULL,
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (report_id),
    KEY idx_marketplace_reports_status (status, created_at),
    CONSTRAINT marketplace_reports_reporter_fk FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE SET NULL,
    CONSTRAINT marketplace_reports_task_fk FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE SET NULL,
    CONSTRAINT marketplace_reports_target_fk FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    CONSTRAINT marketplace_reports_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_reviews (
    review_id INT NOT NULL AUTO_INCREMENT,
    task_id INT NOT NULL,
    reviewer_id INT NOT NULL,
    customer_id INT NOT NULL,
    rating TINYINT NOT NULL,
    comment VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (review_id),
    UNIQUE KEY uniq_customer_review_task (task_id),
    KEY idx_customer_reviews_customer (customer_id),
    CONSTRAINT customer_reviews_task_fk FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS user_blocks (
    block_id INT NOT NULL AUTO_INCREMENT,
    blocker_id INT NOT NULL,
    blocked_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (block_id),
    UNIQUE KEY uniq_user_block (blocker_id, blocked_id),
    KEY idx_user_blocks_blocked (blocked_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS warranty_claims (
    claim_id INT NOT NULL AUTO_INCREMENT,
    task_id INT NOT NULL,
    customer_id INT NOT NULL,
    description VARCHAR(1000) NOT NULL,
    status ENUM('open', 'accepted', 'declined', 'resolved') NOT NULL DEFAULT 'open',
    response_note VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (claim_id),
    KEY idx_warranty_task (task_id),
    CONSTRAINT warranty_claims_task_fk FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS saved_addresses (
    address_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    label VARCHAR(60) NOT NULL,
    service_address VARCHAR(500) NOT NULL,
    building VARCHAR(150) NULL,
    flat_no VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (address_id),
    KEY idx_saved_addresses_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS favorite_technicians (
    favorite_id INT NOT NULL AUTO_INCREMENT,
    customer_id INT NOT NULL,
    technician_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (favorite_id),
    UNIQUE KEY uniq_favorite (customer_id, technician_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  const [taskStatusColumns] = await pool.execute(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'task_status'",
  )
  if (taskStatusColumns[0]
    && (!String(taskStatusColumns[0].COLUMN_TYPE).includes("'scheduled'")
      || !String(taskStatusColumns[0].COLUMN_TYPE).includes("'withdrawn'"))) {
    await pool.query("ALTER TABLE tasks MODIFY task_status ENUM('pending','accepted','scheduled','rejected','withdrawn','in_progress','completed','cancelled') DEFAULT 'pending'")
  }
  const [technicianStatusColumns] = await pool.execute(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technician' AND COLUMN_NAME = 'status'",
  )
  if (technicianStatusColumns[0] && !String(technicianStatusColumns[0].COLUMN_TYPE).includes("'suspended'")) {
    await pool.query("ALTER TABLE technician MODIFY status ENUM('pending','approved','suspended','rejected') DEFAULT 'pending'")
  }
  const additions = [
    ['technician', 'id_verification_status', "ENUM('unverified', 'verified', 'rejected') NOT NULL DEFAULT 'unverified'"],
    ['technician', 'id_verified_at', 'DATETIME NULL'],
    ['technician', 'id_verified_by', 'INT NULL'],
    ['technician', 'id_verification_note', 'VARCHAR(255) NULL'],
    ['posts', 'area', 'VARCHAR(80) NULL'],
    ['saved_addresses', 'area', 'VARCHAR(80) NULL'],
    ['task_messages', 'image', 'VARCHAR(255) NULL'],
    ['technician', 'availability_schedule', 'TEXT NULL'],
    ['technician', 'request_alerts', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['marketplace_reports', 'evidence_image', 'VARCHAR(255) NULL'],
    ['marketplace_reports', 'outcome', "ENUM('none', 'warning', 'technician_suspended') NOT NULL DEFAULT 'none'"],
    ['tasks', 'proposed_at', 'DATETIME NULL'],
    ['tasks', 'customer_schedule_confirmed_at', 'DATETIME NULL'],
    ['tasks', 'technician_schedule_confirmed_at', 'DATETIME NULL'],
    ['tasks', 'cancelled_by', 'INT NULL'],
    ['tasks', 'cancel_reason', 'VARCHAR(500) NULL'],
    ['tasks', 'cancelled_at', 'DATETIME NULL'],
    ['tasks', 'agreed_price', 'DECIMAL(10,2) NULL'],
    ['tasks', 'price_details', 'VARCHAR(500) NULL'],
    ['tasks', 'price_change_proposed', 'DECIMAL(10,2) NULL'],
    ['tasks', 'price_change_reason', 'VARCHAR(500) NULL'],
    ['tasks', 'price_change_proposed_by', 'INT NULL'],
    ['notifications', 'target_type', 'VARCHAR(40) NULL'],
    ['notifications', 'target_id', 'INT NULL'],
    ['tasks', 'payment_status', "ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid'"],
    ['tasks', 'payment_method', "ENUM('cash','bank_transfer','other') NULL"],
    ['tasks', 'customer_paid_confirmed_at', 'DATETIME NULL'],
    ['tasks', 'technician_paid_confirmed_at', 'DATETIME NULL'],
    ['tasks', 'paid_at', 'DATETIME NULL'],
    ['tasks', 'receipt_number', 'VARCHAR(40) NULL'],
    ['technician', 'service_area', 'VARCHAR(255) NULL'],
    ['technician', 'availability', 'VARCHAR(255) NULL'],
    ['posts', 'service_address', 'VARCHAR(500) NULL'],
    ['posts', 'building', 'VARCHAR(150) NULL'],
    ['posts', 'flat_no', 'VARCHAR(100) NULL'],
    ['posts', 'closed_at', 'DATETIME NULL'],
    ['posts', 'close_reason', 'VARCHAR(500) NULL'],
    ['marketplace_reports', 'task_detail', 'VARCHAR(2000) NULL'],
    ['marketplace_reports', 'reported_content', 'VARCHAR(1000) NULL'],
  ]
  for (const [tableName, columnName, columnDefinition] of additions) {
    const [columns] = await pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [tableName, columnName],
    )
    if (!columns.length) await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`)
  }
  try {
    const [legacyAreas] = await pool.query("SELECT technician_id, service_area FROM technician WHERE service_area IS NOT NULL AND service_area <> ''")
    for (const row of legacyAreas) {
      const known = splitStoredAreas(row.service_area).every((part) => serviceAreaLookup.has(part.toLowerCase()))
      if (known) continue
      const matched = SERVICE_AREAS.filter((area) => serviceAreaMatches(area, row.service_area))
      if (matched.length) await pool.execute('UPDATE technician SET service_area = ? WHERE technician_id = ?', [matched.join(', '), row.technician_id])
    }
    const [legacyPosts] = await pool.query("SELECT post_id, service_address FROM posts WHERE area IS NULL AND service_address IS NOT NULL AND service_address <> ''")
    for (const row of legacyPosts) {
      const matched = SERVICE_AREAS.find((area) => serviceAreaMatches(area, row.service_address))
      if (matched) await pool.execute('UPDATE posts SET area = ? WHERE post_id = ?', [matched, row.post_id])
    }
  } catch (error) {
    console.error('Could not map existing service areas to the area list.', error.message)
  }
}

async function createNotification(userId, type, title, message, targetType = null, targetId = null) {
  if (!userId) return
  await pool.execute(
    'INSERT INTO notifications (user_id, type, title, message, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, type, title, message, targetType, targetId],
  )
}

async function createAudit(adminId, action, targetType, targetId, details) {
  await pool.execute(
    'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, action, targetType, targetId || null, details || null],
  )
}


async function usersBlocked(userA, userB) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
    [userA, userB, userB, userA],
  )
  return rows.length > 0
}

async function notifyMatchingTechnicians(customerUserId, serviceAddress, category, area) {
  const [candidates] = await pool.execute(
    `SELECT tech.user_id, tech.service_area FROM technician tech
     WHERE tech.status = 'approved' AND tech.request_alerts = 1 AND tech.user_id <> ?
       AND tech.service_area IS NOT NULL AND tech.service_area <> ''
       AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = tech.user_id) OR (b.blocker_id = tech.user_id AND b.blocked_id = ?))
     LIMIT 1000`,
    [customerUserId, customerUserId, customerUserId],
  )
  const matches = candidates.filter((technician) => technicianCoversRequest(technician.service_area, area, serviceAddress)).slice(0, 50)
  for (const technician of matches) {
    await createNotification(technician.user_id, 'new_request_nearby', `New ${category.toLowerCase()} request in your area`, 'A customer in your service area is looking for help. Open Opportunities to send an offer.')
  }
}

function summarizeSchedule(schedule) {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const parts = []
  let index = 0
  while (index < keys.length) {
    const day = schedule[keys[index]]
    if (!day?.enabled) { index += 1; continue }
    let end = index
    while (end + 1 < keys.length && schedule[keys[end + 1]]?.enabled && schedule[keys[end + 1]].start === day.start && schedule[keys[end + 1]].end === day.end) end += 1
    parts.push(`${end > index ? `${names[index]}-${names[end]}` : names[index]} ${day.start}-${day.end}`)
    index = end + 1
  }
  return parts.join(', ')
}

const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Dhaka'
const scheduleKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// Returns an explanation if the UTC datetime ('YYYY-MM-DD HH:MM:SS') falls outside the technician's weekly hours.
function scheduleViolation(scheduleJson, utcDateTime) {
  if (!scheduleJson) return null
  let schedule
  try { schedule = typeof scheduleJson === 'string' ? JSON.parse(scheduleJson) : scheduleJson } catch (error) { return null }
  if (!schedule || typeof schedule !== 'object') return null
  const date = new Date(`${String(utcDateTime).replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  const dayKey = String(parts.weekday).slice(0, 3).toLowerCase()
  const time = `${parts.hour}:${parts.minute}`
  const hours = summarizeSchedule(schedule)
  if (!hours) return 'This technician is not currently taking appointments.'
  const day = schedule[dayKey]
  if (!day?.enabled || time < day.start || time >= day.end) {
    return `That time is outside the technician's working hours (${hours}). Please choose a time within them.`
  }
  return null
}

function normalizeAreaText(value) {
  return String(value || '').toLowerCase().replace(/[0-9]+/g, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

// A service area like "Dhanmondi 27, Mirpur" matches an address if any listed area appears in it (numbers and punctuation ignored).
function serviceAreaMatches(serviceArea, address) {
  const normalizedAddress = ` ${normalizeAreaText(address)} `
  return String(serviceArea || '').split(/[,;/\n]+/)
    .map(normalizeAreaText)
    .filter((area) => area.length >= 3)
    .some((area) => normalizedAddress.includes(` ${area} `))
}

const SERVICE_CITY = 'Dhaka'
const SERVICE_AREAS = [
  'Adabor', 'Aftabnagar', 'Agargaon', 'Azimpur', 'Badda', 'Banani', 'Banasree', 'Bangshal', 'Baridhara', 'Bashabo',
  'Bashundhara R/A', 'Cantonment', 'Chawkbazar', 'Dakshinkhan', 'Dania', 'Demra', 'Dhanmondi', 'Eskaton', 'Farmgate',
  'Gandaria', 'Green Road', 'Gulistan', 'Gulshan', 'Hatirjheel', 'Hazaribagh', 'Jatrabari', 'Jurain', 'Kafrul',
  'Kakrail', 'Kalabagan', 'Kamalapur', 'Kamrangirchar', 'Karwan Bazar', 'Keraniganj', 'Khilgaon', 'Khilkhet',
  'Kotwali', 'Lalbagh', 'Lalmatia', 'Malibagh', 'Matuail', 'Mirpur', 'Mohakhali', 'Mohammadpur', 'Motijheel', 'Mugda',
  'Nadda', 'Narinda', 'New Market', 'Niketan', 'Old Dhaka', 'Paltan', 'Panthapath', 'Purbachal', 'Rampura', 'Ramna',
  'Sabujbagh', 'Savar', 'Segunbagicha', 'Shahbagh', 'Shahjadpur', 'Shantinagar', 'Shyamoli', 'Shyampur', 'Sutrapur',
  'Tejgaon', 'Tikatuli', 'Turag', 'Uttara', 'Uttarkhan', 'Wari',
]
const serviceAreaLookup = new Map(SERVICE_AREAS.map((area) => [area.toLowerCase(), area]))

// Returns the canonical names for a list of areas, or null if any entry is not a known area.
function parseServiceAreas(input) {
  if (!Array.isArray(input) || input.length > 30) return null
  const result = []
  for (const entry of input) {
    const canonical = typeof entry === 'string' ? serviceAreaLookup.get(entry.trim().toLowerCase()) : null
    if (!canonical) return null
    if (!result.includes(canonical)) result.push(canonical)
  }
  return result
}

function splitStoredAreas(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
}

// Does a technician's stored service area cover this request? Requests with a chosen area match exactly;
// older requests without one fall back to matching the address text.
function technicianCoversRequest(serviceArea, requestArea, address) {
  if (requestArea) {
    const wanted = String(requestArea).toLowerCase()
    return splitStoredAreas(serviceArea).some((area) => area.toLowerCase() === wanted) || serviceAreaMatches(serviceArea, requestArea)
  }
  return serviceAreaMatches(serviceArea, address)
}

// ID documents are sensitive: new ones live outside the public /uploads folder and are only served to admins.
const PRIVATE_DIRECTORY = resolve(process.cwd(), '../private')
const PUBLIC_UPLOAD_DIRECTORY = resolve(process.cwd(), '../uploads')

// Maps a stored document path to a file inside one of the two known folders, or null if it points anywhere else.
function resolveStoredDocument(storedPath) {
  const value = String(storedPath || '')
  const base = value.startsWith('private/') ? PRIVATE_DIRECTORY : value.startsWith('uploads/') ? PUBLIC_UPLOAD_DIRECTORY : null
  if (!base) return null
  const absolute = resolve(base, value.slice(value.indexOf('/') + 1))
  return absolute.startsWith(`${base}${sep}`) ? absolute : null
}

const documentContentTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function toCsvCell(value) {
  const text = String(value ?? '')
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

function redactPersonalDetails(value) {
  return String(value ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .replace(/(?:\+?880[\s-]?)?0?1[3-9](?:[\s-]?\d){8}\b/g, '[phone removed]')
    .replace(/\b\d{1,5}\s+[\w.-]+(?:\s+[\w.-]+){0,3}\s+(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|block|boulevard|blvd\.?)\b[^,;\n]*/gi, '[address removed]')
    .replace(/\b(?:phone|mobile|email|address|flat|apartment|house|road|street|block|holding)\s*(?:(?:number|no\.?|#)\s*[:=-]?\s*|[:=]\s*|is\s+)[^,;\n]+/gi, '[private details removed]')
}

async function recordTaskEvent(connection, taskId, actorId, eventType, fromStatus, toStatus, scheduledFor = null, reason = null) {
  await connection.execute(
    `INSERT INTO task_lifecycle_events
     (task_id, actor_id, event_type, from_status, to_status, scheduled_for, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [taskId, actorId || null, eventType, fromStatus || null, toStatus || null, scheduledFor, reason],
  )
}

// Snapshots store timestamps as ISO strings; strict MySQL/MariaDB servers need 'YYYY-MM-DD HH:MM:SS'.
function toSqlDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ? value.slice(0, 19).replace('T', ' ') : value
}

async function insertSnapshotRows(connection, tableName, rows, allowedColumns) {
  for (const row of rows || []) {
    const columns = allowedColumns.filter((column) => Object.hasOwn(row, column))
    if (!columns.length) continue
    const columnList = columns.map((column) => `\`${column}\``).join(', ')
    const placeholders = columns.map(() => '?').join(', ')
    const values = columns.map((column) => toSqlDateTime(row[column]))
    await connection.execute(`INSERT INTO \`${tableName}\` (${columnList}) VALUES (${placeholders})`, values)
  }
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || (!isProduction && /^http:\/\/localhost:\d+$/.test(origin))) {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '8mb' }))
app.use('/api', apiRateLimiter)
app.use('/uploads', express.static(resolve(process.cwd(), '../uploads')))
app.disable('x-powered-by')
app.use((request, response, next) => {
  const requestId = randomUUID()
  const startedAt = Date.now()
  response.setHeader('X-Request-Id', requestId)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.on('finish', () => {
    console.log(JSON.stringify({
      level: 'info',
      event: 'http_request',
      requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    }))
  })
  next()
})

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

function optionalAuthenticate(request, _response, next) {
  const header = request.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return next()

  try {
    request.user = jwt.verify(token, jwtSecret)
  } catch {
    request.user = null
  }
  next()
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
      `SELECT notification_id AS id, type, title, message, target_type AS targetType, target_id AS targetId,
              read_at AS readAt, created_at AS createdAt
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
              CASE WHEN p.user_id = ? THEN tech.user_id ELSE p.user_id END AS otherUserId,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = ? AND b.blocked_id = (CASE WHEN p.user_id = ? THEN tech.user_id ELSE p.user_id END)) AS blockedByMe,
              MAX(m.created_at) AS lastMessageAt
       FROM tasks t JOIN posts p ON p.post_id = t.post_id
       JOIN users customer ON customer.user_id = p.user_id
       JOIN technician tech ON tech.technician_id = t.technician_id
       LEFT JOIN task_messages m ON m.task_id = t.task_id
       WHERE t.task_status IN ('accepted', 'scheduled', 'in_progress', 'completed')
         AND (p.user_id = ? OR tech.user_id = ?)
       GROUP BY t.task_id, p.Post_detail, t.task_status, customer.username, tech.Full_Name, p.user_id, tech.user_id
       ORDER BY COALESCE(MAX(m.created_at), t.updated_at) DESC LIMIT 30`,
      [request.user.userId, request.user.userId, request.user.userId, request.user.userId, request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    console.error('Could not load conversations.', error.message)
    response.status(500).json({ message: 'Could not load conversations.' })
  }
})

app.get('/api/messages/:taskId', authenticate, async (request, response) => {
  try {
    const [access] = await pool.execute(
      `SELECT t.task_id FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND t.task_status IN ('accepted', 'scheduled', 'in_progress', 'completed') AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1`,
      [request.params.taskId, request.user.userId, request.user.userId],
    )
    if (!access[0]) return response.status(404).json({ message: 'Conversation not found.' })
    const [rows] = await pool.execute(
      `SELECT m.message_id AS id, m.sender_id AS senderId, u.username AS senderName, m.body, m.image, m.created_at AS createdAt
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
  const hasImage = Boolean(request.body?.imageData)
  if ((!body && !hasImage) || body.length > 1000) return response.status(400).json({ message: 'Message must be between 1 and 1000 characters, or include a photo.' })
  // Validate the photo up front, but only write it to disk once we know the sender may post here.
  let image = null
  if (hasImage) {
    image = decodeImageDataUrl(request.body.imageData)
    if (!image || image.error) return response.status(400).json({ message: image?.error || 'Attach a JPG, PNG or WebP photo.' })
  }
  let imagePath = null
  try {
    const [access] = await pool.execute(
      `SELECT t.task_id, p.user_id AS customerId, tech.user_id AS technicianUserId, p.Post_detail
       FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND t.task_status IN ('accepted', 'scheduled', 'in_progress', 'completed') AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1`,
      [request.params.taskId, request.user.userId, request.user.userId],
    )
    if (!access[0]) return response.status(404).json({ message: 'Conversation not found.' })
    const otherParty = Number(access[0].customerId) === Number(request.user.userId) ? access[0].technicianUserId : access[0].customerId
    if (await usersBlocked(request.user.userId, otherParty)) {
      return response.status(403).json({ message: 'You cannot message this person because one of you has blocked the other.' })
    }
    if (image) {
      const uploadDirectory = resolve(process.cwd(), '../uploads')
      await mkdir(uploadDirectory, { recursive: true })
      const fileName = `message_${randomUUID()}.${image.extension}`
      await writeFile(resolve(uploadDirectory, fileName), image.buffer)
      imagePath = `uploads/${fileName}`
    }
    await pool.execute('INSERT INTO task_messages (task_id, sender_id, body, image) VALUES (?, ?, ?, ?)', [request.params.taskId, request.user.userId, body, imagePath])
    const recipient = otherParty
    try {
      await createNotification(recipient, 'message', 'New task message', `You have a new message about: ${access[0].Post_detail}`, 'task', access[0].task_id)
    } catch (error) {
      console.error('Could not create message notification.', error.message)
    }
    response.status(201).json({ message: 'Message sent.' })
  } catch (error) {
    if (imagePath) await unlink(resolve(process.cwd(), '..', imagePath)).catch(() => {})
    console.error('Could not send message.', error.message)
    response.status(500).json({ message: 'Could not send message.' })
  }
})

app.get('/api/posts', optionalAuthenticate, async (request, response) => {
  try {
    const { page, limit, offset } = parsePagination(request, 12)
    const category = sanitizeText(request.query.category || '', 60)
    const search = sanitizeText(request.query.search || '', 120)
    const technicianViewerId = request.user?.role === 'technician' ? request.user.userId : null
    const filters = []
    const values = []

    if (category) {
      filters.push('LOWER(p.Category) = LOWER(?)')
      values.push(category)
    }
    if (search) {
      filters.push('(LOWER(p.Post_detail) LIKE LOWER(?) OR LOWER(p.Category) LIKE LOWER(?))')
      values.push(`%${search}%`, `%${search}%`)
    }

    const [rows] = await pool.execute(
      `SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category, p.\`Sub-Category\` AS subCategory, p.Image AS image, p.created_at AS createdAt,
              COUNT(CASE WHEN t.task_status = 'pending' THEN 1 END) AS bidCount,
              CASE WHEN EXISTS (SELECT 1 FROM technician viewerTech WHERE viewerTech.user_id = ? AND viewerTech.status = 'approved') THEN customer.username ELSE NULL END AS customerName
       FROM posts p LEFT JOIN users customer ON customer.user_id = p.user_id
       LEFT JOIN tasks t ON t.post_id = p.post_id
       WHERE p.closed_at IS NULL ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
       GROUP BY p.post_id, p.Post_detail, p.Category, p.\`Sub-Category\`, p.Image, p.created_at, customer.username
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [technicianViewerId, ...values, limit, offset],
    )
    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM posts p WHERE p.closed_at IS NULL ${filters.length ? `AND ${filters.join(' AND ')}` : ''}`,
      values,
    )
    response.json({ items: rows.map((row) => ({ ...row, detail: redactPersonalDetails(row.detail) })), pagination: { page, limit, total: Number(totalRows[0]?.total || 0) } })
  } catch (error) {
    response.status(500).json({ message: 'Could not load service requests.' })
  }
})

app.get('/api/technicians', optionalAuthenticate, async (request, response) => {
  try {
    const { page, limit, offset } = parsePagination(request, 12)
    const search = sanitizeText(request.query.search || '', 100)
    const location = sanitizeText(request.query.location || '', 100)
    const availability = sanitizeText(request.query.availability || '', 100)
    const sort = ['rating', 'response', 'completed'].includes(request.query.sort) ? request.query.sort : 'relevance'
    const filters = ['tech.status = ?']
    const values = ['approved']

    if (search) {
      filters.push('(LOWER(tech.Full_Name) LIKE LOWER(?) OR LOWER(tech.Skill_details) LIKE LOWER(?))')
      values.push(`%${search}%`, `%${search}%`)
    }
    if (location) {
      filters.push('(LOWER(COALESCE(tech.service_area, tech.address, \'\')) LIKE LOWER(?) OR LOWER(tech.Skill_details) LIKE LOWER(?))')
      values.push(`%${location}%`, `%${location}%`)
    }
    if (availability) {
      filters.push('LOWER(COALESCE(tech.availability, \'\')) LIKE LOWER(?)')
      values.push(`%${availability}%`)
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`
    const relevanceTerms = []
    const relevanceValues = []
    if (search) {
      relevanceTerms.push(`CASE WHEN LOWER(tech.Skill_details) LIKE LOWER(?) THEN 4
        WHEN LOWER(tech.Full_Name) LIKE LOWER(?) THEN 2 ELSE 0 END`)
      relevanceValues.push(`%${search}%`, `%${search}%`)
    }
    if (location) {
      relevanceTerms.push(`CASE WHEN LOWER(COALESCE(tech.service_area, tech.address, '')) LIKE LOWER(?) THEN 4 ELSE 0 END`)
      relevanceValues.push(`%${location}%`)
    }
    const relevanceExpression = relevanceTerms.length ? `(${relevanceTerms.join(' + ')})` : '0'
    const orderBy = sort === 'rating'
      ? 'AVG(tf.consumer_rating) IS NULL ASC, averageRating DESC, completedJobs DESC'
      : sort === 'response'
        ? 'averageResponseMinutes IS NULL ASC, averageResponseMinutes ASC, completedJobs DESC'
        : sort === 'completed'
          ? 'completedJobs DESC, averageRating DESC'
          : 'relevanceScore DESC, completedJobs DESC, averageRating DESC'
    const [rows] = await pool.execute(
      `SELECT tech.technician_id AS id, tech.Full_Name AS name, tech.Skill_details AS skills,
              profile_user.Image AS profileImage,
              EXISTS (SELECT 1 FROM favorite_technicians fav WHERE fav.customer_id = ? AND fav.technician_id = tech.technician_id) AS favorite,
              COALESCE(tech.service_area, tech.address) AS location, tech.availability,
              MAX(CASE WHEN tech.id_verification_status = 'verified' THEN 1 ELSE 0 END) AS idVerified,
              COUNT(CASE WHEN t.task_status = 'completed' THEN 1 END) AS completedJobs,
              ROUND(AVG(tf.consumer_rating), 1) AS averageRating, COUNT(tf.consumer_rating) AS reviewCount,
              (SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, response_post.created_at, response_task.created_at)))
               FROM tasks response_task JOIN posts response_post ON response_post.post_id = response_task.post_id
               WHERE response_task.technician_id = tech.technician_id) AS averageResponseMinutes,
              ${relevanceExpression} AS relevanceScore
       FROM technician tech
       JOIN users profile_user ON profile_user.user_id = tech.user_id
       LEFT JOIN tasks t ON t.technician_id = tech.technician_id
       LEFT JOIN task_feedback tf ON tf.task_id = t.task_id ${whereClause}
       GROUP BY tech.technician_id, tech.Full_Name, tech.Skill_details, tech.address, tech.service_area, tech.availability, profile_user.Image
       ORDER BY ${orderBy}, tech.Full_Name ASC LIMIT ? OFFSET ?`,
      [request.user?.userId || 0, ...relevanceValues, ...values, limit, offset],
    )
    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM technician tech ${whereClause}`,
      values,
    )
    response.json({ items: rows, pagination: { page, limit, total: Number(totalRows[0]?.total || 0) } })
  } catch (error) {
    console.error('Could not load technicians.', error.message)
    response.status(500).json({ message: 'Could not load technicians.' })
  }
})

app.post('/api/posts', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') return response.status(403).json({ message: 'Only customers can post requests.' })
  const body = request.body && typeof request.body === 'object' ? request.body : {}
  const detail = sanitizeText(body.detail, 2000)
  const requestedCategory = sanitizeText(body.category, 100)
  const subCategory = sanitizeText(body.subCategory, 100)
  const serviceAddress = sanitizeText(body.serviceAddress, 500)
  const building = sanitizeText(body.building, 150)
  const flatNo = sanitizeText(body.flatNo, 100)
  const area = serviceAreaLookup.get(String(body.area || '').trim().toLowerCase())
  const categories = ['Appliance', 'Plumbing', 'Electrical', 'Home maintenance', 'Computer']
  const category = categories.find((item) => item.toLowerCase() === requestedCategory.toLowerCase())
  const imageData = body.imageData

  if (!detail || detail.length < 10 || (typeof body.detail === 'string' && body.detail.trim().length > 2000)) {
    return response.status(400).json({ message: 'Request details must be between 10 and 2000 characters.' })
  }
  if (!category) return response.status(400).json({ message: 'Choose a valid service category.' })
  if (!area) return response.status(400).json({ message: `Choose the ${SERVICE_CITY} area where the job is.` })
  if (serviceAddress.length < 5 || (typeof body.serviceAddress === 'string' && body.serviceAddress.trim().length > 500)) {
    return response.status(400).json({ message: 'Enter a service address between 5 and 500 characters.' })
  }
  if ((typeof body.building === 'string' && body.building.trim().length > 150)
    || (typeof body.flatNo === 'string' && body.flatNo.trim().length > 100)) {
    return response.status(400).json({ message: 'Building and flat details must be 150 and 100 characters or fewer.' })
  }
  if (typeof body.subCategory === 'string' && body.subCategory.trim().length > 100) {
    return response.status(400).json({ message: 'Subcategory must be 100 characters or fewer.' })
  }
  if (imageData && typeof imageData !== 'string') return response.status(400).json({ message: 'Attach a JPG, PNG, or WebP image.' })

  try {
    let imagePath = null
    if (imageData) {
      const image = decodeImageDataUrl(imageData)
      if (!image) return response.status(400).json({ message: 'Attach a valid JPG, PNG, or WebP image.' })
      if (image.error) return response.status(400).json({ message: image.error })
      const uploadDirectory = resolve(process.cwd(), '../uploads')
      await mkdir(uploadDirectory, { recursive: true })
      const fileName = `request_${randomUUID()}.${image.extension}`
      await writeFile(resolve(uploadDirectory, fileName), image.buffer)
      imagePath = `uploads/${fileName}`
    }
    try {
      const postId = await nextGeneratedId(pool, 'helplagbe_posts_post_id_seq')
      const [result] = await pool.execute(
        usesTiDBSequences
          ? 'INSERT INTO posts (post_id, Post_detail, Category, `Sub-Category`, Image, user_id, service_address, building, flat_no, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          : 'INSERT INTO posts (Post_detail, Category, `Sub-Category`, Image, user_id, service_address, building, flat_no, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        usesTiDBSequences
          ? [postId, detail, category, subCategory || null, imagePath, request.user.userId, serviceAddress, building || null, flatNo || null, area]
          : [detail, category, subCategory || null, imagePath, request.user.userId, serviceAddress, building || null, flatNo || null, area],
      )
      notifyMatchingTechnicians(request.user.userId, serviceAddress, category, area).catch((error) => console.error('Could not send request alerts.', error.message))
      response.status(201).json({ id: result.insertId || postId, message: 'Service request posted.' })
    } catch (error) {
      if (imagePath) await unlink(resolve(process.cwd(), '../', imagePath)).catch(() => {})
      throw error
    }
  } catch (error) {
    response.status(500).json({ message: 'Could not create service request.' })
  }
})

app.patch('/api/customer/posts/:postId', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') return response.status(403).json({ message: 'Only customers can edit their requests.' })
  const body = request.body && typeof request.body === 'object' ? request.body : {}
  const detail = sanitizeText(body.detail, 2000)
  const requestedCategory = sanitizeText(body.category, 100)
  const subCategory = sanitizeText(body.subCategory, 100)
  const serviceAddress = sanitizeText(body.serviceAddress, 500)
  const building = sanitizeText(body.building, 150)
  const flatNo = sanitizeText(body.flatNo, 100)
  const area = serviceAreaLookup.get(String(body.area || '').trim().toLowerCase())
  const categories = ['Appliance', 'Plumbing', 'Electrical', 'Home maintenance', 'Computer']
  const category = categories.find((item) => item.toLowerCase() === requestedCategory.toLowerCase())
  if (!area) return response.status(400).json({ message: `Choose the ${SERVICE_CITY} area where the job is.` })
  if (detail.length < 10 || (typeof body.detail === 'string' && body.detail.trim().length > 2000)) {
    return response.status(400).json({ message: 'Request details must be between 10 and 2000 characters.' })
  }
  if (!category) return response.status(400).json({ message: 'Choose a valid service category.' })
  if (serviceAddress.length < 5 || (typeof body.serviceAddress === 'string' && body.serviceAddress.trim().length > 500)) {
    return response.status(400).json({ message: 'Enter a service address between 5 and 500 characters.' })
  }
  if ((typeof body.subCategory === 'string' && body.subCategory.trim().length > 100)
    || (typeof body.building === 'string' && body.building.trim().length > 150)
    || (typeof body.flatNo === 'string' && body.flatNo.trim().length > 100)) {
    return response.status(400).json({ message: 'Subcategory, building, or flat details exceed the allowed length.' })
  }

  const connection = await pool.getConnection()
  let affectedTechnicians = []
  let pending = []
  try {
    await connection.beginTransaction()
    const [posts] = await connection.execute(
      'SELECT post_id, Post_detail, closed_at FROM posts WHERE post_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [request.params.postId, request.user.userId],
    )
    const post = posts[0]
    if (!post) {
      await connection.rollback()
      return response.status(404).json({ message: 'Request not found.' })
    }
    if (post.closed_at) {
      await connection.rollback()
      return response.status(409).json({ message: 'Closed requests cannot be edited.' })
    }
    const [acceptedTasks] = await connection.execute(
      "SELECT task_id FROM tasks WHERE post_id = ? AND task_status IN ('accepted','scheduled','in_progress','completed') LIMIT 1",
      [post.post_id],
    )
    if (acceptedTasks[0]) {
      await connection.rollback()
      return response.status(409).json({ message: 'Requests cannot be edited after a technician has been accepted.' })
    }
    ;[pending] = await connection.execute(
      "SELECT t.task_id, tech.user_id FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id WHERE t.post_id = ? AND t.task_status = 'pending'",
      [post.post_id],
    )
    affectedTechnicians = pending.map((bid) => bid.user_id)
    await connection.execute(
      `UPDATE posts SET Post_detail = ?, Category = ?, \`Sub-Category\` = ?, service_address = ?,
       building = ?, flat_no = ?, area = ?, updated_at = NOW() WHERE post_id = ?`,
      [detail, category, subCategory || null, serviceAddress, building || null, flatNo || null, area, post.post_id],
    )
    for (const bid of pending) {
      await recordTaskEvent(connection, bid.task_id, request.user.userId, 'request_updated', 'pending', 'pending', null, 'Customer updated request details')
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not update your request.' })
  } finally {
    connection.release()
  }
  for (const technicianUserId of affectedTechnicians) {
    try {
      await createNotification(technicianUserId, 'request_updated', 'Request details updated', 'A customer updated a request you bid on. Review the details before proceeding.', 'task', pending.find((bid) => bid.user_id === technicianUserId)?.task_id)
    } catch (error) {
      console.error('Could not notify bidder about request update.', error.message)
    }
  }
  response.json({ message: 'Request updated. Pending bidders have been notified.' })
})

app.post('/api/customer/posts/:postId/close', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') return response.status(403).json({ message: 'Only customers can close their requests.' })
  const reason = sanitizeText(request.body?.reason, 500)
  if (reason.length < 5 || (typeof request.body?.reason === 'string' && request.body.reason.trim().length > 500)) {
    return response.status(400).json({ message: 'Provide a reason between 5 and 500 characters.' })
  }

  const connection = await pool.getConnection()
  let affectedTechnicians = []
  let pending = []
  try {
    await connection.beginTransaction()
    const [posts] = await connection.execute(
      'SELECT post_id, closed_at FROM posts WHERE post_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [request.params.postId, request.user.userId],
    )
    const post = posts[0]
    if (!post) {
      await connection.rollback()
      return response.status(404).json({ message: 'Request not found.' })
    }
    if (post.closed_at) {
      await connection.rollback()
      return response.status(409).json({ message: 'This request is already closed.' })
    }
    const [acceptedTasks] = await connection.execute(
      "SELECT task_id FROM tasks WHERE post_id = ? AND task_status IN ('accepted','scheduled','in_progress','completed') LIMIT 1",
      [post.post_id],
    )
    if (acceptedTasks[0]) {
      await connection.rollback()
      return response.status(409).json({ message: 'A request with an accepted technician cannot be closed here. Cancel the task with its reason instead.' })
    }
    ;[pending] = await connection.execute(
      "SELECT t.task_id, tech.user_id FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id WHERE t.post_id = ? AND t.task_status = 'pending'",
      [post.post_id],
    )
    affectedTechnicians = pending.map((bid) => bid.user_id)
    await connection.execute(
      'UPDATE posts SET closed_at = NOW(), close_reason = ?, updated_at = NOW() WHERE post_id = ?',
      [reason, post.post_id],
    )
    for (const bid of pending) {
      await connection.execute(
        "UPDATE tasks SET task_status = 'rejected', updated_at = NOW() WHERE task_id = ? AND task_status = 'pending'",
        [bid.task_id],
      )
      await recordTaskEvent(connection, bid.task_id, request.user.userId, 'request_closed', 'pending', 'rejected', null, reason)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not close your request.' })
  } finally {
    connection.release()
  }
  for (const technicianUserId of affectedTechnicians) {
    try {
      await createNotification(technicianUserId, 'request_closed', 'Request closed', 'A customer closed a request you bid on. Your offer is no longer active.', 'task', pending.find((bid) => bid.user_id === technicianUserId)?.task_id)
    } catch (error) {
      console.error('Could not notify bidder about request closure.', error.message)
    }
  }
  response.json({ message: 'Request closed and pending offers were declined.' })
})

app.get('/api/technician/account-status', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  try {
    const [rows] = await pool.execute(
      `SELECT tech.status, tech.Skill_details AS skills, tech.service_area AS serviceArea, tech.availability,
              tech.national_id AS nationalId, tech.Required_Documents AS documents,
              tech.id_verification_status AS idStatus, tech.id_verification_note AS idNote,
              u.Image AS profileImage, u.phone_no AS phone, u.address
       FROM technician tech JOIN users u ON u.user_id = tech.user_id WHERE tech.user_id = ? LIMIT 1`,
      [request.user.userId],
    )
    const row = rows[0]
    if (!row) return response.json({ status: 'pending', checklist: [] })
    const checklist = [
      { id: 'photo', label: 'Add a profile photo', done: Boolean(row.profileImage) },
      { id: 'phone', label: 'Add a phone number', done: Boolean(row.phone) },
      { id: 'skills', label: 'Describe your skills (at least 20 characters)', done: String(row.skills || '').trim().length >= 20 },
      { id: 'area', label: 'Set your service area', done: Boolean(row.serviceArea) },
      { id: 'availability', label: 'Set your availability', done: Boolean(row.availability) },
      { id: 'documents', label: 'Upload a photo of your national ID', done: Boolean(row.documents) && Boolean(row.nationalId) },
    ]
    response.json({
      status: row.status, checklist,
      idVerification: { status: row.idStatus, note: row.idStatus === 'rejected' ? row.idNote : null, hasDocument: Boolean(row.documents) },
    })
  } catch (error) {
    response.status(500).json({ message: 'Could not load account status.' })
  }
})

app.get('/api/technician/earnings', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  try {
    const [months] = await pool.execute(
      `SELECT DATE_FORMAT(COALESCE(t.paid_at, t.updated_at), '%Y-%m') AS month,
              COUNT(*) AS jobs,
              SUM(CASE WHEN t.payment_status = 'paid' THEN COALESCE(t.agreed_price, t.price) ELSE 0 END) AS paid,
              SUM(CASE WHEN t.payment_status = 'paid' THEN 0 ELSE COALESCE(t.agreed_price, t.price) END) AS outstanding
       FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE tech.user_id = ? AND t.task_status = 'completed'
       GROUP BY month ORDER BY month DESC LIMIT 12`,
      [request.user.userId],
    )
    const items = months.map((row) => ({ month: row.month, jobs: Number(row.jobs), paid: Number(row.paid || 0), outstanding: Number(row.outstanding || 0) }))
    const totals = items.reduce((sum, row) => ({ jobs: sum.jobs + row.jobs, paid: sum.paid + row.paid, outstanding: sum.outstanding + row.outstanding }), { jobs: 0, paid: 0, outstanding: 0 })
    response.json({ months: items, totals })
  } catch (error) {
    response.status(500).json({ message: 'Could not load earnings.' })
  }
})

// ---------------------------------------------------------------- Analytics & history

function parseMonths(value) {
  const months = Number(value)
  return [3, 6, 12].includes(months) ? months : 6
}

// ['2026-06', ..., '2026-11'] ending with the current month (UTC), oldest first.
function monthKeys(months) {
  const keys = []
  const now = new Date()
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function windowStart(months) {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function fillMonths(keys, rows, fields) {
  const byMonth = new Map(rows.map((row) => [row.month, row]))
  return keys.map((month) => {
    const row = byMonth.get(month)
    return { month, ...Object.fromEntries(fields.map((field) => [field, Number(row?.[field] || 0)])) }
  })
}

const asNumber = (value) => (value === null || value === undefined ? null : Number(value))
const percent = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : null)
const taskValue = 'COALESCE(t.agreed_price, t.price)'
const taskEventDate = 'COALESCE(t.completed_at, t.cancelled_at, t.updated_at)'

app.get('/api/analytics/me', authenticate, async (request, response) => {
  const months = parseMonths(request.query.months)
  const keys = monthKeys(months)
  const since = windowStart(months)
  const userId = request.user.userId
  try {
    if (request.user.role === 'customer') {
      const [monthly] = await pool.execute(
        `SELECT DATE_FORMAT(${taskEventDate}, '%Y-%m') AS month, COUNT(*) AS jobs,
                SUM(CASE WHEN t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END) AS paid,
                SUM(CASE WHEN t.payment_status = 'paid' THEN 0 ELSE ${taskValue} END) AS outstanding
         FROM tasks t JOIN posts p ON p.post_id = t.post_id
         WHERE p.user_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?
         GROUP BY month`,
        [userId, since],
      )
      const [categories] = await pool.execute(
        `SELECT p.Category AS category, COUNT(*) AS jobs, SUM(${taskValue}) AS spent
         FROM tasks t JOIN posts p ON p.post_id = t.post_id
         WHERE p.user_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?
         GROUP BY p.Category ORDER BY jobs DESC, spent DESC LIMIT 8`,
        [userId, since],
      )
      const [technicians] = await pool.execute(
        `SELECT tech.technician_id AS technicianId, tech.Full_Name AS name, COUNT(*) AS jobs, SUM(${taskValue}) AS spent,
                ROUND(AVG(tf.consumer_rating), 1) AS rating
         FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
         LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
         WHERE p.user_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?
         GROUP BY tech.technician_id, tech.Full_Name ORDER BY jobs DESC, spent DESC LIMIT 5`,
        [userId, since],
      )
      const [[summary]] = await pool.execute(
        `SELECT COUNT(*) AS completed, COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END), 0) AS paid,
                COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN 0 ELSE ${taskValue} END), 0) AS outstanding,
                ROUND(AVG(tf.consumer_rating), 1) AS avgRating, COUNT(tf.consumer_rating) AS reviews
         FROM tasks t JOIN posts p ON p.post_id = t.post_id LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
         WHERE p.user_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?`,
        [userId, since],
      )
      const [[cancelled]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM tasks t JOIN posts p ON p.post_id = t.post_id
         WHERE p.user_id = ? AND t.task_status = 'cancelled' AND ${taskEventDate} >= ?`,
        [userId, since],
      )
      const [[requests]] = await pool.execute(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM tasks h WHERE h.post_id = p.post_id AND h.task_status IN ('accepted','scheduled','in_progress','completed')) THEN 1 ELSE 0 END) AS hired,
                SUM(CASE WHEN p.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks h WHERE h.post_id = p.post_id AND h.task_status IN ('accepted','scheduled','in_progress','completed','cancelled')) THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN p.closed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks h WHERE h.post_id = p.post_id AND h.task_status IN ('accepted','scheduled','in_progress','completed')) THEN 1 ELSE 0 END) AS closedWithoutHire
         FROM posts p WHERE p.user_id = ? AND p.created_at >= ?`,
        [userId, since],
      )
      const [[offers]] = await pool.execute(
        `SELECT ROUND(AVG(first_offer.minutes)) AS minutes, ROUND(AVG(first_offer.offers), 1) AS offersPerRequest FROM (
           SELECT TIMESTAMPDIFF(MINUTE, p.created_at, MIN(t.created_at)) AS minutes, COUNT(t.task_id) AS offers
           FROM posts p JOIN tasks t ON t.post_id = p.post_id WHERE p.user_id = ? AND p.created_at >= ? GROUP BY p.post_id
         ) first_offer`,
        [userId, since],
      )
      const [[repeat]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM (
           SELECT t.technician_id FROM tasks t JOIN posts p ON p.post_id = t.post_id
           WHERE p.user_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ? GROUP BY t.technician_id HAVING COUNT(*) >= 2
         ) repeat_technicians`,
        [userId, since],
      )
      return response.json({
        role: 'customer', months,
        kpis: {
          paid: Number(summary.paid), outstanding: Number(summary.outstanding), completedJobs: Number(summary.completed),
          averageJobCost: Number(summary.completed) ? Math.round((Number(summary.paid) + Number(summary.outstanding)) / Number(summary.completed)) : null,
          averageRatingGiven: asNumber(summary.avgRating), reviewsGiven: Number(summary.reviews),
          cancelledJobs: Number(cancelled.total), repeatTechnicians: Number(repeat.total),
          averageMinutesToFirstOffer: asNumber(offers?.minutes), averageOffersPerRequest: asNumber(offers?.offersPerRequest),
        },
        requests: { total: Number(requests.total || 0), hired: Number(requests.hired || 0), open: Number(requests.open || 0), closedWithoutHire: Number(requests.closedWithoutHire || 0) },
        monthly: fillMonths(keys, monthly, ['jobs', 'paid', 'outstanding']),
        categories: categories.map((row) => ({ category: row.category, jobs: Number(row.jobs), spent: Number(row.spent || 0) })),
        topTechnicians: technicians.map((row) => ({ technicianId: row.technicianId, name: row.name, jobs: Number(row.jobs), spent: Number(row.spent || 0), rating: asNumber(row.rating) })),
      })
    }

    if (request.user.role === 'technician') {
      const [techRows] = await pool.execute('SELECT technician_id FROM technician WHERE user_id = ? LIMIT 1', [userId])
      if (!techRows[0]) return response.status(404).json({ message: 'Technician profile not found.' })
      const technicianId = techRows[0].technician_id
      const [monthly] = await pool.execute(
        `SELECT DATE_FORMAT(${taskEventDate}, '%Y-%m') AS month, COUNT(*) AS jobs,
                SUM(CASE WHEN t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END) AS paid,
                SUM(CASE WHEN t.payment_status = 'paid' THEN 0 ELSE ${taskValue} END) AS outstanding
         FROM tasks t WHERE t.technician_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?
         GROUP BY month`,
        [technicianId, since],
      )
      const [categories] = await pool.execute(
        `SELECT p.Category AS category, COUNT(*) AS jobs, SUM(${taskValue}) AS earned
         FROM tasks t JOIN posts p ON p.post_id = t.post_id
         WHERE t.technician_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?
         GROUP BY p.Category ORDER BY jobs DESC, earned DESC LIMIT 8`,
        [technicianId, since],
      )
      const [ratingRows] = await pool.execute(
        `SELECT tf.consumer_rating AS rating, COUNT(*) AS total FROM tasks t JOIN task_feedback tf ON tf.task_id = t.task_id
         WHERE t.technician_id = ? AND t.task_status = 'completed' AND tf.consumer_rating IS NOT NULL AND ${taskEventDate} >= ?
         GROUP BY tf.consumer_rating`,
        [technicianId, since],
      )
      const [[offers]] = await pool.execute(
        `SELECT COUNT(*) AS sent,
                SUM(t.task_status IN ('accepted','scheduled','in_progress','completed')) AS hired,
                SUM(t.task_status = 'completed') AS completed,
                SUM(t.task_status = 'rejected') AS declined,
                SUM(t.task_status = 'withdrawn') AS withdrawn,
                SUM(t.task_status = 'pending') AS waiting,
                SUM(t.task_status = 'cancelled') AS cancelled,
                SUM(t.task_status = 'cancelled' AND t.cancelled_by = ?) AS cancelledByYou,
                ROUND(AVG(TIMESTAMPDIFF(MINUTE, p.created_at, t.created_at))) AS minutes
         FROM tasks t JOIN posts p ON p.post_id = t.post_id WHERE t.technician_id = ? AND t.created_at >= ?`,
        [userId, technicianId, since],
      )
      const [[summary]] = await pool.execute(
        `SELECT COUNT(*) AS completed,
                COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END), 0) AS paid,
                COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN 0 ELSE ${taskValue} END), 0) AS outstanding,
                ROUND(AVG(tf.consumer_rating), 1) AS avgRating, COUNT(tf.consumer_rating) AS reviews
         FROM tasks t LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
         WHERE t.technician_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ?`,
        [technicianId, since],
      )
      const [[repeat]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM (
           SELECT p.user_id FROM tasks t JOIN posts p ON p.post_id = t.post_id
           WHERE t.technician_id = ? AND t.task_status = 'completed' AND ${taskEventDate} >= ? GROUP BY p.user_id HAVING COUNT(*) >= 2
         ) repeat_customers`,
        [technicianId, since],
      )
      const decided = Number(offers.hired || 0) + Number(offers.declined || 0)
      const distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, total: Number(ratingRows.find((row) => Number(row.rating) === rating)?.total || 0) }))
      return response.json({
        role: 'technician', months,
        kpis: {
          paid: Number(summary.paid), outstanding: Number(summary.outstanding), completedJobs: Number(summary.completed),
          averageJobValue: Number(summary.completed) ? Math.round((Number(summary.paid) + Number(summary.outstanding)) / Number(summary.completed)) : null,
          averageRating: asNumber(summary.avgRating), reviews: Number(summary.reviews),
          offerWinRate: percent(offers.hired, decided), averageResponseMinutes: asNumber(offers.minutes),
          repeatCustomers: Number(repeat.total), cancelledByYouRate: percent(offers.cancelledByYou, offers.hired),
        },
        offers: {
          sent: Number(offers.sent || 0), hired: Number(offers.hired || 0), completed: Number(offers.completed || 0),
          declined: Number(offers.declined || 0), withdrawn: Number(offers.withdrawn || 0), waiting: Number(offers.waiting || 0),
        },
        monthly: fillMonths(keys, monthly, ['jobs', 'paid', 'outstanding']),
        categories: categories.map((row) => ({ category: row.category, jobs: Number(row.jobs), earned: Number(row.earned || 0) })),
        ratings: distribution,
      })
    }

    return response.status(403).json({ message: 'Use the admin analytics view.' })
  } catch (error) {
    console.error('Could not load analytics.', error.message)
    response.status(500).json({ message: 'Could not load analytics.' })
  }
})

app.get('/api/admin/analytics', authenticate, requireAdmin, async (request, response) => {
  const months = parseMonths(request.query.months)
  const keys = monthKeys(months)
  const since = windowStart(months)
  try {
    const [[tasks]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(task_status = 'completed') AS completed,
              SUM(task_status IN ('cancelled', 'withdrawn', 'rejected')) AS dropped
       FROM tasks WHERE created_at >= ?`,
      [since],
    )
    const [[firstOffer]] = await pool.execute(
      `SELECT ROUND(AVG(first_offer.minutes)) AS minutes FROM (
         SELECT TIMESTAMPDIFF(MINUTE, p.created_at, MIN(t.created_at)) AS minutes
         FROM posts p JOIN tasks t ON t.post_id = p.post_id WHERE p.created_at >= ? GROUP BY p.post_id
       ) first_offer`,
      [since],
    )
    const [[reports]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(status IN ('open', 'reviewing')) AS open,
              ROUND(AVG(CASE WHEN reviewed_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, reviewed_at) END)) AS hoursToResolve
       FROM marketplace_reports WHERE created_at >= ?`,
      [since],
    )
    const [requestMonths] = await pool.execute("SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS requests FROM posts WHERE created_at >= ? GROUP BY month", [since])
    const [jobMonths] = await pool.execute(
      `SELECT DATE_FORMAT(${taskEventDate}, '%Y-%m') AS month, COUNT(*) AS completed,
              SUM(CASE WHEN t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END) AS paid
       FROM tasks t WHERE t.task_status = 'completed' AND ${taskEventDate} >= ? GROUP BY month`,
      [since],
    )
    const [userMonths] = await pool.execute(
      `SELECT DATE_FORMAT(u.created_at, '%Y-%m') AS month,
              SUM(tech.technician_id IS NULL AND u.admin_id IS NULL) AS customers, SUM(tech.technician_id IS NOT NULL) AS technicians
       FROM users u LEFT JOIN technician tech ON tech.user_id = u.user_id WHERE u.created_at >= ? GROUP BY month`,
      [since],
    )
    const [categories] = await pool.execute(
      'SELECT Category AS category, COUNT(*) AS requests FROM posts WHERE created_at >= ? GROUP BY Category ORDER BY requests DESC LIMIT 8',
      [since],
    )
    const [uncoveredCategories] = await pool.query(
      `SELECT p.Category AS category, COUNT(*) AS requests FROM posts p
       WHERE p.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.post_id = p.post_id)
       GROUP BY p.Category ORDER BY requests DESC LIMIT 8`,
    )
    const [uncoveredAreas] = await pool.query(
      `SELECT p.area AS area, COUNT(*) AS requests FROM posts p
       WHERE p.closed_at IS NULL AND p.area IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.post_id = p.post_id)
       GROUP BY p.area ORDER BY requests DESC LIMIT 8`,
    )
    const [technicianStatus] = await pool.query('SELECT status, COUNT(*) AS total FROM technician GROUP BY status')
    const total = Number(tasks.total || 0)
    response.json({
      months,
      completionRate: percent(tasks.completed, total) ?? 0,
      droppedRate: percent(tasks.dropped, total) ?? 0,
      averageMinutesToFirstOffer: asNumber(firstOffer?.minutes),
      reports: { total: Number(reports?.total || 0), open: Number(reports?.open || 0), hoursToResolve: asNumber(reports?.hoursToResolve) },
      monthly: keys.map((month) => {
        const requestsRow = requestMonths.find((row) => row.month === month)
        const jobsRow = jobMonths.find((row) => row.month === month)
        const usersRow = userMonths.find((row) => row.month === month)
        return {
          month, requests: Number(requestsRow?.requests || 0), completed: Number(jobsRow?.completed || 0), paid: Number(jobsRow?.paid || 0),
          customers: Number(usersRow?.customers || 0), technicians: Number(usersRow?.technicians || 0),
        }
      }),
      categories: categories.map((row) => ({ category: row.category, requests: Number(row.requests) })),
      requestsWithoutOffers: uncoveredCategories.map((row) => ({ category: row.category, requests: Number(row.requests) })),
      requestsWithoutOffersByArea: uncoveredAreas.map((row) => ({ area: row.area, requests: Number(row.requests) })),
      technicianStatus: Object.fromEntries(['pending', 'approved', 'suspended', 'rejected'].map((status) => [status, Number(technicianStatus.find((row) => row.status === status)?.total || 0)])),
    })
  } catch (error) {
    console.error('Could not load analytics.', error.message)
    response.status(500).json({ message: 'Could not load analytics.' })
  }
})

// History: finished jobs for customers and technicians, with filters, totals and CSV export.
function buildHistoryQuery(request) {
  const isTechnician = request.user.role === 'technician'
  const statusFilter = ['completed', 'cancelled', 'declined'].includes(request.query.status) ? request.query.status : 'all'
  const search = sanitizeText(request.query.q || '', 100)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(request.query.from || '') ? request.query.from : null
  const to = /^\d{4}-\d{2}-\d{2}$/.test(request.query.to || '') ? request.query.to : null
  const filters = [isTechnician ? 'tech.user_id = ?' : 'p.user_id = ?']
  const values = [request.user.userId]
  const allowed = isTechnician ? ['completed', 'cancelled', 'rejected', 'withdrawn'] : ['completed', 'cancelled']
  const statuses = statusFilter === 'all' ? allowed
    : statusFilter === 'declined' ? allowed.filter((status) => ['rejected', 'withdrawn'].includes(status))
      : allowed.filter((status) => status === statusFilter)
  if (!statuses.length) filters.push('1 = 0')
  else {
    filters.push(`t.task_status IN (${statuses.map(() => '?').join(', ')})`)
    values.push(...statuses)
  }
  if (from) { filters.push(`${taskEventDate} >= ?`); values.push(`${from} 00:00:00`) }
  if (to) { filters.push(`${taskEventDate} < DATE_ADD(?, INTERVAL 1 DAY)`); values.push(`${to} 00:00:00`) }
  if (search) {
    filters.push(isTechnician
      ? '(p.Post_detail LIKE ? OR p.Category LIKE ? OR t.receipt_number LIKE ?)'
      : '(p.Post_detail LIKE ? OR p.Category LIKE ? OR tech.Full_Name LIKE ? OR t.receipt_number LIKE ?)')
    const pattern = `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    values.push(pattern, pattern, pattern)
    if (!isTechnician) values.push(pattern)
  }
  const from_clause = `FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
    JOIN users customer ON customer.user_id = p.user_id LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
    WHERE ${filters.join(' AND ')}`
  return { isTechnician, from_clause, values }
}

function shapeHistoryRow(row, isTechnician) {
  const knownCounterpart = !isTechnician || Boolean(row.acceptedAt) || ['completed', 'cancelled'].includes(row.status)
  return {
    taskId: row.taskId, postId: row.postId, category: row.category, area: row.area,
    detail: isTechnician ? redactPersonalDetails(row.detail) : row.detail,
    status: row.status, value: Number(row.value || 0), paymentStatus: row.paymentStatus, paymentMethod: row.paymentMethod,
    receiptNumber: row.receiptNumber, date: row.eventDate, cancelReason: row.cancelReason,
    counterpart: isTechnician ? (knownCounterpart ? row.customerName : null) : row.technicianName,
    rating: row.rating === null ? null : Number(row.rating),
  }
}

const historySelect = `SELECT t.task_id AS taskId, p.post_id AS postId, p.Category AS category, p.area, p.Post_detail AS detail,
  t.task_status AS status, ${taskValue} AS value, t.payment_status AS paymentStatus, t.payment_method AS paymentMethod,
  t.receipt_number AS receiptNumber, ${taskEventDate} AS eventDate, t.cancel_reason AS cancelReason, t.accepted_at AS acceptedAt,
  tech.Full_Name AS technicianName, customer.username AS customerName, tf.consumer_rating AS rating`

app.get('/api/history', authenticate, async (request, response) => {
  if (!['customer', 'technician'].includes(request.user.role)) return response.status(403).json({ message: 'History is available to customers and technicians.' })
  try {
    const { page, limit, offset } = parsePagination(request, 10)
    const { isTechnician, from_clause, values } = buildHistoryQuery(request)
    const [rows] = await pool.execute(`${historySelect} ${from_clause} ORDER BY eventDate DESC, t.task_id DESC LIMIT ? OFFSET ?`, [...values, limit, offset])
    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(t.task_status = 'completed') AS completed, SUM(t.task_status = 'cancelled') AS cancelled,
              COALESCE(SUM(CASE WHEN t.task_status = 'completed' AND t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN t.task_status = 'completed' AND t.payment_status <> 'paid' THEN ${taskValue} ELSE 0 END), 0) AS outstanding
       ${from_clause}`,
      values,
    )
    response.json({
      items: rows.map((row) => shapeHistoryRow(row, isTechnician)),
      totals: { total: Number(totals.total || 0), completed: Number(totals.completed || 0), cancelled: Number(totals.cancelled || 0), paid: Number(totals.paid), outstanding: Number(totals.outstanding) },
      pagination: { page, limit, total: Number(totals.total || 0) },
    })
  } catch (error) {
    console.error('Could not load history.', error.message)
    response.status(500).json({ message: 'Could not load history.' })
  }
})

app.get('/api/history/export', authenticate, async (request, response) => {
  if (!['customer', 'technician'].includes(request.user.role)) return response.status(403).json({ message: 'History is available to customers and technicians.' })
  try {
    const { isTechnician, from_clause, values } = buildHistoryQuery(request)
    const [rows] = await pool.execute(`${historySelect} ${from_clause} ORDER BY eventDate DESC, t.task_id DESC LIMIT 5000`, values)
    const header = ['Date', 'Job', 'Category', 'Area', isTechnician ? 'Customer' : 'Technician', 'Status', 'Amount (BDT)', 'Payment', 'Receipt', 'Rating']
    const lines = rows.map((row) => {
      const item = shapeHistoryRow(row, isTechnician)
      return [
        item.date ? new Date(item.date).toISOString().slice(0, 10) : '', item.detail, item.category, item.area || '', item.counterpart || '',
        item.status, item.value, item.status === 'completed' ? item.paymentStatus : '', item.receiptNumber || '', item.rating ?? '',
      ].map(toCsvCell).join(',')
    })
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', 'attachment; filename="helplagbe-history.csv"')
    response.send(`${header.map(toCsvCell).join(',')}\n${lines.join('\n')}\n`)
  } catch (error) {
    console.error('Could not export history.', error.message)
    response.status(500).json({ message: 'Could not export history.' })
  }
})

app.get('/api/technician/requests', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') {
    return response.status(403).json({ message: 'Only technicians can view this workspace.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category, p.\`Sub-Category\` AS subCategory, p.Image AS image, p.created_at AS createdAt,
              viewerTech.service_area AS viewerServiceArea, p.area AS matchArea, COALESCE(p.service_address, customer.address) AS matchAddress,
              CASE WHEN viewerTech.service_area IS NULL THEN 0 ELSE 1 END AS hasServiceArea,
              (SELECT ROUND(AVG(cr.rating), 1) FROM customer_reviews cr WHERE cr.customer_id = p.user_id) AS customerRating,
              (SELECT COUNT(*) FROM customer_reviews cr WHERE cr.customer_id = p.user_id) AS customerReviewCount,
              CASE WHEN EXISTS (SELECT 1 FROM technician approvedViewer WHERE approvedViewer.user_id = ? AND approvedViewer.status = 'approved') THEN customer.username ELSE NULL END AS customerName
       FROM posts p LEFT JOIN users customer ON customer.user_id = p.user_id
       JOIN technician viewerTech ON viewerTech.user_id = ? AND viewerTech.status = 'approved'
       WHERE p.closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.post_id = p.post_id AND t.task_status IN ('accepted', 'scheduled', 'in_progress', 'completed'))
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ?))
       ORDER BY p.created_at DESC LIMIT 30`,
      [request.user.userId, request.user.userId, request.user.userId, request.user.userId],
    )
    const items = rows.map(({ viewerServiceArea, matchArea, matchAddress, ...row }) => ({
      ...row,
      area: matchArea,
      areaMatch: technicianCoversRequest(viewerServiceArea, matchArea, matchAddress) ? 1 : 0,
      detail: redactPersonalDetails(row.detail),
    }))
    response.json(items.sort((first, second) => second.areaMatch - first.areaMatch))
  } catch (error) {
    response.status(500).json({ message: 'Could not load technician requests.' })
  }
})

app.post('/api/tasks/bid', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') {
    return response.status(403).json({ message: 'Only technicians can place bids.' })
  }

  const postId = Number(request.body?.postId)
  const price = Number(request.body?.price)
  const priceDetails = sanitizeText(request.body?.priceDetails, 500)
  const proposedAt = normalizeFutureDateTime(request.body?.proposedAt)
  if (!Number.isInteger(postId) || postId < 1 || !Number.isFinite(price) || price <= 0 || price > 99999999.99 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-8) {
    return response.status(400).json({ message: 'Enter a valid request and a positive price with at most two decimal places.' })
  }
  if (!proposedAt) return response.status(400).json({ message: 'Choose a proposed appointment date and time in the future.' })
  if (typeof request.body?.priceDetails === 'string' && request.body.priceDetails.trim().length > 500) {
    return response.status(400).json({ message: 'Price details must be 500 characters or fewer.' })
  }

  const connection = await pool.getConnection()
  let notification
  try {
    await connection.beginTransaction()
    const [technicians] = await connection.execute(
      'SELECT technician_id, availability_schedule FROM technician WHERE user_id = ? AND status = \'approved\' LIMIT 1',
      [request.user.userId],
    )
    const technician = technicians[0]
    if (!technician) {
      await connection.rollback()
      return response.status(403).json({ message: 'Your technician account is not approved.' })
    }
    const outsideHours = scheduleViolation(technician.availability_schedule, proposedAt)
    if (outsideHours) {
      await connection.rollback()
      return response.status(409).json({ message: outsideHours.replace("the technician's", 'your').replace('This technician is not', 'You are not') })
    }

    const [posts] = await connection.execute(
      'SELECT post_id, user_id, Post_detail, closed_at FROM posts WHERE post_id = ? FOR UPDATE',
      [postId],
    )
    const post = posts[0]
    if (!post) {
      await connection.rollback()
      return response.status(404).json({ message: 'Service request not found.' })
    }
    if (post.closed_at) {
      await connection.rollback()
      return response.status(409).json({ message: 'This request is closed and no longer accepting offers.' })
    }
    if (Number(post.user_id) === Number(request.user.userId)) {
      await connection.rollback()
      return response.status(400).json({ message: 'You cannot bid on your own request.' })
    }
    const [blockRows] = await connection.execute(
      'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
      [request.user.userId, post.user_id, post.user_id, request.user.userId],
    )
    if (blockRows.length) {
      await connection.rollback()
      return response.status(403).json({ message: 'You cannot send an offer on this request.' })
    }

    const [activeTasks] = await connection.execute(
      "SELECT task_id FROM tasks WHERE post_id = ? AND task_status IN ('accepted', 'scheduled', 'in_progress', 'completed') LIMIT 1",
      [postId],
    )
    if (activeTasks[0]) {
      await connection.rollback()
      return response.status(409).json({ message: 'This request is no longer accepting bids.' })
    }

    const taskId = await nextGeneratedId(connection, 'helplagbe_tasks_task_id_seq')
    const [insertResult] = await connection.execute(
      usesTiDBSequences
        ? 'INSERT INTO tasks (task_id, task_status, price, price_details, post_id, technician_id, proposed_at, technician_schedule_confirmed_at) VALUES (?, \'pending\', ?, ?, ?, ?, ?, NOW())'
        : 'INSERT INTO tasks (task_status, price, price_details, post_id, technician_id, proposed_at, technician_schedule_confirmed_at) VALUES (\'pending\', ?, ?, ?, ?, ?, NOW())',
      usesTiDBSequences
        ? [taskId, price, priceDetails, postId, technician.technician_id, proposedAt]
        : [price, priceDetails, postId, technician.technician_id, proposedAt],
    )
    const generatedTaskId = insertResult.insertId || taskId
    await recordTaskEvent(connection, generatedTaskId, request.user.userId, 'offer_received', null, 'pending', proposedAt)
    await connection.commit()
    notification = { ...post, taskId: generatedTaskId }
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'You already bid on this request.' })
    return response.status(500).json({ message: 'Could not place bid.' })
  } finally {
    connection.release()
  }

  try {
    await createNotification(notification.user_id, 'new_bid', 'New bid received', `A technician placed a bid on: ${notification.Post_detail}`, 'task', notification.taskId)
  } catch (error) {
    console.error('Could not create bid notification.', error.message)
  }
  response.status(201).json({ message: 'Bid placed successfully.' })
})

app.patch('/api/technician/tasks/:taskId/bid', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  const price = Number(request.body?.price)
  const priceDetails = sanitizeText(request.body?.priceDetails, 500)
  const proposedAt = normalizeFutureDateTime(request.body?.proposedAt)
  if (!Number.isFinite(price) || price <= 0 || price > 99999999.99 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-8) {
    return response.status(400).json({ message: 'Enter a positive bid amount with at most two decimal places.' })
  }
  if (!proposedAt) return response.status(400).json({ message: 'Choose a proposed appointment date and time in the future.' })
  if (typeof request.body?.priceDetails === 'string' && request.body.priceDetails.trim().length > 500) {
    return response.status(400).json({ message: 'Price details must be 500 characters or fewer.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [tasks] = await connection.execute(
      `SELECT t.task_id, t.task_status, tech.availability_schedule FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND tech.user_id = ? FOR UPDATE`,
      [request.params.taskId, request.user.userId],
    )
    if (!tasks[0] || tasks[0].task_status !== 'pending') {
      await connection.rollback()
      return response.status(409).json({ message: 'Only pending bids can be edited.' })
    }
    const outsideHours = scheduleViolation(tasks[0].availability_schedule, proposedAt)
    if (outsideHours) {
      await connection.rollback()
      return response.status(409).json({ message: outsideHours.replace("the technician's", 'your').replace('This technician is not', 'You are not') })
    }
    const [result] = await connection.execute(
      `UPDATE tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       SET t.price = ?, t.price_details = ?, t.proposed_at = ?, t.technician_schedule_confirmed_at = NOW(), t.updated_at = NOW()
       WHERE t.task_id = ? AND tech.user_id = ? AND t.task_status = 'pending'`,
      [price, priceDetails, proposedAt, request.params.taskId, request.user.userId],
    )
    if (!result.affectedRows) {
      await connection.rollback()
      return response.status(409).json({ message: 'Only pending bids can be edited.' })
    }
    await recordTaskEvent(connection, tasks[0].task_id, request.user.userId, 'schedule_proposed', 'pending', 'pending', proposedAt, 'Updated offer proposal')
    await connection.commit()
    response.json({ message: 'Bid updated.' })
  } catch (error) {
    await connection.rollback()
    response.status(500).json({ message: 'Could not update bid.' })
  } finally {
    connection.release()
  }
})

app.post('/api/technician/tasks/:taskId/withdraw', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  const reason = sanitizeText(request.body?.reason, 500)
  if (reason.length < 5 || (typeof request.body?.reason === 'string' && request.body.reason.trim().length > 500)) {
    return response.status(400).json({ message: 'Provide a withdrawal reason between 5 and 500 characters.' })
  }
  const connection = await pool.getConnection()
  let task
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT t.task_id, t.task_status, p.user_id AS customerId, p.Post_detail
       FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       JOIN posts p ON p.post_id = t.post_id
       WHERE t.task_id = ? AND tech.user_id = ? LIMIT 1 FOR UPDATE`,
      [request.params.taskId, request.user.userId],
    )
    task = rows[0]
    if (!task || task.task_status !== 'pending') {
      await connection.rollback()
      return response.status(409).json({ message: 'Only your pending offers can be withdrawn.' })
    }
    await connection.execute(
      "UPDATE tasks SET task_status = 'withdrawn', updated_at = NOW() WHERE task_id = ?",
      [task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, 'offer_withdrawn', 'pending', 'withdrawn', null, reason)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not withdraw this offer.' })
  } finally {
    connection.release()
  }
  try {
    await createNotification(task.customerId, 'bid_withdrawn', 'Technician withdrew an offer', `A technician withdrew their offer for: ${redactPersonalDetails(task.Post_detail)}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not notify customer about withdrawn offer.', error.message)
  }
  response.json({ message: 'Offer withdrawn and the customer has been notified.' })
})

app.get('/api/technician/tasks', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })

  try {
    const [rows] = await pool.execute(
      `SELECT t.task_id AS id, t.task_status AS status, t.price, t.price_details AS priceDetails,
              COALESCE(t.agreed_price, t.price) AS agreedPrice,
              t.price_change_proposed AS priceChangeProposed, t.price_change_reason AS priceChangeReason,
              t.price_change_proposed_by AS priceChangeProposedBy,
              DATE_FORMAT(t.proposed_at, '%Y-%m-%dT%H:%i:%s.000Z') AS proposedAt, t.customer_schedule_confirmed_at AS customerScheduleConfirmedAt,
              t.technician_schedule_confirmed_at AS technicianScheduleConfirmedAt,
              t.accepted_at AS acceptedAt, t.completed_at AS completedAt, t.cancel_reason AS cancelReason,
              t.payment_status AS paymentStatus, t.payment_method AS paymentMethod,
              DATE_FORMAT(t.paid_at, '%Y-%m-%dT%H:%i:%s.000Z') AS paidAt,
              t.receipt_number AS receiptNumber, t.customer_paid_confirmed_at AS customerPaidConfirmedAt,
              t.technician_paid_confirmed_at AS technicianPaidConfirmedAt,
              p.Post_detail AS detail, p.Category AS category,
              CASE WHEN t.task_status IN ('accepted','scheduled','in_progress','completed','cancelled') THEN p.service_address ELSE NULL END AS serviceAddress,
              CASE WHEN t.task_status IN ('accepted','scheduled','in_progress','completed','cancelled') THEN p.building ELSE NULL END AS building,
              CASE WHEN t.task_status IN ('accepted','scheduled','in_progress','completed','cancelled') THEN p.flat_no ELSE NULL END AS flatNo,
              CASE WHEN t.task_status IN ('accepted','scheduled','in_progress','completed','cancelled') THEN customer.phone_no ELSE NULL END AS customerPhone
       FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id
       JOIN posts p ON p.post_id = t.post_id
       JOIN users customer ON customer.user_id = p.user_id
       WHERE tech.user_id = ? ORDER BY t.updated_at DESC`,
      [request.user.userId],
    )
    response.json(rows.map((row) => ({
      ...row,
      detail: ['accepted', 'scheduled', 'in_progress', 'completed', 'cancelled'].includes(row.status)
        ? row.detail
        : redactPersonalDetails(row.detail),
    })))
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
    const requiredStatus = status === 'in_progress' ? 'scheduled' : 'in_progress'
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [tasks] = await connection.execute(
        `SELECT t.task_id, t.task_status FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id
         WHERE t.task_id = ? AND tech.user_id = ? LIMIT 1 FOR UPDATE`,
        [request.params.taskId, request.user.userId],
      )
      if (!tasks[0] || tasks[0].task_status !== requiredStatus) {
        await connection.rollback()
        return response.status(409).json({ message: status === 'in_progress' ? 'Both sides must confirm the appointment before the job can start.' : 'Task is not in the required state.' })
      }
      await connection.execute(
        `UPDATE tasks t JOIN technician tech ON tech.technician_id = t.technician_id
         SET t.task_status = ?, t.${timestampColumn} = COALESCE(t.${timestampColumn}, NOW()), t.updated_at = NOW()
         WHERE t.task_id = ? AND tech.user_id = ? AND t.task_status = ?`,
        [status, request.params.taskId, request.user.userId, requiredStatus],
      )
      await recordTaskEvent(connection, tasks[0].task_id, request.user.userId, status, requiredStatus, status)
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
    if (status === 'completed') {
      const [taskRows] = await pool.execute(
        'SELECT p.user_id, p.Post_detail FROM tasks t JOIN posts p ON p.post_id = t.post_id WHERE t.task_id = ?',
        [request.params.taskId],
      )
      if (taskRows[0]) {
        try {
          await createNotification(taskRows[0].user_id, 'task_completed', 'Task completed', `Your technician marked this task complete: ${taskRows[0].Post_detail}`, 'task', taskRows[0].task_id)
        } catch (error) {
          console.error('Could not create completion notification.', error.message)
        }
      }
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
      (SELECT COUNT(*) FROM technician WHERE Required_Documents IS NOT NULL AND Required_Documents <> '' AND id_verification_status = 'unverified') AS idReviewsWaiting,
      (SELECT COUNT(*) FROM posts) AS requests,
      (SELECT COUNT(*) FROM tasks) AS tasks,
      (SELECT COUNT(*) FROM tasks WHERE task_status = 'completed') AS completedTasks`)
    const counts = countRows[0]
    const [pendingTechnicians] = await pool.query(
      `SELECT technician_id AS id, Full_Name AS name, national_id AS nationalId,
              Skill_details AS skills, address, status, user_id AS userId
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
      `SELECT t.task_id AS id, t.task_status AS status, t.price, t.price_details AS priceDetails,
              COALESCE(t.agreed_price, t.price) AS agreedPrice,
              t.price_change_proposed AS priceChangeProposed, t.price_change_reason AS priceChangeReason,
              t.price_change_proposed_by AS priceChangeProposedBy,
              t.payment_status AS paymentStatus, t.payment_method AS paymentMethod, t.receipt_number AS receiptNumber,
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
        GROUP BY p.post_id, p.Post_detail, p.Category, p.created_at, u.username
        ORDER BY p.created_at DESC LIMIT 50`,
     )
     const [technicians] = await pool.query(
      `SELECT technician_id AS id, Full_Name AS name, national_id AS nationalId,
            Skill_details AS skills, address, status, user_id AS userId,
            id_verification_status AS idStatus, (Required_Documents IS NOT NULL AND Required_Documents <> '') AS hasDocument
       FROM technician ORDER BY created_at DESC LIMIT 50`,
     )
     response.json({ counts, pendingTechnicians, users, tasks, posts, technicians })
  } catch (error) {
    response.status(500).json({ message: 'Could not load admin overview.' })
  }
})

app.get('/api/admin/audit-log', authenticate, requireAdmin, async (request, response) => {
  try {
    const search = sanitizeText(request.query.search || '', 120)
    const action = sanitizeText(request.query.action || '', 80)
    const whereClauses = []
    const values = []

    if (search) {
      whereClauses.push('(LOWER(a.action) LIKE LOWER(?) OR LOWER(a.details) LIKE LOWER(?) OR LOWER(u.username) LIKE LOWER(?))')
      values.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (action) {
      whereClauses.push('LOWER(a.action) = LOWER(?)')
      values.push(action)
    }

    const whereClause = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
    const [rows] = await pool.execute(
      `SELECT a.audit_id AS id, a.action, a.target_type AS targetType, a.target_id AS targetId,
              a.details, a.created_at AS createdAt, u.username AS adminName
       FROM admin_audit_log a JOIN users u ON u.user_id = a.admin_id ${whereClause}
       ORDER BY a.created_at DESC LIMIT 100`,
      values,
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load audit log.' })
  }
})

app.get('/api/admin/users', authenticate, requireAdmin, async (request, response) => {
  try {
    const search = sanitizeText(request.query.search || '', 120)
    const role = sanitizeText(request.query.role || '', 20)
    const filters = []
    const values = []

    if (search) {
      filters.push('(LOWER(u.username) LIKE LOWER(?) OR LOWER(u.email) LIKE LOWER(?))')
      values.push(`%${search}%`, `%${search}%`)
    }
    if (role) {
      filters.push("CASE WHEN u.admin_id IS NOT NULL THEN 'admin' WHEN tech.technician_id IS NOT NULL THEN 'technician' ELSE 'customer' END = ?")
      values.push(role)
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const [rows] = await pool.execute(
      `SELECT u.user_id AS id, u.username AS name, u.email, u.phone_no AS phone,
              CASE WHEN u.admin_id IS NOT NULL THEN 'admin'
                   WHEN tech.technician_id IS NOT NULL THEN 'technician'
                   ELSE 'customer' END AS role,
              COALESCE(controls.status, 'active') AS accountStatus,
              u.created_at AS createdAt
       FROM users u LEFT JOIN technician tech ON tech.user_id = u.user_id
       LEFT JOIN admin_user_controls controls ON controls.user_id = u.user_id ${whereClause}
       ORDER BY u.created_at DESC LIMIT 100`,
      values,
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load user directory.' })
  }
})

app.get('/api/admin/reports/export', authenticate, requireAdmin, async (_request, response) => {
  try {
    const [taskRows] = await pool.execute(`SELECT task_status AS status, COUNT(*) AS total FROM tasks GROUP BY task_status`)
    const rows = [
      ['type', 'total'],
      ...taskRows.map((row) => [row.status, String(row.total)]),
      ['users', String((await pool.query('SELECT COUNT(*) AS total FROM users'))[0][0].total)],
      ['technicians', String((await pool.query('SELECT COUNT(*) AS total FROM technician'))[0][0].total)],
      ['requests', String((await pool.query('SELECT COUNT(*) AS total FROM posts'))[0][0].total)],
    ]
    const csv = rows.map((row) => row.map(toCsvCell).join(',')).join('\r\n')
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', 'attachment; filename="helplagbe-report.csv"')
    response.send(csv)
  } catch (error) {
    response.status(500).json({ message: 'Could not export report.' })
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

const technicianTransitions = {
  pending: ['approved', 'rejected'],
  approved: ['suspended', 'rejected'],
  suspended: ['approved', 'rejected'],
  rejected: ['approved'],
}

app.post('/api/technician/id-document', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  const image = decodeImageDataUrl(request.body?.imageData)
  if (!image || image.error) return response.status(400).json({ message: image?.error || 'Upload a JPG, PNG or WebP photo of your national ID.' })
  let storedPath
  try {
    const directory = resolve(PRIVATE_DIRECTORY, 'id-documents')
    await mkdir(directory, { recursive: true })
    const fileName = `${randomUUID()}.${image.extension}`
    await writeFile(resolve(directory, fileName), image.buffer)
    storedPath = `private/id-documents/${fileName}`
  } catch (error) {
    console.error('Could not store ID document.', error.message)
    return response.status(500).json({ message: 'Could not save your document.' })
  }
  try {
    const [rows] = await pool.execute('SELECT technician_id, Full_Name, Required_Documents FROM technician WHERE user_id = ? LIMIT 1', [request.user.userId])
    const technician = rows[0]
    if (!technician) {
      await unlink(resolveStoredDocument(storedPath)).catch(() => {})
      return response.status(404).json({ message: 'Technician profile not found.' })
    }
    await pool.execute(
      `UPDATE technician SET Required_Documents = ?, id_verification_status = 'unverified', id_verified_at = NULL,
       id_verified_by = NULL, id_verification_note = NULL, updated_at = NOW() WHERE technician_id = ?`,
      [storedPath, technician.technician_id],
    )
    // Replacing a document discards the old private file; legacy public files are left alone.
    if (String(technician.Required_Documents || '').startsWith('private/')) {
      const previous = resolveStoredDocument(technician.Required_Documents)
      if (previous) await unlink(previous).catch(() => {})
    }
    response.json({ message: 'Your ID photo was uploaded. An administrator will review it.', idVerification: { status: 'unverified', note: null, hasDocument: true } })
  } catch (error) {
    await unlink(resolveStoredDocument(storedPath)).catch(() => {})
    console.error('Could not record ID document.', error.message)
    response.status(500).json({ message: 'Could not save your document.' })
  }
})

app.get('/api/admin/technicians/:technicianId/id-document', authenticate, requireAdmin, async (request, response) => {
  try {
    const [rows] = await pool.execute('SELECT technician_id, Full_Name, Required_Documents FROM technician WHERE technician_id = ? LIMIT 1', [request.params.technicianId])
    const technician = rows[0]
    if (!technician?.Required_Documents) return response.status(404).json({ message: 'No ID document has been uploaded.' })
    const file = resolveStoredDocument(technician.Required_Documents)
    const contentType = file ? documentContentTypes[extname(file).toLowerCase()] : null
    if (!file || !contentType) return response.status(404).json({ message: 'The ID document is unavailable.' })
    let data
    try { data = await readFile(file) } catch (error) { return response.status(404).json({ message: 'The ID document file is missing. Ask the technician to upload it again.' }) }
    await createAudit(request.user.userId, 'id_document_viewed', 'technician', technician.technician_id, `Viewed the ID document of ${technician.Full_Name}.`)
    response.setHeader('Content-Type', contentType)
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(data)
  } catch (error) {
    console.error('Could not open ID document.', error.message)
    response.status(500).json({ message: 'Could not open the ID document.' })
  }
})

app.patch('/api/admin/technicians/:technicianId/id-verification', authenticate, requireAdmin, async (request, response) => {
  const decision = request.body?.decision
  const note = sanitizeText(request.body?.note, 255)
  if (!['verified', 'rejected'].includes(decision)) return response.status(400).json({ message: 'Choose verified or rejected.' })
  if (decision === 'rejected' && note.length < 5) return response.status(400).json({ message: 'Tell the technician why the document was rejected (at least 5 characters).' })
  try {
    const [rows] = await pool.execute('SELECT technician_id, user_id, Full_Name, national_id, Required_Documents FROM technician WHERE technician_id = ? LIMIT 1', [request.params.technicianId])
    const technician = rows[0]
    if (!technician) return response.status(404).json({ message: 'Technician not found.' })
    if (!technician.Required_Documents || !technician.national_id) return response.status(409).json({ message: 'There is no ID document and national ID number to review yet.' })
    const file = resolveStoredDocument(technician.Required_Documents)
    if (decision === 'verified' && !(file && existsSync(file))) return response.status(409).json({ message: 'The document file is missing, so it cannot be verified. Ask the technician to upload it again.' })
    await pool.execute(
      `UPDATE technician SET id_verification_status = ?, id_verified_at = IF(? = 'verified', NOW(), NULL),
       id_verified_by = ?, id_verification_note = ?, updated_at = NOW() WHERE technician_id = ?`,
      [decision, decision, request.user.userId, note || null, technician.technician_id],
    )
    await createAudit(request.user.userId, `id_${decision}`, 'technician', technician.technician_id, `${technician.Full_Name}: ID ${decision}.${note ? ` ${note}` : ''}`)
    try {
      await createNotification(technician.user_id, 'id_verification', decision === 'verified' ? 'Your ID was verified' : 'Your ID photo needs attention',
        decision === 'verified' ? 'An administrator verified your ID. Your profile now shows the ID verified badge.' : `Your ID photo was not accepted. ${note} Upload a clearer photo from Edit profile.`)
    } catch (error) {
      console.error('Could not notify technician about ID review.', error.message)
    }
    response.json({ message: decision === 'verified' ? 'ID verified. The badge now shows on the technician profile.' : 'ID rejected and the technician was told why.' })
  } catch (error) {
    console.error('Could not record ID review.', error.message)
    response.status(500).json({ message: 'Could not save the review.' })
  }
})

app.get('/api/admin/users/:userId/details', authenticate, requireAdmin, async (request, response) => {
  const userId = Number(request.params.userId)
  if (!Number.isInteger(userId) || userId < 1) return response.status(404).json({ message: 'User not found.' })
  try {
    const [users] = await pool.execute(
      `SELECT u.user_id AS id, u.username AS name, u.email, u.phone_no AS phone, u.address, u.Image AS profileImage, u.created_at AS createdAt,
              u.admin_id AS adminId, COALESCE(controls.status, 'active') AS accountStatus,
              tech.technician_id AS technicianId, tech.national_id AS nationalId, tech.Skill_details AS skills, tech.service_area AS serviceArea,
              tech.availability, tech.status AS technicianStatus, tech.Required_Documents AS document,
              tech.id_verification_status AS idStatus, tech.id_verification_note AS idNote, tech.id_verified_at AS idVerifiedAt,
              verifier.username AS idVerifiedBy
       FROM users u LEFT JOIN technician tech ON tech.user_id = u.user_id
       LEFT JOIN admin_user_controls controls ON controls.user_id = u.user_id
       LEFT JOIN users verifier ON verifier.user_id = tech.id_verified_by
       WHERE u.user_id = ? LIMIT 1`,
      [userId],
    )
    const row = users[0]
    if (!row) return response.status(404).json({ message: 'User not found.' })
    const role = row.adminId ? 'admin' : row.technicianId ? 'technician' : 'customer'
    const result = {
      role,
      user: { id: row.id, name: row.name, email: row.email, phone: row.phone, address: row.address, profileImage: row.profileImage, createdAt: row.createdAt, accountStatus: row.accountStatus },
    }
    const [reports] = await pool.execute(
      `SELECT r.report_id AS id, r.report_type AS type, r.category, r.status, r.created_at AS createdAt,
              CASE WHEN r.reporter_id = ? THEN 'filed' ELSE 'against' END AS direction
       FROM marketplace_reports r WHERE r.reporter_id = ? OR r.target_user_id = ? ORDER BY r.created_at DESC LIMIT 8`,
      [userId, userId, userId],
    )
    const [blocks] = await pool.execute(
      'SELECT SUM(blocker_id = ?) AS blocking, SUM(blocked_id = ?) AS blockedBy FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?',
      [userId, userId, userId, userId],
    )
    const [history] = await pool.execute(
      `SELECT a.action, a.details, a.created_at AS createdAt, admin_user.username AS adminName
       FROM admin_audit_log a JOIN users admin_user ON admin_user.user_id = a.admin_id
       WHERE (a.target_type = 'user' AND a.target_id = ?) OR (a.target_type = 'technician' AND a.target_id = ?)
       ORDER BY a.audit_id DESC LIMIT 10`,
      [userId, row.technicianId || 0],
    )
    result.reports = reports
    result.blocks = { blocking: Number(blocks[0]?.blocking || 0), blockedBy: Number(blocks[0]?.blockedBy || 0) }
    result.adminHistory = history
    if (role === 'admin') return response.json(result)

    if (role === 'customer') {
      const [[requests]] = await pool.execute(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(p.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks h WHERE h.post_id = p.post_id AND h.task_status IN ('accepted','scheduled','in_progress','completed','cancelled'))), 0) AS open
         FROM posts p WHERE p.user_id = ?`,
        [userId],
      )
      const [[jobs]] = await pool.execute(
        `SELECT COALESCE(SUM(t.task_status = 'completed'), 0) AS completed, COALESCE(SUM(t.task_status = 'cancelled'), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN t.task_status = 'completed' AND t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END), 0) AS paid,
                COALESCE(SUM(CASE WHEN t.task_status = 'completed' AND t.payment_status <> 'paid' THEN ${taskValue} ELSE 0 END), 0) AS outstanding,
                ROUND(AVG(tf.consumer_rating), 1) AS avgRating, COUNT(tf.consumer_rating) AS reviews
         FROM tasks t JOIN posts p ON p.post_id = t.post_id LEFT JOIN task_feedback tf ON tf.task_id = t.task_id WHERE p.user_id = ?`,
        [userId],
      )
      const [[theirRating]] = await pool.execute('SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS total FROM customer_reviews WHERE customer_id = ?', [userId])
      const [[saved]] = await pool.execute('SELECT COUNT(*) AS total FROM saved_addresses WHERE user_id = ?', [userId])
      const [recent] = await pool.execute(
        `SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category, p.area, p.created_at AS createdAt, p.closed_at AS closedAt,
                (SELECT t.task_status FROM tasks t WHERE t.post_id = p.post_id AND t.task_status IN ('accepted','scheduled','in_progress','completed','cancelled') ORDER BY t.task_id DESC LIMIT 1) AS jobStatus,
                (SELECT tech.Full_Name FROM tasks t JOIN technician tech ON tech.technician_id = t.technician_id WHERE t.post_id = p.post_id AND t.task_status IN ('accepted','scheduled','in_progress','completed') ORDER BY t.task_id DESC LIMIT 1) AS technicianName
         FROM posts p WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 10`,
        [userId],
      )
      result.customer = {
        kpis: {
          requests: Number(requests.total), openRequests: Number(requests.open), completedJobs: Number(jobs.completed), cancelledJobs: Number(jobs.cancelled),
          paid: Number(jobs.paid), outstanding: Number(jobs.outstanding), averageRatingGiven: asNumber(jobs.avgRating), reviewsGiven: Number(jobs.reviews),
          ratingFromTechnicians: asNumber(theirRating.rating), ratingsFromTechnicians: Number(theirRating.total), savedAddresses: Number(saved.total),
        },
        recentRequests: recent,
      }
      return response.json(result)
    }

    const technicianId = row.technicianId
    const [[jobs]] = await pool.execute(
      `SELECT COALESCE(SUM(t.task_status = 'completed'), 0) AS completed, COUNT(*) AS offers,
              COALESCE(SUM(t.task_status IN ('accepted','scheduled','in_progress','completed')), 0) AS hired,
              COALESCE(SUM(t.task_status = 'rejected'), 0) AS declined,
              COALESCE(SUM(t.task_status = 'cancelled' AND t.cancelled_by = ?), 0) AS cancelledByThem,
              COALESCE(SUM(CASE WHEN t.task_status = 'completed' AND t.payment_status = 'paid' THEN ${taskValue} ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN t.task_status = 'completed' AND t.payment_status <> 'paid' THEN ${taskValue} ELSE 0 END), 0) AS outstanding,
              ROUND(AVG(tf.consumer_rating), 1) AS avgRating, COUNT(tf.consumer_rating) AS reviews
       FROM tasks t LEFT JOIN task_feedback tf ON tf.task_id = t.task_id WHERE t.technician_id = ?`,
      [userId, technicianId],
    )
    const [[claims]] = await pool.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(w.status IN ('open','accepted')), 0) AS open
       FROM warranty_claims w JOIN tasks t ON t.task_id = w.task_id WHERE t.technician_id = ?`,
      [technicianId],
    )
    const [recent] = await pool.execute(
      `SELECT t.task_id AS id, p.Post_detail AS detail, p.Category AS category, p.area, t.task_status AS status, ${taskValue} AS value,
              t.payment_status AS paymentStatus, ${taskEventDate} AS date, customer.username AS customerName
       FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN users customer ON customer.user_id = p.user_id
       WHERE t.technician_id = ? ORDER BY t.created_at DESC LIMIT 10`,
      [technicianId],
    )
    result.technician = {
      technicianId, nationalId: row.nationalId, skills: row.skills, serviceAreas: splitStoredAreas(row.serviceArea), availability: row.availability, status: row.technicianStatus,
      idVerification: { status: row.idStatus, note: row.idNote, verifiedAt: row.idVerifiedAt, verifiedBy: row.idVerifiedBy, hasDocument: Boolean(row.document), legacyPublicFile: String(row.document || '').startsWith('uploads/') },
      kpis: {
        completedJobs: Number(jobs.completed), offersSent: Number(jobs.offers), offersHired: Number(jobs.hired), offersDeclined: Number(jobs.declined),
        paid: Number(jobs.paid), outstanding: Number(jobs.outstanding), averageRating: asNumber(jobs.avgRating), reviews: Number(jobs.reviews),
        cancelledByThem: Number(jobs.cancelledByThem), problemClaims: Number(claims.total), openProblemClaims: Number(claims.open),
      },
      recentJobs: recent,
    }
    return response.json(result)
  } catch (error) {
    console.error('Could not load user details.', error.message)
    response.status(500).json({ message: 'Could not load user details.' })
  }
})

app.patch('/api/admin/technicians/:technicianId/status', authenticate, requireAdmin, async (request, response) => {
  const rawStatus = request.body?.status
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : ''
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 500) : ''

  if (!['pending', 'approved', 'suspended', 'rejected'].includes(status)) {
    return response.status(400).json({ message: 'Invalid technician status.' })
  }

  const connection = await pool.getConnection()
  let technician
  let withdrawn = []
  let activeJobs = 0
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      'SELECT technician_id, user_id, Full_Name, status FROM technician WHERE technician_id = ? FOR UPDATE',
      [request.params.technicianId],
    )
    technician = rows[0]
    if (!technician) {
      await connection.rollback()
      return response.status(404).json({ message: 'Technician not found.' })
    }
    const allowed = technicianTransitions[technician.status] || []
    if (!allowed.includes(status)) {
      await connection.rollback()
      return response.status(409).json({ message: `A ${technician.status} technician cannot be changed to ${status}.` })
    }
    const removesAccess = status === 'suspended' || status === 'rejected'
    if (removesAccess && !reason) {
      await connection.rollback()
      return response.status(400).json({ message: `Please give a reason for ${status === 'suspended' ? 'suspending' : 'rejecting'} this technician.` })
    }
    if (removesAccess) {
      const [active] = await connection.execute(
        "SELECT COUNT(*) AS total FROM tasks WHERE technician_id = ? AND task_status IN ('accepted', 'scheduled', 'in_progress')",
        [technician.technician_id],
      )
      activeJobs = Number(active[0].total)
      if (status === 'rejected' && activeJobs > 0) {
        await connection.rollback()
        return response.status(409).json({ message: `This technician has ${activeJobs} active job(s). Reassign or cancel them first, or suspend instead.` })
      }
      const [open] = await connection.execute(
        `SELECT t.task_id, p.user_id AS customerId
         FROM tasks t JOIN posts p ON p.post_id = t.post_id
         WHERE t.technician_id = ? AND t.task_status = 'pending' FOR UPDATE`,
        [technician.technician_id],
      )
      withdrawn = open
      for (const bid of open) {
        await connection.execute("UPDATE tasks SET task_status = 'withdrawn', updated_at = NOW() WHERE task_id = ?", [bid.task_id])
        await recordTaskEvent(connection, bid.task_id, request.user.userId, 'offer_withdrawn', 'pending', 'withdrawn', null, `Technician ${status}: ${reason}`)
      }
    }
    await connection.execute('UPDATE technician SET status = ?, updated_at = NOW() WHERE technician_id = ?', [status, technician.technician_id])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    console.error('Could not update technician status.', error.message)
    return response.status(500).json({ message: 'Could not update technician.' })
  } finally {
    connection.release()
  }

  try {
    const detail = reason ? ` Reason: ${reason}` : ''
    await createAudit(request.user.userId, `technician_${status}`, 'technician', technician.technician_id, `${technician.Full_Name}: ${technician.status} -> ${status}.${detail}`)
    await createNotification(technician.user_id, 'technician_status', 'Application status updated', `Your technician account was ${status}.${detail}`)
    for (const bid of withdrawn) {
      await createNotification(bid.customerId, 'bid_withdrawn', 'Offer no longer available', 'A technician offer on your request was withdrawn because the technician is no longer available.', 'task', bid.task_id)
    }
  } catch (error) {
    console.error('Could not record technician status side effects.', error.message)
  }
  const extra = [
    withdrawn.length ? `${withdrawn.length} open offer(s) withdrawn` : '',
    status === 'suspended' && activeJobs ? `${activeJobs} active job(s) still need attention` : '',
  ].filter(Boolean).join('; ')
  response.json({ message: `Technician ${status}.${extra ? ` ${extra}.` : ''}` })
})

app.patch('/api/admin/tasks/:taskId/status', authenticate, requireAdmin, async (request, response) => {
  const { status } = request.body
  if (!['pending', 'accepted', 'scheduled', 'rejected', 'withdrawn', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    return response.status(400).json({ message: 'Invalid task status.' })
  }

  try {
    const [result] = await pool.execute(
      `UPDATE tasks SET task_status = ?,
       accepted_at = CASE WHEN ? IN ('accepted', 'scheduled', 'in_progress', 'completed') THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
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
      'SELECT * FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [request.params.userId],
    )
    const user = users[0]
    if (!user || user.admin_id) {
      await connection.rollback()
      return response.status(404).json({ message: 'User not found or protected.' })
    }

    const [technicians] = await connection.execute('SELECT * FROM technician WHERE user_id = ?', [user.user_id])
    const [posts] = await connection.execute('SELECT * FROM posts WHERE user_id = ?', [request.params.userId])
    const [tasks] = await connection.execute(
      `SELECT DISTINCT t.* FROM tasks t
       LEFT JOIN posts p ON p.post_id = t.post_id
       LEFT JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE p.user_id = ? OR tech.user_id = ?`,
      [user.user_id, user.user_id],
    )
    const taskIds = tasks.map((task) => task.task_id)
    const [feedback] = taskIds.length
      ? await connection.execute('SELECT * FROM task_feedback WHERE task_id IN (?)', [taskIds])
      : [[]]
    const [messages] = taskIds.length
      ? await connection.execute('SELECT * FROM task_messages WHERE task_id IN (?)', [taskIds])
      : [[]]
    const [events] = taskIds.length
      ? await connection.execute('SELECT * FROM task_lifecycle_events WHERE task_id IN (?)', [taskIds])
      : [[]]
    const [reports] = taskIds.length
      ? await connection.execute(
        'SELECT * FROM marketplace_reports WHERE reporter_id = ? OR target_user_id = ? OR task_id IN (?)',
        [user.user_id, user.user_id, taskIds],
      )
      : await connection.execute('SELECT * FROM marketplace_reports WHERE reporter_id = ? OR target_user_id = ?', [user.user_id, user.user_id])
    const [notifications] = await connection.execute('SELECT * FROM notifications WHERE user_id = ?', [user.user_id])
    const [controls] = await connection.execute('SELECT * FROM admin_user_controls WHERE user_id = ?', [user.user_id])
    const [websiteFeedback] = await connection.execute('SELECT * FROM website_feedback WHERE user_id = ?', [user.user_id])
    const role = technicians.length ? 'technician' : 'customer'
    const snapshot = { version: 3, user, technicians, posts, tasks, feedback, messages, events, reports, notifications, controls, websiteFeedback }
    await connection.execute(
      'INSERT INTO archived_users (original_user_id, username, email, role, archive_reason, snapshot, archived_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user.user_id, user.username, user.email, role, 'Removed by administrator', JSON.stringify(snapshot), request.user.userId],
    )
    await connection.execute('DELETE FROM users WHERE user_id = ? AND admin_id IS NULL', [user.user_id])
    await connection.execute(
      'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [request.user.userId, 'user_archived', 'user', user.user_id, 'Account archived for recovery.'],
    )
    await connection.commit()
    response.json({ message: 'Account archived and removed from the active system.' })
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

app.patch('/api/admin/archived-users/:archiveId/restore', authenticate, requireAdmin, async (request, response) => {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [archiveRows] = await connection.execute(
      'SELECT archive_id, original_user_id, username, email, role, snapshot FROM archived_users WHERE archive_id = ? LIMIT 1 FOR UPDATE',
      [request.params.archiveId],
    )
    if (!archiveRows[0]) {
      await connection.rollback()
      return response.status(404).json({ message: 'Archived user not found.' })
    }
    const archive = archiveRows[0]
    let snapshot
    try {
      snapshot = typeof archive.snapshot === 'string' ? JSON.parse(archive.snapshot) : archive.snapshot
    } catch {
      await connection.rollback()
      return response.status(409).json({ message: 'This archive snapshot is invalid and was left unchanged.' })
    }
    if (!snapshot?.user?.password || !snapshot.user.email) {
      await connection.rollback()
      return response.status(409).json({ message: 'This older archive has no restorable credentials. It was left unchanged.' })
    }
    const [existing] = await connection.execute('SELECT user_id FROM users WHERE email = ? LIMIT 1', [archive.email])
    if (existing[0]) {
      await connection.rollback()
      return response.status(409).json({ message: 'A live account already exists with that email.' })
    }

    const archivedUser = snapshot.user
    await connection.execute(
      `INSERT INTO users (user_id, username, email, phone_no, password, address, Image, admin_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [archive.original_user_id, archivedUser.username, archivedUser.email, archivedUser.phone_no || null,
        archivedUser.password, archivedUser.address || null, archivedUser.Image || null,
        toSqlDateTime(archivedUser.created_at), toSqlDateTime(archivedUser.updated_at)],
    )
    await insertSnapshotRows(connection, 'technician', snapshot.technicians, [
      'technician_id', 'national_id', 'Full_Name', 'Required_Documents', 'Skill_details', 'status', 'user_id', 'created_at', 'updated_at', 'address', 'service_area', 'availability',
    ])
    await insertSnapshotRows(connection, 'posts', snapshot.posts, [
      'post_id', 'Post_detail', 'Image', 'Category', 'Sub-Category', 'service_address', 'building', 'flat_no',
      'user_id', 'created_at', 'updated_at', 'area',
    ])
    await insertSnapshotRows(connection, 'tasks', snapshot.tasks, [
      'task_id', 'task_status', 'price', 'post_id', 'technician_id', 'accepted_at', 'completed_at', 'created_at', 'updated_at',
      'proposed_at', 'customer_schedule_confirmed_at', 'technician_schedule_confirmed_at', 'cancelled_by', 'cancel_reason', 'cancelled_at',
      'agreed_price', 'price_details', 'price_change_proposed', 'price_change_reason', 'price_change_proposed_by',
      'payment_status', 'payment_method', 'customer_paid_confirmed_at', 'technician_paid_confirmed_at', 'paid_at', 'receipt_number',
    ])
    await insertSnapshotRows(connection, 'task_feedback', snapshot.feedback, [
      'feedback_id', 'consumer_rating', 'consumer_feedback', 'technician_rating', 'technician_feedback', 'task_id', 'created_at', 'updated_at',
    ])
    await insertSnapshotRows(connection, 'task_messages', snapshot.messages, ['message_id', 'task_id', 'sender_id', 'body', 'created_at'])
    await insertSnapshotRows(connection, 'task_lifecycle_events', snapshot.events, [
      'event_id', 'task_id', 'actor_id', 'event_type', 'from_status', 'to_status', 'scheduled_for', 'reason', 'created_at',
    ])
    for (const report of snapshot.reports || []) {
      await connection.execute(
        `UPDATE marketplace_reports SET reporter_id = COALESCE(reporter_id, ?),
         target_user_id = COALESCE(target_user_id, ?), task_id = COALESCE(task_id, ?)
         WHERE report_id = ?`,
        [
          Number(report.reporter_id) === Number(archive.original_user_id) ? archive.original_user_id : report.reporter_id,
          Number(report.target_user_id) === Number(archive.original_user_id) ? archive.original_user_id : report.target_user_id,
          report.task_id,
          report.report_id,
        ],
      )
    }
    await insertSnapshotRows(connection, 'notifications', snapshot.notifications, ['notification_id', 'user_id', 'type', 'title', 'message', 'target_type', 'target_id', 'read_at', 'created_at'])
    await insertSnapshotRows(connection, 'admin_user_controls', snapshot.controls, ['user_id', 'status', 'updated_by', 'updated_at'])
    await insertSnapshotRows(connection, 'website_feedback', snapshot.websiteFeedback, ['feedback_id', 'rating', 'feedback', 'user_id', 'created_at'])
    await connection.execute('DELETE FROM archived_users WHERE archive_id = ?', [archive.archive_id])
    await connection.execute(
      'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [request.user.userId, 'user_restored', 'archive', archive.original_user_id, 'Archived account and available history restored.'],
    )
    await connection.commit()
    response.json({ message: 'Archived account and available history restored.', userId: archive.original_user_id })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'Archived data conflicts with a live account or profile.' })
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452) {
      return response.status(409).json({ message: 'Related account or marketplace data is no longer available. The archive was left unchanged.' })
    }
    console.error('Could not restore archived user.', error.message)
    response.status(500).json({ message: 'Could not restore archived user.' })
  } finally {
    connection.release()
  }
})

app.delete('/api/admin/archived-users/:archiveId', authenticate, requireAdmin, async (request, response) => {
  const archiveId = Number(request.params.archiveId)
  if (!Number.isInteger(archiveId) || archiveId < 1) {
    return response.status(400).json({ message: 'A valid archived account is required.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [archives] = await connection.execute(
      'SELECT archive_id, original_user_id FROM archived_users WHERE archive_id = ? LIMIT 1 FOR UPDATE',
      [archiveId],
    )
    const archive = archives[0]
    if (!archive) {
      await connection.rollback()
      return response.status(404).json({ message: 'Archived user not found.' })
    }

    await connection.execute(
      `UPDATE admin_audit_log
       SET details = 'Archived account lifecycle event; personal data removed.'
       WHERE target_id = ? AND ((target_type = 'user' AND action = 'user_archived')
         OR (target_type = 'archive' AND action = 'user_restored'))`,
      [archive.original_user_id],
    )
    await connection.execute('DELETE FROM archived_users WHERE archive_id = ?', [archive.archive_id])
    await connection.execute(
      'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [request.user.userId, 'user_permanently_deleted', 'archived_user', archive.archive_id, 'Archived account and saved personal data permanently deleted.'],
    )
    await connection.commit()
    response.json({ message: 'Archived account and saved data permanently deleted.' })
  } catch (error) {
    await connection.rollback()
    console.error(JSON.stringify({
      level: 'error',
      event: 'archived_user_permanent_delete_failed',
      archiveId,
      requestId: response.getHeader('X-Request-Id') || null,
      code: error.code || null,
    }))
    response.status(500).json({ message: 'Could not permanently delete archived user.' })
  } finally {
    connection.release()
  }
})

app.get('/api/customer/posts', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') {
    return response.status(403).json({ message: 'Only customers can view their requests.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT p.post_id AS id, p.Post_detail AS detail, p.Category AS category,
              p.created_at AS createdAt, p.Image AS image, p.\`Sub-Category\` AS subCategory, p.service_address AS serviceAddress,
              p.building, p.flat_no AS flatNo, p.area, p.closed_at AS closedAt, p.close_reason AS closeReason,
              t.task_id AS taskId, t.price, t.price_details AS priceDetails,
              COALESCE(t.agreed_price, t.price) AS agreedPrice,
              t.price_change_proposed AS priceChangeProposed, t.price_change_reason AS priceChangeReason,
              t.price_change_proposed_by AS priceChangeProposedBy,
              t.task_status AS status, DATE_FORMAT(t.proposed_at, '%Y-%m-%dT%H:%i:%s.000Z') AS proposedAt,
              t.customer_schedule_confirmed_at AS customerScheduleConfirmedAt,
              t.technician_schedule_confirmed_at AS technicianScheduleConfirmedAt,
              t.cancel_reason AS cancelReason, t.cancelled_by AS cancelledBy,
              t.payment_status AS paymentStatus, t.payment_method AS paymentMethod,
              DATE_FORMAT(t.paid_at, '%Y-%m-%dT%H:%i:%s.000Z') AS paidAt,
              t.receipt_number AS receiptNumber, t.customer_paid_confirmed_at AS customerPaidConfirmedAt,
              t.technician_paid_confirmed_at AS technicianPaidConfirmedAt, tech.technician_id AS technicianId,
              CASE WHEN t.task_status IN ('accepted','scheduled','in_progress','completed','cancelled') THEN technician_user.phone_no ELSE NULL END AS technicianPhone,
              tech.Full_Name AS technicianName, tech.Skill_details AS technicianSkills,
              technician_user.Image AS technicianProfileImage,
              tech.status AS technicianStatus,
              (SELECT COUNT(*) FROM tasks completed_tasks
               WHERE completed_tasks.technician_id = tech.technician_id
                 AND completed_tasks.task_status = 'completed') AS technicianCompletedJobs,
              (SELECT ROUND(AVG(reviewed_feedback.consumer_rating), 1)
               FROM tasks reviewed_tasks
               JOIN task_feedback reviewed_feedback ON reviewed_feedback.task_id = reviewed_tasks.task_id
               WHERE reviewed_tasks.technician_id = tech.technician_id) AS technicianAverageRating,
              (SELECT COUNT(DISTINCT reviewed_feedback.feedback_id)
               FROM tasks reviewed_tasks
               JOIN task_feedback reviewed_feedback ON reviewed_feedback.task_id = reviewed_tasks.task_id
               WHERE reviewed_tasks.technician_id = tech.technician_id
                 AND reviewed_feedback.consumer_rating IS NOT NULL) AS technicianReviewCount,
              tf.consumer_rating AS reviewRating, tf.consumer_feedback AS reviewText
       FROM posts p
       LEFT JOIN tasks t ON t.post_id = p.post_id
       LEFT JOIN technician tech ON tech.technician_id = t.technician_id
       LEFT JOIN users technician_user ON technician_user.user_id = tech.user_id
            LEFT JOIN task_feedback tf ON tf.task_id = t.task_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC, t.created_at DESC`,
      [request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load your requests.' })
  }
})

app.get('/api/customer/bids/:taskId/technician', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') {
    return response.status(403).json({ message: 'Only customers can preview technicians who bid on their requests.' })
  }

  try {
    const [technicians] = await pool.execute(
      `SELECT tech.technician_id AS id, tech.Full_Name AS name, tech.Skill_details AS skills,
              tech.service_area AS serviceArea, tech.availability, profile_user.Image AS profileImage,
              (SELECT COUNT(*) FROM tasks completed
               WHERE completed.technician_id = tech.technician_id AND completed.task_status = 'completed') AS completedJobs,
              (SELECT ROUND(AVG(feedback.consumer_rating), 1)
               FROM tasks reviewed JOIN task_feedback feedback ON feedback.task_id = reviewed.task_id
               WHERE reviewed.technician_id = tech.technician_id AND feedback.consumer_rating IS NOT NULL) AS averageRating,
              (SELECT COUNT(*) FROM tasks reviewed
               JOIN task_feedback feedback ON feedback.task_id = reviewed.task_id
               WHERE reviewed.technician_id = tech.technician_id AND feedback.consumer_rating IS NOT NULL) AS reviewCount
       FROM tasks bid
       JOIN posts own_request ON own_request.post_id = bid.post_id
       JOIN technician tech ON tech.technician_id = bid.technician_id
       JOIN users profile_user ON profile_user.user_id = tech.user_id
       WHERE bid.task_id = ? AND own_request.user_id = ?
         AND bid.task_status = 'pending' AND tech.status = 'approved'
       LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    const technician = technicians[0]
    if (!technician) return response.status(404).json({ message: 'Pending technician offer not found.' })

    const [workHistoryRows] = await pool.execute(
      `SELECT p.Category AS category, p.Post_detail AS detail, t.completed_at AS completedAt
       FROM tasks t JOIN posts p ON p.post_id = t.post_id
       WHERE t.technician_id = ? AND t.task_status = 'completed'
       ORDER BY t.completed_at DESC, t.task_id DESC LIMIT 5`,
      [technician.id],
    )
    const workHistory = workHistoryRows.map((job) => ({ ...job, detail: redactPersonalDetails(job.detail) }))
    const [reviewRows] = await pool.execute(
      `SELECT feedback.consumer_rating AS rating, feedback.consumer_feedback AS feedback,
              feedback.created_at AS createdAt
       FROM tasks t JOIN task_feedback feedback ON feedback.task_id = t.task_id
       WHERE t.technician_id = ? AND feedback.consumer_rating IS NOT NULL
       ORDER BY feedback.created_at DESC, feedback.feedback_id DESC LIMIT 5`,
      [technician.id],
    )
    const reviews = reviewRows.map((review) => ({ ...review, feedback: redactPersonalDetails(review.feedback) }))
    response.json({ ...technician, workHistory, reviews })
  } catch (error) {
    response.status(500).json({ message: 'Could not load the technician overview.' })
  }
})

app.post('/api/tasks/:taskId/review', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') {
    return response.status(403).json({ message: 'Only customers can review tasks.' })
  }

  const rating = Number(request.body?.rating)
  const review = typeof request.body?.review === 'string' ? request.body.review.trim() : ''
  const compliments = request.body?.compliments === undefined ? [] : request.body.compliments
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return response.status(400).json({ message: 'Choose a rating from 1 to 5.' })
  }
  if (review.length > 500) return response.status(400).json({ message: 'Review must be 500 characters or fewer.' })
  if (!Array.isArray(compliments) || compliments.length > 5 || compliments.some((compliment) => !reviewCompliments.has(compliment))) {
    return response.status(400).json({ message: 'Choose up to 5 compliments from the suggested list.' })
  }
  const feedback = review || compliments.length
    ? JSON.stringify({ version: 1, review, compliments })
    : null

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
        [rating, feedback, request.params.taskId],
      )
    } else {
      await pool.execute(
        'INSERT INTO task_feedback (consumer_rating, consumer_feedback, task_id) VALUES (?, ?, ?)',
        [rating, feedback, request.params.taskId],
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

  const connection = await pool.getConnection()
  let task
  try {
    await connection.beginTransaction()
    const [tasks] = await connection.execute(
      `SELECT t.task_id, t.post_id, t.technician_id, t.task_status, t.proposed_at, p.Post_detail, p.closed_at, p.service_address
       FROM tasks t JOIN posts p ON p.post_id = t.post_id
       WHERE t.task_id = ? AND p.user_id = ? LIMIT 1 FOR UPDATE`,
      [request.params.taskId, request.user.userId],
    )
    task = tasks[0]
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Bid not found.' })
    }
    if (task.task_status !== 'pending') {
      await connection.rollback()
      return response.status(409).json({ message: 'Only pending bids can be accepted or rejected.' })
    }
    if (status === 'accepted' && task.closed_at) {
      await connection.rollback()
      return response.status(409).json({ message: 'This request has been closed and its offer can no longer be accepted.' })
    }
    if (status === 'accepted' && !task.service_address?.trim()) {
      await connection.rollback()
      return response.status(409).json({ message: 'Add a service address to this request before accepting an offer.' })
    }

    if (status === 'accepted') {
      const [otherBids] = await connection.execute(
        "SELECT task_id FROM tasks WHERE post_id = ? AND task_id != ? AND task_status = 'pending'",
        [task.post_id, task.task_id],
      )
      await connection.execute(
        "UPDATE tasks SET task_status = 'rejected', updated_at = NOW() WHERE post_id = ? AND task_id != ? AND task_status = 'pending'",
        [task.post_id, task.task_id],
      )
      for (const otherBid of otherBids) {
        await recordTaskEvent(connection, otherBid.task_id, request.user.userId, 'rejected', 'pending', 'rejected')
      }
    }
    const acceptedStatus = task.proposed_at ? 'scheduled' : 'accepted'
    await connection.execute(
      `UPDATE tasks SET task_status = ?, agreed_price = CASE WHEN ? = 'accepted' THEN price ELSE agreed_price END,
       accepted_at = CASE WHEN ? = 'accepted' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
       customer_schedule_confirmed_at = CASE WHEN ? = 'accepted' AND proposed_at IS NOT NULL THEN NOW() ELSE customer_schedule_confirmed_at END,
       updated_at = NOW() WHERE task_id = ? AND task_status = 'pending'`,
      [status === 'accepted' ? acceptedStatus : status, status, status, status, task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, status, 'pending', status === 'accepted' ? acceptedStatus : status, task.proposed_at)
    if (status === 'accepted' && task.proposed_at) {
      await recordTaskEvent(connection, task.task_id, request.user.userId, 'scheduled', 'accepted', 'scheduled', task.proposed_at)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not update bid.' })
  } finally {
    connection.release()
  }

  try {
    const [technicians] = await pool.execute('SELECT user_id FROM technician WHERE technician_id = ?', [task.technician_id])
    if (technicians[0]) {
      await createNotification(
        technicians[0].user_id,
        status === 'accepted' ? 'bid_accepted' : 'bid_rejected',
        status === 'accepted' ? 'Bid accepted' : 'Bid not selected',
        `Your bid was ${status === 'accepted' ? 'accepted' : 'not selected'} for: ${task.Post_detail}`,
        'task',
        task.task_id,
      )
    }
  } catch (error) {
    console.error('Could not create bid decision notification.', error.message)
  }
  response.json({ message: `Bid ${status}.` })
})

async function findTaskParticipant(connection, taskId, userId) {
  const [rows] = await connection.execute(
    `SELECT t.*, DATE_FORMAT(t.proposed_at, '%Y-%m-%dT%H:%i:%s.000Z') AS proposedAtIso,
            p.user_id AS customerId, tech.user_id AS technicianUserId, p.Post_detail AS detail
     FROM tasks t JOIN posts p ON p.post_id = t.post_id
     JOIN technician tech ON tech.technician_id = t.technician_id
     WHERE t.task_id = ? AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1 FOR UPDATE`,
    [taskId, userId, userId],
  )
  const task = rows[0]
  if (!task) return null
  task.actorRole = Number(task.customerId) === Number(userId) ? 'customer' : 'technician'
  task.otherUserId = task.actorRole === 'customer' ? task.technicianUserId : task.customerId
  return task
}

app.post('/api/tasks/:taskId/price-change', authenticate, async (request, response) => {
  const proposedPrice = Number(request.body?.proposedPrice)
  const reason = sanitizeText(request.body?.reason, 500)
  if (!Number.isFinite(proposedPrice) || proposedPrice <= 0 || proposedPrice > 99999999.99
    || Math.abs(proposedPrice * 100 - Math.round(proposedPrice * 100)) > 1e-8) {
    return response.status(400).json({ message: 'Enter a positive price with at most two decimal places.' })
  }
  if (reason.length < 5 || (typeof request.body?.reason === 'string' && request.body.reason.trim().length > 450)) {
    return response.status(400).json({ message: 'Explain the price change in 5 to 450 characters.' })
  }

  const connection = await pool.getConnection()
  let task
  try {
    await connection.beginTransaction()
    task = await findTaskParticipant(connection, request.params.taskId, request.user.userId)
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Task not found.' })
    }
    if (!['accepted', 'scheduled', 'in_progress'].includes(task.task_status)) {
      await connection.rollback()
      return response.status(409).json({ message: 'Agreed prices can only be changed before the task is completed or cancelled.' })
    }
    if (task.price_change_proposed !== null) {
      await connection.rollback()
      return response.status(409).json({ message: 'A price change is already waiting for a decision.' })
    }
    if (Number(task.agreed_price ?? task.price) === proposedPrice) {
      await connection.rollback()
      return response.status(400).json({ message: 'The proposed price must differ from the current agreed price.' })
    }
    await connection.execute(
      'UPDATE tasks SET price_change_proposed = ?, price_change_reason = ?, price_change_proposed_by = ?, updated_at = NOW() WHERE task_id = ?',
      [proposedPrice, reason, request.user.userId, task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, 'price_change_proposed', task.task_status, task.task_status, null, `Proposed ৳${proposedPrice.toFixed(2)}: ${reason}`)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not propose a price change.' })
  } finally {
    connection.release()
  }

  try {
    await createNotification(task.otherUserId, 'price_change', 'Price change proposed', `A new agreed price was proposed for: ${task.detail}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not create price-change notification.', error.message)
  }
  response.json({ message: 'Price change proposed. The other participant must approve it before the agreed price changes.' })
})

app.post('/api/tasks/:taskId/price-change/decision', authenticate, async (request, response) => {
  const accept = request.body?.accept
  if (typeof accept !== 'boolean') return response.status(400).json({ message: 'Choose whether to accept the proposed price change.' })
  const connection = await pool.getConnection()
  let task
  try {
    await connection.beginTransaction()
    task = await findTaskParticipant(connection, request.params.taskId, request.user.userId)
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Task not found.' })
    }
    if (task.price_change_proposed === null || Number(task.price_change_proposed_by) === Number(request.user.userId)) {
      await connection.rollback()
      return response.status(409).json({ message: 'There is no price change waiting for your decision.' })
    }
    if (!['accepted', 'scheduled', 'in_progress'].includes(task.task_status)) {
      await connection.rollback()
      return response.status(409).json({ message: 'This task can no longer change its agreed price.' })
    }
    const eventType = accept ? 'price_change_accepted' : 'price_change_declined'
    if (accept) {
      await connection.execute(
        'UPDATE tasks SET agreed_price = price_change_proposed, price_change_proposed = NULL, price_change_reason = NULL, price_change_proposed_by = NULL, updated_at = NOW() WHERE task_id = ?',
        [task.task_id],
      )
    } else {
      await connection.execute(
        'UPDATE tasks SET price_change_proposed = NULL, price_change_reason = NULL, price_change_proposed_by = NULL, updated_at = NOW() WHERE task_id = ?',
        [task.task_id],
      )
    }
    await recordTaskEvent(connection, task.task_id, request.user.userId, eventType, task.task_status, task.task_status, null, `৳${Number(task.price_change_proposed).toFixed(2)}: ${task.price_change_reason}`)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not record your price decision.' })
  } finally {
    connection.release()
  }

  try {
    await createNotification(task.price_change_proposed_by, accept ? 'price_change_accepted' : 'price_change_declined', accept ? 'Price change accepted' : 'Price change declined', `${accept ? 'The proposed price change was accepted' : 'The proposed price change was declined'} for: ${task.detail}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not notify proposer about the price decision.', error.message)
  }
  response.json({ message: accept ? 'New agreed price saved.' : 'Price change declined. The existing agreed price remains.' })
})

app.post('/api/tasks/:taskId/schedule', authenticate, async (request, response) => {
  const proposedAt = normalizeFutureDateTime(request.body?.proposedAt)
  const reason = sanitizeText(request.body?.reason, 500)
  if (!proposedAt) return response.status(400).json({ message: 'Choose a new appointment date and time in the future.' })
  if (reason.length < 5) return response.status(400).json({ message: 'Explain the schedule change in at least 5 characters.' })
  const connection = await pool.getConnection()
  let task
  try {
    await connection.beginTransaction()
    task = await findTaskParticipant(connection, request.params.taskId, request.user.userId)
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Task not found.' })
    }
    if (!['accepted', 'scheduled'].includes(task.task_status)) {
      await connection.rollback()
      return response.status(409).json({ message: 'Appointments can only be changed before work starts.' })
    }
    const [scheduleRows] = await connection.execute('SELECT availability_schedule FROM technician WHERE technician_id = ? LIMIT 1', [task.technician_id])
    const outsideHours = scheduleViolation(scheduleRows[0]?.availability_schedule, proposedAt)
    if (outsideHours) {
      await connection.rollback()
      return response.status(409).json({ message: outsideHours })
    }
    const customerConfirmed = task.actorRole === 'customer' ? new Date() : null
    const technicianConfirmed = task.actorRole === 'technician' ? new Date() : null
    await connection.execute(
      `UPDATE tasks SET task_status = 'accepted', proposed_at = ?,
       customer_schedule_confirmed_at = ?, technician_schedule_confirmed_at = ?, updated_at = NOW()
       WHERE task_id = ?`,
      [proposedAt, customerConfirmed, technicianConfirmed, task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, 'schedule_proposed', task.task_status, 'accepted', proposedAt, reason)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not propose a new appointment.' })
  } finally {
    connection.release()
  }
  try {
    await createNotification(task.otherUserId, 'schedule_change', 'Appointment change proposed', `A new time was proposed for: ${task.detail}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not create appointment notification.', error.message)
  }
  response.json({ message: 'New appointment proposed. The other person must confirm it.' })
})

app.post('/api/tasks/:taskId/schedule/confirm', authenticate, async (request, response) => {
  const connection = await pool.getConnection()
  let task
  let scheduled = false
  try {
    await connection.beginTransaction()
    task = await findTaskParticipant(connection, request.params.taskId, request.user.userId)
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Task not found.' })
    }
    if (task.task_status !== 'accepted' || !task.proposed_at) {
      await connection.rollback()
      return response.status(409).json({ message: 'There is no appointment waiting for confirmation.' })
    }
    if (new Date(task.proposedAtIso).getTime() <= Date.now()) {
      await connection.rollback()
      return response.status(409).json({ message: 'This proposed time has passed. Propose a new appointment.' })
    }
    const actorColumn = task.actorRole === 'customer' ? 'customer_schedule_confirmed_at' : 'technician_schedule_confirmed_at'
    const otherColumn = task.actorRole === 'customer' ? 'technician_schedule_confirmed_at' : 'customer_schedule_confirmed_at'
    scheduled = Boolean(task[otherColumn])
    await connection.execute(
      `UPDATE tasks SET ${actorColumn} = NOW(), task_status = ?, updated_at = NOW() WHERE task_id = ?`,
      [scheduled ? 'scheduled' : 'accepted', task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, 'schedule_confirmed', 'accepted', scheduled ? 'scheduled' : 'accepted', task.proposed_at)
    if (scheduled) {
      await recordTaskEvent(connection, task.task_id, request.user.userId, 'scheduled', 'accepted', 'scheduled', task.proposed_at)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not confirm the appointment.' })
  } finally {
    connection.release()
  }
  try {
    await createNotification(task.otherUserId, 'schedule_confirmed', scheduled ? 'Appointment confirmed' : 'Appointment confirmation received', `${scheduled ? 'The appointment is confirmed' : 'The other participant confirmed the appointment'} for: ${task.detail}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not create appointment notification.', error.message)
  }
  response.json({ message: scheduled ? 'Appointment confirmed by both sides.' : 'Your confirmation is saved.' })
})

app.post('/api/tasks/:taskId/cancel', authenticate, async (request, response) => {
  const reason = sanitizeText(request.body?.reason, 500)
  if (reason.length < 5) return response.status(400).json({ message: 'Provide a cancellation reason of at least 5 characters.' })
  const connection = await pool.getConnection()
  let task
  try {
    await connection.beginTransaction()
    task = await findTaskParticipant(connection, request.params.taskId, request.user.userId)
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Task not found.' })
    }
    if (!['accepted', 'scheduled', 'in_progress'].includes(task.task_status)) {
      await connection.rollback()
      return response.status(409).json({ message: 'This task can no longer be cancelled.' })
    }
    await connection.execute(
      "UPDATE tasks SET task_status = 'cancelled', cancelled_by = ?, cancel_reason = ?, cancelled_at = NOW(), updated_at = NOW() WHERE task_id = ?",
      [request.user.userId, reason, task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, 'cancelled', task.task_status, 'cancelled', task.proposed_at, reason)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not cancel this task.' })
  } finally {
    connection.release()
  }
  try {
    await createNotification(task.otherUserId, 'task_cancelled', 'Task cancelled', `The task was cancelled: ${task.detail}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not create cancellation notification.', error.message)
  }
  response.json({ message: 'Task cancelled and reason recorded.' })
})

app.post('/api/tasks/:taskId/payment/confirm', authenticate, async (request, response) => {
  const paymentMethod = request.body?.paymentMethod
  if (!['cash', 'bank_transfer', 'other'].includes(paymentMethod)) {
    return response.status(400).json({ message: 'Choose cash, bank transfer, or other as the payment method.' })
  }
  const connection = await pool.getConnection()
  let task
  let paid = false
  try {
    await connection.beginTransaction()
    task = await findTaskParticipant(connection, request.params.taskId, request.user.userId)
    if (!task) {
      await connection.rollback()
      return response.status(404).json({ message: 'Task not found.' })
    }
    if (task.task_status !== 'completed') {
      await connection.rollback()
      return response.status(409).json({ message: 'Payment can be recorded after the task is completed.' })
    }
    if (task.payment_status === 'paid') {
      await connection.rollback()
      return response.status(409).json({ message: 'Payment is already confirmed by both sides.' })
    }
    if (task.payment_method && task.payment_method !== paymentMethod) {
      await connection.rollback()
      return response.status(409).json({ message: 'Both sides must confirm the same payment method.' })
    }
    const ownColumn = task.actorRole === 'customer' ? 'customer_paid_confirmed_at' : 'technician_paid_confirmed_at'
    const otherColumn = task.actorRole === 'customer' ? 'technician_paid_confirmed_at' : 'customer_paid_confirmed_at'
    paid = Boolean(task[otherColumn])
    const receiptNumber = paid ? `HL-${task.task_id}` : null
    await connection.execute(
      `UPDATE tasks SET ${ownColumn} = COALESCE(${ownColumn}, NOW()), payment_method = ?,
       payment_status = ?, paid_at = ${paid ? 'NOW()' : 'NULL'}, receipt_number = ?, updated_at = NOW()
       WHERE task_id = ?`,
      [paymentMethod, paid ? 'paid' : 'unpaid', receiptNumber, task.task_id],
    )
    await recordTaskEvent(connection, task.task_id, request.user.userId, 'payment_confirmed', 'completed', 'completed', null, paid ? 'Payment confirmed by both sides' : 'Payment confirmation recorded')
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    return response.status(500).json({ message: 'Could not record payment confirmation.' })
  } finally {
    connection.release()
  }
  try {
    await createNotification(task.otherUserId, 'payment_confirmation', paid ? 'Payment record completed' : 'Payment confirmation needed', `${paid ? 'Both sides confirmed payment' : 'A payment confirmation was recorded'} for task ${task.task_id}`, 'task', task.task_id)
  } catch (error) {
    console.error('Could not create payment notification.', error.message)
  }
  response.json({
    message: paid ? 'Both sides confirmed payment. Receipt is ready.' : 'Your payment confirmation is saved; waiting for the other side.',
    paymentStatus: paid ? 'paid' : 'unpaid',
    receiptNumber: paid ? `HL-${task.task_id}` : null,
    agreedPrice: task.agreed_price || task.price,
  })
})

app.get('/api/areas', (_request, response) => {
  response.json({ city: SERVICE_CITY, areas: SERVICE_AREAS })
})

app.get('/api/saved-addresses', authenticate, async (request, response) => {
  try {
    const [rows] = await pool.execute(
      'SELECT address_id AS id, label, service_address AS serviceAddress, building, flat_no AS flatNo, area FROM saved_addresses WHERE user_id = ? ORDER BY created_at DESC',
      [request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load saved addresses.' })
  }
})

app.post('/api/saved-addresses', authenticate, async (request, response) => {
  const label = sanitizeText(request.body?.label, 60)
  const serviceAddress = sanitizeText(request.body?.serviceAddress, 500)
  const building = sanitizeText(request.body?.building, 150)
  const flatNo = sanitizeText(request.body?.flatNo, 100)
  const area = serviceAreaLookup.get(String(request.body?.area || '').trim().toLowerCase()) || null
  if (!label || serviceAddress.length < 5) return response.status(400).json({ message: 'Give the address a name and enter at least 5 characters.' })
  try {
    const [count] = await pool.execute('SELECT COUNT(*) AS total FROM saved_addresses WHERE user_id = ?', [request.user.userId])
    if (Number(count[0].total) >= 5) return response.status(409).json({ message: 'You can save up to 5 addresses. Remove one first.' })
    await pool.execute(
      'INSERT INTO saved_addresses (user_id, label, service_address, building, flat_no, area) VALUES (?, ?, ?, ?, ?, ?)',
      [request.user.userId, label, serviceAddress, building || null, flatNo || null, area],
    )
    response.status(201).json({ message: 'Address saved.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not save this address.' })
  }
})

app.delete('/api/saved-addresses/:addressId', authenticate, async (request, response) => {
  try {
    await pool.execute('DELETE FROM saved_addresses WHERE address_id = ? AND user_id = ?', [request.params.addressId, request.user.userId])
    response.json({ message: 'Address removed.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not remove this address.' })
  }
})

app.post('/api/favorites', authenticate, async (request, response) => {
  if (request.user.role !== 'customer') return response.status(403).json({ message: 'Only customers can save favourite technicians.' })
  const technicianId = Number(request.body?.technicianId)
  if (!Number.isInteger(technicianId) || technicianId < 1) return response.status(400).json({ message: 'Choose a technician.' })
  try {
    const [rows] = await pool.execute("SELECT technician_id FROM technician WHERE technician_id = ? AND status = 'approved' LIMIT 1", [technicianId])
    if (!rows[0]) return response.status(404).json({ message: 'Technician not found.' })
    await pool.execute('INSERT IGNORE INTO favorite_technicians (customer_id, technician_id) VALUES (?, ?)', [request.user.userId, technicianId])
    response.status(201).json({ message: 'Added to your favourites.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not save this favourite.' })
  }
})

app.delete('/api/favorites/:technicianId', authenticate, async (request, response) => {
  try {
    await pool.execute('DELETE FROM favorite_technicians WHERE customer_id = ? AND technician_id = ?', [request.user.userId, request.params.technicianId])
    response.json({ message: 'Removed from your favourites.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not remove this favourite.' })
  }
})

app.post('/api/tasks/:taskId/running-late', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Only the technician can send a running-late notice.' })
  const minutes = Number(request.body?.minutes)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) return response.status(400).json({ message: 'Choose a delay between 5 and 240 minutes.' })
  try {
    const [rows] = await pool.execute(
      `SELECT t.task_id, t.task_status, p.user_id AS customerId, p.Post_detail
       FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND tech.user_id = ? LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    const task = rows[0]
    if (!task) return response.status(404).json({ message: 'Task not found.' })
    if (!['accepted', 'scheduled'].includes(task.task_status)) return response.status(409).json({ message: 'You can send a running-late notice before the job starts.' })
    await recordTaskEvent(pool, task.task_id, request.user.userId, 'running_late', task.task_status, task.task_status, null, `Technician is running about ${minutes} minutes late`)
    await createNotification(task.customerId, 'running_late', 'Your technician is running late', `Your technician expects to arrive about ${minutes} minutes later than planned for: ${redactPersonalDetails(task.Post_detail)}`, 'task', task.task_id)
    response.json({ message: `The customer has been told you are about ${minutes} minutes late.` })
  } catch (error) {
    response.status(500).json({ message: 'Could not send the notice.' })
  }
})

const scheduleDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

app.get('/api/technician/availability', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  try {
    const [rows] = await pool.execute('SELECT availability_schedule AS schedule, request_alerts AS alerts FROM technician WHERE user_id = ? LIMIT 1', [request.user.userId])
    let schedule = null
    try { schedule = rows[0]?.schedule ? JSON.parse(rows[0].schedule) : null } catch (error) { schedule = null }
    response.json({ schedule, alerts: rows[0] ? Boolean(rows[0].alerts) : true })
  } catch (error) {
    response.status(500).json({ message: 'Could not load your availability.' })
  }
})

app.put('/api/technician/availability', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Technician access required.' })
  const input = request.body?.schedule
  if (!input || typeof input !== 'object') return response.status(400).json({ message: 'Send a weekly schedule.' })
  const schedule = {}
  for (const day of scheduleDays) {
    const entry = input[day] || {}
    const enabled = Boolean(entry.enabled)
    const start = String(entry.start || '09:00')
    const end = String(entry.end || '18:00')
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return response.status(400).json({ message: 'Use valid times.' })
    if (enabled && start >= end) return response.status(400).json({ message: 'Finish time must be after start time.' })
    schedule[day] = { enabled, start, end }
  }
  const summary = summarizeSchedule(schedule) || 'Not currently available'
  try {
    const [result] = await pool.execute(
      'UPDATE technician SET availability_schedule = ?, availability = ?, request_alerts = ?, updated_at = NOW() WHERE user_id = ?',
      [JSON.stringify(schedule), summary, request.body?.alerts === false ? 0 : 1, request.user.userId],
    )
    if (!result.affectedRows) return response.status(404).json({ message: 'Technician profile not found.' })
    response.json({ message: 'Availability saved.', summary })
  } catch (error) {
    response.status(500).json({ message: 'Could not save your availability.' })
  }
})

const WARRANTY_DAYS = 7

app.post('/api/tasks/:taskId/customer-review', authenticate, async (request, response) => {
  if (request.user.role !== 'technician') return response.status(403).json({ message: 'Only technicians can review customers.' })
  const rating = Number(request.body?.rating)
  const comment = sanitizeText(request.body?.comment, 500)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response.status(400).json({ message: 'Choose a rating from 1 to 5.' })
  try {
    const [rows] = await pool.execute(
      `SELECT t.task_id, p.user_id AS customerId FROM tasks t
       JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND tech.user_id = ? AND t.task_status = 'completed' LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    if (!rows[0]) return response.status(404).json({ message: 'Only your completed jobs can be reviewed.' })
    await pool.execute(
      `INSERT INTO customer_reviews (task_id, reviewer_id, customer_id, rating, comment) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
      [rows[0].task_id, request.user.userId, rows[0].customerId, rating, comment || null],
    )
    response.json({ message: 'Customer review saved.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not save the review.' })
  }
})

app.get('/api/tasks/:taskId/customer-review', authenticate, async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT cr.rating, cr.comment FROM customer_reviews cr JOIN tasks t ON t.task_id = cr.task_id
       JOIN technician tech ON tech.technician_id = t.technician_id WHERE cr.task_id = ? AND tech.user_id = ? LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    response.json(rows[0] || null)
  } catch (error) {
    response.status(500).json({ message: 'Could not load the review.' })
  }
})

app.get('/api/blocks', authenticate, async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.blocked_id AS userId, u.username AS name, b.created_at AS createdAt
       FROM user_blocks b JOIN users u ON u.user_id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      [request.user.userId],
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load blocked users.' })
  }
})

app.post('/api/blocks', authenticate, async (request, response) => {
  const blockedId = Number(request.body?.userId)
  if (!Number.isInteger(blockedId) || blockedId < 1 || blockedId === Number(request.user.userId)) {
    return response.status(400).json({ message: 'Choose another user to block.' })
  }
  try {
    const [users] = await pool.execute('SELECT user_id, admin_id FROM users WHERE user_id = ? LIMIT 1', [blockedId])
    if (!users[0] || users[0].admin_id) return response.status(404).json({ message: 'User not found.' })
    await pool.execute('INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)', [request.user.userId, blockedId])
    response.status(201).json({ message: 'User blocked. You will not see each other in new requests or messages.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not block this user.' })
  }
})

app.delete('/api/blocks/:userId', authenticate, async (request, response) => {
  try {
    await pool.execute('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [request.user.userId, request.params.userId])
    response.json({ message: 'User unblocked.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not unblock this user.' })
  }
})

app.get('/api/tasks/:taskId/warranty', authenticate, async (request, response) => {
  try {
    const [tasks] = await pool.execute(
      `SELECT t.task_id, t.task_status, t.completed_at, p.user_id AS customerId, tech.user_id AS technicianUserId
       FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1`,
      [request.params.taskId, request.user.userId, request.user.userId],
    )
    const task = tasks[0]
    if (!task) return response.status(404).json({ message: 'Task not found.' })
    const [claims] = await pool.execute(
      `SELECT claim_id AS id, description, status, response_note AS responseNote, created_at AS createdAt, responded_at AS respondedAt
       FROM warranty_claims WHERE task_id = ? ORDER BY created_at DESC`,
      [task.task_id],
    )
    const completedAt = task.completed_at ? new Date(task.completed_at) : null
    const expiresAt = completedAt ? new Date(completedAt.getTime() + WARRANTY_DAYS * 86400000) : null
    response.json({
      claims,
      windowDays: WARRANTY_DAYS,
      expiresAt,
      canClaim: Number(task.customerId) === Number(request.user.userId) && task.task_status === 'completed'
        && Boolean(expiresAt) && expiresAt > new Date() && !claims.some((claim) => claim.status === 'open'),
    })
  } catch (error) {
    response.status(500).json({ message: 'Could not load warranty claims.' })
  }
})

app.post('/api/tasks/:taskId/warranty', authenticate, async (request, response) => {
  const description = sanitizeText(request.body?.description, 1000)
  if (description.length < 10) return response.status(400).json({ message: 'Describe the problem in at least 10 characters.' })
  try {
    const [tasks] = await pool.execute(
      `SELECT t.task_id, t.completed_at, tech.user_id AS technicianUserId, p.Post_detail
       FROM tasks t JOIN posts p ON p.post_id = t.post_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND p.user_id = ? AND t.task_status = 'completed' LIMIT 1`,
      [request.params.taskId, request.user.userId],
    )
    const task = tasks[0]
    if (!task) return response.status(404).json({ message: 'Only completed jobs you requested can have a warranty claim.' })
    if (!task.completed_at || new Date(task.completed_at).getTime() + WARRANTY_DAYS * 86400000 < Date.now()) {
      return response.status(409).json({ message: `The ${WARRANTY_DAYS}-day problem window for this job has closed. You can still report a dispute.` })
    }
    const [open] = await pool.execute("SELECT claim_id FROM warranty_claims WHERE task_id = ? AND status = 'open' LIMIT 1", [task.task_id])
    if (open[0]) return response.status(409).json({ message: 'You already have an open claim for this job.' })
    await pool.execute('INSERT INTO warranty_claims (task_id, customer_id, description) VALUES (?, ?, ?)', [task.task_id, request.user.userId, description])
    try {
      await createNotification(task.technicianUserId, 'warranty_claim', 'Problem reported on a finished job', `A customer reported a problem with: ${redactPersonalDetails(task.Post_detail)}`, 'task', task.task_id)
    } catch (error) {
      console.error('Could not notify technician about warranty claim.', error.message)
    }
    response.status(201).json({ message: 'Problem reported. The technician has been notified.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not submit the claim.' })
  }
})

app.patch('/api/warranty/:claimId', authenticate, async (request, response) => {
  const status = request.body?.status
  const note = sanitizeText(request.body?.note, 500)
  if (!['accepted', 'declined', 'resolved'].includes(status)) return response.status(400).json({ message: 'Choose accepted, declined, or resolved.' })
  if (note.length < 5) return response.status(400).json({ message: 'Add a note of at least 5 characters.' })
  try {
    const [rows] = await pool.execute(
      `SELECT w.claim_id, w.task_id, w.status, w.customer_id FROM warranty_claims w
       JOIN tasks t ON t.task_id = w.task_id JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE w.claim_id = ? AND tech.user_id = ? LIMIT 1`,
      [request.params.claimId, request.user.userId],
    )
    const claim = rows[0]
    if (!claim) return response.status(404).json({ message: 'Claim not found.' })
    const allowed = { open: ['accepted', 'declined'], accepted: ['resolved'] }
    if (!(allowed[claim.status] || []).includes(status)) return response.status(409).json({ message: `A ${claim.status} claim cannot be marked ${status}.` })
    await pool.execute('UPDATE warranty_claims SET status = ?, response_note = ?, responded_at = NOW() WHERE claim_id = ?', [status, note, claim.claim_id])
    try {
      await createNotification(claim.customer_id, 'warranty_update', 'Update on your reported problem', `The technician marked your claim ${status}: ${note}`, 'task', claim.task_id)
    } catch (error) {
      console.error('Could not notify customer about warranty update.', error.message)
    }
    response.json({ message: `Claim marked ${status}.` })
  } catch (error) {
    response.status(500).json({ message: 'Could not update the claim.' })
  }
})

app.post('/api/reports', authenticate, async (request, response) => {
  const reportType = request.body?.reportType
  const category = sanitizeText(request.body?.category, 60)
  const description = sanitizeText(request.body?.description, 1000)
  const taskId = Number(request.body?.taskId) || null
  const messageId = Number(request.body?.messageId) || null
  const technicianId = Number(request.body?.technicianId) || null
  if (!['dispute', 'profile', 'message', 'task'].includes(reportType)
    || category.length < 3 || description.length < 10) {
    return response.status(400).json({ message: 'Choose a report type and provide a category and details of at least 10 characters.' })
  }
  let targetUserId = null
  let taskDetail = null
  let reportedContent = null
  if (reportType === 'profile') {
    if (!technicianId) return response.status(400).json({ message: 'Choose a technician profile to report.' })
    try {
      const [target] = await pool.execute(
        "SELECT user_id FROM technician WHERE technician_id = ? AND status = 'approved' LIMIT 1",
        [technicianId],
      )
      if (!target[0] || Number(target[0].user_id) === Number(request.user.userId)) return response.status(404).json({ message: 'Technician profile not found.' })
      targetUserId = target[0].user_id
    } catch (error) {
      return response.status(500).json({ message: 'Could not verify the reported profile.' })
    }
  } else {
    const connection = await pool.getConnection()
    try {
      const task = await findTaskParticipant(connection, taskId, request.user.userId)
      if (!task) return response.status(404).json({ message: 'Task not found.' })
      taskDetail = task.detail
      if (messageId) {
        const [messageRows] = await connection.execute(
          'SELECT sender_id, body FROM task_messages WHERE message_id = ? AND task_id = ? LIMIT 1',
          [messageId, task.task_id],
        )
        if (!messageRows[0] || Number(messageRows[0].sender_id) === Number(request.user.userId)) {
          return response.status(404).json({ message: 'Reportable message not found.' })
        }
        targetUserId = messageRows[0].sender_id
        reportedContent = messageRows[0].body
      } else {
        targetUserId = task.otherUserId
      }
    } catch (error) {
      return response.status(500).json({ message: 'Could not validate this report.' })
    } finally {
      connection.release()
    }
  }
  let evidencePath = null
  if (request.body?.evidenceImage) {
    const evidence = decodeImageDataUrl(request.body.evidenceImage)
    if (!evidence || evidence.error) return response.status(400).json({ message: evidence?.error || 'Evidence must be a JPG, PNG or WebP image.' })
    try {
      const uploadDirectory = resolve(process.cwd(), '../uploads')
      await mkdir(uploadDirectory, { recursive: true })
      const fileName = `evidence_${randomUUID()}.${evidence.extension}`
      await writeFile(resolve(uploadDirectory, fileName), evidence.buffer)
      evidencePath = `uploads/${fileName}`
    } catch (error) {
      return response.status(500).json({ message: 'Could not save the evidence image.' })
    }
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO marketplace_reports (reporter_id, task_id, target_user_id, message_id, report_type, category, description, task_detail, reported_content, evidence_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [request.user.userId, taskId, targetUserId, messageId, reportType, category, description, taskDetail, reportedContent, evidencePath],
    )
    response.status(201).json({ id: result.insertId, message: 'Report submitted to the safety team.' })
  } catch (error) {
    response.status(500).json({ message: 'Could not submit report.' })
  }
})

app.get('/api/admin/reports', authenticate, requireAdmin, async (_request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.report_id AS id, r.report_type AS reportType, r.category, r.description, r.status,
              r.resolution_note AS resolutionNote, r.evidence_image AS evidenceImage, r.outcome, r.created_at AS createdAt, r.reviewed_at AS reviewedAt,
              reporter.username AS reporterName, target.username AS targetName,
              r.task_id AS taskId, COALESCE(r.task_detail, p.Post_detail) AS taskDetail,
              COALESCE(r.reported_content, message.body) AS reportedMessage
       FROM marketplace_reports r
       LEFT JOIN users reporter ON reporter.user_id = r.reporter_id
       LEFT JOIN users target ON target.user_id = r.target_user_id
       LEFT JOIN tasks t ON t.task_id = r.task_id
       LEFT JOIN posts p ON p.post_id = t.post_id
       LEFT JOIN task_messages message ON message.message_id = r.message_id
       ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC LIMIT 100`,
    )
    response.json(rows)
  } catch (error) {
    response.status(500).json({ message: 'Could not load reports and disputes.' })
  }
})

app.patch('/api/admin/reports/:reportId', authenticate, requireAdmin, async (request, response) => {
  const status = request.body?.status
  const resolutionNote = sanitizeText(request.body?.resolutionNote, 500)
  const outcome = request.body?.outcome || 'none'
  if (!['reviewing', 'resolved', 'dismissed'].includes(status)) {
    return response.status(400).json({ message: 'Choose reviewing, resolved, or dismissed.' })
  }
  if (!['none', 'warning', 'technician_suspended'].includes(outcome)) {
    return response.status(400).json({ message: 'Choose a valid outcome.' })
  }
  if (['resolved', 'dismissed'].includes(status) && resolutionNote.length < 5) {
    return response.status(400).json({ message: 'Add a resolution note of at least 5 characters.' })
  }
  if (outcome !== 'none' && status !== 'resolved') {
    return response.status(400).json({ message: 'An outcome can only be applied when resolving a report.' })
  }
  try {
    const [reports] = await pool.execute('SELECT report_id, target_user_id, status FROM marketplace_reports WHERE report_id = ? LIMIT 1', [request.params.reportId])
    const report = reports[0]
    if (!report) return response.status(404).json({ message: 'Report not found.' })
    if (['resolved', 'dismissed'].includes(report.status)) return response.status(409).json({ message: 'This report is already closed.' })
    let outcomeNote = ''
    if (outcome === 'technician_suspended') {
      const [techs] = await pool.execute('SELECT technician_id, status FROM technician WHERE user_id = ? LIMIT 1', [report.target_user_id])
      if (!techs[0]) return response.status(400).json({ message: 'The reported user is not a technician, so they cannot be suspended.' })
      if (techs[0].status === 'approved') {
        await pool.execute("UPDATE technician SET status = 'suspended', updated_at = NOW() WHERE technician_id = ?", [techs[0].technician_id])
        await createAudit(request.user.userId, 'technician_suspended', 'technician', techs[0].technician_id, `Suspended after report ${report.report_id}: ${resolutionNote}`)
        outcomeNote = ' Technician suspended.'
      }
    }
    await pool.execute(
      'UPDATE marketplace_reports SET status = ?, resolution_note = ?, outcome = ?, reviewed_by = ?, reviewed_at = NOW() WHERE report_id = ?',
      [status, resolutionNote || null, outcome, request.user.userId, report.report_id],
    )
    await createAudit(request.user.userId, 'marketplace_report_updated', 'report', Number(report.report_id), `Report marked ${status}${outcome !== 'none' ? ` (${outcome})` : ''}.`)
    if (outcome !== 'none' && report.target_user_id) {
      try {
        await createNotification(report.target_user_id, 'report_outcome', outcome === 'warning' ? 'Warning from HelpLagbe' : 'Your technician account was suspended', `A report about your account was reviewed. ${resolutionNote}`)
      } catch (error) {
        console.error('Could not notify reported user.', error.message)
      }
    }
    response.json({ message: `Report updated.${outcomeNote}` })
  } catch (error) {
    response.status(500).json({ message: 'Could not update report.' })
  }
})

app.get('/api/tasks/:taskId/timeline', authenticate, async (request, response) => {
  try {
    const [access] = await pool.execute(
      `SELECT t.task_id FROM tasks t JOIN posts p ON p.post_id = t.post_id
       JOIN technician tech ON tech.technician_id = t.technician_id
       WHERE t.task_id = ? AND (p.user_id = ? OR tech.user_id = ?) LIMIT 1`,
      [request.params.taskId, request.user.userId, request.user.userId],
    )
    if (!access[0]) return response.status(404).json({ message: 'Task not found.' })
    const [events] = await pool.execute(
      `SELECT e.event_id AS id, e.event_type AS type, e.from_status AS fromStatus, e.to_status AS toStatus,
              DATE_FORMAT(e.scheduled_for, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledFor,
              e.reason, e.created_at AS createdAt, u.username AS actorName
       FROM task_lifecycle_events e LEFT JOIN users u ON u.user_id = e.actor_id
       WHERE e.task_id = ? ORDER BY e.created_at ASC, e.event_id ASC`,
      [request.params.taskId],
    )
    response.json(events)
  } catch (error) {
    response.status(500).json({ message: 'Could not load the task timeline.' })
  }
})

app.post('/api/auth/register', async (request, response) => {
  const body = request.body && typeof request.body === 'object' ? request.body : {}
  const username = sanitizeText(body.username, 100)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = sanitizeText(body.phone, 30)
  const password = body.password
  const address = sanitizeText(body.address, 500)

  if (!username || !email || !password) {
    return response.status(400).json({ message: 'Name, email, and password are required.' })
  }
  if (username.length < 2 || (typeof body.username === 'string' && body.username.trim().length > 100)) {
    return response.status(400).json({ message: 'Name must be between 2 and 100 characters.' })
  }
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: 'Enter a valid email address.' })
  }
  if (!isValidPassword(password)) {
    return response.status(400).json({ message: 'Password must be at least 8 characters and include letters and numbers.' })
  }
  if (phone && !/^[+0-9()\-\s]{7,20}$/.test(phone)) {
    return response.status(400).json({ message: 'Enter a valid phone number.' })
  }
  if (typeof body.address === 'string' && body.address.length > 500) {
    return response.status(400).json({ message: 'Address must be 500 characters or fewer.' })
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const userId = await nextGeneratedId(pool, 'helplagbe_users_user_id_seq')
    const [result] = await pool.execute(
      userId
        ? 'INSERT INTO users (user_id, username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)',
      userId
        ? [userId, username, email, phone || null, passwordHash, address || null]
        : [username, email, phone || null, passwordHash, address || null],
    )

    response.status(201).json({ userId: result.insertId || userId, message: 'Account created.' })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return response.status(409).json({ message: 'An account with that email already exists.' })
    }
    response.status(500).json({ message: 'Could not create account.' })
  }
})

app.post('/api/auth/register-technician', async (request, response) => {
  const body = request.body && typeof request.body === 'object' ? request.body : {}
  const username = sanitizeText(body.username, 100)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = sanitizeText(body.phone, 30)
  const password = body.password
  const address = sanitizeText(body.address, 500)
  const nationalId = sanitizeText(body.nationalId, 50)
  const skills = sanitizeText(body.skills, 1000)

  if (!username || !email || !password || !nationalId || !skills) {
    return response.status(400).json({ message: 'Name, email, password, national ID, and skills are required.' })
  }
  if (username.length < 2 || (typeof body.username === 'string' && body.username.trim().length > 100)) {
    return response.status(400).json({ message: 'Name must be between 2 and 100 characters.' })
  }
  if (!isValidEmail(email)) return response.status(400).json({ message: 'Enter a valid email address.' })
  if (!isValidPassword(password)) {
    return response.status(400).json({ message: 'Password must be at least 8 characters and include letters and numbers.' })
  }
  if (!/^[A-Za-z0-9-]{4,50}$/.test(nationalId)) {
    return response.status(400).json({ message: 'National ID must be 4 to 50 letters, numbers, or hyphens.' })
  }
  if (skills.length < 3 || (typeof body.skills === 'string' && body.skills.trim().length > 1000)) {
    return response.status(400).json({ message: 'Skills must be between 3 and 1000 characters.' })
  }
  if (phone && !/^[+0-9()\-\s]{7,20}$/.test(phone)) {
    return response.status(400).json({ message: 'Enter a valid phone number.' })
  }
  if (typeof body.address === 'string' && body.address.length > 500) {
    return response.status(400).json({ message: 'Address must be 500 characters or fewer.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const passwordHash = await bcrypt.hash(password, 10)
    const userId = await nextGeneratedId(connection, 'helplagbe_users_user_id_seq')
    const [userResult] = await connection.execute(
      userId
        ? 'INSERT INTO users (user_id, username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)',
      userId
        ? [userId, username, email, phone || null, passwordHash, address || null]
        : [username, email, phone || null, passwordHash, address || null],
    )
    await connection.execute(
      'INSERT INTO technician (national_id, Full_Name, Skill_details, address, user_id, status) VALUES (?, ?, ?, ?, ?, \'pending\')',
      [nationalId, username, skills, address || null, userResult.insertId || userId],
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

app.get('/api/profile', authenticate, async (request, response) => {
  if (!['customer', 'technician', 'admin'].includes(request.user.role)) {
    return response.status(403).json({ message: 'Profile editing is unavailable for this account.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.user_id AS id, u.username AS name, u.email, u.phone_no AS phone, u.address, u.Image AS profileImage,
              u.admin_id AS adminId,
              tech.technician_id AS technicianId, tech.Skill_details AS skills,
              tech.service_area AS serviceArea, tech.availability
       FROM users u LEFT JOIN technician tech ON tech.user_id = u.user_id
       WHERE u.user_id = ? LIMIT 1`,
      [request.user.userId],
    )
    if (!rows[0]) return response.status(404).json({ message: 'Account not found.' })
    const { technicianId, adminId, ...profile } = rows[0]
    const serviceAreas = splitStoredAreas(profile.serviceArea).map((part) => serviceAreaLookup.get(part.toLowerCase())).filter(Boolean)
    response.json({ ...profile, serviceAreas, role: adminId ? 'admin' : technicianId ? 'technician' : 'customer' })
  } catch (error) {
    response.status(500).json({ message: 'Could not load your profile.' })
  }
})

app.patch('/api/profile', authenticate, async (request, response) => {
  if (!['customer', 'technician', 'admin'].includes(request.user.role)) {
    return response.status(403).json({ message: 'Profile editing is unavailable for this account.' })
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {}
  const username = sanitizeText(body.name, 100)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = sanitizeText(body.phone, 20)
  const address = sanitizeText(body.address, 500)
  const skills = sanitizeText(body.skills, 1000)
  const serviceAreaList = body.serviceAreas === undefined ? undefined : parseServiceAreas(body.serviceAreas)
  const serviceArea = serviceAreaList ? serviceAreaList.join(', ') : ''
  const availability = sanitizeText(body.availability, 255)
  const photoProvided = Object.prototype.hasOwnProperty.call(body, 'profileImage')
  let photo = null

  if (username.length < 2 || (typeof body.name === 'string' && body.name.trim().length > 100)) {
    return response.status(400).json({ message: 'Name must be between 2 and 100 characters.' })
  }
  if (!isValidEmail(email)) return response.status(400).json({ message: 'Enter a valid email address.' })
  if (phone && !/^[+0-9()\-\s]{7,20}$/.test(phone)) {
    return response.status(400).json({ message: 'Enter a valid phone number.' })
  }
  if (typeof body.address === 'string' && body.address.length > 500) {
    return response.status(400).json({ message: 'Address must be 500 characters or fewer.' })
  }
  if (body.serviceAreas !== undefined && serviceAreaList === null) {
    return response.status(400).json({ message: `Choose your service areas from the ${SERVICE_CITY} list.` })
  }
  if (request.user.role === 'technician'
    && (skills.length < 3 || (typeof body.skills === 'string' && body.skills.trim().length > 1000))) {
    return response.status(400).json({ message: 'Skills must be between 3 and 1000 characters.' })
  }
  if (photoProvided && body.profileImage !== null && typeof body.profileImage !== 'string') {
    return response.status(400).json({ message: 'Attach a JPG, PNG, or WebP profile photo.' })
  }
  if (typeof body.profileImage === 'string' && body.profileImage) {
    photo = decodeImageDataUrl(body.profileImage)
    if (!photo) return response.status(400).json({ message: 'Attach a valid JPG, PNG, or WebP image.' })
    if (photo.error) return response.status(400).json({ message: photo.error })
  }

  let uploadedPhotoPath
  if (photo) {
    try {
      const uploadDirectory = resolve(process.cwd(), '../uploads')
      await mkdir(uploadDirectory, { recursive: true })
      const fileName = `profile_${randomUUID()}.${photo.extension}`
      await writeFile(resolve(uploadDirectory, fileName), photo.buffer)
      uploadedPhotoPath = `uploads/${fileName}`
    } catch (error) {
      return response.status(500).json({ message: 'Could not save your profile photo.' })
    }
  }

  let connection
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    const [users] = await connection.execute(
      'SELECT user_id, admin_id, Image AS profileImage FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [request.user.userId],
    )
    const user = users[0]
    const [technicians] = user && !user.admin_id
      ? await connection.execute('SELECT technician_id FROM technician WHERE user_id = ? LIMIT 1', [user.user_id])
      : [[]]
    if (user) user.technician_id = technicians[0]?.technician_id
    const actualRole = user?.admin_id ? 'admin' : user?.technician_id ? 'technician' : 'customer'
    if (!user || actualRole !== request.user.role) {
      await connection.rollback()
      if (uploadedPhotoPath) {
        await unlink(resolve(process.cwd(), '..', uploadedPhotoPath)).catch((error) => {
          console.error('Could not remove an uncommitted profile photo.', error)
        })
      }
      return response.status(403).json({ message: 'Account role changed. Please sign in again.' })
    }

    await connection.execute(
      'UPDATE users SET username = ?, email = ?, phone_no = ?, address = ?, Image = ? WHERE user_id = ?',
      [username, email, phone || null, address || null, uploadedPhotoPath || (photoProvided ? null : user.profileImage), user.user_id],
    )
    if (user.technician_id) {
      await connection.execute(
        serviceAreaList === undefined
          ? 'UPDATE technician SET Full_Name = ?, address = ?, Skill_details = ? WHERE technician_id = ?'
          : 'UPDATE technician SET Full_Name = ?, address = ?, Skill_details = ?, service_area = ? WHERE technician_id = ?',
        serviceAreaList === undefined
          ? [username, address || null, skills, user.technician_id]
          : [username, address || null, skills, serviceArea || null, user.technician_id],
      )
    }

    await connection.commit()
    response.json({
      message: 'Profile updated.',
      user: {
        id: user.user_id, name: username, email, phone, address,
        profileImage: uploadedPhotoPath || (photoProvided ? null : user.profileImage),
        ...(user.technician_id && serviceAreaList !== undefined ? { skills, serviceArea, serviceAreas: serviceAreaList } : user.technician_id ? { skills } : {}),
        role: actualRole,
      },
    })
  } catch (error) {
    if (connection) await connection.rollback()
    if (uploadedPhotoPath) {
      await unlink(resolve(process.cwd(), '..', uploadedPhotoPath)).catch((cleanupError) => {
        console.error('Could not remove an uncommitted profile photo.', cleanupError)
      })
    }
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'An account with that email already exists.' })
    response.status(500).json({ message: 'Could not update your profile.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/auth/login', loginRateLimiter, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''

  if (!email || !password) {
    return response.status(400).json({ message: 'Email and password are required.' })
  }
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: 'Enter a valid email address.' })
  }
  if (!isValidPassword(password)) {
    return response.status(400).json({ message: 'Password must be at least 8 characters and include letters and numbers.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.user_id, u.username, u.email, u.password, u.admin_id, u.Image AS profileImage, t.technician_id,
          COALESCE(controls.status, 'active') AS accountStatus
       FROM users u LEFT JOIN technician t ON t.user_id = u.user_id
       LEFT JOIN admin_user_controls controls ON controls.user_id = u.user_id
       WHERE u.email = ? LIMIT 1`,
      [email.toLowerCase()],
    )
    const user = rows[0]

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return response.status(401).json({ message: 'Invalid email or password.' })
    }
    if (user.accountStatus === 'suspended') return response.status(403).json({ message: 'This account is suspended. Contact support.' })

    const role = user.admin_id ? 'admin' : user.technician_id ? 'technician' : 'customer'
    const token = jwt.sign({ userId: user.user_id, role }, jwtSecret, { expiresIn: '2h' })
    response.json({ token, user: { id: user.user_id, name: user.username, email: user.email, profileImage: user.profileImage, role } })
  } catch (error) {
    response.status(500).json({ message: 'Could not log in.' })
  }
})

app.get('/', (_request, response) => {
  response.json({ name: 'HelpLagbe API', health: '/api/health' })
})

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error)
  if (error.type === 'entity.too.large') return response.status(413).json({ message: 'Request payload is too large.' })
  if (error.type === 'entity.parse.failed') return response.status(400).json({ message: 'Request body must be valid JSON.' })
  if (error.message === 'Not allowed by CORS') return response.status(403).json({ message: 'Request origin is not allowed.' })

  console.error(JSON.stringify({
    level: 'error',
    event: 'unhandled_request_error',
    requestId: response.getHeader('X-Request-Id') || null,
    path: request.path,
    code: error.code || null,
  }))
  response.status(500).json({ message: 'Unexpected server error.' })
})

async function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }))
  if (httpServer) {
    const forcedClose = setTimeout(() => httpServer.closeAllConnections?.(), 10000)
    forcedClose.unref()
    await new Promise((resolveClose) => httpServer.close(resolveClose))
    clearTimeout(forcedClose)
  }
  await pool.end()
}

if (isDirectRun) {
  ensureTiDBIdSequences()
    .then(() => ensureNotificationTable())
    .then(() => {
      httpServer = app.listen(port, () => console.log(`HelpLagbe API listening on port ${port}`))
      process.once('SIGTERM', () => shutdown('SIGTERM').catch((error) => console.error('Shutdown failed.', error.code || error.message)))
      process.once('SIGINT', () => shutdown('SIGINT').catch((error) => console.error('Shutdown failed.', error.code || error.message)))
    })
    .catch((error) => {
      console.error('Could not initialize database compatibility/schema.', error.code || error.message)
      pool.end().finally(() => { process.exitCode = 1 })
    })
}

async function closeDatabasePool() {
  await pool.end()
}

export { app, closeDatabasePool, ensureTiDBIdSequences }
