/**
 * DoppelDash — READ-ONLY reconciliation of a restored database against its source (Atlas snapshot / point-in-time restore verification).
 * Compares, per collection: document count, a content hash (sha256 over the EJSON of every document ordered by _id) and the index set. It never writes,
 * never prints a document, a value or a connection string — only collection names, counts, match flags and elapsed time.
 *   SOURCE_MONGODB_URI=<source> RESTORED_MONGODB_URI=<restored copy> ATLAS_COMPARE_APPROVAL=1 \
 *     node web/scripts/compare-databases.js --confirm-source-db=<name> --confirm-restored-db=<name> [--exclude=ratelimits,sessions] [--json]
 * Rules: needs the explicit approval variable; the two URIs must differ and the two typed database names must match the URIs' database names; the restored
 * copy must NOT be the source. Run it against a restored copy only; reading a production source is itself an owner-approved action (read load).
 * Expected differences after a point-in-time restore: collections written after the restore point (use --exclude for volatile ones and read the counts).
 * Exit: 0 all compared collections match · 1 differences · 2 refused.
 */
const crypto = require('node:crypto')
const { MongoClient } = require('mongodb'); const { EJSON } = require('bson')
const args = process.argv.slice(2); const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const env = process.env; const refuse = m => { console.error('REFUSING TO RUN — nothing was read: ' + m); process.exit(2) }
const dbOf = u => { try { return decodeURIComponent(new URL(u).pathname.replace(/^\//, '')) } catch { return '' } }
const src = env.SOURCE_MONGODB_URI || '', dst = env.RESTORED_MONGODB_URI || ''
if (env.ATLAS_COMPARE_APPROVAL !== '1') refuse('ATLAS_COMPARE_APPROVAL=1 is required (owner-approved reconciliation).')
if (!/^mongodb(\+srv)?:\/\//.test(src) || !/^mongodb(\+srv)?:\/\//.test(dst)) refuse('SOURCE_MONGODB_URI and RESTORED_MONGODB_URI (mongodb:// or mongodb+srv://) are required.')
const sdb = dbOf(src), ddb = dbOf(dst)
if (!sdb || !ddb) refuse('both URIs must name a database.')
if (src === dst) refuse('source and restored URIs are identical.')
if (flag('confirm-source-db') !== sdb) refuse(`--confirm-source-db must equal the source database name (typed exactly).`)
if (flag('confirm-restored-db') !== ddb) refuse(`--confirm-restored-db must equal the restored database name (typed exactly).`)
const hostOf = u => { try { return new URL(u.replace(/^mongodb(\+srv)?:/, 'http:')).host } catch { return u } }
if (hostOf(src) === hostOf(dst) && sdb === ddb) refuse('source and restored are the same host and database.')
const exclude = new Set((flag('exclude') || '').split(',').map(s => s.trim()).filter(Boolean))

async function fingerprint(db, name) {
  const coll = db.collection(name); const h = crypto.createHash('sha256'); let count = 0
  for await (const d of coll.find({}).sort({ _id: 1 })) { h.update(EJSON.stringify(d, { relaxed: false })); h.update('\n'); count++ }
  const idx = (await coll.indexes()).map(i => i.name).sort()
  return { count, hash: h.digest('hex'), indexes: idx }
}
;(async () => {
  const t0 = Date.now(); const a = await MongoClient.connect(src, { readPreference: 'secondaryPreferred', serverSelectionTimeoutMS: 15000 }); const b = await MongoClient.connect(dst, { readPreference: 'secondaryPreferred', serverSelectionTimeoutMS: 15000 })
  try {
    const names = async c => new Set((await c.db(c === a ? sdb : ddb).listCollections({ type: 'collection' }).toArray()).map(x => x.name).filter(n => !n.startsWith('system.') && !exclude.has(n)))
    const sa = await names(a), sb = await names(b); const all = [...new Set([...sa, ...sb])].sort(); const rows = []; let bad = 0
    for (const n of all) {
      if (!sa.has(n) || !sb.has(n)) { rows.push({ collection: n, ok: false, problem: sa.has(n) ? 'missing in restored' : 'extra in restored' }); bad++; continue }
      const x = await fingerprint(a.db(sdb), n), y = await fingerprint(b.db(ddb), n)
      const problems = []; if (x.count !== y.count) problems.push('count'); if (x.hash !== y.hash) problems.push('content'); if (x.indexes.join() !== y.indexes.join()) problems.push('indexes')
      rows.push({ collection: n, ok: !problems.length, sourceCount: x.count, restoredCount: y.count, problem: problems.join('+') || undefined }); if (problems.length) bad++
    }
    const out = { collections: rows.length, matching: rows.length - bad, differing: bad, excluded: [...exclude], seconds: Math.round((Date.now() - t0) / 1000), results: rows }
    if (args.includes('--json')) console.log(JSON.stringify(out, null, 2))
    else { for (const r of rows) console.log(`${r.ok ? 'MATCH' : 'DIFF '}  ${r.collection.padEnd(34)} ${r.sourceCount ?? '-'} → ${r.restoredCount ?? '-'}${r.problem ? '  ' + r.problem : ''}`); console.log(`\n${bad ? bad + ' COLLECTION(S) DIFFER' : 'ALL COLLECTIONS MATCH'} (${rows.length} compared, ${exclude.size} excluded, ${out.seconds}s)`) }
    process.exitCode = bad ? 1 : 0
  } finally { await a.close(); await b.close() }
})().catch(e => { console.error('ERROR ' + ((e && e.name) || 'Error')); process.exit(3) })
