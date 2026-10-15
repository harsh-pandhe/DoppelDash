/**
 * DoppelDash — credentials / tokens never leak through API responses (and, when a
 * server log path is supplied, never appear in the server log).
 *
 *   DD_SERVER_LOG=/path/to/dev-server.log node --test tests/secret_exposure.test.js
 *
 * Requires the dev server on TEST_URL + the same throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const kit = require('./helpers/authTestKit')

let db
let smtp
const seen = [] // every response body text this suite produced
test.before(async () => { db = await kit.connect(); smtp = await kit.startFakeSmtp(2525) })
test.after(async () => { await kit.cleanupAll(db); await smtp.stop(); await kit.disconnect() })

const FORBIDDEN_KEYS = ['passwordHash', 'passwordEnc', 'appPassword', 'totpSecret', 'otpHash', 'tokenHash', 'secretEnc']
const BCRYPT = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/

function assertNoSecrets(label, text, { allowTokens = false, extra = [] } = {}) {
  seen.push(text)
  for (const k of FORBIDDEN_KEYS) assert.ok(!text.includes(`"${k}"`), `${label}: response must not contain "${k}"`)
  assert.doesNotMatch(text, BCRYPT, `${label}: no password hash`)
  assert.ok(!text.includes(kit.PASSWORD), `${label}: plaintext password must never be echoed`)
  if (!allowTokens) {
    assert.doesNotMatch(text, /"(accessToken|refreshToken|preAuthToken)"/, `${label}: must not hand out session tokens`)
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\./, `${label}: no JWT in the body`)
  }
  for (const x of extra) assert.ok(!text.includes(x), `${label}: must not contain ${x}`)
}

test('S1. auth endpoints never echo passwords, hashes, OTP codes or other secrets', async () => {
  const org = await kit.createOrg({ webEnabled: true, plan: 'premium', lifetimeGrant: true })
  const OTP = '112022'

  const wrong = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: 'definitely-wrong-pw' } })
  assertNoSecrets('login(wrong)', wrong.text, { extra: ['definitely-wrong-pw'] })

  const step1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  assert.equal(step1.status, 200)
  assert.doesNotMatch(step1.text.replace(step1.json.preAuthToken, ''), new RegExp(OTP), 'login response must not contain the OTP')
  for (const k of FORBIDDEN_KEYS) assert.ok(!step1.text.includes(`"${k}"`))
  assert.ok(!step1.text.includes(kit.PASSWORD))
  assert.equal(step1.json.otp, undefined); assert.equal(step1.json.code, undefined)

  const send = await kit.api('/api/auth/send-otp', { method: 'POST', body: { preAuthToken: step1.json.preAuthToken } })
  assertNoSecrets('send-otp', send.text, { extra: [OTP] })

  const step2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: step1.json.preAuthToken, otp: OTP } })
  assert.equal(step2.status, 200)
  assertNoSecrets('verify-otp', step2.text, { allowTokens: true })
  // tokens are issued here by design — but the user object inside must be the public projection
  assert.equal(step2.json.user.passwordHash, undefined)
  assert.match(step2.headers.get('set-cookie') || '', /HttpOnly/i, 'web session cookie is HttpOnly')

  const bearer = step2.json.accessToken
  for (const p of ['/api/auth/me', '/api/billing/entitlements', '/api/admin/users', '/api/admin/invitations', '/api/org/mail-config', '/api/employees/me']) {
    const r = await kit.api(p, { token: bearer })
    assert.ok(r.status < 500, `${p} → ${r.status}`)
    assertNoSecrets(p, r.text, { extra: [bearer, step2.json.refreshToken] })
  }
})

test('S2. password-reset and invitation request responses never contain the password or hashes', async () => {
  const org = await kit.createOrg({ webEnabled: true })
  const reset = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: org.employee.email } })
  assertNoSecrets('password-reset/request', reset.text)
  const unknown = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: `nobody_${kit.rand()}@test.dd` } })
  assert.equal(unknown.status, reset.status, 'no account enumeration')

  const s = await kit.login(org.admin.email)
  const inv = await kit.api('/api/admin/invitations', { method: 'POST', token: s.accessToken, body: { email: `inv_${kit.rand()}@test.dd`, role: 'employee' } })
  assertNoSecrets('invitations(create)', inv.text, { extra: [s.accessToken] })
  const list = await kit.api('/api/admin/invitations', { token: s.accessToken })
  assert.equal(list.status, 200)
  assertNoSecrets('invitations(list)', list.text)
  assert.doesNotMatch(list.text, /"(token|rawToken)"\s*:/, 'a stored invitation never exposes its raw token again')
})

test('S4. server-to-server secrets are header-only: cron routes never read the secret from the query string', async () => {
  const fs = require('node:fs'); const path = require('node:path')
  for (const name of ['announcements', 'birthday', 'onboarding']) {
    const src = fs.readFileSync(path.resolve(__dirname, `../app/api/cron/${name}/route.ts`), 'utf8')
    assert.doesNotMatch(src, /searchParams[\s\S]{0,40}secret|get\('secret'\)/, `cron/${name} must not read a secret from the URL`)
    assert.match(src, /isCronAuthorized/, `cron/${name} uses the shared header-only guard`)
    const none = await kit.api(`/api/cron/${name}`)
    assert.equal(none.status, 401)
    const wrongQuery = await kit.api(`/api/cron/${name}?secret=not-the-secret`)
    assert.equal(wrongQuery.status, 401)
    const wrongBearer = await kit.api(`/api/cron/${name}`, { token: 'not-the-secret' })
    assert.equal(wrongBearer.status, 401)
  }
  const guard = fs.readFileSync(path.resolve(__dirname, '../lib/cron/auth.ts'), 'utf8')
  assert.match(guard, /timingSafeEqual/, 'constant-time comparison')
  assert.doesNotMatch(guard, /searchParams/)
})

test('S3. the server log contains no passwords, JWTs, OTPs, hashes or SMTP credentials (when DD_SERVER_LOG is set)', { skip: !process.env.DD_SERVER_LOG && 'set DD_SERVER_LOG to scan a dev-server log' }, () => {
  const log = fs.readFileSync(process.env.DD_SERVER_LOG, 'utf8')
  assert.doesNotMatch(log, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\./, 'no JWT in the log')
  assert.doesNotMatch(log, BCRYPT, 'no bcrypt hash in the log')
  assert.ok(!log.includes(kit.PASSWORD), 'test password never logged')
  assert.ok(!/OTP for /i.test(log) && !/🔐/.test(log), 'OTP codes are not logged (AUTH_DEV_LOG_SECRETS off)')
  assert.ok(!/passwordHash|appPassword|SMTP_PASS/.test(log))
  for (const t of seen.flatMap(b => b.match(/"(?:accessToken|refreshToken|preAuthToken)":"([^"]{16,})"/g) || [])) {
    const value = t.split(':')[1].replace(/"/g, '')
    assert.ok(!log.includes(value), 'an issued token value appears in the log')
  }
})
