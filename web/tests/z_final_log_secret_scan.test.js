/**
 * DoppelDash — complete auth/mail SECRET scan of the dev-server log.
 *
 * Run it LAST (the `z_` prefix sorts after every other suite) against the log the whole inventory wrote:
 *   DD_SERVER_LOG=/path/to/dev-server.log node --test tests/z_final_log_secret_scan.test.js
 *
 * It looks for, in the log produced by every other suite in this repository:
 *   JWTs · refresh / access / session tokens · reset tokens · invitation tokens · OTP codes ·
 *   passwords (every password literal used by any test or the seed) · bcrypt hashes ·
 *   SMTP credentials and server secrets (read from .env.local if present) ·
 *   Play purchase tokens · Authorization: Bearer values · generic 256-bit hex secrets.
 *
 * No exclusion rules except the two token-shaped DECOYS that suites send on purpose to prove the
 * legacy URL contracts are gone (they are not secrets).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const kit = require('./helpers/authTestKit')

const LOG = process.env.DD_SERVER_LOG
const skip = !LOG && 'set DD_SERVER_LOG to scan a dev-server log'
const DECOYS = ['dec0' + 'ab'.repeat(30), 'dec0' + 'cd'.repeat(30)]   // see password_reset / invitation hygiene suites

let db
test.before(async () => { if (!skip) db = await kit.connect() })
test.after(async () => { if (!skip) await kit.disconnect() })

function read() {
  assert.ok(fs.existsSync(LOG), 'server log exists')
  const text = fs.readFileSync(LOG, 'utf8')
  assert.ok(text.length > 5000, 'the log is substantial (the whole inventory ran against it)')
  return text.split('\n').filter(l => !DECOYS.some(d => l.includes(d))).join('\n')
}

/** Every password / purchase-token literal used by any test or the seed. */
function harvestLiterals() {
  const dir = __dirname
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f))
  files.push(path.resolve(dir, '../app/api/dev/seed/route.ts'))
  const passwords = new Set(); const purchase = new Set()
  const pw = /(?:[Pp]assword[A-Za-z]*|PASSWORD|[A-Z_]*_PW|NEW_PASSWORD|DEFAULT_PASSWORD)\s*[:=]\s*(['"`])([^'"`$\n]{8,64})\1/g
  const pt = /purchaseToken\s*:\s*(['"])([^'"$\n]{8,})\1/g
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(pw)) passwords.add(m[2])
    for (const m of src.matchAll(pt)) purchase.add(m[2])
  }
  passwords.add(kit.PASSWORD)
  return { passwords: [...passwords], purchase: [...purchase] }
}

function serverSecrets() {
  const envFile = path.resolve(__dirname, '../.env.local')
  const out = []
  if (!fs.existsSync(envFile)) return out
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^(SMTP_PASS|JWT_SECRET|ENCRYPTION_SECRET|DEV_SEED_SECRET|CRON_SECRET|IMAP_PASS)=(.*)$/.exec(line.trim())
    if (m && m[2].replace(/^["']|["']$/g, '').length >= 8) out.push({ name: m[1], value: m[2].replace(/^["']|["']$/g, '') })
  }
  return out
}

test('Z1. no JWT, bearer value, bcrypt hash or generic 256-bit secret anywhere in the log', { skip }, () => {
  const log = read()
  assert.doesNotMatch(log, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, 'JWT in the log')
  assert.doesNotMatch(log, /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i, 'Authorization bearer value in the log')
  assert.doesNotMatch(log, /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/, 'bcrypt hash in the log')
  const hex = log.split('\n').filter(l => /[0-9a-f]{64}/.test(l)).map(l => l.replace(/[0-9a-f]{64}/g, '<64hex>').slice(0, 120))
  assert.deepEqual(hex.slice(0, 3), [], 'a 256-bit hex value (reset / invitation / refresh token shape) appears in the log')
})

test('Z2. no password literal used by any test or the seed appears in the log', { skip }, () => {
  const log = read()
  const { passwords } = harvestLiterals()
  assert.ok(passwords.length >= 15, `harvested ${passwords.length} password literals`)
  for (const p of passwords) assert.ok(!log.includes(p), `a password literal (${p.length} chars) appears in the log`)
})

test('Z3. no OTP code, reset token or invitation token appears in the log', { skip }, async () => {
  const log = read()
  assert.ok(!/\b112022\b/.test(log), 'the static dev OTP appears in the log')
  assert.ok(!/OTP for /i.test(log) && !/🔐/.test(log), 'OTP console logging is off')
  // every live reset / invitation token still in the database (unused ones are the only real secrets)
  const reset = await db.collection('passwordresettokens').find({}).toArray()
  const invites = await db.collection('invitations').find({}).toArray()
  // Raw tokens are never stored; the hashes must not be in the log either (they would identify a token)
  for (const d of [...reset, ...invites]) if (d.tokenHash) assert.ok(!log.includes(d.tokenHash), 'a stored token hash appears in the log')
  assert.doesNotMatch(log, /password-reset\/(confirm|check)\?[^\s]*token=/i)
  assert.doesNotMatch(log, /reset-password\?[^\s]*token=/i)
  assert.doesNotMatch(log, /\/invite\?[^\s]*token=/i)
  assert.doesNotMatch(log, /\/api\/auth\/invitations\/[0-9A-Za-z_-]{20,}/, 'invitation token in a request path')
})

test('Z4. SMTP credentials and server secrets from the environment never appear in the log', { skip }, () => {
  const log = read()
  const secrets = serverSecrets()
  assert.ok(secrets.length >= 3, `read ${secrets.length} server secrets from .env.local`)
  const leaked = secrets.filter(({ value }) => log.includes(value)).map(({ name }) => name)
  assert.deepEqual(leaked, [], 'these server secrets appear in the log (a URL query? a console.log?)')
  assert.doesNotMatch(log, /passwordHash|passwordEnc|appPassword|SMTP_PASS/)
})

test('Z5. no Play purchase token used by the billing suites appears in the log', { skip }, () => {
  const log = read()
  const { purchase } = harvestLiterals()
  assert.ok(purchase.length >= 3, `harvested ${purchase.length} purchase-token literals`)
  for (const t of purchase) assert.ok(!log.includes(t), 'a Play purchase token appears in the log')
})

test('Z6. tokens issued right now (access, refresh, session cookie, pre-auth) do not reach the log', { skip }, async () => {
  const org = await kit.createOrg({ webEnabled: true })
  const s1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.admin.email, password: kit.PASSWORD } })
  const s2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: s1.json.preAuthToken, otp: '112022' } })
  const refreshed = await kit.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: s2.json.refreshToken } })
  await kit.api('/api/auth/me', { token: s2.json.accessToken })
  await kit.api('/api/auth/me', { cookie: (s2.headers.get('set-cookie') || '').split(';')[0] })
  await new Promise(r => setTimeout(r, 500))
  const log = read()
  const cookie = (s2.headers.get('set-cookie') || '').split(';')[0].split('=')[1]
  const values = [s1.json.preAuthToken, s2.json.accessToken, s2.json.refreshToken, cookie, refreshed.json?.accessToken, refreshed.json?.refreshToken].filter(Boolean)
  assert.ok(values.length >= 5)
  for (const v of values) assert.ok(!log.includes(v), 'an issued token value appears in the log')
  await kit.cleanupAll(db)
})
