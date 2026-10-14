/**
 * P0-01 — Google Play RTDN: Pub/Sub OIDC authentication (fail closed), authoritative reconciliation, idempotency, ordering.
 * The REAL route handler runs in-process against the throw-away MongoDB; Google's OIDC key set, OAuth token endpoint and Play Developer API
 * are LOCAL FAKES (tests/helpers/fakeProviders.js) — this proves our verification and reconciliation logic, not Google's behaviour.
 * Env must be set BEFORE the modules load (PLAY_CONFIG reads it at import).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fake = require('./helpers/fakeProviders')

const AUD = 'https://staging.example.test/api/billing/play/rtdn'
const PUSH_SA = 'pubsub-push@example-project.iam.gserviceaccount.com'
const sa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const oidc = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
Object.assign(process.env, fake.ENV, {
  GOOGLE_PLAY_RTDN_AUDIENCE: AUD, GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL: PUSH_SA,
  GOOGLE_PLAY_OIDC_JWKS_URL: `${fake.BASE}/oidc/certs`, GOOGLE_PLAY_OAUTH_TOKEN_URL: `${fake.BASE}/play/token`, GOOGLE_PLAY_PUBLISHER_API_BASE: `${fake.BASE}/play`,
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: 'play-sa@example-project.iam.gserviceaccount.com',
  GOOGLE_PLAY_SERVICE_ACCOUNT_KEY: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'),
})
const kit = require('./helpers/authTestKit')
const { NextRequest } = require('next/server')

let db, providers, jose, A, ORG, route, PLAY_CONFIG, Subscription, Organization
const post = (body, headers = {}, qs = '') => route.POST(new NextRequest(`http://localhost:3000/api/billing/play/rtdn${qs}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
async function oidcToken({ key = oidc.privateKey, aud = AUD, email = PUSH_SA, verified = true, iss = 'https://accounts.google.com', exp = '10m', kid = 'k1', alg = 'RS256' } = {}) {
  return new jose.SignJWT({ email, email_verified: verified }).setProtectedHeader({ alg, kid }).setIssuer(iss).setAudience(aud).setSubject('1234567890').setIssuedAt().setExpirationTime(exp).sign(key)
}
const good = async () => ({ authorization: `Bearer ${await oidcToken()}` })
const envelope = (token, type, messageId = 'm-' + crypto.randomBytes(5).toString('hex'), extra = {}) => ({ message: { messageId, data: Buffer.from(JSON.stringify({ version: '1.0', packageName: PLAY_CONFIG.packageName, eventTimeMillis: String(Date.now()), subscriptionNotification: { version: '1.0', notificationType: type, purchaseToken: token, subscriptionId: PLAY_CONFIG.premiumProductId }, ...extra })).toString('base64') } })
const play = (token, sub) => fetch(`${fake.BASE}/__play`, { method: 'POST', body: JSON.stringify({ token, sub }) })
const playCalls = async () => (await (await fetch(`${fake.BASE}/__play-calls`)).json()).calls.filter(c => c.kind === 'get')
const days = n => new Date(Date.now() + n * 864e5).toISOString()
const T = { RENEWED: 2, CANCELED: 3, EXPIRED: 13, REVOKED: 12, ON_HOLD: 5 }
let seq = 0
async function mkSub(org, status = 'active', end = 30) {
  const token = `play_tok_${process.pid}_${++seq}_${crypto.randomBytes(4).toString('hex')}`
  await Subscription.create({ orgId: org.orgId, provider: 'google_play', productId: PLAY_CONFIG.premiumProductId, purchaseToken: token, status, currentPeriodEnd: new Date(Date.now() + end * 864e5), autoRenewing: true })
  return token
}
const orgDoc = id => Organization.findOne({ orgId: id }).lean()

test.before(async () => {
  providers = await fake.ensureFakeProviders(); db = await kit.connect(); jose = await import('jose')
  const jwk = await jose.exportJWK(oidc.publicKey); Object.assign(jwk, { kid: 'k1', alg: 'RS256', use: 'sig' })
  await fetch(`${fake.BASE}/__oidc`, { method: 'POST', body: JSON.stringify({ keys: [jwk] }) })
  await fetch(`${fake.BASE}/__play-sa`, { method: 'POST', body: JSON.stringify({ publicPem: sa.publicKey.export({ type: 'spki', format: 'pem' }) }) })
  route = kit.load('app/api/billing/play/rtdn/route.ts'); PLAY_CONFIG = kit.load('lib/billing/playConfig.ts').PLAY_CONFIG
  Subscription = kit.load('models/Subscription.ts').default; Organization = kit.load('models/Organization.ts').default
  A = await kit.createOrg({ plan: 'free', webEnabled: false })
  ORG = A.orgId
})
test.after(async () => { await db.collection('subscriptions').deleteMany({ orgId: ORG }); await kit.cleanupAll(db); await providers.stop(); await kit.disconnect() })
test.beforeEach(async () => { await fetch(`${fake.BASE}/__play`, { method: 'POST', body: JSON.stringify({ reset: true }) }) })

/* ═════════ authentication ═════════ */
test('R1. fail closed: with the audience or the push service account unconfigured EVERY request is refused (503), even a perfectly signed one', async () => {
  const h = await good(), saved = [PLAY_CONFIG.rtdnAudience, PLAY_CONFIG.rtdnPushServiceAccount]
  try {
    for (const [aud, acct] of [['', PUSH_SA], [AUD, ''], ['', '']]) {
      PLAY_CONFIG.rtdnAudience = aud; PLAY_CONFIG.rtdnPushServiceAccount = acct
      const r = await post({ testNotification: { version: '1.0' } }, h); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'rtdn_not_configured')
      assert.equal((await post({ testNotification: {} })).status, 503, 'no credentials either')
    }
  } finally { [PLAY_CONFIG.rtdnAudience, PLAY_CONFIG.rtdnPushServiceAccount] = saved }
})

test('R2. only a genuine Pub/Sub OIDC token is accepted: missing/garbage/wrong-key/wrong-audience/wrong-account/unverified-email/expired/wrong-issuer/alg=none/query-string secrets are all the same 401', async () => {
  const bodies = new Set()
  const cases = {
    none: {}, garbage: { authorization: 'Bearer not.a.jwt-but-long-enough-to-pass-shape' }, basic: { authorization: 'Basic abcdefghijklmnopqrstuvwxyz' },
    wrongKey: { authorization: `Bearer ${await oidcToken({ key: evil.privateKey })}` }, wrongAud: { authorization: `Bearer ${await oidcToken({ aud: 'https://other.example/x' })}` },
    wrongAccount: { authorization: `Bearer ${await oidcToken({ email: 'attacker@evil.iam.gserviceaccount.com' })}` }, unverified: { authorization: `Bearer ${await oidcToken({ verified: false })}` },
    expired: { authorization: `Bearer ${await oidcToken({ exp: Math.floor(Date.now() / 1000) - 600 })}` }, wrongIssuer: { authorization: `Bearer ${await oidcToken({ iss: 'https://evil.example' })}` },
    algNone: { authorization: `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: AUD, email: PUSH_SA, email_verified: true, exp: 9999999999 })).toString('base64url')}.` },
    legacySecretHeader: { 'x-rtdn-secret': 'anything' },
  }
  for (const [name, h] of Object.entries(cases)) { const r = await post({ testNotification: {} }, h); assert.equal(r.status, 401, name); bodies.add(await r.text()) }
  for (const qs of ['?token=anything', '?secret=x', '?authorization=Bearer%20x']) assert.equal((await post({ testNotification: {} }, {}, qs)).status, 401, qs)
  assert.equal(bodies.size, 1, 'one generic body for every failure')
  const ok = await post({ testNotification: { version: '1.0' } }, await good()); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { status: 'ok', type: 'testNotification' })
  // a genuine token does not rescue a request that also carries a bad query secret: query parameters are simply never consulted
  assert.equal((await post({ testNotification: {} }, await good(), '?token=wrong')).status, 200)
})

test('R3. authenticated but malformed deliveries are clean 4xx: not JSON, oversized, bad base64 payload, no token; foreign package / unknown token are acknowledged without effect', async () => {
  const h = await good()
  assert.equal((await post('{nope', h)).status, 400); assert.equal((await post('[]', h)).status, 400); assert.equal((await post(JSON.stringify({ pad: 'x'.repeat(70_000) }), h)).status, 413)
  assert.equal((await post({ message: { messageId: 'm1', data: '%%%not-base64-json%%%' } }, h)).status, 400)
  assert.equal((await post({ message: { messageId: 'm2', data: Buffer.from(JSON.stringify({ subscriptionNotification: { notificationType: 2 } })).toString('base64') } }, h)).status, 400)
  const other = await post(envelope('whatever-token', T.RENEWED, undefined, { packageName: 'com.evil.app' }), h); assert.equal((await other.json()).reason, 'other_package')
  const unknown = await post(envelope('token-not-in-our-database', T.RENEWED), h); assert.equal(unknown.status, 200); assert.equal((await unknown.json()).status, 'ignored')
  assert.equal((await playCalls()).length, 0, 'Google is never asked about tokens we do not know')
})

/* ═════════ reconciliation ═════════ */
test('S1. entitlements follow Google\'s AUTHORITATIVE state, never the notification type: a forged "renewed" cannot keep an expired plan, a forged "expired" cannot remove an active one', async () => {
  const h = await good(); const token = await mkSub(A, 'active')
  await Organization.updateOne({ orgId: ORG }, { $set: { plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 864e5) } })
  await play(token, { state: 'SUBSCRIPTION_STATE_EXPIRED', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(-1), autoRenewing: false })
  let r = await post(envelope(token, T.RENEWED), h); assert.equal(r.status, 200); let j = await r.json(); assert.equal(j.subscriptionStatus, 'expired'); assert.equal(j.plan, 'free')
  assert.equal((await orgDoc(ORG)).plan, 'free'); assert.equal((await Subscription.findOne({ purchaseToken: token })).status, 'expired')
  await play(token, { state: 'SUBSCRIPTION_STATE_ACTIVE', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(30) })
  r = await post(envelope(token, T.EXPIRED), h); j = await r.json(); assert.equal(j.subscriptionStatus, 'active'); assert.equal(j.plan, 'premium')
  const sub = await Subscription.findOne({ purchaseToken: token }).lean(); assert.ok(Math.abs(sub.currentPeriodEnd - new Date(days(30))) < 5000, 'period end comes from Google, not "now + 30 days"')
  await play(token, { state: 'SUBSCRIPTION_STATE_CANCELED', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(10), autoRenewing: false })
  j = await (await post(envelope(token, T.CANCELED), h)).json(); assert.equal(j.plan, 'premium', 'canceled with time left keeps access'); assert.equal((await orgDoc(ORG)).cancelAtPeriodEnd, true)
  await play(token, { state: 'SUBSCRIPTION_STATE_ON_HOLD', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(5), autoRenewing: true })
  j = await (await post(envelope(token, T.ON_HOLD), h)).json(); assert.equal(j.plan, 'free'); assert.equal(j.subscriptionStatus, 'on_hold')
  await play(token, { state: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(2) })
  j = await (await post(envelope(token, 6), h)).json(); assert.equal(j.plan, 'premium'); assert.equal(j.subscriptionStatus, 'grace_period')
  await play(token, { state: 'SUBSCRIPTION_STATE_EXPIRED', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(-1), autoRenewing: false })
  j = await (await post({ message: { messageId: 'v-' + token.slice(-6), data: Buffer.from(JSON.stringify({ packageName: PLAY_CONFIG.packageName, voidedPurchaseNotification: { purchaseToken: token, orderId: 'GPA.1', productType: 1 } })).toString('base64') } }, h)).json()
  assert.equal(j.plan, 'free', 'voided-purchase notifications reconcile too')
})

test('S2. duplicate deliveries are idempotent: sequential and 10-way concurrent copies of one message id cause exactly ONE Google lookup and one state change', async () => {
  const h = await good(); const token = await mkSub(A); await play(token, { state: 'SUBSCRIPTION_STATE_ACTIVE', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(30) })
  const env = envelope(token, T.RENEWED, 'dup-' + token.slice(-8)); const rs = await Promise.all(Array.from({ length: 10 }, () => post(env, h)))
  const bodies = await Promise.all(rs.map(r => r.json())); assert.ok(rs.every(r => r.status === 200)); assert.equal(bodies.filter(b => b.message === 'Event already processed').length, 9); assert.equal(bodies.filter(b => b.status === 'ok' && !b.message).length, 1)
  assert.equal((await playCalls()).length, 1); const again = await (await post(env, h)).json(); assert.equal(again.message, 'Event already processed'); assert.equal((await playCalls()).length, 1)
  assert.deepEqual((await Subscription.findOne({ purchaseToken: token }).lean()).processedEventIds, ['dup-' + token.slice(-8)])
  for (let i = 0; i < 30; i++) await post(envelope(token, T.RENEWED, `bulk-${i}-${token.slice(-6)}`), h)
  assert.ok((await Subscription.findOne({ purchaseToken: token }).lean()).processedEventIds.length <= 25, 'the dedupe list is bounded')
})

test('S3. out-of-order and replayed notifications converge on Google\'s current state whatever the arrival order', async () => {
  const h = await good(); const token = await mkSub(A)
  await play(token, { state: 'SUBSCRIPTION_STATE_EXPIRED', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(-2), autoRenewing: false })
  for (const type of [T.EXPIRED, T.RENEWED, T.CANCELED, T.RENEWED]) await post(envelope(token, type), h)    // a "renewed" arriving AFTER the expiry
  assert.equal((await Subscription.findOne({ purchaseToken: token }).lean()).status, 'expired'); assert.equal((await orgDoc(ORG)).plan, 'free')
  await play(token, { state: 'SUBSCRIPTION_STATE_ACTIVE', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(30) })
  await post(envelope(token, T.EXPIRED), h); assert.equal((await Subscription.findOne({ purchaseToken: token }).lean()).status, 'active'); assert.equal((await orgDoc(ORG)).plan, 'premium')
  const t0 = Date.now(); await post(envelope(token, T.RENEWED, 'x1', { eventTimeMillis: String(t0 + 5000) }), h); await post(envelope(token, T.RENEWED, 'x2', { eventTimeMillis: String(t0 - 5000) }), h)
  assert.equal((await Subscription.findOne({ purchaseToken: token }).lean()).lastEventTimeMillis, t0 + 5000, 'the newest event time is kept')
})

test('S4. Google unreachable / bad answer ⇒ 503 and NOTHING changes; the same message id succeeds on retry', async () => {
  const h = await good(); const token = await mkSub(A); await Organization.updateOne({ orgId: ORG }, { $set: { plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'active' } })
  const before = JSON.stringify({ s: await Subscription.findOne({ purchaseToken: token }).lean(), o: await orgDoc(ORG) })
  const env = envelope(token, T.REVOKED, 'retry-' + token.slice(-8))
  await fetch(`${fake.BASE}/__play`, { method: 'POST', body: JSON.stringify({ mode: 'error500' }) })
  let r = await post(env, h); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'play_verification_unavailable'); assert.equal(r.headers.get('retry-after'), '30')
  assert.equal(JSON.stringify({ s: await Subscription.findOne({ purchaseToken: token }).lean(), o: await orgDoc(ORG) }).replace(/"updatedAt":"[^"]+"/g, ''), before.replace(/"updatedAt":"[^"]+"/g, ''))
  await fetch(`${fake.BASE}/__play`, { method: 'POST', body: JSON.stringify({ mode: 'ok' }) }); await play(token, { state: 'SUBSCRIPTION_STATE_ACTIVE', productId: PLAY_CONFIG.premiumProductId, noExpiry: true })
  r = await post(env, h); assert.equal(r.status, 503, 'a response without an expiry is not authoritative'); await play(token, { state: 'SUBSCRIPTION_STATE_EXPIRED', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(-1), autoRenewing: false })
  r = await post(env, h); assert.equal(r.status, 200); assert.equal((await r.json()).plan, 'free', 'the retry of the SAME message id was not swallowed as a duplicate')
  await play(token, null); r = await post(envelope(token, T.RENEWED), h); assert.equal(r.status, 503, 'unknown to Google (404) is not silently treated as success')
})

test('S5. a persisted lifetime grant is never downgraded by a subscription event (plan, source and grant untouched)', async () => {
  const h = await good(); const L = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  try {
    const token = await mkSub(L); const before = await orgDoc(L.orgId)
    await play(token, { state: 'SUBSCRIPTION_STATE_EXPIRED', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(-1), autoRenewing: false })
    const j = await (await post(envelope(token, T.EXPIRED), h)).json(); assert.equal(j.plan, 'premium')
    const after = await orgDoc(L.orgId); for (const k of ['plan', 'entitlementSource', 'lifetimeGrant', 'webEnabled', 'androidEnabled']) assert.equal(after[k], before[k], k)
  } finally { await db.collection('subscriptions').deleteMany({ orgId: L.orgId }) }
})

test('S6. the Play service-account assertion is really signed and the access token is used; no credential or token ever appears in responses', async () => {
  const h = await good(); const token = await mkSub(A); await play(token, { state: 'SUBSCRIPTION_STATE_ACTIVE', productId: PLAY_CONFIG.premiumProductId, expiryTime: days(30) })
  const r = await post(envelope(token, T.RENEWED), h); const text = await r.text(); assert.equal(r.status, 200, text)
  assert.doesNotMatch(text, /fake-play-access-token|BEGIN|PRIVATE|example-project|purchaseToken|play_tok_/)
  const calls = (await (await fetch(`${fake.BASE}/__play-calls`)).json()).calls; assert.ok(calls.some(c => c.kind === 'token') && calls.some(c => c.kind === 'get'), 'token exchange (signature checked by the fake) then the API call')
})
