import assert from 'node:assert/strict'
import { test } from 'node:test'
import request from 'supertest'
import { app } from '../src/server.js'

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