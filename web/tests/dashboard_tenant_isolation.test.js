/**
 * DoppelDash — DASHBOARD tenant isolation (the real server-rendered path).
 *
 * The dashboards are server components that query MongoDB directly. This suite
 * seeds two web-enabled organisations with DISTINCT, recognisable data, signs in
 * as admin / manager / employee of each through the real login flow, requests the
 * actual `/dashboard` page and asserts on what the user is served:
 *
 *   - every role sees its own organisation's data (so the test cannot pass vacuously)
 *   - no record, name, amount, department or audit entry of the OTHER organisation
 *     appears anywhere in the response
 *   - aggregates (admin totals) are computed per organisation, never across both
 *
 * Mutation-checked: removing any `orgId` filter from the dashboard queries makes it fail.
 * Requires the dev server on TEST_URL + the same throwaway DB (kit refuses non-local).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db
const orgs = {}

test.before(async () => { db = await kit.connect() })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const DAY = 864e5
const text = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')

async function seedOrg(tag, n) {
  // n scales the numbers so every aggregate differs between organisations
  const org = await kit.createOrg({ webEnabled: true, plan: 'premium', lifetimeGrant: true })
  const User = kit.load('models/User.ts').default
  const Employee = kit.load('models/Employee.ts').default
  const { orgId } = org
  const now = new Date()
  const hash = await User.hashPassword(kit.PASSWORD)

  // an extra team member with a recognisable name + department
  const person = await User.create({ orgId, email: `zq_${tag}_${kit.rand()}@test.dd`, passwordHash: hash, role: 'employee', firstName: `Person${tag}`, lastName: `Zq${tag}Surname`, isActive: true, sessionVersion: 1 })
  await Employee.create({ clerkUserId: String(person._id), orgId, createdByUserId: String(person._id), firstName: `Person${tag}`, lastName: `Zq${tag}Surname`, email: person.email, department: `ZqDept${tag}`, designation: 'Tester', employeeType: 'full_time', joiningDate: now, onboardingComplete: true, onboardingStep: 5 })

  const base = { orgId, createdAt: now, updatedAt: now }
  const ins = (c, docs) => db.collection(c).insertMany(docs.map(d => ({ ...base, ...d })))
  const uid = String(person._id)
  await ins('leaves', [
    { userId: uid, userName: `ZqPendingLeave${tag}`, type: 'casual', startDate: new Date(now.getTime() + 3 * DAY), endDate: new Date(now.getTime() + 4 * DAY), days: n, reason: `zqreason${tag}`, status: 'pending', isLWP: false, isHalfDay: false },
    { userId: uid, userName: `ZqAwayToday${tag}`, type: 'sick', startDate: new Date(now.getTime() - DAY), endDate: new Date(now.getTime() + DAY), days: 3, reason: 'x', status: 'approved', isLWP: false, isHalfDay: false },
  ])
  await ins('expenses', [
    { userId: uid, userName: `ZqExpMgr${tag}`, title: `ZqExpenseMgr${tag}`, amount: 1000 * n + 1, status: 'pending_manager', reason: 'r', category: 'travel', date: now },
    { userId: uid, userName: `ZqExpAdm${tag}`, title: `ZqExpenseAdm${tag}`, amount: 11111 * n, status: 'pending_admin', reason: 'r', category: 'travel', date: now },
    { userId: uid, userName: `ZqExpPaid${tag}`, title: `ZqExpensePaid${tag}`, amount: 3000 * n + 7, status: 'paid', paidAt: now, reason: 'r', category: 'travel', date: now },
  ])
  await ins('travelrequests', [
    { userId: uid, userName: `ZqTravMgr${tag}`, purpose: 'zqp', destination: `ZqCityMgr${tag}`, departureDate: new Date(now.getTime() + 9 * DAY), returnDate: new Date(now.getTime() + 11 * DAY), estimatedTotal: 5000 * n + 3, advanceRequested: 0, status: 'pending_manager' },
    { userId: uid, userName: `ZqTravAdm${tag}`, purpose: 'zqp', destination: `ZqCityAdm${tag}`, departureDate: new Date(now.getTime() + 9 * DAY), returnDate: new Date(now.getTime() + 11 * DAY), estimatedTotal: 7000 * n + 9, advanceRequested: 100 * n + 5, status: 'pending_admin' },
  ])
  await ins('announcements', [{ authorId: uid, authorName: `ZqAuthor${tag}`, title: `ZqNotice${tag}`, body: 'zqbody', pinned: true, priority: 'normal' }])
  await ins('publicholidays', [{ name: `ZqHoliday${tag}`, date: new Date(now.getTime() + 5 * DAY), type: 'national', year: now.getFullYear() }])
  await ins('auditlogs', [{ action: 'leave.approved', performedBy: uid, performedByName: `ZqActor${tag}`, targetId: 'zq', targetType: 'leave', metadata: { employeeName: `ZqTarget${tag}` } }])
  org.tag = tag; org.n = n
  return org
}

/** Everything that identifies one organisation's seeded data. */
function fingerprints(o) {
  const t = o.tag, n = o.n
  const money = v => `₹${v.toLocaleString('en-IN')}`
  return {
    names: [`Person${t}`, `Zq${t}Surname`, `ZqDept${t}`, `ZqPendingLeave${t}`, `ZqAwayToday${t}`, `ZqExpMgr${t}`, `ZqExpAdm${t}`, `ZqExpPaid${t}`, `ZqTravMgr${t}`, `ZqTravAdm${t}`,
      `ZqExpenseMgr${t}`, `ZqExpenseAdm${t}`, `ZqExpensePaid${t}`, `ZqCityMgr${t}`, `ZqCityAdm${t}`, `ZqNotice${t}`, `ZqHoliday${t}`, `ZqActor${t}`, `ZqTarget${t}`, `zqreason${t}`],
    amounts: [money(1000 * n + 1), money(11111 * n), money(3000 * n + 7), money(5000 * n + 3), money(7000 * n + 9), money(100 * n + 5)],
  }
}

async function dashboardFor(user) {
  const s = await kit.login(user.email)
  assert.match(s.cookie, /^dd_session=./, 'web-enabled organisation must receive a web session')
  const res = await fetch(`${kit.BASE_URL}/dashboard`, { headers: { Cookie: s.cookie, 'x-forwarded-for': kit.freshIp() }, redirect: 'manual' })
  assert.equal(res.status, 200, `dashboard must render for ${user.role} (got ${res.status})`)
  return text(await res.text())
}

test('T0. setup: two organisations with distinct data', async () => {
  orgs.A = await seedOrg('Alpha', 3)
  orgs.B = await seedOrg('Bravo', 7)
  assert.notEqual(orgs.A.orgId, orgs.B.orgId)
})

/** [what the role must see of its OWN org] — proves the assertions are not vacuous */
const EXPECT = {
  admin: o => [`ZqExpenseAdm${o.tag}`, `ZqCityAdm${o.tag}`, `ZqPendingLeave${o.tag}`, `ZqActor${o.tag}`, `₹${(11111 * o.n).toLocaleString('en-IN')}`, `₹${(3000 * o.n + 7).toLocaleString('en-IN')}`, `₹${(7000 * o.n + 9).toLocaleString('en-IN')}`],
  manager: o => [`ZqExpenseMgr${o.tag}`, `ZqCityMgr${o.tag}`, `ZqPendingLeave${o.tag}`, `ZqDept${o.tag}`, `ZqAwayToday${o.tag}`],
  employee: o => [`ZqNotice${o.tag}`, `ZqHoliday${o.tag}`],
}

for (const [mine, other] of [['A', 'B'], ['B', 'A']]) {
  for (const role of ['admin', 'manager', 'employee']) {
    test(`T${mine}-${role}. ${role} of org ${mine} sees only org ${mine}'s dashboard data`, async () => {
      const own = orgs[mine], foreign = orgs[other]
      const page = await dashboardFor(own[role])

      for (const marker of EXPECT[role](own)) assert.ok(page.includes(marker), `org ${mine} ${role} dashboard must show its own "${marker}"`)

      const f = fingerprints(foreign)
      for (const marker of [...f.names, ...f.amounts]) {
        assert.ok(!page.includes(marker), `LEAK: org ${mine} ${role} dashboard contains org ${other}'s "${marker}"`)
      }
    })
  }
}

test('TX. admin "Financial pulse" tiles are EXACTLY this organisation\'s totals (the DB also holds other tenants\' money)', async () => {
  for (const o of [orgs.A, orgs.B]) {
    const page = await dashboardFor(o.admin)
    const money = v => `₹${v.toLocaleString('en-IN')}`
    // The four KPI tiles are the first four ₹ amounts on the page: to-pay-out, paid YTD, advance outstanding, travel cost YTD.
    const tiles = [...page.matchAll(/₹[\d,]+/g)].map(m => m[0]).slice(0, 4)
    assert.deepEqual(tiles, [money(11111 * o.n), money(3000 * o.n + 7), money(100 * o.n + 5), money(0)],
      `org ${o.tag}: aggregate tiles must be computed from this organisation only`)
  }
})
