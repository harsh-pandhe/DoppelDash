/**
 * DoppelDash — READ-ONLY inventory / plan of legacy (public-URL) leave medical documents. Run book: web/docs/LEGACY_MEDICAL_MIGRATION.md
 *
 *   MONGODB_URI="<uri>" node web/scripts/inventory-legacy-medical-docs.js [--org-id=<org>] [--plan] [--probe-public] [--out=<file>]
 *
 * Safety:
 *  - never writes to the database or to storage; there is NO apply mode in this script;
 *  - refuses any database whose name does not contain "test" unless LEGACY_INVENTORY_APPROVAL="<approver>:<ticket>" is set AND
 *    --confirm-db=<database name> is typed exactly (an explicit owner approval gate for non-disposable data);
 *  - prints no URL, no file name and no connection string; `--out` is written with mode 0600.
 *  - `--probe-public` additionally issues HEAD requests to res.cloudinary.com for legacy URLs (off by default).
 */
const path = require('node:path')
const fs = require('node:fs')
const mongoose = require('mongoose')
const args = process.argv.slice(2)
const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const fail = m => { console.error(`[ERROR] ${m}`); process.exit(1) }

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) fail('MONGODB_URI is missing or invalid.')
  const db = (uri.replace(/^mongodb(\+srv)?:\/\/[^/]*\//, '').split('?')[0]) || ''
  if (!db) fail('MONGODB_URI must name the database explicitly.')
  if (!/test/i.test(db)) {
    if (!/^[^:\s]+:[^\s]+$/.test(process.env.LEGACY_INVENTORY_APPROVAL || '')) fail(`"${db}" is not a disposable test database: set LEGACY_INVENTORY_APPROVAL="<approver>:<ticket>" (owner approval) to run the read-only inventory against it.`)
    if (flag('confirm-db') !== db) fail(`Non-test database: also pass --confirm-db=${db} (typed exactly).`)
  }
  const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '..') } })
  const lib = jiti('../lib/migration/legacyMedicalInventory.ts')
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
  try {
    const inv = await lib.collectInventory({ orgId: flag('org-id') || undefined })
    const probe = args.includes('--probe-public') ? await lib.probePublic(inv.items) : null
    const report = { ...lib.buildReport(inv, { db, probe }), ...(args.includes('--plan') ? { plan: lib.buildPlan(inv) } : {}) }
    const json = JSON.stringify(report, null, 2)
    if (flag('out')) { fs.writeFileSync(flag('out'), json, { mode: 0o600 }); console.log(`Report written to ${flag('out')} (mode 600). Documents: ${report.totals.documents}, legacy public: ${report.legacyPublic.count}.`) }
    else console.log(json)
  } finally { await mongoose.disconnect() }
}
main().catch(err => { console.error('[ERROR]', err && err.message ? err.message : err); process.exit(1) })
