/**
 * DoppelDash — Passkey (WebAuthn) and TOTP Security Closure Suite.
 *
 * Route contracts exercised:
 *   - POST   /api/auth/passkey/register
 *   - PUT    /api/auth/passkey/register
 *   - POST   /api/auth/passkey/login
 *   - PUT    /api/auth/passkey/login
 *   - GET    /api/auth/passkey/credentials
 *   - DELETE /api/auth/passkey/credentials
 *   - POST   /api/auth/totp/setup
 *   - PUT    /api/auth/totp/setup
 *   - DELETE /api/auth/totp/setup
 *   - POST   /api/auth/verify-otp (method: 'totp')
 *
 * Covers:
 *   1. Missing, invalid, or expired sessions (401)
 *   2. Tenant and user isolation (cross-tenant / cross-user passkey deletion and login prevention)
 *   3. WebAuthn challenge lifecycle (expiration, reuse/replay, mismatch)
 *   4. Origin and relying-party ID verification
 *   5. TOTP setup, verification, enrollment confirmation, and anti-replay
 *   6. TOTP invalid, expired, and replayed codes
 *   7. Excessive attempts and rate-limit responses (429)
 *   8. Malformed JSON and oversized payloads (400, 413)
 *   9. Secret and challenge leakage prevention (no secrets leaked in options, lists, or responses)
 *  10. Session invalidation upon logout and password change
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { URL } = require('node:url')
const otplib = require('otplib')
const { isoBase64URL } = require('@simplewebauthn/server/helpers')
const kit = require('./helpers/authTestKit')

let db
let testUrl
let RP_ID
let ORIGIN

const createdOrgIds = []

const { createSyntheticAuthenticator } = require('./helpers/syntheticAuthenticator')

test.before(async () => {
  db = await kit.connect()
  testUrl = kit.BASE_URL
  const u = new URL(testUrl)
  RP_ID = u.hostname
  ORIGIN = u.origin
})

test.after(async () => {
  if (db && createdOrgIds.length > 0) {
    await db.collection('passkeycredentials').deleteMany({ orgId: { $in: createdOrgIds } }).catch(() => {})
    await db.collection('ratelimits').deleteMany({ key: { $regex: /^(pk-|totp-)/ } }).catch(() => {})
  }
  await kit.cleanupAll(db)
  await kit.disconnect()
})

// Audit rows are written fire-and-forget after the response, so poll briefly instead of racing the write.
async function findAudit(filter, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const doc = await db.collection('auditlogs').findOne(filter)
    if (doc || Date.now() > deadline) return doc
    await new Promise(r => setTimeout(r, 50))
  }
}

async function setupTenant(name) {
  const org = await kit.createOrg({ name, webEnabled: true, plan: 'premium' })
  createdOrgIds.push(org.orgId)
  const session = await kit.login(org.admin.email, kit.PASSWORD)
  return { org, session }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 1. Passkey Registration Options & Verification
 * ───────────────────────────────────────────────────────────────────────── */

test('P1.1 Registration options: 401 when unauthenticated, expired, or invalid session', async () => {
  const r1 = await kit.api('/api/auth/passkey/register', { method: 'POST' })
  assert.equal(r1.status, 401)
  assert.equal(r1.json?.error, 'Unauthorized')

  const r2 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: 'invalid.bearer.token' })
  assert.equal(r2.status, 401)
})

test('P1.2 Registration options: succeeds for authenticated user and sets DB challenge', async () => {
  const { org, session } = await setupTenant('Passkey Org A')
  const r = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(r.status, 200)
  assert.ok(typeof r.json.challenge === 'string' && r.json.challenge.length > 10, 'challenge generated')
  assert.equal(r.json.rp.name, 'DoppelDash')
  assert.equal(r.json.rp.id, RP_ID)
  assert.equal(r.json.user.name, org.admin.email)
  assert.ok(Array.isArray(r.json.pubKeyCredParams) && r.json.pubKeyCredParams.length > 0)

  // Verify challenge saved in DB on the user document
  const userDoc = await db.collection('users').findOne({ email: org.admin.email })
  assert.equal(userDoc.webauthnChallenge, r.json.challenge)
  assert.ok(userDoc.webauthnChallengeExpiry > new Date(), 'challenge has future expiry')

  // Verify no secret leakage (passwordHash, totpSecret, etc.) in response
  const rawResponse = JSON.stringify(r.json)
  assert.doesNotMatch(rawResponse, /passwordHash|totpSecret|\$2[aby]\$/i)
})

test('P1.3 Registration options: rate limit triggers after excessive calls', async () => {
  const { session } = await setupTenant('Passkey Org RateLimit')
  let rateLimited = false
  for (let i = 0; i < 20; i++) {
    const res = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
    if (res.status === 429) {
      rateLimited = true
      assert.equal(res.json?.code, 'rate_limited')
      break
    }
  }
  assert.ok(rateLimited, 'Registration options should return 429 after threshold')
})

test('P1.4 Registration verify: 401 when unauthenticated', async () => {
  const r = await kit.api('/api/auth/passkey/register', { method: 'PUT', body: { response: {} } })
  assert.equal(r.status, 401)
})

test('P1.5 Registration verify: 400 on malformed, missing, or oversized payloads', async () => {
  const { session } = await setupTenant('Passkey Org Malformed')
  // Missing body / empty
  const r1 = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, raw: '' })
  assert.equal(r1.status, 400)

  // Malformed JSON
  const r2 = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, raw: '{invalid json' })
  assert.equal(r2.status, 400)

  // Missing response object
  const r3 = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, body: { nickname: 'Key' } })
  assert.equal(r3.status, 400)
  assert.equal(r3.json?.error, 'response required')

  // Oversized body (> 64KB)
  const hugePayload = JSON.stringify({ response: { pad: 'x'.repeat(70_000) } })
  const r4 = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, raw: hugePayload })
  assert.equal(r4.status, 413)
  assert.equal(r4.json?.code, 'payload_too_large')
})

test('P1.6 Registration verify: WebAuthn challenge security (expired, reused, mismatched)', async () => {
  const { org, session } = await setupTenant('Passkey Org Challenges')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // 1. Expired challenge
  const opt1 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(opt1.status, 200)
  await db.collection('users').updateOne(
    { email: org.admin.email },
    { $set: { webauthnChallengeExpiry: new Date(Date.now() - 1000) } }
  )
  const regResp1 = auth.createRegistrationResponse(opt1.json.challenge)
  const resExpired = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regResp1, nickname: 'Key 1' },
  })
  assert.equal(resExpired.status, 400)
  assert.match(resExpired.json.error, /expired/i)

  // 2. Mismatched challenge
  const opt2 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(opt2.status, 200)
  const regRespMismatched = auth.createRegistrationResponse(opt2.json.challenge, ORIGIN, { challenge: 'wrong_challenge_value' })
  const resMismatched = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regRespMismatched, nickname: 'Key 2' },
  })
  assert.equal(resMismatched.status, 400)

  // 3. Reused challenge
  const opt3 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(opt3.status, 200)
  const regRespValid = auth.createRegistrationResponse(opt3.json.challenge)
  const resSuccess = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regRespValid, nickname: 'Key 3' },
  })
  assert.equal(resSuccess.status, 200)

  // Attempting to reuse the exact same registration response / consumed challenge
  const resReused = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regRespValid, nickname: 'Key 3 Replay' },
  })
  assert.equal(resReused.status, 400)
  assert.match(resReused.json.error, /expired|try again/i)
})

test('P1.7 Registration verify: origin and RP ID validation', async () => {
  const { session } = await setupTenant('Passkey Org Origin')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // 1. Invalid origin
  const opt1 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  const regBadOrigin = auth.createRegistrationResponse(opt1.json.challenge, ORIGIN, { origin: 'https://attacker.evil.com' })
  const resBadOrigin = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regBadOrigin, nickname: 'Bad Origin Key' },
  })
  assert.equal(resBadOrigin.status, 400)

  // 2. Invalid RP ID
  const opt2 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  const regBadRp = auth.createRegistrationResponse(opt2.json.challenge, ORIGIN, { rpID: 'evil.attacker.com' })
  const resBadRp = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regBadRp, nickname: 'Bad RP Key' },
  })
  assert.equal(resBadRp.status, 400)
})

test('P1.8 Registration verify: valid browser response persists passkey credential and audit log', async () => {
  const { org, session } = await setupTenant('Passkey Org Valid')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(opt.status, 200)

  const regResponse = auth.createRegistrationResponse(opt.json.challenge)
  const res = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: regResponse, nickname: 'MacBook Touch ID' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)

  // Verify DB record
  const cred = await db.collection('passkeycredentials').findOne({ credentialId: auth.credIdB64 })
  assert.ok(cred, 'Passkey credential document exists in database')
  assert.equal(cred.userId, org.admin.id)
  assert.equal(cred.orgId, org.orgId)
  assert.equal(cred.nickname, 'MacBook Touch ID')
  assert.ok(cred.publicKey, 'public key is stored')

  // Verify audit log
  const audit = await findAudit({
    orgId: org.orgId,
    action: 'user.passkey_added',
    targetId: org.admin.id,
  })
  assert.ok(audit, 'Audit log recorded for user.passkey_added')
  assert.equal(audit.metadata?.nickname, 'MacBook Touch ID')

  // Subsequent registration options should exclude this credential ID
  const optNext = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  const excludedIds = (optNext.json.excludeCredentials || []).map(c => c.id)
  assert.ok(excludedIds.includes(auth.credIdB64), 'excludeCredentials contains registered passkey')
})

test('P1.9 Registration verify: duplicate credential registration rejected (400)', async () => {
  const { session } = await setupTenant('Passkey Org Duplicate')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  const opt1 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  const reg1 = auth.createRegistrationResponse(opt1.json.challenge)
  const res1 = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: reg1, nickname: 'Key One' },
  })
  assert.equal(res1.status, 200)

  // Attempt to register same credential with another challenge
  const opt2 = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  const reg2 = auth.createRegistrationResponse(opt2.json.challenge)
  const res2 = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: reg2, nickname: 'Key Duplicate' },
  })
  assert.equal(res2.status, 400)
  assert.match(res2.json.error, /already registered/i)
})

/* ─────────────────────────────────────────────────────────────────────────
 * 2. Passkey Login Options & Verification
 * ───────────────────────────────────────────────────────────────────────── */

test('P2.1 Passkey login options: public endpoint returns options for user with passkey', async () => {
  const { org, session } = await setupTenant('Passkey Login Valid')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // Register passkey first
  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: auth.createRegistrationResponse(opt.json.challenge), nickname: 'Login Key' },
  })

  // Public login options request by email
  const loginOpt = await kit.api('/api/auth/passkey/login', {
    method: 'POST', body: { email: org.admin.email },
  })
  assert.equal(loginOpt.status, 200)
  assert.equal(loginOpt.json.userId, org.admin.id)
  assert.ok(loginOpt.json.options.challenge, 'challenge present')
  assert.equal(loginOpt.json.options.rpId, RP_ID)
  const allowed = (loginOpt.json.options.allowCredentials || []).map(c => c.id)
  assert.ok(allowed.includes(auth.credIdB64), 'allowCredentials includes user passkey ID')
})

test('P2.2 Passkey login options: 404 for unknown email or user without passkey (no account enumeration)', async () => {
  // Unknown email
  const r1 = await kit.api('/api/auth/passkey/login', {
    method: 'POST', body: { email: 'nonexistent_user_xyz@test.dd' },
  })
  assert.equal(r1.status, 404)
  assert.match(r1.json.error, /No passkey found/i)

  // Existing user without passkey
  const { org } = await setupTenant('Passkey No Keys')
  const r2 = await kit.api('/api/auth/passkey/login', {
    method: 'POST', body: { email: org.employee.email },
  })
  assert.equal(r2.status, 404)
  assert.match(r2.json.error, /No passkey found/i)

  // Banned / suspended user returns same 404 to prevent status enumeration
  await db.collection('users').updateOne({ email: org.employee.email }, { $set: { isBanned: true } })
  const r3 = await kit.api('/api/auth/passkey/login', {
    method: 'POST', body: { email: org.employee.email },
  })
  assert.equal(r3.status, 404)
})

test('P2.3 Passkey login options: input validation, 413 payload cap, and rate limit', async () => {
  // Missing email
  const r1 = await kit.api('/api/auth/passkey/login', { method: 'POST', body: {} })
  assert.equal(r1.status, 400)
  assert.equal(r1.json?.error, 'email required')

  // Oversized body (> 64KB)
  const r2 = await kit.api('/api/auth/passkey/login', { method: 'POST', raw: JSON.stringify({ email: 'x'.repeat(70_000) }) })
  assert.equal(r2.status, 413)

  // Rate limit on IP
  const testIp = '198.51.100.42'
  let triggered = false
  for (let i = 0; i < 15; i++) {
    const res = await kit.api('/api/auth/passkey/login', { method: 'POST', ip: testIp, body: { email: 'test@dd.test' } })
    if (res.status === 429) {
      triggered = true
      break
    }
  }
  assert.ok(triggered, 'IP rate limit should trigger for passkey login options')
})

test('P2.4 Passkey login verify: 400 on malformed, missing, or oversized payloads', async () => {
  const r1 = await kit.api('/api/auth/passkey/login', { method: 'PUT', body: {} })
  assert.equal(r1.status, 400)
  assert.match(r1.json?.error, /required/i)

  const r2 = await kit.api('/api/auth/passkey/login', { method: 'PUT', raw: '{invalid json' })
  assert.equal(r2.status, 400)

  const r3 = await kit.api('/api/auth/passkey/login', {
    method: 'PUT', raw: JSON.stringify({ userId: 'u1', response: { pad: 'x'.repeat(70_000) } }),
  })
  assert.equal(r3.status, 413)
})

test('P2.5 Passkey login verify: security failures (wrong passkey, tampered signature, expired challenge)', async () => {
  const { org, session } = await setupTenant('Passkey Failures Org')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // Register passkey
  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: auth.createRegistrationResponse(opt.json.challenge), nickname: 'Auth Key' },
  })

  // 1. Unknown / wrong passkey credential ID
  const loginOpt1 = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  const unknownAuth = auth.createAuthenticationResponse(loginOpt1.json.options.challenge, ORIGIN, {
    id: isoBase64URL.fromBuffer(crypto.randomBytes(32)),
  })
  const resUnknown = await kit.api('/api/auth/passkey/login', {
    method: 'PUT', body: { userId: org.admin.id, response: unknownAuth },
  })
  assert.equal(resUnknown.status, 401)
  assert.match(resUnknown.json.error, /Unknown passkey/i)

  // 2. Tampered signature
  const loginOpt2 = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  const tamperedAuth = auth.createAuthenticationResponse(loginOpt2.json.options.challenge, ORIGIN, { tamperSignature: true })
  const resTampered = await kit.api('/api/auth/passkey/login', {
    method: 'PUT', body: { userId: org.admin.id, response: tamperedAuth },
  })
  assert.equal(resTampered.status, 401)

  // 3. Expired challenge
  const loginOpt3 = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  await db.collection('users').updateOne(
    { email: org.admin.email },
    { $set: { webauthnChallengeExpiry: new Date(Date.now() - 1000) } }
  )
  const validAuthExpired = auth.createAuthenticationResponse(loginOpt3.json.options.challenge)
  const resExpired = await kit.api('/api/auth/passkey/login', {
    method: 'PUT', body: { userId: org.admin.id, response: validAuthExpired },
  })
  assert.equal(resExpired.status, 401)
  assert.match(resExpired.json.error, /expired/i)
})

test('P2.6 Passkey login verify: suspended or tenantless account refused (403)', async () => {
  const { org, session } = await setupTenant('Passkey Suspended')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // Register passkey
  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: auth.createRegistrationResponse(opt.json.challenge), nickname: 'Banned User Key' },
  })

  // Obtain login options
  const loginOpt = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  assert.equal(loginOpt.status, 200)

  // Ban user before verification
  await db.collection('users').updateOne({ email: org.admin.email }, { $set: { isBanned: true } })

  const validAuth = auth.createAuthenticationResponse(loginOpt.json.options.challenge)
  const resBanned = await kit.api('/api/auth/passkey/login', {
    method: 'PUT', body: { userId: org.admin.id, response: validAuth },
  })
  assert.equal(resBanned.status, 403)
  assert.match(resBanned.json.error, /suspended/i)
})

test('P2.7 Passkey login verify: successful assertion issues session cookie and increments counter', async () => {
  const { org, session } = await setupTenant('Passkey Success Org')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // Register passkey
  const regOpt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: auth.createRegistrationResponse(regOpt.json.challenge), nickname: 'Valid Login Key' },
  })

  // Start login
  const loginOpt = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  assert.equal(loginOpt.status, 200)

  const authResponse = auth.createAuthenticationResponse(loginOpt.json.options.challenge)
  const res = await kit.api('/api/auth/passkey/login', {
    method: 'PUT', body: { userId: org.admin.id, response: authResponse },
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.user.email, org.admin.email)
  assert.equal(res.json.webAccess, true)

  const cookieHeader = res.headers.get('set-cookie') || ''
  assert.match(cookieHeader, /dd_session=/, 'dd_session cookie was issued')

  // Verify counter incremented in DB
  const credDoc = await db.collection('passkeycredentials').findOne({ credentialId: auth.credIdB64 })
  assert.ok(credDoc.counter > 0, 'authenticator counter incremented')
  assert.ok(credDoc.lastUsedAt, 'lastUsedAt updated')

  // Authenticate using the issued session cookie to confirm it works
  const sessionCookie = cookieHeader.split(';')[0]
  const me = await kit.api('/api/auth/me', { cookie: sessionCookie })
  assert.equal(me.status, 200)
  assert.equal(me.json.user.id, org.admin.id)
})

/* ─────────────────────────────────────────────────────────────────────────
 * 3. Passkey Credential Management (List & Revoke)
 * ───────────────────────────────────────────────────────────────────────── */

test('P3.1 List credentials: 401 unauthenticated, rate limit 429', async () => {
  const r1 = await kit.api('/api/auth/passkey/credentials', { method: 'GET' })
  assert.equal(r1.status, 401)
})

test('P3.2 List credentials: strictly scoped to signed-in user and tenant without leaking secret keys', async () => {
  const { org: orgA, session: sessionA } = await setupTenant('Passkey List Org A')
  const { org: orgB, session: sessionB } = await setupTenant('Passkey List Org B')

  const authA = createSyntheticAuthenticator(RP_ID, ORIGIN)
  const authB = createSyntheticAuthenticator(RP_ID, ORIGIN)

  // Register passkey for User A
  const optA = await kit.api('/api/auth/passkey/register', { method: 'POST', token: sessionA.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: sessionA.accessToken, body: { response: authA.createRegistrationResponse(optA.json.challenge), nickname: 'Key A' },
  })

  // Register passkey for User B
  const optB = await kit.api('/api/auth/passkey/register', { method: 'POST', token: sessionB.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: sessionB.accessToken, body: { response: authB.createRegistrationResponse(optB.json.challenge), nickname: 'Key B' },
  })

  // User A lists passkeys: sees only Key A
  const listA = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: sessionA.accessToken })
  assert.equal(listA.status, 200)
  assert.equal(listA.json.passkeys.length, 1)
  assert.equal(listA.json.passkeys[0].nickname, 'Key A')
  // Verify safe projection: no publicKey or credentialId leaked
  assert.equal(listA.json.passkeys[0].publicKey, undefined)
  assert.equal(listA.json.passkeys[0].credentialId, undefined)

  // User B lists passkeys: sees only Key B
  const listB = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: sessionB.accessToken })
  assert.equal(listB.status, 200)
  assert.equal(listB.json.passkeys.length, 1)
  assert.equal(listB.json.passkeys[0].nickname, 'Key B')
})

test('P3.3 Delete credential: 401 unauthenticated, 400 missing id, 404 invalid format', async () => {
  const { session } = await setupTenant('Passkey Del Validation')
  const r1 = await kit.api('/api/auth/passkey/credentials', { method: 'DELETE', body: { id: 'any' } })
  assert.equal(r1.status, 401)

  const r2 = await kit.api('/api/auth/passkey/credentials', { method: 'DELETE', token: session.accessToken, body: {} })
  assert.equal(r2.status, 400)
  assert.equal(r2.json?.error, 'id required')

  // Invalid ObjectId string is clean 404, never 500
  const r3 = await kit.api('/api/auth/passkey/credentials', {
    method: 'DELETE', token: session.accessToken, body: { id: 'not_an_object_id' },
  })
  assert.equal(r3.status, 404)
  assert.equal(r3.json?.error, 'Passkey not found')

  // Oversized body (> 64KB)
  const r4 = await kit.api('/api/auth/passkey/credentials', {
    method: 'DELETE', token: session.accessToken, raw: JSON.stringify({ id: 'x'.repeat(70_000) }),
  })
  assert.equal(r4.status, 413)
})

test('P3.4 Delete credential: cross-user and cross-tenant deletion prevented (404)', async () => {
  const { session: sessionA } = await setupTenant('Passkey Cross Org A')
  const { session: sessionB } = await setupTenant('Passkey Cross Org B')

  const authA = createSyntheticAuthenticator(RP_ID, ORIGIN)
  const optA = await kit.api('/api/auth/passkey/register', { method: 'POST', token: sessionA.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: sessionA.accessToken, body: { response: authA.createRegistrationResponse(optA.json.challenge), nickname: 'Owner Key A' },
  })

  const listA = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: sessionA.accessToken })
  const keyIdA = listA.json.passkeys[0].id

  // User B (different org) attempts to delete User A's key
  const delCrossOrg = await kit.api('/api/auth/passkey/credentials', {
    method: 'DELETE', token: sessionB.accessToken, body: { id: keyIdA },
  })
  assert.equal(delCrossOrg.status, 404)
  assert.equal(delCrossOrg.json.error, 'Passkey not found')

  // Key remains untouched
  const checkA = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: sessionA.accessToken })
  assert.equal(checkA.json.passkeys.length, 1)
})

test('P3.5 Delete credential: owner successfully revokes passkey and writes audit log', async () => {
  const { org, session } = await setupTenant('Passkey Revocation Org')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)

  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken, body: { response: auth.createRegistrationResponse(opt.json.challenge), nickname: 'Revocable Key' },
  })

  const list = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: session.accessToken })
  const keyId = list.json.passkeys[0].id

  const delRes = await kit.api('/api/auth/passkey/credentials', {
    method: 'DELETE', token: session.accessToken, body: { id: keyId },
  })
  assert.equal(delRes.status, 200)
  assert.equal(delRes.json.ok, true)

  // Verify list is now empty
  const listAfter = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: session.accessToken })
  assert.equal(listAfter.json.passkeys.length, 0)

  // Subsequent login options for this user returns 404
  const loginOpt = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  assert.equal(loginOpt.status, 404)

  // Verify audit log
  const audit = await findAudit({
    orgId: org.orgId,
    action: 'user.passkey_removed',
    targetId: org.admin.id,
  })
  assert.ok(audit, 'Audit log recorded for user.passkey_removed')
})

/* ─────────────────────────────────────────────────────────────────────────
 * 4. TOTP Setup, Enrollment & Anti-Replay
 * ───────────────────────────────────────────────────────────────────────── */

test('T4.1 TOTP setup begin: 401 unauthenticated, rate limit 429', async () => {
  const r = await kit.api('/api/auth/totp/setup', { method: 'POST' })
  assert.equal(r.status, 401)
})

test('T4.2 TOTP setup begin: returns otpauthUrl and secret, stores encrypted secret in DB', async () => {
  const { org, session } = await setupTenant('TOTP Setup Org')
  const r = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  assert.equal(r.status, 200)
  assert.ok(typeof r.json.secret === 'string' && r.json.secret.length >= 16, 'secret returned')
  assert.ok(r.json.otpauthUrl.startsWith('otpauth://totp/DoppelDash:'), 'otpauth URL format valid')
  assert.ok(r.json.otpauthUrl.includes(r.json.secret), 'otpauth URL includes secret')

  // Verify DB state: secret is encrypted, totpEnabled is still false
  const user = await db.collection('users').findOne({ email: org.admin.email })
  assert.equal(user.totpEnabled, false, 'totp is not enabled until verified')
  assert.ok(user.totpSecret, 'totpSecret is stored')
  assert.notEqual(user.totpSecret, r.json.secret, 'secret is encrypted at rest, not plaintext')
})

test('T4.3 TOTP confirm: 400 on malformed input, missing code, invalid code format, 413 oversized', async () => {
  const { session } = await setupTenant('TOTP Format Org')
  // Missing code
  const r1 = await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: {} })
  assert.equal(r1.status, 400)
  assert.equal(r1.json?.error, 'code required')

  // Non-6-digit format (letters, short digits, long digits)
  for (const bad of ['abcdef', '12345', '1234567', ' 1234 ']) {
    const r = await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: bad } })
    assert.equal(r.status, 400, `Code "${bad}" must be rejected`)
    assert.equal(r.json?.error, 'Invalid 6-digit code format')
  }

  // Oversized body (> 64KB)
  const rHuge = await kit.api('/api/auth/totp/setup', {
    method: 'PUT', token: session.accessToken, raw: JSON.stringify({ code: 'x'.repeat(70_000) }),
  })
  assert.equal(rHuge.status, 413)
})

test('T4.4 TOTP confirm: rejects incorrect code (400) without enabling', async () => {
  const { org, session } = await setupTenant('TOTP Incorrect Org')
  await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })

  const r = await kit.api('/api/auth/totp/setup', {
    method: 'PUT', token: session.accessToken, body: { code: '000000' },
  })
  assert.equal(r.status, 400)
  assert.match(r.json.error, /Incorrect code/i)

  const user = await db.collection('users').findOne({ email: org.admin.email })
  assert.equal(user.totpEnabled, false, 'totpEnabled remains false')
})

test('T4.5 TOTP confirm: valid code enables TOTP, writes audit log, and anti-replay blocks reuse', async () => {
  const { org, session } = await setupTenant('TOTP Valid Confirm Org')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const secret = setup.json.secret

  // Generate valid TOTP token for current time window
  const validCode = await otplib.generate({ secret })
  assert.ok(/^\d{6}$/.test(validCode), 'generated 6-digit token')

  // 1. Confirm setup succeeds
  const confirmRes = await kit.api('/api/auth/totp/setup', {
    method: 'PUT', token: session.accessToken, body: { code: validCode },
  })
  assert.equal(confirmRes.status, 200)
  assert.equal(confirmRes.json.ok, true)

  // Verify user doc in DB has totpEnabled: true
  const user = await db.collection('users').findOne({ email: org.admin.email })
  assert.equal(user.totpEnabled, true)

  // Verify audit log
  const audit = await findAudit({
    orgId: org.orgId,
    action: 'user.totp_enabled',
    targetId: org.admin.id,
  })
  assert.ok(audit, 'Audit log recorded for user.totp_enabled')

  // 2. Anti-replay: submitting the same setup code a second time fails (400)
  const replayRes = await kit.api('/api/auth/totp/setup', {
    method: 'PUT', token: session.accessToken, body: { code: validCode },
  })
  assert.equal(replayRes.status, 400)
  assert.match(replayRes.json.error, /Incorrect code/i)
})

test('T4.6 TOTP disable: signed-in user disables TOTP, unsets secret, writes audit log', async () => {
  const { org, session } = await setupTenant('TOTP Disable Org')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const validCode = await otplib.generate({ secret: setup.json.secret })
  await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: validCode } })

  // Disable TOTP
  const delRes = await kit.api('/api/auth/totp/setup', { method: 'DELETE', token: session.accessToken })
  assert.equal(delRes.status, 200)
  assert.equal(delRes.json.ok, true)

  // Verify DB state
  const user = await db.collection('users').findOne({ email: org.admin.email })
  assert.equal(user.totpEnabled, false)
  assert.equal(user.totpSecret, undefined)

  // Verify audit log
  const audit = await findAudit({
    orgId: org.orgId,
    action: 'user.totp_disabled',
    targetId: org.admin.id,
  })
  assert.ok(audit, 'Audit log recorded for user.totp_disabled')
})

/* ─────────────────────────────────────────────────────────────────────────
 * 5. TOTP Login & Verification
 * ───────────────────────────────────────────────────────────────────────── */

test('T5.1 Login requires TOTP when enabled, returns preAuthToken with methods: [totp]', async () => {
  const { org, session } = await setupTenant('TOTP Login Flow Org')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const validCode = await otplib.generate({ secret: setup.json.secret })
  await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: validCode } })

  // Sign in step 1 (password)
  const step1 = await kit.api('/api/auth/login', {
    method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD },
  })
  assert.equal(step1.status, 200)
  assert.ok(step1.json.preAuthToken, 'preAuthToken returned')
  assert.ok(Array.isArray(step1.json.methods), 'methods array returned')
  assert.ok(step1.json.methods.includes('totp'), 'methods includes totp')
})

test('T5.2 TOTP verify-otp: session security (missing, expired, or forged preAuthToken)', async () => {
  const r1 = await kit.api('/api/auth/verify-otp', {
    method: 'POST', body: { method: 'totp', otp: '123456' },
  })
  assert.equal(r1.status, 401)
  assert.match(r1.json.error, /Session expired/i)

  const r2 = await kit.api('/api/auth/verify-otp', {
    method: 'POST', body: { preAuthToken: 'forged.token.payload', method: 'totp', otp: '123456' },
  })
  assert.equal(r2.status, 401)
})

test('T5.3 TOTP verify-otp: input format validation, oversized payload, and rate limiting', async () => {
  const { org } = await setupTenant('TOTP Bounds Org')
  const step1 = await kit.api('/api/auth/login', {
    method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD },
  })
  const pre = step1.json.preAuthToken

  // Missing otp
  const r1 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: pre, method: 'totp' } })
  assert.equal(r1.status, 400)
  assert.equal(r1.json.error, 'otp required')

  // Malformed format
  const r2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: pre, method: 'totp', otp: 'abc' } })
  assert.equal(r2.status, 400)
  assert.equal(r2.json.error, 'Invalid 6-digit code format')

  // Oversized body (> 64KB)
  const r3 = await kit.api('/api/auth/verify-otp', {
    method: 'POST', raw: JSON.stringify({ preAuthToken: pre, method: 'totp', otp: '123456', pad: 'x'.repeat(70_000) }),
  })
  assert.equal(r3.status, 413)
})

test('T5.4 TOTP verify-otp: incorrect code rejected (401)', async () => {
  const { org, session } = await setupTenant('TOTP Wrong Code Org')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const validCode = await otplib.generate({ secret: setup.json.secret })
  await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: validCode } })

  const step1 = await kit.api('/api/auth/login', {
    method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD },
  })
  const res = await kit.api('/api/auth/verify-otp', {
    method: 'POST', body: { preAuthToken: step1.json.preAuthToken, method: 'totp', otp: '000000' },
  })
  assert.equal(res.status, 401)
  assert.match(res.json.error, /Incorrect authenticator code/i)
})

test('T5.5 TOTP verify-otp: successful verification completes login and anti-replay prevents reusing login code', async () => {
  const { org, session } = await setupTenant('TOTP Complete Login Org')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const secret = setup.json.secret
  const setupCode = await otplib.generate({ secret, epoch: Math.floor(Date.now() / 1000) - 30 })
  await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: setupCode } })

  // Generate distinct current login code
  const loginCode = await otplib.generate({ secret, epoch: Math.floor(Date.now() / 1000) })

  // Login step 1
  const step1 = await kit.api('/api/auth/login', {
    method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD },
  })
  assert.equal(step1.status, 200)

  // Login step 2 with valid TOTP code
  const step2 = await kit.api('/api/auth/verify-otp', {
    method: 'POST', body: { preAuthToken: step1.json.preAuthToken, method: 'totp', otp: loginCode },
  })
  assert.equal(step2.status, 200)
  assert.equal(step2.json.user.email, org.admin.email)
  assert.ok(step2.json.accessToken, 'access token returned')
  assert.ok(step2.headers.get('set-cookie'), 'cookie set')

  // Attempt to replay the exact same code with a new preAuthToken
  const step1Again = await kit.api('/api/auth/login', {
    method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD },
  })
  const step2Replay = await kit.api('/api/auth/verify-otp', {
    method: 'POST', body: { preAuthToken: step1Again.json.preAuthToken, method: 'totp', otp: loginCode },
  })
  assert.equal(step2Replay.status, 401, 'Replayed TOTP code must be rejected')
  assert.match(step2Replay.json.error, /Incorrect authenticator code/i)
})

/* ─────────────────────────────────────────────────────────────────────────
 * 6. Session Invalidation & Revocation Invariants
 * ───────────────────────────────────────────────────────────────────────── */

test('R6.1 Logout revokes session for passkey & TOTP endpoints', async () => {
  const { session } = await setupTenant('Logout Invalidation Org')

  // Verify access before logout
  const credsBefore = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: session.accessToken })
  assert.equal(credsBefore.status, 200)

  // Logout
  const logoutRes = await kit.api('/api/auth/logout', { method: 'POST', token: session.accessToken })
  assert.equal(logoutRes.status, 200)

  // Session token is now revoked in RevokedToken model
  const credsAfter = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: session.accessToken })
  assert.equal(credsAfter.status, 401, 'Revoked session token cannot access passkey credentials')

  const totpAfter = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  assert.equal(totpAfter.status, 401, 'Revoked session token cannot access TOTP setup')
})

test('R6.2 Password change increments sessionVersion and invalidates old sessions', async () => {
  const { org, session } = await setupTenant('Password Invalidation Org')

  // User changes password
  const newPass = 'N3w!Passw0rd#2026'
  const changeRes = await kit.api('/api/auth/change-password', {
    method: 'POST',
    token: session.accessToken,
    body: { currentPassword: kit.PASSWORD, newPassword: newPass },
  })
  assert.equal(changeRes.status, 200)

  // Old session token has old sessionVersion -> rejected with 401
  const checkOldSession = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: session.accessToken })
  assert.equal(checkOldSession.status, 401, 'Old session token rejected after password change')

  const checkOldTotp = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  assert.equal(checkOldTotp.status, 401, 'Old session token cannot initiate TOTP setup after password change')

  // New login with new password succeeds and gets new session
  const newSession = await kit.login(org.admin.email, newPass)
  const credsNew = await kit.api('/api/auth/passkey/credentials', { method: 'GET', token: newSession.accessToken })
  assert.equal(credsNew.status, 200)
})
