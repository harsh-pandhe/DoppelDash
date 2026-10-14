/**
 * P0-02 — account / organisation deletion integrity: inventory completeness, truthful status, retry after partial failure, tenant isolation.
 * The REAL route handler runs in-process against the throw-away MongoDB; the private-file provider is the LOCAL FAKE (proves our orchestration,
 * not Cloudinary's behaviour). WHICH data should be deleted vs retained is an owner/legal decision (D-02) — see docs/ACCOUNT_DELETION_POLICY.md.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const mongoose = require('mongoose')
const { NextRequest } = require('next/server')
const fake = require('./helpers/fakeProviders')
Object.assign(process.env, fake.ENV)
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dd_gate_del_test'
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(24).toString('hex')
const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, { alias: { '@': path.resolve(__dirname, '..') } })
const M = n => jiti(path.resolve(__dirname, `../models/${n}.ts`)).default
const User = M('User'), Organization = M('Organization'), AuditLog = M('AuditLog'), Expense = M('Expense'), RevokedToken = M('RevokedToken')
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'))
const { DELETE } = jiti(path.resolve(__dirname, '../app/api/user/account/route.ts'))
const col = n => mongoose.connection.db.collection(n)

// every collection that holds tenant data, with the minimal document that identifies the tenant
const TENANT = ['expenses', 'travelrequests', 'leaves', 'leavebalances', 'contacts', 'scannedcards', 'campaignlogs', 'announcements', 'publicholidays', 'shareddashboards', 'invitations', 'inboxmessages', 'orgmailconfigs', 'outlooktokens', 'syncstates', 'usagecounters', 'subscriptions', 'orgsettings', 'receiptuploads']
let providers
test.before(async () => { providers = await fake.ensureFakeProviders(); if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI) })
test.after(async () => { for (const c of TENANT) await col(c).deleteMany({ orgId: /^org_delint_/ }); await col('auditlogs').deleteMany({ orgId: /^org_delint_/ }); await mongoose.disconnect(); await providers.stop() })
test.beforeEach(async () => { await fake.control.reset() })

async function tenant({ lifetime = false, members = 0 } = {}) {
  const orgId = `org_delint_${crypto.randomBytes(5).toString('hex')}`
  const owner = await User.create({ email: `${orgId}-o@example.com`, passwordHash: 'x', firstName: 'Own', lastName: 'Er', role: 'admin', orgId, isActive: true })
  await Organization.create({ orgId, name: 'T ' + orgId, slug: orgId.replace(/_/g, '-'), ownerId: String(owner._id), lifetimeGrant: lifetime })
  const staff = []; for (let i = 0; i < members; i++) staff.push(await User.create({ email: `${orgId}-m${i}@example.com`, passwordHash: 'x', firstName: 'Mem', lastName: 'Ber', role: 'employee', orgId, isActive: true }))
  return { orgId, owner, staff, ownerToken: await signToken(owner.toPublic()) }
}
async function seed(t, withBlob = true) {
  const uid = String(t.owner._id); const pid = `doppeldash/${t.orgId}/receipts/${crypto.randomBytes(8).toString('hex')}`
  const base = () => ({ orgId: t.orgId, userId: uid, createdBy: uid, ownerId: uid, createdAt: new Date(), updatedAt: new Date(), token: crypto.randomBytes(8).toString('hex'), tokenHash: crypto.randomBytes(8).toString('hex'), key: crypto.randomBytes(8).toString('hex'), mailbox: crypto.randomBytes(4).toString('hex'), uid: Math.floor(Math.random() * 1e9), period: crypto.randomBytes(4).toString('hex'), feature: crypto.randomBytes(4).toString('hex'), type: crypto.randomBytes(4).toString('hex'), email: crypto.randomBytes(4).toString('hex') + '@x.test', slug: crypto.randomBytes(4).toString('hex'), code: crypto.randomBytes(4).toString('hex'), name: 'n' + crypto.randomBytes(4).toString('hex') })
  for (const c of TENANT) await col(c).insertOne({ ...base(), ...(c === 'receiptuploads' ? { publicId: pid, state: 'attached', issuedAt: new Date(), nextCheckAt: new Date(), purpose: 'travel_itinerary' } : {}), ...(c === 'subscriptions' ? { purchaseToken: 'tok_' + crypto.randomBytes(6).toString('hex') } : {}), ...(c === 'invitations' ? { token: crypto.randomBytes(6).toString('hex') } : {}) })
  if (withBlob) await fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid, bytes: 400, ext: 'png', type: 'authenticated' }) })
  return pid
}
const counts = async orgId => Object.fromEntries(await Promise.all(TENANT.map(async c => [c, await col(c).countDocuments({ orgId })])))
const del = token => DELETE(new NextRequest('http://localhost:3000/api/user/account', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }))
const files = async () => (await fake.control.state()).files

test('I1. sole-owner disband leaves NOTHING behind in any tenant collection or in private storage, and never touches another tenant', async () => {
  const a = await tenant(), b = await tenant(); const pidA = await seed(a), pidB = await seed(b)
  const beforeB = await counts(b.orgId); assert.ok(Object.values(beforeB).every(n => n >= 1), 'fixture covers every collection')
  assert.ok((await files()).some(f => f.startsWith(pidA)))
  const res = await del(a.ownerToken); assert.equal(res.status, 200, await res.clone().text())
  assert.deepEqual(Object.values(await counts(a.orgId)).reduce((x, y) => x + y, 0), 0, JSON.stringify(await counts(a.orgId)))
  assert.equal(await Organization.countDocuments({ orgId: a.orgId }), 0); assert.equal(await User.countDocuments({ orgId: a.orgId }), 0)
  assert.ok(!(await files()).some(f => f.startsWith(pidA)), 'the private file is gone from the provider'); assert.ok((await files()).some(f => f.startsWith(pidB)), 'the other tenant\'s file is untouched')
  assert.deepEqual(await counts(b.orgId), beforeB); assert.equal(await Organization.countDocuments({ orgId: b.orgId }), 1)
  assert.equal(await AuditLog.countDocuments({ orgId: a.orgId, action: 'user.account_deleted' }), 1)
})

test('I2. provider outage ⇒ truthful failure: HTTP 500 deletion_incomplete, NOTHING reported deleted, account and data intact, still signed in; retry after recovery completes (idempotent)', async () => {
  const t = await tenant(); const pid = await seed(t)
  await fake.control.mode({ storage: { destroy: 'error500' } })
  const res = await del(t.ownerToken); const body = await res.json(); assert.equal(res.status, 500); assert.equal(body.code, 'deletion_incomplete'); assert.equal(body.retry, true); assert.doesNotMatch(JSON.stringify(body), /success|permanently deleted|mongo|cloud|doppeldash\//i)
  assert.equal(await User.countDocuments({ _id: t.owner._id }), 1); assert.equal(await Organization.countDocuments({ orgId: t.orgId }), 1)
  assert.equal((await counts(t.orgId)).receiptuploads, 1, 'the manifest row is kept until the provider confirmed deletion'); assert.equal((await counts(t.orgId)).expenses, 1, 'later groups did not run')
  assert.equal(await RevokedToken.countDocuments({ tokenIdentifier: crypto.createHash('sha256').update(t.ownerToken).digest('hex') }), 0, 'the session was not revoked'); assert.equal(await AuditLog.countDocuments({ orgId: t.orgId, action: 'user.account_deleted' }), 0); assert.equal(await AuditLog.countDocuments({ orgId: t.orgId, action: 'user.account_deletion_incomplete' }), 1)
  assert.ok((await files()).some(f => f.startsWith(pid)))
  await fake.control.mode({ storage: { destroy: 'ok' } })
  const ok = await del(t.ownerToken); assert.equal(ok.status, 200, await ok.clone().text()); assert.equal(Object.values(await counts(t.orgId)).reduce((x, y) => x + y, 0), 0); assert.ok(!(await files()).some(f => f.startsWith(pid)))
  assert.equal((await del(t.ownerToken)).status, 401, 'a repeat after completion is refused, never a false success')
})

test('I3. a database step that fails midway stops the later groups, keeps the account usable, and a retry finishes the job', async () => {
  const t = await tenant(); await seed(t); const orig = Expense.deleteMany
  Expense.deleteMany = async () => { throw new Error('simulated failure') }
  try { const res = await del(t.ownerToken); const b = await res.json(); assert.equal(res.status, 500); assert.equal(b.code, 'deletion_incomplete') } finally { Expense.deleteMany = orig }
  assert.equal(await Organization.countDocuments({ orgId: t.orgId }), 1, 'the organisation is deleted only after every data step succeeded'); assert.equal(await User.countDocuments({ _id: t.owner._id }), 1)
  const ok = await del(t.ownerToken); assert.equal(ok.status, 200); assert.equal(Object.values(await counts(t.orgId)).reduce((x, y) => x + y, 0), 0)
})

test('I4. a member\'s self-deletion removes their credentials and personal data, keeps the organisation and every colleague\'s data, and invalidates the token', async () => {
  const t = await tenant({ members: 1 }); const m = t.staff[0], mid = String(m._id); await seed(t)
  for (const [c, doc] of [['outlooktokens', { orgId: t.orgId, userId: mid }], ['maildrafts', { orgId: t.orgId, ownerId: mid }], ['refreshtokens', { userId: mid }], ['useremailconfigs', { userId: mid, orgId: t.orgId }], ['passkeycredentials', { userId: mid, orgId: t.orgId }]]) await col(c).insertOne({ ...doc, createdAt: new Date() })
  const before = await counts(t.orgId); const token = await signToken(m.toPublic()); const res = await del(token); assert.equal(res.status, 200, await res.clone().text())
  assert.equal(await User.countDocuments({ _id: m._id }), 0); for (const c of ['maildrafts', 'refreshtokens', 'useremailconfigs', 'passkeycredentials']) assert.equal(await col(c).countDocuments({ [c === 'maildrafts' ? 'ownerId' : 'userId']: mid }), 0, c)
  assert.equal(await col('outlooktokens').countDocuments({ orgId: t.orgId, userId: mid }), 0)
  const after = await counts(t.orgId); assert.equal(after.expenses, before.expenses); assert.equal(after.receiptuploads, before.receiptuploads, 'organisation records are retained on a member\'s deletion (policy D-02)')
  assert.equal(await Organization.countDocuments({ orgId: t.orgId }), 1); assert.equal((await del(token)).status, 401)
})

test('I5. the owner of a lifetime-granted organisation never disbands it; an owner with other members is refused without any change', async () => {
  const L = await tenant({ lifetime: true }); await seed(L); const before = await counts(L.orgId)
  const res = await del(L.ownerToken); assert.equal(res.status, 200); const personal = ['leavebalances', 'outlooktokens']; const now = await counts(L.orgId); for (const c of TENANT.filter(c => !personal.includes(c))) assert.equal(now[c], before[c], `${c}: tenant data of a protected organisation is not purged`); for (const c of personal) assert.equal(now[c], 0, `${c}: the owner's own personal rows are removed`); assert.equal(await Organization.countDocuments({ orgId: L.orgId }), 1)
  const B = await tenant({ members: 2 }); await seed(B); const b4 = await counts(B.orgId); const r2 = await del(B.ownerToken); assert.equal(r2.status, 400); assert.deepEqual(await counts(B.orgId), b4); assert.equal(await User.countDocuments({ _id: B.owner._id }), 1)
})
