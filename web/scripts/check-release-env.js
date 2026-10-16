/**
 * DoppelDash — release environment check: verifies by NAME (and coarse shape) that the environment of the machine running this script is fit for
 * `production` or `staging`. It NEVER prints a value — only variable names and pass/fail reasons — so its output is safe to paste into a ticket.
 *   node web/scripts/check-release-env.js --context=production|staging [--json]
 * Run it where the variables are set (e.g. `netlify env:list`-style export into the shell, or a CI step with the secrets mapped). Exit 0 = all required checks pass.
 */
const args = process.argv.slice(2)
const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const ctx = flag('context')
if (!['production', 'staging'].includes(ctx)) { console.error('Usage: --context=production|staging'); process.exit(2) }
const env = process.env
const has = n => typeof env[n] === 'string' && env[n].trim() !== ''
const results = []
const add = (name, ok, reason, level = 'required') => results.push({ name, ok, level, reason })
const need = (n, why) => add(n, has(n), has(n) ? 'present' : `missing — ${why}`)
const secret = (n, min, why) => add(n, has(n) && env[n].length >= min, !has(n) ? `missing — ${why}` : env[n].length >= min ? `present (≥${min} chars)` : `too short (needs ≥${min} chars)`)
const forbid = (n, why, bad = v => v.trim() !== '') => add(n, !has(n) || !bad(env[n]), !has(n) || !bad(env[n]) ? 'unset (good)' : `SET — ${why}`)

secret('JWT_SECRET', 32, 'signs sessions and OTP/pre-auth tokens'); secret('ENCRYPTION_SECRET', 32, 'encrypts stored mailbox passwords / bank details'); secret('CRON_SECRET', 24, 'authenticates scheduled jobs (fails closed when unset)')
need('MONGODB_URI', 'database'); { const okU = has('MONGODB_URI') && /^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI) && !/\/\/(127\.0\.0\.1|localhost)/.test(env.MONGODB_URI); add('MONGODB_URI shape', okU, okU ? 'remote mongodb(+srv) URI' : 'must be a remote mongodb(+srv) URI, not loopback') }
if (has('MONGODB_URI') && /^mongodb(\+srv)?:\/\/[^/]*\/[^?]*test/i.test(env.MONGODB_URI) && ctx === 'production') add('MONGODB_URI database name', false, 'a PRODUCTION context must not point at a database whose name contains "test"')
add('NEXT_PUBLIC_APP_URL', has('NEXT_PUBLIC_APP_URL') && /^https:\/\/[^/]+$/.test(env.NEXT_PUBLIC_APP_URL), has('NEXT_PUBLIC_APP_URL') ? (/^https:\/\/[^/]+$/.test(env.NEXT_PUBLIC_APP_URL) ? 'present (https, no path)' : 'must be https://<canonical host> with no path/trailing slash') : 'missing — canonical origin used in e-mail links')
add('DD_DEPLOY_CONTEXT', env.DD_DEPLOY_CONTEXT === ctx, env.DD_DEPLOY_CONTEXT === ctx ? `= ${ctx}` : `must be exactly "${ctx}" (hosted deploys refuse database access otherwise)`)
for (const n of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) need(n, 'transactional mail (OTP, reset, invitations)')
for (const n of ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) need(n, 'private signed uploads')
add('CLOUDINARY cloud name', has('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME') || has('CLOUDINARY_CLOUD_NAME'), has('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME') || has('CLOUDINARY_CLOUD_NAME') ? 'present' : 'missing — NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME')
need('TRUSTED_CLIENT_IP_HEADER', 'the platform header that carries the real client IP (rate limiting / support chat); without it a shared conservative bucket applies')
// must be unset / safe
forbid('ALLOW_DEV_SEED', 'the dev seed route can wipe the database', v => v.trim().toLowerCase() === 'true'); forbid('DEV_SEED_SECRET', 'not needed in a released environment (route is production-gated)')
forbid('ALLOW_UNSIGNED_UPLOADS', 'unsigned uploads bypass private storage', v => v.trim().toLowerCase() === 'true'); forbid('CLOUDINARY_UPLOAD_BASE', 'test-only provider redirect'); forbid('CLOUDINARY_DELIVERY_BASE', 'test-only provider redirect')
forbid('NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'legacy unsigned preset must be retired'); forbid('CLOUDINARY_UPLOAD_PRESET', 'legacy unsigned preset must be retired')
forbid('ALLOW_PRIVATE_SMTP_HOSTS', 'SSRF guard override (developer machines only)'); forbid('SMTP_HOST_POLICY', 'must not be relaxed', v => v.trim().toLowerCase() !== 'enforce')
forbid('GEMINI_API_BASE', 'test-only provider redirect'); forbid('OLLAMA_URL', 'a self-hosted model endpoint must be a conscious decision')
forbid('RECEIPT_CLEANUP_APPLY', 'cleanup deletion stays disabled until Cloudinary staging verification is signed off', v => v.trim() === '1' && ctx === 'production')
// optional features: if one half is set the other must be
const optional = (name, keys) => { const set = keys.filter(has); add(name, set.length === 0 || set.length === keys.length, set.length === 0 ? 'not configured (feature off)' : set.length === keys.length ? 'configured' : `PARTIAL — also needs ${keys.filter(k => !has(k)).join(', ')}`, set.length > 0 && set.length < keys.length ? 'required' : 'optional') }   // a half-configured feature is a FAIL; an unconfigured one is fine
optional('Google Play billing', ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_PREMIUM_PRODUCT_ID', 'GOOGLE_PLAY_RTDN_AUDIENCE', 'GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL'])
optional('Shared IMAP mailbox', ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASS', 'IMAP_OWNER_ORG_ID']); optional('Outlook', ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_WEBHOOK_SECRET'])
optional('Gemini OCR', ['GEMINI_API_KEY'])
add('NODE_ENV', env.NODE_ENV === undefined || env.NODE_ENV === 'production', env.NODE_ENV === undefined || env.NODE_ENV === 'production' ? 'ok' : 'must be unset or "production" on a deployed host', 'optional')

const failed = results.filter(r => !r.ok && r.level === 'required'), warn = results.filter(r => !r.ok && r.level !== 'required')
if (args.includes('--json')) console.log(JSON.stringify({ context: ctx, ok: failed.length === 0, failedRequired: failed.length, results }, null, 2))
else {
  console.log(`Release environment check (${ctx}) — names and reasons only, no values\n`)
  for (const r of results) console.log(`${r.ok ? 'PASS' : r.level === 'required' ? 'FAIL' : 'WARN'}  ${r.name.padEnd(40)} ${r.reason}`)
  console.log(`\n${failed.length === 0 ? 'ALL REQUIRED CHECKS PASS' : `${failed.length} REQUIRED CHECK(S) FAILED`}${warn.length ? `, ${warn.length} warning(s)` : ''}`)
}
process.exit(failed.length ? 1 : 0)
