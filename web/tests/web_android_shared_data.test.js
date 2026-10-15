/**
 * DoppelDash — WEB ↔ ANDROID shared-backend round trips.
 *
 * One backend, one MongoDB. A Doppelmayr-style organisation (premium / lifetime_grant / webEnabled / androidEnabled)
 * is used from BOTH clients. The two clients are the two real session carriers the server issues on the same login:
 *   • ANDROID = Bearer access token   • WEB = dd_session cookie
 * Every write by one carrier must be visible to the other through the same collections, with the same ids and
 * statuses, and nothing may cross an organisation boundary. Requires a dev server on TEST_URL using the same
 * throwaway DB (dd_gate_*_test). Never touches Atlas.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, smtp, org, other, A, W // A = android session per role, W = web session per role

test.before(async () => {
  db = await kit.connect()
  smtp = await kit.startFakeSmtp(2525)
  org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  other = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  A = {}; W = {}
  for (const role of ['admin', 'manager', 'employee']) {
    const s = await kit.login(org[role].email)
    A[role] = { token: s.accessToken }
    W[role] = { cookie: s.cookie }
    assert.ok(s.accessToken && s.cookie.startsWith('dd_session='), `${role}: login issues both carriers for a web+android org`)
  }
})
test.after(async () => { await kit.cleanupAll(db); await smtp.stop(); await kit.disconnect() })

const android = (role) => ({ token: A[role].token })
const web = (role) => ({ cookie: W[role].cookie })
const day = n => new Date(Date.now() + n * 864e5).toISOString()

/* ───────────── identity / entitlement ───────────── */
test('S1. both clients resolve the SAME user, org, role and entitlement from /api/auth/me', async () => {
  for (const role of ['admin', 'manager', 'employee']) {
    const a = await kit.api('/api/auth/me', android(role))
    const w = await kit.api('/api/auth/me', web(role))
    assert.equal(a.status, 200); assert.equal(w.status, 200)
    assert.equal(a.json.id, w.json.id)
    assert.equal(a.json.role, role); assert.equal(w.json.role, role)
    assert.equal(a.json.organization.orgId, org.orgId); assert.equal(w.json.organization.orgId, org.orgId)
    assert.deepEqual(a.json.entitlements, w.json.entitlements)
  }
})

test('S2. Doppelmayr-style org: premium via lifetime_grant, web + android enabled; premium is org-level (all roles)', async () => {
  const doc = await db.collection('organizations').findOne({ orgId: org.orgId })
  assert.equal(doc.plan, 'premium'); assert.equal(doc.entitlementSource, 'lifetime_grant'); assert.equal(doc.lifetimeGrant, true)
  assert.equal(doc.webEnabled, true); assert.equal(doc.androidEnabled, true)
  for (const role of ['admin', 'manager', 'employee']) {
    for (const carrier of [android(role), web(role)]) {
      const e = await kit.api('/api/billing/entitlements', carrier)
      assert.equal(e.status, 200)
      assert.equal(e.json.plan, 'premium', `${role} inherits premium`)
    }
  }
})

test('S3. ensureDoppelmayr() seeds exactly the locked entitlement — no third plan, no runtime special case', async () => {
  const Organization = kit.load('models/Organization.ts').default
  const d = await Organization.ensureDoppelmayr()
  try {
    assert.equal(d.plan, 'premium'); assert.equal(d.entitlementSource, 'lifetime_grant'); assert.equal(d.lifetimeGrant, true)
    assert.equal(d.webEnabled, true); assert.equal(d.androidEnabled, true)
  } finally {
    // throwaway DB only (kit.connect refuses anything else)
    await db.collection('organizations').deleteOne({ orgId: d.orgId, _id: d._id }).catch(() => {})
  }
})

/* ───────────── CRM / contacts ───────────── */
test('S4. contact created on ANDROID is visible, then edited on WEB, and the edit is visible on ANDROID', async () => {
  const created = await kit.api('/api/crm', { method: 'POST', ...android('employee'), body: { name: 'Shared Contact', email: 'sc@x.com', company: 'ACME', visibility: 'org' } })
  assert.equal(created.status, 201)
  const id = created.json._id
  const onWeb = await kit.api('/api/crm', web('employee'))
  const listed = (onWeb.json.contacts || onWeb.json).find?.(c => c._id === id)
  assert.ok(listed, 'web list contains the android-created contact')
  const edit = await kit.api(`/api/crm/${id}`, { method: 'PATCH', ...web('employee'), body: { company: 'ACME India' } })
  assert.equal(edit.status, 200)
  const back = await kit.api(`/api/crm/${id}`, android('employee'))
  assert.equal(back.status, 200)
  assert.equal(back.json.company, 'ACME India')
  const raw = await db.collection('contacts').findOne({ orgId: org.orgId, name: 'Shared Contact' })
  assert.ok(raw, 'a single contacts document exists in the shared collection')
})

/* ───────────── expenses ───────────── */
test('S5. expense submitted on ANDROID, approved on WEB by the manager; status visible on ANDROID', async () => {
  const c = await kit.api('/api/rms', { method: 'POST', ...android('employee'), body: { title: 'Taxi', amount: 450, startDate: day(-1), reason: 'client visit' } })
  assert.equal(c.status, 201, c.text)
  const id = c.json._id
  assert.equal(c.json.status, 'pending_manager')
  const seenByManagerOnWeb = await kit.api('/api/rms', web('manager'))
  const list = Array.isArray(seenByManagerOnWeb.json) ? seenByManagerOnWeb.json : (seenByManagerOnWeb.json.expenses || [])
  assert.ok(list.some(e => e._id === id), 'manager sees the android-submitted expense on web')
  const act = await kit.api(`/api/rms/${id}`, { method: 'PATCH', ...web('manager'), body: { status: 'pending_admin' } })
  assert.equal(act.status, 200, act.text)
  const mine = await kit.api('/api/rms', android('employee'))
  const mineList = Array.isArray(mine.json) ? mine.json : (mine.json.expenses || [])
  assert.equal(mineList.find(e => e._id === id)?.status, 'pending_admin', 'android sees the web approval state')
})

test('S6. an employee cannot approve their own expense from either client (authorization is server-side)', async () => {
  const c = await kit.api('/api/rms', { method: 'POST', ...web('employee'), body: { title: 'Lunch', amount: 100, startDate: day(-1), reason: 'x' } })
  assert.equal(c.status, 201)
  for (const carrier of [android('employee'), web('employee')]) {
    const r = await kit.api(`/api/rms/${c.json._id}`, { method: 'PATCH', ...carrier, body: { status: 'approved' } })
    assert.equal(r.status, 403)
  }
})

/* ───────────── travel ───────────── */
test('S7. travel request created on WEB, approved on ANDROID by the manager', async () => {
  const c = await kit.api('/api/travel', { method: 'POST', ...web('employee'), body: { purpose: 'Site visit', destination: 'Pune', departureDate: day(5), returnDate: day(7), estimatedTotal: 12000 } })
  assert.equal(c.status, 201, c.text)
  const id = c.json._id
  const ap = await kit.api(`/api/travel/${id}`, { method: 'PATCH', ...android('manager'), body: { status: 'approved', revision: c.json.revision } })
  assert.equal(ap.status, 200, ap.text)
  const w = await kit.api('/api/travel', web('employee'))
  const list = Array.isArray(w.json) ? w.json : (w.json.requests || w.json.travel || [])
  assert.equal(list.find(t => t._id === id)?.status, 'approved')
})

/* ───────────── leave ───────────── */
test('S8. leave applied on ANDROID, approved on WEB; balance + status consistent on both', async () => {
  const c = await kit.api('/api/lms', { method: 'POST', ...android('employee'), body: { type: 'casual', startDate: day(10), endDate: day(10), days: 1, reason: 'personal' } })
  assert.equal(c.status, 201, c.text)
  const id = c.json._id
  const ap = await kit.api(`/api/lms/${id}`, { method: 'PATCH', ...web('manager'), body: { status: 'approved' } })
  assert.equal(ap.status, 200, ap.text)
  const a = await kit.api('/api/lms', android('employee'))
  const al = Array.isArray(a.json) ? a.json : (a.json.leaves || [])
  assert.equal(al.find(l => l._id === id)?.status, 'approved')
  const b1 = await kit.api('/api/lms/balance', android('employee'))
  const b2 = await kit.api('/api/lms/balance', web('employee'))
  assert.deepEqual(b1.json, b2.json)
})

/* ───────────── announcements / notifications / org settings ───────────── */
test('S9. announcement posted on WEB by a manager is read on ANDROID; employees cannot post', async () => {
  const p = await kit.api('/api/announcements', { method: 'POST', ...web('manager'), body: { title: 'All hands', body: '<p>Friday</p>', priority: 'normal' } })
  assert.equal(p.status, 201, p.text)
  const list = await kit.api('/api/announcements', android('employee'))
  const items = Array.isArray(list.json) ? list.json : (list.json.announcements || [])
  assert.ok(items.some(a => a._id === p.json._id))
  const denied = await kit.api('/api/announcements', { method: 'POST', ...android('employee'), body: { title: 'x', body: 'y' } })
  assert.equal(denied.status, 403)
})

test('S10. notifications + org settings are the same documents from both carriers', async () => {
  const n1 = await kit.api('/api/notifications', android('manager'))
  const n2 = await kit.api('/api/notifications', web('manager'))
  assert.equal(n1.status, 200); assert.equal(n2.status, 200)
  assert.deepEqual((n1.json.items || []).map(i => i.id).sort(), (n2.json.items || []).map(i => i.id).sort())
  const s1 = await kit.api('/api/org/settings', android('admin'))
  const s2 = await kit.api('/api/org/settings', web('admin'))
  assert.equal(s1.status, 200); assert.deepEqual(s1.json, s2.json)
})

/* ───────────── roles + tenancy ───────────── */
test('S11. role gates are identical on both carriers (employee blocked from admin APIs; admin allowed)', async () => {
  for (const carrier of [android('employee'), web('employee')]) {
    assert.ok([401, 403].includes((await kit.api('/api/admin/users', carrier)).status))
    assert.ok([401, 403].includes((await kit.api('/api/admin/audit', carrier)).status))
  }
  for (const carrier of [android('admin'), web('admin')]) assert.equal((await kit.api('/api/admin/users', carrier)).status, 200)
})

test('S12. no cross-tenant data on either carrier: org B cannot see or touch org A records', async () => {
  const bAdmin = await kit.login(other.admin.email)
  const contact = await db.collection('contacts').findOne({ orgId: org.orgId })
  const expense = await db.collection('expenses').findOne({ orgId: org.orgId })
  for (const carrier of [{ token: bAdmin.accessToken }, { cookie: bAdmin.cookie }]) {
    const crm = await kit.api('/api/crm', carrier)
    assert.ok(!JSON.stringify(crm.json).includes('Shared Contact'))
    const rms = await kit.api('/api/rms', carrier)
    assert.ok(!JSON.stringify(rms.json).includes(String(expense._id)))
    assert.equal((await kit.api(`/api/crm/${contact._id}`, carrier)).status, 404)
    assert.equal((await kit.api(`/api/rms/${expense._id}`, { method: 'PATCH', ...carrier, body: { status: 'pending_admin' } })).status, 404)
    const users = await kit.api('/api/admin/users', carrier)
    assert.ok(!JSON.stringify(users.json).includes(org.admin.email))
  }
})

test('S13. premium is not derived from org name/slug/email: a free org named like Doppelmayr stays free; web stays denied', async () => {
  const fake = await kit.createOrg({ name: 'Doppelmayr India', plan: 'free', webEnabled: false })
  await db.collection('organizations').updateOne({ orgId: fake.orgId }, { $set: { slug: 'doppelmayr' } }).catch(() => {})
  const s = await kit.login(fake.admin.email)
  const e = await kit.api('/api/billing/entitlements', { token: s.accessToken })
  assert.equal(e.json.plan, 'free')
  assert.ok(!s.cookie.startsWith('dd_session=') || (await kit.api('/api/auth/me', { cookie: s.cookie })).status === 401)
})

test('S14. a malformed expense payload is a 400 with field names (was an unhandled 500), identical on both carriers', async () => {
  for (const carrier of [android('employee'), web('employee')]) {
    const r = await kit.api('/api/rms', { method: 'POST', ...carrier, body: { title: 'No dates' } })
    assert.equal(r.status, 400)
    assert.ok(r.json.fields.includes('startDate'))
  }
})
