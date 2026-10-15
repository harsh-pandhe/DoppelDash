/**
 * Legacy medical-document inventory (Phase 5F): read-only, redacted, classifies every document, detects duplicates / orphans / manifest problems,
 * and the CLI refuses non-disposable databases without an explicit approval gate. SYNTHETIC fixtures only, throwaway DB — never production data.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const lib = () => kit.load('lib/migration/legacyMedicalInventory.ts')

let db, A, B
const colls = ['leaves', 'receiptuploads']
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'free' }); B = await kit.createOrg({ plan: 'free' }) })
test.after(async () => { for (const c of colls) await db.collection(c).deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await kit.cleanupAll(db); await kit.disconnect() })

const SECRET_FILE = 'name-of-patient-ZQ99'
const pub = (org, ext = 'jpg', n = 'a') => `https://res.cloudinary.com/democloud/image/upload/v1/doppeldash/${org}/documents/${SECRET_FILE}-${n}.${ext}`
const leave = (orgId, docs, o = {}) => ({ orgId, userId: 'u1', userName: 'U', type: 'sick', startDate: new Date(), endDate: new Date(), days: 3, reason: 'r', status: 'approved', medicalDocs: docs, createdAt: new Date(), updatedAt: new Date(), ...o })

test('I1. classification: private refs, public / authenticated Cloudinary URLs, external hosts, proxy paths, junk, unsupported extensions, foreign folders', () => {
  const { classify } = lib(); const o = 'org_x'
  const c = v => classify(v, o)
  assert.equal(c('cld:doppeldash/org_x/receipts/abcdefgh12.png').cls, 'private_ref')
  assert.equal(c('cld:doppeldash/org_OTHER/receipts/abcdefgh12.png').cls, 'unknown', 'a ref of another tenant is not ours')
  assert.deepEqual([c(pub(o)).cls, c(pub(o)).inOrgFolder, c(pub(o)).extSupported], ['legacy_public_url', true, true])
  assert.equal(c(pub('org_other')).inOrgFolder, false)
  assert.equal(c(pub(o, 'exe')).extSupported, false)
  assert.equal(c(`https://res.cloudinary.com/democloud/image/authenticated/s--x--/v1/doppeldash/${o}/receipts/a.png`).cls, 'legacy_authenticated_url')
  assert.equal(c('https://example.org/x.pdf').cls, 'external_url'); assert.equal(c('/api/lms/1/document/0.png').cls, 'proxy_path'); assert.equal(c('javascript:alert(1)').cls, 'unknown'); assert.equal(c('').cls, 'unknown')
})

test('I2. the report is complete, REDACTED (no URL, file name or secret), and the inventory does not modify the database', async () => {
  const snapshot = async () => JSON.stringify([await db.collection('leaves').find({ orgId: { $in: [A.orgId, B.orgId] } }).sort({ _id: 1 }).toArray(), await db.collection('receiptuploads').find({ orgId: { $in: [A.orgId, B.orgId] } }).sort({ _id: 1 }).toArray()])
  const dup = pub(A.orgId, 'pdf', 'dup')
  const privOk = `cld:doppeldash/${A.orgId}/receipts/okok12345678.png`, privNoRow = `cld:doppeldash/${A.orgId}/receipts/norow1234567.png`
  const l1 = (await db.collection('leaves').insertOne(leave(A.orgId, [pub(A.orgId), dup, privOk]))).insertedId.toString()
  await db.collection('leaves').insertMany([leave(A.orgId, [dup, privNoRow]), leave(B.orgId, [pub(A.orgId, 'png', 'cross'), pub(B.orgId, 'exe'), 'https://example.org/x.pdf', '/api/lms/1/document/0.png'])])
  await db.collection('receiptuploads').insertMany([
    { orgId: A.orgId, publicId: `doppeldash/${A.orgId}/receipts/okok12345678`, state: 'attached', purpose: 'leave_medical', claimedBy: l1, userId: 'u1', issuedAt: new Date(), nextCheckAt: new Date(), failures: 0 },
    { orgId: A.orgId, publicId: `doppeldash/${A.orgId}/receipts/orphan1234567`, state: 'attached', purpose: 'leave_medical', claimedBy: 'gone', userId: 'u1', issuedAt: new Date(), nextCheckAt: new Date(), failures: 0 },
    { orgId: A.orgId, publicId: `doppeldash/${A.orgId}/receipts/deleting123456`, state: 'deleting', purpose: 'leave_medical', userId: 'u1', issuedAt: new Date(), nextCheckAt: new Date(), failures: 0 },
  ])
  const before = await snapshot()
  const { collectInventory, buildReport, buildPlan } = lib(); const inv = await collectInventory({}); const rep = buildReport(inv, { db: 'dd_x_test' }); const plan = buildPlan(inv)
  assert.equal(await snapshot(), before, 'read-only: nothing changed')
  const txt = JSON.stringify({ rep, plan })
  assert.doesNotMatch(txt, /cloudinary|res\.|https?:|doppeldash\/|name-of-patient|ZQ99|cld:|\.pdf|\.jpg/i, 'no URL, folder, file name or reference in the output')
  assert.equal(rep.readOnly, true); assert.equal(rep.totals.documents, 3 + 2 + 4)
  assert.equal(rep.totals.byClass.legacy_public_url, 5, 'legacy count (l1: 2, l2: 1, l3: cross-org + exe)')
  assert.equal(rep.totals.byClass.private_ref, 2); assert.equal(rep.totals.byClass.external_url, 1); assert.equal(rep.totals.byClass.proxy_path, 1)
  assert.equal(rep.privateRefs.manifest.ok, 1); assert.equal(rep.privateRefs.manifest.missing, 1)
  assert.equal(rep.privateRefs.orphanManifestRows, 2, 'orphan + deleting rows are not referenced'); assert.equal(rep.privateRefs.rowsBeingDeleted, 1)
  assert.ok(rep.duplicates.some(d => d.count === 2), 'the duplicated URL is grouped by fingerprint')
  assert.equal(rep.legacyPublic.notInOrgFolder, 1); assert.equal(rep.legacyPublic.unsupportedExtension, 1); assert.equal(rep.legacyPublic.eligibleForMigration, rep.legacyPublic.count - 2)
  assert.ok(rep.findings.every(f => !('url' in f)))
  assert.deepEqual([...new Set(plan.map(p => p.action))].sort(), ['copy_to_private_then_rewrite_ref', 'manual_review'])
  assert.ok(plan.filter(p => p.action === 'manual_review').every(p => p.reason))
})

test('I3. the public-reachability probe issues HEAD only, to res.cloudinary.com only, and reports status classes — never URLs', async () => {
  const { probePublic } = lib(); const seen = []
  const f = async (url, init) => { seen.push([url, init.method]); return { status: url.includes('dead') ? 404 : 200 } }
  const items = [{ cls: 'legacy_public_url', url: 'https://res.cloudinary.com/c/image/upload/v1/a.jpg' }, { cls: 'legacy_public_url', url: 'https://res.cloudinary.com/c/image/upload/v1/dead.jpg' }, { cls: 'external_url', url: 'https://example.org/x.pdf' }, { cls: 'legacy_public_url', url: 'http://res.cloudinary.com/insecure.jpg' }, { cls: 'private_ref' }]
  const r = await probePublic(items, f)
  assert.deepEqual(r, { publicly_reachable_200: 1, status_404: 1 }); assert.ok(seen.every(([u, m]) => m === 'HEAD' && u.startsWith('https://res.cloudinary.com/'))); assert.equal(seen.length, 2)
  assert.doesNotMatch(JSON.stringify(r), /http/)
})

test('I4. the CLI refuses a non-test database without the approval gate, refuses a missing/invalid URI, and (on a test database) writes a 0600 report with no URLs', () => {
  const script = path.resolve(__dirname, '../scripts/inventory-legacy-medical-docs.js'); const base = { ...process.env, MONGODB_URI: undefined, LEGACY_INVENTORY_APPROVAL: undefined }
  const run = (env, args = []) => spawnSync(process.execPath, [script, ...args], { env: { ...base, ...env }, encoding: 'utf8', timeout: 60000 })
  let r = run({}); assert.notEqual(r.status, 0); assert.match(r.stderr, /MONGODB_URI/)
  r = run({ MONGODB_URI: 'mongodb://127.0.0.1:1/customer_data' }); assert.notEqual(r.status, 0); assert.match(r.stderr, /not a disposable test database/); assert.doesNotMatch(r.stderr + r.stdout, /127\.0\.0\.1/)
  r = run({ MONGODB_URI: 'mongodb://127.0.0.1:1/customer_data', LEGACY_INVENTORY_APPROVAL: 'nobody' }); assert.notEqual(r.status, 0); assert.match(r.stderr, /not a disposable|approver/i)
  r = run({ MONGODB_URI: 'mongodb://127.0.0.1:1/customer_data', LEGACY_INVENTORY_APPROVAL: 'owner:TICKET-1' }); assert.notEqual(r.status, 0); assert.match(r.stderr, /confirm-db/)
  const out = path.join(require('node:os').tmpdir(), `legacy-inv-${kit.rand()}.json`)
  r = run({ MONGODB_URI: process.env.MONGODB_URI }, [`--out=${out}`, '--plan']); assert.equal(r.status, 0, r.stderr)
  const mode = require('node:fs').statSync(out).mode & 0o777; assert.equal(mode, 0o600); const txt = require('node:fs').readFileSync(out, 'utf8')
  assert.doesNotMatch(txt, /https?:|cloudinary|name-of-patient/i); assert.equal(JSON.parse(txt).readOnly, true); require('node:fs').unlinkSync(out)
})
