/**
 * Next 16 proxy (formerly middleware) behaviour, real server: public vs authenticated paths, API 401 JSON vs page redirect,
 * invalid-token handling, nested paths, extension tricks, legacy token-link bridge, and Web gating (Free/Premium denied, Lifetime allowed).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const kit = require('./helpers/authTestKit')

let db, L, F, tokL, tokF
test.before(async () => {
  db = await kit.connect()
  L = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  F = await kit.createOrg({ plan: 'free', webEnabled: false })
  tokL = (await kit.login(L.employee.email)).accessToken; tokF = (await kit.login(F.employee.email)).accessToken
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('P1. the file convention is the Next 16 `proxy` (no deprecated middleware.ts left) and exports `proxy` + the matcher config', () => {
  const root = path.resolve(__dirname, '..')
  assert.equal(fs.existsSync(path.join(root, 'middleware.ts')), false); const src = fs.readFileSync(path.join(root, 'proxy.ts'), 'utf8')
  assert.match(src, /export async function proxy\(/); assert.match(src, /export const config/)
})

test('P2. public pages render without a session; protected pages redirect to /sign-in?redirect=<path> (nested paths too); /api answers 401 JSON, never a redirect', async () => {
  for (const p of ['/sign-in', '/privacy', '/terms', '/support', '/forgot-password']) assert.equal((await kit.api(p, { redirect: 'manual' })).status, 200, p)
  for (const p of ['/dashboard', '/lms', '/rms/abc', '/admin/users']) {
    const r = await kit.api(p, { redirect: 'manual' }); assert.ok([307, 308].includes(r.status), `${p} -> ${r.status}`)
    const loc = r.headers.get('location') || ''; assert.match(loc, /\/sign-in\?redirect=/); assert.ok(loc.includes(encodeURIComponent(p)) || loc.includes(p), loc)
  }
  const a = await kit.api('/api/admin/users', { redirect: 'manual' }); assert.equal(a.status, 401); assert.equal(a.json.code, 'unauthorized')
})

test('P3. an invalid/garbage bearer is 401 on the API and a redirect with reason=session on pages; a static-extension suffix never bypasses auth on /api', async () => {
  const a = await kit.api('/api/auth/me', { token: 'garbage.token.value' }); assert.equal(a.status, 401)
  const j = await kit.api('/api/admin/users.json', { redirect: 'manual' }); assert.equal(j.status, 401, 'users.json must not be treated as a static file')
  const r = await kit.api('/dashboard', { redirect: 'manual', cookie: 'dd_session=not-a-jwt' }); assert.ok([307, 308].includes(r.status)); assert.match(r.headers.get('location') || '', /reason=session/)
})

test('P4. legacy token links (?token=) are answered by the static bridge: 200 HTML, no-store, the token is NOT in the response body', async () => {
  const secret = 'zz' + kit.rand().slice(0, 4)
  for (const p of ['/invite', '/reset-password']) {
    const r = await kit.api(`${p}?token=${secret}`, { redirect: 'manual' }); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control') || '', /no-store/); assert.doesNotMatch(r.text, new RegExp(secret)); assert.match(r.text, /location\.replace/)
  }
})

test('P5. Web gating behind the proxy: Lifetime member renders /dashboard and nested pages; Free and Premium-without-web members are redirected to /web-access-restricted on every page; refresh (second request) behaves identically', async () => {
  const User = kit.load('models/User.ts').default, { signToken } = kit.load('lib/auth/jwt.ts')
  const cookieFor = async id => `dd_session=${await signToken((await User.findById(id)).toPublic())}`
  const P = await kit.createOrg({ plan: 'premium', webEnabled: false })
  const cl = await cookieFor(L.employee.id), cf = await cookieFor(F.employee.id), cp = await cookieFor(P.employee.id)
  for (let i = 0; i < 2; i++) {
    for (const pth of ['/dashboard', '/lms', '/travel']) assert.equal((await kit.api(pth, { cookie: cl, redirect: 'manual' })).status, 200, `lifetime ${pth} #${i}`)
    for (const [c, label] of [[cf, 'free'], [cp, 'premium-no-web']]) for (const pth of ['/dashboard', '/lms', '/rms', '/travel']) {
      const r = await kit.api(pth, { cookie: c, redirect: 'manual' }); assert.ok([307, 308, 302, 303].includes(r.status), `${label} ${pth} -> ${r.status}`); assert.match(r.headers.get('location') || '', /web-access-restricted/, `${label} ${pth}`)
    }
  }
  assert.equal((await kit.api('/web-access-restricted', { cookie: cf, redirect: 'manual' })).status, 200, 'the explanation page itself is reachable')
})
