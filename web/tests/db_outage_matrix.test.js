/**
 * Database-outage matrix (Phase 6C). A SECOND dev server is started with an unreachable MongoDB (loopback port 1, a database name containing "test"),
 * the same signing secrets as the main test server, and a short server-selection timeout. Every route that needs the database must FAIL CLOSED with the
 * documented retryable answer (503 `service_unavailable` + Retry-After) — never 200, never stale/cached privilege, never a 401 (which would sign a
 * mobile client out for a transient outage) and never internals (stack, driver text, host/port, connection string). `/api/health` must keep answering.
 * Tokens come from the healthy server: they are valid, but cannot be honoured without the session/entitlement store.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')
const kit = require('./helpers/authTestKit')

const PORT = 3195, BASE = `http://127.0.0.1:${PORT}`
let child, db, org, good
const call = async (p, { method = 'GET', token, body, headers = {} } = {}) => {
  const h = { ...headers, 'x-forwarded-for': kit.freshIp() }
  if (token) h.Authorization = `Bearer ${token}`
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) })
  const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, headers: r.headers, text, json }
}

test.before(async () => {
  db = await kit.connect(); org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  const a = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.employee.email, password: kit.PASSWORD } })
  const b = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: a.json.preAuthToken, method: 'email', otp: '112022' } })
  const adm = await kit.login(org.admin.email)
  good = { access: b.json.accessToken, refresh: b.json.refreshToken, pre: a.json.preAuthToken, admin: adm.accessToken }
  const root = path.resolve(__dirname, '..')
  child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(PORT)], {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/dd_outage_drill_test', DD_DB_SELECTION_TIMEOUT_MS: '700', NEXT_DIST_DIR: '.next-outage', PORT: String(PORT) },
  })
  for (let i = 0; i < 120; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.status === 200) return } catch { /* starting */ } await new Promise(r => setTimeout(r, 1000)) }
  throw new Error('outage drill server did not start')
})
test.after(async () => { if (child) child.kill('SIGTERM'); await new Promise(r => setTimeout(r, 500)); await kit.cleanupAll(db); await kit.disconnect(); try { require('node:fs').rmSync(path.resolve(__dirname, '../.next-outage'), { recursive: true, force: true }) } catch { /* ignore */ } })

const LEAK = /mongodb:\/\/|127\.0\.0\.1:1\b|ECONNREFUSED|MongoServerSelection|MongooseError|buffering|stack|\bat [A-Za-z_.]+ \(|node_modules|dd_outage_drill/i
const oid = '0'.repeat(23) + '1'

test('O1. /api/health keeps answering during the outage (no database access): 200, commit/context only', async () => {
  const r = await call('/api/health'); assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), ['commit', 'context', 'status'])
})

test('O2. every database-backed route fails closed: 503 service_unavailable, Retry-After, no data, no internals — for valid tokens, bad tokens and no token alike (never 200)', async () => {
  const T = () => good.access, ADM = () => good.admin
  const ROUTES = [
    ['GET', '/api/auth/me', T], ['GET', '/api/employees/me', T], ['GET', '/api/employees/directory', T], ['GET', '/api/billing/entitlements', T], ['GET', '/api/rms', T], ['GET', '/api/lms', T], ['GET', '/api/lms/balance', T], ['GET', '/api/travel', T],
    ['GET', '/api/crm', T], ['GET', '/api/announcements', T], ['GET', '/api/notifications', T], ['GET', '/api/holidays', T], ['GET', '/api/org/settings', T], ['GET', '/api/admin/users', ADM], ['GET', '/api/admin/audit', ADM],
    ['GET', `/api/lms/${oid}/document/0.png`, T], ['GET', `/api/rms/${oid}/receipt/0.png`, T], ['GET', `/api/travel/${oid}/itinerary/0.png`, T], ['GET', `/api/rms/${oid}`, T], ['GET', `/api/crm/${oid}`, T],
    ['POST', '/api/uploads/sign', T, { kind: 'receipt', mimeType: 'image/png', sizeBytes: 10 }], ['POST', '/api/rms', T, { title: 't', reason: 'r', amount: 1, startDate: new Date().toISOString() }], ['POST', '/api/lms', T, { type: 'casual', startDate: '2026-12-01', endDate: '2026-12-01', days: 1, reason: 'r' }],
    ['POST', '/api/crm', T, { name: 'x' }], ['POST', '/api/billing/play/verify', ADM, { purchaseToken: 'x', productId: 'doppeldash_premium_monthly' }],
    ['POST', '/api/auth/login', () => null, { email: org.employee.email, password: kit.PASSWORD }], ['POST', '/api/auth/verify-otp', () => null, { preAuthToken: good.pre, method: 'email', otp: '112022' }],
    ['POST', '/api/auth/refresh', () => null, { refreshToken: good.refresh }], ['POST', '/api/auth/register', () => null, { organizationName: 'Outage Org', email: `o_${kit.rand()}@test.dd`, password: 'Str0ng!Passw0rd#1', firstName: 'O' }],
    ['POST', '/api/auth/password-reset/request', () => null, { email: org.employee.email }],
  ]
  const failures = []
  for (const [method, p, tok, body] of ROUTES) {
    const r = await call(p, { method, token: tok(), body })
    const ok = r.status === 503 && r.json && r.json.code === 'service_unavailable' && r.headers.get('retry-after') && !LEAK.test(r.text)
    if (!ok) failures.push(`${method} ${p.replace(oid, ':id')} → ${r.status} ${r.text.slice(0, 100)}`)
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('O3. unauthenticated or forged requests to protected routes are never served during the outage (401 before the store is needed, or 503) and carry no data', async () => {
  for (const [p, headers] of [['/api/rms', {}], ['/api/employees/me', { Authorization: 'Bearer forged.jwt.value' }], ['/api/admin/users', { Authorization: 'Bearer ' + 'a'.repeat(200) }], [`/api/lms/${oid}/document/0.png`, {}]]) {
    const r = await call(p, { headers }); assert.ok([401, 503].includes(r.status), `${p} → ${r.status}`); assert.doesNotMatch(r.text, LEAK)
  }
})

test('O4. the public endpoints that need no store keep their own contracts; a webhook/cron call that needs the store gets 503 (so the sender retries), wrong credentials are still 401', async () => {
  assert.equal((await call('/api/cron/birthday', { headers: { Authorization: 'Bearer wrong' } })).status, 401)
  const cron = await call('/api/cron/birthday', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }); assert.equal(cron.status, 503, cron.text); assert.equal(cron.json.code, 'service_unavailable')
  assert.equal((await call('/api/billing/play/rtdn', { method: 'POST', body: {} })).status, 401, 'unauthenticated webhook is refused without needing the store')
  assert.equal((await call('/api/auth/invitations/zz', {})).status, 405)
})

test('O5. error classification: connectivity/timeout errors map to 503, everything else is re-thrown unchanged (existing 4xx contracts are untouched)', () => {
  const { isDbUnavailable } = kit.load('lib/http/dbGuard.ts')
  for (const e of [{ name: 'MongoServerSelectionError', message: 'x' }, { name: 'MongoNetworkError', message: 'x' }, { name: 'MongoNetworkTimeoutError', message: 'x' }, { name: 'MongooseError', message: 'Operation `users.findOne()` buffering timed out after 10000ms' }, { name: 'MongoServerError', code: 50, message: 'operation exceeded time limit' }, { name: 'Error', message: 'wrap', cause: { name: 'MongoPoolClearedError', message: 'x' } }, { name: 'Error', message: '[deploy-context] database access is disabled' }]) assert.equal(isDbUnavailable(e), true, JSON.stringify(e))
  for (const e of [new Error('boom'), { name: 'ValidationError', message: 'bad' }, { name: 'MongoServerError', code: 11000, message: 'E11000 duplicate' }, { name: 'CastError', message: 'cast' }, null, 'str', { name: 'SyntaxError', message: 'Unexpected token' }]) assert.equal(isDbUnavailable(e), false, String(e && e.name))
})

test('O6. STATIC completeness: every exported handler under app/api is wrapped by dbGuard, except the handlers that never touch the database (health, removed invitation GET/HEAD, 405 stubs on receipts-cleanup and retention-purge)', () => {
  const fs = require('node:fs'), root = path.resolve(__dirname, '..', 'app/api'); const unwrapped = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') { const t = fs.readFileSync(p, 'utf8'); for (const m of t.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b([^\n]*)/g)) if (!/dbGuard\(/.test(m[2])) unwrapped.push(`${path.relative(root, p)} ${m[1]}`) } } }
  walk(root)
  const ALLOWED = ['auth/invitations/[token]/route.ts GET', 'auth/invitations/[token]/route.ts HEAD', 'health/route.ts GET', 'health/route.ts HEAD', ...['GET', 'PUT', 'PATCH', 'DELETE'].flatMap(m => [`cron/receipts-cleanup/route.ts ${m}`, `cron/retention-purge/route.ts ${m}`])]
  assert.deepEqual(unwrapped.filter(u => !ALLOWED.includes(u.replace(/\\/g, '/'))), [], 'a new DB-backed handler must be wrapped with dbGuard')
})

test('O7. mail, invitation, org-config and email-config paths also fail closed with 503 during the outage (no partial send / no stale grant)', async () => {
  const failures = []
  for (const [method, p, tok, body] of [
    ['GET', '/api/admin/invitations', good.admin], ['POST', '/api/admin/invitations', good.admin, { email: `i_${kit.rand()}@test.dd`, role: 'employee' }],
    ['POST', '/api/auth/invitations/accept', null, { token: 'x'.repeat(40), password: 'Str0ng!Passw0rd' }], ['POST', '/api/auth/invitations/verify', null, { token: 'x'.repeat(40) }],
    ['GET', '/api/org/mail-config', good.admin], ['GET', '/api/user/email-config', good.access], ['GET', '/api/mail/drafts', good.access],
  ]) {
    const r = await call(p, { method, token: tok, body })
    if (!(r.status === 503 && r.json && r.json.code === 'service_unavailable' && !LEAK.test(r.text))) failures.push(`${method} ${p} → ${r.status} ${r.text.slice(0, 90)}`)
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})
