/**
 * appBaseUrl (Phase 12): the live staging browser test showed the e-mailed reset link was https://host//reset-password (a trailing slash in
 * NEXT_PUBLIC_APP_URL) which the proxy treats as a protected path, so the link opened /sign-in instead of the reset page.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { appBaseUrl } = require('./helpers/authTestKit').load('lib/appUrl.ts')

test('U1. appBaseUrl strips whitespace and trailing slashes, keeps path-less origins intact, and falls back only when unset', () => {
  assert.equal(appBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://x.example/' }), 'https://x.example')
  assert.equal(appBaseUrl({ NEXT_PUBLIC_APP_URL: ' https://x.example/// ' }), 'https://x.example')
  assert.equal(appBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://x.example' }), 'https://x.example')
  assert.equal(appBaseUrl({}), 'http://localhost:3000'); assert.equal(appBaseUrl({ NEXT_PUBLIC_APP_URL: '   ' }), 'http://localhost:3000'); assert.equal(appBaseUrl({}, ''), '')
  for (const u of ['https://x.example/', 'https://x.example//']) assert.equal(`${appBaseUrl({ NEXT_PUBLIC_APP_URL: u })}/reset-password#token=t`, 'https://x.example/reset-password#token=t')
})

test('U2. no application code concatenates NEXT_PUBLIC_APP_URL directly into a link (all go through appBaseUrl)', () => {
  const root = path.resolve(__dirname, '..'); const hits = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.next'].includes(e.name) || e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && !/lib[\\/]appUrl\.ts$/.test(p)) { const t = fs.readFileSync(p, 'utf8'); if (/\$\{\s*process\.env\.NEXT_PUBLIC_APP_URL/.test(t) || /appUrl\s*=\s*process\.env\.NEXT_PUBLIC_APP_URL/.test(t)) hits.push(path.relative(root, p)) } } }
  walk(path.join(root, 'app')); walk(path.join(root, 'lib'))
  assert.deepEqual(hits, [])
})
