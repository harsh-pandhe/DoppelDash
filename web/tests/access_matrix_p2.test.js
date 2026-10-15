/**
 * Access-control matrix for the handlers the Phase 5 security matrix flagged as having no dedicated test (P2 group): admin users/balances/invitations,
 * announcements, holidays, CRM share + scanned cards, inbox, mail drafts, reports/calendar/workload. For each: anonymous, wrong role, same-org
 * non-owner, other tenant, and "refusal changes nothing". Real routes, throwaway DB, fake providers.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')

let db, A, B, tok, ids
const oid = s => new mongoose.Types.ObjectId(s)
test.before(async () => {
  db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}; for (const [k, o] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) tok[k + r] = (await kit.login(o[r].email)).accessToken
  const post = async (p, t, body) => (await kit.api(p, { method: 'POST', token: tok[t], body })).json
  ids = {
    ann: (await post('/api/announcements', 'Aadmin', { title: 'A-ann', body: 'x', priority: 'normal' }))._id,
    holiday: (await post('/api/holidays', 'Aadmin', { name: 'A-day', date: '2026-12-25', type: 'optional' }))._id,
    contact: (await post('/api/crm', 'Aemployee', { name: 'A-contact' }))._id,
    draft: (await post('/api/mail/drafts', 'Aemployee', { subject: 'A-draft', bodyHtml: '<p>x</p>', recipients: [] }))._id,
  }
  ids.card = (await db.collection('scannedcards').insertOne({ orgId: A.orgId, uploadedBy: A.employee.id, imageUrl: 'x', status: 'pending', createdAt: new Date(), updatedAt: new Date() })).insertedId.toString()
  ids.msg = (await db.collection('inboxmessages').insertOne({ orgId: A.orgId, mailbox: 'INBOX', uid: 1, subject: 'secret subject', fromEmail: 'x@y.test', readByApp: false, receivedAt: new Date(), createdAt: new Date() })).insertedId.toString()
  const inv = await post('/api/admin/invitations', 'Aadmin', { email: `inv_${kit.rand()}@qa.test`, role: 'employee', firstName: 'I', lastName: 'V' }); ids.inv = inv.invitation && (inv.invitation._id || inv.invitation.id)
})
test.after(async () => { for (const c of ['announcements', 'publicholidays', 'contacts', 'maildrafts', 'scannedcards', 'inboxmessages', 'invitations', 'leavebalances']) await db.collection(c).deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await kit.cleanupAll(db); await kit.disconnect() })

const call = (m, p, t, body) => kit.api(p, { method: m, token: t ? tok[t] : undefined, body })
const expectAll = async (rows) => { for (const [m, p, who, status, body] of rows) { const r = await call(m, p, who, body); assert.equal(r.status, status, `${who || 'anonymous'} ${m} ${p.replace(/[0-9a-f]{24}/g, ':id')} → ${r.status} (expected ${status}) ${r.text.slice(0, 120)}`); assert.doesNotMatch(r.text, /stack|MongoServer|E11000/i) } }

test('P2-1. admin/users/[userId] + admin/balances/[userId]: admin only; other tenant 404; refusals change nothing', async () => {
  const u = A.employee.id; const before = JSON.stringify(await db.collection('users').findOne({ _id: oid(u) }))
  await expectAll([
    ['GET', `/api/admin/users/${u}`, null, 401], ['GET', `/api/admin/users/${u}`, 'Aemployee', 403], ['GET', `/api/admin/users/${u}`, 'Amanager', 403], ['GET', `/api/admin/users/${u}`, 'Badmin', 404], ['GET', `/api/admin/users/${u}`, 'Aadmin', 200],
    ['PATCH', `/api/admin/users/${u}`, 'Aemployee', 403, { role: 'admin' }], ['PATCH', `/api/admin/users/${u}`, 'Amanager', 403, { role: 'admin' }], ['PATCH', `/api/admin/users/${u}`, 'Badmin', 404, { role: 'admin' }],
    ['DELETE', `/api/admin/users/${u}`, 'Aemployee', 403], ['DELETE', `/api/admin/users/${u}`, 'Amanager', 403], ['DELETE', `/api/admin/users/${u}`, 'Badmin', 404],
    ['GET', `/api/admin/balances/${u}`, 'Aemployee', 403], ['GET', `/api/admin/balances/${u}`, 'Amanager', 403], ['GET', `/api/admin/balances/${u}`, 'Badmin', 404], ['GET', `/api/admin/balances/${u}`, 'Aadmin', 200],
    ['PATCH', `/api/admin/balances/${u}`, 'Amanager', 403, { casual: 999 }], ['PATCH', `/api/admin/balances/${u}`, 'Badmin', 404, { casual: 999 }],
  ])
  assert.equal(JSON.stringify(await db.collection('users').findOne({ _id: oid(u) })), before)
  assert.equal(await db.collection('leavebalances').countDocuments({ userId: u, casual: 999 }), 0)
})

test('P2-2. admin/invitations/[id] (+resend): employee 403, other tenant 404', async () => {
  if (!ids.inv) return
  await expectAll([['GET', `/api/admin/invitations/${ids.inv}`, 'Aemployee', 403], ['GET', `/api/admin/invitations/${ids.inv}`, 'Badmin', 404], ['DELETE', `/api/admin/invitations/${ids.inv}`, 'Aemployee', 403], ['DELETE', `/api/admin/invitations/${ids.inv}`, 'Badmin', 404],
    ['POST', `/api/admin/invitations/${ids.inv}/resend`, 'Aemployee', 403], ['POST', `/api/admin/invitations/${ids.inv}/resend`, 'Badmin', 404], ['GET', `/api/admin/invitations/${ids.inv}`, null, 401]])
  assert.equal(await db.collection('invitations').countDocuments({ _id: oid(ids.inv) }), 1)
})

test('P2-3. announcements/[id]: employees 403, other tenant 404 (edit and delete); nothing changes', async () => {
  await expectAll([['PATCH', `/api/announcements/${ids.ann}`, 'Aemployee', 403, { title: 'pwn' }], ['PATCH', `/api/announcements/${ids.ann}`, 'Bmanager', 404, { title: 'pwn' }], ['PATCH', `/api/announcements/${ids.ann}`, 'Badmin', 404, { title: 'pwn' }], ['DELETE', `/api/announcements/${ids.ann}`, 'Aemployee', 403], ['DELETE', `/api/announcements/${ids.ann}`, 'Bmanager', 404], ['PATCH', `/api/announcements/${ids.ann}`, null, 401, { title: 'x' }]])
  assert.equal((await db.collection('announcements').findOne({ _id: oid(ids.ann) })).title, 'A-ann')
  const mass = await call('PATCH', `/api/announcements/${ids.ann}`, 'Amanager', { title: 'ok', orgId: B.orgId, authorId: 'x' }); assert.equal(mass.status, 200)
  const a = await db.collection('announcements').findOne({ _id: oid(ids.ann) }); assert.equal(a.orgId, A.orgId, 'orgId cannot be moved'); assert.notEqual(a.authorId, 'x')
})

test('P2-4. holidays: every role reads; only manager/admin write; another tenant cannot delete this tenant’s holiday', async () => {
  await expectAll([['GET', '/api/holidays', 'Aemployee', 200], ['POST', '/api/holidays', 'Aemployee', 403, { name: 'x', date: '2026-12-31' }], ['DELETE', '/api/holidays', 'Aemployee', 403, { id: ids.holiday }], ['GET', '/api/holidays', null, 401], ['DELETE', '/api/holidays', 'Badmin', 200, { id: ids.holiday }]])
  assert.equal(await db.collection('publicholidays').countDocuments({ _id: oid(ids.holiday) }), 1, 'the other tenant’s delete removed nothing')
  await expectAll([['DELETE', '/api/holidays', 'Aadmin', 400, { id: 'bad' }], ['DELETE', '/api/holidays', 'Aadmin', 200, { id: ids.holiday }]])
  assert.equal(await db.collection('publicholidays').countDocuments({ _id: oid(ids.holiday) }), 0)
})

test('P2-5. crm/[id]/share and scanned-cards/[id]: only the creator/uploader; same-org colleagues and other tenants get 404/403 and change nothing', async () => {
  await expectAll([['POST', `/api/crm/${ids.contact}/share`, 'Amanager', 404], ['POST', `/api/crm/${ids.contact}/share`, 'Aadmin', 404], ['POST', `/api/crm/${ids.contact}/share`, 'Bmanager', 404], ['GET', `/api/crm/${ids.contact}/share`, 'Bemployee', 404], ['DELETE', `/api/crm/${ids.contact}/share`, 'Amanager', 404], ['POST', `/api/crm/${ids.contact}/share`, null, 401]])
  assert.ok(!(await db.collection('contacts').findOne({ _id: oid(ids.contact) })).shareToken, 'no share token was minted for a non-owner')
  await expectAll([['PATCH', `/api/crm/scanned-cards/${ids.card}`, 'Amanager', 403, { status: 'saved' }], ['PATCH', `/api/crm/scanned-cards/${ids.card}`, 'Bemployee', 404, { status: 'saved' }], ['DELETE', `/api/crm/scanned-cards/${ids.card}`, 'Aadmin', 403], ['DELETE', `/api/crm/scanned-cards/${ids.card}`, 'Bmanager', 404], ['DELETE', `/api/crm/scanned-cards/${ids.card}`, null, 401]])
  assert.equal(await db.collection('scannedcards').countDocuments({ _id: oid(ids.card) }), 1)
  await expectAll([['POST', `/api/crm/${ids.contact}/share`, 'Aemployee', 200]]); await expectAll([['DELETE', `/api/crm/${ids.contact}/share`, 'Aemployee', 200]])
})

test('P2-6. inbox + inbox/[id]: no mail access → 403 (employee), manager/admin read own tenant only; other tenant 404; subjects never leak', async () => {
  await expectAll([['GET', '/api/inbox', 'Aemployee', 403], ['GET', `/api/inbox/${ids.msg}`, 'Aemployee', 403], ['GET', '/api/inbox', null, 401], ['GET', `/api/inbox/${ids.msg}`, 'Bmanager', 404], ['GET', `/api/inbox/${ids.msg}`, 'Badmin', 404], ['PATCH', `/api/inbox/${ids.msg}`, 'Bmanager', 404, { readByApp: true }], ['GET', `/api/inbox/${ids.msg}`, 'Amanager', 200]])
  for (const t of ['Bmanager', 'Badmin']) assert.doesNotMatch((await call('GET', '/api/inbox', t)).text, /secret subject/)
  assert.match((await call('GET', '/api/inbox', 'Aadmin')).text, /secret subject/)
})

test('P2-7. mail/drafts + [id]: private to the author — a same-org admin and other tenants see/modify nothing', async () => {
  await expectAll([['GET', `/api/mail/drafts/${ids.draft}`, 'Aadmin', 404], ['PATCH', `/api/mail/drafts/${ids.draft}`, 'Aadmin', 404, { subject: 'pwn' }], ['DELETE', `/api/mail/drafts/${ids.draft}`, 'Aadmin', 404], ['GET', `/api/mail/drafts/${ids.draft}`, 'Bemployee', 404], ['GET', '/api/mail/drafts', null, 401], ['GET', `/api/mail/drafts/${ids.draft}`, 'Aemployee', 200]])
  assert.doesNotMatch((await call('GET', '/api/mail/drafts', 'Aadmin')).text, /A-draft/); assert.match((await call('GET', '/api/mail/drafts', 'Aemployee')).text, /A-draft/)
  assert.equal((await db.collection('maildrafts').findOne({ _id: oid(ids.draft) })).subject, 'A-draft')
})

test('P2-8. reports, lms/calendar, lms/workload: anonymous 401; workload manager/admin only; an employee’s report/calendar never includes colleagues’ or other tenants’ records', async () => {
  await db.collection('leaves').insertMany([{ orgId: A.orgId, userId: A.manager.id, userName: 'Mgr', type: 'casual', startDate: new Date('2026-12-10'), endDate: new Date('2026-12-10'), days: 1, reason: 'MGR-PRIVATE', status: 'approved' }, { orgId: B.orgId, userId: B.employee.id, userName: 'Bee', type: 'casual', startDate: new Date('2026-12-10'), endDate: new Date('2026-12-10'), days: 1, reason: 'B-PRIVATE', status: 'approved' }])
  await expectAll([['GET', '/api/reports', null, 401], ['GET', '/api/lms/calendar', null, 401], ['GET', '/api/lms/workload', null, 401], ['GET', '/api/lms/workload', 'Aemployee', 403], ['GET', '/api/lms/workload', 'Amanager', 200], ['GET', '/api/reports', 'Aemployee', 200], ['GET', '/api/lms/calendar', 'Aemployee', 200]])
  for (const p of ['/api/reports', '/api/lms/calendar']) { const t = (await call('GET', p, 'Aemployee')).text; assert.doesNotMatch(t, /B-PRIVATE|Bee/, p + ' leaks another tenant') }
  assert.doesNotMatch((await call('GET', '/api/lms/workload', 'Amanager')).text, /B-PRIVATE|Bee/)
})
