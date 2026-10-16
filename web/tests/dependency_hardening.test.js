/**
 * Dependency remediation guards (Phase 6B): the patched floor for the reachable advisories is pinned, and the Next 15 header-order change that
 * silently dropped the private-file CSP is covered. Real server, throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const kit = require('./helpers/authTestKit')

const gte = (v, min) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) } return true }
const installed = n => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules', n, 'package.json'), 'utf8')).version

test('V1. installed versions are at or above the patched floor: next >= 15.5.24 (RCE/DoS advisories), nodemailer >= 10.1.1 (incl. the nested copies), mailparser >= 3.9.39, imapflow >= 1.7.8', () => {
  assert.ok(gte(installed('next'), '15.5.24'), 'next ' + installed('next'))
  assert.ok(gte(installed('nodemailer'), '10.1.1'), 'nodemailer ' + installed('nodemailer'))
  assert.ok(gte(installed('mailparser'), '3.9.39')); assert.ok(gte(installed('imapflow'), '1.7.8'))
  const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package-lock.json'), 'utf8'))
  const copies = Object.entries(lock.packages).filter(([k]) => /(^|\/)node_modules\/nodemailer$/.test(k)).map(([k, v]) => `${k}@${v.version}`)
  assert.ok(copies.length >= 1 && copies.every(c => gte(c.split('@').pop(), '10.1.1')), 'every nodemailer copy in the lockfile is patched: ' + copies.join(', '))
})

test('V2. every ordinary page and API response still carries the site-wide CSP and security headers (the header rules were split for the private-file paths)', async () => {
  for (const p of ['/sign-in', '/api/health', '/api/auth/me', '/privacy']) {
    const r = await kit.api(p, { redirect: 'manual' }); const csp = r.headers.get('content-security-policy') || ''
    assert.match(csp, /frame-ancestors 'none'/, p); assert.match(csp, /default-src 'self'/, p)
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p); assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p); assert.match(r.headers.get('strict-transport-security') || '', /max-age=/, p)
  }
})

test('V3. the private-file proxies keep their OWN locked-down CSP (Next 15 applies config headers after route headers, which silently replaced it): the config excludes those paths from the site CSP and the served-file contract is asserted end to end', () => {
  const cfg = fs.readFileSync(path.resolve(__dirname, '../next.config.mjs'), 'utf8')
  assert.match(cfg, /filter\(h => h\.key !== 'Content-Security-Policy'\)/); assert.match(cfg, /document\|receipt\|itinerary/)
  // the end-to-end assertions (CSP `default-src 'none'; sandbox` on a served medical document / receipt) live in leave_medical_docs D2 and receipt_ocr_vertical P1 — both failed
  // after the Next 15 upgrade until the header rules were split, and pass now.
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/uploads/privateFile.ts'), 'utf8'); assert.match(src, /default-src 'none'; sandbox/)
})
