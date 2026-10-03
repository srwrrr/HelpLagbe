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