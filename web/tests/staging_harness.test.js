/**
 * Feature 3.1.6 — safety and logic tests for the OPERATOR-RUN Cloudinary staging harness (scripts/verify-cloudinary-staging.js,
 * scripts/lib/stagingVerify.js).
 *
 * IMPORTANT — what these tests are and are not: they exercise the harness against the LOCAL FAKE provider and a throwaway local
 * database. They prove the harness's own safety rules and logic. They are NOT live verification: nothing here contacts, or says
 * anything about, real Cloudinary or real Gemini behaviour. The programmatic `__fakeProviderForTests` option is only used by this file;
 * the entry script never sets it and `preflight` refuses every override.
 *
 * No subprocess in this file is ever given an environment that passes `preflight` (which would make it contact a real cloud):
 * `refused()` asserts the opposite before spawning.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const mongoose = require('mongoose')
const fake = require('./helpers/fakeProviders')
const { preflight, run, makeRedactor, makeOwnership, ID_RE } = require('../scripts/lib/stagingVerify')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/verify-cloudinary-staging.js')
const SECRET = 'S3CR3T-DO-NOT-PRINT-xyz987'
const KEY = '123456789012345'
const CRON = 'c'.repeat(8) + 'CRONSECRET' + 'z'.repeat(8)
const dbName = () => 'dd_staging_verify_' + crypto.randomBytes(4).toString('hex')
const base = (over = {}) => ({
  CLOUDINARY_CLOUD_NAME: 'stg-cloud', CLOUDINARY_API_KEY: KEY, CLOUDINARY_API_SECRET: SECRET, CLOUDINARY_STAGING_CONFIRM: 'stg-cloud',
  PRODUCTION_CLOUDINARY_CLOUD_NAME: 'prod-cloud', MONGODB_URI: `mongodb://127.0.0.1:27017/${dbName()}`,
  STAGING_APP_URL: 'http://127.0.0.1:3104', STAGING_CRON_SECRET: CRON, ...over,
})
const drop = (env, keys) => { const e = { ...env }; for (const k of keys) delete e[k]; return e }

let providers
test.before(async () => { providers = await fake.ensureFakeProviders() })
test.after(async () => {
  await providers.stop()
  // drop exactly the throwaway databases THIS file created (an app server may have re-created one after the harness dropped it)
  const { MongoClient } = require('mongodb')                      // native driver: no model registration, so nothing is auto-created anywhere
  const c = await MongoClient.connect('mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 5000 }).catch(() => null)
  if (c) { for (const db of createdDbs) if (db.startsWith('dd_staging_verify_')) await c.db(db).dropDatabase().catch(() => {}); await c.close() }
})

/* ═════════ A. preflight rules (pure) ═════════ */
test('P0. a complete, safe configuration passes preflight (and this is the ONLY kind that would ever contact a provider)', () => {
  const r = preflight(base()); assert.equal(r.ok, true, r.problems.join(';'))
  assert.equal(preflight(base({ STAGING_APP_URL: undefined, STAGING_CRON_SECRET: undefined, STAGING_CLEANUP_APPLY: '1' })).ok, true)
})

const BAD = [
  ['confirmation missing', drop(base(), ['CLOUDINARY_STAGING_CONFIRM']), /CLOUDINARY_STAGING_CONFIRM/],
  ['confirmation wrong', base({ CLOUDINARY_STAGING_CONFIRM: 'other' }), /CLOUDINARY_STAGING_CONFIRM/],
  ['confirmation differs only by case', base({ CLOUDINARY_STAGING_CONFIRM: 'STG-CLOUD' }), /CLOUDINARY_STAGING_CONFIRM/],
  ['confirmation has trailing space', base({ CLOUDINARY_STAGING_CONFIRM: 'stg-cloud ' }), /CLOUDINARY_STAGING_CONFIRM/],
  ['production cloud name absent', drop(base(), ['PRODUCTION_CLOUDINARY_CLOUD_NAME']), /PRODUCTION_CLOUDINARY_CLOUD_NAME is required/],
  ['production cloud name empty', base({ PRODUCTION_CLOUDINARY_CLOUD_NAME: '  ' }), /PRODUCTION_CLOUDINARY_CLOUD_NAME is required/],
  ['production cloud name malformed', base({ PRODUCTION_CLOUDINARY_CLOUD_NAME: 'https://prod' }), /PRODUCTION_CLOUDINARY_CLOUD_NAME is malformed/],
  ['staging == production', base({ PRODUCTION_CLOUDINARY_CLOUD_NAME: 'stg-cloud' }), /IS the production cloud/],
  ['staging == production (case)', base({ PRODUCTION_CLOUDINARY_CLOUD_NAME: 'STG-Cloud' }), /IS the production cloud/],
  ['staging == production (whitespace)', base({ PRODUCTION_CLOUDINARY_CLOUD_NAME: ' stg-cloud ' }), /IS the production cloud/],
  ['NEXT_PUBLIC cloud is the production cloud', base({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'prod-cloud' }), /NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME/],
  ['NEXT_PUBLIC cloud differs', base({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'something' }), /NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME/],
  ['NODE_ENV=production', base({ NODE_ENV: 'production' }), /NODE_ENV=production/],
  ['cloud name missing', drop(base(), ['CLOUDINARY_CLOUD_NAME']), /CLOUDINARY_CLOUD_NAME is required/],
  ['cloud name malformed (url)', base({ CLOUDINARY_CLOUD_NAME: 'https://x', CLOUDINARY_STAGING_CONFIRM: 'https://x' }), /CLOUDINARY_CLOUD_NAME is malformed/],
  ['cloud name malformed (slash)', base({ CLOUDINARY_CLOUD_NAME: 'a/b', CLOUDINARY_STAGING_CONFIRM: 'a/b' }), /malformed/],
  ['cloud name malformed (space)', base({ CLOUDINARY_CLOUD_NAME: 'a b', CLOUDINARY_STAGING_CONFIRM: 'a b' }), /malformed/],
  ['api key missing', drop(base(), ['CLOUDINARY_API_KEY']), /CLOUDINARY_API_KEY is required/],
  ['api key malformed', base({ CLOUDINARY_API_KEY: 'a b' }), /CLOUDINARY_API_KEY is malformed/],
  ['api secret missing', drop(base(), ['CLOUDINARY_API_SECRET']), /CLOUDINARY_API_SECRET is required/],
  ['api secret too short', base({ CLOUDINARY_API_SECRET: 'short' }), /CLOUDINARY_API_SECRET is malformed/],
  ['upload base override (fake-provider config)', base({ CLOUDINARY_UPLOAD_BASE: 'http://127.0.0.1:3912/cloud' }), /CLOUDINARY_UPLOAD_BASE/],
  ['delivery base override', base({ CLOUDINARY_DELIVERY_BASE: 'http://127.0.0.1:3912/cloud' }), /CLOUDINARY_DELIVERY_BASE/],
  ['unsigned uploads enabled', base({ ALLOW_UNSIGNED_UPLOADS: '1' }), /ALLOW_UNSIGNED_UPLOADS/],
  ['CLOUDINARY_URL present', base({ CLOUDINARY_URL: 'cloudinary://k:s@prod-cloud' }), /CLOUDINARY_URL/],
  ['unsigned preset configured', base({ NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: 'p' }), /UPLOAD_PRESET/],
  ['Gemini key without confirmation', base({ GEMINI_API_KEY: 'k' }), /GEMINI_STAGING_CONFIRM/],
  ['Gemini with base override', base({ GEMINI_API_KEY: 'k', GEMINI_STAGING_CONFIRM: '1', GEMINI_API_BASE: 'http://127.0.0.1:3912/gemini' }), /GEMINI_API_BASE/],
  ['Gemini with Ollama fallback configured', base({ GEMINI_API_KEY: 'k', GEMINI_STAGING_CONFIRM: '1', OLLAMA_URL: 'http://127.0.0.1:3912/ollama' }), /OLLAMA_URL/],
  ['database missing', drop(base(), ['MONGODB_URI']), /MONGODB_URI is required/],
  ['database is Atlas (srv)', base({ MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net/dd_staging_verify_x' }), /loopback/],
  ['database is a remote host', base({ MONGODB_URI: 'mongodb://db.example.com:27017/dd_staging_verify_x' }), /loopback/],
  ['database mixes loopback and remote hosts', base({ MONGODB_URI: 'mongodb://127.0.0.1:27017,db.example.com:27017/dd_staging_verify_x' }), /loopback/],
  ['database name not a harness database', base({ MONGODB_URI: 'mongodb://127.0.0.1:27017/doppeldash' }), /dd_staging_verify_/],
  ['database name has no db', base({ MONGODB_URI: 'mongodb://127.0.0.1:27017/' }), /dd_staging_verify_/],
  ['app url is remote', base({ STAGING_APP_URL: 'http://app.example.com:3100' }), /STAGING_APP_URL/],
  ['app url is https', base({ STAGING_APP_URL: 'https://127.0.0.1:3100' }), /STAGING_APP_URL/],
  ['app url has a path', base({ STAGING_APP_URL: 'http://127.0.0.1:3100/api' }), /STAGING_APP_URL/],
  ['app url without cron secret', drop(base(), ['STAGING_CRON_SECRET']), /STAGING_CRON_SECRET/],
  ['cron secret too short', base({ STAGING_CRON_SECRET: 'short' }), /STAGING_CRON_SECRET/],
  ['no cleanup mode chosen', drop(base(), ['STAGING_APP_URL', 'STAGING_CRON_SECRET']), /STAGING_APP_URL/],
  ['empty environment', {}, /required/],
]
for (const [name, env, re] of BAD) {
  test(`P1. refused: ${name}`, () => {
    const r = preflight(env); assert.equal(r.ok, false, 'must be refused'); assert.equal(r.config, null)
    assert.ok(r.problems.some(p => re.test(p)), `expected /${re.source}/ in ${JSON.stringify(r.problems)}`)
    assert.ok(!r.problems.join('\n').includes(SECRET) && !r.problems.join('\n').includes(KEY), 'a problem message must not echo credentials')
  })
}

/* ═════════ B. the entry script: refusals happen before anything else, with redacted output ═════════ */
function refused(env, { cwd = ROOT } = {}) {
  assert.equal(preflight(env).ok, false, 'TEST BUG: this environment would pass preflight and could contact a real provider — never spawn it')
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20_000 })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const NO_LEAK = out => { for (const bad of [SECRET, KEY, CRON]) assert.ok(!out.includes(bad), 'credential leaked in refusal output'); assert.doesNotMatch(out, /https?:\/\/|cld:|doppeldash\//i) }

test('E1. the script exits 2 with a redacted explanation for each class of unsafe/incomplete configuration — before any provider call', () => {
  for (const [name, env] of [BAD[0], BAD[1], BAD[4], BAD[7], BAD[12], BAD[21], BAD[22], BAD[24], BAD[26], BAD[29], BAD[31]].map(b => [b[0], b[1]])) {
    const r = refused(env); assert.equal(r.status, 2, name); assert.match(r.out, /^REFUSING TO RUN/m, name); NO_LEAK(r.out)
  }
  const none = refused({}); assert.equal(none.status, 2); assert.match(none.out, /nothing was uploaded, deleted or contacted/)
})

test('E2. it never loads .env files, never recovers credentials from the shell/deployment tooling: a directory full of .env files changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stg-harness-'))
  try {
    for (const f of ['.env', '.env.local', '.env.production', '.env.development']) fs.writeFileSync(path.join(dir, f), `CLOUDINARY_CLOUD_NAME=stg-cloud\nCLOUDINARY_API_KEY=${KEY}\nCLOUDINARY_API_SECRET=${SECRET}\nCLOUDINARY_STAGING_CONFIRM=stg-cloud\nPRODUCTION_CLOUDINARY_CLOUD_NAME=prod-cloud\nMONGODB_URI=mongodb://127.0.0.1:27017/dd_staging_verify_x\nSTAGING_CLEANUP_APPLY=1\n`)
    const r = refused({}, { cwd: dir }); assert.equal(r.status, 2); assert.match(r.out, /CLOUDINARY_CLOUD_NAME is required/); NO_LEAK(r.out)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  const src = fs.readFileSync(SCRIPT, 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts/lib/stagingVerify.js'), 'utf8')
  assert.doesNotMatch(src, /dotenv|loadEnvConfig|['"`/]\.env|netlify|vercel|child_process|execSync|spawn\(|process\.env\.[A-Z_]+\s*=[^=]/i, 'the harness must not load env files, call deployment tooling or spawn processes')
  assert.doesNotMatch(fs.readFileSync(SCRIPT, 'utf8'), /__fakeProviderForTests/, 'the entry script never enables the fake-provider option')
})

test('E3. redaction: secrets, URLs, asset ids and tokens are removed from anything that is printed', () => {
  const red = makeRedactor([SECRET, KEY, CRON])
  const raw = `key ${KEY} secret ${SECRET} cron ${CRON} https://api.cloudinary.com/v1_1/x/image/download?signature=abc cld:doppeldash/zz-verify-1234abcd/receipts/${'a'.repeat(32)}.png Bearer abc.def.ghi ${'b'.repeat(40)}`
  const out = red(raw)
  for (const bad of [SECRET, KEY, CRON, 'https://', 'cld:', 'doppeldash/', 'abc.def.ghi', 'b'.repeat(40)]) assert.ok(!out.includes(bad), bad)
})

test('O1. ownership check: a delete is only ever allowed for an id this run created, in its own tenant folder, exactly shaped', () => {
  const org = 'zz-verify-0a1b2c3d', ctl = 'zz-verify-4e5f6a7b', other = 'zz-verify-ffffffff'
  const hex = () => crypto.randomBytes(16).toString('hex'); const mine = `doppeldash/${org}/receipts/${hex()}`; const mine2 = `doppeldash/${ctl}/receipts/${hex()}`
  const owned = new Map([[mine, org], [mine2, ctl]]); const isOwned = makeOwnership(new Set([org, ctl]), owned)
  assert.equal(isOwned(mine, org), true); assert.equal(isOwned(mine2, ctl), true)
  const unrelated = [
    [mine, ctl], [mine, other], [mine, 'doppeldash'], [mine2, org],                                     // right id, wrong tenant
    [`doppeldash/${org}/receipts/${hex()}`, org],                                                        // well-shaped but NOT tracked by this run
    [`doppeldash/${other}/receipts/${hex()}`, other], [`doppeldash/some-real-tenant/receipts/${hex()}`, 'some-real-tenant'], // not this run's tenants
    [`doppeldash/${org}/documents/${mine.split('/').pop()}`, org], [`doppeldash/${org}/receipts/../x/${hex()}`, org], [`doppeldash/${org}/receipts/${hex()}/extra`, org],
    [mine.toUpperCase(), org], [mine + '.png', org], [mine + '*', org], [`doppeldash/${org}/receipts/`, org], [`doppeldash/${org}/receipts/${'a'.repeat(31)}`, org],
    ['branding/logo', org], ['', org], [mine, ''], [null, org], [mine, null], [undefined, undefined], [{ toString: () => mine }, org],
  ]
  for (const [id, o] of unrelated) assert.equal(isOwned(id, o), false, JSON.stringify([String(id), o]))
  assert.equal(isOwned(`doppeldash/${org}/receipts/${hex()}`, org), false, 'shape alone is never enough — it must also be tracked')
})

/* ═════════ C. run() against the LOCAL FAKE provider and a throwaway DB (harness logic only) ═════════ */
const createdDbs = new Set()
function localCfg(over = {}) {
  const db = dbName(); createdDbs.add(db)
  return { cloud: fake.ENV.CLOUDINARY_CLOUD_NAME, key: fake.ENV.CLOUDINARY_API_KEY, secret: fake.ENV.CLOUDINARY_API_SECRET, prod: 'prod-cloud', signedPreset: null, gemini: false, mongoUri: `mongodb://127.0.0.1:27017/${db}`, db, appUrl: null, cronSecret: null, ...over }
}
const FAKE = { uploadBase: fake.ENV.CLOUDINARY_UPLOAD_BASE, deliveryBase: fake.ENV.CLOUDINARY_DELIVERY_BASE }
async function harness(cfg, fakeMode) {
  await fake.control.reset(); if (fakeMode) await fake.control.mode(fakeMode)
  Object.assign(process.env, fake.ENV)                                   // the in-process cleanup reads the storage config from process.env
  const lines = []; const r = await run(cfg, { out: l => lines.push(l), __fakeProviderForTests: FAKE })
  return { ...r, text: lines.join('\n'), lines }
}
const hygiene = text => {
  for (const bad of [fake.ENV.CLOUDINARY_API_SECRET, fake.ENV.CLOUDINARY_API_KEY, CRON]) assert.ok(!text.includes(bad), 'credential in harness output')
  assert.doesNotMatch(text, /https?:\/\/|cld:|doppeldash\/|[0-9a-f]{32}/i, 'URL / private asset reference / long id in harness output')
}
const inject = (p, ext = 'png') => fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: p, ext, bytes: 300, type: 'authenticated' }) })

test('R1. a full run (in-process cleanup): every check passes; provider-side format enforcement is observed and reported; only harness-owned assets are ever deleted; unrelated assets survive', async () => {
  const other = `doppeldash/some-other-tenant/receipts/${crypto.randomBytes(16).toString('hex')}`
  const logo = `branding/logo-${crypto.randomBytes(4).toString('hex')}`
  await fake.control.reset(); await inject(other); await inject(logo)
  Object.assign(process.env, fake.ENV)
  const lines = []; const r = await run(localCfg(), { out: l => lines.push(l), __fakeProviderForTests: FAKE }); const text = lines.join('\n')
  assert.equal(r.exitCode, 0, text); assert.equal(r.cleanupIncomplete, 0)
  assert.ok(r.results.length >= 30 && r.results.every(x => x.ok), JSON.stringify(r.results.filter(x => !x.ok)))
  assert.match(text, /PNG declared as PDF is stopped.*observed: the PROVIDER refused it/)
  assert.match(text, /provider-side enforcement of signed allowed_formats observed: YES/)
  assert.match(text, /cleanup apply deleted exactly one asset/); assert.match(text, /control asset are all retained|untracked control asset/)
  hygiene(text)
  const st = await fake.control.state()
  for (const d of st.destroyed) assert.match(d, ID_RE, 'only harness-tenant receipt assets were ever sent to delete')
  assert.ok(st.files.includes(`${other}.png`), 'an unrelated tenant asset survived'); assert.ok(st.files.includes(`${logo}.png`), 'an unrelated non-receipt asset survived')
  assert.equal(st.files.filter(f => /zz-verify-/.test(f)).length, 0, 'every harness asset was removed')
})

test('R2. when the provider does NOT enforce allowed_formats, the application layer stops the mismatch at attach, marks the row rejected and deletes only the owned asset', async () => {
  const r = await harness(localCfg(), { storage: { formats: 'ignore' } })
  assert.equal(r.exitCode, 0, r.text)
  assert.match(r.text, /provider accepted it; the APPLICATION refused it at attach/); assert.match(r.text, /enforcement of signed allowed_formats observed: NO/)
  assert.match(r.text, /marked rejected and can never be claimed/); assert.match(r.text, /rejected asset \(owned by this run\) is deleted/)
  hygiene(r.text)
})

test('R3. a failing run keeps its primary failure, still cleans what it owns, and reports a failed cleanup without any private reference', async () => {
  const cfg = localCfg()
  await fake.control.reset(); await fake.control.mode({ storage: { destroy: 'error500' } })   // deletions fail → leftovers
  Object.assign(process.env, fake.ENV)
  const lines = []; const r = await run(cfg, { out: l => lines.push(l), __fakeProviderForTests: FAKE }); const text = lines.join('\n')
  assert.equal(r.exitCode, 1, 'a failed cleanup/apply must fail the run'); assert.ok(r.cleanupIncomplete >= 1)
  assert.match(text, /^FAIL /m, 'the primary failures are still visible'); assert.match(text, /CLEANUP INCOMPLETE: \d+ harness-owned asset/)
  assert.match(text, /zz-verify-[0-9a-f]{8}/, 'the tenant id (not an asset reference) is given so the operator can find leftovers')
  hygiene(text.replace(/zz-verify-[0-9a-f]{8}/g, 'tenant'))
  await fake.control.mode({ storage: { destroy: 'ok' } })
})

test('R4. a database that is not fresh is refused before any upload or deletion', async () => {
  const cfg = localCfg(); await fake.control.reset(); Object.assign(process.env, fake.ENV)
  await mongoose.connect(cfg.mongoUri); await mongoose.connection.db.collection('receiptuploads').insertOne({ orgId: 'x', publicId: 'y' }); await mongoose.disconnect()
  const lines = []; const r = await run(cfg, { out: l => lines.push(l), __fakeProviderForTests: FAKE })
  assert.equal(r.exitCode, 1); assert.match(lines.join('\n'), /unexpected error|did not complete/)
  const st = await fake.control.state(); assert.equal(st.uploads.length, 0, 'nothing was uploaded'); assert.deepEqual(st.destroyed, [])
  await mongoose.connect(cfg.mongoUri); await mongoose.connection.db.dropDatabase(); await mongoose.disconnect()
})

test('R5. the egress guard blocks any request outside the provider and the declared local app server', async () => {
  const cfg = localCfg(); Object.assign(process.env, fake.ENV)
  // a run that tries to talk to a non-allowed host is impossible through the harness API; assert the guard directly through its observable effect:
  const before = globalThis.fetch; const lines = []
  const p = run(cfg, { out: l => lines.push(l), __fakeProviderForTests: FAKE })
  await new Promise(r => setTimeout(r, 50))
  await assert.rejects(async () => globalThis.fetch('https://example.com/'), /egress guard/).catch(() => {})  // while the run is active, fetch is guarded
  await p
  assert.equal(globalThis.fetch, before, 'fetch is restored after the run')
})

/* ═════════ D. cleanup through the real HTTP route of a local app server (dev server on a throwaway DB, fake provider) ═════════ */
async function appServer(port, db, extra) {
  const env = { ...process.env, ...fake.ENV, NODE_ENV: 'development', MONGODB_URI: `mongodb://127.0.0.1:27017/${db}`, CRON_SECRET: CRON, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: `.next-stgharness-${port}`, ...extra }   // its OWN build directory: sharing `.next` with another dev server corrupts both
  for (const k of ['DD_SERVER_LOG']) delete env[k]
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(port)], { cwd: ROOT, env, stdio: 'ignore', detached: true })     // own process group: the Next worker must die with it
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { signal: AbortSignal.timeout(1500) }); if (r.status) return p } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)) }
  try { process.kill(-p.pid, 'SIGKILL') } catch { /* gone */ } throw new Error('app server did not start')
}
const stop = async p => {
  try { process.kill(-p.pid, 'SIGKILL') } catch { /* already gone */ }
  fs.rmSync(path.join(ROOT, '.next-stgharness-3104'), { recursive: true, force: true })
  for (let i = 0; i < 40; i++) { try { await fetch('http://127.0.0.1:3104/api/auth/me', { signal: AbortSignal.timeout(500) }); await new Promise(r => setTimeout(r, 250)) } catch { return } }   // wait until the port is really free
}

test('D1. cleanup via the app server\'s HTTP route: server-side apply DISABLED → the harness verifies dry-run, refuses to apply, and the run fails (nothing but owned assets touched)', async () => {
  const cfg = localCfg({ appUrl: 'http://127.0.0.1:3104', cronSecret: CRON }); const srv = await appServer(3104, cfg.db, { RECEIPT_CLEANUP_APPLY: '0' })
  try {
    const r = await harness(cfg)
    assert.equal(r.exitCode, 1, r.text); assert.match(r.text, /unauthenticated POST is 401 and GET is 405/)
    assert.match(r.text, /dry-run reports exactly the expected counts/); assert.match(r.text, /apply was NOT attempted/); assert.match(r.text, /RECEIPT_CLEANUP_APPLY is not 1/)
    assert.doesNotMatch(r.text, /cleanup apply deleted/); hygiene(r.text)
    const st = await fake.control.state(); assert.equal(st.files.filter(f => /zz-verify-/.test(f)).length, 0, 'owned assets were removed by the final cleanup')
  } finally { await stop(srv) }
})

test('D2. cleanup via the app server\'s HTTP route with authorization AND server-side enable flag: dry-run deletes nothing, apply deletes exactly the one owned old asset; referenced, recent and untracked assets stay', async () => {
  const cfg = localCfg({ appUrl: 'http://127.0.0.1:3104', cronSecret: CRON }); const srv = await appServer(3104, cfg.db, { RECEIPT_CLEANUP_APPLY: '1' })
  try {
    const r = await harness(cfg)
    assert.equal(r.exitCode, 0, r.text); assert.ok(r.results.every(x => x.ok))
    for (const re of [/unauthenticated POST is 401 and GET is 405/, /dry-run reports exactly the expected counts/, /dry-run deleted nothing/, /apply deleted exactly one asset/, /unreferenced >24 h harness asset is gone/, /retained/]) assert.match(r.text, re)
    hygiene(r.text)
  } finally { await stop(srv) }
})
