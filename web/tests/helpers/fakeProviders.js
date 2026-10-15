/**
 * Protocol-faithful LOCAL fakes for the three external providers the receipt/OCR pipeline talks to, so the whole
 * pipeline can be tested end to end (and driven from a physical phone) without sending anything to real services:
 *
 *   /cloud/…    Cloudinary: signed + unsigned upload (verifies the documented sha1 signature, folder, formats, age),
 *               delivery of the uploaded bytes, destroy.
 *   /gemini/…   Gemini generateContent (key check; behaviour selectable via POST /__mode).
 *   /ollama/…   Ollama /api/chat (same modes).
 *   /__state, /__reset, /__mode   test controls.
 *
 * These prove OUR side of the contract (what we sign, send, validate and do with answers). They are not the real
 * providers: real Cloudinary preset settings and real model accuracy are NOT exercised by anything in this file.
 *
 * Standalone:  node tests/helpers/fakeProviders.js [port]      In tests: const { ensureFakeProviders, ENV } = require(...)
 */
const http = require('node:http')
const crypto = require('node:crypto')

const PORT = Number(process.env.FAKE_PROVIDERS_PORT) || 3912
const BASE = `http://127.0.0.1:${PORT}`
const ENV = {
  CLOUDINARY_CLOUD_NAME: 'testcloud', CLOUDINARY_API_KEY: 'test-api-key', CLOUDINARY_API_SECRET: 'test-api-secret',
  CLOUDINARY_UPLOAD_BASE: `${BASE}/cloud`, CLOUDINARY_DELIVERY_BASE: `${BASE}/cloud`,
  GEMINI_API_KEY: 'test-gemini-key', GEMINI_API_BASE: `${BASE}/gemini`, OLLAMA_URL: `${BASE}/ollama`,
}
const SIGNED_KEYS = ['allowed_formats', 'folder', 'overwrite', 'public_id', 'timestamp', 'type', 'upload_preset']
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex')
const sign = (params, secret) => sha1(Object.keys(params).filter(k => params[k] !== '').sort().map(k => `${k}=${params[k]}`).join('&') + secret)

const GOOD = { title: 'Taxi to client site', vendor: 'City Cabs', amount: 1250.5, date: '2026-10-03', description: 'Taxi fare' }
const state = { mode: { gemini: 'ok', ollama: 'ok' }, delayMs: { gemini: 0, ollama: 0 }, calls: { gemini: 0, ollama: 0 }, files: new Map(), uploads: [], destroyed: [], lastGeminiPart: null, receipt: GOOD, storage: { admin: 'ok', download: 'ok', destroy: 'ok' }, downloads: 0, adminCalls: 0 }
// Cloudinary delivery signature for authenticated assets: first 8 chars of url-safe base64 sha1(<public_id>.<ext> + secret)
const deliverySig = (idExt) => crypto.createHash('sha1').update(idExt + ENV.CLOUDINARY_API_SECRET).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8)

function sniffExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.subarray(0, 4).toString('latin1') === '\x89PNG') return 'png'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'heic'
  return null
}
const CT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', heic: 'image/heic' }

function readBody(req) { return new Promise(res => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))) }) }
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || ''); if (!m) return null
  const boundary = Buffer.from('--' + (m[1] || m[2])); const fields = {}; let file = null
  let pos = buf.indexOf(boundary)
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length); if (next === -1) break
    const part = buf.subarray(pos + boundary.length + 2, next - 2)
    const split = part.indexOf('\r\n\r\n'); const head = part.subarray(0, split).toString('utf8'); const data = part.subarray(split + 4)
    const name = /name="([^"]+)"/.exec(head)?.[1]
    if (/filename=/.test(head)) file = { name, data }; else if (name) fields[name] = data.toString('utf8')
    pos = next
  }
  return { fields, file }
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function modelAnswer(kind) {
  const mode = state.mode[kind]
  switch (mode) {
    case 'ok': return JSON.stringify(state.receipt)
    case 'fenced': return 'Here you go:\n```json\n' + JSON.stringify(state.receipt) + '\n```\nHope that helps!'
    case 'garbage': return 'I am sorry, I cannot read this image.'
    case 'badjson': return '{ "title": "x", "amount": }'
    case 'empty': return JSON.stringify({ title: null, vendor: null, amount: null, date: null, description: null })
    case 'evil': return JSON.stringify({
      title: 'Dinner\u0000\u0007 at\n\n  Trident ' + 'x'.repeat(500), vendor: { $ne: 1 }, amount: '₹4,500.50', date: '2026-02-31',
      description: 'd'.repeat(2000), status: 'paid', paidBy: 'attacker', userId: 'evil', orgId: 'org_other', managerNote: 'approved', paymentMethod: 'cash',
    })
    case 'badamount': return JSON.stringify({ ...state.receipt, amount: -5, date: '1999-01-01' })
    case 'futuredate': return JSON.stringify({ ...state.receipt, date: '2999-01-01' })
    default: return JSON.stringify(state.receipt)
  }
}

function handler(req, res) {
  const url = new URL(req.url, BASE); const p = url.pathname
  // The real Cloudinary API is CORS-enabled for browser uploads; mirror that so Web flows can be driven in a browser.
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  ;(async () => {
    if (p === '/__state') return json(res, 200, { lastGeminiRequest: state.lastGeminiRequest || null, mode: state.mode, calls: state.calls, uploads: state.uploads, destroyed: state.destroyed, files: [...state.files.keys()], downloads: state.downloads, adminCalls: state.adminCalls })
    if (p === '/__reset') { state.mode = { gemini: 'ok', ollama: 'ok' }; state.delayMs = { gemini: 0, ollama: 0 }; state.calls = { gemini: 0, ollama: 0 }; state.files.clear(); state.uploads = []; state.destroyed = []; state.receipt = GOOD; state.storage = { admin: 'ok', download: 'ok', destroy: 'ok' }; state.downloads = 0; state.adminCalls = 0; state.geminiKey = null; state.lastGeminiRequest = null; return json(res, 200, { ok: true }) }
    if (p === '/__inject' && req.method === 'POST') {
      // Put an asset straight into storage (as a provider that does NOT enforce size would): { path, bytes, ext, type }
      const b = JSON.parse((await readBody(req)).toString() || '{}')
      const head = { jpg: [0xff, 0xd8, 0xff, 0xe0], png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pdf: [0x25, 0x50, 0x44, 0x46, 0x2d] }[b.ext || 'jpg']
      const data = Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, b.bytes - head.length), 3)])
      state.files.set(`${b.path}.${b.ext || 'jpg'}`, { data, ct: CT[b.ext || 'jpg'], type: b.type || 'authenticated' })
      return json(res, 200, { ok: true, bytes: data.length })
    }
    if (p === '/__mode' && req.method === 'POST') { const b = JSON.parse((await readBody(req)).toString() || '{}'); for (const k of ['gemini', 'ollama']) { if (b[k]) state.mode[k] = b[k]; if (b[k + 'DelayMs'] !== undefined) state.delayMs[k] = b[k + 'DelayMs'] } if (b.receipt) state.receipt = b.receipt; if (b.geminiKey) state.geminiKey = b.geminiKey; if (b.storage) Object.assign(state.storage, b.storage); return json(res, 200, { ok: true }) }

    // ── Google OIDC key set (Pub/Sub push tokens) + Google Play Developer API (subscriptionsv2) + OAuth token endpoint ──
    if (p === '/__oidc' && req.method === 'POST') { state.oidcJwks = JSON.parse((await readBody(req)).toString() || '{}').keys || []; return json(res, 200, { ok: true }) }
    if (p === '/oidc/certs') return json(res, 200, { keys: state.oidcJwks || [] })
    if (p === '/__play-sa' && req.method === 'POST') { state.playSaPublicPem = JSON.parse((await readBody(req)).toString() || '{}').publicPem; return json(res, 200, { ok: true }) }
    if (p === '/__play' && req.method === 'POST') { const b = JSON.parse((await readBody(req)).toString() || '{}'); state.playSubs = state.playSubs || {}; if (b.token) { if (b.sub === null) delete state.playSubs[b.token]; else state.playSubs[b.token] = b.sub } if (b.mode) state.playMode = b.mode; if (b.reset) { state.playSubs = {}; state.playMode = 'ok'; state.playCalls = [] } return json(res, 200, { ok: true }) }
    if (p === '/__play-calls') return json(res, 200, { calls: state.playCalls || [] })
    if (p === '/play/token' && req.method === 'POST') {
      const form = new URLSearchParams((await readBody(req)).toString()); const assertion = form.get('assertion') || ''; const [h, c, sig] = assertion.split('.')
      state.playCalls = state.playCalls || []; state.playCalls.push({ kind: 'token' })
      if (!sig || !state.playSaPublicPem) return json(res, 400, { error: 'invalid_grant' })
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(state.playSaPublicPem, Buffer.from(sig, 'base64url'))
      const claim = ok ? JSON.parse(Buffer.from(c, 'base64url').toString()) : null
      if (!ok || claim.aud !== `${BASE}/play/token` || !/androidpublisher/.test(claim.scope || '') || claim.exp < Date.now() / 1000) return json(res, 400, { error: 'invalid_grant' })
      return json(res, 200, { access_token: 'fake-play-access-token', expires_in: 3600, token_type: 'Bearer' })
    }
    const sv2 = /^\/play\/androidpublisher\/v3\/applications\/([^/]+)\/purchases\/subscriptionsv2\/tokens\/([^/:]+)$/.exec(p)
    if (sv2) {
      state.playCalls = state.playCalls || []; state.playCalls.push({ kind: 'get', token: decodeURIComponent(sv2[2]) })
      if (req.headers.authorization !== 'Bearer fake-play-access-token') return json(res, 401, { error: { message: 'unauthenticated' } })
      if (state.playMode === 'error500') return json(res, 500, { error: { message: 'backend error' } })
      const sub = (state.playSubs || {})[decodeURIComponent(sv2[2])]
      if (!sub) return json(res, 404, { error: { message: 'not found' } })
      return json(res, 200, { kind: 'androidpublisher#subscriptionPurchaseV2', startTime: sub.startTime || new Date(Date.now() - 86400000).toISOString(), subscriptionState: sub.state, latestOrderId: sub.orderId || 'GPA.0000-0000-0000-00001', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', testPurchase: {}, lineItems: sub.noExpiry ? [{ productId: sub.productId }] : [{ productId: sub.productId, expiryTime: sub.expiryTime, ...(sub.autoRenewing === false ? {} : { autoRenewingPlan: {} }) }] })
    }

    // ── Gemini ──
    if (p.startsWith('/gemini/v1beta/models/') && req.method === 'POST') {
      state.calls.gemini++
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      state.lastGeminiPart = Object.keys(body?.contents?.[0]?.parts?.[1]?.inlineData || {})
      // what the support chat actually sent (never contains the key value): used by the outbound-payload assertions
      state.lastGeminiRequest = { urlHasKey: url.searchParams.has('key'), headerKey: Boolean(req.headers['x-goog-api-key']), body }
      // real Gemini accepts the key in the x-goog-api-key header as well as ?key=
      const sentKey = url.searchParams.get('key') || req.headers['x-goog-api-key']
      if (sentKey !== (state.geminiKey || ENV.GEMINI_API_KEY)) return json(res, 403, { error: { message: 'API key not valid' } })
      if (state.delayMs.gemini) await sleep(state.delayMs.gemini)
      if (state.mode.gemini === 'error500') return json(res, 500, { error: { message: 'boom secret-detail' } })
      if (state.mode.gemini === 'timeout') return // never answers
      if (state.mode.gemini === 'chat') return json(res, 200, { candidates: [{ content: { parts: [{ text: 'Use the Forgot password link on the sign-in page.' }] } }] })
      if (state.mode.gemini === 'chat-long') return json(res, 200, { candidates: [{ content: { parts: [{ text: 'x'.repeat(9000) }] } }] })
      if (state.mode.gemini === 'chat-malformed') return json(res, 200, { candidates: [{ content: { parts: [{ text: { not: 'a string' } }] } }] })
      if (state.mode.gemini === 'chat-empty') return json(res, 200, {})
      if (state.mode.gemini === 'chat-notjson') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('<<not json>>') }
      return json(res, 200, { candidates: [{ content: { parts: [{ text: modelAnswer('gemini') }] } }] })
    }
    // ── Ollama ──
    if (p === '/ollama/api/chat' && req.method === 'POST') {
      state.calls.ollama++
      await readBody(req)
      if (state.delayMs.ollama) await sleep(state.delayMs.ollama)
      if (state.mode.ollama === 'error500') return json(res, 500, { error: 'boom' })
      if (state.mode.ollama === 'timeout') return
      return json(res, 200, { message: { content: modelAnswer('ollama') } })
    }
    // ── Cloudinary ──
    const m = /^\/cloud\/v1_1\/([^/]+)\/(auto|image|raw)\/(upload|destroy)$/.exec(p)
    if (m && req.method === 'POST') {
      const [, cloud, , action] = m
      if (cloud !== ENV.CLOUDINARY_CLOUD_NAME) return json(res, 401, { error: { message: 'Invalid cloud_name ' + cloud } })
      const raw = await readBody(req)
      if (action === 'destroy') {
        if (state.storage.destroy === 'error500') return json(res, 500, { error: { message: 'boom' } })
        const f = Object.fromEntries(new URLSearchParams(raw.toString()))
        const expect = sign({ public_id: f.public_id, timestamp: f.timestamp, invalidate: f.invalidate, ...(f.type ? { type: f.type } : {}) }, ENV.CLOUDINARY_API_SECRET)
        if (f.api_key !== ENV.CLOUDINARY_API_KEY || f.signature !== expect) return json(res, 401, { error: { message: 'Invalid Signature' } })
        const key = [...state.files.keys()].find(k => k.startsWith(`${f.public_id}.`))
        if (key) state.files.delete(key)
        state.destroyed.push(f.public_id)
        return json(res, 200, { result: key ? 'ok' : 'not found' })
      }
      const mp = parseMultipart(raw, req.headers['content-type'])
      if (!mp || !mp.file) return json(res, 400, { error: { message: 'Missing required parameter - file' } })
      const f = mp.fields
      let folder = '', publicId = crypto.randomBytes(12).toString('hex')
      if (f.signature) {
        const signedParams = {}; for (const k of SIGNED_KEYS) if (f[k] !== undefined) signedParams[k] = f[k]
        if (f.api_key !== ENV.CLOUDINARY_API_KEY || sign(signedParams, ENV.CLOUDINARY_API_SECRET) !== f.signature) return json(res, 401, { error: { message: 'Invalid Signature' } })
        if (Math.abs(Date.now() / 1000 - Number(f.timestamp)) > 3600) return json(res, 401, { error: { message: 'Stale request' } })
        folder = f.folder || ''; publicId = f.public_id || publicId
        const ext0 = sniffExt(mp.file.data)
        const allowed = (f.allowed_formats || '').split(',').filter(Boolean)
        if (!ext0 || (state.storage.formats !== 'ignore' && allowed.length && !allowed.includes(ext0) && !(ext0 === 'jpg' && allowed.includes('jpeg')))) return json(res, 400, { error: { message: 'Format not allowed' } })  // storage.formats='ignore' simulates a provider that does NOT enforce allowed_formats
        const target = `${folder ? folder + '/' : ''}${publicId}`
        if (f.overwrite === 'false' && [...state.files.keys()].some(k => k.startsWith(target + '.'))) return json(res, 400, { error: { message: 'Resource already exists' } })
      } else if (f.upload_preset === 'test_unsigned') {
        folder = 'unsigned'
      } else return json(res, 401, { error: { message: 'Upload preset must be specified when using unsigned upload' } })
      const ext = sniffExt(mp.file.data); if (!ext) return json(res, 400, { error: { message: 'Invalid image file' } })
      const path = `${folder ? folder + '/' : ''}${publicId}`
      const type = f.type === 'authenticated' ? 'authenticated' : 'upload'
      state.files.set(`${path}.${ext}`, { data: mp.file.data, ct: CT[ext], type })
      state.uploads.push({ path: `${path}.${ext}`, bytes: mp.file.data.length, signed: !!f.signature, type, fields: Object.keys(f) })
      const sigSeg = type === 'authenticated' ? `s--${deliverySig(`${path}.${ext}`)}--/` : ''
      return json(res, 200, { secure_url: `${BASE}/cloud/${cloud}/image/${type}/${sigSeg}v1/${path}.${ext}`, public_id: path, format: ext, bytes: mp.file.data.length, resource_type: 'image', type })
    }
    // Admin API: resource details (Basic auth key:secret)
    const adm = /^\/cloud\/v1_1\/([^/]+)\/resources\/image\/(upload|authenticated)\/(.+)$/.exec(p)
    if (adm && req.method === 'GET') {
      state.adminCalls++
      const want = 'Basic ' + Buffer.from(`${ENV.CLOUDINARY_API_KEY}:${ENV.CLOUDINARY_API_SECRET}`).toString('base64')
      if (req.headers.authorization !== want) return json(res, 401, { error: { message: 'Invalid credentials' } })
      if (state.storage.admin === 'error500') return json(res, 500, { error: { message: 'boom' } })
      if (state.storage.admin === 'timeout') return
      const id = decodeURIComponent(adm[3]); const key = [...state.files.keys()].find(k => k.startsWith(id + '.'))
      const file = key && state.files.get(key)
      if (!file || file.type !== adm[2]) return json(res, 404, { error: { message: 'Resource not found - ' + id } })
      return json(res, 200, { public_id: id, format: key.split('.').pop(), bytes: file.data.length, type: file.type, resource_type: 'image' })
    }
    // Private download (what OUR server calls to read an authenticated asset)
    const dl = /^\/cloud\/v1_1\/([^/]+)\/image\/download$/.exec(p)
    if (dl && req.method === 'GET') {
      const q = Object.fromEntries(url.searchParams)
      const expect = sign({ format: q.format, public_id: q.public_id, timestamp: q.timestamp, type: q.type }, ENV.CLOUDINARY_API_SECRET)
      if (q.api_key !== ENV.CLOUDINARY_API_KEY || q.signature !== expect || Math.abs(Date.now() / 1000 - Number(q.timestamp)) > 3600) return json(res, 401, { error: { message: 'Invalid Signature' } })
      if (state.storage.download === 'error500') return json(res, 500, { error: { message: 'boom' } })
      if (state.storage.download === 'timeout') return
      const file = state.files.get(`${q.public_id}.${q.format}`)
      if (!file || file.type !== q.type) { res.writeHead(404); return res.end('not found') }
      state.downloads++
      if (state.storage.download === 'chunked') { // no Content-Length: the proxy must bound the stream itself
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        const CH = 1024 * 1024; for (let o = 0; o < file.data.length; o += CH) { if (!res.write(file.data.subarray(o, o + CH))) await new Promise(r => res.once('drain', r)) }
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.data.length }); return res.end(file.data)
    }
    const d = /^\/cloud\/([^/]+)\/(?:image|raw)\/(upload|authenticated)\/(?:s--([A-Za-z0-9_-]{8})--\/)?(?:v\d+\/)?(.+)$/.exec(p)
    if (d && req.method === 'GET') {
      const id = decodeURIComponent(d[4]); const file = state.files.get(id)
      if (!file || file.type !== d[2]) { res.writeHead(404); return res.end('not found') }
      // authenticated assets are only deliverable with a valid signature (a leaked signed URL keeps working — a bearer URL)
      if (d[2] === 'authenticated' && d[3] !== deliverySig(id)) { res.writeHead(401); return res.end('Invalid signature') }
      res.writeHead(200, { 'Content-Type': file.ct }); return res.end(file.data)
    }
    res.writeHead(404); res.end('no such fake route ' + p)
  })().catch(e => { try { json(res, 500, { error: String(e) }) } catch { /* closed */ } })
}

async function ping() { try { return (await fetch(`${BASE}/__state`, { signal: AbortSignal.timeout(500) })).ok } catch { return false } }

/** Starts the fake in-process unless one is already listening (standalone, e.g. for a phone session). */
async function ensureFakeProviders() {
  if (await ping()) return { stop: async () => {}, reused: true }
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve) })
  return { stop: () => new Promise(r => { server.closeAllConnections?.(); server.close(r) }), reused: false }
}
const control = {
  reset: () => fetch(`${BASE}/__reset`),
  mode: (m) => fetch(`${BASE}/__mode`, { method: 'POST', body: JSON.stringify(m) }),
  state: async () => (await fetch(`${BASE}/__state`)).json(),
}

module.exports = { ENV, BASE, PORT, sign, ensureFakeProviders, control }
if (require.main === module) {
  const server = http.createServer(handler)
  server.listen(PORT, '0.0.0.0', () => console.log(`fake providers on ${BASE}`))
}
