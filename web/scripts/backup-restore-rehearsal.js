/**
 * DoppelDash — LOGICAL backup → restore REHEARSAL on DISPOSABLE databases only (no mongodump needed). It proves the procedure and the verification
 * (document counts, per-collection content hash, indexes recreated) — it is NOT a rehearsal of Atlas snapshots / point-in-time restore, which the
 * owner must exercise on the real cluster (docs/RELEASE_OPERATIONS.md).
 *   MONGODB_URI="mongodb://127.0.0.1:27017/dd_<anything>_test" node web/scripts/backup-restore-rehearsal.js [--dir=<backup dir>] [--keep]
 * Source and target databases must both be loopback and contain "test" in their names; the target is `<source>_restored`, dropped at the end unless --keep.
 * Dumps are written with mode 0600 in a 0700 directory and contain whatever the source DB contains — use synthetic data only; the directory is deleted unless --keep.
 */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { MongoClient } = require('mongodb'); const { EJSON } = require('bson')
const args = process.argv.slice(2); const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const fail = m => { console.error(`[ERROR] ${m}`); process.exit(1) }
const uri = process.env.MONGODB_URI
const m = /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/([^/?]+)/.exec(uri || '')
if (!m || !/test/i.test(m[3])) fail('MONGODB_URI must be a LOOPBACK mongodb:// URI whose database name contains "test".')
const srcName = m[3], dstName = `${srcName}_restored`
const hash = docs => crypto.createHash('sha256').update(docs.map(d => EJSON.stringify(d, { relaxed: false })).sort().join('\n')).digest('hex')

;(async () => {
  const client = await MongoClient.connect(uri.replace(/\/[^/?]+(\?.*)?$/, '/')); const src = client.db(srcName), dst = client.db(dstName)
  const dir = flag('dir') || fs.mkdtempSync(path.join(os.tmpdir(), 'dd-backup-')); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const t0 = Date.now(); const manifest = {}
  try {
    // 1. BACKUP
    for (const c of await src.listCollections({ type: 'collection' }).toArray()) {
      if (c.name.startsWith('system.')) continue
      const coll = src.collection(c.name); const docs = await coll.find({}).toArray(); const indexes = (await coll.indexes()).filter(i => i.name !== '_id_')
      fs.writeFileSync(path.join(dir, `${c.name}.json`), EJSON.stringify({ docs, indexes }, { relaxed: false }), { mode: 0o600 })
      manifest[c.name] = { count: docs.length, hash: hash(docs), indexes: indexes.length }
    }
    // 2. RESTORE into a fresh database
    await dst.dropDatabase()
    for (const name of Object.keys(manifest)) {
      const { docs, indexes } = EJSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'), { relaxed: false })
      await dst.createCollection(name).catch(() => undefined)            // empty collections are restored too
      const coll = dst.collection(name); if (docs.length) await coll.insertMany(docs, { ordered: true })
      for (const i of indexes) { const { key, name: iname, v, ns, ...opts } = i; await coll.createIndex(key, { name: iname, ...opts }) }
    }
    // 3. VERIFY
    const problems = []
    for (const [name, exp] of Object.entries(manifest)) {
      const coll = dst.collection(name); const docs = await coll.find({}).toArray(); const idx = (await coll.indexes()).filter(i => i.name !== '_id_')
      if (docs.length !== exp.count) problems.push(`${name}: count ${docs.length} != ${exp.count}`)
      if (hash(docs) !== exp.hash) problems.push(`${name}: content hash differs`)
      if (idx.length !== exp.indexes) problems.push(`${name}: indexes ${idx.length} != ${exp.indexes}`)
    }
    const total = Object.values(manifest).reduce((a, c) => a + c.count, 0)
    console.log(JSON.stringify({ rehearsal: 'logical-backup-restore', source: srcName, target: dstName, collections: Object.keys(manifest).length, documents: total, seconds: Math.round((Date.now() - t0) / 100) / 10, verified: problems.length === 0, problems }, null, 2))
    process.exitCode = problems.length ? 2 : 0
  } finally {
    if (!args.includes('--keep')) { await dst.dropDatabase().catch(() => undefined); if (!flag('dir')) fs.rmSync(dir, { recursive: true, force: true }) }
    await client.close()
  }
})().catch(e => { console.error('[ERROR]', e && e.message ? e.message : e); process.exit(1) })
