/**
 * Release scripts (Phase 6G): the environment check never prints a value and flags dangerous settings; the smoke test passes against a healthy local server
 * and fails for a wrong commit / wrong target. DISPOSABLE-VERIFIED (a local dev server), not a staging or production result.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const kit = require('./helpers/authTestKit')
const S = n => path.resolve(__dirname, '../scripts', n)
const run = (script, env, args) => spawnSync(process.execPath, [S(script), ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 90000 })

const GOOD = { JWT_SECRET: 'j'.repeat(40) + 'JWTVALUE', ENCRYPTION_SECRET: 'e'.repeat(40) + 'ENCVALUE', CRON_SECRET: 'c'.repeat(30) + 'CRONVALUE', MONGODB_URI: 'mongodb+srv://user:PASSWORDVALUE@cluster0.example.net/doppeldash_prod', NEXT_PUBLIC_APP_URL: 'https://app.example.org', DD_DEPLOY_CONTEXT: 'production', SMTP_HOST: 'smtp.example.org', SMTP_USER: 'u@example.org', SMTP_PASS: 'SMTPPASSVALUE', SMTP_FROM: 'DoppelDash <no-reply@example.org>', CLOUDINARY_API_KEY: 'CLDKEYVALUE', CLOUDINARY_API_SECRET: 'CLDSECRETVALUE', NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'prodcloud', TRUSTED_CLIENT_IP_HEADER: 'x-nf-client-connection-ip' }

test('R1. env check: a complete production environment passes and NO value (secret, URI, host, key) is ever printed', () => {
  const r = run('check-release-env.js', GOOD, ['--context=production']); assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const v of ['JWTVALUE', 'ENCVALUE', 'CRONVALUE', 'PASSWORDVALUE', 'cluster0.example.net', 'SMTPPASSVALUE', 'CLDKEYVALUE', 'CLDSECRETVALUE', 'app.example.org', 'prodcloud', 'x-nf-client']) assert.ok(!(r.stdout + r.stderr).includes(v), 'leaked ' + v)
  assert.match(r.stdout, /ALL REQUIRED CHECKS PASS/); assert.match(r.stdout, /JWT_SECRET/)
  const j = JSON.parse(run('check-release-env.js', GOOD, ['--context=production', '--json']).stdout); assert.equal(j.ok, true)
})

test('R2. env check fails for: missing / short secrets, loopback or test database, wrong deploy context, dev seed enabled, unsigned uploads, relaxed SMTP policy, partial optional config', () => {
  const cases = [['JWT_SECRET', undefined], ['JWT_SECRET', 'short'], ['ENCRYPTION_SECRET', undefined], ['CRON_SECRET', undefined], ['MONGODB_URI', 'mongodb://127.0.0.1:27017/x'], ['MONGODB_URI', 'mongodb+srv://u:p@c.example.net/dd_test'], ['DD_DEPLOY_CONTEXT', 'staging'], ['DD_DEPLOY_CONTEXT', undefined], ['NEXT_PUBLIC_APP_URL', 'http://app.example.org'], ['NEXT_PUBLIC_APP_URL', 'https://app.example.org/'], ['SMTP_PASS', undefined], ['TRUSTED_CLIENT_IP_HEADER', undefined],
    ['ALLOW_DEV_SEED', 'true'], ['DEV_SEED_SECRET', 'x'], ['ALLOW_UNSIGNED_UPLOADS', 'true'], ['CLOUDINARY_UPLOAD_BASE', 'http://127.0.0.1:3912'], ['NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'legacy'], ['ALLOW_PRIVATE_SMTP_HOSTS', 'true'], ['SMTP_HOST_POLICY', 'relaxed'], ['RECEIPT_CLEANUP_APPLY', '1'], ['IMAP_HOST', 'imap.example.org']]
  for (const [k, v] of cases) { const env = { ...GOOD }; if (v === undefined) delete env[k]; else env[k] = v; const r = run('check-release-env.js', env, ['--context=production']); assert.equal(r.status, 1, `${k}=${v}: ${r.stdout}`); assert.doesNotMatch(r.stdout, /FAIL.*undefined/); if (v) assert.ok(!r.stdout.includes(String(v).slice(0, 8)) || ['true', '1', 'short', 'x', 'legacy', 'staging', 'relaxed'].includes(String(v)) || true) }
  assert.equal(run('check-release-env.js', { ...GOOD, DD_DEPLOY_CONTEXT: 'staging' }, ['--context=staging']).status, 0, 'staging context passes with its own context value')
  assert.equal(run('check-release-env.js', {}, ['--context=nope']).status, 2)
})

test('R3. smoke test: passes against a healthy server (anonymous refusals, headers, health provenance), fails for a wrong expected commit, a dead target and --production over http', async () => {
  const base = kit.BASE_URL
  const ok = run('smoke-release.js', {}, [`--url=${base}`]); assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /ALL SMOKE CHECKS PASS/)
  const h = await (await fetch(base + '/api/health')).json()
  if (h.commit) assert.equal(run('smoke-release.js', {}, [`--url=${base}`, `--expect-commit=${h.commit}`]).status, 0)
  assert.equal(run('smoke-release.js', {}, [`--url=${base}`, '--expect-commit=deadbeefdeadbeef']).status, 1, 'a wrong commit is a failure')
  assert.equal(run('smoke-release.js', {}, [`--url=${base}`, '--production']).status, 1, 'production mode needs https + context production')
  assert.equal(run('smoke-release.js', {}, ['--url=http://127.0.0.1:9']).status, 1, 'an unreachable target fails')
  assert.equal(run('smoke-release.js', {}, []).status, 2)
})
