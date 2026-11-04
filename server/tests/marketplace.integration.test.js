import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
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

// Offers must fall inside the technician's weekly hours (Mon-Fri 09:00-18:00, Dhaka time),
// so fixtures use 06:00 UTC (12:00 in Dhaka) on a weekday at least `daysAhead` days from now.
function weekdayAppointment(daysAhead) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  date.setUTCHours(6, 0, 0, 0)
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

test('customer, technician, bid, and archive lifecycle works against the configured test database', { skip: !runIntegration }, async () => {
  await ensureTiDBIdSequences()
  const suffix = randomUUID()
  const password = 'LifecycleTest937Pass'
  const customerEmail = `integration-customer-${suffix}@example.invalid`
  const technicianEmail = `integration-technician-${suffix}@example.invalid`
  const archiveEmail = `integration-archive-${suffix}@example.invalid`
  let profilePhotoPath
  let reportId

  try {
    let response = await request(app).post('/api/auth/register').send({
      username: 'Integration Customer', email: customerEmail, password, phone: '01325409985',
    })
    assert.equal(response.status, 201)
    response = await request(app).post('/api/auth/login').send({ email: customerEmail, password })
    assert.equal(response.status, 200)
    const customerToken = response.body.token

    response = await request(app).post('/api/auth/register-technician').send({
      username: 'Integration Technician', email: technicianEmail, password,
      phone: '01325409986', nationalId: `IT-${suffix}`, skills: 'Verified plumbing specialist',
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
      area: 'Dhanmondi', serviceAddress: 'Road 5, Dhanmondi, Dhaka', building: 'Green House', flatNo: '4B',
    })
    assert.equal(response.status, 201)
    const postId = response.body.id

    for (const [token, expectedCustomerName] of [
      [null, null],
      [customerToken, null],
      [technicianToken, 'Integration Customer'],
    ]) {
      let listingRequest = request(app).get('/api/posts').query({ search: suffix })
      if (token) listingRequest = listingRequest.set('Authorization', `Bearer ${token}`)
      response = await listingRequest
      assert.equal(response.status, 200)
      const listedPost = response.body.items.find((post) => post.id === postId)
      assert.ok(listedPost)
      assert.equal(listedPost.customerName, expectedCustomerName)
      assert.equal(listedPost.serviceAddress, undefined)
    }

    response = await request(app).get('/api/technician/requests').set('Authorization', `Bearer ${technicianToken}`)
    assert.equal(response.status, 200)
    assert.equal(response.body.find((post) => post.id === postId)?.customerName, 'Integration Customer')
    assert.equal(response.body.find((post) => post.id === postId)?.serviceAddress, undefined)

    response = await request(app).get('/api/profile').set('Authorization', `Bearer ${technicianToken}`)
    assert.equal(response.status, 200)
    assert.equal(response.body.role, 'technician')
    assert.equal(response.body.phone, '01325409986')
    response = await request(app).patch('/api/profile').set('Authorization', `Bearer ${technicianToken}`).send({
      name: 'Updated Integration Technician',
      email: technicianEmail,
      phone: '01234567890',
      address: 'Dhaka',
      skills: 'Updated plumbing and repair',
      serviceArea: 'Dhaka',
      availability: 'Weekdays',
      profileImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YQAAAABJRU5ErkJggg==',
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.user.name, 'Updated Integration Technician')
    assert.match(response.body.user.profileImage, /^uploads\/profile_[\w-]+\.png$/)
    profilePhotoPath = response.body.user.profileImage
    response = await request(app).get('/api/profile').set('Authorization', `Bearer ${technicianToken}`)
    assert.equal(response.body.profileImage, profilePhotoPath)
    response = await request(app).patch('/api/profile').set('Authorization', `Bearer ${technicianToken}`)
      .send({
        name: 'Updated Integration Technician',
        email: technicianEmail,
        skills: 'Updated plumbing and repair',
        serviceAreas: ['Dhanmundi'],
        profileImage: null,
      })
    assert.equal(response.status, 400, 'areas outside the Dhaka list are rejected')
    response = await request(app).patch('/api/profile').set('Authorization', `Bearer ${technicianToken}`)
      .send({
        name: 'Updated Integration Technician',
        email: technicianEmail,
        phone: '01234567890',
        address: 'Dhaka',
        skills: 'Updated plumbing and repair',
        serviceAreas: ['dhanmondi', 'Mirpur'],
        availability: 'Weekdays',
        profileImage: null,
      })
    assert.equal(response.status, 200)
    assert.equal(response.body.user.profileImage, null)
    const [[updatedTechnician]] = await pool.execute(
      'SELECT Full_Name, Skill_details, address, service_area, availability FROM technician WHERE technician_id = ?',
      [technician.technician_id],
    )
    assert.equal(updatedTechnician.Full_Name, 'Updated Integration Technician')
    assert.equal(updatedTechnician.Skill_details, 'Updated plumbing and repair')
    assert.equal(updatedTechnician.address, 'Dhaka')
    assert.equal(updatedTechnician.service_area, 'Dhanmondi, Mirpur')
    assert.notEqual(updatedTechnician.availability, 'Weekdays', 'availability is only set from the weekly schedule')
    const weekdaySchedule = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, { enabled: !['sat', 'sun'].includes(day), start: '09:00', end: '18:00' }]))
    response = await request(app).put('/api/technician/availability').set('Authorization', `Bearer ${technicianToken}`).send({ schedule: weekdaySchedule, alerts: true })
    assert.equal(response.status, 200)
    assert.equal(response.body.summary, 'Mon-Fri 09:00-18:00')
    response = await request(app).get('/api/technicians').query({ location: 'Dhanmondi', availability: 'Mon-Fri', sort: 'rating' })
    assert.equal(response.status, 200)
    assert.ok(response.body.items.some((item) => item.id === technician.technician_id))
    await pool.execute('UPDATE users SET address = ? WHERE email = ?', ['Dhanmondi, Dhaka', customerEmail])
    response = await request(app).get('/api/technician/requests').set('Authorization', `Bearer ${technicianToken}`)
    const matchedRequest = response.body.find((item) => item.id === postId)
    assert.equal(matchedRequest.areaMatch, 1)
    assert.equal(matchedRequest.customerAddress, undefined)

    const proposedAppointment = weekdayAppointment(1)
    response = await request(app).post('/api/tasks/bid').set('Authorization', `Bearer ${technicianToken}`).send({ postId, price: 525.25, proposedAt: proposedAppointment })
    assert.equal(response.status, 201)
    response = await request(app).post('/api/tasks/bid').set('Authorization', `Bearer ${technicianToken}`).send({ postId, price: 500, proposedAt: proposedAppointment })
    assert.equal(response.status, 409)
    const [[linkedTask]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ?', [postId])
    response = await request(app).get('/api/notifications').set('Authorization', `Bearer ${customerToken}`)
    const offerNotification = response.body.find((item) => item.type === 'new_bid')
    assert.equal(offerNotification.targetType, 'task')
    assert.equal(Number(offerNotification.targetId), Number(linkedTask.task_id))

    response = await request(app).get('/api/customer/posts').set('Authorization', `Bearer ${customerToken}`)
    assert.equal(response.body.find((post) => post.id === postId)?.serviceAddress, 'Road 5, Dhanmondi, Dhaka')
    assert.equal(response.body.find((post) => post.id === postId)?.building, 'Green House')
    assert.equal(response.body.find((post) => post.id === postId)?.flatNo, '4B')
    response = await request(app).patch(`/api/customer/posts/${postId}`).set('Authorization', `Bearer ${customerToken}`)
      .send({
        detail: `Lifecycle ${suffix} contact 01325409987 email tech@example.invalid at 123 Main Street`,
        category: 'Plumbing',
        subCategory: 'Repair',
        area: 'Dhanmondi',
        serviceAddress: 'Road 5, Dhanmondi, Dhaka',
        building: 'Green House',
        flatNo: '4B',
      })
    assert.equal(response.status, 200)
    response = await request(app).get('/api/posts').query({ search: suffix })
    const publicRequest = response.body.items.find((post) => post.id === postId)
    assert.ok(publicRequest)
    assert.doesNotMatch(publicRequest.detail, /01325409987|tech@example\.invalid|123 Main Street/)
    response = await request(app).get('/api/technician/requests').set('Authorization', `Bearer ${technicianToken}`)
    assert.doesNotMatch(response.body.find((post) => post.id === postId).detail, /01325409987|tech@example\.invalid|123 Main Street/)

    const [[task]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ? AND technician_id = ?', [postId, technician.technician_id])
    response = await request(app).get(`/api/customer/bids/${task.task_id}/technician`).set('Authorization', `Bearer ${customerToken}`)
    assert.equal(response.status, 200)
    assert.equal(response.body.name, 'Updated Integration Technician')
    assert.equal(Number(response.body.completedJobs), 0)
    assert.deepEqual(response.body.workHistory, [])
    assert.deepEqual(response.body.reviews, [])
    response = await request(app).get('/api/technician/tasks').set('Authorization', `Bearer ${technicianToken}`)
    assert.equal(response.status, 200)
    const pendingTechTask = response.body.find((item) => item.id === task.task_id)
    assert.equal(pendingTechTask.serviceAddress, null)
    assert.equal(pendingTechTask.customerPhone, null)
    response = await request(app).patch(`/api/tasks/${task.task_id}/status`).set('Authorization', `Bearer ${customerToken}`).send({ status: 'accepted' })
    assert.equal(response.status, 200)
    response = await request(app).patch(`/api/tasks/${task.task_id}/status`).set('Authorization', `Bearer ${customerToken}`).send({ status: 'accepted' })
    assert.equal(response.status, 409)
    const rescheduledAppointment = weekdayAppointment(3)
    response = await request(app).post(`/api/tasks/${task.task_id}/schedule`).set('Authorization', `Bearer ${customerToken}`)
      .send({ proposedAt: rescheduledAppointment, reason: 'Customer requested a different time' })
    assert.equal(response.status, 200)
    response = await request(app).post(`/api/tasks/${task.task_id}/schedule/confirm`).set('Authorization', `Bearer ${technicianToken}`)
    assert.equal(response.status, 200)
    const [[state]] = await pool.execute('SELECT task_status FROM tasks WHERE task_id = ?', [task.task_id])
    assert.equal(state.task_status, 'scheduled')
    response = await request(app).get('/api/technician/tasks').set('Authorization', `Bearer ${technicianToken}`)
    const acceptedTechTask = response.body.find((item) => item.id === task.task_id)
    assert.equal(acceptedTechTask.serviceAddress, 'Road 5, Dhanmondi, Dhaka')
    assert.equal(acceptedTechTask.building, 'Green House')
    assert.equal(acceptedTechTask.flatNo, '4B')
    assert.equal(acceptedTechTask.customerPhone, '01325409985')
    const [[notice]] = await pool.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'bid_accepted'", [technician.user_id])
    assert.ok(Number(notice.total) > 0)

    response = await request(app).patch(`/api/technician/tasks/${task.task_id}/status`).set('Authorization', `Bearer ${technicianToken}`).send({ status: 'in_progress' })
    assert.equal(response.status, 200)
    response = await request(app).patch(`/api/technician/tasks/${task.task_id}/status`).set('Authorization', `Bearer ${technicianToken}`).send({ status: 'completed' })
    assert.equal(response.status, 200)
    response = await request(app).post(`/api/tasks/${task.task_id}/payment/confirm`).set('Authorization', `Bearer ${customerToken}`)
      .send({ paymentMethod: 'cash' })
    assert.equal(response.status, 200)
    assert.equal(response.body.paymentStatus, 'unpaid')
    response = await request(app).post(`/api/tasks/${task.task_id}/payment/confirm`).set('Authorization', `Bearer ${technicianToken}`)
      .send({ paymentMethod: 'cash' })
    assert.equal(response.status, 200)
    assert.equal(response.body.paymentStatus, 'paid')
    assert.equal(response.body.receiptNumber, `HL-${task.task_id}`)
    response = await request(app).get('/api/customer/posts').set('Authorization', `Bearer ${customerToken}`)
    assert.equal(response.status, 200)
    const completedTask = response.body.find((post) => post.taskId === task.task_id)
    assert.ok(completedTask)
    assert.equal(completedTask.technicianId, technician.technician_id)
    assert.equal(completedTask.technicianName, 'Updated Integration Technician')
    assert.equal(completedTask.technicianPhone, '01234567890')
    assert.equal(Number(completedTask.technicianCompletedJobs), 1)
    assert.equal(Number(completedTask.technicianReviewCount), 0)

    response = await request(app)
      .post(`/api/tasks/${task.task_id}/review`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 5, compliments: ['On time', 'Professional'], review: 'Excellent work.' })
    assert.equal(response.status, 200)
    response = await request(app).get('/api/customer/posts').set('Authorization', `Bearer ${customerToken}`)
    const reviewedTask = response.body.find((post) => post.taskId === task.task_id)
    assert.equal(Number(reviewedTask.technicianAverageRating), 5)
    assert.equal(Number(reviewedTask.technicianReviewCount), 1)
    assert.deepEqual(JSON.parse(reviewedTask.reviewText), {
      version: 1,
      review: 'Excellent work.',
      compliments: ['On time', 'Professional'],
    })

    response = await request(app).post('/api/posts').set('Authorization', `Bearer ${customerToken}`)
      .send({ detail: `Request to close ${suffix}`, category: 'Appliance', area: 'Dhanmondi', serviceAddress: 'Dhaka, Bangladesh' })
    assert.equal(response.status, 201)
    const closePostId = response.body.id
    response = await request(app).post('/api/tasks/bid').set('Authorization', `Bearer ${technicianToken}`)
      .send({ postId: closePostId, price: 250, proposedAt: weekdayAppointment(1) })
    assert.equal(response.status, 201)
    const [[closeTask]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ? AND technician_id = ?', [closePostId, technician.technician_id])
    response = await request(app).post(`/api/customer/posts/${closePostId}/close`).set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'No longer need this repair' })
    assert.equal(response.status, 200)
    const [[closedTask]] = await pool.execute('SELECT task_status FROM tasks WHERE task_id = ?', [closeTask.task_id])
    assert.equal(closedTask.task_status, 'rejected')
    response = await request(app).get('/api/posts').query({ search: suffix })
    assert.ok(!response.body.items.some((post) => post.id === closePostId))

    response = await request(app).post('/api/posts').set('Authorization', `Bearer ${customerToken}`)
      .send({ detail: `Offer to withdraw ${suffix}`, category: 'Plumbing', area: 'Dhanmondi', serviceAddress: 'Dhaka, Bangladesh' })
    assert.equal(response.status, 201)
    const withdrawPostId = response.body.id
    response = await request(app).post('/api/tasks/bid').set('Authorization', `Bearer ${technicianToken}`)
      .send({ postId: withdrawPostId, price: 300, proposedAt: weekdayAppointment(1) })
    assert.equal(response.status, 201)
    const [[withdrawTask]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ? AND technician_id = ?', [withdrawPostId, technician.technician_id])
    response = await request(app).post(`/api/technician/tasks/${withdrawTask.task_id}/withdraw`).set('Authorization', `Bearer ${technicianToken}`)
      .send({ reason: 'I am unavailable for this appointment' })
    assert.equal(response.status, 200)
    const [[withdrawnTask]] = await pool.execute('SELECT task_status FROM tasks WHERE task_id = ?', [withdrawTask.task_id])
    assert.equal(withdrawnTask.task_status, 'withdrawn')

    response = await request(app).post('/api/auth/register').send({ username: 'Archive Restore Test', email: archiveEmail, password })
    assert.equal(response.status, 201)
    const archiveUserId = response.body.userId
    response = await request(app).post('/api/auth/login').send({ email: archiveEmail, password })
    assert.equal(response.status, 200)
    response = await request(app).post('/api/posts').set('Authorization', `Bearer ${response.body.token}`).send({
      detail: `Restored history ${suffix}`, category: 'Appliance', area: 'Dhanmondi', serviceAddress: 'Dhaka, Bangladesh',
    })
    assert.equal(response.status, 201)

    const [admins] = await pool.execute('SELECT user_id FROM users WHERE admin_id IS NOT NULL ORDER BY user_id LIMIT 1')
    assert.ok(admins[0], 'integration database must contain an administrator')
    const adminToken = jwt.sign({ userId: admins[0].user_id, role: 'admin' }, process.env.JWT_SECRET || 'helplagbe-local-development-secret', { expiresIn: '2m' })
    response = await request(app).post('/api/reports').set('Authorization', `Bearer ${customerToken}`)
      .send({ reportType: 'dispute', taskId: task.task_id, category: 'Service issue', description: 'Please review this completed task and payment record.' })
    assert.equal(response.status, 201)
    reportId = response.body.id
    response = await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    const report = response.body.find((item) => item.taskId === task.task_id)
    assert.ok(report)
    response = await request(app).patch(`/api/admin/reports/${report.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', resolutionNote: 'Reviewed with both participants.' })
    assert.equal(response.status, 200)
    response = await request(app).delete(`/api/admin/users/${archiveUserId}`).set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    const [[archive]] = await pool.execute('SELECT archive_id, snapshot FROM archived_users WHERE email = ?', [archiveEmail])
    assert.ok(JSON.parse(archive.snapshot).user.password)
    response = await request(app).patch(`/api/admin/archived-users/${archive.archive_id}/restore`).set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    response = await request(app).post('/api/auth/login').send({ email: archiveEmail, password })
    assert.equal(response.status, 200)
    response = await request(app).get('/api/customer/posts').set('Authorization', `Bearer ${response.body.token}`)
    const restoredRequest = response.body.find((post) => post.detail === `Restored history ${suffix}`)
    assert.ok(restoredRequest)
    assert.equal(restoredRequest.serviceAddress, 'Dhaka, Bangladesh')

    response = await request(app).delete(`/api/admin/users/${archiveUserId}`).set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    const [[secondArchive]] = await pool.execute('SELECT archive_id FROM archived_users WHERE email = ?', [archiveEmail])
    assert.ok(secondArchive)
    response = await request(app).delete(`/api/admin/archived-users/${secondArchive.archive_id}`).set('Authorization', `Bearer ${adminToken}`)
    assert.equal(response.status, 200)
    const [[remainingArchive]] = await pool.execute('SELECT COUNT(*) AS total FROM archived_users WHERE archive_id = ?', [secondArchive.archive_id])
    assert.equal(Number(remainingArchive.total), 0)
    const [[remainingUser]] = await pool.execute('SELECT COUNT(*) AS total FROM users WHERE email = ?', [archiveEmail])
    assert.equal(Number(remainingUser.total), 0)
    const [[permanentDeleteAudit]] = await pool.execute(
      "SELECT details FROM admin_audit_log WHERE action = 'user_permanently_deleted' AND target_id = ? ORDER BY audit_id DESC LIMIT 1",
      [secondArchive.archive_id],
    )
    assert.ok(permanentDeleteAudit)
    assert.doesNotMatch(permanentDeleteAudit.details, /Archive Restore Test|integration-archive-/)
  } finally {
    if (reportId) await pool.execute('DELETE FROM marketplace_reports WHERE report_id = ?', [reportId])
    await pool.execute('DELETE FROM users WHERE email IN (?, ?, ?)', [customerEmail, technicianEmail, archiveEmail])
    await pool.execute('DELETE FROM archived_users WHERE email IN (?, ?, ?)', [customerEmail, technicianEmail, archiveEmail])
    if (profilePhotoPath) await unlink(resolve(process.cwd(), '..', profilePhotoPath)).catch(() => {})
  }
})