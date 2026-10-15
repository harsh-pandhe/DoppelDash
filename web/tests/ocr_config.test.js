/**
 * OCR provider chain under bad configuration: credentials absent, invalid, provider hung. Gemini → Ollama (only if
 * configured) → empty fallback; NEVER an invented result. Providers are local fakes (tests/helpers/fakeProviders.js);
 * the module reads its configuration from process.env on every call, so each case sets exactly what it needs.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers/domKit')
const fake = require('./helpers/fakeProviders')
const { runReceiptOcr, EMPTY_RECEIPT } = load('lib/ocr/receiptOcr.ts')

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64')
const KEYS = ['GEMINI_API_KEY', 'GEMINI_API_BASE', 'OLLAMA_URL', 'NODE_ENV']
let providers, saved
const set = env => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, env) }

test.before(async () => { providers = await fake.ensureFakeProviders(); saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])) })
test.after(async () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } await providers.stop() })
test.beforeEach(async () => { await fake.control.reset() })

const GOOD = { GEMINI_API_KEY: fake.ENV.GEMINI_API_KEY, GEMINI_API_BASE: fake.ENV.GEMINI_API_BASE, OLLAMA_URL: fake.ENV.OLLAMA_URL, NODE_ENV: 'development' }
const calls = async () => (await fake.control.state()).calls

test('K1. no credentials at all: no provider is contacted and NOTHING is invented — an honest empty result', async () => {
  set({ NODE_ENV: 'development' })
  const r = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000)
  assert.deepEqual(r.parsed, EMPTY_RECEIPT); assert.equal(r.provider, 'fallback'); assert.deepEqual(r.attempts, [])
  assert.deepEqual(await calls(), { gemini: 0, ollama: 0 })
  // production behaves identically (and a leftover override is not honoured)
  set({ NODE_ENV: 'production', GEMINI_API_BASE: fake.ENV.GEMINI_API_BASE })
  const p = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000)
  assert.equal(p.provider, 'fallback'); assert.deepEqual(await calls(), { gemini: 0, ollama: 0 })
})

test('K2. an INVALID Gemini key: the provider refuses (403) → graceful fallback; the key and provider text are never logged', async () => {
  set({ ...GOOD, GEMINI_API_KEY: 'definitely-wrong-key', OLLAMA_URL: '' })
  const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '))
  let r
  try { r = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000) } finally { console.error = orig }
  assert.equal(r.provider, 'fallback'); assert.deepEqual(r.parsed, EMPTY_RECEIPT); assert.deepEqual(r.attempts, [{ provider: 'gemini', outcome: 'error' }])
  assert.equal((await calls()).gemini, 1)
  assert.ok(logged.length === 1 && !logged.join('\n').includes('definitely-wrong-key') && !/API key not valid/.test(logged.join('\n')), 'only a short status is logged: ' + logged.join('|'))
})

test('K3. Gemini invalid + Ollama CONFIGURED → the configured fallback answers; Ollama is used only when configured', async () => {
  set({ ...GOOD, GEMINI_API_KEY: 'wrong' })
  const r = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000)
  assert.equal(r.provider, 'ollama'); assert.equal(r.parsed.vendor, 'City Cabs'); assert.deepEqual(r.attempts.map(a => a.provider), ['gemini', 'ollama'])
  await fake.control.reset()
  set({ ...GOOD, GEMINI_API_KEY: 'wrong', OLLAMA_URL: '' })
  const none = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000)
  assert.equal(none.provider, 'fallback'); assert.equal((await calls()).ollama, 0, 'an unconfigured Ollama is never contacted')
})

test('K4. provider timeout: the whole chain stops at the deadline and returns the empty fallback (no hang, no fabricated data)', async () => {
  set(GOOD)
  await fake.control.mode({ gemini: 'timeout', ollama: 'timeout' })
  const t0 = Date.now()
  const r = await runReceiptOcr(JPEG_B64, 'image/jpeg', 1500)
  const took = Date.now() - t0
  assert.equal(r.provider, 'fallback'); assert.deepEqual(r.parsed, EMPTY_RECEIPT)
  assert.ok(took < 4500, `returned in ${took} ms`)
  assert.ok(r.attempts.every(a => a.outcome === 'error'))
})

test('K5. junk answers never become data: garbage / broken JSON / hostile JSON from every provider → empty fallback', async () => {
  set(GOOD)
  for (const mode of ['garbage', 'badjson', 'empty']) {
    await fake.control.mode({ gemini: mode, ollama: mode })
    const r = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000)
    assert.equal(r.provider, 'fallback', mode); assert.deepEqual(r.parsed, EMPTY_RECEIPT, mode)
  }
})

test('K6. a working Gemini answer is returned once, validated, with Ollama untouched', async () => {
  set(GOOD)
  const r = await runReceiptOcr(JPEG_B64, 'image/jpeg', 3000)
  assert.equal(r.provider, 'gemini'); assert.equal(r.parsed.amount, 1250.5)
  assert.deepEqual(await calls(), { gemini: 1, ollama: 0 })
})
