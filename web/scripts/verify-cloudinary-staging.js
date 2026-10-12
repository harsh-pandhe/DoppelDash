#!/usr/bin/env node
/**
 * OPERATOR-RUN verification of private receipt storage against a REAL Cloudinary STAGING cloud (optionally one real Gemini call).
 * Not run in CI. Refuses to start unless every safety rule in scripts/lib/stagingVerify.js `preflight` passes — before any upload,
 * deletion, database write or network call. It never loads .env files, never reads deployment tooling, never inherits credentials
 * from another process: only the variables you export in THIS shell are used. Output is redacted (no credentials, URLs or asset ids).
 *
 * Full procedure, variables and expected results: docs/RECEIPT_STORAGE_AND_OCR.md §12.
 * Exit codes: 0 all checks passed · 1 a check failed / unexpected error · 2 refused to run (unsafe or incomplete configuration).
 */
const { preflight, run, makeRedactor } = require('./lib/stagingVerify')

const env = process.env
const pf = preflight(env)
if (!pf.ok) {
  const redact = makeRedactor([env.CLOUDINARY_API_SECRET, env.CLOUDINARY_API_KEY, env.STAGING_CRON_SECRET, env.GEMINI_API_KEY])
  console.error('REFUSING TO RUN — nothing was uploaded, deleted or contacted:')
  for (const p of pf.problems) console.error('  - ' + redact(p))
  process.exit(2)
}
run(pf.config).then(r => process.exit(r.exitCode)).catch(e => { console.error('HARNESS ERROR ' + ((e && e.name) || 'Error')); process.exit(3) })
