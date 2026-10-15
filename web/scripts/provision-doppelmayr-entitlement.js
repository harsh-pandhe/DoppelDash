/**
 * DoppelDash — controlled, idempotent provisioning of the Doppelmayr India lifetime-Premium + Web/Android entitlement (P0-03).
 *
 * Writes ONLY: plan=premium, entitlementSource=lifetime_grant, lifetimeGrant=true, webEnabled=true, androidEnabled=true on the EXISTING
 * organisation (never creates one) and one audit entry. Not run at application startup. Run book: web/docs/DOPPELMAYR_ENTITLEMENT_PROVISIONING.md
 *
 *   1) dry run (default, writes nothing):
 *        MONGODB_URI="<connection string>" node web/scripts/provision-doppelmayr-entitlement.js [--org-id=org_doppelmayr]
 *   2) apply — needs ALL of: --apply, --confirm-db=<database name>, --confirm-org=<org id>, --actor="<name>", --reason="<why>"
 *
 * Never prints the connection string (only the database name).
 */
const path = require('node:path')
const mongoose = require('mongoose')

const args = process.argv.slice(2)
const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const apply = args.includes('--apply')
const fail = msg => { console.error(`[ERROR] ${msg}`); process.exit(1) }

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) fail('MONGODB_URI is missing or invalid.')
  const dbName = (uri.replace(/^mongodb(\+srv)?:\/\/[^/]*\//, '').split('?')[0]) || ''
  if (!dbName) fail('MONGODB_URI must name the database explicitly (…/<database>).')
  const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '..') } })
  const { ensureLifetimeEntitlement, DOPPELMAYR_ENTITLEMENT } = jiti('../lib/provisioning/doppelmayrEntitlement.ts')
  const orgId = flag('org-id') || DOPPELMAYR_ENTITLEMENT.orgId
  if (apply) {
    if (flag('confirm-db') !== dbName) fail(`--apply requires --confirm-db=${dbName} (typed exactly).`)
    if (flag('confirm-org') !== orgId) fail(`--apply requires --confirm-org=${orgId} (typed exactly).`)
    if (!flag('actor').trim() || !flag('reason').trim()) fail('--apply requires --actor="<name>" and --reason="<why>" (they are written to the audit log).')
  }
  process.env.MONGODB_URI = uri
  console.log(`[1/3] Target database: "${dbName}"  organisation: "${orgId}"  mode: ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
  try {
    const r = await ensureLifetimeEntitlement({ orgId }, { dryRun: !apply, actor: flag('actor'), reason: flag('reason') })
    if (!r.orgFound) fail(`Organization "${orgId}" does not exist in this database — nothing to provision (and none is created).`)
    console.log('[2/3] Stored values now:', JSON.stringify(r.before))
    if (r.changed.length === 0) console.log('[3/3] Already provisioned — no changes, no audit entry.')
    else if (apply) console.log(`[3/3] Applied: ${r.changed.join(', ')}. Audit entry written: ${r.audited}.`)
    else console.log(`[3/3] DRY RUN — would write: ${r.changed.join(', ')}. Re-run with --apply --confirm-db=${dbName} --confirm-org=${orgId} --actor="…" --reason="…".`)
  } finally { await mongoose.disconnect() }
}
main().catch(err => { console.error('[ERROR]', err && err.message ? err.message : err); process.exit(1) })
