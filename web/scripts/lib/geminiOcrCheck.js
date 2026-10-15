/**
 * ONE bounded, owner-authorized real Gemini OCR call on the synthetic receipt (tests/fixtures/synthetic_receipt.png).
 * Separate from the strict Cloudinary staging harness (scripts/lib/stagingVerify.js), which is unchanged.
 *
 *  - explicit opt-in: GEMINI_OCR_APPROVED=1 plus GEMINI_API_KEY in THIS process' environment (never read from files here);
 *  - refuses GEMINI_API_BASE / OLLAMA_URL (the call must reach Google only, and must not fall back to another provider);
 *  - egress guard: fetch may reach only generativelanguage.googleapis.com for the whole run;
 *  - exactly one request (no Ollama configured → the chain has a single step, no retry); no repeated billable calls;
 *  - output is redacted: the key never appears; the provider body is never printed; only the parsed synthetic-receipt fields are shown.
 * Programmatic option `__fakeBaseForTests` exists only for tests/gemini_ocr_check.test.js; the entry script never sets it.
 */
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '../..')
const HOST = 'https://generativelanguage.googleapis.com'

function preflight(env) {
  const problems = []
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV=production is not allowed')
  if (!env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()) problems.push('GEMINI_API_KEY is required')
  else if (/\s/.test(env.GEMINI_API_KEY.trim()) || env.GEMINI_API_KEY.trim().length < 20) problems.push('GEMINI_API_KEY is malformed')
  if (env.GEMINI_OCR_APPROVED !== '1') problems.push('GEMINI_OCR_APPROVED=1 is required (explicit owner approval for this one billable call)')
  if (env.GEMINI_API_BASE) problems.push('GEMINI_API_BASE must be unset (the call must reach Google only)')
  if (env.OLLAMA_URL) problems.push('OLLAMA_URL must be unset (no fallback provider; exactly one request)')
  return { ok: problems.length === 0, problems }
}

async function run(env, opts = {}) {
  const out = opts.out || (l => console.log(l))
  const key = env.GEMINI_API_KEY.trim()
  const redact = t => String(t).split(key).join('[redacted]').replace(/https?:\/\/[^\s'")]+/gi, '[url]').replace(/key=[^&\s]+/gi, 'key=[redacted]')
  const say = l => out(redact(l))
  const fake = opts.__fakeBaseForTests || null
  const allowed = new Set([new URL(fake || HOST).origin])
  const realFetch = globalThis.fetch; let calls = 0
  globalThis.fetch = (url, init) => {
    const u = typeof url === 'string' ? url : url && url.url ? url.url : String(url)
    let o; try { o = new URL(u).origin } catch { throw new Error('egress guard: invalid URL') }
    if (!allowed.has(o)) throw new Error('egress guard: blocked a request to a non-allowed host')
    calls++; return realFetch(url, init)
  }
  const saved = { k: process.env.GEMINI_API_KEY, b: process.env.GEMINI_API_BASE, o: process.env.OLLAMA_URL, n: process.env.NODE_ENV }
  process.env.GEMINI_API_KEY = key; delete process.env.OLLAMA_URL
  if (fake) process.env.GEMINI_API_BASE = fake; else delete process.env.GEMINI_API_BASE
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development'
  let ok = false, result = null, t0 = Date.now(), errClass = null
  try {
    const jiti = require(path.join(ROOT, 'node_modules/jiti'))(__filename, { alias: { '@': ROOT } })
    const { runReceiptOcr } = jiti(path.join(ROOT, 'lib/ocr/receiptOcr.ts'))
    const png = fs.readFileSync(path.join(ROOT, 'tests/fixtures/synthetic_receipt.png'))
    say(`Target: ${fake ? 'LOCAL FAKE (unit test only)' : 'REAL Gemini API (existing configured testing key)'}   image: synthetic fixture (${png.length} bytes)`)
    result = await runReceiptOcr(png.toString('base64'), 'image/png', Number(env.GEMINI_OCR_DEADLINE_MS) || 30_000)
  } catch (e) { errClass = (e && e.name) || 'Error' } finally {
    for (const [k, v] of [['GEMINI_API_KEY', saved.k], ['GEMINI_API_BASE', saved.b], ['OLLAMA_URL', saved.o], ['NODE_ENV', saved.n]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    globalThis.fetch = realFetch
  }
  const ms = Date.now() - t0
  const rows = []
  const rec = (name, pass, note = '') => { rows.push({ name, pass }); say(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? '  - ' + note : ''}`) }
  if (!result) { rec('OCR call completed', false, errClass || 'no result'); return { ok: false, rows, calls, ms } }
  const p = result.parsed
  say(`INFO  chain attempts: ${result.attempts.map(a => `${a.provider}:${a.outcome}`).join(', ') || 'none'}; HTTP requests made: ${calls}; elapsed ${ms} ms`)
  rec('exactly one provider request was made', calls === 1, `${calls}`)
  rec('answered by Gemini (not an empty fallback)', result.provider === 'gemini', result.provider)
  say(`INFO  extracted (synthetic receipt): vendor=${JSON.stringify(p.vendor)} amount=${JSON.stringify(p.amount)} date=${JSON.stringify(p.date)} title=${JSON.stringify(p.title)}`)
  rec('total matches the receipt (1250.50)', Number(p.amount) === 1250.5, String(p.amount))
  rec('vendor matches the receipt (City Cabs)', /city\s*cabs/i.test(p.vendor || ''), String(p.vendor))
  rec('date matches the receipt (03/10/2026 → 2026-10-03 or 2026-03-10)', /^2026-(10-03|03-10)$/.test(p.date || ''), String(p.date))
  ok = rows.every(r => r.pass)
  say('NOTE: this is ONE real call on ONE synthetic image. It shows the request/response path and extraction of this fixture; it is not an accuracy benchmark.')
  return { ok, rows, calls, ms, result }
}
module.exports = { preflight, run }
