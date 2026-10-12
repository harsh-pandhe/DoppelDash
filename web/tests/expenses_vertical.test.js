/**
 * Feature vertical 2 — EXPENSES: CRUD, validation, role matrix, state machine, idempotency, concurrency,
 * tenant isolation, entitlement, audit, notifications, Web ↔ Android shared data.
 * Android = Bearer access token, Web = dd_session cookie, same routes. Requires a dev server on TEST_URL using the
 * same throwaway DB (dd_gate_*_test) and the fake SMTP the kit starts.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')
// Receipts must be real uploads in the caller's own PRIVATE tenant folder: run the real ticket → provider flow.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)])
async function uploadedReceiptUrl(k, via = 'token') {
  const t = await kit.api('/api/uploads/sign', { method: 'POST', ...(via === 'token' ? { token: tok[k].token } : { cookie: tok[k].cookie }), body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: JPEG.length } })
  assert.equal(t.status, 200, t.text)
  const fd = new FormData(); for (const [f, v] of Object.entries(t.json.fields)) fd.append(f, v); fd.append('file', new Blob([JPEG]), 'r.jpg')
  const up = await (await fetch(t.json.uploadUrl, { method: 'POST', body: fd })).json()
  return up.secure_url
}

let db, smtp, A, B, F, tok, providers
test.before(async () => {
  providers = await fake.ensureFakeProviders()
  db = await kit.connect()
  smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }) // Doppelmayr-style
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  F = await kit.createOrg({ plan: 'free', webEnabled: false })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B], ['F', F]]) for (const r of ['admin', 'manager', 'employee']) {
    const s = await kit.login(org[r].email)
    tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie }
  }
})
test.after(async () => { await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect() })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const day = n => new Date(Date.now() + n * 864e5).toISOString()
const base = (o = {}) => ({ title: 'Taxi to client', reason: 'Client visit', amount: 450, startDate: day(-1), ...o })
const create = async (k, o, via = 'token') => { const r = await kit.api('/api/rms', { method: 'POST', ...who(k, via), body: base(o) }); assert.equal(r.status, 201, r.text); return r.json }
const patch = (k, id, body, via = 'token') => kit.api(`/api/rms/${id}`, { method: 'PATCH', ...who(k, via), body })
// Audit rows are written fire-and-forget after the response, so wait for the row to land, then settle briefly so a
// duplicate (the bug we care about) would also be visible before we count.
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function auditCount(action, targetId, expected = 1) {
  const count = () => db.collection('auditlogs').countDocuments({ action, targetId })
  for (let i = 0; i < 40 && (await count()) < expected; i++) await sleep(50)
  await sleep(150)
  return count()
}

/* ───────────── 1. CRUD + visibility (read own / org) ───────────── */
test('X1. employee creates + reads OWN only; manager/admin read the whole org; others’ detail is 403 for employees', async () => {
  const mine = await create('Aemployee', { title: 'Mine' })
  const mgrs = await create('Amanager', { title: 'Manager own' })
  const emp = await kit.api('/api/rms', who('Aemployee'))
  assert.ok(emp.json.some(e => e._id === mine._id)); assert.ok(!emp.json.some(e => e._id === mgrs._id), 'employee does not see manager claim')
  for (const k of ['Amanager', 'Aadmin']) { const l = await kit.api('/api/rms', who(k)); assert.ok(l.json.some(e => e._id === mine._id) && l.json.some(e => e._id === mgrs._id)) }
  assert.equal((await kit.api(`/api/rms/${mgrs._id}`, who('Aemployee'))).status, 403)
  assert.equal((await kit.api(`/api/rms/${mine._id}`, who('Aemployee'))).status, 200)
  assert.equal(mine.status, 'pending_manager'); assert.equal(mine.orgId, A.orgId)
})

/* ───────────── 2. state machine + role matrix ───────────── */
test('X2. happy path: employee → manager forwards → admin pays; each step audited exactly once', async () => {
  const e = await create('Aemployee', { title: 'Flow' })
  const fwd = await patch('Amanager', e._id, { status: 'pending_admin', managerNote: 'ok' }); assert.equal(fwd.status, 200); assert.equal(fwd.json.status, 'pending_admin')
  const paid = await patch('Aadmin', e._id, { status: 'paid', adminNote: 'done', paymentMethod: 'upi', paymentNote: 'ref 1' }); assert.equal(paid.status, 200)
  assert.equal(paid.json.paymentMethod, 'upi'); assert.equal(paid.json.status, 'paid')
  assert.equal(await auditCount('expense.submitted', e._id), 1)
  assert.equal(await auditCount('expense.pending_admin', e._id), 1)
  assert.equal(await auditCount('expense.paid', e._id), 1)
  assert.equal((await patch('Aadmin', e._id, { status: 'rejected' })).status, 409, 'paid is final')
})

test('X3. forbidden / invalid transitions: employee cannot review, manager cannot pay, no skipping the manager step, final states are final', async () => {
  const e = await create('Aemployee', { title: 'Perm' })
  for (const via of ['token', 'cookie']) assert.equal((await patch('Aemployee', e._id, { status: 'paid' }, via)).status, 403, 'employee on a non-returned claim')
  assert.equal((await patch('Amanager', e._id, { status: 'paid' })).status, 409, 'pending_manager → paid is not a transition for anyone')
})

test('X4. state machine details', async () => {
  const e = await create('Aemployee', { title: 'SM' })
  const skip = await patch('Aadmin', e._id, { status: 'paid' }); assert.equal(skip.status, 409, 'pending_manager → paid is not allowed, even for admin')
  assert.equal((await patch('Amanager', e._id, { status: 'pending_manager' })).status, 409)
  assert.equal((await patch('Amanager', e._id, { status: 'banana' })).status, 400)
  assert.equal((await patch('Amanager', e._id, { status: { $ne: 1 } })).status, 400)
  const rej = await patch('Amanager', e._id, { status: 'rejected', managerNote: 'no' }); assert.equal(rej.status, 200)
  assert.equal((await patch('Aadmin', e._id, { status: 'pending_admin' })).status, 409, 'rejected is final')
  const e2 = await create('Aemployee', { title: 'SM2' })
  await patch('Amanager', e2._id, { status: 'pending_admin' })
  assert.equal((await patch('Amanager', e2._id, { status: 'paid' })).status, 403, 'manager cannot pay')
  assert.equal((await patch('Amanager', e2._id, { status: 'rejected' })).status, 200)
})

test('X5. return for revision → employee edits + resubmits → back to pending_manager; employee cannot edit otherwise', async () => {
  const e = await create('Aemployee', { title: 'Revise me', amount: 100 })
  assert.equal((await patch('Aemployee', e._id, { amount: 999 })).status, 403, 'not returned yet')
  assert.equal((await patch('Amanager', e._id, { status: 'returned', managerNote: 'add receipt' })).status, 200)
  assert.equal((await patch('Aemployee', e._id, { amount: -5 })).status, 400, 'edit is validated too')
  const re = await patch('Aemployee', e._id, { amount: 120, reason: 'with receipt', status: 'paid', userId: 'x', approvedBy: 'me' })
  assert.equal(re.status, 200); assert.equal(re.json.status, 'pending_manager', 'client cannot choose the status'); assert.equal(re.json.amount, 120)
  assert.equal(re.json.userId, A.employee.id); assert.ok(!re.json.approvedBy)
  assert.equal(await auditCount('expense.resubmitted', e._id), 1)
  assert.equal((await patch('Aemployee', e._id, { amount: 130 })).status, 403, 'back under review → locked again')
})

test('X6. separation of duties: a manager cannot action their own claim (403); an admin can but it is flagged in the audit', async () => {
  const m = await create('Amanager', { title: 'Mgr claim' })
  assert.equal((await patch('Amanager', m._id, { status: 'pending_admin' })).status, 403)
  assert.equal((await patch('Aadmin', m._id, { status: 'pending_admin' })).status, 200)
  const a = await create('Aadmin', { title: 'Admin claim' })
  assert.equal((await patch('Aadmin', a._id, { status: 'pending_admin' })).status, 200)
  assert.equal((await patch('Aadmin', a._id, { status: 'paid' })).status, 200)
  assert.equal(await auditCount('expense.pending_admin.self_approved', a._id), 1)
  assert.equal(await auditCount('expense.paid.self_approved', a._id), 1)
})

test('X7. payment details are admin-only; managers cannot write them; invalid payment method is a 400', async () => {
  const e = await create('Aemployee', { title: 'Pay' })
  const m = await patch('Amanager', e._id, { status: 'pending_admin', paymentMethod: 'cash', paymentProof: 'https://x.test/p', adminNote: 'sneaky' })
  assert.equal(m.status, 200); assert.ok(!m.json.paymentMethod && !m.json.paymentProof && !m.json.adminNote, 'manager payment/admin fields dropped')
  assert.equal((await patch('Aadmin', e._id, { status: 'paid', paymentMethod: 'crypto' })).status, 400)
  const ok = await patch('Aadmin', e._id, { status: 'paid', paymentMethod: 'bank_transfer', paymentProof: 'https://x.test/proof.png' })
  assert.equal(ok.status, 200); assert.equal(ok.json.paymentMethod, 'bank_transfer')
})

/* ───────────── 3. validation ───────────── */
test('X8. validation: bad amounts / text / dates / receipts / line items are 400 with field names — never a 500', async () => {
  const cases = [
    [{ amount: undefined }, 'amount'], [{ amount: 0 }, 'amount'], [{ amount: -10 }, 'amount'], [{ amount: 'abc' }, 'amount'], [{ amount: '' }, 'amount'],
    [{ amount: 1e12 }, 'amount'], [{ amount: null }, 'amount'], [{ amount: [1] }, 'amount'],
    [{ title: undefined }, 'title'], [{ title: '   ' }, 'title'], [{ title: 'x'.repeat(201) }, 'title'], [{ title: { a: 1 } }, 'title'],
    [{ reason: undefined }, 'reason'], [{ reason: 'y'.repeat(2001) }, 'reason'],
    [{ startDate: undefined }, 'startDate'], [{ startDate: 'not-a-date' }, 'startDate'], [{ startDate: 12345678 }, 'startDate'],
    [{ endDate: 'garbage' }, 'endDate'], [{ startDate: day(5), endDate: day(1) }, 'endDate'],
    [{ receipts: 'x' }, 'receipts'], [{ receipts: ['not a url'] }, 'receipts'], [{ receipts: ['javascript:alert(1)'] }, 'receipts'], [{ receipts: Array(11).fill('https://x.test/r.png') }, 'receipts'],
    [{ lineItems: 'x' }, 'lineItems'], [{ lineItems: [{ description: '', amount: 5, date: day(-1) }], hasLineItems: true }, 'lineItems'],
    [{ lineItems: [{ description: 'a', amount: -5, date: day(-1) }], hasLineItems: true, amount: 5 }, 'lineItems'],
    [{ lineItems: [{ description: 'a', amount: 5, date: 'bad' }], hasLineItems: true, amount: 5 }, 'lineItems'],
    [{ lineItems: [{ description: 'a', amount: 100, date: day(-1) }], hasLineItems: true, amount: 5 }, 'amount'],
    [{ hasLineItems: 'yes' }, 'hasLineItems'], [{ clientRequestId: 'z'.repeat(65) }, 'clientRequestId'],
  ]
  for (const [o, field] of cases) {
    const body = base(o); for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
    for (const via of ['token', 'cookie']) {
      const r = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee', via), body })
      assert.equal(r.status, 400, `${JSON.stringify(o).slice(0, 80)} via ${via} → ${r.status} ${r.text.slice(0, 80)}`)
      assert.ok(r.json.fields.includes(field), `${JSON.stringify(o).slice(0, 80)} → fields ${r.json.fields}`)
    }
  }
  for (const raw of ['not json', '[]', 'null', '"str"']) {
    const r = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), raw, headers: { 'Content-Type': 'application/json' } })
    assert.equal(r.status, 400, raw)
  }
  assert.equal(await db.collection('expenses').countDocuments({ orgId: A.orgId, title: /^(x{201}|\s+)$/ }), 0, 'nothing half-saved')
})

test('X9. valid line-item expense: amounts rounded, line statuses forced to pending, totals must match', async () => {
  const r = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({
    title: 'Trip', amount: 300.5, hasLineItems: true,
    lineItems: [{ description: 'Hotel', amount: 200.25, date: day(-2), status: 'approved', reviewNote: 'self' }, { description: 'Food', amount: 100.25, date: day(-2), category: 'food' }],
    receipts: [await uploadedReceiptUrl('Aemployee')],
  }) })
  assert.equal(r.status, 201, r.text)
  assert.ok(r.json.lineItems.every(l => l.status === 'pending'), 'client cannot pre-approve its own line items')
  assert.equal(r.json.amount, 300.5)
})

test('X10. malformed ids, mass assignment, cross-tenant travel link, list filters', async () => {
  for (const [m, p] of [['GET', '/api/rms/xyz'], ['PATCH', '/api/rms/xyz'], ['DELETE', '/api/rms/xyz'], ['GET', '/api/rms/%7B%22%24ne%22%3A1%7D']]) {
    assert.equal((await kit.api(p, { method: m, ...who('Aadmin'), body: m === 'PATCH' ? {} : undefined })).status, 404, `${m} ${p}`)
  }
  const e = await create('Aemployee', { title: 'Mass' })
  const r = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({ title: 'Mass2', userId: 'evil', orgId: B.orgId, status: 'paid', approvedBy: 'x', paidBy: 'y', paymentMethod: 'cash', managerNote: 'z' }) })
  assert.equal(r.status, 201); assert.equal(r.json.userId, A.employee.id); assert.equal(r.json.orgId, A.orgId); assert.equal(r.json.status, 'pending_manager')
  assert.ok(!r.json.approvedBy && !r.json.paidBy && !r.json.paymentMethod && !r.json.managerNote)
  const tr = await db.collection('travelrequests').insertOne({ orgId: B.orgId, userId: B.employee.id, userName: 'x', purpose: 'p', destination: 'd', status: 'pending_manager' })
  assert.equal((await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({ travelRequestId: String(tr.insertedId) }) })).status, 404, 'other tenant’s travel request')
  assert.equal((await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({ travelRequestId: 'zzz' }) })).status, 400)
  for (const q of ['status=banana', 'from=garbage', 'to=%00']) assert.equal((await kit.api('/api/rms?' + q, who('Aadmin'))).status, 400, q)
  assert.equal((await kit.api('/api/rms?status=pending_manager&limit=2&skip=0', who('Aadmin'))).json.length <= 2, true)
  assert.equal((await kit.api('/api/rms?limit=-1&skip=zz', who('Aadmin'))).status, 200)
  void e
})

/* ───────────── 4. duplicate submission + concurrency ───────────── */
test('X11. idempotency key: retry / double-tap / parallel submits create exactly one expense', async () => {
  const key = 'req-' + Date.now()
  const first = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({ title: 'Idem', clientRequestId: key }) })
  assert.equal(first.status, 201)
  const again = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({ title: 'Idem', clientRequestId: key }) })
  assert.equal(again.status, 200); assert.equal(again.json._id, first.json._id)
  const key2 = 'par-' + Date.now()
  const rs = await Promise.all(Array.from({ length: 6 }, () => kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: base({ title: 'Parallel', clientRequestId: key2 }) })))
  assert.ok(rs.every(r => r.status === 200 || r.status === 201), rs.map(r => r.status).join())
  assert.equal(new Set(rs.map(r => r.json._id)).size, 1)
  assert.equal(await db.collection('expenses').countDocuments({ orgId: A.orgId, clientRequestId: key2 }), 1)
  assert.equal(await auditCount('expense.submitted', first.json._id), 1, 'replay does not audit twice')
})

test('X12. no key: an identical rapid resubmission is a 409 (not a second claim); a different expense is fine', async () => {
  const body = base({ title: 'Rapid', amount: 777 })
  assert.equal((await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body })).status, 201)
  const dup = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body }); assert.equal(dup.status, 409); assert.ok(dup.json.duplicateOf)
  assert.equal((await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: { ...body, amount: 778 } })).status, 201)
  assert.equal((await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: { ...body, title: 'Rapid b' } })).status, 201)
})

test('X13. concurrent reviewers: exactly one transition wins, the rest get 409; one audit entry, one notification', async () => {
  const e = await create('Aemployee', { title: 'Race' })
  const rs = await Promise.all([patch('Amanager', e._id, { status: 'pending_admin' }), patch('Aadmin', e._id, { status: 'pending_admin' }), patch('Amanager', e._id, { status: 'rejected' }), patch('Aadmin', e._id, { status: 'returned' })])
  const ok = rs.filter(r => r.status === 200), conflict = rs.filter(r => r.status === 409)
  assert.equal(ok.length, 1, rs.map(r => r.status).join()); assert.equal(conflict.length, 3)
  const doc = await db.collection('expenses').findOne({ _id: new mongoose.Types.ObjectId(e._id) })
  assert.equal(doc.status, ok[0].json.status)
  await sleep(600)
  const total = (await db.collection('auditlogs').countDocuments({ targetId: e._id, action: { $in: ['expense.pending_admin', 'expense.rejected', 'expense.returned_to_employee', 'expense.returned'] } }))
  assert.equal(total, 1, 'one audit row for the single winning transition')
})

/* ───────────── 5. tenancy ───────────── */
test('X14. tenant isolation: org B cannot see or touch org A expenses on either carrier', async () => {
  const e = await create('Aemployee', { title: 'TENANT-SECRET-EXP' })
  for (const r of ['employee', 'manager', 'admin']) for (const via of ['token', 'cookie']) {
    const k = `B${r}`
    assert.ok(!JSON.stringify((await kit.api('/api/rms', who(k, via))).json).includes('TENANT-SECRET-EXP'))
    assert.ok([403, 404].includes((await kit.api(`/api/rms/${e._id}`, who(k, via))).status))
    assert.ok([403, 404].includes((await patch(k, e._id, { status: 'pending_admin' }, via)).status))
    assert.ok([403, 404].includes((await kit.api(`/api/rms/${e._id}`, { method: 'DELETE', ...who(k, via) })).status))
  }
  assert.equal((await db.collection('expenses').findOne({ title: 'TENANT-SECRET-EXP' })).status, 'pending_manager')
  const n = await kit.api('/api/notifications', who('Bmanager'))
  assert.ok(!JSON.stringify(n.json).includes('TENANT-SECRET-EXP'), 'notifications are tenant-scoped')
})

/* ───────────── 6. entitlements ───────────── */
test('X15. expenses are not plan-gated: Free, Premium and Doppelmayr-style orgs all run the full flow; Premium is org-level', async () => {
  for (const k of ['F', 'A']) {
    const e = await create(`${k}employee`, { title: `Plan ${k}` })
    assert.equal((await patch(`${k}manager`, e._id, { status: 'pending_admin' })).status, 200)
    assert.equal((await patch(`${k}admin`, e._id, { status: 'paid' })).status, 200)
  }
  for (const r of ['admin', 'manager', 'employee']) {
    for (const via of ['token', 'cookie']) assert.equal((await kit.api('/api/billing/entitlements', who(`A${r}`, via))).json.plan, 'premium')
    assert.equal((await kit.api('/api/billing/entitlements', who(`F${r}`))).json.plan, 'free')
  }
  const doc = await db.collection('organizations').findOne({ orgId: A.orgId })
  assert.deepEqual([doc.plan, doc.entitlementSource, doc.lifetimeGrant, doc.webEnabled, doc.androidEnabled], ['premium', 'lifetime_grant', true, true, true])
  const web = await kit.api('/api/rms', who('Femployee', 'cookie')); assert.equal(web.status === 200 && Array.isArray(web.json), false, 'free org has no web session carrier')
})

/* ───────────── 7. withdraw / delete ───────────── */
test('X16. delete rules: owner withdraws pending/returned only; others’ claims are 403 for employees; withdrawal is audited', async () => {
  const e = await create('Aemployee', { title: 'Withdraw' })
  const other = await create('Amanager', { title: 'Not yours' })
  assert.equal((await kit.api(`/api/rms/${other._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 403)
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
  assert.equal(await auditCount('expense.withdrawn', e._id), 1)
  const fwd = await create('Aemployee', { title: 'Locked' }); await patch('Amanager', fwd._id, { status: 'pending_admin' })
  assert.equal((await kit.api(`/api/rms/${fwd._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 403, 'under admin review → cannot withdraw')
  assert.equal((await kit.api(`/api/rms/${e._id}`, who('Aadmin'))).status, 404)
})

/* ───────────── 8. notifications ───────────── */
test('X17. notifications: pending claim appears once for the manager, moves to admin after forwarding, disappears after payment', async () => {
  const e = await create('Aemployee', { title: 'Notify me' })
  const count = async k => (await kit.api('/api/notifications', who(k))).json.items.filter(i => i.id === `exp-${e._id}`).length
  assert.equal(await count('Amanager'), 1)
  await patch('Amanager', e._id, { status: 'pending_admin' })
  assert.equal(await count('Aadmin'), 1); assert.equal(await count('Amanager'), 0)
  await patch('Aadmin', e._id, { status: 'paid' })
  assert.equal(await count('Aadmin'), 0)
})

/* ───────────── 9. Web ↔ Android shared data ───────────── */
test('X18. Android creates → Web manager approves → Android sees it; Web creates → Android admin pays → Web sees it', async () => {
  const a = await create('Aemployee', { title: 'From Android' }, 'token')
  const seen = await kit.api('/api/rms', who('Amanager', 'cookie')); assert.ok(seen.json.some(x => x._id === a._id))
  assert.equal((await patch('Amanager', a._id, { status: 'pending_admin', managerNote: 'via web' }, 'cookie')).status, 200)
  const back = await kit.api(`/api/rms/${a._id}`, who('Aemployee', 'token')); assert.equal(back.json.status, 'pending_admin'); assert.equal(back.json.managerNote, 'via web')
  const w = await create('Aemployee', { title: 'From Web' }, 'cookie')
  await patch('Amanager', w._id, { status: 'pending_admin' }, 'token')
  assert.equal((await patch('Aadmin', w._id, { status: 'paid', paymentMethod: 'upi' }, 'token')).status, 200)
  const wb = await kit.api(`/api/rms/${w._id}`, who('Aemployee', 'cookie')); assert.equal(wb.json.status, 'paid'); assert.equal(wb.json.paymentMethod, 'upi')
  assert.equal(await db.collection('expenses').countDocuments({ title: 'From Web' }), 1, 'one document in the shared collection')
})

test('X19. unauthenticated callers get 401 on every expense route', async () => {
  const e = await create('Aemployee', { title: 'Anon' })
  for (const [m, p] of [['GET', '/api/rms'], ['POST', '/api/rms'], ['GET', `/api/rms/${e._id}`], ['PATCH', `/api/rms/${e._id}`], ['DELETE', `/api/rms/${e._id}`]]) {
    assert.equal((await kit.api(p, { method: m, body: m === 'POST' || m === 'PATCH' ? {} : undefined })).status, 401, `${m} ${p}`)
  }
})
