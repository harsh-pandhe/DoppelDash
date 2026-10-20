/**
 * No static one-time code or reviewer secret may be committed in documentation (the repository is PUBLIC). Phase 12 launch review found a Play reviewer
 * OTP written in two store documents; the production value must be treated as burned and rotated (docs/LAUNCH_CUTOVER_PLAN.md R-7).
 * Scans tracked documentation for "enter: <6 digits>"-style instructions and for a password/OTP line carrying a literal value.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('D1. no tracked document instructs the reader to type a literal 6-digit code, and no password/OTP line carries a literal value', () => {
  // web/docs always exists; the repository-level docs/ exists in a full checkout (CI) and is scanned when present.
  const dirs = [path.resolve(__dirname, '../docs'), path.resolve(__dirname, '../../docs')].filter(d => fs.existsSync(d))
  assert.ok(dirs.length >= 1, 'documentation directory found')
  const files = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.md$/.test(e.name)) files.push(p) } }; dirs.forEach(walk)
  assert.ok(files.length > 5, 'scanned the documentation set')
  const hits = []
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => {
      if (/(enter|type|use|code is|otp is|otp:|verification code)[^\n`]{0,40}[:`'" ]\b\d{6}\b/i.test(l) && !/\b(20\d\d|\d{6}\.\d)/.test(l) && /(otp|verification|2-?factor|code)/i.test(l)) hits.push(`${path.basename(f)}:${i + 1}`)
      if (/\b(password|passcode|otp)\b\s*[:=]\s*`?[A-Za-z0-9!@#$%^&*_-]{6,}`?\s*$/i.test(l) && !/<[^>]+>|\.{3}|\*\*\*|xxx|placeholder|example|your|redacted|masked|\$\{|\bnull\b|\bnone\b/i.test(l)) hits.push(`${path.basename(f)}:${i + 1}`)
    })
  }
  assert.deepEqual(hits, [], 'documentation contains a literal OTP/credential (path:line listed; values are not printed)')
})
