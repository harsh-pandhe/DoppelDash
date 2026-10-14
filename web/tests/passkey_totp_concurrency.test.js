/**
 * DoppelDash — Phase 1E: atomic authentication replay protection.
 *
 * Real concurrent HTTP requests (Promise.all) against the running server and a disposable MongoDB.
 * Outcomes are asserted on the database and on issued sessions, not on helper return values.
 *
 *   C1  TOTP login code: N simultaneous verifications -> exactly one session
 *   C2  TOTP setup confirmation: N simultaneous confirmations -> exactly one success, one audit row
 *   C3  Passkey assertion: N simultaneous assertions with one challenge -> exactly one session
 *   C4  Passkey registration: N simultaneous verifications of one challenge -> one credential
 *   C5  Expired / missing / half-written challenges and replayed codes stay rejected
 *   C6  Invalid TOTP attempts never consume a valid code
 *   C7  Cross-user / cross-tenant isolation of claims and challenges
 *   C8  Database conflicts and unexpected database failures fail closed (TOTP claims)
 *   C9  Genuine database write failure during atomic WebAuthn challenge consumption fails closed (registration + login)
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const otplib = require('otplib')
const kit = require('./helpers/authTestKit')
const { createSyntheticAuthenticator } = require('./helpers/syntheticAuthenticator')

const REPEATS = 5       // race iterations per scenario (each on fresh users/secrets)
const FANOUT = 4        // simultaneous requests per iteration
const CLAIMS = 'authreplayclaims'

let db
let RP_ID
let ORIGIN
const orgIds = []
const userIds = []

test.before(async () => {
  db = await kit.connect()
  const u = new URL(kit.BASE_URL)
  RP_ID = u.hostname
  ORIGIN = u.origin
})

test.after(async () => {
  try {
    await db.command({ collMod: CLAIMS, validator: {}, validationLevel: 'off' }).catch(() => {})
    await clearUsersFault().catch(() => {})
    if (userIds.length) await db.collection(CLAIMS).deleteMany({ userId: { $in: userIds } }).catch(() => {})
    if (orgIds.length) await db.collection('passkeycredentials').deleteMany({ orgId: { $in: orgIds } }).catch(() => {})
    await db.collection('ratelimits').deleteMany({ key: { $regex: /^(totp-|pk-|otp:)/ } }).catch(() => {})
    await kit.cleanupAll(db)
  } finally {
    await kit.disconnect()
  }
})

async function tenant(name) {
  const org = await kit.createOrg({ name, webEnabled: true, plan: 'premium' })
  orgIds.push(org.orgId)
  userIds.push(org.admin.id, org.manager.id, org.employee.id)
  const session = await kit.login(org.admin.email, kit.PASSWORD)
  return { org, session }
}

/** Begin + confirm TOTP for the signed-in admin. Returns the (plaintext) secret. */
async function enableTotp(session) {
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  assert.equal(setup.status, 200)
  const secret = setup.json.secret
  const code = await otplib.generate({ secret, epoch: Math.floor(Date.now() / 1000) - 30 })
  const ok = await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code } })
  assert.equal(ok.status, 200, 'enableTotp: setup confirmation')
  return secret
}

const currentCode = secret => otplib.generate({ secret, epoch: Math.floor(Date.now() / 1000) })

async function preAuth(email) {
  const step1 = await kit.api('/api/auth/login', { method: 'POST', body: { email, password: kit.PASSWORD } })
  assert.equal(step1.status, 200)
  assert.ok(step1.json.preAuthToken)
  return step1.json.preAuthToken
}

const verifyTotpLogin = (preAuthToken, otp) =>
  kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken, method: 'totp', otp } })

const { ObjectId } = require('mongodb')
const userDoc = async id => db.collection('users').findOne({ _id: new ObjectId(id) })
const count = (rs, status) => rs.filter(r => r.status === status).length
const sessions = rs => rs.filter(r => r.status === 200 && /dd_session=/.test(r.headers.get('set-cookie') || ''))

async function registerPasskey(session, auth, nickname = 'Race key') {
  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(opt.status, 200)
  const res = await kit.api('/api/auth/passkey/register', {
    method: 'PUT', token: session.accessToken,
    body: { response: auth.createRegistrationResponse(opt.json.challenge), nickname },
  })
  assert.equal(res.status, 200, 'registerPasskey')
}

async function loginOptions(email) {
  const r = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email } })
  assert.equal(r.status, 200)
  return r.json
}

const passkeyAssert = (userId, response) =>
  kit.api('/api/auth/passkey/login', { method: 'PUT', body: { userId, response } })

/* ───────────────────────── C1: TOTP login race ───────────────────────── */

test('C1 TOTP login: simultaneous requests with one valid code -> exactly one session (x%d)'.replace('%d', REPEATS), async () => {
  for (let i = 0; i < REPEATS; i++) {
    const { org, session } = await tenant(`TOTP race login ${i}`)
    const secret = await enableTotp(session)
    const code = await currentCode(secret)
    const before = (await userDoc(org.admin.id)).loginCount || 0
    const tokens = await Promise.all(Array.from({ length: FANOUT }, () => preAuth(org.admin.email)))

    const results = await Promise.all(tokens.map(t => verifyTotpLogin(t, code)))

    assert.equal(count(results, 200), 1, `iteration ${i}: exactly one 200, got ${results.map(r => r.status)}`)
    assert.equal(count(results, 401), FANOUT - 1, `iteration ${i}: all others 401`)
    assert.equal(sessions(results).length, 1, `iteration ${i}: exactly one session cookie issued`)
    assert.equal(results.filter(r => r.json?.accessToken).length, 1, 'exactly one mobile access token issued')
    assert.equal((await userDoc(org.admin.id)).loginCount, before + 1, 'exactly one login recorded')
    assert.equal(await db.collection(CLAIMS).countDocuments({ userId: org.admin.id }), 2, 'setup claim + login claim, nothing more')
  }
})

test('C1b TOTP login: one preAuthToken reused by simultaneous requests -> exactly one session', async () => {
  const { org, session } = await tenant('TOTP race shared preauth')
  const secret = await enableTotp(session)
  const code = await currentCode(secret)
  const token = await preAuth(org.admin.email)
  const results = await Promise.all(Array.from({ length: 3 }, () => verifyTotpLogin(token, code)))
  assert.equal(count(results, 200), 1)
  assert.equal(sessions(results).length, 1)
})

/* ───────────────────────── C2: TOTP setup race ───────────────────────── */

test('C2 TOTP setup: simultaneous confirmations with one valid code -> exactly one success (x%d)'.replace('%d', REPEATS), async () => {
  for (let i = 0; i < REPEATS; i++) {
    const t = await tenant(`TOTP race setup ${i}`)
    const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: t.session.accessToken })
    const code = await currentCode(setup.json.secret)

    const results = await Promise.all(Array.from({ length: FANOUT }, () =>
      kit.api('/api/auth/totp/setup', { method: 'PUT', token: t.session.accessToken, body: { code } })))

    assert.equal(count(results, 200), 1, `iteration ${i}: exactly one confirmation, got ${results.map(r => r.status)}`)
    assert.equal(count(results, 400), FANOUT - 1)
    assert.equal((await userDoc(t.org.admin.id)).totpEnabled, true)
    // audit rows are written fire-and-forget: wait for the first, then give any (wrong) duplicate time to appear
    for (let n = 0; n < 60 && !(await db.collection('auditlogs').countDocuments({ orgId: t.org.orgId, action: 'user.totp_enabled' })); n++) await new Promise(r => setTimeout(r, 50))
    await new Promise(r => setTimeout(r, 200))
    assert.equal(await db.collection('auditlogs').countDocuments({ orgId: t.org.orgId, action: 'user.totp_enabled', targetId: t.org.admin.id }), 1, 'one audit row')
    assert.equal(await db.collection(CLAIMS).countDocuments({ userId: t.org.admin.id }), 1)
  }
})

test('C2b TOTP setup code cannot then be replayed as a login code (setup and login share one claim space)', async () => {
  const { org, session } = await tenant('TOTP setup/login share claim')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const code = await currentCode(setup.json.secret)
  const ok = await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code } })
  assert.equal(ok.status, 200)
  const r = await verifyTotpLogin(await preAuth(org.admin.email), code)
  assert.equal(r.status, 401)
  assert.equal(sessions([r]).length, 0)
})

/* ───────────────────────── C3: passkey assertion race ───────────────────────── */

test('C3 Passkey login: simultaneous assertions with one challenge -> exactly one session (x%d)'.replace('%d', REPEATS), async () => {
  for (let i = 0; i < REPEATS; i++) {
    const { org, session } = await tenant(`Passkey race login ${i}`)
    const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)
    await registerPasskey(session, auth)
    const before = (await userDoc(org.admin.id)).loginCount || 0
    const opts = await loginOptions(org.admin.email)
    // distinct (validly signed) assertions for the SAME challenge, plus one byte-identical duplicate
    const one = auth.createAuthenticationResponse(opts.options.challenge)
    const responses = [one, one, ...Array.from({ length: FANOUT - 2 }, () => auth.createAuthenticationResponse(opts.options.challenge))]

    const results = await Promise.all(responses.map(r => passkeyAssert(org.admin.id, r)))

    assert.equal(sessions(results).length, 1, `iteration ${i}: exactly one authenticated session, got ${results.map(r => r.status)}`)
    assert.equal(count(results, 200), 1)
    assert.equal(count(results, 401), FANOUT - 1)
    const u = await userDoc(org.admin.id)
    assert.equal(u.loginCount, before + 1, 'exactly one login recorded')
    assert.equal(u.webauthnChallenge, undefined, 'challenge consumed')
    assert.equal(u.webauthnChallengeExpiry, undefined)
  }
})

/* ───────────────────────── C4: passkey registration race ───────────────────────── */

test('C4 Passkey registration: simultaneous verifications of one challenge -> one credential (x%d)'.replace('%d', REPEATS), async () => {
  for (let i = 0; i < REPEATS; i++) {
    const { org, session } = await tenant(`Passkey race register ${i}`)
    const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
    assert.equal(opt.status, 200)
    // different authenticators, same challenge: a non-atomic consume lets several register
    const authenticators = Array.from({ length: FANOUT }, () => createSyntheticAuthenticator(RP_ID, ORIGIN))

    const results = await Promise.all(authenticators.map((a, n) => kit.api('/api/auth/passkey/register', {
      method: 'PUT', token: session.accessToken, body: { response: a.createRegistrationResponse(opt.json.challenge), nickname: `K${n}` },
    })))

    assert.equal(count(results, 200), 1, `iteration ${i}: exactly one registration, got ${results.map(r => r.status)}`)
    assert.equal(count(results, 400), FANOUT - 1)
    assert.equal(await db.collection('passkeycredentials').countDocuments({ userId: org.admin.id }), 1, 'one credential persisted')
    assert.equal((await userDoc(org.admin.id)).webauthnChallenge, undefined)
  }
})

/* ───────────────────────── C5: expiry / missing challenge ───────────────────────── */

test('C5 Challenges: expired, missing, or half-written challenges fail closed (login and registration)', async () => {
  const { org, session } = await tenant('Challenge expiry')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)
  await registerPasskey(session, auth)
  const id = new ObjectId(org.admin.id)

  // login: expired
  let opts = await loginOptions(org.admin.email)
  await db.collection('users').updateOne({ _id: id }, { $set: { webauthnChallengeExpiry: new Date(Date.now() - 1000) } })
  let r = await passkeyAssert(org.admin.id, auth.createAuthenticationResponse(opts.options.challenge))
  assert.equal(r.status, 401); assert.equal(sessions([r]).length, 0)

  // login: never issued
  await db.collection('users').updateOne({ _id: id }, { $unset: { webauthnChallenge: 1, webauthnChallengeExpiry: 1 } })
  r = await passkeyAssert(org.admin.id, auth.createAuthenticationResponse(opts.options.challenge))
  assert.equal(r.status, 401); assert.equal(sessions([r]).length, 0)

  // login: challenge present but expiry missing (half-written state) must not be accepted
  opts = await loginOptions(org.admin.email)
  await db.collection('users').updateOne({ _id: id }, { $unset: { webauthnChallengeExpiry: 1 } })
  r = await passkeyAssert(org.admin.id, auth.createAuthenticationResponse(opts.options.challenge))
  assert.equal(r.status, 401); assert.equal(sessions([r]).length, 0)

  // registration: expired, then replayed after success
  const reg = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  await db.collection('users').updateOne({ _id: id }, { $set: { webauthnChallengeExpiry: new Date(Date.now() - 1000) } })
  const a2 = createSyntheticAuthenticator(RP_ID, ORIGIN)
  const put = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, body: { response: a2.createRegistrationResponse(reg.json.challenge), nickname: 'late' } })
  assert.equal(put.status, 400); assert.match(put.json.error, /expired/i)
  assert.equal(await db.collection('passkeycredentials').countDocuments({ userId: org.admin.id }), 1)

  // valid -> consumed -> replay rejected
  opts = await loginOptions(org.admin.email)
  const good = auth.createAuthenticationResponse(opts.options.challenge)
  assert.equal((await passkeyAssert(org.admin.id, good)).status, 200)
  const replay = await passkeyAssert(org.admin.id, auth.createAuthenticationResponse(opts.options.challenge))
  assert.equal(replay.status, 401); assert.equal(sessions([replay]).length, 0)
})

test('C5b Replayed TOTP login code stays rejected (sequential)', async () => {
  const { org, session } = await tenant('TOTP sequential replay')
  const secret = await enableTotp(session)
  const code = await currentCode(secret)
  assert.equal((await verifyTotpLogin(await preAuth(org.admin.email), code)).status, 200)
  for (let i = 0; i < 3; i++) assert.equal((await verifyTotpLogin(await preAuth(org.admin.email), code)).status, 401)
})

/* ───────────────────────── C6: invalid attempts do not consume ───────────────────────── */

test('C6 Invalid TOTP attempts do not consume a valid code (login and setup)', async () => {
  const { org, session } = await tenant('TOTP invalid does not consume')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const secret = setup.json.secret
  const valid = await currentCode(secret)
  const wrong = valid === '000000' ? '000001' : '000000'

  // setup: wrong-code floods (incl. concurrent) first, then the valid code still works
  const bad = await Promise.all(Array.from({ length: 3 }, () => kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: wrong } })))
  assert.ok(bad.every(r => r.status === 400))
  assert.equal(await db.collection(CLAIMS).countDocuments({ userId: org.admin.id }), 0, 'no claim for an invalid code')
  assert.equal((await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code: valid } })).status, 200)

  // login: concurrent mix of wrong codes and the valid one -> the valid one wins exactly once
  const login = await otplib.generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 })   // a different step than the (claimed) setup code
  assert.notEqual(login, valid)
  const tokens = await Promise.all(Array.from({ length: 4 }, () => preAuth(org.admin.email)))
  const attempts = await Promise.all([
    verifyTotpLogin(tokens[0], wrong), verifyTotpLogin(tokens[1], wrong),
    verifyTotpLogin(tokens[2], login), verifyTotpLogin(tokens[3], wrong),
  ])
  assert.equal(attempts[2].status, 200, 'the valid code still works after the invalid ones')
  assert.equal(attempts[0].status, 401); assert.equal(attempts[1].status, 401); assert.equal(attempts[3].status, 401)
  assert.equal(sessions([attempts[0], attempts[1], attempts[3]]).length, 0)
  const claims = await db.collection(CLAIMS).countDocuments({ userId: org.admin.id })
  assert.equal(claims, 2, 'only the two valid codes (setup + login) were ever claimed')
})

/* ───────────────────────── C7: cross-user / cross-tenant ───────────────────────── */

test('C7 TOTP claims are scoped per user: same secret/code in another tenant is independent; wrong user cannot burn a code', async () => {
  const a = await tenant('Claim scope A')
  const b = await tenant('Claim scope B')
  const secret = await enableTotp(a.session)
  // give B the very same secret (disposable data) so both users hold identical codes
  const aDoc = await userDoc(a.org.admin.id)
  await db.collection('users').updateOne({ _id: new ObjectId(b.org.admin.id) }, { $set: { totpSecret: aDoc.totpSecret, totpEnabled: true } })
  const code = await currentCode(secret)

  // B submits a code for B's own preAuth, A's preAuth is untouched
  const tokenA = await preAuth(a.org.admin.email)
  const tokenB = await preAuth(b.org.admin.email)
  const [ra, rb] = await Promise.all([verifyTotpLogin(tokenA, code), verifyTotpLogin(tokenB, code)])
  assert.equal(ra.status, 200, 'A authenticates')
  assert.equal(rb.status, 200, "B's identical code is not blocked by A's claim")
  assert.equal(ra.json.user.id, a.org.admin.id)
  assert.equal(rb.json.user.id, b.org.admin.id)
  assert.equal(ra.json.user.orgId, a.org.orgId)
  assert.equal(rb.json.user.orgId, b.org.orgId)
  // and each user's code is individually single-use
  assert.equal((await verifyTotpLogin(await preAuth(a.org.admin.email), code)).status, 401)
  assert.equal((await verifyTotpLogin(await preAuth(b.org.admin.email), code)).status, 401)
})

test('C7b A user without TOTP / another user cannot consume a code or a challenge belonging to someone else', async () => {
  const a = await tenant('Challenge scope A')
  const b = await tenant('Challenge scope B')
  const authA = createSyntheticAuthenticator(RP_ID, ORIGIN)
  const authB = createSyntheticAuthenticator(RP_ID, ORIGIN)
  await registerPasskey(a.session, authA)
  await registerPasskey(b.session, authB)

  const optsA = await loginOptions(a.org.admin.email)
  const optsB = await loginOptions(b.org.admin.email)
  // B's credential asserting A's challenge for B's account: challenge mismatch -> 401, and A's challenge is untouched by it
  const crossed = await passkeyAssert(b.org.admin.id, authB.createAuthenticationResponse(optsA.options.challenge))
  assert.equal(crossed.status, 401); assert.equal(sessions([crossed]).length, 0)
  // A's credential presented under B's userId -> unknown passkey, nothing consumed
  const wrongOwner = await passkeyAssert(b.org.admin.id, authA.createAuthenticationResponse(optsB.options.challenge))
  assert.equal(wrongOwner.status, 401); assert.equal(sessions([wrongOwner]).length, 0)
  assert.equal((await userDoc(a.org.admin.id)).webauthnChallenge, optsA.options.challenge, "A's challenge not consumed by B's requests")
  // A can still use it exactly once
  const ra = await passkeyAssert(a.org.admin.id, authA.createAuthenticationResponse(optsA.options.challenge))
  assert.equal(ra.status, 200); assert.equal(ra.json.user.orgId, a.org.orgId)
  // B's account is not authenticated via A's session artefacts
  assert.equal(await db.collection('passkeycredentials').countDocuments({ userId: b.org.admin.id, orgId: a.org.orgId }), 0)
})

test('C7c Suspended account: concurrent valid assertions yield no session', async () => {
  const { org, session } = await tenant('Suspended race')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)
  await registerPasskey(session, auth)
  const opts = await loginOptions(org.admin.email)
  await db.collection('users').updateOne({ _id: new ObjectId(org.admin.id) }, { $set: { isBanned: true } })
  const rs = await Promise.all(Array.from({ length: 3 }, () => passkeyAssert(org.admin.id, auth.createAuthenticationResponse(opts.options.challenge))))
  assert.equal(sessions(rs).length, 0)
  assert.ok(rs.every(r => r.status === 401 || r.status === 403))
})

/* ───────────────────────── C8: conflicts and database failures ───────────────────────── */

test('C8 Existing claim (unique-key conflict) rejects the code; database write failure fails closed and consumes nothing', async () => {
  const { org, session } = await tenant('DB failure fail-closed')
  const setup = await kit.api('/api/auth/totp/setup', { method: 'POST', token: session.accessToken })
  const secret = setup.json.secret
  const code = await currentCode(secret)

  // make every write to the claims collection fail with a real server-side error (document validation, code 121)
  await db.collection(CLAIMS).insertOne({ key: `probe-${kit.rand()}`, userId: org.admin.id, purpose: 'probe', expiresAt: new Date(Date.now() + 60_000) }).catch(() => {})
  await db.command({ collMod: CLAIMS, validator: { $jsonSchema: { bsonType: 'object', required: ['__never_present__'] } }, validationLevel: 'strict', validationAction: 'error' })
  try {
    const confirm = await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code } })
    assert.equal(confirm.status, 400, 'setup confirmation must fail when the claim cannot be recorded')
    assert.equal((await userDoc(org.admin.id)).totpEnabled, false, 'TOTP not enabled on a failed claim')
  } finally {
    await db.command({ collMod: CLAIMS, validator: {}, validationLevel: 'off' })
  }
  // nothing was consumed: the same valid code now works exactly once
  const ok = await kit.api('/api/auth/totp/setup', { method: 'PUT', token: session.accessToken, body: { code } })
  assert.equal(ok.status, 200)

  // login path under the same fault
  const loginCode = await currentCode(secret)
  const token = await preAuth(org.admin.email)
  const before = (await userDoc(org.admin.id)).loginCount || 0
  await db.command({ collMod: CLAIMS, validator: { $jsonSchema: { bsonType: 'object', required: ['__never_present__'] } }, validationLevel: 'strict', validationAction: 'error' })
  try {
    const r = await verifyTotpLogin(token, loginCode === code ? await otplib.generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 }) : loginCode)
    assert.ok(r.status === 401 || r.status === 500, `no session on database failure, got ${r.status}`)
    assert.equal(sessions([r]).length, 0)
    assert.ok(!r.json?.accessToken)
    assert.equal((await userDoc(org.admin.id)).loginCount || 0, before)
  } finally {
    await db.command({ collMod: CLAIMS, validator: {}, validationLevel: 'off' })
  }

  // genuine duplicate: the claim written by the successful setup confirmation blocks the same code for login
  const dup = await verifyTotpLogin(await preAuth(org.admin.email), code)
  assert.equal(dup.status, 401)
  assert.equal(sessions([dup]).length, 0)
})

/* ───────────────────────── C9: WebAuthn challenge-consumption database failure ───────────────────────── */

// Real server-side write failure (document validation, code 121) on the one update that consumes the challenge:
// the validator requires webauthnChallenge to be present, so the atomic `$unset` is rejected by MongoDB while every
// other write (saving a challenge, updating a counter) is allowed. 'moderate' leaves users without a challenge alone.
const injectUsersFault = () => db.command({
  collMod: 'users', validator: { webauthnChallenge: { $type: 'string' } }, validationLevel: 'moderate', validationAction: 'error',
})
const clearUsersFault = () => db.command({ collMod: 'users', validator: {}, validationLevel: 'off' })

test('C9a Registration: database failure while consuming the challenge fails closed, nothing is consumed or created', async () => {
  const { org, session } = await tenant('Register consume DB failure')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)
  const opt = await kit.api('/api/auth/passkey/register', { method: 'POST', token: session.accessToken })
  assert.equal(opt.status, 200)
  const body = () => ({ response: auth.createRegistrationResponse(opt.json.challenge), nickname: 'fault' })
  try {
    await injectUsersFault()
    const r = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, body: body() })
    assert.equal(r.status, 400)
    assert.notEqual(r.json?.ok, true)
    assert.equal(await db.collection('passkeycredentials').countDocuments({ userId: org.admin.id }), 0, 'no credential created')
    // no fallback to a non-atomic read-then-unset: the challenge is still exactly as issued
    assert.equal((await userDoc(org.admin.id)).webauthnChallenge, opt.json.challenge)
  } finally {
    await clearUsersFault()
  }
  // fault removed: the very same challenge and response now succeed exactly once, proving nothing was silently consumed
  const ok = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, body: body() })
  assert.equal(ok.status, 200)
  assert.equal(await db.collection('passkeycredentials').countDocuments({ userId: org.admin.id }), 1)
  const replay = await kit.api('/api/auth/passkey/register', { method: 'PUT', token: session.accessToken, body: { response: createSyntheticAuthenticator(RP_ID, ORIGIN).createRegistrationResponse(opt.json.challenge), nickname: 'replay' } })
  assert.equal(replay.status, 400, 'already-consumed challenge rejected')
  assert.equal(await db.collection('passkeycredentials').countDocuments({ userId: org.admin.id }), 1)
})

test('C9b Login: database failure while consuming the challenge yields no session or token; state untouched', async () => {
  const { org, session } = await tenant('Login consume DB failure')
  const auth = createSyntheticAuthenticator(RP_ID, ORIGIN)
  await registerPasskey(session, auth)
  const credBefore = await db.collection('passkeycredentials').findOne({ userId: org.admin.id })
  const loginsBefore = (await userDoc(org.admin.id)).loginCount || 0
  const opts = await loginOptions(org.admin.email)
  const assertion = auth.createAuthenticationResponse(opts.options.challenge)
  try {
    await injectUsersFault()
    const rs = await Promise.all([1, 2, 3].map(() => passkeyAssert(org.admin.id, assertion)))
    for (const r of rs) {
      assert.equal(r.status, 401)
      assert.ok(!r.headers.get('set-cookie'), 'no cookie')
      assert.ok(!r.json?.user && !r.json?.accessToken && !r.json?.token, 'no user or token in body')
    }
    const u = await userDoc(org.admin.id)
    assert.equal(u.loginCount || 0, loginsBefore, 'no login recorded')
    assert.equal(u.webauthnChallenge, opts.options.challenge, 'challenge not consumed by a failed atomic update (no fallback path)')
    const credAfter = await db.collection('passkeycredentials').findOne({ userId: org.admin.id })
    assert.equal(credAfter.counter, credBefore.counter, 'authenticator counter untouched')
  } finally {
    await clearUsersFault()
  }
  // fault removed: the same assertion succeeds once, then the consumed/expired/missing cases stay rejected
  const ok = await passkeyAssert(org.admin.id, assertion)
  assert.equal(ok.status, 200)
  assert.equal(sessions([ok]).length, 1)
  const again = await passkeyAssert(org.admin.id, assertion)
  assert.equal(again.status, 401); assert.equal(sessions([again]).length, 0)
})

test('C9c Fault injection is removed: ordinary challenge flow works afterwards', async () => {
  const info = await db.listCollections({ name: 'users' }).toArray()
  assert.deepEqual(info[0]?.options?.validator || {}, {}, 'no validator left on users')
  const { org } = await tenant('Post-fault sanity')
  const r = await kit.api('/api/auth/passkey/login', { method: 'POST', body: { email: org.admin.email } })
  assert.equal(r.status, 404, 'user without passkeys: normal contract')
})
