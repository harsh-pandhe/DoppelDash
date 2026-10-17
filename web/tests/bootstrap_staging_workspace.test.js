/**
 * scripts/bootstrap-staging-workspace.js (Phase 12): the staging-only Doppelmayr workspace + first-Admin bootstrap.
 * DISPOSABLE database whose name contains "staging". Proves: hard refusals (non-staging / production-looking targets, missing confirmations),
 * dry run writes nothing, apply creates a correctly entitled workspace + Admin (hashed one-time password printed once, forced change), an audit trail,
 * idempotent re-run (no second password, no duplicates), no account takeover, no collateral change to other tenants.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const kit = require('./helpers/authTestKit')
const SCRIPT = path.resolve(__dirname, '../scripts/bootstrap-staging-workspace.js')

let base, client, db
const DB = 'dd_boot_staging_test'
const run = (env, args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 90000 })
test.before(async () => {
  const { MongoClient } = require('mongodb'); base = (process.env.MONGODB_URI || '').replace(/\/[^/?]+(\?.*)?$/, '/')
  client = await MongoClient.connect(base + DB); db = client.db(DB); await db.dropDatabase()
})
test.after(async () => { await db.dropDatabase().catch(() => undefined); await client.close() })
const OWNER = 'owner.fixture@example.test'
const URI = () => base + DB
const APPLY = ['--admin-email=' + OWNER, '--admin-first=Owner', '--admin-last=Fixture', '--apply', '--confirm-db=' + DB, '--actor=tester', '--reason=fixture run']

test('B1. refuses non-staging / production-looking targets and missing confirmations before touching anything', async () => {
  for (const [label, env, a] of [
    ['db name without staging', { MONGODB_URI: base + 'dd_boot_other_test' }, ['--admin-email=' + OWNER]],
    ['production-looking db', { MONGODB_URI: base + 'dd_production_staging_test' }, ['--admin-email=' + OWNER]],
    ['production context in shell', { MONGODB_URI: URI(), DD_DEPLOY_CONTEXT: 'production' }, ['--admin-email=' + OWNER]],
    ['no admin email', { MONGODB_URI: URI() }, []],
    ['apply without confirm-db', { MONGODB_URI: URI() }, ['--admin-email=' + OWNER, '--apply', '--actor=a', '--reason=b']],
    ['apply with wrong confirm-db', { MONGODB_URI: URI() }, ['--admin-email=' + OWNER, '--apply', '--confirm-db=nope', '--actor=a', '--reason=b']],
    ['apply without actor/reason', { MONGODB_URI: URI() }, ['--admin-email=' + OWNER, '--apply', '--confirm-db=' + DB]],
  ]) { const r = run(env, a); assert.equal(r.status, 2, `${label}: ${r.status} ${r.stdout}${r.stderr}`); assert.match(r.stderr, /REFUSING/) }
  assert.equal((await db.listCollections().toArray()).length, 0, 'nothing was created by any refusal')
})

test('B2. dry run reports the plan and writes nothing', async () => {
  const r = run({ MONGODB_URI: URI() }, ['--admin-email=' + OWNER]); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DRY RUN — would: create organization/); assert.match(r.stdout, /create Admin user/)
  assert.doesNotMatch(r.stdout + r.stderr, /mongodb(\+srv)?:\/\//, 'the connection string is never printed')
  assert.equal(await db.collection('organizations').countDocuments(), 0); assert.equal(await db.collection('users').countDocuments(), 0)
})

test('B3. apply creates the entitled workspace and the Admin; the one-time password is printed once, stored only as a hash, forces a change; audit entries exist; other tenants are untouched', async () => {
  await db.collection('organizations').insertOne({ orgId: 'org_other_fixture', name: 'Other', slug: 'other-fixture', plan: 'free', webEnabled: false, lifetimeGrant: false, androidEnabled: true, entitlementSource: 'none', subscriptionStatus: 'none', trialStatus: 'none' })
  const otherBefore = JSON.stringify(await db.collection('organizations').findOne({ orgId: 'org_other_fixture' }))
  const r = run({ MONGODB_URI: URI() }, APPLY); assert.equal(r.status, 0, r.stdout + r.stderr)
  const m = /ONE-TIME PASSWORD[^\n]*\n\s+(\S+)/.exec(r.stdout); assert.ok(m, r.stdout); const pw = m[1]
  assert.ok(pw.length >= 24)
  const org = await db.collection('organizations').findOne({ orgId: 'org_doppelmayr' })
  assert.deepEqual([org.plan, org.entitlementSource, org.lifetimeGrant, org.webEnabled, org.androidEnabled], ['premium', 'lifetime_grant', true, true, true])
  const u = await db.collection('users').findOne({ email: OWNER }); assert.equal(u.role, 'admin'); assert.equal(u.orgId, 'org_doppelmayr'); assert.equal(u.mustChangePassword, true); assert.equal(u.isActive, true)
  assert.notEqual(u.passwordHash, pw); assert.ok(!JSON.stringify(u).includes(pw), 'the password is only stored hashed')
  assert.equal(await require('bcryptjs').compare(pw, u.passwordHash), true, 'the printed password is the one that was hashed')
  assert.equal(org.ownerId, String(u._id))
  assert.equal(await db.collection('employees').countDocuments({ clerkUserId: String(u._id), orgId: 'org_doppelmayr' }), 1)
  assert.equal(await db.collection('leavebalances').countDocuments({ userId: String(u._id) }), 1)
  const settings = await db.collection('orgsettings').findOne({ orgId: 'org_doppelmayr' }); assert.equal(settings.brandName, 'Doppelmayr India')
  const actions = (await db.collection('auditlogs').find({ orgId: 'org_doppelmayr' }).toArray()).map(a => a.action).sort()
  assert.deepEqual(actions, ['organization.entitlement_provisioned', 'staging.admin_bootstrapped', 'staging.workspace_created'])
  assert.equal(JSON.stringify(await db.collection('organizations').findOne({ orgId: 'org_other_fixture' })), otherBefore, 'another tenant is byte-identical')
  assert.doesNotMatch(JSON.stringify(await db.collection('auditlogs').find({}).toArray()), new RegExp(pw.slice(0, 12)), 'no password in the audit trail')
})

test('B4. re-running is idempotent (no new password, no duplicate rows, no second audit entry) and an existing foreign account is never taken over', async () => {
  const before = { users: await db.collection('users').countDocuments(), audits: await db.collection('auditlogs').countDocuments(), emp: await db.collection('employees').countDocuments() }
  const r = run({ MONGODB_URI: URI() }, APPLY); assert.equal(r.status, 0, r.stdout + r.stderr); assert.doesNotMatch(r.stdout, /ONE-TIME PASSWORD/); assert.match(r.stdout, /No new account was created/)
  assert.deepEqual({ users: await db.collection('users').countDocuments(), audits: await db.collection('auditlogs').countDocuments(), emp: await db.collection('employees').countDocuments() }, before)
  await db.collection('users').insertOne({ email: 'taken.fixture@example.test', orgId: 'org_other_fixture', role: 'employee', passwordHash: 'x', firstName: 'T', lastName: 'F', isActive: true })
  const t = run({ MONGODB_URI: URI() }, ['--admin-email=taken.fixture@example.test', '--apply', '--confirm-db=' + DB, '--actor=a', '--reason=b']); assert.equal(t.status, 2, t.stdout + t.stderr); assert.match(t.stderr, /will not be taken over/)
  assert.equal((await db.collection('users').findOne({ email: 'taken.fixture@example.test' })).orgId, 'org_other_fixture')
})
