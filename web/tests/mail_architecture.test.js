/**
 * DoppelDash — Mail architecture suite (live dev server + throwaway DB).
 *
 * Two fake SMTP servers stand in for the two providers:
 *   :2525  the PLATFORM service  (server env SMTP_HOST/PORT)
 *   :2526  an ORGANISATION's own provider (saved through /api/org/mail-config)
 * so every test can prove WHICH provider actually carried a message.
 *
 * Covers: provider selection (unit + live), platform provider, org-provider
 * authorisation, Free cannot / Premium can configure, credentials never in
 * responses or at rest in plaintext, safe provider failure, and that CRM /
 * invitation / OTP / reset mail use the provider the backend selected.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, platform, orgSmtp
const ORG_SECRET = 'S3cret-App-Pa55word!'

test.before(async () => {
  db = await kit.connect()
  platform = await kit.startFakeSmtp(2525)
  orgSmtp = await kit.startFakeSmtp(2526)
})
test.after(async () => {
  await kit.cleanupAll(db)
  await platform.stop()
  await orgSmtp.stop()
  await kit.disconnect()
})

const cfgBody = (over = {}) => ({
  host: '127.0.0.1', port: 2526, secure: false, username: 'mailer@customer.test',
  password: ORG_SECRET, fromEmail: 'hr@customer.test', fromName: 'Customer HR', ...over,
})
async function adminSession(org) { return kit.login(org.admin.email) }
async function configure(session, over) {
  return kit.api('/api/org/mail-config', { method: 'PUT', token: session.accessToken, body: cfgBody(over) })
}

/* ───────────── provider selection (pure resolver, injected deps) ───────────── */
test('M1. resolver: security mail is platform-only; custom providers need entitlement + verification', async () => {
  const { resolveMailRoute } = kit.load('lib/mail/resolver.ts')
  const mk = id => ({ id, isConfigured: () => true, deliver: async () => {} })
  const deps = ({ entitled, org = mk('org'), mailbox = mk('mbx') } = {}) => ({
    platform: () => mk('platform'),
    org: async () => org,
    userMailbox: async () => mailbox,
    canUseCustomMail: async () => entitled,
  })
  const route = async (purpose, d) => (await resolveMailRoute({ purpose, orgId: 'o1', userId: 'u1' }, d)).route

  for (const p of ['otp', 'verification', 'password_reset', 'security_notification', 'account_notification']) {
    assert.equal((await route(p, deps({ entitled: true }))).channel, 'platform', `${p} must ignore org providers`)
  }
  assert.equal((await route('invitation', deps({ entitled: false }))).channel, 'platform', 'Free org → platform')
  const inv = await route('invitation', deps({ entitled: true }))
  assert.equal(inv.channel, 'organization')
  assert.equal(inv.fallback.channel, 'platform', 'invitations may fall back to platform')
  const crm = await route('crm_email', deps({ entitled: true }))
  assert.equal(crm.channel, 'organization')
  assert.equal(crm.fallback, undefined, 'CRM mail must not silently switch sender identity')
  assert.equal((await route('crm_email', deps({ entitled: true, org: null }))).channel, 'user_mailbox')
  assert.equal((await route('crm_email', deps({ entitled: false }))).channel, 'platform', 'Free org never reaches a user mailbox')
  assert.equal((await resolveMailRoute({ purpose: 'invitation' }, deps({ entitled: true }))).route.channel, 'platform', 'no org context → platform')
})

/* ───────────── authorisation of the config API ───────────── */
test('M2. mail-config: unauthenticated 401, non-admin 403, Free org cannot configure (403, nothing stored)', async () => {
  const free = await kit.createOrg({ plan: 'free' })
  assert.equal((await kit.api('/api/org/mail-config')).status, 401)

  const mgr = await kit.login(free.manager.email)
  assert.equal((await kit.api('/api/org/mail-config', { token: mgr.accessToken })).status, 403)
  assert.equal((await configure(mgr)).status, 403)

  const admin = await adminSession(free)
  const res = await configure(admin)
  assert.equal(res.status, 403)
  assert.equal(res.json.code, 'feature_unavailable')
  assert.equal(await db.collection('orgmailconfigs').countDocuments({ orgId: free.orgId }), 0, 'nothing may be stored for a Free org')
  const get = await kit.api('/api/org/mail-config', { token: admin.accessToken })
  assert.equal(get.json.entitled, false)
})

test('M3. Premium admin can configure: verified by a real test message, password never returned or stored in plaintext', async () => {
  const org = await kit.createOrg({ plan: 'premium' })
  const admin = await adminSession(org)
  orgSmtp.clear()
  const res = await configure(admin)
  assert.equal(res.status, 200, res.text)
  assert.equal(res.json.provider.verified, true)
  assert.equal(res.json.provider.hasPassword, true)
  assert.ok(!res.text.includes(ORG_SECRET), 'PUT response must not echo the password')

  const probe = await orgSmtp.waitFor(m => m.to.includes(org.admin.email))
  assert.ok(probe, 'test message goes through the org provider')
  assert.ok(orgSmtp.authAttempts.some(a => a.pass === ORG_SECRET), 'provider received the real credentials')

  const get = await kit.api('/api/org/mail-config', { token: admin.accessToken })
  assert.equal(get.json.entitled, true)
  assert.ok(!get.text.includes(ORG_SECRET) && !/passwordEnc/i.test(get.text), 'GET must never expose the password or its ciphertext')

  const stored = await db.collection('orgmailconfigs').findOne({ orgId: org.orgId })
  assert.ok(stored.passwordEnc && stored.passwordEnc !== ORG_SECRET && !stored.passwordEnc.includes(ORG_SECRET), 'stored encrypted')

  // Updating without a password keeps the stored one (clients never need to re-send it).
  const upd = await configure(admin, { password: undefined, fromName: 'Renamed' })
  assert.equal(upd.status, 200, upd.text)
})

/* ───────────── provider carries the right mail ───────────── */
test('M4. invitations use the org provider for Premium, the platform for Free; OTP + reset always use the platform', async () => {
  const prem = await kit.createOrg({ plan: 'premium' })
  const pAdmin = await adminSession(prem)
  assert.equal((await configure(pAdmin)).status, 200)

  const to1 = `authf_inv_p_${kit.rand()}@test.dd`
  platform.clear(); orgSmtp.clear()
  const r1 = await kit.api('/api/admin/invitations', { method: 'POST', token: pAdmin.accessToken, body: { email: to1, role: 'employee' } })
  assert.equal(r1.status, 201, r1.text)
  await orgSmtp.waitFor(m => m.to.includes(to1))
  assert.ok(!platform.messages.some(m => m.to.includes(to1)), 'Premium invitation must not touch the platform provider')

  const free = await kit.createOrg({ plan: 'free' })
  const fAdmin = await adminSession(free)
  const to2 = `authf_inv_f_${kit.rand()}@test.dd`
  const r2 = await kit.api('/api/admin/invitations', { method: 'POST', token: fAdmin.accessToken, body: { email: to2, role: 'employee' } })
  assert.equal(r2.status, 201, r2.text)
  await platform.waitFor(m => m.to.includes(to2))
  assert.ok(!orgSmtp.messages.some(m => m.to.includes(to2)))

  // Security mail for the Premium org's own user is platform-only.
  platform.clear(); orgSmtp.clear()
  await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: prem.employee.email } })
  await platform.waitFor(m => m.to.includes(prem.employee.email))
  const login = await kit.api('/api/auth/login', { method: 'POST', body: { email: prem.employee.email, password: prem.employee.password } })
  assert.equal(login.status, 200)
  await platform.waitFor(m => m.to.includes(prem.employee.email) && /code|verification|sign/i.test(m.subject + m.text))
  assert.equal(orgSmtp.messages.length, 0, 'OTP / reset mail must never use an organisation provider')
})

test('M5. CRM email uses the selected provider (org for Premium+configured, platform for Premium without one)', async () => {
  const org = await kit.createOrg({ plan: 'premium' })
  const admin = await adminSession(org)
  const target = `authf_crm_${kit.rand()}@test.dd`
  const send = () => kit.api('/api/crm/campaign', { method: 'POST', token: admin.accessToken, body: { subject: 'Hello', bodyTemplate: 'Hi {{name}}', testEmail: target } })

  platform.clear(); orgSmtp.clear()
  let res = await send()
  assert.equal(res.status, 200, res.text)
  await platform.waitFor(m => m.to.includes(target))
  assert.equal(orgSmtp.messages.length, 0)

  assert.equal((await configure(admin)).status, 200)
  platform.clear(); orgSmtp.clear()
  orgSmtp.messages.length = 0
  res = await send()
  assert.equal(res.status, 200, res.text)
  await orgSmtp.waitFor(m => m.to.includes(target))
  assert.ok(!platform.messages.some(m => m.to.includes(target)), 'CRM mail must come from the org provider only')
})

/* ───────────── failure safety ───────────── */
test('M6. a failing org provider returns a safe error (no password or SMTP server text) and is never trusted until verified', async () => {
  const org = await kit.createOrg({ plan: 'premium' })
  const admin = await adminSession(org)
  orgSmtp.state.rejectAuth = true
  try {
    const res = await configure(admin, { password: 'wrong-Pass-123' })
    assert.equal(res.status, 422)
    assert.ok(!res.text.includes('wrong-Pass-123') && !/535|not accepted|Username and Password/i.test(res.text), `error leaked detail: ${res.text}`)
    const stored = await db.collection('orgmailconfigs').findOne({ orgId: org.orgId })
    assert.ok(!stored.verifiedAt, 'unverified config must not be marked verified')

    // Unverified → invitations fall back to the platform and still succeed.
    const to = `authf_fb_${kit.rand()}@test.dd`
    platform.clear()
    const inv = await kit.api('/api/admin/invitations', { method: 'POST', token: admin.accessToken, body: { email: to, role: 'employee' } })
    assert.equal(inv.status, 201, inv.text)
    await platform.waitFor(m => m.to.includes(to))
  } finally {
    orgSmtp.state.rejectAuth = false
  }
})

test('M7. removing the config returns the org to the platform provider', async () => {
  const org = await kit.createOrg({ plan: 'premium' })
  const admin = await adminSession(org)
  assert.equal((await configure(admin)).status, 200)
  const del = await kit.api('/api/org/mail-config', { method: 'DELETE', token: admin.accessToken })
  assert.equal(del.status, 200)
  assert.equal(await db.collection('orgmailconfigs').countDocuments({ orgId: org.orgId }), 0)
  const to = `authf_rm_${kit.rand()}@test.dd`
  platform.clear(); orgSmtp.clear()
  await kit.api('/api/admin/invitations', { method: 'POST', token: admin.accessToken, body: { email: to, role: 'employee' } })
  await platform.waitFor(m => m.to.includes(to))
  assert.equal(orgSmtp.messages.length, 0)
})

test('M8. entitlement downgrade stops custom-provider use', async () => {
  const org = await kit.createOrg({ plan: 'premium' })
  const admin = await adminSession(org)
  assert.equal((await configure(admin)).status, 200)
  // Downgrade the org server-side (as a lapsed subscription would).
  await db.collection('organizations').updateOne({ orgId: org.orgId }, { $set: { plan: 'free', entitlementSource: 'none', subscriptionStatus: 'none' } })
  const to = `authf_dg_${kit.rand()}@test.dd`
  platform.clear(); orgSmtp.clear()
  const inv = await kit.api('/api/admin/invitations', { method: 'POST', token: admin.accessToken, body: { email: to, role: 'employee' } })
  assert.equal(inv.status, 201, inv.text)
  await platform.waitFor(m => m.to.includes(to))
  assert.equal(orgSmtp.messages.length, 0, 'a downgraded org must fall back to the platform provider')
})
