/**
 * Safety/logic tests for scripts/verify-gemini-ocr.js (one real Gemini call). Run against the LOCAL FAKE only — these tests prove the
 * script's refusals, redaction, single-request and egress rules, NOT anything about real Gemini. No subprocess here is ever given an
 * environment that passes preflight (that would make a real billable call).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const fake = require('./helpers/fakeProviders')
const { preflight, run } = require('../scripts/lib/geminiOcrCheck')

const KEY = 'AIzaFAKE-KEY-DO-NOT-PRINT-0123456789'
const ok = (o = {}) => ({ GEMINI_API_KEY: KEY, GEMINI_OCR_APPROVED: '1', ...o })
let providers
test.before(async () => { providers = await fake.ensureFakeProviders() })
test.after(async () => { await providers.stop() })
const FAKE = `${fake.BASE}/gemini`

test('G1. preflight: requires the key and explicit approval; refuses base overrides, Ollama fallback, production mode, malformed keys', () => {
  assert.equal(preflight(ok()).ok, true)
  for (const [env, re] of [[{}, /GEMINI_API_KEY is required/], [{ GEMINI_API_KEY: KEY }, /GEMINI_OCR_APPROVED=1/], [ok({ GEMINI_OCR_APPROVED: 'true' }), /GEMINI_OCR_APPROVED=1/], [ok({ GEMINI_API_BASE: 'http://127.0.0.1:1' }), /GEMINI_API_BASE/], [ok({ OLLAMA_URL: 'http://127.0.0.1:1' }), /OLLAMA_URL/], [ok({ NODE_ENV: 'production' }), /NODE_ENV/], [ok({ GEMINI_API_KEY: 'short' }), /malformed/], [ok({ GEMINI_API_KEY: 'has space in the key 123456789' }), /malformed/]]) {
    const r = preflight(env); assert.equal(r.ok, false, JSON.stringify(Object.keys(env))); assert.ok(r.problems.some(p => re.test(p)), r.problems.join(';')); assert.ok(!r.problems.join('').includes(KEY))
  }
})

test('G2. the script refuses (exit 2, nothing contacted, no key echoed) without approval or with unsafe configuration', () => {
  for (const env of [{}, { GEMINI_API_KEY: KEY }, ok({ OLLAMA_URL: 'http://127.0.0.1:1' }), ok({ GEMINI_API_BASE: 'http://127.0.0.1:1' })]) {
    assert.equal(preflight(env).ok, false, 'TEST BUG: this environment would pass preflight and trigger a real billable call')
    const r = spawnSync(process.execPath, [path.join(__dirname, '../scripts/verify-gemini-ocr.js')], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 2); assert.match(r.stderr, /REFUSING TO RUN/); assert.ok(!(r.stdout + r.stderr).includes(KEY))
  }
})

test('G3. a successful run (fake): exactly one request, extracted fields reported, the key and URLs never printed, fetch and env restored', async () => {
  await fake.control.reset(); await fake.control.mode({ geminiKey: KEY }); const lines = []; const before = globalThis.fetch; const envBefore = { k: process.env.GEMINI_API_KEY, b: process.env.GEMINI_API_BASE, o: process.env.OLLAMA_URL }
  const r = await run(ok(), { out: l => lines.push(l), __fakeBaseForTests: FAKE }); const text = lines.join('\n')
  assert.equal(r.ok, true, text); assert.equal(r.calls, 1); assert.equal((await fake.control.state()).calls.gemini, 1)
  assert.match(text, /LOCAL FAKE/); assert.match(text, /vendor="City Cabs" amount=1250.5/)
  assert.ok(!text.includes(KEY)); assert.doesNotMatch(text, /https?:\/\/|key=/i)
  assert.equal(globalThis.fetch, before); assert.deepEqual({ k: process.env.GEMINI_API_KEY, b: process.env.GEMINI_API_BASE, o: process.env.OLLAMA_URL }, envBefore, 'the process environment is restored exactly (whatever it was)')
})

test('G4. provider failure (HTTP 500 / timeout): the run FAILS, still exactly one request (no retry, no fallback), nothing sensitive printed', async () => {
  for (const mode of ['error500', 'timeout']) {
    await fake.control.reset(); await fake.control.mode({ gemini: mode, geminiKey: KEY }); const lines = []
    const r = await run(ok({ GEMINI_OCR_DEADLINE_MS: '1500' }), { out: l => lines.push(l), __fakeBaseForTests: FAKE }); const text = lines.join('\n')
    assert.equal(r.ok, false, mode); assert.equal(r.calls, 1, mode + ': no retry'); assert.match(text, /^FAIL .*answered by Gemini/m)
    assert.ok(!text.includes(KEY) && !/boom|secret-detail/.test(text), 'provider body / key not printed')
  }
})

test('G5. egress guard: while running, a request to any other host is blocked', async () => {
  await fake.control.reset(); await fake.control.mode({ geminiKey: KEY }); let blocked = null
  const p = run(ok(), { out: () => {}, __fakeBaseForTests: FAKE })
  try { await globalThis.fetch('https://example.com/') } catch (e) { blocked = e.message }
  await p; assert.match(blocked || '', /egress guard/)
})

test('G-model. the Gemini model is the retirement-proof alias by default (a hard-coded gemini-2.5-flash returned HTTP 404 "no longer available to new users" on the live staging OCR check with a new key), is overridable by a safe GEMINI_MODEL, and no source hard-codes a versioned model', () => {
  const fs = require('node:fs'), path = require('node:path'); const { geminiModel } = require('./helpers/authTestKit').load('lib/gemini.ts')
  assert.equal(geminiModel({}), 'gemini-flash-latest'); assert.equal(geminiModel({ GEMINI_MODEL: '' }), 'gemini-flash-latest')
  assert.equal(geminiModel({ GEMINI_MODEL: 'gemini-3.5-flash' }), 'gemini-3.5-flash')
  for (const bad of ['../evil', 'a/b', 'x'.repeat(80), 'UPPER', ' ', 'm?key=1', 'gemini-2.5-flash:generateContent#']) assert.equal(geminiModel({ GEMINI_MODEL: bad }), 'gemini-flash-latest', JSON.stringify(bad))
  const root = path.resolve(__dirname, '..'); const hits = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.next', 'tests', 'docs'].includes(e.name) || e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && /gemini-\d/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p)) } }
  walk(path.join(root, 'app')); walk(path.join(root, 'lib'))
  assert.deepEqual(hits, [], 'no versioned Gemini model name in application code')
})
