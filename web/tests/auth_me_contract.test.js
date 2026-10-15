/**
 * DoppelDash — /api/auth/me contract + first-run org setup (live dev server + throwaway DB).
 * The mobile client hydrates user / organization / entitlements / onboarding ONLY from here.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db
test.before(async () => { db = await kit.connect() })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('ME1. returns user, organization, role, entitlements and onboarding state resolved server-side', async () => {
  const org = await kit.createOrg({ plan: 'premium' })
  const s = await kit.login(org.manager.email)
  const me = await kit.api('/api/auth/me', { token: s.accessToken })
  assert.equal(me.status, 200, me.text)
  assert.equal(me.json.user.role, 'manager')
  assert.equal(me.json.role, 'manager', 'flat fields stay for older clients')
  assert.equal(me.json.organization.orgId, org.orgId)
  assert.equal(me.json.entitlements.plan, 'premium')
  assert.equal(me.json.entitlements.features.customMail, true)
  assert.equal(typeof me.json.entitlements.webEnabled, 'boolean')
  assert.equal(me.json.onboarding.profileComplete, true)
  assert.equal(me.json.onboarding.orgSetupRequired, false)
})

test('ME2. Free org: entitlements say so (no client-side plan logic needed)', async () => {
  const org = await kit.createOrg({ plan: 'free' })
  const s = await kit.login(org.employee.email)
  const me = await kit.api('/api/auth/me', { token: s.accessToken })
  assert.equal(me.json.entitlements.plan, 'free')
  assert.equal(me.json.entitlements.features.customMail, false)
  assert.equal(me.json.user.role, 'employee')
})

test('ME3. unauthenticated, garbage and pre-auth tokens get 401 with no data', async () => {
  assert.equal((await kit.api('/api/auth/me')).status, 401)
  assert.equal((await kit.api('/api/auth/me', { token: 'not.a.jwt' })).status, 401)
})

test('ME4. self-registered org: setup required for its admin only; admin-only completion clears it; others cannot', async () => {
  const email = `authf_reg_${kit.rand()}@test.dd`
  const reg = await kit.api('/api/auth/register', { method: 'POST', body: {
    companyName: 'Setup Test Co', email, password: 'Str0ng!Passw0rd#1', firstName: 'Sam', lastName: 'Owner',
  } })
  assert.equal(reg.status, 201, reg.text)
  const orgId = reg.json.user.orgId
  kit.trackOrg(orgId)
  const token = reg.json.accessToken

  let me = await kit.api('/api/auth/me', { token })
  assert.equal(me.json.onboarding.orgSetupRequired, true)
  assert.equal(me.json.organization.orgId, orgId)
  assert.equal(me.json.entitlements.plan, 'free')

  // A non-admin of ANOTHER org cannot touch this org; a non-admin cannot complete setup at all.
  const other = await kit.createOrg()
  const mgr = await kit.login(other.manager.email)
  const denied = await kit.api('/api/org/settings', { method: 'POST', token: mgr.accessToken, body: { completeSetup: true, orgId } })
  assert.equal(denied.status, 403)
  me = await kit.api('/api/auth/me', { token })
  assert.equal(me.json.onboarding.orgSetupRequired, true, 'unchanged after a forbidden attempt')

  // A client-supplied orgId in the body is ignored: completion binds to the session's org.
  const done = await kit.api('/api/org/settings', { method: 'POST', token, body: { name: 'Setup Test Co', address: '1 Main St', completeSetup: true, orgId: other.orgId } })
  assert.equal(done.status, 200, done.text)
  me = await kit.api('/api/auth/me', { token })
  assert.equal(me.json.onboarding.orgSetupRequired, false)
  const otherOrg = await db.collection('organizations').findOne({ orgId: other.orgId })
  assert.ok(!otherOrg.setupRequired, 'other org untouched')
  const otherSettings = await db.collection('orgsettings').findOne({ orgId: other.orgId, address: '1 Main St' })
  assert.equal(otherSettings, null, 'settings were not written to the client-supplied org')
})
