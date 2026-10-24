/**
 * DoppelDash — Shared Analytics API Security & Tenant Isolation Suite.
 *
 * Tests the shared analytics surface:
 *   - GET /api/analytics/shared/[token]   (public read-only dashboard view)
 *   - GET /api/analytics/share            (session list existing shares)
 *   - POST /api/analytics/share           (session create share token snapshot)
 *   - DELETE /api/analytics/share/[token] (session revoke owner share)
 *
 * Coverage:
 *   1. Authentication & tenant guards (unauthenticated, missing orgId -> 401)
 *   2. Input validation & payload bounds (layout, tile size, max 50 tiles, string bounds, expiry)
 *   3. Token lifecycle & state (valid token 200, expired token 410, revoked/unknown token 404, malformed token 404/400)
 *   4. Cross-tenant isolation (Org B cannot view or revoke Org A shares; Org A public view strictly contains Org A records)
 *   5. Data minimization (zero leak of internal IDs, passwords, secrets, orgId, employee directories, unmasked user IDs)
 *   6. Rate limiting (creation flood 429, public view flood 429)
 *   7. Concurrency & client error handling
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, providers, orgA, orgB, tokA, tokB
const DAY = 864e5

test.before(async () => {
  providers = await fake.ensureFakeProviders()
  db = await kit.connect()

  // Clear any existing rate limits for fresh test run
  await db.collection('ratelimits').deleteMany({ key: /^(share-|shared-)/ })

  // Provision two distinct web-enabled premium test organisations
  orgA = await kit.createOrg({ name: 'Org Alpha Share Test', plan: 'premium', webEnabled: true, lifetimeGrant: true })
  orgB = await kit.createOrg({ name: 'Org Beta Share Test', plan: 'premium', webEnabled: true, lifetimeGrant: true })

  // Log in as manager of each organisation
  const loginA = await kit.login(orgA.manager.email)
  tokA = { token: loginA.accessToken, cookie: loginA.cookie, user: loginA.user }

  const loginB = await kit.login(orgB.manager.email)
  tokB = { token: loginB.accessToken, cookie: loginB.cookie, user: loginB.user }

  // Seed distinct recognizably scoped records in Org A and Org B
  const now = new Date()
  const baseA = { orgId: orgA.orgId, createdAt: now, updatedAt: now }
  const baseB = { orgId: orgB.orgId, createdAt: now, updatedAt: now }

  // Org A: Leaves, Expenses, Travel, AuditLog
  await db.collection('leaves').insertMany([
    { ...baseA, userId: orgA.manager.id, userName: 'Ada Manager A', type: 'casual', startDate: now, endDate: new Date(now.getTime() + DAY), days: 3, status: 'approved', isLWP: false, isHalfDay: false },
    { ...baseA, userId: orgA.employee.id, userName: 'Eve Emp A', type: 'sick', startDate: now, endDate: new Date(now.getTime() + DAY), days: 2, status: 'approved', isLWP: false, isHalfDay: false },
  ])
  await db.collection('expenses').insertMany([
    { ...baseA, userId: orgA.employee.id, userName: 'Eve Emp A', title: 'Alpha Travel Fare', amount: 1250, status: 'paid', paidAt: now, category: 'travel', date: now },
    { ...baseA, userId: orgA.manager.id, userName: 'Ada Manager A', title: 'Alpha Lunch', amount: 750, status: 'paid', paidAt: now, category: 'food', date: now },
  ])
  await db.collection('travelrequests').insertMany([
    { ...baseA, userId: orgA.employee.id, userName: 'Eve Emp A', purpose: 'Client Alpha', destination: 'Zurich Alpha', departureDate: now, returnDate: new Date(now.getTime() + 2 * DAY), estimatedTotal: 4500, status: 'approved' },
  ])
  await db.collection('auditlogs').insertMany([
    {
      ...baseA,
      actorUserId: orgA.manager.id,
      performedByName: 'Ada Manager A',
      action: 'leave.approved',
      metadata: { employeeName: 'Eve Emp A', days: 2, destination: 'Zurich Alpha', internalSecretToken: 'DO_NOT_LEAK_SECRET_A', clientIp: '192.168.1.1' },
    },
  ])

  // Org B: Different, recognisable amounts and names
  await db.collection('leaves').insertMany([
    { ...baseB, userId: orgB.manager.id, userName: 'Bob Manager B', type: 'casual', startDate: now, endDate: new Date(now.getTime() + DAY), days: 99, status: 'approved', isLWP: false, isHalfDay: false },
  ])
  await db.collection('expenses').insertMany([
    { ...baseB, userId: orgB.employee.id, userName: 'Max Emp B', title: 'Beta Mega Expense', amount: 999999, status: 'paid', paidAt: now, category: 'travel', date: now },
  ])
  await db.collection('travelrequests').insertMany([
    { ...baseB, userId: orgB.employee.id, userName: 'Max Emp B', purpose: 'Secret Beta Flight', destination: 'Tokyo Beta', departureDate: now, returnDate: new Date(now.getTime() + 5 * DAY), estimatedTotal: 88888, status: 'approved' },
  ])
})

test.after(async () => {
  await kit.cleanupAll(db)
  await providers.stop()
  await kit.disconnect()
})

const validLayout = [
  { id: 'kpi.totalLeaves', size: 'sm' },
  { id: 'kpi.totalExpenses', size: 'sm' },
  { id: 'chart.leaveByMonth', size: 'md' },
  { id: 'list.topSpenders', size: 'lg' },
  { id: 'list.recentActivity', size: 'lg' },
]

/* ── Group 1: Authentication & Authorization Guards ── */

test('1. Unauthenticated GET /api/analytics/share returns 401 Unauthorized', async () => {
  const res = await kit.api('/api/analytics/share', { method: 'GET' })
  assert.equal(res.status, 401)
  assert.equal(res.json?.error, 'Unauthorized')
})

test('2. Unauthenticated POST /api/analytics/share returns 401 Unauthorized', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    body: { layout: validLayout, expiry: '7d' },
  })
  assert.equal(res.status, 401)
  assert.equal(res.json?.error, 'Unauthorized')
})

test('3. Unauthenticated DELETE /api/analytics/share/[token] returns 401 Unauthorized', async () => {
  const dummyToken = 'a'.repeat(32)
  const res = await kit.api(`/api/analytics/share/${dummyToken}`, { method: 'DELETE' })
  assert.equal(res.status, 401)
  assert.equal(res.json?.error, 'Unauthorized')
})

test('4. User without orgId cannot access GET /api/analytics/share (401)', async () => {
  const { SignJWT } = require('jose')
  const { getJwtSecret } = kit.load('lib/auth/jwt.ts')
  const noOrgToken = await new SignJWT({
    typ: 'session',
    userId: 'u_no_org',
    email: 'no_org@test.dd',
    role: 'employee',
    firstName: 'No',
    lastName: 'Org',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(getJwtSecret())

  const res = await kit.api('/api/analytics/share', { method: 'GET', token: noOrgToken })
  assert.equal(res.status, 401)
  assert.ok(res.json?.error, 'Error message must be returned on 401')
})

test('5. User without orgId cannot create share via POST /api/analytics/share (401)', async () => {
  const { SignJWT } = require('jose')
  const { getJwtSecret } = kit.load('lib/auth/jwt.ts')
  const noOrgToken = await new SignJWT({
    typ: 'session',
    userId: 'u_no_org',
    email: 'no_org@test.dd',
    role: 'employee',
    firstName: 'No',
    lastName: 'Org',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(getJwtSecret())

  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    token: noOrgToken,
    body: { layout: validLayout },
  })
  assert.equal(res.status, 401)
  assert.ok(res.json?.error, 'Error message must be returned on 401')
})

/* ── Group 2: Share Creation & Snapshot Contract (POST /api/analytics/share) ── */

test('6. POST /api/analytics/share: Valid layout and expiry creates share with 32-hex token and url', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: '7d' },
  })
  assert.equal(res.status, 200)
  assert.ok(res.json.token, 'token must be present')
  assert.match(res.json.token, /^[a-f0-9]{32}$/, 'token must be 32 hex characters')
  assert.equal(res.json.url, `/shared/${res.json.token}`)
})

test('7. POST /api/analytics/share: Supports 24h, 7d, 30d, and never expiry options', async () => {
  const expiries = ['24h', '7d', '30d', 'never']
  for (const exp of expiries) {
    const res = await kit.api('/api/analytics/share', {
      method: 'POST',
      cookie: tokA.cookie,
      body: { layout: [{ id: 'kpi.totalLeaves', size: 'sm' }], expiry: exp },
    })
    assert.equal(res.status, 200, `Failed for expiry option: ${exp}`)
    assert.match(res.json.token, /^[a-f0-9]{32}$/)
  }
})

test('8. POST /api/analytics/share: Missing or empty layout returns 400 Bad Request', async () => {
  const resEmpty = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: [], expiry: '7d' },
  })
  assert.equal(resEmpty.status, 400)
  assert.match(resEmpty.json.error, /non-empty layout snapshot/i)

  const resMissing = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { expiry: '7d' },
  })
  assert.equal(resMissing.status, 400)
})

test('9. POST /api/analytics/share: Non-array layout returns 400 Bad Request', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: 'not-an-array' },
  })
  assert.equal(res.status, 400)
})

test('10. POST /api/analytics/share: Layout exceeding 50 tiles returns 400 Bad Request', async () => {
  const bigLayout = Array.from({ length: 51 }, (_, i) => ({ id: `tile_${i}`, size: 'sm' }))
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: bigLayout },
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /exceeds maximum allowed tile count/i)
})

test('11. POST /api/analytics/share: Layout item with invalid or missing id returns 400 Bad Request', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: [{ id: '', size: 'sm' }] },
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /invalid tile id/i)
})

test('12. POST /api/analytics/share: Invalid expiry type returns 400 Bad Request', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: { malicious: true } },
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /invalid expiry format/i)
})

test('13. POST /api/analytics/share: Malformed request body returns 400 Bad Request', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    raw: '{"invalid-json: true',
  })
  assert.equal(res.status, 400)
})

test('14. POST /api/analytics/share: Sanitizes filter strings and bounds string length', async () => {
  const oversizedDept = 'X'.repeat(300)
  const res = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: {
      layout: validLayout,
      filters: { dept: oversizedDept, employee: 'Eve Emp A', status: 'approved', $operator: 'bad' },
    },
  })
  assert.equal(res.status, 200)

  // Verify in MongoDB that dept was capped at 100 characters and $operator was ignored
  const saved = await db.collection('shareddashboards').findOne({ token: res.json.token })
  assert.ok(saved)
  assert.equal(saved.filters.dept.length, 100)
  assert.equal(saved.filters.employee, 'Eve Emp A')
  assert.equal(saved.filters.$operator, undefined)
})

/* ── Group 3: Listing & Resolving Shares ── */

test('15. GET /api/analytics/share: Lists only shares created by the authenticated owner within their org', async () => {
  const res = await kit.api('/api/analytics/share', {
    method: 'GET',
    cookie: tokA.cookie,
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.json.shares))
  assert.ok(res.json.shares.length > 0)
  const first = res.json.shares[0]
  assert.ok(first.token)
  assert.equal(typeof first.viewCount, 'number')
  assert.equal(typeof first.expired, 'boolean')
})

test('16. GET /api/analytics/shared/[token]: Valid token returns 200 with read-only layout and tenant-scoped data', async () => {
  // Create share in Org A
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: '7d' },
  })
  assert.equal(createRes.status, 200)
  const token = createRes.json.token

  // Access public shared dashboard endpoint
  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 200)
  assert.equal(pubRes.json.readOnly, true)
  assert.equal(typeof pubRes.json.ownerName, 'string')
  assert.ok(Array.isArray(pubRes.json.layout))
  assert.ok(pubRes.json.data, 'analytics data must be included')
  assert.ok(pubRes.json.data.kpis, 'kpi metrics must be included')
  assert.equal(pubRes.json.data.kpis.totalLeaves, 2)
  assert.equal(pubRes.json.data.kpis.paidExpense, 2000) // 1250 + 750
})

test('17. GET /api/analytics/shared/[token]: Access increments viewCount', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: '7d' },
  })
  const token = createRes.json.token

  const beforeDoc = await db.collection('shareddashboards').findOne({ token })
  const countBefore = beforeDoc.viewCount || 0

  await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  // Settle brief write
  await new Promise(r => setTimeout(r, 60))

  const afterDoc = await db.collection('shareddashboards').findOne({ token })
  assert.equal(afterDoc.viewCount, countBefore + 1)
})

test('18. GET /api/analytics/shared/[token]: Expired token returns 410 Gone with expired: true', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: '24h' },
  })
  const token = createRes.json.token

  // Force document to be expired in MongoDB
  await db.collection('shareddashboards').updateOne(
    { token },
    { $set: { expiresAt: new Date(Date.now() - 3600_000) } }
  )

  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 410)
  assert.equal(pubRes.json.expired, true)
  assert.match(pubRes.json.error, /expired/i)
})

test('19. GET /api/analytics/shared/[token]: Unknown token returns 404 Not Found', async () => {
  const unknownToken = 'f'.repeat(32)
  const res = await kit.api(`/api/analytics/shared/${unknownToken}`, { method: 'GET' })
  assert.equal(res.status, 404)
  assert.match(res.json.error, /does not exist/i)
})

test('20. GET /api/analytics/shared/[token]: Malformed token (non-hex, wrong length) returns 404 Not Found', async () => {
  const malformedTokens = [
    'invalid-short',
    '12345',
    'g'.repeat(32), // 'g' is not hex
    'a'.repeat(33), // 33 chars
    '../etc/passwd',
    '{"$gt":""}',
  ]

  for (const token of malformedTokens) {
    const res = await kit.api(`/api/analytics/shared/${encodeURIComponent(token)}`, { method: 'GET' })
    assert.equal(res.status, 404, `Malformed token "${token}" must safely return 404`)
    assert.match(res.json.error, /does not exist/i)
  }
})

/* ── Group 4: Revocation Lifecycle & Cross-Tenant Boundary ── */

test('21. DELETE /api/analytics/share/[token]: Owner can revoke share, returning 200 ok', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: '7d' },
  })
  const token = createRes.json.token

  const delRes = await kit.api(`/api/analytics/share/${token}`, {
    method: 'DELETE',
    cookie: tokA.cookie,
  })
  assert.equal(delRes.status, 200)
  assert.equal(delRes.json.ok, true)
})

test('22. DELETE /api/analytics/share/[token]: Subsequent public resolution of revoked share returns 404 Not Found', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout, expiry: '7d' },
  })
  const token = createRes.json.token

  // Revoke share
  await kit.api(`/api/analytics/share/${token}`, { method: 'DELETE', cookie: tokA.cookie })

  // Public resolution must now return 404
  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 404)
})

test('23. DELETE /api/analytics/share/[token]: Malformed token returns 400 Bad Request', async () => {
  const res = await kit.api('/api/analytics/share/malformed-token-123', {
    method: 'DELETE',
    cookie: tokA.cookie,
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /invalid or malformed/i)
})

test('24. DELETE /api/analytics/share/[token]: Non-existent token returns 404 Not Found', async () => {
  const nonExistentToken = 'e'.repeat(32)
  const res = await kit.api(`/api/analytics/share/${nonExistentToken}`, {
    method: 'DELETE',
    cookie: tokA.cookie,
  })
  assert.equal(res.status, 404)
  assert.equal(res.json.error, 'Not found')
})

test('25. Tenant Isolation: Org B user cannot view Org A shares in GET /api/analytics/share', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const tokenA = createRes.json.token

  // Org B lists their shares
  const listB = await kit.api('/api/analytics/share', {
    method: 'GET',
    cookie: tokB.cookie,
  })
  assert.equal(listB.status, 200)
  const tokensInB = (listB.json.shares || []).map(s => s.token)
  assert.ok(!tokensInB.includes(tokenA), 'Org B must never list Org A shares')
})

test('26. Tenant Isolation: Org B user cannot revoke Org A share via DELETE /api/analytics/share/[token] (returns 404)', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const tokenA = createRes.json.token

  // Org B attempts to delete Org A's token
  const deleteAttempt = await kit.api(`/api/analytics/share/${tokenA}`, {
    method: 'DELETE',
    cookie: tokB.cookie,
  })
  assert.equal(deleteAttempt.status, 404)

  // Verify Org A token is still intact
  const doc = await db.collection('shareddashboards').findOne({ token: tokenA })
  assert.ok(doc, 'Org A share token must NOT have been deleted by Org B')
})

test('27. Tenant Isolation: Org A shared dashboard data strictly excludes Org B leaves, expenses, travel', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const tokenA = createRes.json.token

  const pubRes = await kit.api(`/api/analytics/shared/${tokenA}`, { method: 'GET' })
  assert.equal(pubRes.status, 200)
  const data = pubRes.json.data

  // Org A should have total expenses 2000 (1250 + 750), NOT Org B's 999999
  assert.equal(data.kpis.paidExpense, 2000)
  assert.notEqual(data.kpis.paidExpense, 999999)

  // Org A total leaves should be 2, NOT including Org B's 99 days leave
  assert.equal(data.kpis.totalLeaves, 2)

  // Top spenders should have only Org A employees
  const spenderNames = (data.topSpenders || []).map(s => s.userName)
  assert.ok(!spenderNames.includes('Max Emp B'), 'Org B employee must not appear in Org A top spenders')
})

/* ── Group 5: Data Minimization & Privacy ── */

test('28. Data Minimization: Public response does not leak internal DB IDs, orgId, or ownerId', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const token = createRes.json.token

  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 200)

  const bodyStr = JSON.stringify(pubRes.json)
  assert.ok(!bodyStr.includes(orgA.orgId), 'Response must not contain orgId')
  assert.ok(!bodyStr.includes(orgA.manager.id), 'Response must not contain ownerId')
  assert.equal(pubRes.json.orgId, undefined)
  assert.equal(pubRes.json.ownerId, undefined)
})

test('29. Data Minimization: Public response omits filterOptions (no employee directory or email leakage)', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const token = createRes.json.token

  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 200)
  assert.equal(pubRes.json.data.filterOptions, undefined, 'filterOptions must be undefined in public response')
})

test('30. Data Minimization: Public response sanitizes audit log metadata (stripping internal secrets/tokens)', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const token = createRes.json.token

  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 200)

  const audits = pubRes.json.data.recentAudits || []
  assert.ok(audits.length > 0, 'Recent audits should be present for manager share')

  // Phase 12: creating the share itself now writes an `analytics.share_created` event that is the newest entry, so pick the seeded event (share/auth/mailbox events are excluded from the dashboard feed).
  const audit = audits.find(a => a.metadata && a.metadata.destination === 'Zurich Alpha') || audits[0]
  assert.ok(audit.performedByName)
  assert.ok(audit.metadata)
  assert.equal(audit.metadata.employeeName, 'Eve Emp A')
  assert.equal(audit.metadata.destination, 'Zurich Alpha')
  // Sensitive/internal metadata fields must be stripped:
  assert.equal(audit.metadata.internalSecretToken, undefined, 'Internal secret must be stripped from metadata')
  assert.equal(audit.metadata.clientIp, undefined, 'Client IP must be stripped from audit metadata')
})

test('31. Data Minimization: Public response masks top spenders user IDs with opaque keys', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokA.cookie,
    body: { layout: validLayout },
  })
  const token = createRes.json.token

  const pubRes = await kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  assert.equal(pubRes.status, 200)

  const spenders = pubRes.json.data.topSpenders || []
  for (const s of spenders) {
    assert.match(s.userId, /^sp_\d+$/, `Spender ID "${s.userId}" must be masked with opaque prefix, never raw Mongo ObjectId`)
  }
})

/* ── Group 6: Rate Limiting & Concurrency ── */

test('32. Rate Limiting: POST /api/analytics/share rejects rapid flood with 429', async () => {
  const dedicatedIp = kit.freshIp()
  let hitRateLimit = false

  for (let i = 0; i < 35; i++) {
    const res = await kit.api('/api/analytics/share', {
      method: 'POST',
      cookie: tokA.cookie,
      ip: dedicatedIp,
      body: { layout: validLayout },
    })
    if (res.status === 429) {
      hitRateLimit = true
      assert.equal(res.json.code, 'rate_limited')
      break
    }
  }

  assert.ok(hitRateLimit, 'POST /api/analytics/share must enforce rate limiting (429)')
})

test('33. Rate Limiting: GET /api/analytics/shared/[token] rejects rapid requests from same IP with 429', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokB.cookie,
    body: { layout: validLayout },
  })
  const token = createRes.json.token
  const floodIp = '10.99.88.77'

  let hitRateLimit = false
  for (let i = 0; i < 65; i++) {
    const res = await kit.api(`/api/analytics/shared/${token}`, {
      method: 'GET',
      ip: floodIp,
    })
    if (res.status === 429) {
      hitRateLimit = true
      assert.equal(res.json.code, 'rate_limited')
      break
    }
  }

  assert.ok(hitRateLimit, 'GET /api/analytics/shared/[token] must rate limit excessive requests from single IP (429)')
})

test('34. Concurrency: Concurrent requests to valid shared dashboard resolve safely without data race', async () => {
  const createRes = await kit.api('/api/analytics/share', {
    method: 'POST',
    cookie: tokB.cookie,
    body: { layout: validLayout },
  })
  const token = createRes.json.token

  // Launch 5 concurrent read requests
  const requests = Array.from({ length: 5 }, () =>
    kit.api(`/api/analytics/shared/${token}`, { method: 'GET' })
  )

  const responses = await Promise.all(requests)
  for (const r of responses) {
    assert.equal(r.status, 200, `Concurrent read must succeed with 200, got ${r.status}`)
    assert.equal(r.json.readOnly, true)
  }
})

/* ── Group 7: Web Client Contract Verification ── */

test('35. Web Client Contract: /shared/[token] page source structure handles errors and renders tiles', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const pageSrc = fs.readFileSync(path.resolve(__dirname, '../app/shared/[token]/page.tsx'), 'utf8')

  // Verifies client error state handling
  assert.ok(pageSrc.includes('error'), 'Page component must track error state')
  assert.ok(pageSrc.includes('Dashboard unavailable'), 'Page component must display fallback unavailable banner')
  assert.ok(pageSrc.includes('readOnly'), 'Page component must enforce readOnly tile rendering')
  assert.ok(pageSrc.includes('tileById(e.id)'), 'Page component must filter against recognized tile registry')
})
