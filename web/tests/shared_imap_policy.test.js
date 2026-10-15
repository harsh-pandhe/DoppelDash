/**
 * Shared platform IMAP mailbox (Phase 5B): the mailbox in the environment belongs to ONE organisation (IMAP_OWNER_ORG_ID). Before this, any
 * tenant could trigger a sync (resource abuse) and `sync/email` matched the operator's mail against THEIR contacts' timelines (cross-tenant leak);
 * synced rows were stored without an organisation. Fail closed. Also: remaining matrix gaps (cron wrong methods, org-settings PUT, scanned-card list).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, B, tok
test.before(async () => {
  db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'free' })
  tok = {}; for (const [k, o] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) tok[k + r] = (await kit.login(o[r].email)).accessToken
})
test.after(async () => { await db.collection('scannedcards').deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await kit.cleanupAll(db); await kit.disconnect() })
const call = (m, p, t, body) => kit.api(p, { method: m, token: t ? tok[t] : undefined, body })

test('M1. unit: the shared mailbox is usable only by the configured owner organisation; unset = nobody', () => {
  const { canUseSharedImap, imapOwnerOrgId } = kit.load('lib/imap.ts')
  assert.equal(imapOwnerOrgId({}), null); assert.equal(canUseSharedImap('org_a', {}), false); assert.equal(canUseSharedImap(null, { IMAP_OWNER_ORG_ID: 'org_a' }), false)
  assert.equal(canUseSharedImap('org_a', { IMAP_OWNER_ORG_ID: 'org_a' }), true); assert.equal(canUseSharedImap('org_b', { IMAP_OWNER_ORG_ID: 'org_a' }), false); assert.equal(canUseSharedImap('org_a', { IMAP_OWNER_ORG_ID: '  ' }), false)
})

test('M2. sync/email: anonymous 401, employee 403, managers/admins of a non-owner organisation 403 `imap_not_available` (also with IMAP unconfigured) — and nothing is written; GET reports "not configured" without data', async () => {
  const before = await db.collection('syncstates').countDocuments({})
  await Promise.all([['POST', '/api/sync/email', null, 401], ['POST', '/api/sync/email', 'Aemployee', 403], ['POST', '/api/sync/email', 'Amanager', 403], ['POST', '/api/sync/email', 'Aadmin', 403], ['POST', '/api/sync/email', 'Badmin', 403], ['GET', '/api/sync/email', null, 401]].map(async ([m, p, t, st]) => { const r = await call(m, p, t); assert.equal(r.status, st, `${t} ${m} → ${r.status} ${r.text}`) }))
  const r = await call('POST', '/api/sync/email', 'Badmin'); assert.equal(r.json.code, 'imap_not_available')
  const g = await call('GET', '/api/sync/email', 'Badmin'); assert.equal(g.status, 200); assert.deepEqual(g.json, { configured: false, lastSyncedAt: null })
  assert.equal(await db.collection('syncstates').countDocuments({}), before, 'no sync state was created by a refused request')
})

test('M3. inbox?sync=1 never reaches IMAP for a non-owner organisation and reports configured:false; tenants only ever list their own messages', async () => {
  await db.collection('inboxmessages').insertMany([{ orgId: A.orgId, mailbox: 'INBOX', uid: 9001, subject: 'A-only subject', fromAddress: 'x@y.test', date: new Date(), readByApp: false }, { orgId: B.orgId, mailbox: 'INBOX', uid: 9002, subject: 'B-only subject', fromAddress: 'x@y.test', date: new Date(), readByApp: false }])
  const a = await call('GET', '/api/inbox?sync=1', 'Amanager'); assert.equal(a.status, 200, a.text); assert.equal(a.json.configured, false); assert.equal(a.json.sync, null)
  assert.match(a.text, /A-only subject/); assert.doesNotMatch(a.text, /B-only subject/)
  const b = await call('GET', '/api/inbox?sync=1', 'Badmin'); assert.doesNotMatch(b.text, /A-only subject/); assert.match(b.text, /B-only subject/)
  await db.collection('inboxmessages').deleteMany({ uid: { $in: [9001, 9002] } })
})

test('M4. receipts-cleanup cron: PUT/PATCH/DELETE/GET are 405 with Allow: POST and do nothing (no auth bypass through the method)', async () => {
  for (const m of ['PUT', 'PATCH', 'DELETE', 'GET']) { const r = await kit.api('/api/cron/receipts-cleanup', { method: m, headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }); assert.equal(r.status, 405, m); assert.match(r.headers.get('allow') || '', /POST/) }
})

test('M5. org/settings PUT behaves like PATCH: admin only, mass-assignment of plan/entitlements ignored; employees 403; anonymous 401', async () => {
  assert.equal((await call('PUT', '/api/org/settings', null, { name: 'x' })).status, 401)
  assert.equal((await call('PUT', '/api/org/settings', 'Aemployee', { name: 'x' })).status, 403)
  const before = await db.collection('organizations').findOne({ orgId: B.orgId })
  const r = await call('PUT', '/api/org/settings', 'Badmin', { name: 'Renamed B', plan: 'premium', lifetimeGrant: true, webEnabled: true, entitlementSource: 'lifetime_grant', orgId: A.orgId }); assert.ok([200, 400].includes(r.status), r.text)
  const after = await db.collection('organizations').findOne({ orgId: B.orgId })
  assert.deepEqual([after.plan, after.lifetimeGrant, after.webEnabled, after.entitlementSource], [before.plan, before.lifetimeGrant, before.webEnabled, before.entitlementSource], 'entitlements cannot be written through settings')
  assert.equal(await db.collection('organizations').countDocuments({ orgId: A.orgId, name: 'Renamed B' }), 0)
})

test('M6. crm/scanned-cards list: a user sees only their own cards, never a colleague’s or another tenant’s', async () => {
  const now = new Date()
  await db.collection('scannedcards').insertMany([{ orgId: A.orgId, uploadedBy: A.employee.id, imageUrl: 'mine', status: 'pending', createdAt: now, updatedAt: now }, { orgId: A.orgId, uploadedBy: A.manager.id, imageUrl: 'colleague', status: 'pending', createdAt: now, updatedAt: now }, { orgId: B.orgId, uploadedBy: B.employee.id, imageUrl: 'other-tenant', status: 'pending', createdAt: now, updatedAt: now }])
  const r = await call('GET', '/api/crm/scanned-cards', 'Aemployee'); assert.equal(r.status, 200); assert.match(r.text, /mine/); assert.doesNotMatch(r.text, /colleague|other-tenant/)
  assert.equal((await call('GET', '/api/crm/scanned-cards', null)).status, 401)
})
