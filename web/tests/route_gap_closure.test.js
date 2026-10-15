/**
 * Phase 5B gap closure for handlers the security matrix flagged: invitation GET/HEAD (removed contract), tour-seen, Outlook webhook.
 * Real routes, throwaway DB. The Microsoft side is NOT exercised (provider URLs are fixed; no live Microsoft app) — FAKE-VERIFIED only.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok, peer
test.before(async () => {
  db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}; for (const r of ['employee', 'manager']) tok[r] = (await kit.login(A[r].email)).accessToken
})
test.after(async () => { await db.collection('outlooktokens').deleteMany({ orgId: A.orgId }); await kit.cleanupAll(db); await kit.disconnect() })

test('G1. GET/HEAD /api/auth/invitations/[token] are removed: 405 + Allow: POST, no-store, never read or echo the path token, no DB lookup side effects', async () => {
  const secret = 'zz' + kit.rand().slice(0, 4)   // short on purpose: a token-shaped path segment would (rightly) trip the log-secret guard
  const g = await kit.api(`/api/auth/invitations/${secret}`); assert.equal(g.status, 405); assert.match(g.headers.get('allow') || '', /POST/); assert.match(g.headers.get('cache-control') || '', /no-store/)
  assert.doesNotMatch(g.text, new RegExp(secret)); assert.equal(g.json.code, 'endpoint_removed')
  const h = await kit.api(`/api/auth/invitations/${secret}`, { method: 'HEAD' }); assert.equal(h.status, 405); assert.equal(h.text, '')
  for (const m of ['POST', 'PUT', 'DELETE']) assert.ok([404, 405].includes((await kit.api(`/api/auth/invitations/${secret}`, { method: m, body: {} })).status))
  const real = await kit.api('/api/auth/invitations/verify', { method: 'POST', body: { token: secret } }); assert.ok([400, 404, 410].includes(real.status), real.text); assert.notEqual(real.json && real.json.valid, true)
})

test('G2. POST /api/auth/tour-seen: anonymous 401; a signed-in user marks only THEMSELVES; idempotent; body and query are ignored; GET is not allowed', async () => {
  assert.equal((await kit.api('/api/auth/tour-seen', { method: 'POST' })).status, 401)
  assert.equal((await kit.api('/api/auth/tour-seen', { method: 'POST', token: 'not-a-token' })).status, 401)
  await db.collection('users').updateMany({ orgId: A.orgId }, { $set: { tourSeen: false } })
  const r = await kit.api(`/api/auth/tour-seen?userId=${A.manager.id}`, { method: 'POST', token: tok.employee, body: { userId: A.manager.id, tourSeen: false, role: 'admin' } }); assert.equal(r.status, 200, r.text)
  assert.equal((await db.collection('users').findOne({ email: A.employee.email })).tourSeen, true)
  assert.notEqual((await db.collection('users').findOne({ email: A.manager.email })).tourSeen, true, 'another user is untouched')
  assert.equal((await db.collection('users').findOne({ email: A.employee.email })).role, 'employee')
  assert.equal((await kit.api('/api/auth/tour-seen', { method: 'POST', token: tok.employee })).status, 200)
  assert.equal((await kit.api('/api/auth/tour-seen', { token: tok.employee })).status, 405)
})

test('G3. Outlook webhook GET: handshake echoes the token as inert text/plain (nosniff, no-store, bounded); no token → 404', async () => {
  const r = await kit.api('/api/webhooks/outlook?validationToken=abc%3Cscript%3E123'); assert.equal(r.status, 200); assert.equal(r.text, 'abc<script>123')
  assert.match(r.headers.get('content-type') || '', /^text\/plain/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('cache-control') || '', /no-store/)
  assert.equal((await kit.api('/api/webhooks/outlook?validationToken=' + 'x'.repeat(2000))).status, 400)
  assert.equal((await kit.api('/api/webhooks/outlook')).status, 404)
})

test('G4. Outlook webhook POST: forged / missing clientState and unknown subscriptions change nothing; broken bodies are 4xx; oversized batches are refused', async () => {
  await db.collection('outlooktokens').insertOne({ orgId: A.orgId, userId: A.employee.id, email: 'x@y.test', accessToken: 'AT', refreshToken: 'RT', expiresAt: new Date(Date.now() - 3600e3), subscriptionId: 'sub-' + A.orgId })
  const before = JSON.stringify(await db.collection('outlooktokens').findOne({ orgId: A.orgId }))
  for (const clientState of [undefined, '', 'wrong', 'doppeldash-secret', 'x'.repeat(5000)]) {
    const r = await kit.api('/api/webhooks/outlook', { method: 'POST', body: { value: [{ clientState, subscriptionId: 'sub-' + A.orgId, resourceData: { id: 'm1' }, changeType: 'created' }] } })
    assert.equal(r.status, 200, `${clientState}: ${r.text}`)
  }
  assert.equal(JSON.stringify(await db.collection('outlooktokens').findOne({ orgId: A.orgId })), before, 'a forged notification must not refresh tokens or touch anything')
  assert.equal((await kit.api('/api/webhooks/outlook', { method: 'POST', body: { value: [{ clientState: 'x', subscriptionId: 'nope', resourceData: { id: 'm1' } }] } })).status, 200)
  for (const raw of ['{bad', '[]', 'null', '"x"']) assert.equal((await kit.api('/api/webhooks/outlook', { method: 'POST', raw, headers: { 'Content-Type': 'application/json' } })).status, 400, raw)
  assert.equal((await kit.api('/api/webhooks/outlook', { method: 'POST', body: { value: 'not-an-array' } })).status, 200)
  const many = Array.from({ length: 101 }, (_, i) => ({ clientState: 'x', subscriptionId: 's' + i, resourceData: { id: 'm' } }))
  assert.equal((await kit.api('/api/webhooks/outlook', { method: 'POST', body: { value: many } })).status, 413)
})

test('G5. GET /api/health: public liveness + provenance — no session needed, no-store, only {status, commit, context}; writes are not allowed; no secrets or tenant data', async () => {
  const r = await kit.api('/api/health'); assert.equal(r.status, 200, r.text)
  assert.deepEqual(Object.keys(r.json).sort(), ['commit', 'context', 'status']); assert.equal(r.json.status, 'ok')
  assert.ok(r.json.commit === null || /^[0-9a-f]{7,40}$/i.test(r.json.commit)); assert.ok(['production', 'staging', 'unset'].includes(r.json.context))
  assert.match(r.headers.get('cache-control') || '', /no-store/); assert.doesNotMatch(r.text, /mongodb|secret|key|org_|@/i)
  assert.equal((await kit.api('/api/health', { method: 'HEAD' })).status, 200)
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await kit.api('/api/health', { method: m, body: {} })).status, 405)
})
