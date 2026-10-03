import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { readFileSync } from 'node:fs'

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null
const databaseHost = databaseUrl ? databaseUrl.hostname : process.env.DB_HOST
const databaseName = databaseUrl ? decodeURIComponent(databaseUrl.pathname.slice(1)) : process.env.DB_NAME
const databaseCa = process.env.DB_SSL_CA_PATH
  ? readFileSync(process.env.DB_SSL_CA_PATH, 'utf8')
  : process.env.DB_SSL_CA || undefined

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this command in an interactive terminal.'))
      return
    }

    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    let value = ''

    const finish = (error) => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') {
          finish(new Error('Password reset cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        if (character.charCodeAt(0) >= 32) {
          value += character
          stdout.write('*')
        }
      }
    }

    stdin.on('data', onData)
  })
}

async function main() {
  if (!databaseHost || !databaseName) {
    throw new Error('Set DB_HOST and DB_NAME in server/.env before running this command.')
  }
  if (process.env.DB_SSL !== 'true') {
    throw new Error('DB_SSL must be true for this reset command. Configure the TiDB TLS settings in server/.env.')
  }

  const pool = mysql.createPool({
    host: databaseHost,
    port: Number(databaseUrl ? databaseUrl.port || 3306 : process.env.DB_PORT || 3306),
    database: databaseName,
    user: databaseUrl ? decodeURIComponent(databaseUrl.username) : process.env.DB_USER,
    password: databaseUrl ? decodeURIComponent(databaseUrl.password) : process.env.DB_PASSWORD,
    ssl: {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(databaseCa ? { ca: databaseCa } : {}),
    },
    waitForConnections: true,
    connectionLimit: 1,
  })
  const prompts = createInterface({ input: stdin, output: stdout })

  try {
    console.log(`Target database: ${databaseHost}/${databaseName}`)
    const confirmation = await prompts.question('Type RESET to continue: ')
    if (confirmation !== 'RESET') throw new Error('Password reset cancelled.')

    const email = (await prompts.question('Admin email to reset: ')).trim().toLowerCase()
    const [admins] = await pool.execute(
      'SELECT user_id, username, email FROM users WHERE LOWER(email) = ? AND admin_id IS NOT NULL LIMIT 1',
      [email],
    )
    if (!admins[0]) throw new Error('No administrator account exists with that email.')

    const newPassword = await readHidden('New password (8+ characters, include letters and numbers): ')
    const confirmationPassword = await readHidden('Confirm new password: ')
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new Error('Password must be at least 8 characters and include letters and numbers.')
    }
    if (newPassword !== confirmationPassword) throw new Error('The passwords do not match.')

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await pool.execute('UPDATE users SET password = ?, updated_at = NOW() WHERE user_id = ?', [passwordHash, admins[0].user_id])
    console.log(`Password reset completed for admin ${admins[0].email}.`)
  } finally {
    prompts.close()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(`Admin password reset failed: ${error.message}`)
  process.exitCode = 1
})