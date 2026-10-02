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

const seedTag = '[realistic-seed]'
const categories = [
  ['Appliance', 'AC repair'],
  ['Plumbing', 'Pipe repair'],
  ['Electrical', 'Home wiring'],
  ['Home maintenance', 'Painting'],
  ['Computer', 'Laptop repair'],
]

const customerProfiles = [
  ['Ayesha Rahman', 'ayesha.rahman@helplagbe.com', '0171001001', 'AyeshaHome123!'],
  ['Tanvir Ahmed', 'tanvir.ahmed@helplagbe.com', '0171001002', 'TanvirCare456!'],
  ['Mehnaz Islam', 'mehnaz.islam@helplagbe.com', '0171001003', 'MehnazFix789!'],
  ['Arif Hossain', 'arif.hossain@helplagbe.com', '0171001004', 'ArifNeeds321!'],
  ['Shreya Sultana', 'shreya.sultana@helplagbe.com', '0171001005', 'ShreyaWorks654!'],
  ['Imran Hasan', 'imran.hasan@helplagbe.com', '0171001006', 'ImranHome987!'],
  ['Nabila Karim', 'nabila.karim@helplagbe.com', '0171001007', 'NabilaMaid135!'],
  ['Rakibul Hoque', 'rakibul.hoque@helplagbe.com', '0171001008', 'RakibRepair246!'],
  ['Farzana Akter', 'farzana.akter@helplagbe.com', '0171001009', 'FarzanaHelp357!'],
  ['Sabbir Ahmed', 'sabbir.ahmed@helplagbe.com', '0171001010', 'SabbirFix468!'],
  ['Laila Hassan', 'laila.hassan@helplagbe.com', '0171001011', 'LailaHome579!'],
  ['Anik Roy', 'anik.roy@helplagbe.com', '0171001012', 'AnikService680!'],
  ['Rumana Chowdhury', 'rumana.chowdhury@helplagbe.com', '0171001013', 'RumanaFix791!'],
  ['Nafis Mahmud', 'nafis.mahmud@helplagbe.com', '0171001014', 'NafisRepair802!'],
  ['Suraiya Begum', 'suraiya.begum@helplagbe.com', '0171001015', 'SuraiyaHelp913!'],
  ['Samiul Islam', 'samiul.islam@helplagbe.com', '0171001016', 'SamiulCare024!'],
  ['Tania Ferdous', 'tania.ferdous@helplagbe.com', '0171001017', 'TaniaNeeds135!'],
  ['Kazi Ashraf', 'kazi.ashraf@helplagbe.com', '0171001018', 'KaziRepair246!'],
  ['Mahmudul Hasan', 'mahmudul.hasan@helplagbe.com', '0171001019', 'MahmudulCare357!'],
  ['Sadiq Hossain', 'sadiq.hossain@helplagbe.com', '0171001020', 'SadiqFix468!'],
]

const technicianProfiles = [
  ['Mahmudul Islam', 'mahmudul.islam@helplagbe.com', '0181002001', 'MahmudulPro123!'],
  ['Farhana Noor', 'farhana.noor@helplagbe.com', '0181002002', 'FarhanaSkill456!'],
  ['Tanzeel Hossain', 'tanzeel.hossain@helplagbe.com', '0181002003', 'TanzeelFix789!'],
  ['Nabil Ahmed', 'nabil.ahmed@helplagbe.com', '0181002004', 'NabilWorks321!'],
  ['Rafiq Uddin', 'rafiq.uddin@helplagbe.com', '0181002005', 'RafiqRepair654!'],
  ['Shahana Akter', 'shahana.akter@helplagbe.com', '0181002006', 'ShahanaCare987!'],
  ['Arman Ali', 'arman.ali@helplagbe.com', '0181002007', 'ArmanPro135!'],
  ['Rahima Khatun', 'rahima.khatun@helplagbe.com', '0181002008', 'RahimaFix246!'],
]

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

async function clearLegacyDemoData(connection) {
  const [demoUsers] = await connection.execute(
    'SELECT user_id FROM users WHERE LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(username) LIKE ? OR LOWER(email) LIKE ?',
    ['%demo%', '%demo%', '%realistic%', '%realistic%'],
  )
  const userIds = demoUsers.map((user) => user.user_id)

  if (userIds.length === 0) return

  const [demoTechnicians] = await connection.execute(
    `SELECT technician_id FROM technician WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
    userIds,
  )
  const technicianIds = demoTechnicians.map((technician) => technician.technician_id)

  if (technicianIds.length > 0) {
    await connection.execute(
      `DELETE FROM tasks WHERE technician_id IN (${technicianIds.map(() => '?').join(',')})`,
      technicianIds,
    )
    await connection.execute(
      `DELETE FROM technician WHERE technician_id IN (${technicianIds.map(() => '?').join(',')})`,
      technicianIds,
    )
  }

  let demoPostQuery = 'SELECT post_id FROM posts WHERE Post_detail LIKE ? OR Post_detail LIKE ?'
  const demoPostParams = ['%[demo-seed]%', '%[realistic-seed]%']
  if (userIds.length > 0) {
    demoPostQuery += ` OR user_id IN (${userIds.map(() => '?').join(',')})`
    demoPostParams.push(...userIds)
  }
  const [demoPosts] = await connection.execute(demoPostQuery, demoPostParams)
  const postIds = demoPosts.map((post) => post.post_id)

  if (postIds.length > 0) {
    await connection.execute(
      `DELETE FROM tasks WHERE post_id IN (${postIds.map(() => '?').join(',')})`,
      postIds,
    )
    await connection.execute(
      `DELETE FROM posts WHERE post_id IN (${postIds.map(() => '?').join(',')})`,
      postIds,
    )
  }

  await connection.execute(
    `DELETE FROM users WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
    userIds,
  )
}

async function seed() {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await clearLegacyDemoData(connection)

    const customerIds = []
    for (let index = 0; index < customerProfiles.length; index += 1) {
      const [username, email, phone, password] = customerProfiles[index]
      customerIds.push(await getOrCreateUser(connection, username, email, password, phone))
    }

    const technicianIds = []
    for (let index = 0; index < technicianProfiles.length; index += 1) {
      const [fullName, email, phone, password] = technicianProfiles[index]
      const userId = await getOrCreateUser(connection, fullName, email, password, phone)
      const [existing] = await connection.execute('SELECT technician_id AS id FROM technician WHERE user_id = ? LIMIT 1', [userId])
      if (existing[0]) {
        technicianIds.push(existing[0].id)
      } else {
        const [result] = await connection.execute(
          `INSERT INTO technician (national_id, Full_Name, Skill_details, status, user_id, address)
           VALUES (?, ?, ?, 'approved', ?, 'Dhaka')`,
          [`T-${String(index + 1).padStart(4, '0')}`, fullName, `${categories[index % categories.length][0]} specialist with verified experience and local service coverage.`, userId],
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
        [`${seedTag} ${category} request ${index}: ${customerProfiles[(index - 1) % customerProfiles.length][0]} needs dependable ${subCategory.toLowerCase()} support in Dhaka.`, category, subCategory, customerId],
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
    console.log(`Realistic seed complete: ${customerIds.length} customers, ${technicianIds.length} technicians, ${postCount} requests, ${taskCount} bids/tasks.`)
    console.log('Customer sample passwords are attached to each seeded profile in the script.')
    console.log('Technician sample passwords are attached to each seeded profile in the script.')
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
    await pool.end()
  }
}

seed().catch((error) => {
  console.error('Seed failed:', error.message)
  process.exitCode = 1
})