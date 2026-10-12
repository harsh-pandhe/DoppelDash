/**
 * DoppelDash — Auth Foundation test kit.
 *
 * Shared helpers for the auth/mail regression suites:
 *   - hard guard that the database is a LOCAL throwaway DB (never Atlas/prod)
 *   - a real SMTP capture server (so we assert on the actual email that left the app)
 *   - a tiny HTTP client for the running dev server
 *   - disposable tenant fixtures (org + admin/manager/employee) with safe teardown
 *
 * Everything created here lives in `org_authf_*` tenants and is removed through
 * the existing testSafety harness, which refuses to touch org_doppelmayr.
 */
const process = require('node:process')
const net = require('node:net')
const path = require('node:path')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const { simpleParser } = require('mailparser')
const { safeTeardownTestOrg, assertSafeTeardown } = require('./testSafety')

const DEFAULT_JWT = 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ=='
process.env.JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dd_authphase1_test'

const BASE_URL = process.env.TEST_URL || 'http://localhost:3100'

const jiti = require(path.resolve(__dirname, '../../node_modules/jiti'))(__filename, {
  alias: { '@': path.resolve(__dirname, '../..') },
})
const load = rel => jiti(path.resolve(__dirname, '../..', rel))

/** Refuse to run against anything that is not a local throwaway database. */
function assertLocalThrowawayDb() {
  const uri = process.env.MONGODB_URI
  const isLocal = /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)
  const dbName = (uri.split('/').pop() || '').split('?')[0]
  if (!isLocal || !/test/i.test(dbName)) {
    throw new Error(`[SAFETY] Refusing to run auth tests against "${uri.replace(/\/\/.*@/, '//***@')}" — local DB with "test" in its name required.`)
  }
}

let connected = false
async function connect() {
  assertLocalThrowawayDb()
  if (!connected) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    connected = true
  }
  return mongoose.connection.db
}
async function disconnect() {
  if (connected) { await mongoose.disconnect(); connected = false }
}

/* ───────────────────────── fake SMTP capture ───────────────────────── */
async function startFakeSmtp(port = 2525) {
  const messages = []
  const authAttempts = []
  const state = { rejectAuth: false, rejectData: false }

  const server = net.createServer(socket => {
    let buffer = ''
    let inData = false
    let dataChunks = []
    let authStage = null
    let authUser = ''
    socket.write('220 fake.smtp ESMTP ready\r\n')
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      let idx
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (inData) {
          if (line === '.') {
            inData = false
            const raw = dataChunks.join('\r\n')
            dataChunks = []
            if (state.rejectData) { socket.write('554 5.7.1 Message rejected by policy\r\n'); continue }
            simpleParser(raw).then(parsed => {
              messages.push({
                to: (parsed.to?.value || []).map(v => v.address),
                from: parsed.from?.text,
                subject: parsed.subject,
                html: parsed.html || '',
                text: parsed.text || '',
                raw,
                receivedAt: Date.now(),
              })
            }).catch(() => {})
            socket.write('250 2.0.0 queued\r\n')
          } else {
            dataChunks.push(line.startsWith('..') ? line.slice(1) : line)
          }
          continue
        }
        if (authStage === 'user') {
          authUser = Buffer.from(line, 'base64').toString('utf8')
          authStage = 'pass'
          socket.write('334 UGFzc3dvcmQ6\r\n')
          continue
        }
        if (authStage === 'pass') {
          authAttempts.push({ user: authUser, pass: Buffer.from(line, 'base64').toString('utf8') })
          authStage = null
          if (state.rejectAuth) socket.write('535 5.7.8 Username and Password not accepted\r\n')
          else socket.write('235 2.7.0 Authentication successful\r\n')
          continue
        }
        const cmd = line.toUpperCase()
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) {
          socket.write('250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n')
        } else if (cmd.startsWith('AUTH PLAIN')) {
          const parts = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8').split('\u0000')
          authAttempts.push({ user: parts[1], pass: parts[2] })
          if (state.rejectAuth) socket.write('535 5.7.8 Username and Password not accepted\r\n')
          else socket.write('235 2.7.0 Authentication successful\r\n')
        } else if (cmd.startsWith('AUTH LOGIN')) {
          authStage = 'user'
          socket.write('334 VXNlcm5hbWU6\r\n')
        } else if (cmd.startsWith('MAIL FROM') || cmd.startsWith('RCPT TO')) {
          socket.write('250 2.1.0 ok\r\n')
        } else if (cmd === 'DATA') {
          inData = true
          socket.write('354 end with <CRLF>.<CRLF>\r\n')
        } else if (cmd === 'QUIT') {
          socket.write('221 bye\r\n')
          socket.end()
        } else if (cmd === 'RSET' || cmd === 'NOOP') {
          socket.write('250 ok\r\n')
        } else {
          socket.write('250 ok\r\n')
        }
      }
    })
    socket.on('error', () => {})
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })

  return {
    port,
    messages,
    authAttempts,
    state,
    /** Resolve with the first captured message matching `pred`, or throw after `timeoutMs`. */
    async waitFor(pred, timeoutMs = 8000) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const found = messages.find(pred)
        if (found) return found
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error(`No captured email matched within ${timeoutMs}ms (captured ${messages.length})`)
    },
    clear() { messages.length = 0; authAttempts.length = 0 },
    stop: () => new Promise(resolve => server.close(resolve)),
  }
}

/* ───────────────────────── HTTP client ───────────────────────── */
let ipCounter = 0
/** A distinct, valid-looking client IP per call so IP rate limits do not mask per-account logic. */
function freshIp() {
  ipCounter += 1
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

async function api(pathname, { method = 'GET', token, cookie, body, headers = {}, ip, redirect = 'manual', raw } = {}) {
  const h = { ...headers }
  if (body !== undefined && raw === undefined) h['Content-Type'] = 'application/json'
  if (token) h.Authorization = `Bearer ${token}`
  if (cookie) h.Cookie = cookie
  h['x-forwarded-for'] = ip || freshIp()
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: h,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    redirect,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers }
}

/* ───────────────────────── fixtures ───────────────────────── */
const rand = () => crypto.randomBytes(4).toString('hex')
const createdOrgs = new Set()
const PASSWORD = 'Str0ng!Passw0rd#'

async function createOrg({ name, plan = 'free', webEnabled = false, lifetimeGrant = false } = {}) {
  const User = load('models/User.ts').default
  const Organization = load('models/Organization.ts').default
  const Employee = load('models/Employee.ts').default
  const orgId = `org_authf_${rand()}`
  assertSafeTeardown(orgId)
  createdOrgs.add(orgId)

  await Organization.create({
    orgId, name: name || `Auth Test Org ${orgId}`, slug: orgId.replace(/_/g, '-'),
    plan, entitlementSource: lifetimeGrant ? 'lifetime_grant' : plan === 'premium' ? 'subscription' : 'none',
    lifetimeGrant, webEnabled, androidEnabled: true,
    subscriptionStatus: plan === 'premium' && !lifetimeGrant ? 'active' : 'none',
    currentPeriodEnd: plan === 'premium' && !lifetimeGrant ? new Date(Date.now() + 30 * 864e5) : undefined,
  })
  const hash = await User.hashPassword(PASSWORD)
  const mk = async (role, first) => {
    const email = `authf_${role}_${rand()}@test.dd`
    const user = await User.create({
      orgId, email, passwordHash: hash, role, firstName: first, lastName: 'Tester',
      mustChangePassword: false, isActive: true, sessionVersion: 1,
    })
    await Employee.create({
      clerkUserId: user._id.toString(), orgId, createdByUserId: user._id.toString(),
      firstName: first, lastName: 'Tester', email, department: 'QA', designation: role,
      employeeType: 'full_time', joiningDate: new Date(), onboardingComplete: true, onboardingStep: 5,
    })
    return { id: user._id.toString(), email, password: PASSWORD, role, firstName: first }
  }
  const admin = await mk('admin', 'Ada')
  const manager = await mk('manager', 'Max')
  const employee = await mk('employee', 'Eve')
  return { orgId, admin, manager, employee }
}

/** Full real login: password → pre-auth → OTP. Returns tokens + the pre-auth token. */
async function login(email, password = PASSWORD, { otp = '112022' } = {}) {
  const step1 = await api('/api/auth/login', { method: 'POST', body: { email, password } })
  if (step1.status !== 200) throw new Error(`login step1 failed ${step1.status}: ${step1.text}`)
  const step2 = await api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: step1.json.preAuthToken, otp } })
  if (step2.status !== 200) throw new Error(`login step2 failed ${step2.status}: ${step2.text}`)
  return {
    preAuthToken: step1.json.preAuthToken,
    accessToken: step2.json.accessToken,
    refreshToken: step2.json.refreshToken,
    cookie: (step2.headers.get('set-cookie') || '').split(';')[0],
    user: step2.json.user,
  }
}

/** Register an org created outside createOrg() (e.g. via public signup) for guaranteed teardown. */
function trackOrg(orgId) { assertSafeTeardown(orgId); createdOrgs.add(orgId) }

async function cleanupAll(db) {
  for (const orgId of createdOrgs) {
    await safeTeardownTestOrg(db, orgId)
    await db.collection('orgmailconfigs').deleteMany({ orgId }).catch(() => {})
  }
  createdOrgs.clear()
}

module.exports = {
  BASE_URL, PASSWORD, load, connect, disconnect, startFakeSmtp, api, freshIp,
  createOrg, login, cleanupAll, trackOrg, assertLocalThrowawayDb, rand,
}
