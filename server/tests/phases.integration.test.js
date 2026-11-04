import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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
const databaseCa = process.env.DB_SSL_CA_PATH ? readFileSync(process.env.DB_SSL_CA_PATH, 'utf8') : process.env.DB_SSL_CA || undefined
const pool = mysql.createPool({
  host: databaseUrl ? databaseUrl.hostname : process.env.DB_HOST,
  port: Number(databaseUrl ? databaseUrl.port || 3306 : process.env.DB_PORT || 3306),
  database: databaseUrl ? decodeURIComponent(databaseUrl.pathname.slice(1)) : process.env.DB_NAME,
  user: databaseUrl ? decodeURIComponent(databaseUrl.username) : process.env.DB_USER,
  password: databaseUrl ? decodeURIComponent(databaseUrl.password) : process.env.DB_PASSWORD,
  ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false', ...(databaseCa ? { ca: databaseCa } : {}) } } : {}),
  waitForConnections: true,
  connectionLimit: 2,
})

const secret = process.env.JWT_SECRET || 'helplagbe-local-development-secret'
const password = 'PhasesTest937Pass'
const suffix = randomUUID()
const emails = []
const uploads = []
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YQAAAABJRU5ErkJggg=='

const as = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`)

// 06:00 UTC = 12:00 in Dhaka, on a weekday.
function weekdayAppointment(daysAhead) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  date.setUTCHours(6, 0, 0, 0)
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

async function makeCustomer(label) {
  const email = `phases-${label}-${suffix}@example.invalid`
  emails.push(email)
  let response = await request(app).post('/api/auth/register').send({ username: `Phases ${label}`, email, password, phone: '01325409985' })
  assert.equal(response.status, 201, `register ${label}`)
  const [[user]] = await pool.execute('SELECT user_id FROM users WHERE email = ?', [email])
  return { token: jwt.sign({ userId: user.user_id, role: 'customer' }, secret, { expiresIn: '10m' }), userId: user.user_id, email }
}

async function makeTechnician(label, { verified = false } = {}) {
  const email = `phases-${label}-${suffix}@example.invalid`
  emails.push(email)
  let response = await request(app).post('/api/auth/register-technician').send({
    username: `Phases ${label}`, email, password, phone: '01325409986', nationalId: `PH-${label}-${suffix}`, skills: 'Verified plumbing specialist',
  })
  assert.equal(response.status, 201, `register technician ${label}`)
  const [[row]] = await pool.execute('SELECT technician_id, user_id FROM technician WHERE user_id = (SELECT user_id FROM users WHERE email = ?)', [email])
  await pool.execute("UPDATE technician SET status = 'approved' WHERE technician_id = ?", [row.technician_id])
  if (verified) await pool.execute("UPDATE technician SET Required_Documents = 'uploads/test-doc.png' WHERE technician_id = ?", [row.technician_id])
  return { token: jwt.sign({ userId: row.user_id, role: 'technician' }, secret, { expiresIn: '10m' }), userId: row.user_id, technicianId: row.technician_id, email }
}

async function postRequest(customer, detail = 'Leaking kitchen tap needs repair', extra = {}) {
  const response = await as('post', '/api/posts', customer.token).send({
    detail: `${detail} ${suffix}`, category: 'Plumbing', area: 'Dhanmondi', serviceAddress: 'Road 5, Dhanmondi, Dhaka', ...extra,
  })
  assert.equal(response.status, 201, `post request: ${JSON.stringify(response.body)}`)
  return response.body.id
}

async function bid(technician, postId, price = 500) {
  const response = await as('post', '/api/tasks/bid', technician.token).send({ postId, price, priceDetails: 'Includes parts and labour for the repair.', proposedAt: weekdayAppointment(2) })
  assert.equal(response.status, 201, `bid: ${JSON.stringify(response.body)}`)
  const [[task]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ? AND technician_id = ?', [postId, technician.technicianId])
  return task.task_id
}

async function completeJob(customer, technician, price = 500) {
  const postId = await postRequest(customer)
  const taskId = await bid(technician, postId, price)
  let response = await as('patch', `/api/tasks/${taskId}/status`, customer.token).send({ status: 'accepted' })
  assert.equal(response.status, 200, `accept: ${JSON.stringify(response.body)}`)
  response = await as('patch', `/api/technician/tasks/${taskId}/status`, technician.token).send({ status: 'in_progress' })
  assert.equal(response.status, 200, `start: ${JSON.stringify(response.body)}`)
  response = await as('patch', `/api/technician/tasks/${taskId}/status`, technician.token).send({ status: 'completed' })
  assert.equal(response.status, 200, `complete: ${JSON.stringify(response.body)}`)
  return { postId, taskId }
}

async function payJob(customer, technician, taskId) {
  let response = await as('post', `/api/tasks/${taskId}/payment/confirm`, customer.token).send({ paymentMethod: 'cash' })
  assert.equal(response.status, 200)
  response = await as('post', `/api/tasks/${taskId}/payment/confirm`, technician.token).send({ paymentMethod: 'cash' })
  assert.equal(response.status, 200)
  assert.equal(response.body.paymentStatus, 'paid')
}

let adminToken
before(async () => {
  if (!runIntegration) return
  await ensureTiDBIdSequences()
  const [admins] = await pool.query('SELECT user_id FROM users WHERE admin_id IS NOT NULL LIMIT 1')
  assert.ok(admins[0], 'integration database must contain an administrator')
  adminToken = jwt.sign({ userId: admins[0].user_id, role: 'admin' }, secret, { expiresIn: '10m' })
})

after(async () => {
  // Files first, so a database hiccup can never leave test uploads behind.
  for (const path of uploads) await unlink(resolve(process.cwd(), '..', path)).catch(() => {})
  try {
    if (runIntegration && emails.length) {
      await pool.query('DELETE FROM marketplace_reports WHERE reporter_id IN (SELECT user_id FROM users WHERE email IN (?))', [emails])
      await pool.query('DELETE FROM users WHERE email IN (?)', [emails])
    }
  } finally {
    await pool.end()
    await closeDatabasePool()
  }
})

const opts = { skip: !runIntegration }

// ---------------------------------------------------------------- Phase 1

test('phase 1: PWA files are present and the manifest is valid', () => {
  const publicDir = resolve(process.cwd(), '../client/public')
  for (const file of ['manifest.webmanifest', 'sw.js', 'icon.svg']) assert.ok(existsSync(resolve(publicDir, file)), `${file} exists`)
  const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.icons.length > 0 && manifest.start_url)
  const html = readFileSync(resolve(process.cwd(), '../client/index.html'), 'utf8')
  assert.match(html, /rel="manifest"/)
})

test('phase 1: ID-verified badge, onboarding checklist, earnings and analytics', opts, async () => {
  const customer = await makeCustomer('p1-customer')
  const verified = await makeTechnician('p1-verified', { verified: true })
  const plain = await makeTechnician('p1-plain')

  // ID verified badge
  let response = await request(app).get('/api/technicians').query({ search: 'Phases p1' })
  assert.equal(response.status, 200)
  const byId = Object.fromEntries(response.body.items.map((item) => [item.id, item]))
  assert.equal(Number(byId[verified.technicianId].idVerified), 1, 'technician with ID and documents is verified')
  assert.equal(Number(byId[plain.technicianId].idVerified), 0, 'technician without documents is not verified')

  // Onboarding checklist
  response = await as('get', '/api/technician/account-status', plain.token)
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'approved')
  const done = Object.fromEntries(response.body.checklist.map((item) => [item.id, item.done]))
  assert.equal(done.photo, false)
  assert.equal(done.area, false)
  assert.equal(done.documents, false)
  response = await as('patch', '/api/profile', plain.token).send({
    name: 'Phases p1-plain', email: plain.email, phone: '01325409986', skills: 'Plumbing, pipe fitting, water system installation', serviceAreas: ['Dhanmondi'],
  })
  assert.equal(response.status, 200)
  response = await as('get', '/api/technician/account-status', plain.token)
  assert.equal(response.body.checklist.find((item) => item.id === 'area').done, true)
  assert.equal(response.body.checklist.find((item) => item.id === 'skills').done, true)
  response = await as('get', '/api/technician/account-status', customer.token)
  assert.equal(response.status, 403, 'customers cannot read technician account status')

  // Earnings: empty, then one paid job, then one unpaid job
  response = await as('get', '/api/technician/earnings', verified.token)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.totals, { jobs: 0, paid: 0, outstanding: 0 })
  const paidJob = await completeJob(customer, verified, 750)
  await payJob(customer, verified, paidJob.taskId)
  await completeJob(customer, verified, 250)
  response = await as('get', '/api/technician/earnings', verified.token)
  assert.equal(response.body.totals.jobs, 2)
  assert.equal(response.body.totals.paid, 750)
  assert.equal(response.body.totals.outstanding, 250)
  assert.equal(response.body.months.length, 1)
  response = await as('get', '/api/technician/earnings', customer.token)
  assert.equal(response.status, 403)

  // Analytics: admin only, and unmet demand reflects a request with no offers
  await postRequest(customer, 'Nobody has bid on this request')
  response = await as('get', '/api/admin/analytics', customer.token)
  assert.equal(response.status, 403)
  response = await as('get', '/api/admin/analytics', adminToken)
  assert.equal(response.status, 200)
  for (const key of ['completionRate', 'droppedRate', 'reports', 'requestsWithoutOffers']) assert.ok(key in response.body, key)
  assert.ok(response.body.completionRate >= 0 && response.body.completionRate <= 100)
  assert.ok(response.body.requestsWithoutOffers.some((row) => row.category.toLowerCase() === 'plumbing' && row.requests >= 1))
})

// ---------------------------------------------------------------- Phase 2

test('phase 2: technicians can review customers, and ratings reach other technicians', opts, async () => {
  const customer = await makeCustomer('p2-review-customer')
  const technician = await makeTechnician('p2-review-tech')
  const other = await makeTechnician('p2-review-other')
  const { taskId } = await completeJob(customer, technician)

  let response = await as('post', `/api/tasks/${taskId}/customer-review`, customer.token).send({ rating: 5 })
  assert.equal(response.status, 403, 'customers cannot use the technician review endpoint')
  response = await as('post', `/api/tasks/${taskId}/customer-review`, technician.token).send({ rating: 9 })
  assert.equal(response.status, 400, 'rating must be 1-5')
  response = await as('post', `/api/tasks/${taskId}/customer-review`, other.token).send({ rating: 5 })
  assert.equal(response.status, 404, 'a technician who did not do the job cannot review')
  response = await as('post', `/api/tasks/${taskId}/customer-review`, technician.token).send({ rating: 4, comment: 'On time and polite.' })
  assert.equal(response.status, 200)
  response = await as('post', `/api/tasks/${taskId}/customer-review`, technician.token).send({ rating: 2, comment: 'Changed my mind.' })
  assert.equal(response.status, 200, 'review can be updated')
  const [[count]] = await pool.execute('SELECT COUNT(*) AS total, MAX(rating) AS rating FROM customer_reviews WHERE task_id = ?', [taskId])
  assert.equal(Number(count.total), 1, 'updating does not create a duplicate')
  assert.equal(Number(count.rating), 2)
  response = await as('get', `/api/tasks/${taskId}/customer-review`, technician.token)
  assert.equal(response.body.rating, 2)

  const newPost = await postRequest(customer, 'Another job for rating visibility')
  response = await as('get', '/api/technician/requests', other.token)
  assert.equal(response.status, 200)
  const listed = response.body.find((item) => item.id === newPost)
  assert.ok(listed, 'other technician sees the new request')
  assert.equal(Number(listed.customerRating), 2)
  assert.equal(Number(listed.customerReviewCount), 1)
})

test('phase 2: blocking stops messages, offers and request visibility', opts, async () => {
  const customer = await makeCustomer('p2-block-customer')
  const technician = await makeTechnician('p2-block-tech')
  const { taskId } = await completeJob(customer, technician)

  let response = await as('post', `/api/messages/${taskId}`, customer.token).send({ body: 'Thanks for the work!' })
  assert.equal(response.status, 201)
  response = await as('post', '/api/blocks', customer.token).send({ userId: customer.userId })
  assert.equal(response.status, 400, 'cannot block yourself')
  response = await as('post', '/api/blocks', customer.token).send({ userId: 99999999 })
  assert.equal(response.status, 404, 'cannot block a user that does not exist')
  response = await as('post', '/api/blocks', customer.token).send({ userId: technician.userId })
  assert.equal(response.status, 201)
  response = await as('post', '/api/blocks', customer.token).send({ userId: technician.userId })
  assert.equal(response.status, 201, 'blocking twice is harmless')
  response = await as('get', '/api/blocks', customer.token)
  assert.equal(response.body.length, 1)
  assert.equal(response.body[0].userId, technician.userId)

  response = await as('get', '/api/messages', customer.token)
  assert.equal(Boolean(Number(response.body.find((item) => item.taskId === taskId).blockedByMe)), true)
  response = await as('post', `/api/messages/${taskId}`, customer.token).send({ body: 'Hello again' })
  assert.equal(response.status, 403, 'blocker cannot message')
  response = await as('post', `/api/messages/${taskId}`, technician.token).send({ body: 'Hello' })
  assert.equal(response.status, 403, 'blocked user cannot message')

  const postId = await postRequest(customer, 'Request hidden from a blocked technician')
  response = await as('get', '/api/technician/requests', technician.token)
  assert.ok(!response.body.some((item) => item.id === postId), 'blocked technician no longer sees the request')
  response = await as('post', '/api/tasks/bid', technician.token).send({ postId, price: 300, priceDetails: 'Includes parts and labour.', proposedAt: weekdayAppointment(2) })
  assert.equal(response.status, 403, 'blocked technician cannot bid')

  response = await as('delete', `/api/blocks/${technician.userId}`, customer.token)
  assert.equal(response.status, 200)
  response = await as('get', '/api/technician/requests', technician.token)
  assert.ok(response.body.some((item) => item.id === postId), 'request is visible again after unblocking')
  response = await as('post', `/api/messages/${taskId}`, technician.token).send({ body: 'Hello' })
  assert.equal(response.status, 201)
})

test('phase 2: warranty claims follow the allowed workflow', opts, async () => {
  const customer = await makeCustomer('p2-warranty-customer')
  const stranger = await makeCustomer('p2-warranty-stranger')
  const technician = await makeTechnician('p2-warranty-tech')
  const { taskId } = await completeJob(customer, technician)

  let response = await as('get', `/api/tasks/${taskId}/warranty`, customer.token)
  assert.equal(response.status, 200)
  assert.equal(response.body.canClaim, true)
  assert.equal(response.body.windowDays, 7)
  response = await as('get', `/api/tasks/${taskId}/warranty`, stranger.token)
  assert.equal(response.status, 404, 'non-participants cannot see claims')
  response = await as('post', `/api/tasks/${taskId}/warranty`, stranger.token).send({ description: 'This is not my job at all.' })
  assert.equal(response.status, 404)
  response = await as('post', `/api/tasks/${taskId}/warranty`, customer.token).send({ description: 'short' })
  assert.equal(response.status, 400)
  response = await as('post', `/api/tasks/${taskId}/warranty`, customer.token).send({ description: 'The tap is still dripping after the repair.' })
  assert.equal(response.status, 201)
  response = await as('post', `/api/tasks/${taskId}/warranty`, customer.token).send({ description: 'Submitting a second open claim again.' })
  assert.equal(response.status, 409, 'only one open claim at a time')
  const [[notice]] = await pool.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'warranty_claim'", [technician.userId])
  assert.equal(Number(notice.total), 1, 'technician is notified')

  response = await as('get', `/api/tasks/${taskId}/warranty`, technician.token)
  const claim = response.body.claims[0]
  assert.equal(claim.status, 'open')
  assert.equal(response.body.canClaim, false, 'technicians cannot raise claims')
  response = await as('patch', `/api/warranty/${claim.id}`, customer.token).send({ status: 'accepted', note: 'I should not be able to do this' })
  assert.equal(response.status, 404, 'customers cannot respond to their own claim')
  response = await as('patch', `/api/warranty/${claim.id}`, technician.token).send({ status: 'accepted', note: 'no' })
  assert.equal(response.status, 400, 'a response note is required')
  response = await as('patch', `/api/warranty/${claim.id}`, technician.token).send({ status: 'resolved', note: 'Trying to skip a step' })
  assert.equal(response.status, 409, 'open claims cannot jump straight to resolved')
  response = await as('patch', `/api/warranty/${claim.id}`, technician.token).send({ status: 'accepted', note: 'I will come back tomorrow to fix it.' })
  assert.equal(response.status, 200)
  response = await as('patch', `/api/warranty/${claim.id}`, technician.token).send({ status: 'declined', note: 'Changing my mind later' })
  assert.equal(response.status, 409, 'accepted claims cannot be declined')
  response = await as('patch', `/api/warranty/${claim.id}`, technician.token).send({ status: 'resolved', note: 'Replaced the washer.' })
  assert.equal(response.status, 200)
  const [[update]] = await pool.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'warranty_update'", [customer.userId])
  assert.equal(Number(update.total), 2, 'customer is notified of each response')
  response = await as('get', `/api/tasks/${taskId}/warranty`, customer.token)
  assert.equal(response.body.canClaim, true, 'a new claim is possible once the previous one is closed')

  // After the 7 day window the claim is refused
  await pool.execute('UPDATE tasks SET completed_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE task_id = ?', [taskId])
  response = await as('post', `/api/tasks/${taskId}/warranty`, customer.token).send({ description: 'Raising a problem after the window closed.' })
  assert.equal(response.status, 409)
  response = await as('get', `/api/tasks/${taskId}/warranty`, customer.token)
  assert.equal(response.body.canClaim, false)
})

test('phase 2: dispute evidence and admin outcomes', opts, async () => {
  const customer = await makeCustomer('p2-report-customer')
  const technician = await makeTechnician('p2-report-tech')
  const { taskId } = await completeJob(customer, technician)

  let response = await as('post', '/api/reports', customer.token).send({
    reportType: 'dispute', taskId, category: 'Service not delivered', description: 'The work was not completed as agreed.', evidenceImage: 'data:image/png;base64,bm90IGFuIGltYWdl',
  })
  assert.equal(response.status, 400, 'evidence must be a real image')
  response = await as('post', '/api/reports', customer.token).send({
    reportType: 'dispute', taskId, category: 'Service not delivered', description: 'The work was not completed as agreed.', evidenceImage: tinyPng,
  })
  assert.equal(response.status, 201)
  const reportId = response.body.id
  const [[stored]] = await pool.execute('SELECT evidence_image, target_user_id FROM marketplace_reports WHERE report_id = ?', [reportId])
  assert.match(stored.evidence_image, /^uploads\/evidence_.+\.png$/)
  uploads.push(stored.evidence_image)
  assert.ok(existsSync(resolve(process.cwd(), '..', stored.evidence_image)), 'evidence file was written')
  assert.equal(stored.target_user_id, technician.userId)

  response = await as('get', '/api/admin/reports', adminToken)
  const listed = response.body.find((item) => item.id === reportId)
  assert.equal(listed.evidenceImage, stored.evidence_image)
  assert.equal(listed.outcome, 'none')

  response = await as('patch', `/api/admin/reports/${reportId}`, adminToken).send({ status: 'reviewing', outcome: 'warning' })
  assert.equal(response.status, 400, 'outcomes only apply when resolving')
  response = await as('patch', `/api/admin/reports/${reportId}`, adminToken).send({ status: 'resolved', resolutionNote: 'Short', outcome: 'bogus' })
  assert.equal(response.status, 400, 'unknown outcome rejected')
  response = await as('patch', `/api/admin/reports/${reportId}`, adminToken).send({ status: 'resolved', resolutionNote: 'Confirmed: work was incomplete.', outcome: 'technician_suspended' })
  assert.equal(response.status, 200)
  assert.match(response.body.message, /suspended/i)
  const [[tech]] = await pool.execute('SELECT status FROM technician WHERE technician_id = ?', [technician.technicianId])
  assert.equal(tech.status, 'suspended', 'report outcome suspends the technician')
  const [[audit]] = await pool.execute("SELECT COUNT(*) AS total FROM admin_audit_log WHERE action = 'technician_suspended' AND target_id = ?", [technician.technicianId])
  assert.ok(Number(audit.total) >= 1, 'suspension is audited')
  const [[outcomeNotice]] = await pool.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'report_outcome'", [technician.userId])
  assert.equal(Number(outcomeNotice.total), 1)
  response = await as('patch', `/api/admin/reports/${reportId}`, adminToken).send({ status: 'dismissed', resolutionNote: 'Trying to reopen it.' })
  assert.equal(response.status, 409, 'closed reports cannot be changed')
  response = await as('post', '/api/tasks/bid', technician.token).send({ postId: await postRequest(customer), price: 300, priceDetails: 'Includes parts and labour.', proposedAt: weekdayAppointment(2) })
  assert.equal(response.status, 403, 'a suspended technician cannot bid')

  // Warning outcome and a non-technician target
  const second = await completeJob(customer, await makeTechnician('p2-report-tech2'))
  response = await as('post', '/api/reports', technician.token).send({ reportType: 'dispute', taskId: second.taskId, category: 'Other', description: 'Reporting a job I was not part of at all.' })
  assert.equal(response.status, 404, 'non-participants cannot report a task')
  response = await as('post', '/api/reports', customer.token).send({ reportType: 'dispute', taskId: second.taskId, category: 'Other', description: 'Customer is reporting their own technician.' })
  assert.equal(response.status, 201)
  const warningId = response.body.id
  response = await as('patch', `/api/admin/reports/${warningId}`, adminToken).send({ status: 'resolved', resolutionNote: 'Verbal warning given.', outcome: 'warning' })
  assert.equal(response.status, 200)
  const [[after]] = await pool.execute("SELECT t.status FROM technician t JOIN marketplace_reports r ON r.target_user_id = t.user_id WHERE r.report_id = ?", [warningId])
  assert.equal(after.status, 'approved', 'a warning does not suspend')
})

test('suspension workflow: valid transitions, reasons, and open offers', opts, async () => {
  const customer = await makeCustomer('sus-customer')
  const technician = await makeTechnician('sus-tech')
  const postId = await postRequest(customer)
  const taskId = await bid(technician, postId)
  const setStatus = (status, reason) => as('patch', `/api/admin/technicians/${technician.technicianId}/status`, adminToken).send({ status, reason })

  let response = await setStatus('pending')
  assert.equal(response.status, 409, 'approved -> pending is not allowed')
  response = await setStatus('suspended')
  assert.equal(response.status, 400, 'a reason is required to suspend')
  response = await setStatus('bogus')
  assert.equal(response.status, 400)
  response = await as('patch', `/api/admin/technicians/${technician.technicianId}/status`, customer.token).send({ status: 'suspended', reason: 'I am not an admin' })
  assert.equal(response.status, 403)
  response = await setStatus('suspended', 'Repeated no-shows reported by customers.')
  assert.equal(response.status, 200)
  const [[withdrawn]] = await pool.execute('SELECT task_status FROM tasks WHERE task_id = ?', [taskId])
  assert.equal(withdrawn.task_status, 'withdrawn', 'open offers are withdrawn on suspension')
  const [[customerNotice]] = await pool.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'bid_withdrawn'", [customer.userId])
  assert.equal(Number(customerNotice.total), 1, 'the customer is told')
  response = await as('get', '/api/technician/account-status', technician.token)
  assert.equal(response.body.status, 'suspended')
  response = await as('get', '/api/technician/requests', technician.token)
  assert.deepEqual(response.body, [], 'a suspended technician sees no requests')
  response = await setStatus('suspended', 'Again')
  assert.equal(response.status, 409, 'suspended -> suspended is not a transition')
  response = await setStatus('pending')
  assert.equal(response.status, 409, 'suspended -> pending is not allowed')
  response = await setStatus('approved')
  assert.equal(response.status, 200, 'suspended -> approved is allowed without a reason')

  // Rejecting is blocked while a job is active; suspending is allowed
  const active = await completeJobInProgress(customer, technician)
  response = await setStatus('rejected', 'Quality concerns after review.')
  assert.equal(response.status, 409, 'cannot reject with an active job')
  assert.match(response.body.message, /active job/)
  response = await setStatus('suspended', 'Pausing while the job is investigated.')
  assert.equal(response.status, 200)
  assert.match(response.body.message, /active job/, 'admin is told about the active job')
  assert.ok(active)
})

async function completeJobInProgress(customer, technician) {
  const postId = await postRequest(customer, 'A job that stays in progress')
  const taskId = await bid(technician, postId)
  let response = await as('patch', `/api/tasks/${taskId}/status`, customer.token).send({ status: 'accepted' })
  assert.equal(response.status, 200)
  response = await as('patch', `/api/technician/tasks/${taskId}/status`, technician.token).send({ status: 'in_progress' })
  assert.equal(response.status, 200)
  return taskId
}

// ---------------------------------------------------------------- Phase 3 and service areas

const weekSchedule = (overrides = {}) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, { enabled: !['sat', 'sun'].includes(day), start: '09:00', end: '18:00', ...(overrides[day] || {}) }]))

// Next given weekday (0=Sun..6=Sat) at the given UTC hour, at least two days away.
function nextWeekday(dayOfWeek, utcHour) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 2)
  date.setUTCHours(utcHour, 0, 0, 0)
  while (date.getUTCDay() !== dayOfWeek) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

async function waitForCount(sql, params, wanted, tries = 20) {
  let total = 0
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const [[row]] = await pool.execute(sql, params)
    total = Number(row.total)
    if (total >= wanted) return total
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return total
}

test('service areas: list, validation, profile round-trip and request matching', opts, async () => {
  const customer = await makeCustomer('area-customer')
  const dhanmondi = await makeTechnician('area-dhanmondi')
  const mirpur = await makeTechnician('area-mirpur')

  let response = await request(app).get('/api/areas')
  assert.equal(response.status, 200)
  assert.equal(response.body.city, 'Dhaka')
  assert.ok(response.body.areas.includes('Dhanmondi') && response.body.areas.includes('Bashundhara R/A'))
  assert.equal(new Set(response.body.areas).size, response.body.areas.length)

  const profile = (technician, extra) => as('patch', '/api/profile', technician.token).send({ name: 'Area Tech', email: technician.email, phone: '01325409986', skills: 'Plumbing and repairs', ...extra })
  response = await profile(dhanmondi, { serviceAreas: ['Dhanmundi'] })
  assert.equal(response.status, 400, 'misspelt area rejected')
  response = await profile(dhanmondi, { serviceAreas: 'Dhanmondi' })
  assert.equal(response.status, 400, 'areas must be a list')
  response = await profile(dhanmondi, { serviceAreas: ['dhanmondi', 'DHANMONDI', 'Lalmatia'] })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.user.serviceAreas, ['Dhanmondi', 'Lalmatia'], 'canonicalised and de-duplicated')
  response = await profile(mirpur, { serviceAreas: ['Mirpur'] })
  assert.equal(response.status, 200)
  response = await as('get', '/api/profile', dhanmondi.token)
  assert.deepEqual(response.body.serviceAreas, ['Dhanmondi', 'Lalmatia'])
  response = await profile(dhanmondi, {})
  assert.equal(response.status, 200)
  const [[kept]] = await pool.execute('SELECT service_area FROM technician WHERE technician_id = ?', [dhanmondi.technicianId])
  assert.equal(kept.service_area, 'Dhanmondi, Lalmatia', 'omitting serviceAreas leaves them unchanged')

  // Requests need a valid area, and matching uses it
  response = await as('post', '/api/posts', customer.token).send({ detail: `No area ${suffix}`, category: 'Plumbing', serviceAddress: 'Road 5, Dhanmondi' })
  assert.equal(response.status, 400)
  const postId = await postRequest(customer, 'Area matching request', { area: 'lalmatia' })
  const [[stored]] = await pool.execute('SELECT area FROM posts WHERE post_id = ?', [postId])
  assert.equal(stored.area, 'Lalmatia', 'area stored in canonical form')
  response = await as('get', '/api/technician/requests', dhanmondi.token)
  const forDhanmondi = response.body.find((item) => item.id === postId)
  assert.equal(forDhanmondi.areaMatch, 1, 'technician covering Lalmatia matches')
  assert.equal(forDhanmondi.area, 'Lalmatia')
  assert.equal(forDhanmondi.matchAddress, undefined, 'private address is not leaked')
  assert.equal(forDhanmondi.viewerServiceArea, undefined)
  response = await as('get', '/api/technician/requests', mirpur.token)
  assert.equal(response.body.find((item) => item.id === postId).areaMatch, 0, 'Mirpur technician does not match')
  response = await as('patch', `/api/customer/posts/${postId}`, customer.token).send({ detail: `Edited ${suffix} request`, category: 'Plumbing', serviceAddress: 'Road 9, Mirpur' })
  assert.equal(response.status, 400, 'editing also requires an area')
  response = await as('patch', `/api/customer/posts/${postId}`, customer.token).send({ detail: `Edited ${suffix} request`, category: 'Plumbing', area: 'Mirpur', serviceAddress: 'Road 9, Mirpur' })
  assert.equal(response.status, 200)
  response = await as('get', '/api/technician/requests', mirpur.token)
  assert.equal(response.body.find((item) => item.id === postId).areaMatch, 1, 'edit moves the match to Mirpur')
})

test('phase 3: new requests alert technicians in the same area only', opts, async () => {
  const customer = await makeCustomer('alert-customer')
  const nearby = await makeTechnician('alert-nearby')
  const far = await makeTechnician('alert-far')
  const muted = await makeTechnician('alert-muted')
  const blocked = await makeTechnician('alert-blocked')
  const suspended = await makeTechnician('alert-suspended')
  await pool.query("UPDATE technician SET service_area = 'Dhanmondi, Mirpur' WHERE technician_id IN (?)", [[nearby.technicianId, muted.technicianId, blocked.technicianId, suspended.technicianId]])
  await pool.execute("UPDATE technician SET service_area = 'Uttara' WHERE technician_id = ?", [far.technicianId])
  await pool.execute('UPDATE technician SET request_alerts = 0 WHERE technician_id = ?', [muted.technicianId])
  await pool.execute("UPDATE technician SET status = 'suspended' WHERE technician_id = ?", [suspended.technicianId])
  let response = await as('post', '/api/blocks', customer.token).send({ userId: blocked.userId })
  assert.equal(response.status, 201)

  await postRequest(customer, 'Alert test request', { area: 'Dhanmondi' })
  const sql = "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'new_request_nearby'"
  assert.equal(await waitForCount(sql, [nearby.userId], 1), 1, 'technician in the area is alerted')
  await new Promise((resolveWait) => setTimeout(resolveWait, 300))
  for (const [label, tech] of [['other area', far], ['alerts off', muted], ['blocked', blocked], ['suspended', suspended]]) {
    const [[row]] = await pool.execute(sql, [tech.userId])
    assert.equal(Number(row.total), 0, `${label}: no alert`)
  }
  const [[own]] = await pool.execute(sql, [customer.userId])
  assert.equal(Number(own.total), 0)
})

test('phase 3: weekly availability is saved, summarised and enforced', opts, async () => {
  const customer = await makeCustomer('avail-customer')
  const technician = await makeTechnician('avail-tech')
  const put = (body) => as('put', '/api/technician/availability', technician.token).send(body)

  let response = await as('get', '/api/technician/availability', technician.token)
  assert.equal(response.body.schedule, null)
  assert.equal(response.body.alerts, true)
  response = await put({})
  assert.equal(response.status, 400)
  response = await put({ schedule: weekSchedule({ mon: { start: '25:00' } }) })
  assert.equal(response.status, 400, 'invalid time')
  response = await put({ schedule: weekSchedule({ mon: { start: '18:00', end: '09:00' } }) })
  assert.equal(response.status, 400, 'finish must be after start')
  response = await as('put', '/api/technician/availability', customer.token).send({ schedule: weekSchedule() })
  assert.equal(response.status, 403)
  response = await put({ schedule: weekSchedule({ sat: { enabled: true, start: '10:00', end: '14:00' } }), alerts: false })
  assert.equal(response.status, 200)
  assert.equal(response.body.summary, 'Mon-Fri 09:00-18:00, Sat 10:00-14:00')
  response = await as('get', '/api/technician/availability', technician.token)
  assert.equal(response.body.alerts, false)
  assert.equal(response.body.schedule.sat.enabled, true)
  const [[summary]] = await pool.execute('SELECT availability FROM technician WHERE technician_id = ?', [technician.technicianId])
  assert.equal(summary.availability, 'Mon-Fri 09:00-18:00, Sat 10:00-14:00')

  const postId = await postRequest(customer, 'Availability enforcement request')
  const offer = (proposedAt) => as('post', '/api/tasks/bid', technician.token).send({ postId, price: 400, priceDetails: 'Includes parts and labour.', proposedAt })
  response = await offer(nextWeekday(0, 6))
  assert.equal(response.status, 409, 'Sunday is closed')
  assert.match(response.body.message, /working hours/)
  response = await offer(nextWeekday(3, 1))
  assert.equal(response.status, 409, 'Wednesday 07:00 Dhaka is before opening')
  response = await offer(nextWeekday(3, 12))
  assert.equal(response.status, 409, 'Wednesday 18:00 Dhaka is closing time')
  response = await offer(nextWeekday(6, 9))
  assert.equal(response.status, 409, 'Saturday 15:00 Dhaka is after the shorter Saturday hours')
  response = await offer(nextWeekday(6, 5))
  assert.equal(response.status, 201, 'Saturday 11:00 Dhaka is inside Saturday hours')
  const [[task]] = await pool.execute('SELECT task_id FROM tasks WHERE post_id = ?', [postId])
  response = await as('patch', `/api/technician/tasks/${task.task_id}/bid`, technician.token).send({ price: 450, priceDetails: 'Includes parts and labour.', proposedAt: nextWeekday(0, 6) })
  assert.equal(response.status, 409, 'editing an offer to a closed time is refused')
  response = await as('patch', `/api/technician/tasks/${task.task_id}/bid`, technician.token).send({ price: 450, priceDetails: 'Includes parts and labour.', proposedAt: nextWeekday(2, 6) })
  assert.equal(response.status, 200)

  response = await as('patch', `/api/tasks/${task.task_id}/status`, customer.token).send({ status: 'accepted' })
  assert.equal(response.status, 200)
  response = await as('post', `/api/tasks/${task.task_id}/schedule`, customer.token).send({ proposedAt: nextWeekday(0, 6), reason: 'Sunday suits me better' })
  assert.equal(response.status, 409, 'a customer cannot propose a time the technician is closed')
  response = await as('post', `/api/tasks/${task.task_id}/schedule`, customer.token).send({ proposedAt: nextWeekday(4, 6), reason: 'Thursday suits me better' })
  assert.equal(response.status, 200)

  // The profile form no longer overwrites the schedule summary
  response = await as('patch', '/api/profile', technician.token).send({ name: 'Avail Tech', email: technician.email, phone: '01325409986', skills: 'Plumbing and repairs', availability: 'Whenever' })
  assert.equal(response.status, 200)
  const [[after]] = await pool.execute('SELECT availability FROM technician WHERE technician_id = ?', [technician.technicianId])
  assert.equal(after.availability, 'Mon-Fri 09:00-18:00, Sat 10:00-14:00')

  // A schedule with no open days refuses offers
  response = await put({ schedule: weekSchedule({ mon: { enabled: false }, tue: { enabled: false }, wed: { enabled: false }, thu: { enabled: false }, fri: { enabled: false } }) })
  assert.equal(response.status, 200)
  assert.equal(response.body.summary, 'Not currently available')
  const secondPost = await postRequest(customer, 'No open days request')
  response = await as('post', '/api/tasks/bid', technician.token).send({ postId: secondPost, price: 400, priceDetails: 'Includes parts and labour.', proposedAt: weekdayAppointment(2) })
  assert.equal(response.status, 409)
  assert.match(response.body.message, /not currently taking appointments/)
})

test('phase 3: saved addresses, favourites and rebooking data', opts, async () => {
  const customer = await makeCustomer('fav-customer')
  const other = await makeCustomer('fav-other')
  const technician = await makeTechnician('fav-tech')

  // Saved addresses
  let response = await as('post', '/api/saved-addresses', customer.token).send({ label: 'Home', serviceAddress: 'abc' })
  assert.equal(response.status, 400)
  response = await as('post', '/api/saved-addresses', customer.token).send({ label: 'Home', area: 'dhanmondi', serviceAddress: 'Road 5, House 3', building: 'Green House', flatNo: '4B' })
  assert.equal(response.status, 201)
  response = await as('get', '/api/saved-addresses', customer.token)
  assert.equal(response.body.length, 1)
  assert.deepEqual({ label: response.body[0].label, area: response.body[0].area, flatNo: response.body[0].flatNo }, { label: 'Home', area: 'Dhanmondi', flatNo: '4B' })
  const addressId = response.body[0].id
  response = await as('get', '/api/saved-addresses', other.token)
  assert.equal(response.body.length, 0, 'addresses are private')
  response = await as('delete', `/api/saved-addresses/${addressId}`, other.token)
  assert.equal(response.status, 200)
  response = await as('get', '/api/saved-addresses', customer.token)
  assert.equal(response.body.length, 1, "another user's delete does not remove it")
  for (let index = 2; index <= 5; index += 1) {
    response = await as('post', '/api/saved-addresses', customer.token).send({ label: `Place ${index}`, serviceAddress: `Road ${index}, Dhaka` })
    assert.equal(response.status, 201)
  }
  response = await as('post', '/api/saved-addresses', customer.token).send({ label: 'Sixth', serviceAddress: 'Road 6, Dhaka' })
  assert.equal(response.status, 409, 'limit of five saved addresses')
  response = await as('delete', `/api/saved-addresses/${addressId}`, customer.token)
  assert.equal(response.status, 200)
  response = await as('get', '/api/saved-addresses', customer.token)
  assert.equal(response.body.length, 4)

  // Favourites
  response = await as('post', '/api/favorites', technician.token).send({ technicianId: technician.technicianId })
  assert.equal(response.status, 403, 'only customers can favourite')
  response = await as('post', '/api/favorites', customer.token).send({ technicianId: 99999999 })
  assert.equal(response.status, 404)
  response = await as('post', '/api/favorites', customer.token).send({ technicianId: technician.technicianId })
  assert.equal(response.status, 201)
  response = await as('post', '/api/favorites', customer.token).send({ technicianId: technician.technicianId })
  assert.equal(response.status, 201, 'favouriting twice is harmless')
  const flagFor = async (token) => {
    const call = request(app).get('/api/technicians').query({ search: 'Phases fav-tech' })
    response = await (token ? call.set('Authorization', `Bearer ${token}`) : call)
    return Number(response.body.items.find((item) => item.id === technician.technicianId).favorite)
  }
  assert.equal(await flagFor(customer.token), 1)
  assert.equal(await flagFor(other.token), 0, 'favourites are per customer')
  assert.equal(await flagFor(null), 0, 'anonymous visitors see none')
  const [[favCount]] = await pool.execute('SELECT COUNT(*) AS total FROM favorite_technicians WHERE customer_id = ?', [customer.userId])
  assert.equal(Number(favCount.total), 1)
  response = await as('delete', `/api/favorites/${technician.technicianId}`, customer.token)
  assert.equal(response.status, 200)
  assert.equal(await flagFor(customer.token), 0)

  // Rebooking relies on the area and address coming back with the request
  const postId = await postRequest(customer, 'Rebook me', { area: 'Gulshan', building: 'Blue Tower', flatNo: '9C' })
  response = await as('get', '/api/customer/posts', customer.token)
  const mine = response.body.find((item) => item.id === postId)
  assert.equal(mine.area, 'Gulshan')
  assert.equal(mine.building, 'Blue Tower')
  assert.equal(mine.flatNo, '9C')
})

test('phase 3: running-late notices', opts, async () => {
  const customer = await makeCustomer('late-customer')
  const technician = await makeTechnician('late-tech')
  const postId = await postRequest(customer, 'Running late request')
  const taskId = await bid(technician, postId)
  let response = await as('post', `/api/tasks/${taskId}/running-late`, technician.token).send({ minutes: 20 })
  assert.equal(response.status, 409, 'not before the offer is accepted')
  response = await as('patch', `/api/tasks/${taskId}/status`, customer.token).send({ status: 'accepted' })
  assert.equal(response.status, 200)
  response = await as('post', `/api/tasks/${taskId}/running-late`, customer.token).send({ minutes: 20 })
  assert.equal(response.status, 403, 'only the technician can send it')
  for (const minutes of [0, 4, 241, 'soon', 12.5]) {
    response = await as('post', `/api/tasks/${taskId}/running-late`, technician.token).send({ minutes })
    assert.equal(response.status, 400, `rejects ${minutes}`)
  }
  const stranger = await makeTechnician('late-stranger')
  response = await as('post', `/api/tasks/${taskId}/running-late`, stranger.token).send({ minutes: 20 })
  assert.equal(response.status, 404, 'a technician on another job cannot send it')
  response = await as('post', `/api/tasks/${taskId}/running-late`, technician.token).send({ minutes: 20 })
  assert.equal(response.status, 200)
  const [[notice]] = await pool.execute("SELECT message FROM notifications WHERE user_id = ? AND type = 'running_late'", [customer.userId])
  assert.match(notice.message, /20 minutes/)
  response = await as('get', `/api/tasks/${taskId}/timeline`, customer.token)
  assert.ok(response.body.some((item) => item.type === 'running_late'), 'recorded on the timeline')
  response = await as('patch', `/api/technician/tasks/${taskId}/status`, technician.token).send({ status: 'in_progress' })
  assert.equal(response.status, 200)
  response = await as('post', `/api/tasks/${taskId}/running-late`, technician.token).send({ minutes: 20 })
  assert.equal(response.status, 409, 'not once work has started')
})

test('phase 3: photos in messages', opts, async () => {
  const customer = await makeCustomer('photo-customer')
  const technician = await makeTechnician('photo-tech')
  const stranger = await makeCustomer('photo-stranger')
  const { taskId } = await completeJob(customer, technician)

  let response = await as('post', `/api/messages/${taskId}`, customer.token).send({ body: '' })
  assert.equal(response.status, 400, 'empty message rejected')
  response = await as('post', `/api/messages/${taskId}`, customer.token).send({ body: '', imageData: 'data:image/png;base64,bm90IGFuIGltYWdl' })
  assert.equal(response.status, 400, 'fake image rejected')
  response = await as('post', `/api/messages/${taskId}`, customer.token).send({ body: '', imageData: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' })
  assert.equal(response.status, 400, 'unsupported image type rejected')
  response = await as('post', `/api/messages/${taskId}`, stranger.token).send({ body: 'hi', imageData: tinyPng })
  assert.equal(response.status, 404, 'non-participants cannot post')
  response = await as('post', `/api/messages/${taskId}`, customer.token).send({ body: '', imageData: tinyPng })
  assert.equal(response.status, 201, 'a photo alone is a valid message')
  response = await as('post', `/api/messages/${taskId}`, technician.token).send({ body: 'Got it, thanks', imageData: tinyPng })
  assert.equal(response.status, 201, 'text with a photo')
  response = await as('get', `/api/messages/${taskId}`, technician.token)
  assert.equal(response.body.length, 2)
  assert.match(response.body[0].image, /^uploads\/message_.+\.png$/)
  assert.equal(response.body[0].body, '')
  assert.equal(response.body[1].body, 'Got it, thanks')
  for (const message of response.body) {
    uploads.push(message.image)
    assert.ok(existsSync(resolve(process.cwd(), '..', message.image)), 'photo file written')
  }
  response = await as('get', `/api/messages/${taskId}`, stranger.token)
  assert.equal(response.status, 404, 'photos are only visible to participants')
})

// ---------------------------------------------------------------- Analytics and history

async function analyticsFixture(label) {
  const customer = await makeCustomer(`${label}-customer`)
  const other = await makeCustomer(`${label}-other`)
  const technician = await makeTechnician(`${label}-tech`)
  const rival = await makeTechnician(`${label}-rival`)

  const paid = await completeJob(customer, technician, 750)
  await payJob(customer, technician, paid.taskId)
  let response = await as('post', `/api/tasks/${paid.taskId}/review`, customer.token).send({ rating: 5, review: 'Great work' })
  assert.equal(response.status, 200)
  const unpaid = await completeJob(customer, technician, 250)

  // A job the customer cancels after accepting
  const cancelPost = await postRequest(customer, '=HYPERLINK("http://example.invalid") cancelled job')
  const cancelTask = await bid(technician, cancelPost, 300)
  response = await as('patch', `/api/tasks/${cancelTask}/status`, customer.token).send({ status: 'accepted' })
  assert.equal(response.status, 200)
  response = await as('post', `/api/tasks/${cancelTask}/cancel`, customer.token).send({ reason: 'Plans changed, no longer needed.' })
  assert.equal(response.status, 200, `cancel: ${JSON.stringify(response.body)}`)

  // A rival whose offer is turned down because the customer hires the other technician
  const contested = await postRequest(customer, 'Contested job with two offers')
  const rivalTask = await bid(rival, contested, 420)
  const winnerTask = await bid(technician, contested, 400)
  response = await as('patch', `/api/tasks/${winnerTask}/status`, customer.token).send({ status: 'accepted' })
  assert.equal(response.status, 200)
  const [[rivalState]] = await pool.execute('SELECT task_status FROM tasks WHERE task_id = ?', [rivalTask])
  assert.equal(rivalState.task_status, 'rejected')
  return { customer, other, technician, rival, paid, unpaid, cancelTask, rivalTask, winnerTask }
}

test('analytics: customers see their spending, jobs and technicians', opts, async () => {
  const f = await analyticsFixture('an-cust')
  let response = await as('get', '/api/analytics/me', f.customer.token)
  assert.equal(response.status, 200)
  assert.equal(response.body.role, 'customer')
  assert.equal(response.body.months, 6)
  assert.equal(response.body.monthly.length, 6)
  assert.equal(response.body.kpis.completedJobs, 2)
  assert.equal(response.body.kpis.paid, 750)
  assert.equal(response.body.kpis.outstanding, 250)
  assert.equal(response.body.kpis.averageJobCost, 500)
  assert.equal(response.body.kpis.cancelledJobs, 1)
  assert.equal(response.body.kpis.averageRatingGiven, 5)
  assert.equal(response.body.kpis.reviewsGiven, 1)
  assert.equal(response.body.kpis.repeatTechnicians, 1)
  const current = response.body.monthly.at(-1)
  assert.deepEqual({ jobs: current.jobs, paid: current.paid, outstanding: current.outstanding }, { jobs: 2, paid: 750, outstanding: 250 })
  assert.equal(response.body.monthly.slice(0, -1).every((row) => row.jobs === 0 && row.paid === 0), true, 'earlier months are zero-filled')
  assert.equal(response.body.categories[0].category.toLowerCase(), 'plumbing')
  assert.equal(response.body.categories[0].jobs, 2)
  assert.equal(response.body.topTechnicians[0].technicianId, f.technician.technicianId)
  assert.equal(response.body.topTechnicians[0].jobs, 2)
  assert.equal(response.body.topTechnicians[0].rating, 5)
  assert.ok(response.body.requests.total >= 4)
  assert.ok(response.body.requests.hired >= 3)

  response = await as('get', '/api/analytics/me', f.customer.token).query({ months: 3 })
  assert.equal(response.body.monthly.length, 3)
  response = await as('get', '/api/analytics/me', f.customer.token).query({ months: 99 })
  assert.equal(response.body.months, 6, 'unsupported range falls back to 6 months')

  response = await as('get', '/api/analytics/me', f.other.token)
  assert.equal(response.status, 200)
  assert.equal(response.body.kpis.completedJobs, 0, "another customer's numbers are empty")
  assert.equal(response.body.kpis.averageJobCost, null)
  assert.deepEqual(response.body.topTechnicians, [])
  response = await as('get', '/api/analytics/me', adminToken)
  assert.equal(response.status, 403)
  response = await request(app).get('/api/analytics/me')
  assert.equal(response.status, 401)
})

test('analytics: technicians see earnings, offers, ratings and response times', opts, async () => {
  const f = await analyticsFixture('an-tech')
  let response = await as('get', '/api/analytics/me', f.technician.token)
  assert.equal(response.status, 200)
  assert.equal(response.body.role, 'technician')
  assert.equal(response.body.kpis.completedJobs, 2)
  assert.equal(response.body.kpis.paid, 750)
  assert.equal(response.body.kpis.outstanding, 250)
  assert.equal(response.body.kpis.averageJobValue, 500)
  assert.equal(response.body.kpis.averageRating, 5)
  assert.equal(response.body.kpis.reviews, 1)
  assert.equal(response.body.kpis.offerWinRate, 100, 'no declined offers yet')
  assert.equal(response.body.kpis.repeatCustomers, 1)
  assert.equal(response.body.kpis.cancelledByYouRate, 0, 'the customer cancelled, not the technician')
  assert.ok(response.body.kpis.averageResponseMinutes >= 0)
  assert.equal(response.body.offers.sent, 4)
  assert.equal(response.body.offers.completed, 2)
  assert.equal(response.body.offers.hired, 3, 'two completed plus the contested job that is now accepted')
  assert.equal(response.body.ratings.length, 5)
  assert.equal(response.body.ratings.find((row) => row.rating === 5).total, 1)
  assert.equal(response.body.ratings.find((row) => row.rating === 1).total, 0)
  assert.equal(response.body.monthly.at(-1).paid, 750)
  assert.equal(response.body.categories[0].jobs, 2)

  response = await as('get', '/api/analytics/me', f.rival.token)
  assert.equal(response.body.offers.sent, 1)
  assert.equal(response.body.offers.declined, 1)
  assert.equal(response.body.kpis.offerWinRate, 0)
  assert.equal(response.body.kpis.completedJobs, 0)
  assert.equal(response.body.kpis.averageRating, null)
})

test('analytics: admins see marketplace trends and unmet demand', opts, async () => {
  const f = await analyticsFixture('an-admin')
  const noOffer = await postRequest(f.customer, 'Nobody has bid on this one', { area: 'Uttara' })
  assert.ok(noOffer)
  let response = await as('get', '/api/admin/analytics', f.customer.token)
  assert.equal(response.status, 403)
  response = await as('get', '/api/admin/analytics', adminToken)
  assert.equal(response.status, 200)
  assert.equal(response.body.months, 6)
  assert.equal(response.body.monthly.length, 6)
  const current = response.body.monthly.at(-1)
  assert.ok(current.requests >= 4 && current.completed >= 2 && current.paid >= 750)
  assert.ok(current.customers >= 2 && current.technicians >= 2)
  assert.deepEqual(Object.keys(response.body.technicianStatus).sort(), ['approved', 'pending', 'rejected', 'suspended'])
  assert.ok(response.body.technicianStatus.approved >= 2)
  assert.ok(response.body.requestsWithoutOffersByArea.some((row) => row.area === 'Uttara' && row.requests >= 1))
  assert.ok(response.body.requestsWithoutOffers.some((row) => row.requests >= 1))
  assert.ok(response.body.categories.length >= 1)
  for (const key of ['completionRate', 'droppedRate', 'averageMinutesToFirstOffer', 'reports']) assert.ok(key in response.body, key)
  response = await as('get', '/api/admin/analytics', adminToken).query({ months: 12 })
  assert.equal(response.body.monthly.length, 12)
})

test('history: customers and technicians can filter, page and export finished jobs', opts, async () => {
  const f = await analyticsFixture('hist')
  const today = new Date().toISOString().slice(0, 10)
  const customerHistory = (query = {}) => as('get', '/api/history', f.customer.token).query(query)

  let response = await customerHistory()
  assert.equal(response.status, 200)
  assert.equal(response.body.items.length, 3, 'two completed and one cancelled; the open contested job is not history')
  assert.deepEqual(response.body.totals, { total: 3, completed: 2, cancelled: 1, paid: 750, outstanding: 250 })
  assert.equal(response.body.pagination.total, 3)
  const completed = response.body.items.find((item) => item.taskId === f.paid.taskId)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.value, 750)
  assert.equal(completed.paymentStatus, 'paid')
  assert.equal(completed.receiptNumber, `HL-${f.paid.taskId}`)
  assert.equal(completed.counterpart, 'Phases hist-tech')
  assert.equal(completed.rating, 5)
  assert.equal(completed.area, 'Dhanmondi')
  const cancelled = response.body.items.find((item) => item.taskId === f.cancelTask)
  assert.equal(cancelled.status, 'cancelled')
  assert.match(cancelled.cancelReason, /Plans changed/)

  response = await customerHistory({ status: 'completed' })
  assert.equal(response.body.items.length, 2)
  assert.ok(response.body.items.every((item) => item.status === 'completed'))
  response = await customerHistory({ status: 'cancelled' })
  assert.equal(response.body.items.length, 1)
  response = await customerHistory({ status: 'declined' })
  assert.equal(response.body.items.length, 0, 'customers have no declined offers in history')
  response = await customerHistory({ q: 'Phases hist-tech' })
  assert.equal(response.body.items.length, 3, 'search by technician name')
  response = await customerHistory({ q: `HL-${f.paid.taskId}` })
  assert.equal(response.body.items.length, 1, 'search by receipt number')
  response = await customerHistory({ q: '%' })
  assert.equal(response.body.items.length, 0, 'wildcards in the search are matched literally')
  response = await customerHistory({ q: 'no such text anywhere' })
  assert.equal(response.body.items.length, 0)
  response = await customerHistory({ from: today, to: today })
  assert.equal(response.body.items.length, 3, 'date range is inclusive of today')
  response = await customerHistory({ from: '2999-01-01' })
  assert.equal(response.body.items.length, 0)
  response = await customerHistory({ to: '2000-01-01' })
  assert.equal(response.body.items.length, 0)
  response = await customerHistory({ from: 'not-a-date', status: 'nonsense' })
  assert.equal(response.body.items.length, 3, 'invalid filters are ignored')
  response = await customerHistory({ limit: 1, page: 2 })
  assert.equal(response.body.items.length, 1)
  assert.equal(response.body.pagination.total, 3)
  assert.equal(response.body.pagination.page, 2)

  response = await as('get', '/api/history', f.other.token)
  assert.equal(response.body.items.length, 0, 'history is private to the customer')
  response = await as('get', '/api/history', adminToken)
  assert.equal(response.status, 403)
  response = await request(app).get('/api/history')
  assert.equal(response.status, 401)

  // Technician view: counterpart names appear for jobs they did, declined offers hide the customer
  response = await as('get', '/api/history', f.technician.token)
  assert.equal(response.status, 200)
  assert.equal(response.body.items.length, 3)
  assert.equal(response.body.items.find((item) => item.taskId === f.paid.taskId).counterpart, 'Phases hist-customer')
  assert.equal(response.body.totals.paid, 750)
  response = await as('get', '/api/history', f.rival.token)
  assert.equal(response.body.items.length, 1)
  assert.equal(response.body.items[0].status, 'rejected')
  assert.equal(response.body.items[0].counterpart, null, 'the customer of a declined offer is not revealed')
  response = await as('get', '/api/history', f.rival.token).query({ status: 'declined' })
  assert.equal(response.body.items.length, 1)
  response = await as('get', '/api/history', f.rival.token).query({ status: 'completed' })
  assert.equal(response.body.items.length, 0)

  // CSV export honours the filters and neutralises spreadsheet formulas
  response = await as('get', '/api/history/export', f.customer.token)
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/csv/)
  assert.match(response.headers['content-disposition'], /attachment/)
  const lines = response.text.trim().split('\n')
  assert.equal(lines[0], '"Date","Job","Category","Area","Technician","Status","Amount (BDT)","Payment","Receipt","Rating"')
  assert.equal(lines.length, 4)
  assert.ok(response.text.includes(`HL-${f.paid.taskId}`))
  assert.ok(response.text.includes('"\'=HYPERLINK'), 'formula-looking text is prefixed so spreadsheets do not run it')
  response = await as('get', '/api/history/export', f.customer.token).query({ status: 'cancelled' })
  assert.equal(response.text.trim().split('\n').length, 2)
  response = await as('get', '/api/history/export', f.technician.token)
  assert.match(response.text.split('\n')[0], /"Customer"/)
  response = await as('get', '/api/history/export', adminToken)
  assert.equal(response.status, 403)
})
