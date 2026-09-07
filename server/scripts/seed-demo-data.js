import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 5,
})

const seedTag = '[demo-seed]'
const categories = [
  ['Appliance', 'AC repair'],
  ['Plumbing', 'Pipe repair'],
  ['Electrical', 'Home wiring'],
  ['Home maintenance', 'Painting'],
  ['Computer', 'Laptop repair'],
]
const customerPassword = 'DemoData123!'
const technicianPassword = 'DemoTech123!'

async function getOrCreateUser(connection, username, email, password, phone) {
  const [existing] = await connection.execute('SELECT user_id AS id FROM users WHERE email = ? LIMIT 1', [email])
  if (existing[0]) return existing[0].id
  const passwordHash = await bcrypt.hash(password, 10)
  const [result] = await connection.execute(
    'INSERT INTO users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)',
    [username, email, phone, passwordHash, 'Dhaka'],
  )
  return result.insertId
}

async function seed() {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [existingSeed] = await connection.execute('SELECT post_id FROM posts WHERE Post_detail LIKE ? LIMIT 1', [`%${seedTag}%`])
    if (existingSeed[0]) {
      console.log('Demo seed already exists. No duplicate data was added.')
      await connection.rollback()
      return
    }

    const customerIds = []
    for (let index = 1; index <= 20; index += 1) {
      customerIds.push(await getOrCreateUser(connection, `Demo Customer ${index}`, `demo.customer.${index}@helplagbe.com`, customerPassword, `0171000${String(index).padStart(4, '0')}`))
    }

    const technicianIds = []
    for (let index = 1; index <= 8; index += 1) {
      const userId = await getOrCreateUser(connection, `Demo Technician ${index}`, `demo.technician.${index}@helplagbe.com`, technicianPassword, `0181000${String(index).padStart(4, '0')}`)
      const [existing] = await connection.execute('SELECT technician_id AS id FROM technician WHERE user_id = ? LIMIT 1', [userId])
      if (existing[0]) {
        technicianIds.push(existing[0].id)
      } else {
        const [result] = await connection.execute(
          `INSERT INTO technician (national_id, Full_Name, Skill_details, status, user_id, address)
           VALUES (?, ?, ?, 'approved', ?, 'Dhaka')`,
          [`DEMO-${String(index).padStart(4, '0')}`, `Demo Technician ${index}`, `${categories[(index - 1) % categories.length][0]} specialist with verified demo experience.`, userId],
        )
        technicianIds.push(result.insertId)
      }
    }

    const taskStatuses = ['pending', 'accepted', 'in_progress', 'completed', 'rejected']
    let postCount = 0
    let taskCount = 0
    for (let index = 1; index <= 40; index += 1) {
      const [category, subCategory] = categories[(index - 1) % categories.length]
      const customerId = customerIds[(index - 1) % customerIds.length]
      const [postResult] = await connection.execute(
        'INSERT INTO posts (Post_detail, Category, `Sub-Category`, user_id) VALUES (?, ?, ?, ?)',
        [`${seedTag} ${category} request ${index}: customer needs reliable ${subCategory.toLowerCase()} support.`, category, subCategory, customerId],
      )
      postCount += 1
      const bidCount = index % 3 === 0 ? 3 : 2
      for (let bidIndex = 0; bidIndex < bidCount; bidIndex += 1) {
        const technicianId = technicianIds[(index + bidIndex) % technicianIds.length]
        const status = taskStatuses[(index + bidIndex) % taskStatuses.length]
        const acceptedAt = ['accepted', 'in_progress', 'completed'].includes(status) ? new Date() : null
        const completedAt = status === 'completed' ? new Date() : null
        await connection.execute(
          `INSERT INTO tasks (task_status, price, post_id, technician_id, accepted_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [status, 350 + ((index + bidIndex) * 125) % 1800, postResult.insertId, technicianId, acceptedAt, completedAt],
        )
        taskCount += 1
      }
    }
    await connection.commit()
    console.log(`Demo seed complete: ${customerIds.length} customers, ${technicianIds.length} technicians, ${postCount} requests, ${taskCount} bids/tasks.`)
    console.log(`Customer password: ${customerPassword}`)
    console.log(`Technician password: ${technicianPassword}`)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
    await pool.end()
  }
}

seed().catch((error) => {
  console.error('Demo seed failed:', error.message)
  process.exitCode = 1
})