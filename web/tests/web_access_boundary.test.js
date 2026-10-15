/**
 * DoppelDash — WEB client access boundary + organisation-aware mail branding.
 *
 * Product split (locked): WEB = Doppelmayr India internal client, ANDROID = public SaaS client,
 * ONE backend and ONE database. Whether an organisation may use the web client is decided only
 * by its persisted entitlement (`webEnabled`) and enforced SERVER-SIDE on every web session —
 * never by hiding routes, and never by an organisation id / slug special case.
 *
 * Requires: dev server on TEST_URL using the same throwaway DB (MONGODB_URI), with
 * SMTP_HOST/SMTP_PORT pointing at the fake SMTP the kit starts (127.0.0.1:2525).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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

const WEB_STATUS_DENIED = 401

/** A web session token exactly as a login would mint it (what the dd_session cookie carries). */
async function webSessionCookieFor(userId) {
  const User = kit.load('models/User.ts').default
  const { signToken } = kit.load('lib/auth/jwt.ts')
  const user = await User.findById(userId)
  return `dd_session=${await signToken(user.toPublic())}`
}
const setEntitlement = (orgId, fields) => db.collection('organizations').updateOne({ orgId }, { $set: fields })

/* ───────────────────────── 1. web denied / allowed by persisted entitlement ───────────────────────── */

test('W1. webEnabled=false: login mints NO web cookie, tells the client, and mobile still works', async () => {
  const org = await kit.createOrg({ plan: 'free', webEnabled: false })
  const s1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  const s2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: s1.json.preAuthToken, otp: '112022' } })
  assert.equal(s2.status, 200)
  assert.equal(s2.json.webAccess, false)
  assert.doesNotMatch(s2.headers.get('set-cookie') || '', /dd_session=[^;]/, 'no web session cookie for a non-web organisation')
  assert.ok(s2.json.accessToken && s2.json.refreshToken, 'Android tokens are still issued')

  const me = await kit.api('/api/auth/me', { token: s2.json.accessToken })
  assert.equal(me.status, 200, 'mobile access token works')
  assert.equal(me.json.entitlements.webEnabled, false)
})

test('W2. webEnabled=false: a web session token is rejected by the API on every carrier', async () => {
  const org = await kit.createOrg({ plan: 'free', webEnabled: false })
  const cookie = await webSessionCookieFor(org.admin.id)
  const bearerWeb = (await cookie.split('=')[1])

  for (const p of ['/api/auth/me', '/api/crm', '/api/lms', '/api/rms', '/api/admin/users', '/api/billing/entitlements']) {
    const viaCookie = await kit.api(p, { cookie })
    assert.equal(viaCookie.status, WEB_STATUS_DENIED, `cookie session must be refused on ${p} (got ${viaCookie.status})`)
    const viaBearer = await kit.api(p, { token: bearerWeb })
    assert.equal(viaBearer.status, WEB_STATUS_DENIED, `web-class token as Bearer must be refused on ${p} (got ${viaBearer.status})`)
  }
})

test('W3. webEnabled=false: the app shell does not render — it explains instead of leaking pages', async () => {
  const org = await kit.createOrg({ plan: 'premium', webEnabled: false })
  const cookie = await webSessionCookieFor(org.admin.id)
  const page = await kit.api('/dashboard', { cookie })
  assert.ok([301, 302, 303, 307, 308].includes(page.status), `expected a redirect, got ${page.status}`)
  assert.match(page.headers.get('location') || '', /web-access-restricted/, 'redirected to the explanation page, not the dashboard')
})

test('W4. webEnabled=true: login mints the cookie and the web session works', async () => {
  const org = await kit.createOrg({ plan: 'free', webEnabled: true })
  const s1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  const s2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: s1.json.preAuthToken, otp: '112022' } })
  assert.equal(s2.json.webAccess, true)
  const cookie = (s2.headers.get('set-cookie') || '').split(';')[0]
  assert.match(cookie, /^dd_session=./)
  const me = await kit.api('/api/auth/me', { cookie })
  assert.equal(me.status, 200)
  assert.equal(me.json.entitlements.webEnabled, true)
})

test('W5. public Free and public Premium (subscription) organisations are denied; plan alone never grants web', async () => {
  for (const plan of ['free', 'premium']) {
    const org = await kit.createOrg({ plan, webEnabled: false })
    const me = await kit.api('/api/auth/me', { cookie: await webSessionCookieFor(org.admin.id) })
    assert.equal(me.status, WEB_STATUS_DENIED, `${plan} organisation must be denied on web`)
    const mobile = await kit.api('/api/auth/me', { token: (await kit.login(org.admin.email)).accessToken })
    assert.equal(mobile.status, 200, `${plan} organisation keeps full mobile access`)
    assert.equal(mobile.json.entitlements.plan, plan)
  }
})

test('W6. access follows the persisted field live: removing it revokes existing web sessions, restoring it re-grants', async () => {
  const org = await kit.createOrg({ plan: 'premium', lifetimeGrant: true, webEnabled: true })
  const cookie = await webSessionCookieFor(org.manager.id)
  assert.equal((await kit.api('/api/auth/me', { cookie })).status, 200)

  await setEntitlement(org.orgId, { webEnabled: false })
  assert.equal((await kit.api('/api/auth/me', { cookie })).status, WEB_STATUS_DENIED, 'flag removed → existing session refused')
  await db.collection('organizations').updateOne({ orgId: org.orgId }, { $unset: { webEnabled: '' } })
  assert.equal((await kit.api('/api/auth/me', { cookie })).status, WEB_STATUS_DENIED, 'field absent → denied (fail closed)')

  await setEntitlement(org.orgId, { webEnabled: true })
  assert.equal((await kit.api('/api/auth/me', { cookie })).status, 200, 'flag restored → access restored')
})

test('W7. tenant is not a shortcut: an org NAMED/slugged "Doppelmayr" without webEnabled is denied', async () => {
  const org = await kit.createOrg({ name: 'Doppelmayr India', plan: 'premium', lifetimeGrant: true, webEnabled: false })
  await setEntitlement(org.orgId, { slug: 'doppelmayr-' + org.orgId.slice(-6) })
  const me = await kit.api('/api/auth/me', { cookie: await webSessionCookieFor(org.admin.id) })
  assert.equal(me.status, WEB_STATUS_DENIED)
})

test('W8. passkey and invitation login paths obey the same boundary (no cookie for non-web orgs)', async () => {
  const jwt = kit.load('lib/auth/webAccess.ts')
  const free = await kit.createOrg({ webEnabled: false })
  const web = await kit.createOrg({ webEnabled: true })
  assert.equal(await jwt.isWebAccessAllowed(free.orgId), false)
  assert.equal(await jwt.isWebAccessAllowed(web.orgId), true)
  assert.equal(await jwt.isWebAccessAllowed('org_does_not_exist'), false, 'unknown organisation fails closed')
  assert.equal(await jwt.isWebAccessAllowed(''), false)
  // route sources must route cookie issuance through the guard — a bare cookies.set would bypass it
  for (const f of ['verify-otp', 'passkey/login', 'register', 'invitations/accept']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../app/api/auth', f, 'route.ts'), 'utf8')
    assert.match(src, /isWebAccessAllowed/, `${f} must check web access before minting a web session`)
    assert.doesNotMatch(src, /cookies\.set\(COOKIE_NAME/, `${f} must not set the session cookie directly`)
  }
})

/* ───────────────────────── 2. Doppelmayr = ordinary organisation, no special case ───────────────────────── */

test('D1. Doppelmayr resolves from persisted fields; a generic org with the same fields gets the identical result', async () => {
  const Organization = kit.load('models/Organization.ts').default
  const { getOrganizationEntitlements } = kit.load('lib/entitlements/entitlementService.ts')
  const doppel = await Organization.ensureDoppelmayr() // the provisioning path that persists Doppelmayr's entitlement (throwaway DB only)
  const persisted = {
    plan: doppel.plan, entitlementSource: doppel.entitlementSource, lifetimeGrant: doppel.lifetimeGrant,
    webEnabled: doppel.webEnabled, androidEnabled: doppel.androidEnabled,
  }
  assert.deepEqual(persisted, { plan: 'premium', entitlementSource: 'lifetime_grant', lifetimeGrant: true, webEnabled: true, androidEnabled: true })

  const generic = await kit.createOrg({ plan: 'premium', lifetimeGrant: true, webEnabled: true })
  const a = await getOrganizationEntitlements(doppel.orgId)
  const b = await getOrganizationEntitlements(generic.orgId)
  for (const k of ['plan', 'source', 'lifetime', 'lifetimeGrant', 'webEnabled', 'androidEnabled', 'features', 'limits']) {
    assert.deepEqual(b[k], a[k], `entitlement field "${k}" must match for identical persisted fields`)
  }
  assert.equal(b.webEnabled, true)
  assert.equal((await kit.api('/api/auth/me', { cookie: await webSessionCookieFor(generic.admin.id) })).status, 200, 'generic equivalent org is allowed on web')

  // altering the persisted fields changes the outcome — on the generic org (Doppelmayr's record is never mutated)
  await setEntitlement(generic.orgId, { lifetimeGrant: false, entitlementSource: 'none', plan: 'free' })
  const c = await getOrganizationEntitlements(generic.orgId)
  assert.equal(c.plan, 'free')
  assert.equal(c.lifetimeGrant, false)
  assert.equal(c.webEnabled, true, 'plan and web access are independent persisted fields')
  await setEntitlement(generic.orgId, { webEnabled: false })
  assert.equal((await kit.api('/api/auth/me', { cookie: await webSessionCookieFor(generic.admin.id) })).status, WEB_STATUS_DENIED)
})

test('D2. no organisation-id / slug special case exists in runtime code', () => {
  const root = path.resolve(__dirname, '..')
  // Data provisioning only (never imported by request-time code — asserted below).
  const allowed = new Set(['models/Organization.ts', 'lib/provisioning/doppelmayrBrand.ts', 'lib/provisioning/doppelmayrEntitlement.ts', 'app/api/dev/seed/route.ts', 'app/api/dev/migrate/route.ts'])
  const importers = []
  const entitlementImporters = []
  const offenders = []
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', 'tests', 'scripts', 'docs'].includes(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const rel = path.relative(root, full)
        const src = fs.readFileSync(full, 'utf8')
        if (/lib\/provisioning\/doppelmayrBrand/.test(src)) importers.push(rel)
        if (/lib\/provisioning\/doppelmayrEntitlement/.test(src)) entitlementImporters.push(rel)
        if (allowed.has(rel)) continue
        if (/org_doppelmayr/.test(src) || /slug\s*[!=]==?\s*['"]doppelmayr/.test(src) || /orgId\s*[!=]==?\s*['"]org_/.test(src)) offenders.push(rel)
      }
    }
  }
  for (const d of ['app', 'lib', 'components', 'models']) walk(path.join(root, d))
  walk // eslint no-unused guard
  assert.deepEqual(offenders, [], `runtime code must not special-case an organisation: ${offenders.join(', ')}`)
  assert.deepEqual(importers.sort(), ['app/api/dev/migrate/route.ts'], 'only the secret-gated migrate step may import the Doppelmayr provisioning')
  assert.deepEqual(entitlementImporters, [], 'the entitlement provisioning module is operator-script only: no request-time code may import it')
  assert.equal(fs.existsSync(path.join(root, 'middleware.ts')) && /org_doppelmayr/.test(fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8')), false)
})

/* ───────────────────────── 3. organisation-aware mail branding / provider selection ───────────────────────── */

function fakeTransport(id, configured = true) {
  const sent = []
  return { id, sent, isConfigured: () => configured, async deliver(e) { sent.push(e) } }
}
function serviceWith({ platform, org, entitled }) {
  const { MailService } = kit.load('lib/mail/mailService.ts')
  const { makeBrand } = kit.load('lib/mail/brand.ts')
  const brands = {
    org_dm: makeBrand({ name: 'Doppelmayr India Pvt Ltd', color: '#0057A8' }),
    org_acme: makeBrand({ name: 'Acme Corp', color: '#7a1fa2' }),
  }
  const deps = {
    platform: () => platform,
    org: async () => org ?? null,
    userMailbox: async () => null,
    canUseCustomMail: async orgId => (entitled ? entitled.has(orgId) : false),
  }
  const { PLATFORM_BRAND } = kit.load('lib/mail/brand.ts')
  return new MailService(deps, async orgId => brands[orgId] ?? PLATFORM_BRAND)
}

test('M1. security mail (OTP, reset) is org-BRANDED but always travels over the PLATFORM provider', async () => {
  const platform = fakeTransport('platform'); const org = fakeTransport('org')
  const svc = serviceWith({ platform, org, entitled: new Set(['org_dm', 'org_acme']) }) // both entitled to custom mail

  await svc.sendOtp({ to: 'a@dm.test', code: '123456', orgId: 'org_dm' })
  await svc.sendPasswordReset({ to: 'a@dm.test', resetUrl: 'https://x.test/reset?t=1', orgId: 'org_dm' })
  assert.equal(org.sent.length, 0, 'security mail must never use the organisation provider')
  assert.equal(platform.sent.length, 2)
  for (const e of platform.sent) {
    assert.match(e.subject, /Doppelmayr India Pvt Ltd/)
    assert.doesNotMatch(e.subject + e.html + (e.text || ''), /DoppelDash/, 'no DoppelDash branding in Doppelmayr mail')
    assert.match(e.html, /#0057A8/i)
    assert.equal(e.fromName, 'Doppelmayr India Pvt Ltd')
  }
})

test('M2. a different organisation gets ITS brand — same code path as Doppelmayr', async () => {
  const platform = fakeTransport('platform')
  const svc = serviceWith({ platform, entitled: new Set() })
  await svc.sendOtp({ to: 'u@acme.test', code: '654321', orgId: 'org_acme' })
  const [e] = platform.sent
  assert.match(e.subject, /Acme Corp/)
  assert.match(e.html, /#7a1fa2/i)
  assert.doesNotMatch(e.html, /Doppelmayr/)
})

test('M3. no organisation config (or no org at all) falls back to the neutral platform brand', async () => {
  const platform = fakeTransport('platform')
  const svc = serviceWith({ platform, entitled: new Set() })
  await svc.sendOtp({ to: 'u@x.test', code: '111111', orgId: 'org_unconfigured' })
  await svc.sendOtp({ to: 'u@x.test', code: '222222' })
  for (const e of platform.sent) {
    assert.match(e.subject, /DoppelDash/)
    assert.equal(e.fromName, undefined, 'platform brand keeps the transport default sender name')
  }
})

test('M4. business mail (invitation, notification) uses the org provider when entitled; Free orgs use the platform', async () => {
  const platform = fakeTransport('platform'); const org = fakeTransport('org')
  const svc = serviceWith({ platform, org, entitled: new Set(['org_dm']) })

  await svc.sendInvitation({ to: 'n@dm.test', orgId: 'org_dm', organizationName: 'Doppelmayr India Pvt Ltd', role: 'employee', inviterName: 'Admin', inviteUrl: 'https://x.test/invite?token=t' })
  await svc.sendNotification({ to: 'n@dm.test', orgId: 'org_dm', subject: 'Leave approved', html: '<p>ok</p>' })
  assert.equal(org.sent.length, 2, 'Premium + configured organisation provider carries invitations and notifications')
  assert.match(org.sent[0].subject, /Doppelmayr India Pvt Ltd/)
  assert.doesNotMatch(org.sent[0].html, /DoppelDash/)

  platform.sent.length = 0; org.sent.length = 0
  await svc.sendInvitation({ to: 'n@acme.test', orgId: 'org_acme', organizationName: 'Acme Corp', role: 'employee', inviterName: 'Ann', inviteUrl: 'https://x.test/invite?token=t' })
  assert.equal(org.sent.length, 0, 'a non-entitled organisation can never reach a custom provider')
  assert.equal(platform.sent.length, 1)
  assert.match(platform.sent[0].html, /Acme Corp/)
})

test('M5. brand input is sanitised: bad colour → platform colour, markup stripped, empty name → platform', () => {
  const { makeBrand, PLATFORM_BRAND } = kit.load('lib/mail/brand.ts')
  assert.equal(makeBrand({ name: 'Zed', color: 'red; background:url(x)' }).color, PLATFORM_BRAND.color)
  assert.equal(makeBrand({ name: 'Zed', color: '#12ab34' }).color, '#12ab34')
  assert.doesNotMatch(makeBrand({ name: 'Zed<script>alert(1)</script>' }).name, /[<>]/)
  assert.equal(makeBrand({ name: '   ' }), PLATFORM_BRAND)
  assert.equal(makeBrand(null), PLATFORM_BRAND)
})

test('M6. brand resolves from PERSISTED org configuration (settings → organization name → platform)', async () => {
  const { resolveMailBrand, PLATFORM_BRAND } = kit.load('lib/mail/brand.ts')
  const configured = await kit.createOrg({ name: 'Registered Name Ltd' })
  await db.collection('orgsettings').insertOne({ orgId: configured.orgId, name: 'Display Co', companyName: 'Display Co', brandColor: '#0057A8' })
  const b1 = await resolveMailBrand(configured.orgId)
  assert.equal(b1.name, 'Display Co'); assert.equal(b1.color, '#0057A8'); assert.equal(b1.isPlatform, false)

  const nameOnly = await kit.createOrg({ name: 'Only Org Name' })
  const b2 = await resolveMailBrand(nameOnly.orgId)
  assert.equal(b2.name, 'Only Org Name'); assert.equal(b2.color, PLATFORM_BRAND.color)

  const placeholder = await kit.createOrg({ name: 'Real Org' })
  await db.collection('orgsettings').insertOne({ orgId: placeholder.orgId, name: 'My Organization', companyName: 'My Organization' })
  assert.equal((await resolveMailBrand(placeholder.orgId)).name, 'Real Org', 'schema placeholder is not a brand')

  const branded = await kit.createOrg({ name: 'Legal Name Pvt Ltd' })
  await db.collection('orgsettings').insertOne({ orgId: branded.orgId, name: 'Legal Name Pvt Ltd', companyName: 'Legal Name Pvt Ltd', brandName: 'Short Brand', brandColor: '#0057A8' })
  assert.equal((await resolveMailBrand(branded.orgId)).name, 'Short Brand', 'brandName wins over the legal company name')

  assert.equal(await resolveMailBrand('org_nope'), PLATFORM_BRAND)
  assert.equal(await resolveMailBrand(undefined), PLATFORM_BRAND)
})

test('M7. end-to-end: the OTP e-mail that actually leaves the app carries the organisation brand', async () => {
  const org = await kit.createOrg({ name: 'Brandy Industries', webEnabled: true })
  await db.collection('orgsettings').insertOne({ orgId: org.orgId, name: 'Brandy Industries', companyName: 'Brandy Industries', brandColor: '#0057A8' })
  smtp.clear()
  const r = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  assert.equal(r.status, 200)
  const mail = await smtp.waitFor(m => m.to.includes(org.admin.email))
  assert.match(mail.subject, /Brandy Industries/)
  assert.match(String(mail.html), /#0057A8/i)
  assert.doesNotMatch(String(mail.html), /DoppelDash/)
  assert.match(String(mail.from), /Brandy Industries/)
})
