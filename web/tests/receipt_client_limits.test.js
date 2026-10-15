/**
 * Feature 3.1.2 — Web client pre-check follows the AUTHENTICATED organisation's receipt limit (Free 5 MB / Premium 25 MB).
 * The limit comes only from GET /api/auth/me → entitlements.limits.maxUploadSizeBytes (never from org name/slug/id/email).
 * The server stays authoritative; this is the early, friendly check. No server needed: fetch is stubbed.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers/domKit')
const MB = 1024 * 1024

const lib = load('lib/cloudinary.ts')
const realFetch = globalThis.fetch
let calls
function stub({ me, meStatus = 200 }) {
  calls = []
  lib.clearUploadLimitCache()
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    if (String(url) === '/api/auth/me') return { ok: meStatus === 200, status: meStatus, json: async () => me }
    return { ok: false, status: 503, json: async () => ({ error: 'stop here' }) } // the sign call: proves the pre-check passed
  }
}
test.afterEach(() => { globalThis.fetch = realFetch; lib.clearUploadLimitCache() })
const file = (size, name = 'r.png') => ({ name, size, type: 'image/png' })
const meWith = (name, bytes) => ({ organization: { name, slug: name.toLowerCase(), orgId: 'org_x' }, entitlements: { plan: 'x', limits: bytes === undefined ? {} : { maxUploadSizeBytes: bytes } } })
const outcome = async f => { try { await lib.uploadToCloudinary(f, 'receipt'); return 'ok' } catch (e) { return e.message } }

test('Free (5 MB): exactly 5 MB passes the pre-check, one byte more is rejected with the plan limit — before any sign request', async () => {
  stub({ me: meWith('Acme', 5 * MB) })
  assert.equal(await outcome(file(5 * MB)), 'stop here', 'at the limit → continues to the server')
  assert.ok(calls.includes('/api/uploads/sign'))
  stub({ me: meWith('Acme', 5 * MB) })
  assert.equal(await outcome(file(5 * MB + 1, 'big.png')), 'big.png is larger than the 5 MB limit for your plan.')
  assert.deepEqual(calls, ['/api/auth/me'], 'rejected locally: no upload ticket requested')
})

test('Premium / Doppelmayr (25 MB): 25 MB passes, one byte more is rejected', async () => {
  stub({ me: meWith('Doppelmayr India', 25 * MB) })
  assert.equal(await outcome(file(25 * MB)), 'stop here')
  stub({ me: meWith('Doppelmayr India', 25 * MB) })
  assert.equal(await outcome(file(25 * MB + 1, 'big.pdf')), 'big.pdf is larger than the 25 MB limit for your plan.')
  stub({ me: meWith('Doppelmayr India', 25 * MB) })
  assert.equal(await outcome(file(5 * MB + 1)), 'stop here', 'a 5 MB+1 file is fine for Premium')
})

test('the limit is never inferred from names: a Free org called "Doppelmayr" is held to 5 MB, a Premium org with any name gets 25 MB', async () => {
  stub({ me: meWith('Doppelmayr India', 5 * MB) })
  assert.match(await outcome(file(6 * MB)), /5 MB limit/)
  stub({ me: meWith('Tiny Startup', 25 * MB) })
  assert.equal(await outcome(file(6 * MB)), 'stop here')
})

test('limit unknown (no entitlement data / /me failing): falls back to the 25 MB ceiling; the server decides', async () => {
  stub({ me: meWith('Acme') })
  assert.equal(await outcome(file(25 * MB)), 'stop here')
  stub({ me: meWith('Acme') })
  assert.match(await outcome(file(25 * MB + 1)), /25 MB limit/)
  stub({ me: null, meStatus: 500 })
  assert.equal(await outcome(file(10 * MB)), 'stop here')
})

test('pure helper: boundary and wording (fractional limits are shown honestly)', () => {
  assert.equal(lib.oversizeMessage('a.png', 5 * MB, 5 * MB), null)
  assert.equal(lib.oversizeMessage('a.png', 5 * MB + 1, 5 * MB), 'a.png is larger than the 5 MB limit for your plan.')
  assert.equal(lib.oversizeMessage('a.png', 3 * MB, 2.5 * MB), 'a.png is larger than the 2.5 MB limit for your plan.')
})

test('the server still enforces its own limit regardless of the client (413 body is surfaced verbatim)', async () => {
  stub({ me: meWith('Acme', 25 * MB) }) // a stale/forged client limit
  globalThis.fetch = async (url) => String(url) === '/api/auth/me'
    ? { ok: true, status: 200, json: async () => meWith('Acme', 25 * MB) }
    : { ok: false, status: 413, json: async () => ({ error: 'File is too large. The limit for your plan is 5 MB.' }) }
  assert.equal(await outcome(file(6 * MB)), 'File is too large. The limit for your plan is 5 MB.')
})
