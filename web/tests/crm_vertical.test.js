/**
 * Feature vertical 1 — CRM / CONTACTS: role matrix, visibility, tenant isolation, validation, mass-assignment,
 * search, entitlement limit, public share link. Both clients (Bearer = Android, cookie = Web) hit the same routes.
 * Requires a dev server on TEST_URL using the same throwaway DB (dd_gate_*_test).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, smtp, A, B, tok
test.before(async () => {
  db = await kit.connect()
  smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) {
    const s = await kit.login(org[r].email)
    tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie }
  }
})
test.after(async () => { await kit.cleanupAll(db); await smtp.stop(); await kit.disconnect() })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const make = async (k, body) => { const r = await kit.api('/api/crm', { method: 'POST', ...who(k), body }); assert.equal(r.status, 201, r.text); return r.json }
const ids = r => r.json.map(c => c._id)

test('K1. every role can create, read, edit and delete its OWN contact (both carriers)', async () => {
  for (const r of ['employee', 'manager', 'admin']) for (const via of ['token', 'cookie']) {
    const k = `A${r}`
    const c = await kit.api('/api/crm', { method: 'POST', ...who(k, via), body: { name: `Own ${r} ${via}`, email: 'o@x.com' } })
    assert.equal(c.status, 201); assert.equal(c.json.canManage, true)
    const g = await kit.api(`/api/crm/${c.json._id}`, who(k, via)); assert.equal(g.status, 200); assert.equal(g.json.canManage, true)
    const p = await kit.api(`/api/crm/${c.json._id}`, { method: 'PATCH', ...who(k, via), body: { company: 'Edited' } })
    assert.equal(p.status, 200); assert.equal(p.json.company, 'Edited')
    const d = await kit.api(`/api/crm/${c.json._id}`, { method: 'DELETE', ...who(k, via) })
    assert.equal(d.status, 200)
    assert.equal((await kit.api(`/api/crm/${c.json._id}`, who(k, via))).status, 404)
  }
})

test('K2. visibility matrix: private / team / org / boss_only / sharedWith', async () => {
  const emp = A.employee.id
  const priv = await make('Aemployee', { name: 'V private', visibility: 'private' })
  const team = await make('Aemployee', { name: 'V team', visibility: 'team' })
  const org = await make('Aemployee', { name: 'V org', visibility: 'org' })
  const boss = await make('Aemployee', { name: 'V boss', visibility: 'boss_only' })
  const shared = await make('Aemployee', { name: 'V shared', visibility: 'private', sharedWith: [A.manager.id] })
  const seen = async k => new Set(ids(await kit.api('/api/crm', who(k))))
  const e = await seen('Aemployee'), m = await seen('Amanager'), a = await seen('Aadmin')
  for (const c of [priv, team, org, boss, shared]) assert.ok(e.has(c._id), 'owner sees all own')
  assert.deepEqual([priv, team, org, boss, shared].map(c => m.has(c._id)), [false, true, true, false, true], 'manager: team+org+shared')
  assert.deepEqual([priv, team, org, boss, shared].map(c => a.has(c._id)), [false, true, true, true, false], 'admin: team+org+boss_only (not others’ private)')
  for (const [k, c, expect] of [['Amanager', priv, 404], ['Amanager', team, 200], ['Aadmin', boss, 200], ['Aemployee', boss, 200]]) {
    assert.equal((await kit.api(`/api/crm/${c._id}`, who(k))).status, expect, `${k} ${c.name}`)
  }
  void emp
})

test('K3. edit/delete: owner or admin only; managers cannot touch others; flags tell the client', async () => {
  const c = await make('Aemployee', { name: 'Guarded', visibility: 'org' })
  const asMgr = await kit.api(`/api/crm/${c._id}`, who('Amanager'))
  assert.equal(asMgr.json.canManage, false); assert.equal(asMgr.json.canShare, false)
  assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who('Amanager'), body: { company: 'x' } })).status, 404)
  assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'DELETE', ...who('Amanager') })).status, 404)
  const asAdm = await kit.api(`/api/crm/${c._id}`, who('Aadmin'))
  assert.equal(asAdm.json.canManage, true); assert.equal(asAdm.json.canShare, false)
  assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who('Aadmin'), body: { company: 'by admin' } })).status, 200)
  const list = await kit.api('/api/crm', who('Amanager'))
  assert.equal(list.json.find(x => x._id === c._id).canManage, false)
  assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'DELETE', ...who('Aadmin') })).status, 200)
})

test('K4. mass-assignment is closed: server-owned fields cannot be written on create or update', async () => {
  const c = await make('Aemployee', { name: 'Mass', shareToken: 'EVIL', isEmployee: true, orgId: B.orgId, createdBy: 'someone' })
  let raw = await db.collection('contacts').findOne({ _id: new (require('mongoose').Types.ObjectId)(c._id) })
  assert.equal(raw.orgId, A.orgId); assert.equal(raw.createdBy, A.employee.id); assert.ok(!raw.shareToken); assert.equal(raw.isEmployee, false)
  const p = await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who('Aemployee'), body: { shareToken: 'EVIL2', shareTokenExpiresAt: '2099-01-01', isEmployee: true, employeeClerkId: 'x', orgId: B.orgId, createdBy: 'z', birthdayGreetingSent: true, reminderDismissedAt: '2099-01-01', company: 'ok' } })
  assert.equal(p.status, 200)
  raw = await db.collection('contacts').findOne({ _id: raw._id })
  assert.equal(raw.company, 'ok')
  assert.equal(raw.orgId, A.orgId); assert.equal(raw.createdBy, A.employee.id)
  assert.ok(!raw.shareToken && !raw.employeeClerkId && !raw.reminderDismissedAt)
  assert.equal(raw.isEmployee, false); assert.equal(raw.birthdayGreetingSent, false)
})

test('K5. validation: malformed input is a 400 with field names, never a 500; nothing is half-saved', async () => {
  const bad = [
    [{ }, 'name'], [{ name: '   ' }, 'name'], [{ name: 'x', visibility: 'everyone' }, 'visibility'], [{ name: 'x', birthday: 'not-a-date' }, 'birthday'],
  ]
  for (const [body, field] of bad) {
    const r = await kit.api('/api/crm', { method: 'POST', ...who('Aemployee'), body })
    assert.equal(r.status, 400, JSON.stringify(body)); assert.ok(r.json.fields.includes(field), JSON.stringify(r.json))
  }
  const c = await make('Aemployee', { name: 'Valid' })
  for (const body of [{ name: '' }, { visibility: 'nope' }, { reminderDate: 'zzz' }]) {
    const r = await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who('Aemployee'), body })
    assert.equal(r.status, 400, JSON.stringify(body))
  }
  for (const entry of [{ type: 'sms', title: 'x' }, { type: 'note', title: '' }, { type: 'note', title: 'x', date: 'bad' }]) {
    assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who('Aemployee'), body: { timelineEntry: entry } })).status, 400)
  }
  const ok = await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who('Aemployee'), body: { timelineEntry: { type: 'call', title: 'Intro call', body: 'went well' } } })
  assert.equal(ok.status, 200); assert.equal(ok.json.timeline[0].title, 'Intro call')
  assert.equal((await kit.api('/api/crm/not-an-id', who('Aemployee'))).status, 404)
  assert.equal((await kit.api(`/api/crm/${c._id}`, who('Aemployee'))).json.name, 'Valid', 'rejected patches left the record intact')
})

test('K6. server-side search covers name/company/email/phone/tag, is case-insensitive and regex-safe; tag filter + paging', async () => {
  await make('Aemployee', { name: 'Zed Findable', company: 'Quasar Ropeways', email: 'zed@quasar.example', phone: '+91 98765 43210', tags: ['Vendor', 'VIP'], visibility: 'org' })
  const q = async (s, k = 'Aemployee') => ids(await kit.api('/api/crm?q=' + encodeURIComponent(s), who(k)))
  const id = (await kit.api('/api/crm?q=Findable', who('Aemployee'))).json[0]._id
  for (const s of ['zed', 'QUASAR', 'zed@quasar', '98765', 'vip']) assert.ok((await q(s)).includes(id), s)
  for (const s of ['.*', '(', '[', '\\', 'a{999999}']) { const r = await kit.api('/api/crm?q=' + encodeURIComponent(s), who('Aemployee')); assert.equal(r.status, 200, s) }
  assert.ok(!(await q('.*')).includes(id), 'regex metacharacters are literal')
  assert.ok((await ids(await kit.api('/api/crm?tag=VIP', who('Amanager')))).includes(id))
  assert.ok(!(await ids(await kit.api('/api/crm?tag=Nope', who('Aemployee')))).includes(id))
  const all = (await kit.api('/api/crm', who('Aemployee'))).json.length
  assert.ok(all >= 3)
  assert.equal((await kit.api('/api/crm?limit=2', who('Aemployee'))).json.length, 2)
  const p2 = await kit.api('/api/crm?limit=2&skip=2', who('Aemployee'))
  assert.equal(p2.json.length, Math.min(2, all - 2))
  assert.equal((await kit.api('/api/crm?limit=-5&skip=abc', who('Aemployee'))).status, 200)
})

test('K7. sharedWith keeps only users of the same organisation', async () => {
  const c = await make('Aemployee', { name: 'Share targets', sharedWith: [A.manager.id, B.manager.id, 'garbage', { $ne: 1 }] })
  const raw = await db.collection('contacts').findOne({ name: 'Share targets' })
  assert.deepEqual(raw.sharedWith, [A.manager.id])
  void c
})

test('K8. tenant isolation: org B sees/touches nothing of org A (list, detail, search, patch, delete, share, reminders)', async () => {
  const c = await make('Aemployee', { name: 'TENANT-SECRET-A', company: 'A-Only Co', visibility: 'org', reminderDate: new Date(Date.now() + 864e5).toISOString() })
  for (const r of ['employee', 'manager', 'admin']) for (const via of ['token', 'cookie']) {
    const k = `B${r}`
    const list = await kit.api('/api/crm', who(k, via)); assert.ok(!JSON.stringify(list.json).includes('TENANT-SECRET-A'))
    const s = await kit.api('/api/crm?q=TENANT-SECRET', who(k, via)); assert.deepEqual(s.json, [])
    assert.equal((await kit.api(`/api/crm/${c._id}`, who(k, via))).status, 404)
    assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'PATCH', ...who(k, via), body: { company: 'pwn' } })).status, 404)
    assert.equal((await kit.api(`/api/crm/${c._id}`, { method: 'DELETE', ...who(k, via) })).status, 404)
    assert.equal((await kit.api(`/api/crm/${c._id}/share`, who(k, via))).status, 404)
    assert.ok(!JSON.stringify((await kit.api('/api/crm/reminders', who(k, via))).json).includes('TENANT-SECRET-A'))
  }
  assert.equal((await db.collection('contacts').findOne({ name: 'TENANT-SECRET-A' })).company, 'A-Only Co')
})

test('K9. public share link: creator only; works without login; revoke kills it; expiry honoured', async () => {
  const c = await make('Aemployee', { name: 'Card Owner', email: 'card@x.com', visibility: 'org' })
  assert.equal((await kit.api(`/api/crm/${c._id}/share`, who('Amanager'))).status, 404)
  assert.equal((await kit.api(`/api/crm/${c._id}/share`, who('Aadmin'))).status, 404)
  const s = await kit.api(`/api/crm/${c._id}/share`, who('Aemployee')); assert.equal(s.status, 200)
  const page = await kit.api(s.json.url); assert.equal(page.status, 200); assert.match(page.text, /Card Owner/)
  assert.equal((await kit.api(`/api/crm/${c._id}/share`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
  const dead = await kit.api(s.json.url); assert.match(dead.text, /Contact not found/); assert.ok(!dead.text.includes('Card Owner'), 'revoked link is dead (soft-404 page, no data)')
  const s2 = await kit.api(`/api/crm/${c._id}/share`, who('Aemployee'))
  await db.collection('contacts').updateOne({ shareToken: s2.json.token }, { $set: { shareTokenExpiresAt: new Date(Date.now() - 1000) } })
  const exp = await kit.api(s2.json.url); assert.match(exp.text, /Contact not found/); assert.ok(!exp.text.includes('Card Owner'), 'expired link is dead')
})

test('K10. entitlement: free org is capped at 50 contacts (403 + upgrade message); premium is not', async () => {
  const F = await kit.createOrg({ plan: 'free', webEnabled: false })
  const f = await kit.login(F.employee.email)
  const docs = Array.from({ length: 50 }, (_, i) => ({ orgId: F.orgId, createdBy: F.employee.id, name: `Bulk ${i}`, visibility: 'private', timeline: [], tags: [], projects: [], sharedWith: [], isEmployee: false }))
  await db.collection('contacts').insertMany(docs)
  const r = await kit.api('/api/crm', { method: 'POST', token: f.accessToken, body: { name: 'One too many' } })
  assert.equal(r.status, 403); assert.match(r.json.error, /Premium/i)
  assert.equal((await kit.api('/api/crm', { method: 'POST', ...who('Aemployee'), body: { name: 'Premium ok' } })).status, 201)
})

test('K11. unauthenticated and web-denied callers get 401 on every CRM route', async () => {
  const c = await make('Aemployee', { name: 'Anon target' })
  for (const [m, p] of [['GET', '/api/crm'], ['POST', '/api/crm'], ['GET', `/api/crm/${c._id}`], ['PATCH', `/api/crm/${c._id}`], ['DELETE', `/api/crm/${c._id}`], ['GET', '/api/crm/reminders'], ['GET', `/api/crm/${c._id}/share`]]) {
    assert.equal((await kit.api(p, { method: m, body: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 401, `${m} ${p}`)
  }
})
