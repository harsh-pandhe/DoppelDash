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

/* ───────── trigger-cron.js (Phase 9): safe refusal + header-only secret, against a local fixture server ───────── */
test('R4. trigger-cron refuses unsafe targets before any request, sends the secret only in the Authorization header, prints counts only', async () => {
  const http = require('node:http'), { spawnSync, spawn } = require('node:child_process'), path = require('node:path')
  const script = path.resolve(__dirname, '../scripts/trigger-cron.js'); const SECRET = 'staging-fixture-secret-0123456789'
  const seen = []
  const srv = http.createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization || '' }); const ok = req.headers.authorization === `Bearer ${SECRET}`; res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }); res.end(JSON.stringify(ok ? { sent: 2, contacts: ['Leaky Name'] } : { error: 'Unauthorized' })) })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port
  const run = (env, a = []) => spawnSync(process.execPath, [script, ...a], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' })
  try {
    const base = { STAGING_APP_URL: `http://127.0.0.1:${port}`, STAGING_CRON_SECRET: SECRET, DD_ALLOW_TARGET: `127.0.0.1:${port}` }
    for (const [label, env] of [['no url', { ...base, STAGING_APP_URL: '' }], ['plain http non-loopback', { ...base, STAGING_APP_URL: 'http://example.org' }], ['short secret', { ...base, STAGING_CRON_SECRET: 'x' }], ['no allow-target', { ...base, DD_ALLOW_TARGET: '' }], ['wrong allow-target', { ...base, DD_ALLOW_TARGET: 'other:1' }], ['production host', { ...base, PRODUCTION_HOSTS: `127.0.0.1:${port}` }], ['path in url', { ...base, STAGING_APP_URL: `http://127.0.0.1:${port}/x` }], ['query secret', { ...base, STAGING_APP_URL: `http://127.0.0.1:${port}/?secret=a` }]]) {
      const r = run(env); assert.equal(r.status, 2, `${label} → ${r.status} ${r.stderr}`); assert.match(r.stderr, /REFUSING TO RUN/); assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET))
    }
    assert.equal(seen.length, 0, 'refusals made no request')
    assert.equal(run(base, ['--jobs=receipts-cleanup']).status, 2, 'receipts-cleanup is not triggerable here')
    const ok = await new Promise(res => { const c = spawn(process.execPath, [script, '--repeat=2', '--parallel'], { env: { PATH: process.env.PATH, ...base } }); let o = ''; c.stdout.on('data', d => o += d); c.stderr.on('data', d => o += d); c.on('close', code => res({ code, o })) })
    assert.equal(ok.code, 0, ok.o); assert.match(ok.o, /ALL CHECKS PASSED/); assert.match(ok.o, /sent=2/)
    assert.doesNotMatch(ok.o, new RegExp(SECRET)); assert.doesNotMatch(ok.o, /Leaky Name/, 'response bodies are never echoed')
    assert.ok(seen.every(s => !s.url.includes('secret') && !s.url.includes('?') && !s.url.includes(SECRET)), 'secret never in a URL')
    assert.ok(seen.some(s => s.auth === 'Bearer not-the-secret') && seen.some(s => s.auth === `Bearer ${SECRET}`))
  } finally { srv.close() }
})
