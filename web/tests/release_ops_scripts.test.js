/**
 * Release-operations scripts (Phase 5G), exercised on the DISPOSABLE test database only: read-only index pre-flight, logical backup→restore
 * rehearsal with verification. FAKE/DISPOSABLE-VERIFIED — this does not exercise Atlas snapshots or point-in-time restore.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const kit = require('./helpers/authTestKit')
const S = n => path.resolve(__dirname, '../scripts', n)

let db, A
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'free' }) })
test.after(async () => { await db.collection('zz_dups').drop().catch(() => undefined); await kit.cleanupAll(db); await kit.disconnect() })
const run = (script, env = {}, args = []) => spawnSync(process.execPath, [S(script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 240000 })

test('R1. findDuplicates reports duplicate groups for a would-be unique index (counts only), honours partial filters, and never modifies data', async () => {
  const { findDuplicates } = require(S('preflight-indexes.js'))
  const mongoose = require('mongoose'); const coll = db.collection('zz_dups')
  await coll.insertMany([{ k: 'a', t: 1 }, { k: 'a', t: 2 }, { k: 'b', t: 3 }, { k: 'c', s: 'x' }, { k: 'c', s: 'x' }, { k: 'c', s: 'x' }])
  const before = await coll.countDocuments()
  assert.deepEqual(await findDuplicates(coll, { k: 1 }), { groups: 2, documents: 5 })
  assert.deepEqual(await findDuplicates(coll, { k: 1 }, { s: 'x' }), { groups: 1, documents: 3 }, 'a partial unique index only sees the filtered documents')
  assert.deepEqual(await findDuplicates(coll, { k: 1, s: 1 }), { groups: 2, documents: 5 }, 'compound key: rows with a MISSING s index as null, so (a,null) x2 and (c,x) x3 collide')
  assert.equal(await coll.countDocuments(), before); void mongoose
})

test('R2. the index pre-flight is read-only, reports per model, exits 0 on a clean database and 2 when duplicates would block a unique index; it refuses non-test databases without the approval gate', async () => {
  const r = run('preflight-indexes.js', {}, ['--json']); assert.ok([0, 2].includes(r.status), r.stderr); const rep = JSON.parse(r.stdout)
  assert.equal(rep.readOnly, true); assert.ok(rep.models >= 30, 'covers every model'); assert.equal(rep.withBlockingDuplicates, 0, JSON.stringify(rep.report.filter(x => x.duplicatesBlockingUnique.length)))
  assert.doesNotMatch(r.stdout, /mongodb:\/\//)
  const bad = run('preflight-indexes.js', { MONGODB_URI: 'mongodb://127.0.0.1:1/customer_data' }); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /not a disposable test database/); assert.doesNotMatch(bad.stderr + bad.stdout, /127\.0\.0\.1/)
  const gate = run('preflight-indexes.js', { MONGODB_URI: 'mongodb://127.0.0.1:1/customer_data', PREFLIGHT_APPROVAL: 'owner:T-1' }); assert.notEqual(gate.status, 0); assert.match(gate.stderr, /confirm-db/)
})

test('R3. logical backup → restore rehearsal: every collection restored with identical counts, content hashes and indexes; the restored database and the dump directory are removed', async () => {
  // Rehearse on a QUIET dedicated database seeded with synthetic data. Running it on the shared CI database raced with the live dev server's background writes
  // (e.g. auth replay claims written between the dump and the verification) and failed intermittently in CI.
  const { MongoClient } = require('mongodb'); const base = (process.env.MONGODB_URI || '').replace(/\/[^/?]+(\?.*)?$/, '/'); const NAME = 'dd_rehearsal_src_test'
  const client = await MongoClient.connect(base + NAME); const src = client.db(NAME)
  try {
    await src.dropDatabase()
    await src.collection('zz_rehearsal').createIndex({ k: 1 }, { unique: true, name: 'k_unique' })
    await src.collection('zz_rehearsal').insertMany(Array.from({ length: 50 }, (_, i) => ({ k: 'k' + i, when: new Date(1e12 + i), n: i, nested: { a: [1, 2, { b: i }] } })))
    for (const c of ['zz_a', 'zz_b', 'zz_c', 'zz_d']) await src.collection(c).insertMany([{ x: c, n: 1 }, { x: c, n: 2 }])
    const r = run('backup-restore-rehearsal.js', { MONGODB_URI: base + NAME }); assert.equal(r.status, 0, r.stderr + r.stdout)
    const rep = JSON.parse(r.stdout); assert.equal(rep.verified, true, JSON.stringify(rep.problems)); assert.equal(rep.collections, 5); assert.equal(rep.documents, 58, JSON.stringify(rep))
    const dbs = await client.db().admin().listDatabases(); assert.ok(!dbs.databases.some(d => d.name === rep.target), 'the restored database was dropped')
  } finally { await src.dropDatabase().catch(() => undefined); await client.close() }
})

test('R4. the rehearsal refuses a non-loopback or non-test database', () => {
  for (const uri of ['mongodb://127.0.0.1:27017/customer_data', 'mongodb://prod.example.com:27017/dd_test', 'mongodb+srv://u:p@cluster.example.net/dd_test']) {
    const r = run('backup-restore-rehearsal.js', { MONGODB_URI: uri }); assert.notEqual(r.status, 0, uri); assert.match(r.stderr, /LOOPBACK/); assert.doesNotMatch(r.stderr + r.stdout, /prod\.example|cluster\.example|u:p/)
  }
})

/* ───────── compare-databases.js (Phase 10): read-only reconciliation, DISPOSABLE fixtures ───────── */
test('R6. compare-databases refuses unsafe invocations, reports MATCH for an identical copy, and flags changed content, missing/extra collections, count and index drift — printing no document content or URI', async () => {
  const { MongoClient } = require('mongodb'); const base = (process.env.MONGODB_URI || '').replace(/\/[^/?]+(\?.*)?$/, '/')
  const c = await MongoClient.connect(base + 'dd_cmp_a_test'); const A_ = c.db('dd_cmp_a_test'), B_ = c.db('dd_cmp_b_test')
  try {
    await A_.dropDatabase(); await B_.dropDatabase()
    const docs = [{ _id: 1, secret: 'PRIVATE-MEDICAL-TEXT', n: 1 }, { _id: 2, secret: 'x', n: 2 }]
    for (const d of [A_, B_]) { await d.collection('claims').insertMany(docs); await d.collection('claims').createIndex({ n: 1 }) }
    const env = { SOURCE_MONGODB_URI: base + 'dd_cmp_a_test', RESTORED_MONGODB_URI: base + 'dd_cmp_b_test', ATLAS_COMPARE_APPROVAL: '1' }; const ok = ['--confirm-source-db=dd_cmp_a_test', '--confirm-restored-db=dd_cmp_b_test']
    for (const [label, e, a] of [['no approval', { ATLAS_COMPARE_APPROVAL: '' }, ok], ['same uri', { RESTORED_MONGODB_URI: env.SOURCE_MONGODB_URI }, ok], ['no confirm', {}, []], ['wrong confirm', {}, ['--confirm-source-db=x', '--confirm-restored-db=dd_cmp_b_test']]]) { const r = run('compare-databases.js', { ...env, ...e }, a); assert.equal(r.status, 2, `${label}: ${r.stderr}`); assert.match(r.stderr, /REFUSING TO RUN/) }
    let r = run('compare-databases.js', env, ok); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ALL COLLECTIONS MATCH/); assert.doesNotMatch(r.stdout + r.stderr, /PRIVATE-MEDICAL-TEXT|mongodb:\/\//)
    await B_.collection('claims').updateOne({ _id: 2 }, { $set: { secret: 'tampered' } })
    r = run('compare-databases.js', env, ok); assert.equal(r.status, 1); assert.match(r.stdout, /DIFF\s+claims.*content/); assert.doesNotMatch(r.stdout + r.stderr, /tampered|PRIVATE-MEDICAL-TEXT/)
    await B_.collection('claims').updateOne({ _id: 2 }, { $set: { secret: 'x' } }); await B_.collection('claims').dropIndex('n_1'); await B_.collection('extra').insertOne({ a: 1 }); await A_.collection('only_src').insertOne({ a: 1 }); await B_.collection('claims').deleteOne({ _id: 1 })
    r = run('compare-databases.js', env, ok); assert.equal(r.status, 1); assert.match(r.stdout, /claims.*count\+content\+indexes|claims.*count/); assert.match(r.stdout, /extra in restored/); assert.match(r.stdout, /missing in restored/)
    r = run('compare-databases.js', env, [...ok, '--exclude=extra,only_src,claims']); assert.equal(r.status, 0, r.stdout)
  } finally { await A_.dropDatabase().catch(() => undefined); await B_.dropDatabase().catch(() => undefined); await c.close() }
})
