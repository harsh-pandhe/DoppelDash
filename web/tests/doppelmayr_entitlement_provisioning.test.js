/**
 * P0-03 — controlled Doppelmayr lifetime-entitlement provisioning (library + operator script), throw-away DB only.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const kit = require('./helpers/authTestKit')

let db, Org, Audit, ent
const script = path.resolve(__dirname, '../scripts/provision-doppelmayr-entitlement.js')
const run = (args, uri = process.env.MONGODB_URI) => spawnSync('node', [script, ...args], { env: { ...process.env, MONGODB_URI: uri }, encoding: 'utf8' })
const dbName = () => process.env.MONGODB_URI.split('/').pop().split('?')[0]
const TARGET = { plan: 'premium', entitlementSource: 'lifetime_grant', lifetimeGrant: true, webEnabled: true, androidEnabled: true }
const pick = o => Object.fromEntries(Object.keys(TARGET).map(k => [k, o[k]]))
const applyArgs = id => ['--apply', `--org-id=${id}`, `--confirm-db=${dbName()}`, `--confirm-org=${id}`, '--actor=Test Operator', '--reason=unit test provisioning']

test.before(async () => { db = await kit.connect(); Org = kit.load('models/Organization.ts').default; Audit = kit.load('models/AuditLog.ts').default; ent = kit.load('lib/entitlements/entitlementService.ts') })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

async function legacyOrg(over = {}) {
  const o = await kit.createOrg({ plan: 'free', webEnabled: false })
  await Org.updateOne({ orgId: o.orgId }, { $set: { plan: 'free', entitlementSource: 'none', lifetimeGrant: false, webEnabled: false, ...over }, ...(over.androidEnabled === undefined ? { $unset: { androidEnabled: 1 } } : {}) })
  return o
}

test('D1. dry run is the default: it reports what would change and writes nothing (no field, no audit entry)', async () => {
  const o = await legacyOrg(); const before = JSON.stringify(await Org.findOne({ orgId: o.orgId }).lean())
  const r = run([`--org-id=${o.orgId}`]); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DRY RUN/); assert.match(r.stdout, /would write: .*plan.*lifetimeGrant.*webEnabled/)
  assert.equal(JSON.stringify(await Org.findOne({ orgId: o.orgId }).lean()), before); assert.equal(await Audit.countDocuments({ orgId: o.orgId, action: 'organization.entitlement_provisioned' }), 0)
})

test('D2. apply needs every confirmation (database, organisation, actor, reason); each missing piece is refused before any connection', async () => {
  const o = await legacyOrg(); const base = applyArgs(o.orgId)
  for (const drop of ['--confirm-db', '--confirm-org', '--actor', '--reason']) { const r = run(base.filter(a => !a.startsWith(drop))); assert.notEqual(r.status, 0, drop); assert.match(r.stderr, /requires/) }
  const wrongDb = run(base.map(a => a.startsWith('--confirm-db') ? '--confirm-db=some_other_db' : a)); assert.notEqual(wrongDb.status, 0)
  assert.equal(pick(await Org.findOne({ orgId: o.orgId }).lean()).plan, 'free')
})

test('D3. apply sets EXACTLY the five persisted fields, leaves everything else byte-identical, writes one audit entry (who/why/before/after), and web+android access follows from the stored values', async () => {
  const o = await legacyOrg(); const before = await Org.findOne({ orgId: o.orgId }).lean()
  const r = run(applyArgs(o.orgId)); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Applied/); assert.doesNotMatch(r.stdout + r.stderr, /mongodb:\/\//)
  const after = await Org.findOne({ orgId: o.orgId }).lean(); assert.deepEqual(pick(after), TARGET)
  const strip = x => { const { updatedAt, ...rest } = x; for (const k of Object.keys(TARGET)) delete rest[k]; return JSON.stringify(rest) }; assert.equal(strip(after), strip(before), 'no other field changed')
  const au = await Audit.find({ orgId: o.orgId, action: 'organization.entitlement_provisioned' }).lean(); assert.equal(au.length, 1)
  assert.equal(au[0].performedByName, 'Test Operator'); assert.equal(au[0].metadata.reason, 'unit test provisioning'); assert.equal(au[0].targetId, o.orgId); assert.equal(au[0].metadata.before.plan, 'free'); assert.equal(au[0].metadata.after.plan, 'premium')
  const e = await ent.getOrganizationEntitlements(o.orgId); assert.equal(e.plan, 'premium'); assert.equal(e.lifetimeGrant, true); assert.equal(e.webEnabled, true); assert.equal(e.androidEnabled, true)
})

test('D4. re-running is safe: nothing is written, no second audit entry, updatedAt unchanged; a partial state is completed field by field', async () => {
  const o = await legacyOrg(); assert.equal(run(applyArgs(o.orgId)).status, 0); const snap = JSON.stringify(await Org.findOne({ orgId: o.orgId }).lean())
  for (let i = 0; i < 3; i++) { const r = run(applyArgs(o.orgId)); assert.equal(r.status, 0); assert.match(r.stdout, /Already provisioned/) }
  assert.equal(JSON.stringify(await Org.findOne({ orgId: o.orgId }).lean()), snap); assert.equal(await Audit.countDocuments({ orgId: o.orgId, action: 'organization.entitlement_provisioned' }), 1)
  const p = await legacyOrg({ plan: 'premium', lifetimeGrant: true }); assert.equal(run(applyArgs(p.orgId)).status, 0); assert.deepEqual(pick(await Org.findOne({ orgId: p.orgId }).lean()), TARGET)
  const meta = (await Audit.findOne({ orgId: p.orgId, action: 'organization.entitlement_provisioned' }).lean()).metadata; assert.ok(!meta.changed.includes('plan') && !meta.changed.includes('lifetimeGrant') && meta.changed.includes('webEnabled'))
})

test('D5. a missing organisation is never created; other organisations — including look-alikes by name or slug — are untouched and get NO web access', async () => {
  const before = await Org.countDocuments({}); const r = run(applyArgs('org_does_not_exist_zzz')); assert.notEqual(r.status, 0); assert.match(r.stderr, /does not exist/); assert.equal(await Org.countDocuments({}), before)
  const target = await legacyOrg(); const lookalike = await legacyOrg(); await Org.updateOne({ orgId: lookalike.orgId }, { $set: { name: 'Doppelmayr India', slug: `doppelmayr-india-${Date.now().toString(36)}` } })
  assert.equal(run(applyArgs(target.orgId)).status, 0)
  const l = await Org.findOne({ orgId: lookalike.orgId }).lean(); assert.equal(l.plan, 'free'); assert.equal(l.webEnabled, false); assert.equal(l.lifetimeGrant, false)
  const e = await ent.getOrganizationEntitlements(lookalike.orgId); assert.equal(e.webEnabled, false); assert.equal(e.plan, 'free'); assert.equal(await Audit.countDocuments({ orgId: lookalike.orgId, action: 'organization.entitlement_provisioned' }), 0)
})

test('D6. the library refuses to apply without an actor and reason, and a concurrent change aborts the write instead of overwriting it', async () => {
  const o = await legacyOrg()
  await assert.rejects(ent && kit.load('lib/provisioning/doppelmayrEntitlement.ts').ensureLifetimeEntitlement({ orgId: o.orgId }, { dryRun: false }), /actor and a reason/)
  assert.equal((await Org.findOne({ orgId: o.orgId }).lean()).plan, 'free')
  const lib = kit.load('lib/provisioning/doppelmayrEntitlement.ts'); const [a, b] = await Promise.allSettled([lib.ensureLifetimeEntitlement({ orgId: o.orgId }, { dryRun: false, actor: 'A', reason: 'r' }), lib.ensureLifetimeEntitlement({ orgId: o.orgId }, { dryRun: false, actor: 'B', reason: 'r' })])
  assert.ok([a, b].some(x => x.status === 'fulfilled'), 'at least one run succeeds'); assert.deepEqual(pick(await Org.findOne({ orgId: o.orgId }).lean()), TARGET)
  assert.equal(await Audit.countDocuments({ orgId: o.orgId, action: 'organization.entitlement_provisioned' }), 1, 'a race produces one audit entry')
})
