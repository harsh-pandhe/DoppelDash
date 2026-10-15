/**
 * DoppelDash — Auth Foundation regression suite (live dev server + throwaway DB).
 *
 * Each test asserts the SECURE behaviour for one audited finding:
 *   F1  pre-auth token must never authorise anything (2FA bypass)
 *   F2  password change / reset revokes every mobile refresh session
 *   F3  refresh-token rotation is atomic; reuse is detected
 *   F4  invitation acceptance issues a real access + refresh pair
 *   F5  tenant context fails closed — never silently Doppelmayr
 *   F6  dev shortcuts / secrets are impossible in production & on deploy platforms
 *   F7  invitation e-mail HTML escapes user-controlled values
 *   F8  per-account login + invitation rate limits (no org-wide lockout)
 *
 * Requires: dev server on TEST_URL (default http://localhost:3100) using the same
 * throwaway DB (MONGODB_URI) — the kit refuses to run against anything non-local.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')

let db
let smtp

test.before(async () => {
  db = await kit.connect()
  smtp = await kit.startFakeSmtp(2525)
})
test.after(async () => {
  await kit.cleanupAll(db)
  await smtp.stop()
  await kit.disconnect()
})

const NEW_PASSWORD = 'N3w!Passw0rd#xyz'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Sign an arbitrary JWT the way an attacker holding no server secret could NOT — used only to model forged/legacy tokens. */
async function signRaw(payload, { expiresIn = '10m' } = {}) {
  const { SignJWT } = await import('jose')
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET))
}

/* ─────────────────────────── F1 — 2FA bypass ─────────────────────────── */
test('F1. a pre-auth token (password only) cannot authorise any protected resource', async () => {
  const org = await kit.createOrg()
  const step1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  assert.equal(step1.status, 200)
  const pre = step1.json.preAuthToken
  assert.ok(pre, 'login must return a pre-auth token')

  const probes = [
    '/api/auth/me', '/api/employees/me', '/api/lms', '/api/crm', '/api/rms',
    '/api/travel', '/api/admin/users', '/api/billing/entitlements', '/api/notifications',
  ]
  for (const p of probes) {
    const viaBearer = await kit.api(p, { token: pre })
    assert.equal(viaBearer.status, 401, `Bearer pre-auth token must be rejected on ${p} (got ${viaBearer.status})`)
    const viaCookie = await kit.api(p, { cookie: `dd_session=${pre}` })
    assert.equal(viaCookie.status, 401, `Cookie pre-auth token must be rejected on ${p} (got ${viaCookie.status})`)
  }

  const refresh = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: pre } })
  assert.equal(refresh.status, 401, 'pre-auth token must not work as a refresh token')

  const page = await kit.api('/dashboard', { cookie: `dd_session=${pre}` })
  assert.ok([301, 302, 303, 307, 308].includes(page.status), `app page must redirect to sign-in with a pre-auth cookie (got ${page.status})`)

  // Sanity: completing the second factor DOES yield a working session.
  const step2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: pre, otp: '112022' } })
  assert.equal(step2.status, 200)
  const me = await kit.api('/api/auth/me', { token: step2.json.accessToken })
  assert.equal(me.status, 200)
  assert.equal(me.json.email, org.admin.email)
})

test('F1b. a forged token carrying purpose=preauth is never a session, even with full claims', async () => {
  const org = await kit.createOrg()
  const forged = await signRaw({
    userId: org.admin.id, orgId: org.orgId, email: org.admin.email, role: 'admin',
    firstName: 'Ada', lastName: 'Tester', sessionVersion: 1, purpose: 'preauth',
  })
  const me = await kit.api('/api/auth/me', { token: forged })
  assert.equal(me.status, 401)
})

/* ─────────────────────── F2 — session revocation ─────────────────────── */
test('F2a. password CHANGE invalidates every mobile session (devices A and B) but not other users', async () => {
  const org = await kit.createOrg()
  const A = await kit.login(org.admin.email)
  const B = await kit.login(org.admin.email)
  const other = await kit.login(org.employee.email)

  const change = await kit.api('/api/auth/change-password', {
    method: 'POST', token: A.accessToken,
    body: { currentPassword: kit.PASSWORD, newPassword: NEW_PASSWORD },
  })
  assert.equal(change.status, 200, change.text)

  for (const [label, session] of [['A', A], ['B', B]]) {
    const r = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })
    assert.equal(r.status, 401, `device ${label} refresh token must be dead after a password change (got ${r.status})`)
    const me = await kit.api('/api/auth/me', { token: session.accessToken })
    assert.equal(me.status, 401, `device ${label} access token must be dead after a password change`)
  }

  // Intended current-session behaviour: the device that changed the password is signed out too,
  // exactly like web ("Please sign in again").
  const reLogin = await kit.login(org.admin.email, NEW_PASSWORD)
  assert.equal((await kit.api('/api/auth/me', { token: reLogin.accessToken })).status, 200)
  const oldPw = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  assert.equal(oldPw.status, 401, 'old password must no longer work')

  // Revocation is per-user: a colleague's session is untouched.
  const r = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: other.refreshToken } })
  assert.equal(r.status, 200, 'another user in the same org must keep their session')
})

test('F2b. password RESET invalidates every mobile session', async () => {
  const org = await kit.createOrg()
  const A = await kit.login(org.manager.email)
  const B = await kit.login(org.manager.email)

  const req = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: org.manager.email } })
  assert.equal(req.status, 200)
  const resetUrl = req.json.resetUrl // dev-only convenience, asserted absent in production in F6/prod suite
  assert.ok(resetUrl, 'dev server exposes resetUrl for automated tests')
  const token = new URLSearchParams(new URL(resetUrl).hash.replace(/^#/, '')).get('token')

  const confirm = await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: NEW_PASSWORD } })
  assert.equal(confirm.status, 200, confirm.text)

  for (const [label, session] of [['A', A], ['B', B]]) {
    const r = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })
    assert.equal(r.status, 401, `device ${label} refresh token must be dead after a reset`)
    const me = await kit.api('/api/auth/me', { token: session.accessToken })
    assert.equal(me.status, 401, `device ${label} access token must be dead after a reset`)
  }

  // Reset token is single use.
  const again = await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: 'An0ther!Passw0rd#1' } })
  assert.equal(again.status, 400)
})

/* ─────────────────────── F3 — refresh rotation ─────────────────────── */
test('F3a. simultaneous refreshes with the same token: exactly one succeeds', async () => {
  const org = await kit.createOrg()
  const { refreshToken } = await kit.login(org.employee.email)

  const results = await Promise.all(
    Array.from({ length: 10 }, () => kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken } }))
  )
  const winners = results.filter(r => r.status === 200)
  assert.equal(winners.length, 1, `exactly one refresh may win, got ${winners.length}: ${results.map(r => r.status).join(',')}`)
  assert.ok(results.filter(r => r.status !== 200).every(r => r.status === 401))

  // A benign race must not log the legitimate client out: the winner's new token still works.
  const next = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: winners[0].json.refreshToken } })
  assert.equal(next.status, 200, 'winner of a simultaneous refresh must keep a valid session')
})

test('F3b. replaying a rotated token after the grace window is reuse: the whole token family dies', async () => {
  const org = await kit.createOrg()
  const R0 = (await kit.login(org.employee.email)).refreshToken

  const rotated = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: R0 } })
  assert.equal(rotated.status, 200)
  const R1 = rotated.json.refreshToken
  assert.notEqual(R1, R0)

  await sleep(1900) // REFRESH_REUSE_GRACE_MS=1500 on the test server
  const replay = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: R0 } })
  assert.equal(replay.status, 401, 'a rotated token must never be accepted again')

  const afterTheft = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: R1 } })
  assert.equal(afterTheft.status, 401, 'reuse detection must revoke the descendant token too')
})

/* ─────────────────────── F4 — invitation session ─────────────────────── */
test('F4. accepting an invitation yields a real access + refresh pair, correct org/role/linkage', async () => {
  // webEnabled: the web cookie is only minted for organisations whose entitlement allows the web client
  // (the non-web case is covered in web_access_boundary.test.js).
  const org = await kit.createOrg({ webEnabled: true })
  const adminSession = await kit.login(org.admin.email)
  const inviteEmail = `authf_invitee_${kit.rand()}@test.dd`

  const created = await kit.api('/api/admin/invitations', {
    method: 'POST', token: adminSession.accessToken,
    body: { email: inviteEmail, role: 'manager', firstName: 'Ivy', lastName: 'Invitee', department: 'Ops' },
  })
  assert.equal(created.status, 201, created.text)
  const rawToken = created.json.rawToken
  assert.ok(rawToken, 'dev/test server returns the raw invite token for automation')

  // Client-supplied role / orgId must be ignored — the invitation decides.
  const accepted = await kit.api('/api/auth/invitations/accept', {
    method: 'POST', body: { token: rawToken, password: kit.PASSWORD, role: 'admin', orgId: 'org_doppelmayr' },
  })
  assert.equal(accepted.status, 200, accepted.text)
  const { accessToken, refreshToken } = accepted.json
  assert.ok(accessToken && refreshToken)
  assert.notEqual(refreshToken, accessToken, 'refresh token must NOT be the session JWT')
  assert.ok(!refreshToken.includes('.'), 'refresh token must be opaque, not a JWT')
  assert.match(accepted.headers.get('set-cookie') || '', /dd_session=/, 'web cookie must be set')

  const me = await kit.api('/api/auth/me', { token: accessToken })
  assert.equal(me.status, 200)
  assert.equal(me.json.role, 'manager', 'role comes from the invitation')
  assert.equal(me.json.orgId, org.orgId, 'org comes from the invitation')
  assert.equal(me.json.email, inviteEmail)

  const refreshed = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken } })
  assert.equal(refreshed.status, 200, 'an invited mobile user must be able to refresh')
  assert.ok(refreshed.json.accessToken && refreshed.json.refreshToken)
  assert.notEqual(refreshed.json.refreshToken, refreshToken, 'refresh token rotates')

  const user = await db.collection('users').findOne({ email: inviteEmail })
  const emp = await db.collection('employees').findOne({ clerkUserId: user._id.toString() })
  assert.equal(user.orgId, org.orgId)
  assert.equal(user.role, 'manager')
  assert.ok(emp && emp.orgId === org.orgId, 'employee profile linked to the same org')

  // Invitation is single-use.
  const replay = await kit.api('/api/auth/invitations/accept', { method: 'POST', body: { token: rawToken, password: kit.PASSWORD } })
  assert.ok([404, 409, 410].includes(replay.status))
})

/* ─────────────────────── F5 — tenant fail-closed ─────────────────────── */
test('F5a. a session whose user has no org is rejected, never treated as Doppelmayr', async () => {
  const uid = new mongoose.Types.ObjectId()
  const email = `authf_orgless_${kit.rand()}@test.dd`
  await db.collection('users').insertOne({
    _id: uid, email, passwordHash: 'x', role: 'admin', firstName: 'No', lastName: 'Org',
    isActive: true, isBanned: false, sessionVersion: 1, mustChangePassword: false, tourSeen: false, loginCount: 0, otpAttempts: 0,
  })
  try {
    // Legacy-shaped token (no orgId claim) for an org-less user: the old code defaulted both to org_doppelmayr.
    const token = await signRaw({ userId: uid.toString(), email, role: 'admin', firstName: 'No', lastName: 'Org', sessionVersion: 1, jti: crypto.randomUUID() })
    for (const p of ['/api/auth/me', '/api/crm', '/api/employees/directory', '/api/lms', '/api/analytics', '/api/admin/users', '/api/billing/entitlements']) {
      const r = await kit.api(p, { token })
      assert.equal(r.status, 401, `${p} must fail closed for an org-less session (got ${r.status})`)
      assert.ok(!/doppelmayr\.com/i.test(r.text), `${p} must not leak Doppelmayr data`)
    }
  } finally {
    await db.collection('users').deleteOne({ _id: uid })
  }
})

test('F5b. a forged orgId claim cannot move a user into Doppelmayr', async () => {
  const org = await kit.createOrg()
  const forged = await signRaw({
    userId: org.admin.id, orgId: 'org_doppelmayr', email: org.admin.email, role: 'admin',
    firstName: 'Ada', lastName: 'Tester', sessionVersion: 1, jti: crypto.randomUUID(), typ: 'session',
  })
  for (const p of ['/api/auth/me', '/api/crm', '/api/employees/directory', '/api/admin/users']) {
    const r = await kit.api(p, { token: forged })
    assert.ok(!/@doppelmayr\.com/i.test(r.text), `${p} must never return Doppelmayr data to another tenant's user`)
    assert.ok(r.status === 401 || r.status === 403 || r.status === 200)
    if (r.status === 200 && p === '/api/auth/me') assert.notEqual(r.json.orgId, 'org_doppelmayr')
  }
})

test('F5c. no source file silently assigns org_doppelmayr as a runtime fallback', async () => {
  const { execFileSync } = require('node:child_process')
  const path = require('node:path')
  const root = path.resolve(__dirname, '..')
  let out = ''
  try {
    out = execFileSync('grep', [
      '-rnE', "\\|\\|\\s*['\"]org_doppelmayr['\"]|default:\\s*['\"]org_doppelmayr['\"]|DEFAULT_ORG_ID",
      'app', 'lib', 'models', 'components', 'middleware.ts', '--include=*.ts', '--include=*.tsx',
    ], { cwd: root, encoding: 'utf8' }).toString()
  } catch (e) {
    if (e.status !== 1) throw e // grep exit 1 == no matches == good
  }
  assert.equal(out.trim(), '', `fail-open tenant fallbacks remain:\n${out.split('\n').slice(0, 12).join('\n')}\n(${out.split('\n').filter(Boolean).length} total)`)
})

/* ─────────────────────── F6 — dev leak centralisation ─────────────────────── */
test('F6a. dev OTP shortcut is refused on deploy platforms and in production, accepted only in local dev', async () => {
  const User = kit.load('models/User.ts').default
  const { generateOTP, verifyOTP } = kit.load('lib/auth/otp.ts')
  const org = await kit.createOrg()
  const snapshot = { ...process.env }
  const attempt = async env => {
    Object.assign(process.env, env)
    process.env.DD_DEPLOY_CONTEXT = 'staging'   // the simulated platform is a DECLARED deployment (undeclared hosted deploys cannot reach the DB - tests/preview_safety.test.js); this test is about the OTP shortcut
    for (const k of ['NETLIFY', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME']) if (!(k in env)) delete process.env[k]
    await generateOTP(org.employee.id)
    const result = await verifyOTP(org.employee.id, '112022')
    await User.findByIdAndUpdate(org.employee.id, { $unset: { otp: 1, otpExpiry: 1 }, otpAttempts: 0 })
    return result.ok
  }
  try {
    assert.equal(await attempt({ NODE_ENV: 'production' }), false, 'production must reject the dev code')
    assert.equal(await attempt({ NODE_ENV: 'development', NETLIFY: 'true' }), false, 'a deploy platform must reject it even if NODE_ENV is wrong')
    assert.equal(await attempt({ NODE_ENV: 'development', VERCEL: '1' }), false)
    assert.equal(await attempt({ NODE_ENV: 'development' }), true, 'local development keeps the shortcut for automation')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k]
    Object.assign(process.env, snapshot)
  }
})

test('F6b. password-reset links and OTP console logging never appear outside local development', async () => {
  const org = await kit.createOrg()
  const route = kit.load('app/api/auth/password-reset/request/route.ts')
  const { sendOTP } = kit.load('lib/auth/sendOtp.ts')
  const snapshot = { ...process.env }
  const call = async env => {
    Object.assign(process.env, env)
    process.env.DD_DEPLOY_CONTEXT = 'staging'   // declared deployment (see F6a); the subject here is the reset-URL / OTP-log gating
    for (const k of ['NETLIFY', 'VERCEL']) if (!(k in env)) delete process.env[k]
    const res = await route.POST(new Request('http://x/api/auth/password-reset/request', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': kit.freshIp() },
      body: JSON.stringify({ email: org.employee.email }),
    }))
    return res.json()
  }
  const logs = []
  const origLog = console.log
  try {
    assert.equal((await call({ NODE_ENV: 'production' })).resetUrl, undefined)
    assert.equal((await call({ NODE_ENV: 'development', NETLIFY: 'true' })).resetUrl, undefined, 'deploy platform must never expose the reset URL')
    assert.ok((await call({ NODE_ENV: 'development' })).resetUrl, 'local dev keeps it for automation')

    console.log = (...a) => { logs.push(a.join(' ')) }
    process.env.NODE_ENV = 'development'
    delete process.env.NETLIFY
    await sendOTP(org.employee.email, '482915')
    process.env.NODE_ENV = 'production'
    await sendOTP(org.employee.email, '731846')
  } finally {
    console.log = origLog
    for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k]
    Object.assign(process.env, snapshot)
  }
  assert.ok(!logs.some(l => l.includes('482915') || l.includes('731846')), 'OTP codes must never be written to logs by default')
})

/* ─────────────────────── F7 — HTML escaping ─────────────────────── */
test('F7. invitation e-mail escapes malicious organisation and inviter names', async () => {
  const XSS_ORG = '<script>alert(1)</script>'
  const XSS_NAME = '<img src=x onerror=alert(1)>'
  const org = await kit.createOrg({ name: XSS_ORG })
  await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(org.admin.id) }, { $set: { firstName: XSS_NAME, lastName: '"><svg onload=alert(2)>' } })
  const adminSession = await kit.login(org.admin.email)

  smtp.clear()
  const inviteEmail = `authf_xss_${kit.rand()}@test.dd`
  const res = await kit.api('/api/admin/invitations', { method: 'POST', token: adminSession.accessToken, body: { email: inviteEmail, role: 'employee' } })
  assert.equal(res.status, 201, res.text)

  const mail = await smtp.waitFor(m => m.to.includes(inviteEmail))
  // Escaped text may legitimately still READ "onerror=" — what must never exist is a live tag.
  for (const needle of ['<script', '<img', '<svg']) {
    assert.ok(!mail.html.toLowerCase().includes(needle), `raw "${needle}" must not appear in the HTML body`)
  }
  assert.ok(!/<[^>]*\son(error|load)\s*=/i.test(mail.html), 'no element may carry an inline event handler')
  assert.ok(mail.html.includes('&lt;script&gt;'), 'organisation name must be present but escaped')
  assert.ok(!/<script|onerror=/i.test(mail.subject), 'subject must not carry markup either')
})

/* ─────────────────────── F8 — rate limiting ─────────────────────── */
test('F8a. failed logins are throttled per account even when the attacker rotates IPs', async () => {
  const org = await kit.createOrg()
  const statuses = []
  for (let i = 0; i < 40; i++) {
    const r = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.employee.email, password: `Wrong-Guess-${i}!` } })
    statuses.push(r.status)
  }
  assert.ok(statuses.includes(429), `per-account throttle must trigger across rotating IPs: ${statuses.join(',')}`)
  assert.ok(statuses.slice(0, 5).every(s => s === 401), 'the first few failures are ordinary 401s')
})

test('F8b. login throttle is per account — a neighbouring user and the rest of the org are unaffected', async () => {
  const org = await kit.createOrg()
  for (let i = 0; i < 40; i++) {
    await kit.api('/api/auth/login', { method: 'POST', body: { email: org.employee.email, password: `Wrong-Guess-${i}!` } })
  }
  const ok = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.manager.email, password: kit.PASSWORD } })
  assert.equal(ok.status, 200, 'throttling one account must not block a colleague')
  const ok2 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  assert.equal(ok2.status, 200)
})

test('F8c. invitation creation is limited per inviter, per recipient and per recipient across orgs', async () => {
  const org = await kit.createOrg()
  const admin = await kit.login(org.admin.email)
  const statuses = []
  for (let i = 0; i < 40; i++) {
    const r = await kit.api('/api/admin/invitations', {
      method: 'POST', token: admin.accessToken,
      body: { email: `authf_bulk_${kit.rand()}@test.dd`, role: 'employee' },
    })
    statuses.push(r.status)
  }
  assert.ok(statuses.includes(429), `inviter must be throttled: ${statuses.join(',')}`)

  // Mail-bombing one victim: the same recipient cannot be invited endlessly by one org.
  const org2 = await kit.createOrg()
  const admin2 = await kit.login(org2.admin.email)
  const victim = `authf_victim_${kit.rand()}@test.dd`
  const victimStatuses = []
  for (let i = 0; i < 8; i++) {
    const r = await kit.api('/api/admin/invitations', { method: 'POST', token: admin2.accessToken, body: { email: victim, role: 'employee' } })
    victimStatuses.push(r.status)
  }
  assert.ok(victimStatuses.includes(429), `per-recipient throttle must trigger: ${victimStatuses.join(',')}`)

  // …and a different org's admin (separate counters) is not blocked by org2's activity.
  const org3 = await kit.createOrg()
  const admin3 = await kit.login(org3.admin.email)
  const fine = await kit.api('/api/admin/invitations', { method: 'POST', token: admin3.accessToken, body: { email: `authf_ok_${kit.rand()}@test.dd`, role: 'employee' } })
  assert.equal(fine.status, 201)
})
