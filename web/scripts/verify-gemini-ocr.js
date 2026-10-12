#!/usr/bin/env node
/**
 * One real Gemini OCR call on the synthetic receipt. See scripts/lib/geminiOcrCheck.js for the safety rules.
 *   GEMINI_API_KEY=<key> GEMINI_OCR_APPROVED=1 node scripts/verify-gemini-ocr.js
 * Exit codes: 0 passed · 1 failed · 2 refused to run (nothing was contacted).
 */
const { preflight, run } = require('./lib/geminiOcrCheck')
const pf = preflight(process.env)
if (!pf.ok) { console.error('REFUSING TO RUN — nothing was contacted:'); for (const p of pf.problems) console.error('  - ' + p); process.exit(2) }
run(process.env).then(r => process.exit(r.ok ? 0 : 1)).catch(e => { console.error('ERROR ' + ((e && e.name) || 'Error')); process.exit(3) })
