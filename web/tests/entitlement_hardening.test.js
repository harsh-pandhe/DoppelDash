/**
 * Entitlement hardening (V1 sprint): registration cannot elevate, a stored `plan: premium` alone is never an entitlement, and the
 * privileged Doppelmayr organisation is created only by the audited provisioning paths. Real routes, throwaway DB, no providers.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const kit = require('./helpers/authTestKit')

let db
test.before(async () => { db = await kit.connect() })
test.after(async () => {
  for (const o of await db.collection('organizations').find({ name: /^Hardening /i }).toArray()) kit.trackOrg(o.orgId)
  await kit.cleanupAll(db); await kit.disconnect()
})
const me = async org => {
  const s1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.employee.email, password: kit.PASSWORD } })
  const s2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: s1.json.preAuthToken, method: 'email', otp: '112022' } })
  return (await kit.api('/api/auth/me', { token: s2.json.accessToken })).json.entitlements
}

test('H1. public registration ignores client-supplied plan / webEnabled / androidEnabled / lifetimeGrant / entitlementSource / role / orgId', async () => {
  const email = `hardening_${kit.rand()}@test.dd`
  const r = await kit.api('/api/auth/register', { method: 'POST', body: {
    organizationName: 'Hardening Inc ' + kit.rand(), email, password: 'Str0ng!Passw0rd#1', firstName: 'Hana',
    plan: 'premium', webEnabled: true, androidEnabled: false, lifetimeGrant: true, entitlementSource: 'lifetime_grant', subscriptionStatus: 'active',
    role: 'employee', orgId: 'org_doppelmayr', organizationId: 'org_doppelmayr', slug: 'doppelmayr',
  } })
  assert.equal(r.status, 201, r.text)
  const user = await db.collection('users').findOne({ email })
  assert.notEqual(user.orgId, 'org_doppelmayr'); assert.equal(user.role, 'admin')
  const org = await db.collection('organizations').findOne({ orgId: user.orgId }); kit.trackOrg(org.orgId)
  assert.deepEqual(
    { plan: org.plan, source: org.entitlementSource, lifetimeGrant: org.lifetimeGrant, webEnabled: org.webEnabled, androidEnabled: org.androidEnabled, sub: org.subscriptionStatus },
    { plan: 'free', source: 'none', lifetimeGrant: false, webEnabled: false, androidEnabled: true, sub: 'none' })
  assert.notEqual(org.slug, 'doppelmayr')
  assert.doesNotMatch(r.headers.get('set-cookie') || '', /dd_session=[^;]/, 'no browser session for a public workspace')
  assert.equal(r.json.user?.orgId ?? user.orgId, user.orgId)
})

const ORG_ENT = [
  // [persisted fields, expected resolved plan, label]
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'none' }, 'free', 'stored premium, no verified subscription'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'on_hold' }, 'free', 'on hold'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'pending' }, 'free', 'pending'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'past_due' }, 'free', 'past due'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'expired' }, 'free', 'expired'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'revoked' }, 'free', 'revoked'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() - 864e5) }, 'free', 'active but period over'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'canceled', currentPeriodEnd: new Date(Date.now() - 864e5) }, 'free', 'canceled and period over'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'grace_period', currentPeriodEnd: new Date(Date.now() - 864e5) }, 'free', 'grace period but period over'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 864e5) }, 'premium', 'active within period'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'canceled', currentPeriodEnd: new Date(Date.now() + 864e5) }, 'premium', 'canceled but paid period remains'],
  [{ plan: 'premium', entitlementSource: 'subscription', subscriptionStatus: 'grace_period', currentPeriodEnd: new Date(Date.now() + 864e5) }, 'premium', 'payment grace period'],
]
for (const [fields, expected, label] of ORG_ENT) {
  test(`H2. resolved plan is ${expected} for: ${label}; Premium never turns the browser on`, async () => {
    const org = await kit.createOrg({ plan: 'free', webEnabled: false })
    await db.collection('organizations').updateOne({ orgId: org.orgId }, { $set: fields })
    const e = await me(org)
    assert.equal(e.plan, expected); assert.equal(e.webEnabled, false)
    // every member of the organisation sees the same organisation entitlement
    const mgr = await kit.login(org.manager.email)
    const em = (await kit.api('/api/auth/me', { token: mgr.accessToken })).json.entitlements
    assert.equal(em.plan, expected)
  })
}

test('H3. a lifetime grant is premium regardless of subscription state (a lapsed subscription cannot remove it)', async () => {
  const org = await kit.createOrg({ plan: 'premium', lifetimeGrant: true, webEnabled: true })
  await db.collection('organizations').updateOne({ orgId: org.orgId }, { $set: { subscriptionStatus: 'expired', currentPeriodEnd: new Date(Date.now() - 864e5) } })
  const e = await me(org)
  assert.equal(e.plan, 'premium'); assert.equal(e.source, 'lifetime_grant'); assert.equal(e.lifetimeGrant, true); assert.equal(e.webEnabled, true)
})

test('H4. ensureDoppelmayr is only reachable from audited paths: nothing under app/ (outside the production-gated dev routes), lib/ or middleware calls it', () => {
  const root = path.resolve(__dirname, '..'); const hits = []
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', 'tests'].includes(f.name)) continue
    const p = path.join(d, f.name)
    if (f.isDirectory()) walk(p); else if (/\.(ts|tsx|js|mjs)$/.test(f.name) && /ensureDoppelmayr\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p).replace(/\\/g, '/'))
  } }
  for (const d of ['app', 'lib', 'components', 'scripts']) walk(path.join(root, d))
  for (const f of fs.readdirSync(root).filter(f => /\.(ts|js|mjs)$/.test(f))) if (/ensureDoppelmayr\b/.test(fs.readFileSync(path.join(root, f), 'utf8'))) hits.push(f)
  const allowed = new Set(['models/Organization.ts', 'app/api/dev/seed/route.ts'])
  const unexpected = [...new Set(hits)].filter(h => !allowed.has(h) && !h.startsWith('node_modules'))
  assert.deepEqual(unexpected.filter(h => !h.startsWith('.next')), [], 'unexpected callers: ' + unexpected.join(', '))
  const seed = fs.readFileSync(path.join(root, 'app/api/dev/seed/route.ts'), 'utf8')
  assert.match(seed, /NODE_ENV === 'production' && process\.env\.ALLOW_DEV_SEED !== 'true'/, 'the seed route is refused in production unless explicitly opted in')
})
