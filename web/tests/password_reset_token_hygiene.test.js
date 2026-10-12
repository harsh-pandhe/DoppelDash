/**
 * DoppelDash — password-reset tokens never travel in URLs, are never echoed, never logged.
 *
 *   - the emailed link carries the token in the URL FRAGMENT (never sent to a server)
 *   - validity check = POST /api/auth/password-reset/check { token } (body only)
 *   - the old GET /confirm?token= contract is gone (405) and does not consume/validate anything
 *   - responses never contain the token (and are `no-store`)
 *   - invalid / expired / used / missing tokens keep their distinct, safe answers
 *   - (DD_SERVER_LOG=<dev server log>) no reset token ever appears in the server log
 *
 * Requires the dev server on TEST_URL + the same throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const kit = require('./helpers/authTestKit')

let db
const issued = [] // every raw token this suite created
test.before(async () => { db = await kit.connect() })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const tokenFromUrl = u => new URLSearchParams(new URL(u).hash.replace(/^#/, '')).get('token')
const check = (token, extra = {}) => kit.api('/api/auth/password-reset/check', { method: 'POST', body: { token }, ...extra })
const NEW_PW = 'N3w!Reset#Passw0rd'
// Token-shaped value used ONLY for the deliberate legacy-URL probes in R4 (never a real secret); R7 ignores its own probes.
const DECOY = 'dec0' + 'ab'.repeat(30)
const OTHER_SUITE_DECOY = 'dec0' + 'cd'.repeat(30)   // the invitation hygiene suite's decoy (same log)

async function requestReset(email) {
  const r = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email } })
  assert.equal(r.status, 200)
  const token = tokenFromUrl(r.json.resetUrl)
  issued.push(token)
  return { r, token }
}

test('R1. the emailed reset link carries the token in the URL fragment, never in the query string or path', async () => {
  const org = await kit.createOrg()
  const { r, token } = await requestReset(org.employee.email)
  const u = new URL(r.json.resetUrl)
  assert.equal(u.pathname, '/reset-password')
  assert.equal(u.search, '', 'no query string at all')
  assert.ok(!u.pathname.includes(token), 'not in the path')
  assert.match(u.hash, /^#token=[0-9a-f]{64}$/, 'fragment carries the 256-bit token')
})

test('R2. POST /check validates a live token, never echoes it, and is not cacheable', async () => {
  const org = await kit.createOrg()
  const { token } = await requestReset(org.employee.email)
  const res = await check(token)
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { valid: true, email: org.employee.email })
  assert.ok(!res.text.includes(token), 'response never contains the token')
  assert.match(res.headers.get('cache-control') || '', /no-store/)
  // a read-only check never consumes the token
  assert.equal((await check(token)).status, 200)
})

test('R3. invalid, missing, expired and already-used tokens keep distinct, safe answers', async () => {
  const org = await kit.createOrg()
  const bogus = 'f'.repeat(64)
  const invalid = await check(bogus)
  assert.equal(invalid.status, 404); assert.equal(invalid.json.reason, 'invalid_token')
  assert.ok(!invalid.text.includes(bogus), 'a rejected token is not echoed either')

  assert.equal((await check('')).json.reason, 'missing_token')
  assert.equal((await kit.api('/api/auth/password-reset/check', { method: 'POST', body: {} })).status, 400)
  assert.equal((await kit.api('/api/auth/password-reset/check', { method: 'POST', raw: '{not json' })).status, 400)

  const { token: expiring } = await requestReset(org.manager.email)
  const PasswordResetToken = kit.load('models/PasswordResetToken.ts').default
  await PasswordResetToken.updateOne({ tokenHash: PasswordResetToken.hashToken(expiring) }, { $set: { expiresAt: new Date(Date.now() - 60_000) } })
  const expired = await check(expiring)
  assert.equal(expired.status, 410); assert.equal(expired.json.reason, 'expired')

  const { token: used } = await requestReset(org.employee.email)
  const done = await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token: used, newPassword: NEW_PW } })
  assert.equal(done.status, 200, done.text)
  assert.ok(!done.text.includes(used), 'confirm never echoes the token')
  const again = await check(used)
  assert.equal(again.status, 410); assert.equal(again.json.reason, 'already_used')
})

test('R4. the GET query-token contract is gone: 405, nothing validated, nothing leaked (probes use a DECOY token so the log stays clean)', async () => {
  const org = await kit.createOrg()
  const { token } = await requestReset(org.employee.email)
  const decoy = DECOY

  const getConfirm = await kit.api(`/api/auth/password-reset/confirm?token=${decoy}`)
  assert.equal(getConfirm.status, 405, 'GET /confirm must not exist')
  const getCheck = await kit.api(`/api/auth/password-reset/check?token=${decoy}`)
  assert.equal(getCheck.status, 405, 'the check endpoint is POST-only as well')
  for (const r of [getConfirm, getCheck]) assert.ok(!r.text.includes(decoy) && !r.text.includes(org.employee.email))

  // a token in the QUERY of a POST is ignored — only the body counts
  const queryOnly = await kit.api(`/api/auth/password-reset/check?token=${decoy}`, { method: 'POST', body: {} })
  assert.equal(queryOnly.status, 400, 'query-string token is not honoured')
  const queryConfirm = await kit.api(`/api/auth/password-reset/confirm?token=${decoy}`, { method: 'POST', body: { newPassword: NEW_PW } })
  assert.equal(queryConfirm.status, 400)

  assert.equal((await check(token)).status, 200, 'the real token was never touched')
})

test('R5. confirm via POST body works end to end, single-use, and the request response carries no token outside the dev-only link', async () => {
  const org = await kit.createOrg()
  const { r, token } = await requestReset(org.employee.email)
  assert.equal(r.json.message, 'If an account exists for this email, a password reset link has been sent.')
  assert.ok(!r.text.replace(r.json.resetUrl, '').includes(token), 'only the dev-only resetUrl may contain the token (hidden in production — batch_k / auth_foundation F6)')
  const unknown = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: `nobody_${kit.rand()}@test.dd` } })
  assert.equal(unknown.status, 200); assert.equal(unknown.json.message, r.json.message, 'no account enumeration')

  const ok = await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: NEW_PW } })
  assert.equal(ok.status, 200)
  assert.equal((await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: 'An0ther!Reset#Pw1' } })).status, 400, 'a spent token cannot be replayed')
  assert.ok((await kit.login(org.employee.email, NEW_PW)).accessToken, 'new password works')
})

test('R6. the reset page is requested without any token; a legacy ?token= link is answered by a token-free bridge page', async () => {
  const page = await fetch(`${kit.BASE_URL}/reset-password`)
  assert.equal(page.status, 200)
  const legacy = await fetch(`${kit.BASE_URL}/reset-password?token=${DECOY}`)   // DECOY only
  assert.equal(legacy.status, 200)
  assert.ok(!(await legacy.text()).includes(DECOY), 'the legacy query token is never rendered into the HTML')
  assert.match(legacy.headers.get('content-type') || '', /text\/html/)
  assert.equal(legacy.headers.get('referrer-policy'), 'no-referrer')
})

test('R7. the server log never contains a reset token or a token-bearing reset URL (when DD_SERVER_LOG is set)', { skip: !process.env.DD_SERVER_LOG && 'set DD_SERVER_LOG to scan a dev-server log' }, () => {
  // Only this suite's own DECOY probes (R4) are ignored: they are token-shaped but not secrets.
  const log = fs.readFileSync(process.env.DD_SERVER_LOG, 'utf8').split('\n').filter(l => !l.includes(DECOY) && !l.includes(OTHER_SUITE_DECOY)).join('\n')
  assert.ok(issued.length >= 5, 'the suite generated tokens to look for')
  for (const t of issued) assert.ok(!log.includes(t), 'a reset token value appears in the server log')
  assert.doesNotMatch(log, /password-reset\/(confirm|check)\?[^\s]*token=/i, 'no request log line carries ?token= for the reset endpoints')
  assert.doesNotMatch(log, /reset-password\?[^\s]*token=/i, 'no request log line carries a reset link query token')
  assert.doesNotMatch(log, /[0-9a-f]{64}/, 'no 256-bit hex secret of any kind in the log')
})
