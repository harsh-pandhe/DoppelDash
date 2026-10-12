/**
 * END-TO-END proof against a real PRODUCTION server (`next build` + `next start`, NODE_ENV=production) that the upload
 * and receipt paths FAIL CLOSED when signing configuration is missing or incomplete, that no unsigned fallback exists,
 * and that test-fake overrides are ignored. No external service is contacted: every scenario that could reach a provider
 * is asserted to be refused BEFORE any provider call. Uses a throwaway DB only.
 *
 * Slow (one production build, cached in .next-prodtest; set PROD_TEST_REUSE_BUILD=1 to reuse an existing build).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')

const ROOT = path.resolve(__dirname, '..')
const DIST = '.next-prodtest'
const PORT = 3103
const BASE = `http://127.0.0.1:${PORT}`
const NEXT = path.join(ROOT, 'node_modules/next/dist/bin/next')

const baseEnv = () => {
  const e = { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: DIST, PORT: String(PORT), SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', NEXT_TELEMETRY_DISABLED: '1' }
  for (const k of Object.keys(e)) if (/^(NEXT_PUBLIC_)?CLOUDINARY|^GEMINI|^OLLAMA|^ALLOW_UNSIGNED/.test(k)) delete e[k]
  return e
}

let db, org, cookie, server
test.before(async () => {
  if (!(process.env.PROD_TEST_REUSE_BUILD === '1' && fs.existsSync(path.join(ROOT, DIST, 'BUILD_ID')))) {
    const b = spawnSync('node', [NEXT, 'build'], { cwd: ROOT, env: baseEnv(), encoding: 'utf8', timeout: 900_000 })
    assert.equal(b.status, 0, 'production build failed:\n' + (b.stdout || '').slice(-1500) + (b.stderr || '').slice(-1500))
  }
  db = await kit.connect()
  org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  const User = kit.load('models/User.ts').default
  const { signToken } = kit.load('lib/auth/jwt.ts')
  cookie = `dd_session=${await signToken((await User.findById(org.employee.id)).toPublic())}`
})
test.afterEach(async () => { if (server) { server.kill('SIGKILL'); server = null; await new Promise(r => setTimeout(r, 500)) } })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

async function startProd(extraEnv) {
  server = spawn('node', [NEXT, 'start', '-p', String(PORT)], { cwd: ROOT, env: { ...baseEnv(), ...extraEnv }, stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/sign-in`, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('production server did not start')
}
const api = async (p, { method = 'GET', body } = {}) => {
  const r = await fetch(`${BASE}${p}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'x-forwarded-for': kit.freshIp() }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, text, json }
}
const SIGN = { method: 'POST', body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 1000 } }
const sane = text => assert.doesNotMatch(text, /cloudinary|secret|preset|unsigned|api[_ ]?key|env/i, 'the error must not reveal configuration details')
const day = n => new Date(Date.now() + n * 864e5).toISOString()

const SCENARIOS = {
  'no storage configuration at all': {},
  'cloud name only': { CLOUDINARY_CLOUD_NAME: 'acme' },
  'cloud name + API key but NO secret (incomplete)': { CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_KEY: 'k' },
  'cloud name + secret but NO key (incomplete)': { CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_SECRET: 's' },
  'legacy unsigned preset present': { CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_UPLOAD_PRESET: 'public_preset' },
  'legacy unsigned preset + ALLOW_UNSIGNED_UPLOADS=1 (flag must be ignored in production)': { CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_UPLOAD_PRESET: 'public_preset', ALLOW_UNSIGNED_UPLOADS: '1' },
  'incomplete signing + the unsigned opt-in flag': { CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_KEY: 'k', CLOUDINARY_UPLOAD_PRESET: 'p', ALLOW_UNSIGNED_UPLOADS: '1' },
}

for (const [name, env] of Object.entries(SCENARIOS)) {
  test(`PROD: ${name} → no upload ticket (503), attachments and receipt reads refused, nothing falls back to unsigned`, async () => {
    await startProd(env)
    const s = await api('/api/uploads/sign', SIGN)
    assert.equal(s.status, 503, s.text); assert.equal(s.json.code, 'storage_not_configured'); sane(s.text)
    assert.ok(!s.json.fields && !s.json.uploadUrl && !s.json.mode, 'no ticket of any kind')
    // an attachment URL cannot be accepted when storage is not properly configured
    const url = `https://res.cloudinary.com/acme/image/authenticated/s--AAAAAAAA--/v1/doppeldash/${org.orgId}/receipts/${'a'.repeat(32)}.jpg`
    const e = await api('/api/rms', { method: 'POST', body: { title: 'x', reason: 'y', amount: 5, startDate: day(-1), receipts: [url] } })
    assert.equal(e.status, 400, e.text); assert.ok(e.json.fields.includes('receipts'))
    // a stored private reference cannot be served either (no way to build a provider request)
    const ref = `cld:doppeldash/${org.orgId}/receipts/${'b'.repeat(32)}.jpg`
    const ins = await db.collection('expenses').insertOne({ orgId: org.orgId, userId: org.employee.id, userName: 'Eve', title: 'Ref claim', reason: 'r', amount: 5, startDate: new Date(), status: 'pending_manager', receipts: [ref], lineItems: [], hasLineItems: false })
    const g = await api(`/api/rms/${ins.insertedId}/receipt/0.jpg`)
    assert.equal(g.status, 503, g.text); assert.equal(g.json.code, 'storage_not_configured'); sane(g.text)
  })
}

test('PROD: complete signing config → a SIGNED, authenticated, tenant-bound ticket; fake overrides in env are ignored; no secret in the response', async () => {
  await startProd({ CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 'prod-secret-value', CLOUDINARY_UPLOAD_BASE: 'http://127.0.0.1:1/evil', CLOUDINARY_DELIVERY_BASE: 'http://127.0.0.1:1/evil', GEMINI_API_BASE: 'http://127.0.0.1:1/evil' })
  const s = await api('/api/uploads/sign', SIGN)
  assert.equal(s.status, 200, s.text)
  assert.equal(s.json.mode, 'signed')
  assert.equal(s.json.uploadUrl, 'https://api.cloudinary.com/v1_1/acme/auto/upload', 'the override is ignored; uploads can only go to Cloudinary')
  assert.equal(s.json.fields.folder, `doppeldash/${org.orgId}/receipts`); assert.equal(s.json.fields.type, 'authenticated'); assert.equal(s.json.fields.overwrite, 'false')
  assert.match(s.json.fields.public_id, /^[0-9a-f]{32}$/); assert.ok(s.json.fields.signature && s.json.fields.api_key === 'k')
  assert.ok(!s.text.includes('prod-secret-value'), 'the API secret must never be in a response')
  // input is still validated server-side in production
  assert.equal((await api('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: 'text/html', sizeBytes: 5 } })).status, 415)
  assert.equal((await api('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 999999999 } })).status, 413)
})
