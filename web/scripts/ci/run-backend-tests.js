#!/usr/bin/env node
/**
 * Deterministic backend test runner (local and CI).
 *   - generates throw-away secrets and a throw-away database name, uses ONLY loopback services and the local fake providers;
 *   - starts `next dev` on TEST_URL's port with its own build directory, waits for it, seeds, runs every tests/*.test.js in sorted order
 *     (one process each), and runs z_final_log_secret_scan LAST against the captured server log;
 *   - fails on any failed test, any skip not listed in baseline.json allowedSkips (each with a documented reason), a missing summary, or fewer tests/files than scripts/ci/baseline.json.
 * Refuses to run against a non-loopback MongoDB, and refuses to overwrite an existing web/.env.local outside CI.
 */
const { spawn, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const rnd = (n = 24) => crypto.randomBytes(n).toString('hex')
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8'))
const outDir = process.env.TEST_ARTIFACT_DIR || path.join(root, 'test-artifacts')
fs.mkdirSync(outDir, { recursive: true })

const dbName = process.env.DD_CI_DB || `dd_ci_${rnd(5)}_test`
const mongo = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(mongo)) { console.error('Refusing to run: MONGODB_URI must be a loopback MongoDB.'); process.exit(2) }
if (!/_test(\?|$)/.test(mongo.split('/').pop())) { console.error('Refusing to run: the database name must end in _test.'); process.exit(2) }
const port = new URL(process.env.TEST_URL || 'http://localhost:3100').port || '3100'
const fake = { ...require(path.join(root, 'tests/helpers/fakeProviders.js')).ENV, ...require(path.join(root, 'tests/helpers/rtdnFixture.js')).ENV }   // fake providers + the RTDN (Pub/Sub OIDC) test settings
const env = {
  ...process.env, ...fake,
  MONGODB_URI: mongo, TEST_URL: `http://localhost:${port}`, NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  JWT_SECRET: process.env.JWT_SECRET || rnd(32), ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || rnd(32), CRON_SECRET: process.env.CRON_SECRET || rnd(24),
  DEV_SEED_SECRET: process.env.DEV_SEED_SECRET || rnd(24), SETUP_SECRET: process.env.SETUP_SECRET || rnd(24), ALLOW_DEV_SEED: 'true',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_SECURE: 'false', SMTP_USER: 'ci-user', SMTP_PASS: process.env.SMTP_PASS || rnd(16), SMTP_FROM: 'DoppelDash CI <no-reply@example.test>',
  REFRESH_REUSE_GRACE_MS: '1500', RECEIPT_CLEANUP_APPLY: '1', RETENTION_PURGE_APPLY: '1', OCR_DEADLINE_MS: '6000', TRAVEL_FAILPOINTS: '1', TRAVEL_CONVERSION_WAIT_MS: '3000',
  TRUSTED_CLIENT_IP_HEADER: 'x-test-client-ip', SUPPORT_PROVIDER_TIMEOUT_MS: '1500',   // support-chat tests: trusted client-IP header + a short provider timeout (non-production only)
  DD_SERVER_LOG: path.join(outDir, 'dev-server.log'),
}
// The final secret scan reads the secrets from web/.env.local (same file the server loads) — generate it on a CI runner only.
const envFile = path.join(root, '.env.local')
if (fs.existsSync(envFile) && !process.env.CI) { console.error('Refusing to overwrite an existing web/.env.local outside CI. Run in a clean checkout or with CI=true.'); process.exit(2) }
const keys = ['MONGODB_URI', 'NEXT_PUBLIC_APP_URL', 'JWT_SECRET', 'ENCRYPTION_SECRET', 'CRON_SECRET', 'DEV_SEED_SECRET', 'SETUP_SECRET', 'ALLOW_DEV_SEED', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'REFRESH_REUSE_GRACE_MS']
fs.writeFileSync(envFile, keys.map(k => `${k}=${JSON.stringify(env[k]).replace(/^"|"$/g, '')}`).join('\n') + '\n', { mode: 0o600 })

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitForServer() {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`${env.TEST_URL}/api/auth/me`); if (r.status === 401) return } catch { /* not up yet */ } await sleep(1000) }
  throw new Error('dev server did not become ready in 120 s')
}
const parse = out => { const g = k => { const m = new RegExp(`^# ${k} (\\d+)`, 'm').exec(out); return m ? Number(m[1]) : null }; return { tests: g('tests'), pass: g('pass'), fail: g('fail'), skipped: g('skipped') } }

async function main() {
  const logFd = fs.openSync(env.DD_SERVER_LOG, 'w')
  const server = spawn('npx', ['next', 'dev', '-p', port], { cwd: root, env: { ...env, NEXT_DIST_DIR: '.next-ci-test' }, stdio: ['ignore', logFd, logFd], detached: true })
  const stop = () => { try { process.kill(-server.pid, 'SIGTERM') } catch { /* already gone */ } }
  process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130) })
  const results = []; let failed = false
  try {
    await waitForServer()
    const seed = await fetch(`${env.TEST_URL}/api/dev/seed`, { method: 'POST', headers: { 'x-seed-secret': env.DEV_SEED_SECRET } })
    if (!seed.ok) throw new Error(`seed failed: HTTP ${seed.status}`)
    const filter = process.env.TEST_FILTER
    const files = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js') && (!filter || f.includes(filter))).sort()
    const ordered = [...files.filter(f => !f.startsWith('z_final')), ...files.filter(f => f.startsWith('z_final'))]   // the log scan is ALWAYS last
    for (const f of ordered) {
      const t0 = Date.now()
      const r = spawnSync('node', [path.join('tests', f)], { cwd: root, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })
      const out = (r.stdout || '') + (r.stderr || ''); fs.writeFileSync(path.join(outDir, f + '.log'), out)
      const s = parse(out); const allowed = (baseline.allowedSkips || []).filter(a => a.file === f && !(a.unlessEnv && process.env[a.unlessEnv])).reduce((n, a) => n + a.max, 0)
      const ok = s.tests !== null && s.fail === 0 && s.skipped <= allowed && s.pass + s.skipped === s.tests && r.status === 0
      results.push({ file: f, ...s, ok, seconds: Math.round((Date.now() - t0) / 1000) })
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(44)} tests=${s.tests} pass=${s.pass} fail=${s.fail} skipped=${s.skipped} (${results.at(-1).seconds}s)`)
      if (!ok) failed = true
    }
  } catch (e) { console.error('Runner error:', e.message); failed = true } finally { stop() }

  const sum = k => results.reduce((a, r) => a + (r[k] || 0), 0)
  const total = { files: results.length, tests: sum('tests'), pass: sum('pass'), fail: sum('fail'), skipped: sum('skipped') }
  console.log(`\nTOTAL files=${total.files} tests=${total.tests} pass=${total.pass} fail=${total.fail} skipped=${total.skipped}   (baseline files=${baseline.files} tests=${baseline.tests} skipped=${baseline.skipped})`)
  if (!process.env.TEST_FILTER && (total.files < baseline.files || total.tests < baseline.tests)) { console.error('Fewer files/tests than the baseline — coverage regressed.'); failed = true }
  if (total.skipped > baseline.skipped) { console.error('Skipped tests exceed the baseline.'); failed = true }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ total, results }, null, 2))
  process.exit(failed ? 1 : 0)
}
main()
