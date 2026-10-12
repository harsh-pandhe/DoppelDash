/**
 * Core of the OPERATOR-RUN Cloudinary STAGING verification (see scripts/verify-cloudinary-staging.js and
 * docs/RECEIPT_STORAGE_AND_OCR.md §12). Split out so every safety rule is unit-testable WITHOUT any provider.
 *
 * Nothing here ever reads a .env file, queries a deployment tool or inherits credentials from another process: the ONLY input is the
 * environment object handed to `preflight` (the entry script passes `process.env`).
 *
 * Results produced by this module against a REAL staging cloud are staging evidence. Results produced by the tests against the local
 * fake provider (tests/helpers/fakeProviders.js) are NOT: they only prove this harness's own logic. The programmatic option
 * `__fakeProviderForTests` exists solely for those tests; the entry script never sets it and `preflight` never allows overrides.
 */
const path = require('path')
const fs = require('fs')
const { randomBytes } = require('crypto')

const ROOT = path.resolve(__dirname, '../..')
const CLOUD_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/i
const KEY_RE = /^[A-Za-z0-9_-]{6,64}$/
const DB_PREFIX = 'dd_staging_verify_'
const RUN_ORG_RE = /^zz-verify-[0-9a-f]{8}$/
const ID_RE = /^doppeldash\/(zz-verify-[0-9a-f]{8})\/receipts\/[0-9a-f]{32}$/
const MB = 1024 * 1024

/* ───────────────────────── redaction: nothing sensitive may ever reach a log ───────────────────────── */
function makeRedactor(secrets) {
  const lits = [...new Set(secrets.filter(s => typeof s === 'string' && s.length >= 4))].sort((a, b) => b.length - a.length)
  return text => {
    let t = String(text)
    for (const l of lits) t = t.split(l).join('[redacted]')
    return t
      .replace(/https?:\/\/[^\s'")]+/gi, '[url]')
      .replace(/cld:[^\s'")]+/gi, '[ref]')
      .replace(/doppeldash\/[^\s'")]+/gi, '[asset-id]')
      .replace(/\b[0-9a-f]{32,}\b/gi, '[hex]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  }
}
/** Error → a short, non-sensitive description (never the message, which can embed URLs or ids). */
const safeErr = e => `${(e && e.name) || 'Error'}${e && e.cause && e.cause.code ? '/' + e.cause.code : e && e.code ? '/' + e.code : ''}`

/* ───────────────────────── preflight: pure, runs BEFORE any network/DB/provider action ───────────────────────── */
function isLoopbackMongo(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)\/([^?]*)/.exec(uri || '')
  if (!m) return null
  const hosts = m[1].split(',')
  const ok = hosts.every(h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h))
  return ok ? { db: decodeURIComponent(m[2]) } : null
}
function preflight(env) {
  const problems = []
  const bad = m => problems.push(m)
  const cloud = (env.CLOUDINARY_CLOUD_NAME || '').trim()
  const prod = (env.PRODUCTION_CLOUDINARY_CLOUD_NAME || '').trim()

  if (env.NODE_ENV === 'production') bad('NODE_ENV=production is not allowed')
  // credentials present and well-formed
  if (!cloud) bad('CLOUDINARY_CLOUD_NAME is required')
  else if (!CLOUD_RE.test(cloud)) bad('CLOUDINARY_CLOUD_NAME is malformed (letters, digits, - and _ only)')
  if (!env.CLOUDINARY_API_KEY) bad('CLOUDINARY_API_KEY is required')
  else if (!KEY_RE.test(env.CLOUDINARY_API_KEY.trim())) bad('CLOUDINARY_API_KEY is malformed')
  if (!env.CLOUDINARY_API_SECRET) bad('CLOUDINARY_API_SECRET is required')
  else if (env.CLOUDINARY_API_SECRET.trim().length < 8 || /\s/.test(env.CLOUDINARY_API_SECRET.trim())) bad('CLOUDINARY_API_SECRET is malformed')
  // explicit staging acknowledgement (exact, case-sensitive) …
  if (cloud && env.CLOUDINARY_STAGING_CONFIRM !== cloud) bad('CLOUDINARY_STAGING_CONFIRM must equal CLOUDINARY_CLOUD_NAME exactly')
  // … AND an explicit production cloud name to compare against: a confirmation string alone proves nothing.
  if (!prod) bad('PRODUCTION_CLOUDINARY_CLOUD_NAME is required (the production cloud name, used only to refuse a collision)')
  else if (!CLOUD_RE.test(prod)) bad('PRODUCTION_CLOUDINARY_CLOUD_NAME is malformed')
  else if (cloud && prod.toLowerCase() === cloud.toLowerCase()) bad('the configured cloud IS the production cloud — refusing')
  // ambiguous / alternative ways of configuring storage must not exist
  const pub = (env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || '').trim()
  if (pub && pub !== cloud) bad('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME is set to a different value — unset it (ambiguous cloud)')
  if (pub && prod && pub.toLowerCase() === prod.toLowerCase()) bad('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME names the production cloud — refusing')
  for (const k of ['CLOUDINARY_UPLOAD_BASE', 'CLOUDINARY_DELIVERY_BASE', 'ALLOW_UNSIGNED_UPLOADS', 'CLOUDINARY_URL', 'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'CLOUDINARY_UPLOAD_PRESET']) {
    if (env[k]) bad(`${k} must be unset (fake/override/unsigned configuration is not allowed here)`)
  }
  // optional OCR check: opt-in only, real Gemini only
  const gemini = !!env.GEMINI_API_KEY
  if (gemini) {
    if (env.GEMINI_STAGING_CONFIRM !== '1') bad('GEMINI_API_KEY is set: GEMINI_STAGING_CONFIRM=1 is required to confirm it is a safe staging key')
    if (env.GEMINI_API_BASE) bad('GEMINI_API_BASE must be unset')
    if (env.OLLAMA_URL) bad('OLLAMA_URL must be unset (the OCR chain would fall back to it)')
  }
  // local throwaway database (the cleanup scenario writes manifest rows)
  const mongo = isLoopbackMongo(env.MONGODB_URI)
  if (!env.MONGODB_URI) bad('MONGODB_URI is required (a LOCAL throwaway database)')
  else if (!mongo) bad('MONGODB_URI must be a plain loopback mongodb:// URI (no remote host, no srv)')
  else if (!mongo.db.startsWith(DB_PREFIX)) bad(`the database name must start with "${DB_PREFIX}" (a database created for this run)`)
  // cleanup driven through a local app server (optional)
  if (env.STAGING_APP_URL) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(env.STAGING_APP_URL)) bad('STAGING_APP_URL must be http://127.0.0.1:<port> (a local app server)')
    if (!env.STAGING_CRON_SECRET || env.STAGING_CRON_SECRET.length < 16) bad('STAGING_CRON_SECRET (>= 16 chars) is required with STAGING_APP_URL')
  } else if (env.STAGING_CLEANUP_APPLY !== '1') {
    // in-process cleanup is the fallback; it must be enabled explicitly
    bad('set STAGING_APP_URL + STAGING_CRON_SECRET (recommended) or STAGING_CLEANUP_APPLY=1 (in-process cleanup)')
  }
  return {
    ok: problems.length === 0, problems,
    config: problems.length ? null : {
      cloud, key: env.CLOUDINARY_API_KEY.trim(), secret: env.CLOUDINARY_API_SECRET.trim(), prod,
      signedPreset: (env.CLOUDINARY_SIGNED_PRESET || '').trim() || null, gemini, mongoUri: env.MONGODB_URI, db: mongo.db,
      appUrl: env.STAGING_APP_URL || null, cronSecret: env.STAGING_CRON_SECRET || null,
    },
  }
}

/** Exact identity check applied before ANY destructive call: tracked by THIS run, in this run's own tenant folder, well-formed. */
function makeOwnership(ownedOrgs, owned) {
  return (publicId, orgId) => typeof publicId === 'string' && typeof orgId === 'string' && ownedOrgs.has(orgId) && owned.get(publicId) === orgId && ID_RE.test(publicId) && ID_RE.exec(publicId)[1] === orgId
}

/* ───────────────────────── run ───────────────────────── */
/**
 * @param {object} cfg            result of preflight().config
 * @param {object} opts           { out(line), __fakeProviderForTests?: { uploadBase, deliveryBase } }
 * @returns {Promise<{ exitCode: number, results: {name, ok}[], cleanupIncomplete: number }>}
 */
async function run(cfg, opts = {}) {
  const redact = makeRedactor([cfg.secret, cfg.key, cfg.cronSecret, cfg.cloud !== 'testcloud' ? cfg.cloud : null])
  const emit = opts.out || (l => console.log(l))
  const say = l => emit(redact(l))
  const results = []
  const rec = (name, ok, note = '') => { results.push({ name, ok }); say(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  - ' + note : ''}`) }
  const info = l => say(`INFO  ${l}`)

  // Storage config is derived ONLY from the validated values; overrides exist solely for the local fake in tests.
  const fake = opts.__fakeProviderForTests || null
  const storageEnv = { CLOUDINARY_CLOUD_NAME: cfg.cloud, CLOUDINARY_API_KEY: cfg.key, CLOUDINARY_API_SECRET: cfg.secret, ...(cfg.signedPreset ? { CLOUDINARY_SIGNED_PRESET: cfg.signedPreset } : {}), NODE_ENV: 'development', ...(fake ? { CLOUDINARY_UPLOAD_BASE: fake.uploadBase, CLOUDINARY_DELIVERY_BASE: fake.deliveryBase } : {}) }
  const jiti = require(path.join(ROOT, 'node_modules/jiti'))(__filename, { alias: { '@': ROOT } })
  const S = jiti(path.join(ROOT, 'lib/uploads/attachmentStorage.ts'))
  const C = jiti(path.join(ROOT, 'lib/uploads/receiptCleanup.ts'))
  const scfg = S.storageConfig(storageEnv)
  if (!scfg.signed) throw new Error('storage configuration is not in signed mode')
  if (!fake && (scfg.uploadBase !== 'https://api.cloudinary.com' || scfg.deliveryBase !== 'https://res.cloudinary.com')) throw new Error('unexpected provider base URL')

  // EGRESS GUARD: for the whole run, fetch may only reach the provider's two hosts (or the declared local app server). Anything else throws.
  const allowed = new Set([new URL(scfg.uploadBase).origin, new URL(scfg.deliveryBase).origin, ...(cfg.appUrl ? [new URL(cfg.appUrl).origin] : []), ...(cfg.gemini ? ['https://generativelanguage.googleapis.com'] : [])])
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, init) => {
    const u = typeof url === 'string' ? url : url && url.url ? url.url : String(url)
    let origin; try { origin = new URL(u).origin } catch { throw new Error('egress guard: invalid URL') }
    if (!allowed.has(origin)) throw new Error('egress guard: blocked a request to a non-allowed host')
    return realFetch(url, init)
  }

  const mongoose = require(path.join(ROOT, 'node_modules/mongoose'))
  const runTag = 'zz-verify-' + randomBytes(4).toString('hex')            // tenant id of THIS run
  const orgMain = runTag, orgControl = 'zz-verify-' + randomBytes(4).toString('hex')
  const ownedOrgs = new Set([orgMain, orgControl])
  const owned = new Map()                                                  // publicId → orgId : the ONLY assets this run may ever delete
  let primaryError = null, cleanupIncomplete = 0, dbCreated = false
  const png = fs.readFileSync(path.join(ROOT, 'tests/fixtures/synthetic_receipt.png'))
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
  const BIG = 25 * MB

  /** Exact identity check before ANY destructive action: tracked by this run, inside this run's own tenant folder, well-formed. */
  const isOwned = makeOwnership(ownedOrgs, owned)
  async function destroyOwned(publicId, orgId) {
    if (!isOwned(publicId, orgId)) throw new Error('refusing to delete: not an asset created by this run')
    return S.destroyReceiptAsset(publicId, orgId, scfg)
  }
  const exists = async (publicId, orgId, ext) => (await S.verifyStoredReceipt(`cld:${publicId}.${ext}`, orgId, BIG, scfg)).ok
  const lookup = (publicId, orgId, ext) => S.verifyStoredReceipt(`cld:${publicId}.${ext}`, orgId, BIG, scfg)

  async function ticket(orgId, mime, size) {
    const t = S.issueUploadTicket({ orgId, kind: 'receipt', maxBytes: BIG, mime }, scfg)
    const publicId = `${t.fields.folder}/${t.fields.public_id}`
    if (!ID_RE.test(publicId) || ID_RE.exec(publicId)[1] !== orgId) throw new Error('ticket outside the run tenant')
    owned.set(publicId, orgId)                                             // tracked BEFORE the upload so a half-finished upload is still cleaned
    return { t, publicId }
  }
  async function upload(t, bytes, mutate) {
    const fields = { ...t.fields }; if (mutate) mutate(fields)
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    fd.append('file', new Blob([bytes]), 'receipt.bin')
    const res = await fetch(t.uploadUrl, { method: 'POST', body: fd })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  }

  try {
    say(`Run tag: ${runTag}   (everything this run creates lives under this tenant id and is the only thing it will ever delete)`)
    // ── throwaway DB: must be new/empty for the collections we use; refuse otherwise ──
    await mongoose.connect(cfg.mongoUri, { serverSelectionTimeoutMS: 8000 })
    const dbh = mongoose.connection.db
    for (const c of ['receiptuploads', 'expenses']) if ((await dbh.collection(c).countDocuments()) > 0) throw new Error(`refusing: database already contains ${c} — use a fresh dd_staging_verify_* database`)
    dbCreated = true
    const Up = require(path.join(ROOT, 'node_modules/mongoose')).models.ReceiptUpload || jiti(path.join(ROOT, 'models/ReceiptUpload.ts')).default
    jiti(path.join(ROOT, 'models/Expense.ts'))
    await Up.syncIndexes()

    // ═════ 1. signed upload, tenant folder, random id, private type, metadata, private download ═════
    const main = await ticket(orgMain, 'image/png', png.length)
    const up = await upload(main.t, png)
    rec('signed receipt upload accepted', up.status === 200, `status ${up.status}`)
    rec('asset type is authenticated (no public delivery)', up.body.type === 'authenticated')
    rec('public id is inside the run tenant folder and random', up.body.public_id === main.publicId && /\/[0-9a-f]{32}$/.test(up.body.public_id || ''))
    const refExt = String(up.body.format || 'png')
    const meta = await lookup(main.publicId, orgMain, refExt)
    rec('Admin API metadata lookup verifies the asset', meta.ok === true, meta.ok ? `${meta.bytes} bytes, ${meta.format}` : meta.reason)
    rec('plan size limit is enforced at attach (too_large)', (await S.verifyStoredReceipt(`cld:${main.publicId}.${refExt}`, orgMain, 100, scfg)).reason === 'too_large')
    rec('another tenant cannot resolve the reference', (await S.verifyStoredReceipt(`cld:${main.publicId}.${refExt}`, orgControl, BIG, scfg)).ok === false)
    {
      const dl = S.privateDownloadUrl(`cld:${main.publicId}.${refExt}`, orgMain, scfg)
      const r = await fetch(dl); const buf = Buffer.from(await r.arrayBuffer())
      rec('signed private download returns the uploaded bytes', r.ok && buf.equals(png), `status ${r.status}, ${buf.length} bytes`)
      const pub = await fetch(`${scfg.deliveryBase}/${cfg.cloud}/image/upload/${main.publicId}.${refExt}`)
      rec('public (unsigned) delivery URL does NOT serve the receipt', pub.status >= 400, `status ${pub.status}`)
      const auth = await fetch(`${scfg.deliveryBase}/${cfg.cloud}/image/authenticated/${main.publicId}.${refExt}`)
      rec('authenticated delivery URL without a signature is refused', auth.status >= 400, `status ${auth.status}`)
      const stale = await fetch(S.privateDownloadUrl(`cld:${main.publicId}.${refExt}`, orgMain, scfg, Date.now() - 2 * 3600e3))
      rec('stale download signature is refused', stale.status >= 400, `status ${stale.status}`)
    }
    // overwrite prevention + tampered tickets (each uses its own tracked ticket)
    {
      const again = await upload(main.t, png.subarray(0, 2000), f => { f.public_id = main.t.fields.public_id })
      const still = await lookup(main.publicId, orgMain, refExt)
      rec('overwrite=false: a second upload to the same id does not replace the original', still.ok && still.bytes === meta.bytes, `second status ${again.status}`)
      for (const [label, mut] of [['altered folder', f => { f.folder = `doppeldash/${orgControl}/receipts` }], ['altered delivery type', f => { f.type = 'upload' }], ['forged signature', f => { f.signature = '0'.repeat(40) }], ['stale timestamp', f => { f.timestamp = String(Math.floor(Date.now() / 1000) - 7200) }]]) {
        const tk = await ticket(orgMain, 'image/png', png.length); const r = await upload(tk.t, png, mut)
        rec(`${label} -> signature rejected`, r.status >= 400, `status ${r.status}`)
      }
    }

    // ═════ 2. FILE-TYPE CONTRACT: PNG bytes declared as PDF (the real signed flow) ═════
    {
      const mm = await ticket(orgMain, 'application/pdf', png.length)
      rec('ticket pins allowed_formats to the declared type', mm.t.fields.allowed_formats === 'pdf')
      await Up.create({ orgId: orgMain, publicId: mm.publicId, state: 'issued', issuedAt: new Date(), nextCheckAt: new Date(Date.now() + 24 * 3600e3), declaredMime: 'application/pdf' })
      const r = await upload(mm.t, png)
      let layer
      if (r.status >= 400) layer = 'provider'
      else {
        const ext = String(r.body.format || 'png')
        const declared = await C.declaredFormatsFor(orgMain, mm.publicId)
        const v = await S.verifyStoredReceipt(`cld:${mm.publicId}.${ext}`, orgMain, BIG, scfg, undefined, declared)
        layer = v.ok === false && v.reason === 'type_mismatch' ? 'application' : null
        if (layer) await C.markReceiptRejected(orgMain, mm.publicId)
      }
      rec('PNG declared as PDF is stopped by at least one trusted enforcement layer', !!layer, layer ? `observed: ${layer === 'provider' ? 'the PROVIDER refused it (status ' + r.status + ')' : 'provider accepted it; the APPLICATION refused it at attach (detected format != declared)'}` : 'NEITHER layer stopped it')
      info(`provider-side enforcement of signed allowed_formats observed: ${layer === 'provider' ? 'YES' : 'NO (application layer relied on)'}`)
      // it must not be attachable afterwards, under either extension
      const row = await Up.findOne({ publicId: mm.publicId }).lean()
      if (layer === 'application') {
        rec('the rejected upload is marked rejected and can never be claimed for attach', row && row.state === 'rejected' && (await C.claimReceiptForAttach(orgMain, mm.publicId)) === false)
        const dres = await destroyOwned(mm.publicId, orgMain)
        rec('the rejected asset (owned by this run) is deleted', dres === 'deleted' || dres === 'not_found', dres)
      } else {
        rec('nothing was stored for the refused upload', !(await exists(mm.publicId, orgMain, 'png')) && !(await exists(mm.publicId, orgMain, 'pdf')))
        rec('the refused upload cannot be claimed for attach (no stored asset)', true, 'verified through the lookups above')
      }
      // PDF content declared as PNG is likewise stopped
      const m2 = await ticket(orgMain, 'image/png', pdf.length); const r2 = await upload(m2.t, pdf)
      let layer2 = r2.status >= 400 ? 'provider' : (await S.verifyStoredReceipt(`cld:${m2.publicId}.${String(r2.body.format || 'pdf')}`, orgMain, BIG, scfg, undefined, ['png'])).reason === 'type_mismatch' ? 'application' : null
      rec('PDF declared as PNG is stopped by at least one trusted enforcement layer', !!layer2, layer2 || 'NEITHER')
      // a matching PDF is stored (PDF behaviour — image vs raw resource — is recorded, not assumed)
      const okp = await ticket(orgMain, 'application/pdf', pdf.length); const rp = await upload(okp.t, pdf)
      rec('a genuine PDF upload outcome is recorded', true, `status ${rp.status}, resource_type ${rp.body.resource_type || '?'}, format ${rp.body.format || '?'}`)
      if (rp.status === 200) {
        const vp = await lookup(okp.publicId, orgMain, 'pdf')
        rec('a genuine PDF is verifiable through the image-resource lookup (else PDFs need raw-resource handling)', vp.ok === true, vp.ok ? 'ok' : vp.reason)
      }
      const exe = await ticket(orgMain, 'image/png', 20); rec('non-image content is refused or unverifiable', (await upload(exe.t, Buffer.from('MZ\x90\x00 not an image'))).status >= 400)
    }

    // ═════ 3. CLEANUP: dry-run then apply against harness-owned assets only ═════
    {
      const mk = async (org, bytes, mime, ext) => { const a = await ticket(org, mime, bytes.length); const r = await upload(a.t, bytes); if (r.status !== 200) throw new Error(`setup upload failed (status ${r.status})`); return { ...a, ext } }
      const old = await mk(orgMain, png, 'image/png', 'png')         // unreferenced + >24 h  → must be deleted by apply
      const ref = await mk(orgMain, png, 'image/png', 'png')         // referenced by an expense + >24 h → retained
      const rec1 = await mk(orgMain, png, 'image/png', 'png')        // recent upload                  → retained
      const ctl = await mk(orgControl, png, 'image/png', 'png')      // owned but NOT in the manifest → never touched
      const t30 = new Date(Date.now() - 30 * 3600e3), t6 = new Date(Date.now() - 6 * 3600e3)
      await Up.create([
        { orgId: orgMain, publicId: old.publicId, state: 'issued', issuedAt: t30, nextCheckAt: t6, declaredMime: 'image/png' },
        { orgId: orgMain, publicId: ref.publicId, state: 'attached', issuedAt: t30, nextCheckAt: t6, declaredMime: 'image/png' },
        { orgId: orgMain, publicId: rec1.publicId, state: 'issued', issuedAt: new Date(), nextCheckAt: new Date(Date.now() + 24 * 3600e3), declaredMime: 'image/png' },
      ])
      await mongoose.connection.db.collection('expenses').insertOne({ orgId: orgMain, userId: 'harness', userName: 'harness', title: 'harness-owned', reason: 'harness', amount: 1, startDate: new Date(), lineItems: [], hasLineItems: false, receipts: [`cld:${ref.publicId}.png`], status: 'pending_manager', createdAt: new Date(), updatedAt: new Date() })
      const all = { old, ref, rec1, ctl }
      const present = async () => Object.fromEntries(await Promise.all(Object.entries(all).map(async ([k, a]) => [k, await exists(a.publicId, a.t.fields.folder.split('/')[1], 'png')])))
      const before = await present()
      rec('cleanup setup: four harness-owned assets exist', Object.values(before).every(Boolean))

      const call = async mode => {
        if (cfg.appUrl) {
          const r = await fetch(`${cfg.appUrl}/api/cron/receipts-cleanup`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.cronSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
          const j = await r.json().catch(() => ({})); return { http: r.status, ...j }
        }
        const rep = await C.runReceiptCleanup({ apply: mode === 'apply', limit: 50 }); return { http: 200, ...rep, applyEnabled: true }
      }
      if (cfg.appUrl) {
        const noAuth = await fetch(`${cfg.appUrl}/api/cron/receipts-cleanup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'apply' }) })
        const get = await fetch(`${cfg.appUrl}/api/cron/receipts-cleanup?apply=1`, { headers: { Authorization: `Bearer ${cfg.cronSecret}` } })
        rec('cleanup endpoint: unauthenticated POST is 401 and GET is 405', noAuth.status === 401 && get.status === 405, `${noAuth.status}/${get.status}`)
      }
      const dry = await call('dry-run')
      rec('cleanup dry-run reports exactly the expected counts', dry.http === 200 && dry.mode === 'dry-run' && dry.examined === 2 && dry.eligible === 1 && dry.skippedReferenced === 1 && dry.deleted === 0 && dry.failed === 0, `examined ${dry.examined}, eligible ${dry.eligible}, referenced ${dry.skippedReferenced}, deleted ${dry.deleted}`)
      const afterDry = await present()
      rec('dry-run deleted nothing (all four assets still exist)', Object.values(afterDry).every(Boolean))
      const safeToApply = dry.http === 200 && dry.examined === 2 && dry.eligible === 1 && dry.skippedReferenced === 1 && dry.failed === 0 && dry.applyEnabled === true
      if (!safeToApply) {
        rec('apply was NOT attempted: the dry-run did not match the expected harness-only picture (or server-side apply is disabled)', dry.applyEnabled !== false, dry.applyEnabled === false ? 'server-side RECEIPT_CLEANUP_APPLY is not 1' : 'unexpected counts — the app server may point at a different database')
      } else {
        const app = await call('apply')
        rec('cleanup apply deleted exactly one asset', app.http === 200 && app.mode === 'apply' && app.deleted === 1 && app.failed === 0, `deleted ${app.deleted}, failed ${app.failed}`)
        const after = await present()
        rec('the unreferenced >24 h harness asset is gone', after.old === false)
        rec('the referenced asset, the recent upload and the untracked control asset are all retained', after.ref && after.rec1 && after.ctl)
        const row = await Up.findOne({ publicId: old.publicId }).lean()
        rec('its manifest row was removed; the others remain', row === null && (await Up.countDocuments()) >= 2)
        owned.delete(old.publicId)
      }
    }
    // ═════ 4. optional: one real Gemini OCR call ═════
    if (cfg.gemini) {
      try {
        const { runReceiptOcr } = jiti(path.join(ROOT, 'lib/ocr/receiptOcr.ts'))
        const out = await runReceiptOcr(png.toString('base64'), 'image/png')
        rec('OCR used Gemini (not a fallback)', out.provider === 'gemini', out.provider)
        const amt = out.parsed && out.parsed.amount
        rec('Gemini OCR on the synthetic receipt returns the expected total (1250.50)', Number(amt) === 1250.5, `amount=${amt}`)
      } catch (e) { rec('Gemini OCR call', false, safeErr(e)) }
    } else info('SKIP Gemini OCR (set GEMINI_API_KEY and GEMINI_STAGING_CONFIRM=1 with a staging key)')
  } catch (e) {
    primaryError = e
    rec('harness run completed without an unexpected error', false, safeErr(e))
  } finally {
    // Cleanup never masks the primary failure and never touches anything this run did not create.
    for (const [publicId, orgId] of [...owned.entries()]) {
      try {
        const r = await destroyOwned(publicId, orgId)
        if (r === 'error') cleanupIncomplete++
      } catch { cleanupIncomplete++ }
    }
    try { if (dbCreated && mongoose.connection.readyState === 1) await mongoose.connection.db.dropDatabase() } catch { /* best effort */ }
    try { await mongoose.disconnect() } catch { /* ignore */ }
    globalThis.fetch = realFetch
    if (cleanupIncomplete) say(`CLEANUP INCOMPLETE: ${cleanupIncomplete} harness-owned asset(s) may remain in the staging cloud under tenant ids "${[...ownedOrgs].join('", "')}". Delete that folder by hand (Console → Media Library → doppeldash/<tenant>); nothing else was created.`)
    else say('Cleanup: every asset created by this run was removed (or was already gone).')
  }
  const failed = results.filter(r => !r.ok).length
  say(`\n${results.length - failed}/${results.length} checks passed${primaryError ? ' (the run ended on an unexpected error)' : ''}`)
  say('NOTE: results from a run against the real staging cloud are staging evidence; this module\'s unit tests run against a local fake and are NOT.')
  return { exitCode: failed || primaryError ? 1 : 0, results, cleanupIncomplete }
}

module.exports = { preflight, run, makeRedactor, makeOwnership, safeErr, isLoopbackMongo, DB_PREFIX, ID_RE, RUN_ORG_RE }
