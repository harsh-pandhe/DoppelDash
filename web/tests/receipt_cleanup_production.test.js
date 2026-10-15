/**
 * Feature 3.1.3 — the receipt-cleanup endpoint against a REAL PRODUCTION server (`next build` + `next start`, NODE_ENV=production).
 * Proves, over HTTP, that in production mode: unauthenticated / wrongly authenticated requests get 401 and delete nothing,
 * GET is 405, apply is refused (403) unless RECEIPT_CLEANUP_APPLY=1, and nothing is ever sent to a provider.
 *
 * Isolation: no Cloudinary / Gemini / Ollama variables are passed to the server (any inherited ones are stripped), so it
 * CANNOT reach a provider — production mode ignores the fake-provider base-URL overrides by design. Throwaway DB only.
 * Needs CRON_SECRET in this process' environment (the same value is given to the server). Slow (one production build, cached
 * in .next-prodtest; PROD_TEST_REUSE_BUILD=1 reuses an existing build).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const kit = require('./helpers/authTestKit')

const ROOT = path.resolve(__dirname, '..')
const DIST = '.next-prodtest'
const PORT = 3103
const BASE = `http://127.0.0.1:${PORT}`
const NEXT = path.join(ROOT, 'node_modules/next/dist/bin/next')
const CRON = process.env.CRON_SECRET
const URL_ = `${BASE}/api/cron/receipts-cleanup`

const baseEnv = (extra = {}) => {
  const e = { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: DIST, PORT: String(PORT), SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', NEXT_TELEMETRY_DISABLED: '1', CRON_SECRET: CRON }
  for (const k of Object.keys(e)) if (/^(NEXT_PUBLIC_)?CLOUDINARY|^GEMINI|^OLLAMA|^ALLOW_UNSIGNED|^RECEIPT_CLEANUP_APPLY/.test(k)) delete e[k]
  return { ...e, ...extra }
}

let db, org, server, publicId
test.before(async () => {
  assert.ok(CRON, 'CRON_SECRET must be set')
  if (!(process.env.PROD_TEST_REUSE_BUILD === '1' && fs.existsSync(path.join(ROOT, DIST, 'BUILD_ID')))) {
    const b = spawnSync('node', [NEXT, 'build'], { cwd: ROOT, env: baseEnv(), encoding: 'utf8', timeout: 900_000 })
    assert.equal(b.status, 0, 'production build failed:\n' + (b.stdout || '').slice(-1500) + (b.stderr || '').slice(-1500))
  }
  db = await kit.connect()
  org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
})
test.afterEach(async () => { if (server) { server.kill('SIGKILL'); server = null; await new Promise(r => setTimeout(r, 500)) } })
test.after(async () => { await db.collection('receiptuploads').deleteMany({ orgId: org.orgId }); await kit.cleanupAll(db); await kit.disconnect() })

async function startProd(extraEnv) {
  server = spawn('node', [NEXT, 'start', '-p', String(PORT)], { cwd: ROOT, env: baseEnv(extraEnv), stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/sign-in`, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('production server did not start')
}
async function seedOldOrphan() {
  publicId = `doppeldash/${org.orgId}/receipts/${kit.rand()}${kit.rand()}`.replace(/[^A-Za-z0-9_/-]/g, '')
  await db.collection('receiptuploads').deleteMany({ orgId: org.orgId })
  await db.collection('receiptuploads').insertOne({ orgId: org.orgId, publicId, state: 'issued', issuedAt: new Date(Date.now() - 30 * 3600_000), nextCheckAt: new Date(Date.now() - 6 * 3600_000), failures: 0 })
}
const untouched = async () => { const r = await db.collection('receiptuploads').findOne({ publicId }); return !!r && r.state === 'issued' && r.failures === 0 }
async function call({ method = 'POST', qs = '', headers = {}, body, raw } = {}) {
  const r = await fetch(URL_ + qs, { method, headers: { 'x-forwarded-for': kit.freshIp(), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined })
  const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, text, json, headers: r.headers }
}
const BEARER = { Authorization: `Bearer ${CRON}` }

test('PROD-1. production, apply DISABLED: unauthenticated and wrong-secret POSTs → 401; valid bearer + apply → 403; GET → 405; nothing is touched', async () => {
  await startProd({}); await seedOldOrphan()
  for (const a of [{ body: { mode: 'apply' } }, { headers: { Authorization: 'Bearer nope' }, body: { mode: 'apply' } }, { qs: '?secret=decoy&apply=1', body: { mode: 'apply' } }, { raw: 'not json' }, {}]) {
    const r = await call(a); assert.equal(r.status, 401, JSON.stringify(a)); assert.match(r.headers.get('cache-control'), /no-store/); assert.ok(!r.text.includes(CRON))
  }
  const off = await call({ headers: BEARER, body: { mode: 'apply' } }); assert.equal(off.status, 403); assert.equal(off.json.code, 'apply_disabled')
  for (const [qs, headers] of [['', {}], ['?apply=1', {}], ['?apply=1', BEARER]]) { const g = await call({ method: 'GET', qs, headers }); assert.equal(g.status, 405); assert.equal(g.headers.get('allow'), 'POST') }
  const dry = await call({ headers: BEARER, body: { mode: 'dry-run' } }); assert.equal(dry.status, 200); assert.deepEqual([dry.json.mode, dry.json.eligible, dry.json.deleted, dry.json.applyEnabled], ['dry-run', 1, 0, false])
  assert.equal((await call({ headers: BEARER, body: { mode: 'bogus' } })).status, 400)
  assert.ok(await untouched(), 'the manifest row was never claimed, changed or removed')
  for (const t of [JSON.stringify(dry.json), off.text]) assert.doesNotMatch(t, new RegExp(`${CRON}|cld:|https?://|doppeldash/|cloudinary`, 'i'))
})

test('PROD-2. production, apply ENABLED but no storage credentials: unauthenticated still 401; authorised apply cannot reach any provider and deletes nothing', async () => {
  await startProd({ RECEIPT_CLEANUP_APPLY: '1' }); await seedOldOrphan()
  assert.equal((await call({ body: { mode: 'apply' } })).status, 401)
  assert.equal((await call({ headers: { Authorization: 'Bearer nope' }, body: { mode: 'apply' } })).status, 401)
  assert.equal((await call({ method: 'GET', qs: '?apply=1', headers: BEARER })).status, 405)
  assert.ok(await untouched())
  const r = await call({ headers: BEARER, body: { mode: 'apply' } })
  assert.equal(r.status, 200, r.text); assert.deepEqual([r.json.mode, r.json.deleted, r.json.applyEnabled], ['apply', 0, true])
  assert.ok(await untouched(), 'no signed provider access ⇒ the row is not claimed and nothing is deleted')
  assert.doesNotMatch(r.text, new RegExp(`${CRON}|cld:|https?://|doppeldash/`, 'i'))
})
