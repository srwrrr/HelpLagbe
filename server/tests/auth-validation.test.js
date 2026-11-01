import assert from 'node:assert/strict'
import { test } from 'node:test'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { app } from '../src/server.js'

const customerToken = jwt.sign(
  { userId: 1, role: 'customer' },
  process.env.JWT_SECRET || 'helplagbe-local-development-secret',
)

test('API root identifies the service and provides its health route', async () => {
  const response = await request(app).get('/')

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { name: 'HelpLagbe API', health: '/api/health' })
  assert.ok(response.headers['x-request-id'])
  assert.equal(response.headers['x-powered-by'], undefined)
})

test('login rejects malformed email before querying the database', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'not-an-email', password: 'ValidPass123' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Enter a valid email address.')
})

test('login rejects weak passwords before querying the database', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'customer@example.com', password: 'short' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Password must be at least 8 characters and include letters and numbers.')
})

test('customer registration rejects passwords that login would reject', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ username: 'Test Customer', email: 'customer@example.com', password: 'short' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Password must be at least 8 characters and include letters and numbers.')
})

test('customer registration rejects malformed email before querying the database', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ username: 'Test Customer', email: 'not-an-email', password: 'ValidPass123' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Enter a valid email address.')
})

test('technician registration validates credentials before opening a database connection', async () => {
  const response = await request(app)
    .post('/api/auth/register-technician')
    .send({ username: 'Test Technician', email: 'tech@example.com', password: 'weak', nationalId: 'NID-1234', skills: 'Plumbing' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Password must be at least 8 characters and include letters and numbers.')
})

test('permanently deleting archived accounts requires administrator access', async () => {
  const anonymousResponse = await request(app).delete('/api/admin/archived-users/1')
  assert.equal(anonymousResponse.status, 401)

  const customerResponse = await request(app)
    .delete('/api/admin/archived-users/1')
    .set('Authorization', `Bearer ${customerToken}`)
  assert.equal(customerResponse.status, 403)
})

test('profile updates require authentication and validate email before database access', async () => {
  const anonymousResponse = await request(app).patch('/api/profile').send({
    name: 'Updated Customer',
    email: 'not-an-email',
  })
  assert.equal(anonymousResponse.status, 401)

  const invalidEmailResponse = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ name: 'Updated Customer', email: 'not-an-email' })
  assert.equal(invalidEmailResponse.status, 400)
  assert.equal(invalidEmailResponse.body.message, 'Enter a valid email address.')
})

test('profile photo updates reject non-image data for every signed-in role', async () => {
  for (const role of ['customer', 'technician', 'admin']) {
    const token = jwt.sign(
      { userId: 1, role },
      process.env.JWT_SECRET || 'helplagbe-local-development-secret',
    )
    const response = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Account',
        email: 'account@example.com',
        skills: 'Valid technician skills',
        profileImage: 'data:text/plain;base64,SGVsbG8=',
      })

    assert.equal(response.status, 400)
    assert.equal(response.body.message, 'Attach a valid JPG, PNG, or WebP image.')
  }
})

test('offers require a future proposed appointment before database access', async () => {
  const technicianToken = jwt.sign(
    { userId: 2, role: 'technician' },
    process.env.JWT_SECRET || 'helplagbe-local-development-secret',
  )
  const response = await request(app)
    .post('/api/tasks/bid')
    .set('Authorization', `Bearer ${technicianToken}`)
    .send({ postId: 1, price: 250 })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Choose a proposed appointment date and time in the future.')
})

test('rescheduling and cancellation require a future time and an explanation', async () => {
  const invalidSchedule = await request(app)
    .post('/api/tasks/1/schedule')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ proposedAt: '2020-01-01T10:00:00.000Z', reason: 'Need to change the visit' })
  assert.equal(invalidSchedule.status, 400)

  const missingCancellationReason = await request(app)
    .post('/api/tasks/1/cancel')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ reason: 'No' })
  assert.equal(missingCancellationReason.status, 400)
})

test('payment confirmation requires an explicit supported method', async () => {
  const response = await request(app)
    .post('/api/tasks/1/payment/confirm')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ paymentMethod: 'credit_card' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Choose cash, bank transfer, or other as the payment method.')
})

test('reports require a meaningful description before database access', async () => {
  const response = await request(app)
    .post('/api/reports')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ reportType: 'task', category: 'Safety', description: 'Bad' })

  assert.equal(response.status, 400)
})

test('only admins can open the report review queue', async () => {
  const response = await request(app)
    .get('/api/admin/reports')
    .set('Authorization', `Bearer ${customerToken}`)
  assert.equal(response.status, 403)
})

test('completed-task reviews reject unlisted compliments before database access', async () => {
  const response = await request(app)
    .post('/api/tasks/1/review')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ rating: 5, compliments: ['Invented compliment'] })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Choose up to 5 compliments from the suggested list.')
})

test('completed-task reviews limit selected compliments to five', async () => {
  const response = await request(app)
    .post('/api/tasks/1/review')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      rating: 5,
      compliments: ['On time', 'Great communication', 'Professional', 'Quality work', 'Fair price', 'Clean and careful'],
    })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Choose up to 5 compliments from the suggested list.')
})

test('request creation rejects categories outside the supported list', async () => {
  const response = await request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ detail: 'A sufficiently detailed repair request', category: 'Unlisted service' })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Choose a valid service category.')
})

test('request creation rejects image bytes that do not match the claimed MIME type', async () => {
  const invalidPng = Buffer.from('not a png').toString('base64')
  const response = await request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      detail: 'A sufficiently detailed repair request',
      category: 'Plumbing',
      imageData: `data:image/png;base64,${invalidPng}`,
    })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Image contents do not match the selected file type.')
})

test('login rejects passwords beyond bcrypt supported byte length', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'customer@example.com', password: `ValidPass123${'x'.repeat(80)}` })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'Password must be at least 8 characters and include letters and numbers.')
})