/**
 * Outlook connect flow: the OAuth `state` is a signed, expiring value bound to the signed-in user (it used to be the bare user id, so any
 * crafted callback could attach an attacker's mailbox to another user). Rejections happen BEFORE any call to Microsoft. Fake-verified:
 * the Microsoft token exchange itself is not exercised (hard-coded provider URLs; no live Microsoft app).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, org, A, B
test.before(async () => {
  db = await kit.connect(); org = await kit.createOrg({ plan: 'premium', webEnabled: true })
  A = (await kit.login(org.employee.email)); B = (await kit.login(org.manager.email))
})
test.after(async () => { await db.collection('outlooktokens').deleteMany({ orgId: org.orgId }); await kit.cleanupAll(db); await kit.disconnect() })
const state = () => process.env.JWT_SECRET && kit.load('lib/auth/oauthState.ts')
const callback = (st, cookie) => kit.api(`/api/auth/outlook/callback?code=abc&state=${encodeURIComponent(st)}`, { cookie, redirect: 'manual' })
const tokens = () => db.collection('outlooktokens').countDocuments({ orgId: org.orgId })

test('O1. only a signed-in user can start the flow; the state sent to Microsoft is not the user id', async () => {
  assert.equal((await kit.api('/api/auth/outlook')).status, 401)
  const r = await kit.api('/api/auth/outlook', { cookie: A.cookie })
  if (r.status === 503) return          // Outlook not configured on this server: nothing to start
  assert.equal(r.status, 307)
  const st = new URL(r.headers.get('location')).searchParams.get('state')
  assert.notEqual(st, org.employee.id); assert.match(st, /^[\w-]+\.[\w-]+$/)
})

test('O2. the callback rejects a bare user id, garbage, tampered and expired state, and a state issued to someone else — and writes nothing', async () => {
  const S = state(); const mine = S.signOAuthState(org.employee.id, org.orgId)
  const forged = org.employee.id
  const [body, sig] = mine.split('.')
  const tampered = Buffer.from(JSON.stringify({ u: org.manager.id, o: org.orgId, n: 'x', e: Date.now() + 1e6 })).toString('base64url') + '.' + sig
  const expired = S.signOAuthState(org.employee.id, org.orgId, Date.now() - 3600_000)
  const managers = S.signOAuthState(org.manager.id, org.orgId)
  for (const [label, st, cookie] of [
    ['bare user id', forged, A.cookie], ['garbage', 'not-a-state', A.cookie], ['tampered body', tampered, A.cookie], ['expired', expired, A.cookie],
    ['no session', mine, undefined], ['state of another user, victim not signed in as them', managers, A.cookie], ['valid state, other user\'s session', mine, B.cookie],
  ]) {
    const r = await callback(st, cookie)
    if (!cookie) { assert.ok([307, 401].includes(r.status), label); continue }   // middleware answers 401 before the route when there is no session at all
    assert.equal(r.status, 307, label); assert.match(r.headers.get('location'), /outlook=error/, label)
  }
  assert.equal(await tokens(), 0, 'no mailbox was attached by any rejected callback')
  assert.ok(body)
})

test('O3. state helper: valid round trip, one-way (no secret in output), rejects oversize/extra segments', () => {
  const S = state(); const st = S.signOAuthState('u1', 'o1')
  assert.deepEqual(S.verifyOAuthState(st), { userId: 'u1', orgId: 'o1' })
  assert.equal(S.verifyOAuthState(st + '.x'), null); assert.equal(S.verifyOAuthState('a'.repeat(700)), null); assert.equal(S.verifyOAuthState(null), null)
  assert.equal(S.verifyOAuthState(S.signOAuthState('u1', 'o1', Date.now() - 11 * 60_000)), null)
  assert.ok(!st.includes(process.env.JWT_SECRET))
})
