/**
 * DoppelDash — one-time, idempotent provisioning of the Doppelmayr India outbound-mail brand.
 *
 * Writes ONLY stored organisation configuration (OrgSettings.brandName / brandColor) for the existing
 * `org_doppelmayr` tenant. It never touches Organization entitlement fields (plan, lifetimeGrant,
 * webEnabled, androidEnabled), never overwrites a brand value that is already set, and never changes
 * the legal company name (OrgSettings.companyName). It is NOT run at application startup.
 *
 * USAGE (see web/docs/DOPPELMAYR_BRAND_PROVISIONING.md):
 *   1) dry run — default, writes nothing:
 *        MONGODB_URI="<connection string>" node web/scripts/provision-doppelmayr-brand.js
 *   2) apply — requires an explicit database-name confirmation:
 *        MONGODB_URI="<connection string>" node web/scripts/provision-doppelmayr-brand.js --apply --confirm-db=<database name>
 *
 * Never prints the connection string (only the database name).
 */
const path = require('node:path')
const mongoose = require('mongoose')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const confirmDb = (args.find(a => a.startsWith('--confirm-db=')) || '').slice('--confirm-db='.length)

function fail(msg) { console.error(`[ERROR] ${msg}`); process.exit(1) }

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) fail('MONGODB_URI is missing or invalid.')
  const dbName = (uri.replace(/^mongodb(\+srv)?:\/\/[^/]*\//, '').split('?')[0]) || ''
  if (!dbName) fail('MONGODB_URI must name the database explicitly (…/<database>).')
  if (apply && confirmDb !== dbName) fail(`--apply requires --confirm-db=${dbName} (typed exactly) so the wrong database can never be modified by accident.`)

  const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '..') } })
  const { ensureDoppelmayrBrand, DOPPELMAYR_PROVISIONING } = jiti('../lib/provisioning/doppelmayrBrand.ts')
  process.env.MONGODB_URI = uri

  console.log(`[1/3] Target database: "${dbName}"  mode: ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
  try {
    console.log('[2/3] Checking stored brand configuration...')
    const r = await ensureDoppelmayrBrand(DOPPELMAYR_PROVISIONING, { dryRun: !apply })
    if (!r.orgFound) fail(`Organization "${DOPPELMAYR_PROVISIONING.orgId}" does not exist in this database — nothing to provision (and none is created).`)
    if (r.changed.length === 0) {
      console.log('[3/3] Already provisioned — no changes needed.')
    } else if (apply) {
      console.log(`[3/3] Applied: ${r.changed.join(', ')}${r.settingsCreated ? ' (settings document created)' : ''}.`)
    } else {
      console.log(`[3/3] DRY RUN — would write: ${r.changed.join(', ')}${r.settingsCreated ? ' (settings document would be created)' : ''}. Re-run with --apply --confirm-db=${dbName} to apply.`)
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch(err => { console.error('[ERROR]', err && err.message ? err.message : err); process.exit(1) })
