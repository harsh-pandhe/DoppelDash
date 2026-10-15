/**
 * DoppelDash — READ-ONLY index pre-flight. Run before any production index build or deploy that adds/changes a unique index.
 *   MONGODB_URI="<uri>" node web/scripts/preflight-indexes.js [--json]
 * For EVERY mongoose model it reports:
 *   - declared indexes that do not exist in the database (would be built on first connect / syncIndexes);
 *   - existing indexes the schema does not declare (stale);
 *   - for every declared UNIQUE index: existing duplicate key groups (a unique build would FAIL with E11000) — counts only, never document contents.
 * Never writes. Refuses a database whose name lacks "test" unless PREFLIGHT_APPROVAL="<approver>:<ticket>" and --confirm-db=<name> are given.
 */
const path = require('node:path')
const mongoose = require('mongoose')
const args = process.argv.slice(2)
const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const fail = m => { console.error(`[ERROR] ${m}`); process.exit(1) }
const stable = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]))

/** Duplicate groups for one unique index spec (read-only aggregation). */
async function findDuplicates(coll, key, partial) {
  const fields = Object.keys(key)   // a non-partial unique index also collides on MISSING values (they index as null), so those are grouped too
  const groups = await coll.aggregate([{ $match: partial ? partial : {} }, { $group: { _id: Object.fromEntries(fields.map(f => [f.replace(/\./g, '_'), `$${f}`])), n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 1000 }], { allowDiskUse: true }).toArray()
  return { groups: groups.length, documents: groups.reduce((a, g) => a + g.n, 0) }
}
module.exports = { findDuplicates }

if (require.main === module) (async () => {
  const uri = process.env.MONGODB_URI
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) fail('MONGODB_URI is missing or invalid.')
  const db = (uri.replace(/^mongodb(\+srv)?:\/\/[^/]*\//, '').split('?')[0]) || ''
  if (!db) fail('MONGODB_URI must name the database.')
  if (!/test/i.test(db)) {
    if (!/^[^:\s]+:[^\s]+$/.test(process.env.PREFLIGHT_APPROVAL || '')) fail(`"${db}" is not a disposable test database: set PREFLIGHT_APPROVAL="<approver>:<ticket>" to run this READ-ONLY check against it.`)
    if (flag('confirm-db') !== db) fail(`Non-test database: also pass --confirm-db=${db}.`)
  }
  const fs = require('node:fs')
  const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '..') } })
  for (const f of fs.readdirSync(path.resolve(__dirname, '../models')).filter(f => f.endsWith('.ts'))) jiti(`../models/${f}`)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false })
  const report = []
  try {
    const existing = new Set((await mongoose.connection.db.listCollections().toArray()).map(c => c.name))
    for (const name of mongoose.modelNames().sort()) {
      const M = mongoose.model(name); const coll = M.collection
      const declared = M.schema.indexes().map(([key, opts]) => ({ key, opts: opts || {} }))
      const have = existing.has(coll.collectionName) ? await coll.indexes() : []
      const sig = i => stable(i.key) + '|' + (i.opts?.unique || i.unique ? 'u' : '') + '|' + JSON.stringify(i.opts?.partialFilterExpression || i.partialFilterExpression || null)
      const haveSigs = new Set(have.map(i => sig({ key: i.key, unique: i.unique, partialFilterExpression: i.partialFilterExpression })))
      const missing = declared.filter(d => !haveSigs.has(sig(d))).map(d => ({ key: d.key, unique: !!d.opts.unique, partial: !!d.opts.partialFilterExpression }))
      const duplicates = []
      if (existing.has(coll.collectionName)) for (const d of declared.filter(d => d.opts.unique)) {
        const r = await findDuplicates(coll, d.key, d.opts.partialFilterExpression)
        if (r.groups) duplicates.push({ key: d.key, ...r })
      }
      report.push({ model: name, collection: coll.collectionName, declared: declared.length, missingInDb: missing, duplicatesBlockingUnique: duplicates })
    }
  } finally { await mongoose.disconnect() }
  const problems = report.filter(r => r.duplicatesBlockingUnique.length)
  if (args.includes('--json')) console.log(JSON.stringify({ readOnly: true, database: db, models: report.length, withMissingIndexes: report.filter(r => r.missingInDb.length).length, withBlockingDuplicates: problems.length, report }, null, 2))
  else {
    console.log(`[read-only] database "${db}": ${report.length} models; ${report.filter(r => r.missingInDb.length).length} with indexes not yet built; ${problems.length} with duplicates that would BLOCK a unique index build.`)
    for (const r of report.filter(r => r.missingInDb.length || r.duplicatesBlockingUnique.length)) console.log(` - ${r.model}: missing ${r.missingInDb.length}${r.duplicatesBlockingUnique.length ? `, BLOCKING duplicates in ${r.duplicatesBlockingUnique.map(d => JSON.stringify(d.key)).join(' ')}` : ''}`)
  }
  process.exit(problems.length ? 2 : 0)
})().catch(e => { console.error('[ERROR]', e && e.message ? e.message : e); process.exit(1) })
