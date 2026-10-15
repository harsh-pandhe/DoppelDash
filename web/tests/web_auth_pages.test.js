/**
 * Web auth pages (the approved Doppelmayr sign-in design + the secure auth contracts), behaviour-level.
 * jsdom + Testing Library with fetch mocked: asserts API calls, redirects, token hygiene and states — not pixels.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { load, rtl, userEvent, React, dom, root } = require('./helpers/domKit')
const { render, screen, cleanup, waitFor } = rtl
const h = React.createElement

// ── module stubs (Next + the heavy 3D scene + WebAuthn) ─────────────────────────────────────────────
const nav = { replaced: [] }
const stubs = {
  'next/navigation': { useRouter: () => ({ replace: p => nav.replaced.push(p), push: p => nav.replaced.push(p), refresh() {} }), usePathname: () => '/sign-in', useSearchParams: () => new URLSearchParams() },
  'next/link': { __esModule: true, default: ({ href, children, ...r }) => h('a', { href, ...r }, children) },
  'next/dynamic': { __esModule: true, default: () => () => null },
  '@simplewebauthn/browser': { startAuthentication: async () => { const e = new Error('cancel'); e.name = 'NotAllowedError'; throw e } },
}
const origLoad = Module._load
Module._load = function (request, ...rest) { return stubs[request] ?? origLoad.call(this, request, ...rest) }

let calls
function mockFetch(handler) {
  calls = []
  const f = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), method: init.method || 'GET', body })
    const r = await handler(String(url), init.method || 'GET', body)
    return { ok: r.status < 400, status: r.status, json: async () => r.json }
  }
  globalThis.fetch = dom.window.fetch = f
}
const setUrl = u => dom.window.history.replaceState(null, '', u)
test.beforeEach(() => { nav.replaced.length = 0; setUrl('/') })
test.afterEach(() => cleanup())

const SignIn = () => load('app/(auth)/sign-in/page.tsx').default
const Reset = () => load('app/(auth)/reset-password/page.tsx').default
const Invite = () => load('app/invite/page.tsx').default
const Restricted = () => load('app/web-access-restricted/page.tsx').default

/* ───────────── sign-in ───────────── */
test('A1. sign-in keeps the approved Doppelmayr copy and wiring: no "Sign in to DoppelDash"', async () => {
  mockFetch(() => ({ status: 200, json: {} }))
  render(h(SignIn()))
  assert.ok(screen.getByText('Sign in to Doppelmayr India'))
  assert.ok(screen.getByText(/Connecting/))
  assert.ok(screen.getByText('Continue securely'))
  assert.ok(screen.getByText('Sign in with a passkey'))
  assert.ok(!/Sign in to DoppelDash/.test(document.body.textContent))
})

test('A2. empty credentials cannot be submitted (button disabled, no request)', async () => {
  mockFetch(() => ({ status: 200, json: {} }))
  render(h(SignIn()))
  const btn = screen.getByText('Continue securely').closest('button')
  assert.equal(btn.disabled, true)
  await userEvent.click(btn)
  assert.equal(calls.length, 0)
})

test('A3. credentials → OTP step (and the OTP step is a 6-digit entry)', async () => {
  mockFetch((u) => u.endsWith('/api/auth/login') ? { status: 200, json: { firstName: 'Asha', preAuthToken: 'pre', methods: ['email'], emailSent: true } } : { status: 404, json: {} })
  render(h(SignIn()))
  await userEvent.type(document.getElementById('email'), 'a@x.com')
  await userEvent.type(document.getElementById('password'), 'secret123')
  await userEvent.click(screen.getByText('Continue securely').closest('button'))
  await screen.findByText(/Confirm it.s you, Asha/)
  assert.equal(screen.getAllByLabelText(/Digit \d/).length, 6)
  assert.deepEqual(calls[0].body, { email: 'a@x.com', password: 'secret123' })
})

test('A4. login response webAccess:false → /web-access-restricted (no OTP step)', async () => {
  mockFetch(() => ({ status: 200, json: { firstName: 'A', preAuthToken: 'p', webAccess: false } }))
  render(h(SignIn()))
  await userEvent.type(document.getElementById('email'), 'a@x.com')
  await userEvent.type(document.getElementById('password'), 'secret123')
  await userEvent.click(screen.getByText('Continue securely').closest('button'))
  await waitFor(() => assert.deepEqual(nav.replaced, ['/web-access-restricted']))
  assert.ok(!screen.queryByText(/Confirm it.s you/))
})

test('A5. wrong OTP shows the server error, clears the digits', async () => {
  mockFetch((u) => u.endsWith('/login') ? { status: 200, json: { preAuthToken: 'pre', methods: ['email'], emailSent: true } } : { status: 401, json: { error: 'Invalid code' } })
  render(h(SignIn()))
  await userEvent.type(document.getElementById('email'), 'a@x.com')
  await userEvent.type(document.getElementById('password'), 'secret123')
  await userEvent.click(screen.getByText('Continue securely').closest('button'))
  await screen.findAllByLabelText(/Digit 1/)
  await userEvent.type(screen.getByLabelText('Digit 1'), '123456')
  const alert = await screen.findByRole('alert')
  assert.match(alert.textContent, /Invalid code/)
  assert.ok(screen.getAllByLabelText(/Digit \d/).every(i => i.value === ''))
  const verify = calls.find(c => c.url.endsWith('/verify-otp'))
  assert.deepEqual(verify.body, { preAuthToken: 'pre', otp: '123456', method: 'email' })
})

test('A6. correct OTP honours a SAFE ?redirect and ignores an unsafe one', async () => {
  const run = async (redirect) => {
    nav.replaced.length = 0
    setUrl('/sign-in?redirect=' + encodeURIComponent(redirect))
    mockFetch((u) => u.endsWith('/login') ? { status: 200, json: { preAuthToken: 'pre', methods: ['email'], emailSent: true } } : u.endsWith('/verify-otp') ? { status: 200, json: {} } : { status: 200, json: { onboardingComplete: true } })
    render(h(SignIn()))
    await userEvent.type(document.getElementById('email'), 'a@x.com')
    await userEvent.type(document.getElementById('password'), 'secret123')
    await userEvent.click(screen.getByText('Continue securely').closest('button'))
    await screen.findAllByLabelText(/Digit 1/)
    await userEvent.type(screen.getByLabelText('Digit 1'), '123456')
    await waitFor(() => assert.equal(nav.replaced.length, 1))
    cleanup()
    return nav.replaced[0]
  }
  assert.equal(await run('/crm'), '/crm')
  assert.equal(await run('//evil.example'), '/dashboard')
  assert.equal(await run('https://evil.example'), '/dashboard')
})

test('A7. passkey cancel is a calm, retryable message — not a crash', async () => {
  mockFetch((u, m) => m === 'POST' ? { status: 200, json: { options: {}, userId: 'u' } } : { status: 200, json: {} })
  render(h(SignIn()))
  await userEvent.type(document.getElementById('email'), 'a@x.com')
  await userEvent.click(screen.getByText('Sign in with a passkey').closest('button'))
  const alert = await screen.findByRole('alert')
  assert.match(alert.textContent, /cancelled/i)
  assert.equal(screen.getByText('Sign in with a passkey').closest('button').disabled, false)
})

test('A8. session-ended notice is shown from ?reason=session', async () => {
  setUrl('/sign-in?reason=session')
  mockFetch(() => ({ status: 200, json: {} }))
  render(h(SignIn()))
  await screen.findByText(/session ended/i)
})

/* ───────────── reset ───────────── */
test('A9. reset: token read from the fragment, address bar scrubbed, verified via POST body (never GET/query)', async () => {
  setUrl('/reset-password#token=abc123')
  mockFetch((u) => ({ status: 200, json: { valid: true, email: 'a@x.com' } }))
  render(h(Reset()))
  await screen.findByText('a@x.com')
  assert.equal(dom.window.location.hash, '')
  assert.ok(!dom.window.location.href.includes('abc123'))
  assert.equal(calls[0].method, 'POST')
  assert.ok(calls[0].url.endsWith('/api/auth/password-reset/check') && !calls[0].url.includes('abc123'))
  assert.deepEqual(calls[0].body, { token: 'abc123' })
})

test('A10. reset: missing / expired / used links show distinct states', async () => {
  mockFetch(() => ({ status: 200, json: { valid: false, reason: 'expired' } }))
  setUrl('/reset-password#token=t1')
  render(h(Reset()))
  await screen.findByRole('heading', { name: /expired/i })
  cleanup()
  setUrl('/reset-password')
  render(h(Reset()))
  await screen.findByRole('heading', { name: /invalid|link/i })
  assert.equal(calls.length, 1) // missing token → no request at all
})

test('A11. reset: password rules are the canonical 8–128 contract (no uppercase/number demands) and confirm POSTs token in the body', async () => {
  setUrl('/reset-password#token=tok')
  mockFetch((u, m, b) => u.endsWith('/check') ? { status: 200, json: { valid: true, email: 'a@x.com' } } : { status: 200, json: { success: true } })
  render(h(Reset()))
  await screen.findByText('a@x.com')
  assert.ok(!/uppercase|lowercase|1 number/i.test(document.body.textContent))
  const [p1, p2] = Array.from(document.querySelectorAll('input[type=password]'))
  await userEvent.type(p1, 'alllowercase')
  await userEvent.type(p2, 'alllowercase')
  const submit = Array.from(document.querySelectorAll('button')).find(b => b.type === 'submit')
  await waitFor(() => assert.equal(submit.disabled, false))
  await userEvent.click(submit)
  await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/confirm'))))
  assert.deepEqual(calls.find(c => c.url.endsWith('/confirm')).body, { token: 'tok', newPassword: 'alllowercase' })
})

/* ───────────── invite ───────────── */
test('A12. invite: verify via POST, org + role are shown read-only, accept never sends org/role', async () => {
  setUrl('/invite#token=inv1')
  mockFetch((u) => u.endsWith('/verify') ? { status: 200, json: { valid: true, email: 'n@x.com', role: 'manager', organizationName: 'Doppelmayr India', firstName: 'N', lastName: 'M' } } : { status: 200, json: { webAccess: true } })
  render(h(Invite()))
  await screen.findByText('n@x.com')
  assert.match(document.body.textContent, /manager/)
  assert.equal(dom.window.location.hash, '')
  assert.deepEqual(calls[0].body, { token: 'inv1' })
  assert.ok(calls[0].method === 'POST' && !calls[0].url.includes('inv1'))
  const [p1, p2] = Array.from(document.querySelectorAll('input[type=password]'))
  await userEvent.type(p1, 'longenoughpw')
  await userEvent.type(p2, 'longenoughpw')
  const submit = Array.from(document.querySelectorAll('button')).find(b => b.type === 'submit')
  await waitFor(() => assert.equal(submit.disabled, false))
  await userEvent.click(submit)
  await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/accept'))))
  const body = calls.find(c => c.url.endsWith('/accept')).body
  assert.deepEqual(Object.keys(body).sort(), ['firstName', 'lastName', 'password', 'token'])
})

/* ───────────── restricted + source hygiene ───────────── */
test('A13. restricted page: explains, no implementation detail / workaround, signs out via POST', async () => {
  mockFetch(() => ({ status: 200, json: {} }))
  render(h(Restricted()))
  assert.ok(screen.getByText(/Web access isn.t enabled/))
  const text = document.body.textContent
  assert.ok(!/preview|android|webEnabled|organization id/i.test(text), text)
  await userEvent.click(screen.getByText('Sign Out').closest('button'))
  await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/api/auth/logout') && c.method === 'POST')))
})

test('A14. no legacy "Sign in to DoppelDash" / token-in-URL calls remain in the auth page sources', () => {
  for (const f of ['app/(auth)/sign-in/page.tsx', 'app/(auth)/forgot-password/page.tsx', 'app/(auth)/reset-password/page.tsx', 'app/invite/page.tsx', 'app/web-access-restricted/page.tsx']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8')
    assert.ok(!/Sign in to DoppelDash/.test(src), f)
    assert.ok(!/\?token=\$\{/.test(src), `${f} puts a token in a request URL`)
    assert.ok(!/orgId/.test(f.includes('invite') ? src.replace(/orgId\?: string/, '') : src), `${f} handles orgId on the client`)
  }
})
