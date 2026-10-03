import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { app, closeDatabasePool, ensureTiDBIdSequences } from '../src/server.js'

const runIntegration = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
if (runIntegration && process.env.INTEGRATION_DB_IS_DISPOSABLE !== '1') {
  throw new Error('Integration tests write and remove fixture data; set INTEGRATION_DB_IS_DISPOSABLE=1 only for a disposable test database.')
}
if (runIntegration && process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run database integration tests with NODE_ENV=production.')
}

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
  connectionLimit: 2,
})

after(async () => {
  await pool.end()
  await closeDatabasePool()
})

test('customer, technician, bid, and archive lifecycle works against the configured test database', { skip: !runIntegration }, async () => {
  await ensureTiDBIdSequences()
  const suffix = randomUUID()
  const password = 'LifecycleTest937Pass'
  const customerEmail = `integration-customer-${suffix}@example.invalid`
  const technicianEmail = `integration-technician-${suffix}@example.invalid`
  const archiveEmail = `integration-archive-${suffix}@example.invalid`

  try {
    let response = await request(app).post('/api/auth/register').send({ username: 'Integration Customer', email: customerEmail, password })
    assert.equal(response.status, 201)
    response = await request(app).post('/api/auth/login').send({ email: customerEmail, password })
    assert.equal(response.status, 200)
    const customerToken = response.body.token

    response = await request(app).post('/api/auth/register-technician').send({
      username: 'Integration Technician', email: technicianEmail, password,
      nationalId: `IT-${suffix}`, skills: 'Verified plumbing specialist',
    })
    assert.equal(response.status, 201)
    const [[technician]] = await pool.execute(
      'SELECT technician_id, user_id FROM technician WHERE user_id = (SELECT user_id FROM users WHERE email = ?)',
      [technicianEmail],
    )
    assert.ok(technician)
    await pool.execute("UPDATE technician SET status = 'approved' WHERE technician_id = ?", [technician.technician_id])
    response = await request(app).post('/api/auth/login').send({ email: technicianEmail, password })
    assert.equal(response.status, 200)
    const technicianToken = response.body.token

    response = await request(app).post('/api/posts').set('Authorization', `Bearer ${customerToken}`).send({
      detail: `Lifecycle ${suffix}`, category: 'Plumbing',
    })
    assert.equal(response.status, 201)
    const postId = response.body.id
    response = await request(app).post('/api/tasks/bid').set('Authorization', `Bearer ${technicianToken}`).send({ postId, price: 525.25 })
    assert.equal(response.status, 201)
    response = await request(app).post('/api/tasks/bid').set('Authorization', `Bearer ${technicianToken}`).send({ postId, price: 500 })
    assert.equal(response.status, 409)

    const [[task]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ? AND technician_id = ?', [postId, technician.technician_id])
    response = await request(app).patch(`/api/tasks/${task.task_id}/status`).set('Authorization', `Bearer ${customerToken}`).send({ status: 'accepted' })
    assert.equal(response.status, 200)
    response = await request(app).patch(`/api/tasks/${task.task_id}/status`).set('Authorization', `Bearer ${customerToken}`).send({ status: 'accepted' })
    assert.equal(response.status, 409)
    const [[state]] = await pool.execute('SELECT task_status FROM tasks WHERE task_id = ?', [task.task_id])
    assert.equal(state.task_status, 'accepted')
    const [[notice]] = await pool.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'bid_accepted'", [technician.user_id])
    assert.ok(Number(notice.total) > 0)

    response = await request(app).post('/api/auth/register').send({ username: 'Archive Restore Test', email: archiveEmail, password })
    assert.equal(response.status, 201)
    const archiveUserId = response.body.userId
    response = await request(app).post('/api/auth/login').send({ email: archiveEmail, password })
    assert.equal(response.status, 200)
    response = await request(app).post('/api/posts').set('Authorization', `Bearer ${response.body.token}`).send({
      detail: `Restored history ${suffix}`, category: 'Appliance',
    })
    assert.equal(response.status, 201)

    const [admins] = await pool.execute('SELECT user_id FROM users WHERE admin_id IS NOT NULL ORDER BY user_id LIMIT 1')
    assert.ok(admins[0], 'integration database must contain an administrator')
    const adminToken = jwt.sign({ userId: admins[0].user_id, role: 'admin' }, process.env.JWT_SECRET || 'helplagbe-local-development-secret', { expiresIn: '2m' })
    response = await request(app).delete(`/api/admin/users/${archiveUserId}`).set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    const [[archive]] = await pool.execute('SELECT archive_id, snapshot FROM archived_users WHERE email = ?', [archiveEmail])
    assert.ok(JSON.parse(archive.snapshot).user.password)
    response = await request(app).patch(`/api/admin/archived-users/${archive.archive_id}/restore`).set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    response = await request(app).post('/api/auth/login').send({ email: archiveEmail, password })
    assert.equal(response.status, 200)
    response = await request(app).get('/api/customer/posts').set('Authorization', `Bearer ${response.body.token}`)
    assert.ok(response.body.some((post) => post.detail === `Restored history ${suffix}`))
  } finally {
    await pool.execute('DELETE FROM users WHERE email IN (?, ?, ?)', [customerEmail, technicianEmail, archiveEmail])
    await pool.execute('DELETE FROM archived_users WHERE email IN (?, ?, ?)', [customerEmail, technicianEmail, archiveEmail])
  }
})