import assert from 'node:assert/strict'
import test from 'node:test'
import { turnstileValid } from './turnstile.ts'
import { sessionHash } from './session.ts'

test('Turnstile requires success, the expected action, and the production hostname', () => {
  const hostname = '202608.momoshimin-saikainohi.anatofuz.net'
  assert.equal(turnstileValid({ success: true, action: 'submit_moment', hostname }, hostname), true)
  assert.equal(turnstileValid({ success: true, action: 'upload_image', hostname }, hostname), false)
  assert.equal(turnstileValid({ success: true, action: 'submit_moment', hostname: 'example.com' }, hostname), false)
  assert.equal(turnstileValid({ success: false, action: 'submit_moment', hostname }, hostname), false)
})

test('registration uses a distinct Turnstile action and sessions are stored as hashes', async () => {
  const hostname = '202608.momoshimin-saikainohi.anatofuz.net'
  assert.equal(turnstileValid({ success: true, action: 'register_profile', hostname }, hostname, 'register_profile'), true)
  assert.notEqual(await sessionHash('session-a'), 'session-a')
  assert.notEqual(await sessionHash('session-a'), await sessionHash('session-b'))
})
