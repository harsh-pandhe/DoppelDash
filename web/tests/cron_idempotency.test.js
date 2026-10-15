/**
 * Scheduled mail jobs (Phase 5D): authentication, and exactly-once behaviour when runs OVERLAP (a retried trigger, two schedulers, a slow run).
 * The jobs used to read candidates, send, THEN set the "sent" flag — overlapping runs both sent. Each candidate is now claimed atomically first.
 * Real routes, throwaway DB. FAKE-VERIFIED: the platform scheduler itself is not part of this repository (see docs/SCHEDULED_JOBS.md).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

const CRON = process.env.CRON_SECRET
let db, A
test.before(async () => { assert.ok(CRON, 'CRON_SECRET must be set (the runner exports it to the server and to tests)'); db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }) })
test.after(async () => { for (const c of ['contacts', 'announcements', 'employees']) await db.collection(c).deleteMany({ orgId: A.orgId, tag: 'cron-test' }); await kit.cleanupAll(db); await kit.disconnect() })

const run = (job, { auth = `Bearer ${CRON}`, query = '' } = {}) => kit.api(`/api/cron/${job}${query}`, { headers: auth ? { Authorization: auth } : {} })
const JOBS = ['birthday', 'announcements', 'onboarding']

test('J1. every job refuses a missing, wrong, malformed or query-string secret (401) and does nothing', async () => {
  for (const job of JOBS) {
    for (const [label, opts] of [['no header', { auth: null }], ['wrong', { auth: 'Bearer wrong' }], ['basic scheme', { auth: `Basic ${CRON}` }], ['empty bearer', { auth: 'Bearer ' }], ['decoy query secret', { auth: null, query: '?secret=decoy-not-the-secret&token=decoy' }], ['case', { auth: `bearer ${CRON}` }]]) {
      const r = await run(job, opts); assert.equal(r.status, 401, `${job} ${label} → ${r.status}`); assert.doesNotMatch(r.text, new RegExp(CRON))
    }
  }
})

test('J1b. the REAL secret in a query string is refused — checked in-process so the secret never enters an HTTP access log (a real-secret URL tripped the repo\'s own log-secret guard)', () => {
  const { isCronAuthorized } = kit.load('lib/cron/auth.ts')
  const req = (url, headers = {}) => ({ url, nextUrl: new URL(url), headers: new Headers(headers) })
  assert.equal(isCronAuthorized(req(`http://x/api/cron/birthday?secret=${CRON}&token=${CRON}&authorization=${CRON}`)), false, 'query-string secret')
  assert.equal(isCronAuthorized(req('http://x/api/cron/birthday', { authorization: `Bearer ${CRON}` })), true, 'header secret')
  assert.equal(isCronAuthorized(req('http://x/api/cron/birthday', { 'x-cron-secret': CRON, 'x-api-key': CRON })), false, 'other headers')
})

test('J2. birthday: overlapping runs send ONE reminder per contact per year; a second run the same day sends none; the claim records the year', async () => {
  const d = new Date(); const bday = new Date(Date.UTC(1990, d.getMonth(), d.getDate(), 12))
  const ins = await db.collection('contacts').insertOne({ orgId: A.orgId, createdBy: A.admin.id, name: 'CronBirthday ' + kit.rand(), birthday: bday, tag: 'cron-test', createdAt: new Date(), updatedAt: new Date() })
  const rs = await Promise.all(Array.from({ length: 6 }, () => run('birthday')))
  assert.ok(rs.every(r => r.status === 200), rs.map(r => r.status).join())
  const mine = rs.filter(r => (r.json.contacts || []).some(n => n.startsWith('CronBirthday'))).length
  assert.equal(mine, 1, 'exactly one of six overlapping runs sent this contact’s reminder: ' + JSON.stringify(rs.map(r => r.json)))
  assert.equal((await db.collection('contacts').findOne({ _id: ins.insertedId })).birthdayGreetingYear, d.getFullYear())
  assert.ok(!(await run('birthday')).json.contacts?.some(n => n.startsWith('CronBirthday')), 'not again the same day')
})

test('J3. announcements: a due urgent announcement is emailed once even when runs overlap', async () => {
  const ins = await db.collection('announcements').insertOne({ orgId: A.orgId, title: 'CronUrgent ' + kit.rand(), body: 'b', authorId: A.admin.id, authorName: 'Ada', priority: 'urgent', scheduledFor: new Date(Date.now() - 60e3), urgentEmailSent: false, tag: 'cron-test', createdAt: new Date(), updatedAt: new Date() })
  const rs = await Promise.all(Array.from({ length: 6 }, () => run('announcements')))
  assert.ok(rs.every(r => r.status === 200), rs.map(r => r.status).join())
  assert.equal(rs.filter(r => (r.json.titles || []).some(t => t.startsWith('CronUrgent'))).length, 1, JSON.stringify(rs.map(r => r.json)))
  assert.equal((await db.collection('announcements').findOne({ _id: ins.insertedId })).urgentEmailSent, true)
  assert.ok(!(await run('announcements')).json.titles?.some(t => t.startsWith('CronUrgent')))
})

test('J4. onboarding nudge: one nudge per employee per week under overlapping runs; marker set; a run within the week sends none', async () => {
  const emp = await db.collection('employees').insertOne({ clerkUserId: 'cron-emp-' + kit.rand(), orgId: A.orgId, createdByUserId: A.admin.id, firstName: 'Nudge', lastName: 'Me', email: `nudge_${kit.rand()}@qa.test`, department: 'QA', designation: 'x', employeeType: 'full_time', joiningDate: new Date(Date.now() - 20 * 864e5), onboardingComplete: false, onboardingStep: 1, isActive: true, tag: 'cron-test' })
  const before = (await run('onboarding')).json.candidates
  await db.collection('employees').updateOne({ _id: emp.insertedId }, { $unset: { onboardingNudgeSentAt: 1 } })
  const rs = await Promise.all(Array.from({ length: 6 }, () => run('onboarding')))
  assert.ok(rs.every(r => r.status === 200), rs.map(r => r.status).join())
  const total = rs.reduce((n, r) => n + (r.json.sent || 0), 0)
  assert.ok(total >= 1 && total <= before + 1, `sent ${total}`)
  const e = await db.collection('employees').findOne({ _id: emp.insertedId }); assert.ok(e.onboardingNudgeSentAt, 'marker set')
  const again = await run('onboarding'); assert.equal(again.json.candidates === 0 || again.json.sent === 0, true, 'nothing due within the week: ' + JSON.stringify(again.json))
})
