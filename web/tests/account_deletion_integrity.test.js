/**
 * P0-02 — account / organisation deletion integrity: inventory completeness, truthful status, retry after partial failure, tenant isolation.
 * Updated for the owner decisions of 2026-10-25: deletion is a 14-day soft delete (D-02.8); a disband keeps claims/leave/travel (+ their private files)
 * until retention ends (D-03.4/D-03.3); the purge runs from lib/account/lifecycle.ts (the retention job), not inline.
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
const { runRetentionPurge } = jiti(path.resolve(__dirname, '../lib/account/lifecycle.ts'))
const Contact = M('Contact')
const col = n => mongoose.connection.db.collection(n)

// every collection that holds tenant data, with the minimal document that identifies the tenant
const TENANT = ['expenses', 'travelrequests', 'leaves', 'leavebalances', 'contacts', 'scannedcards', 'campaignlogs', 'announcements', 'publicholidays', 'shareddashboards', 'invitations', 'inboxmessages', 'orgmailconfigs', 'outlooktokens', 'syncstates', 'usagecounters', 'subscriptions', 'orgsettings', 'receiptuploads']
let providers
const createdUsers = []
test.before(async () => { providers = await fake.ensureFakeProviders(); if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI) })
test.after(async () => { for (const c of TENANT) await col(c).deleteMany({ orgId: /^org_delint_/ }); await col('auditlogs').deleteMany({ orgId: /^org_delint_/ }); await col('organizations').deleteMany({ orgId: /^org_delint_/ }); await col('users').deleteMany({ orgId: /^org_delint_/ }); for (const c of ['maildrafts', 'outlooktokens', 'useremailconfigs', 'passkeycredentials']) await col(c).deleteMany({ orgId: /^org_delint_/ }); await col('refreshtokens').deleteMany({ userId: { $in: createdUsers } }); await mongoose.disconnect(); await providers.stop() })
test.beforeEach(async () => { await fake.control.reset() })

async function tenant({ lifetime = false, members = 0 } = {}) {
  const orgId = `org_delint_${crypto.randomBytes(5).toString('hex')}`
  const owner = await User.create({ email: `${orgId}-o@example.com`, passwordHash: 'x', firstName: 'Own', lastName: 'Er', role: 'admin', orgId, isActive: true })
  await Organization.create({ orgId, name: 'T ' + orgId, slug: orgId.replace(/_/g, '-'), ownerId: String(owner._id), lifetimeGrant: lifetime })
  createdUsers.push(String(owner._id))
  const staff = []; for (let i = 0; i < members; i++) staff.push(await User.create({ email: `${orgId}-m${i}@example.com`, passwordHash: 'x', firstName: 'Mem', lastName: 'Ber', role: 'employee', orgId, isActive: true })); for (const m of staff) createdUsers.push(String(m._id))
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

// collections that hold financial/HR records and their private files: kept after a disband until the retention period ends (D-03.3 / D-03.4)
const RETAINED = ['expenses', 'travelrequests', 'leaves', 'subscriptions', 'receiptuploads']
const backdate = uid => User.updateOne({ _id: uid }, { $set: { deletionRequestedAt: new Date(Date.now() - 15 * 864e5), deletionScheduledFor: new Date(Date.now() - 864e5) } })
const purge = () => runRetentionPurge({ apply: true })
const old = new Date(Date.now() - 9 * 365 * 864e5)
const expire = orgId => Promise.all([
  col('expenses').updateMany({ orgId }, { $set: { paidAt: old, createdAt: old } }), col('leaves').updateMany({ orgId }, { $set: { endDate: old } }), col('travelrequests').updateMany({ orgId }, { $set: { createdAt: old } }),
])

test('I1. sole-owner disband: nothing is purged inside the grace window; afterwards every NON-financial tenant collection is empty, financial/HR records and their private files are retained, and another tenant is never touched', async () => {
  const a = await tenant(), b = await tenant(); const pidA = await seed(a), pidB = await seed(b)
  const beforeA = await counts(a.orgId), beforeB = await counts(b.orgId); assert.ok(Object.values(beforeB).every(n => n >= 1), 'fixture covers every collection')
  const res = await del(a.ownerToken); assert.equal(res.status, 200, await res.clone().text()); assert.equal((await res.json()).scheduled, true)
  assert.deepEqual(await counts(a.orgId), beforeA, 'nothing is purged during the grace window'); assert.ok((await Organization.findOne({ orgId: a.orgId })).disbandRequestedAt)
  await backdate(a.owner._id); const rep = await purge(); assert.equal(rep.deletionsFailed, 0)
  const now = await counts(a.orgId)
  for (const c of TENANT) assert.equal(now[c], RETAINED.includes(c) ? beforeA[c] : 0, `${c}: ${RETAINED.includes(c) ? 'retained' : 'purged'}`)
  const org = await Organization.findOne({ orgId: a.orgId }); assert.ok(org, 'the organisation shell is kept while records are retained'); assert.ok(org.disbandedAt && org.retentionHoldUntil); assert.equal(org.ownerId, undefined)
  assert.equal(await User.countDocuments({ orgId: a.orgId }), 0)
  assert.ok((await files()).some(f => f.startsWith(pidA)), 'the claim’s private file is retained with it'); assert.ok((await files()).some(f => f.startsWith(pidB)), 'the other tenant\'s file is untouched')
  assert.deepEqual(await counts(b.orgId), beforeB); assert.equal(await Organization.countDocuments({ orgId: b.orgId }), 1)
  assert.equal(await AuditLog.countDocuments({ orgId: a.orgId, action: 'user.account_deleted' }), 1)
  // retention ends → records, files and finally the empty shell are removed
  await expire(a.orgId); await purge()
  assert.deepEqual(Object.values(await counts(a.orgId)).reduce((x, y) => x + y, 0), 0, JSON.stringify(await counts(a.orgId)))
  assert.equal(await Organization.countDocuments({ orgId: a.orgId }), 0); assert.ok(!(await files()).some(f => f.startsWith(pidA)), 'the private file is gone from the provider')
  assert.ok((await files()).some(f => f.startsWith(pidB)))
})

test('I2. provider outage while the retention period ends ⇒ the shell and the file manifest are KEPT (nothing falsely reported gone); a retry after recovery completes (idempotent)', async () => {
  const t = await tenant(); const pid = await seed(t)
  assert.equal((await del(t.ownerToken)).status, 200); await backdate(t.owner._id); await purge()
  await expire(t.orgId); await fake.control.mode({ storage: { destroy: 'error500' } })
  const down = await purge(); assert.equal(down.orgShellsRemoved, 0)
  assert.equal(await Organization.countDocuments({ orgId: t.orgId }), 1, 'the shell stays until every private file is confirmed deleted'); assert.equal((await counts(t.orgId)).receiptuploads, 1, 'the manifest row is kept until the provider confirmed deletion')
  assert.ok((await files()).some(f => f.startsWith(pid)))
  await fake.control.mode({ storage: { destroy: 'ok' } })
  const up = await purge(); assert.equal(up.orgShellsRemoved >= 1, true); assert.equal(await Organization.countDocuments({ orgId: t.orgId }), 0); assert.equal((await counts(t.orgId)).receiptuploads, 0); assert.ok(!(await files()).some(f => f.startsWith(pid)))
  const again = await purge(); assert.equal(again.orgShellsRemoved >= 0, true, 'a repeat run is harmless')
})

test('I3. a database step that fails midway is reported truthfully (deletionsFailed, audited), leaves the account deactivated but intact and the tenant un-disbanded, and a retry finishes the job', async () => {
  const t = await tenant(); await seed(t); const orig = Contact.deleteMany
  assert.equal((await del(t.ownerToken)).status, 200); await backdate(t.owner._id)
  Contact.deleteMany = async () => { throw new Error('simulated failure') }
  let rep; try { rep = await purge() } finally { Contact.deleteMany = orig }
  assert.ok(rep.deletionsFailed >= 1); assert.equal(rep.deletionsExecuted, 0)
  assert.equal(await User.countDocuments({ _id: t.owner._id }), 1, 'the user is only deleted after every data step succeeded'); assert.equal((await Organization.findOne({ orgId: t.orgId })).disbandedAt, undefined, 'not marked disbanded')
  assert.ok(await AuditLog.findOne({ orgId: t.orgId, action: 'user.account_deletion_incomplete' }), 'the failure is audited'); assert.equal(await AuditLog.countDocuments({ orgId: t.orgId, action: 'user.account_deleted' }), 0)
  const ok = await purge(); assert.equal(ok.deletionsFailed, 0); assert.equal(await User.countDocuments({ _id: t.owner._id }), 0); assert.ok((await Organization.findOne({ orgId: t.orgId })).disbandedAt)
  assert.equal((await counts(t.orgId)).contacts, 0)
})

test('I4. a member\'s deletion revokes the session at once, removes credentials and personal data after the grace window, keeps the organisation and every colleague\'s data, and the token stays dead', async () => {
  const t = await tenant({ members: 1 }); const m = t.staff[0], mid = String(m._id); await seed(t)
  for (const [c, doc] of [['outlooktokens', { orgId: t.orgId, userId: mid }], ['maildrafts', { orgId: t.orgId, ownerId: mid }], ['refreshtokens', { userId: mid }], ['useremailconfigs', { userId: mid, orgId: t.orgId }], ['passkeycredentials', { userId: mid, orgId: t.orgId }]]) await col(c).insertOne({ ...doc, createdAt: new Date(), updatedAt: new Date() })
  const before = await counts(t.orgId); const token = await signToken(m.toPublic()); const res = await del(token); assert.equal(res.status, 200, await res.clone().text())
  assert.equal(await col('refreshtokens').countDocuments({ userId: mid }), 0, 'sessions are revoked immediately'); assert.equal(await col('outlooktokens').countDocuments({ orgId: t.orgId, userId: mid }), 1, 'personal data waits for the purge')
  assert.equal((await del(token)).status, 401, 'the token is dead as soon as the deletion is requested')
  await backdate(m._id); await purge()
  assert.equal(await User.countDocuments({ _id: m._id }), 0); for (const c of ['maildrafts', 'refreshtokens', 'useremailconfigs', 'passkeycredentials']) assert.equal(await col(c).countDocuments({ [c === 'maildrafts' ? 'ownerId' : 'userId']: mid }), 0, c)
  assert.equal(await col('outlooktokens').countDocuments({ orgId: t.orgId, userId: mid }), 0)
  const after = await counts(t.orgId); assert.equal(after.expenses, before.expenses); assert.equal(after.receiptuploads, before.receiptuploads, 'organisation records are retained on a member\'s deletion (policy D-02)')
  assert.equal(await Organization.countDocuments({ orgId: t.orgId }), 1); assert.equal((await del(token)).status, 401)
})

test('I5. the owner of a lifetime-granted organisation never disbands it (tenant data survives the purge); an owner with other members is refused without any change', async () => {
  const L = await tenant({ lifetime: true }); await seed(L); const before = await counts(L.orgId)
  const res = await del(L.ownerToken); assert.equal(res.status, 200); assert.equal((await Organization.findOne({ orgId: L.orgId })).disbandRequestedAt, undefined, 'a protected organisation is never flagged for disband')
  await backdate(L.owner._id); await purge()
  const personal = ['leavebalances', 'outlooktokens']; const now = await counts(L.orgId)
  for (const c of TENANT.filter(c => !personal.includes(c))) assert.equal(now[c], before[c], `${c}: tenant data of a protected organisation is not purged`)
  for (const c of personal) assert.equal(await col(c).countDocuments({ orgId: L.orgId, userId: String(L.owner._id) }), 0, `${c}: the owner's personal rows are purged`)
  assert.equal(await Organization.countDocuments({ orgId: L.orgId }), 1)
  const B = await tenant({ members: 2 }); await seed(B); const b4 = await counts(B.orgId); const r2 = await del(B.ownerToken); assert.equal(r2.status, 400); assert.equal((await r2.json()).code, 'owner_must_transfer'); assert.deepEqual(await counts(B.orgId), b4); assert.equal(await User.countDocuments({ _id: B.owner._id }), 1)
  assert.equal((await User.findById(B.owner._id)).isActive, true, 'a refused request changes nothing')
})
