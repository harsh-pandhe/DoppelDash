/**
 * DoppelDash — Doppelmayr mail-brand DATA PROVISIONING.
 *
 * The brand is stored organisation configuration (OrgSettings), written by an
 * idempotent data step — never recognised by runtime mail code. These tests pin:
 *   - the desired persisted state (company name "Doppelmayr India", brandColor #0057A8)
 *   - idempotence, no overwrite of administrator edits, no organisation is ever created
 *   - the Organization entitlement fields are never touched
 *   - the stored configuration is what actually brands the e-mail (resolveMailBrand)
 *
 * Needs only the throwaway MongoDB (the kit refuses anything that is not local *test* DB).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db
test.before(async () => { db = await kit.connect() })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const lib = () => kit.load('lib/provisioning/doppelmayrBrand.ts')
const settingsOf = orgId => db.collection('orgsettings').findOne({ orgId })

test('P1. an organisation that does not exist is never created (no-op)', async () => {
  const { ensureDoppelmayrBrand } = lib()
  const orgId = `org_authf_${kit.rand()}`
  kit.trackOrg(orgId)
  const r = await ensureDoppelmayrBrand({ orgId, brandName: 'X', brandColor: '#112233' })
  assert.deepEqual(r, { orgFound: false, settingsCreated: false, changed: [], dryRun: false })
  assert.equal(await settingsOf(orgId), null)
  assert.equal(await db.collection('organizations').countDocuments({ orgId }), 0)
})

test('P2. creates the stored brand once; re-running changes nothing; entitlement fields untouched', async () => {
  const { ensureDoppelmayrBrand } = lib()
  const org = await kit.createOrg({ plan: 'premium', lifetimeGrant: true, webEnabled: true })
  const before = await db.collection('organizations').findOne({ orgId: org.orgId })
  const target = { orgId: org.orgId, brandName: 'Doppelmayr India', brandColor: '#0057A8' }

  const first = await ensureDoppelmayrBrand(target)
  assert.equal(first.orgFound, true); assert.equal(first.settingsCreated, true)
  const s = await settingsOf(org.orgId)
  assert.equal(s.brandName, 'Doppelmayr India'); assert.equal(s.brandColor, '#0057A8')
  assert.equal(s.companyName, before.name, 'legal company name defaults to the organisation\'s own name')

  const second = await ensureDoppelmayrBrand(target)
  assert.deepEqual(second.changed, [], 'second run writes nothing')
  assert.equal(second.settingsCreated, false)
  assert.equal((await settingsOf(org.orgId)).updatedAt.getTime(), s.updatedAt.getTime(), 'document not even touched')

  const after = await db.collection('organizations').findOne({ orgId: org.orgId })
  assert.deepEqual(after, before, 'Organization (plan, lifetimeGrant, webEnabled, androidEnabled, …) is byte-for-byte unchanged')
})

test('P3. fills only what is missing; never overwrites administrator choices or the legal company name', async () => {
  const { ensureDoppelmayrBrand } = lib()
  const target = c => ({ orgId: c.orgId, brandName: 'Doppelmayr India', brandColor: '#0057A8' })

  const legacy = await kit.createOrg()   // pre-existing settings written by the lazy settings handler
  await db.collection('orgsettings').insertOne({ orgId: legacy.orgId, name: 'Doppelmayr India Pvt Ltd', companyName: 'Doppelmayr India Pvt Ltd', timezone: 'Asia/Kolkata' })
  const r1 = await ensureDoppelmayrBrand(target(legacy))
  assert.deepEqual([...r1.changed].sort(), ['brandColor', 'brandName'])
  const s1 = await settingsOf(legacy.orgId)
  assert.equal(s1.brandName, 'Doppelmayr India'); assert.equal(s1.brandColor, '#0057A8')
  assert.equal(s1.companyName, 'Doppelmayr India Pvt Ltd', 'legal company name untouched'); assert.equal(s1.timezone, 'Asia/Kolkata', 'unrelated settings preserved')

  const custom = await kit.createOrg()   // an administrator already chose a brand name and colour
  await db.collection('orgsettings').insertOne({ orgId: custom.orgId, name: 'Whatever', companyName: 'Whatever', brandName: 'Doppelmayr Seilbahnen', brandColor: '#123456' })
  const r2 = await ensureDoppelmayrBrand(target(custom))
  assert.deepEqual(r2.changed, [])
  const s2 = await settingsOf(custom.orgId)
  assert.equal(s2.brandName, 'Doppelmayr Seilbahnen'); assert.equal(s2.brandColor, '#123456')
})

test('P4. the stored configuration is what brands the e-mail (resolveMailBrand reads it, nothing else)', async () => {
  const { ensureDoppelmayrBrand } = lib()
  const { resolveMailBrand } = kit.load('lib/mail/brand.ts')
  const org = await kit.createOrg({ name: 'Some Registered Name' })
  await ensureDoppelmayrBrand({ orgId: org.orgId, brandName: 'Doppelmayr India', brandColor: '#0057A8' })
  const b = await resolveMailBrand(org.orgId)
  assert.equal(b.name, 'Doppelmayr India'); assert.equal(b.color, '#0057A8'); assert.equal(b.isPlatform, false)
})

test('P5. the real Doppelmayr record: legacy data is brought to the desired state, then stays stable', async () => {
  const { ensureDoppelmayrBrand, DOPPELMAYR_PROVISIONING } = lib()
  const Organization = kit.load('models/Organization.ts').default
  await Organization.ensureDoppelmayr()      // data provisioning of the entitlement itself (throwaway DB only)
  const orgBefore = await db.collection('organizations').findOne({ orgId: DOPPELMAYR_PROVISIONING.orgId })
  const settingsBefore = await settingsOf(DOPPELMAYR_PROVISIONING.orgId)
  try {
    // Simulate a production database that predates the brand fields.
    await db.collection('orgsettings').updateOne({ orgId: DOPPELMAYR_PROVISIONING.orgId }, { $unset: { brandColor: '', brandName: '' } })
    const r = await ensureDoppelmayrBrand()
    assert.deepEqual([...r.changed].sort(), ['brandColor', 'brandName'])
    const s = await settingsOf(DOPPELMAYR_PROVISIONING.orgId)
    assert.equal(s.brandName, 'Doppelmayr India'); assert.equal(s.brandColor, '#0057A8')
    assert.equal(s.companyName, settingsBefore.companyName, 'legal company name is never touched')
    assert.equal(s.name, settingsBefore.name)
    assert.deepEqual((await ensureDoppelmayrBrand()).changed, [], 'idempotent')

    const org = await db.collection('organizations').findOne({ orgId: DOPPELMAYR_PROVISIONING.orgId })
    for (const k of ['plan', 'entitlementSource', 'lifetimeGrant', 'webEnabled', 'androidEnabled']) assert.equal(org[k], orgBefore[k], `entitlement field ${k} unchanged`)
    assert.deepEqual(
      { plan: org.plan, lifetimeGrant: org.lifetimeGrant, webEnabled: org.webEnabled, androidEnabled: org.androidEnabled },
      { plan: 'premium', lifetimeGrant: true, webEnabled: true, androidEnabled: true },
    )
  } finally {
    if (settingsBefore) await db.collection('orgsettings').replaceOne({ orgId: DOPPELMAYR_PROVISIONING.orgId }, settingsBefore)
  }
})

test('P6. the migrate step wires the provisioning in (secret-gated route, idempotent result)', async () => {
  const fs = require('node:fs'); const path = require('node:path')
  const src = fs.readFileSync(path.resolve(__dirname, '../app/api/dev/migrate/route.ts'), 'utf8')
  assert.match(src, /ensureDoppelmayrBrand/)
  const seed = fs.readFileSync(path.resolve(__dirname, '../app/api/dev/seed/route.ts'), 'utf8')
  assert.match(seed, /brandColor:\s*'#0057A8'/)
  assert.match(seed, /brandName:\s*'Doppelmayr India'/)
})

/* ───────── operator script (the production path): dry run by default, explicit DB confirmation, idempotent ───────── */
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const SCRIPT = path.resolve(__dirname, '../scripts/provision-doppelmayr-brand.js')
const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 })
const DB_NAME = () => process.env.MONGODB_URI.split('/').pop().split('?')[0]

test('P7. the operator script: dry run writes nothing; --apply needs the exact DB name; apply is idempotent; the URI is never printed', async () => {
  const Organization = kit.load('models/Organization.ts').default
  await Organization.ensureDoppelmayr()
  const id = 'org_doppelmayr'
  const settingsBefore = await settingsOf(id)
  const orgBefore = await db.collection('organizations').findOne({ orgId: id })
  try {
    await db.collection('orgsettings').updateOne({ orgId: id }, { $unset: { brandColor: '', brandName: '' } })   // legacy production state

    const dry = run([])
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /DRY RUN — would write: brandColor, brandName/)
    const stillLegacy = await settingsOf(id)
    assert.equal(stillLegacy.brandColor, undefined); assert.equal(stillLegacy.brandName, undefined)

    const noConfirm = run(['--apply'])
    assert.notEqual(noConfirm.status, 0); assert.match(noConfirm.stderr, /--confirm-db=/)
    const wrongConfirm = run(['--apply', '--confirm-db=some_other_db'])
    assert.notEqual(wrongConfirm.status, 0)
    assert.equal((await settingsOf(id)).brandColor, undefined, 'nothing written without the right confirmation')

    const applied = run(['--apply', `--confirm-db=${DB_NAME()}`])
    assert.equal(applied.status, 0, applied.stderr)
    assert.match(applied.stdout, /Applied: brandColor, brandName/)
    const s = await settingsOf(id)
    assert.equal(s.brandName, 'Doppelmayr India'); assert.equal(s.brandColor, '#0057A8')
    assert.equal(s.companyName, settingsBefore.companyName, 'legal company name untouched')
    assert.deepEqual(await db.collection('organizations').findOne({ orgId: id }), orgBefore, 'entitlement record untouched')

    const again = run(['--apply', `--confirm-db=${DB_NAME()}`])
    assert.equal(again.status, 0); assert.match(again.stdout, /Already provisioned/)
    assert.equal((await settingsOf(id)).updatedAt.getTime(), s.updatedAt.getTime(), 'second apply touches nothing')

    for (const out of [dry, applied, again, noConfirm]) assert.ok(!(out.stdout + out.stderr).includes('127.0.0.1:27017'), 'connection string host never printed')
  } finally {
    if (settingsBefore) await db.collection('orgsettings').replaceOne({ orgId: id }, settingsBefore)
  }
})

test('P8. the operator script refuses a missing/invalid URI and a URI without a database name; a missing org changes nothing', async () => {
  assert.notEqual(run([], { MONGODB_URI: '' }).status, 0)
  assert.notEqual(run([], { MONGODB_URI: 'http://not-mongo' }).status, 0)
  assert.notEqual(run([], { MONGODB_URI: 'mongodb://127.0.0.1:27017/' }).status, 0)
  // a database that has no org_doppelmayr: error, and nothing created
  const empty = 'dd_gate_p8_empty_test'
  const out = run([], { MONGODB_URI: `mongodb://127.0.0.1:27017/${empty}` })
  assert.notEqual(out.status, 0); assert.match(out.stderr, /does not exist/)
  const m = kit.load('models/Organization.ts') // keep the kit's connection; inspect the empty DB via a sibling handle
  const conn = require('mongoose').connection.useDb(empty)
  assert.equal(await conn.db.collection('orgsettings').countDocuments(), 0)
  assert.equal(await conn.db.collection('organizations').countDocuments(), 0)
  await conn.dropDatabase()
  void m
})
