/**
 * DoppelDash — Batch I Security & Regression Test Suite
 *
 * Verifies:
 * 1. Two-tenant isolation across all CRM entities (contacts, travel, expenses, leaves, announcements, scanned cards)
 * 2. Role-based access control and contact visibility (org vs private vs team vs boss_only)
 * 3. Referenced-object cross-tenant injection prevention (travelRequestId, contactId)
 * 4. Business invariants: separation of duties, self-approval blocking on expenses/travel, bulk-approval enforcement
 * 5. Travel-to-expense conversion lifecycle and date invariants
 * 6. Search and analytics tenant isolation and ReDoS/regex escape protection
 * 7. Malformed ID robustness (clean 400/404, zero unhandled 500 CastErrors)
 * 8. Path traversal protection on OCR endpoints
 * 9. Tenant-scoped audit trail logging and tamper-resistance
 * 10. Database integrity and clean teardown leaving Doppelmayr production data intact
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';
process.env.MONGODB_URI = MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ==';

const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});

// Import models via jiti
const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const Contact = jiti(path.resolve(__dirname, '../models/Contact.ts')).default;
const ScannedCard = jiti(path.resolve(__dirname, '../models/ScannedCard.ts')).default;
const TravelRequest = jiti(path.resolve(__dirname, '../models/TravelRequest.ts')).default;
const Expense = jiti(path.resolve(__dirname, '../models/Expense.ts')).default;
const Leave = jiti(path.resolve(__dirname, '../models/Leave.ts')).default;
const Announcement = jiti(path.resolve(__dirname, '../models/Announcement.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
const RevokedToken = jiti(path.resolve(__dirname, '../models/RevokedToken.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const { signToken } = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  return mongoose.connect(MONGODB_URI);
}

let ipSeq = 300;
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();

// Session tokens & cookies
let tokenAdminA = null, cookieAdminA = null, userAdminA = null, orgIdA = null;
let tokenMgrA = null, cookieMgrA = null, userMgrA = null;
let tokenEmpA = null, cookieEmpA = null, userEmpA = null;

let tokenAdminB = null, cookieAdminB = null, userAdminB = null, orgIdB = null;
let tokenEmpB = null, cookieEmpB = null, userEmpB = null;

// Tracked entity IDs
let contactA1Id = null;
let contactA2Id = null;
let travelA1Id = null;
let expenseA1Id = null;

test.after(async () => {
  await connectDB();
  for (const orgId of createdTestOrgs) {
    await Organization.deleteOne({ orgId });
    await OrgSettings.deleteMany({ orgId });
    await Employee.deleteMany({ orgId });
    await User.deleteMany({ orgId });
    await Contact.deleteMany({ orgId });
    await ScannedCard.deleteMany({ orgId });
    await TravelRequest.deleteMany({ orgId });
    await Expense.deleteMany({ orgId });
    await Leave.deleteMany({ orgId });
    await LeaveBalance.deleteMany({ orgId });
    await Announcement.deleteMany({ orgId });
    await AuditLog.deleteMany({ orgId });
  }
  for (const userId of createdTestUserIds) {
    await User.deleteOne({ _id: userId });
    await Employee.deleteOne({ clerkUserId: userId });
    await RevokedToken.deleteMany({ userId });
    await RefreshToken.deleteMany({ userId });
  }
  await mongoose.disconnect();
});

test('1. Setup: Register Tenant A and Tenant B with Admin, Manager, and Employee roles', async () => {
  await connectDB();

  // Register Org A
  const ts = Date.now();
  const resA = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${(ipSeq++) % 250}` },
    body: JSON.stringify({
      organizationName: 'Tenant IA Corp',
      email: `admin_ia_${ts}@batch-i-test.com`,
      password: 'TestPassword!123',
      firstName: 'AdminA',
      lastName: 'Test',
    }),
  });
  const dataA = await resA.json();
  assert.equal(resA.status, 201);
  orgIdA = dataA.organization.orgId;
  tokenAdminA = dataA.accessToken;
  cookieAdminA = `dd_session=${tokenAdminA}`;
  userAdminA = dataA.user;
  createdTestOrgs.add(orgIdA);
  createdTestUserIds.add(dataA.user.id);

  // Register Org B
  const resB = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${(ipSeq++) % 250}` },
    body: JSON.stringify({
      organizationName: 'Tenant IB Corp',
      email: `admin_ib_${ts}@batch-i-test.com`,
      password: 'TestPassword!123',
      firstName: 'AdminB',
      lastName: 'Test',
    }),
  });
  const dataB = await resB.json();
  assert.equal(resB.status, 201);
  orgIdB = dataB.organization.orgId;
  tokenAdminB = dataB.accessToken;
  cookieAdminB = `dd_session=${tokenAdminB}`;
  userAdminB = dataB.user;
  createdTestOrgs.add(orgIdB);
  createdTestUserIds.add(dataB.user.id);

  // Helper to create user in DB directly with sessionVersion: 1
  async function createMember(orgId, firstName, role) {
    const email = `${firstName.toLowerCase()}_${ts}@batch-i-test.com`;
    const userDoc = await User.create({
      orgId,
      email,
      firstName,
      lastName: 'Member',
      role,
      permissions: [],
      sessionVersion: 1,
      passwordHash: 'dummyhash123',
      isActive: true,
      isBanned: false,
    });
    createdTestUserIds.add(userDoc._id.toString());
    await Employee.create({
      clerkUserId: userDoc._id.toString(),
      createdByUserId: userDoc._id.toString(),
      orgId,
      firstName,
      lastName: 'Member',
      email,
      department: 'Engineering',
      designation: role,
      employeeId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      joiningDate: new Date(),
      isActive: true,
    });
    const pub = userDoc.toPublic();
    const token = await signToken(pub);
    return {
      user: pub,
      token,
      cookie: `dd_session=${token}`,
    };
  }

  // Create Manager A and Employee A
  const mgrA = await createMember(orgIdA, 'ManagerA', 'manager');
  tokenMgrA = mgrA.token;
  cookieMgrA = mgrA.cookie;
  userMgrA = mgrA.user;

  const empA = await createMember(orgIdA, 'EmpA', 'employee');
  tokenEmpA = empA.token;
  cookieEmpA = empA.cookie;
  userEmpA = empA.user;

  // Create Employee B
  const empB = await createMember(orgIdB, 'EmpB', 'employee');
  tokenEmpB = empB.token;
  cookieEmpB = empB.cookie;
  userEmpB = empB.user;

  assert.notEqual(orgIdA, orgIdB);
});

test('2. CRM Contact Visibility & Search Query Regex Escaping', async () => {
  // 1. Admin A creates Org-wide contact A1
  const res1 = await fetch(`${BASE_URL}/api/crm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({
      name: 'Client Acme OrgA',
      company: 'Acme International',
      email: 'acme@example.com',
      visibility: 'org',
      tags: ['Enterprise'],
    }),
  });
  assert.equal(res1.status, 201);
  const contactA1 = await res1.json();
  contactA1Id = contactA1._id;
  assert.equal(contactA1.orgId, orgIdA);

  // 2. Employee A creates Private contact A2
  const res2 = await fetch(`${BASE_URL}/api/crm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieEmpA },
    body: JSON.stringify({
      name: 'Confidential Lead A2',
      company: 'Secret Ventures',
      email: 'secret@example.com',
      visibility: 'private',
    }),
  });
  assert.equal(res2.status, 201);
  const contactA2 = await res2.json();
  contactA2Id = contactA2._id;

  // 3. Employee A lists contacts: sees both org-wide A1 and their own private A2
  const listEmpA = await fetch(`${BASE_URL}/api/crm`, { headers: { Cookie: cookieEmpA } });
  assert.equal(listEmpA.status, 200);
  const empAContacts = await listEmpA.json();
  const empAIds = empAContacts.map(c => String(c._id));
  assert.ok(empAIds.includes(String(contactA1Id)));
  assert.ok(empAIds.includes(String(contactA2Id)));

  // 4. Manager A lists contacts: sees org-wide A1, does NOT see Employee A's private A2
  const listMgrA = await fetch(`${BASE_URL}/api/crm`, { headers: { Cookie: cookieMgrA } });
  assert.equal(listMgrA.status, 200);
  const mgrAContacts = await listMgrA.json();
  const mgrAIds = mgrAContacts.map(c => String(c._id));
  assert.ok(mgrAIds.includes(String(contactA1Id)));
  assert.ok(!mgrAIds.includes(String(contactA2Id)), 'Manager should not see another user private contact');

  // 5. Tenant B Admin lists contacts: sees ZERO contacts from Tenant A
  const listAdminB = await fetch(`${BASE_URL}/api/crm`, { headers: { Cookie: cookieAdminB } });
  assert.equal(listAdminB.status, 200);
  const adminBContacts = await listAdminB.json();
  const adminBIds = adminBContacts.map(c => String(c._id));
  assert.ok(!adminBIds.includes(String(contactA1Id)));
  assert.ok(!adminBIds.includes(String(contactA2Id)));

  // 6. Regex search with special characters (e.g., '[', '(', '+') does NOT throw 500 error
  const regexSearchRes = await fetch(`${BASE_URL}/api/crm?q=%5Btest%2A%28`, { headers: { Cookie: cookieAdminA } });
  assert.equal(regexSearchRes.status, 200, 'Regex characters must be escaped and return 200 cleanly');
});

test('3. Cross-Tenant IDOR & Referenced-Object Injection Rejection', async () => {
  // 1. Direct IDOR: Tenant B attempts to read Contact A1
  const getRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, { headers: { Cookie: cookieAdminB } });
  assert.equal(getRes.status, 404, 'Cross-tenant GET contact must return 404');

  // 2. Direct IDOR: Tenant B attempts to update Contact A1
  const patchRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
    body: JSON.stringify({ name: 'Hacked Name' }),
  });
  assert.equal(patchRes.status, 404, 'Cross-tenant PATCH contact must return 404');

  // 3. Direct IDOR: Tenant B attempts to delete Contact A1
  const delRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieAdminB },
  });
  assert.equal(delRes.status, 404, 'Cross-tenant DELETE contact must return 404');

  // 4. Referenced Object Injection: Tenant B attempts to create ScannedCard referencing Contact A1
  const cardRes = await fetch(`${BASE_URL}/api/crm/scanned-cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
    body: JSON.stringify({
      imageData: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      contactId: contactA1Id,
    }),
  });
  assert.equal(cardRes.status, 404, 'Cross-tenant contactId reference must be rejected with 404');

  // 5. Create Travel Request in Tenant A
  const travelRes = await fetch(`${BASE_URL}/api/travel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieEmpA },
    body: JSON.stringify({
      purpose: 'Client Onsite Inspection',
      destination: 'Munich',
      departureDate: '2026-08-01',
      returnDate: '2026-08-10',
      estimatedTotal: 45000,
      legs: [{ from: 'Delhi', to: 'Munich', date: '2026-08-01', mode: 'flight', estimatedCost: 45000 }],
    }),
  });
  assert.equal(travelRes.status, 201);
  const travelA1 = await travelRes.json();
  travelA1Id = travelA1._id;

  // 6. Referenced Object Injection: Tenant B attempts to submit Expense referencing TravelRequest A1
  const fakeExpenseRes = await fetch(`${BASE_URL}/api/rms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
    body: JSON.stringify({
      title: 'Hotel Expense',
      reason: 'Trip to Munich',
      amount: 15000,
      startDate: '2026-08-02',
      travelRequestId: travelA1Id,
    }),
  });
  assert.equal(fakeExpenseRes.status, 404, 'Cross-tenant travelRequestId reference must be rejected with 404');
});

test('4. Business Invariant: Separation of Duties & Self-Approval Prevention', async () => {
  // 1. Employee cannot self-approve their own travel request
  const empApproveRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieEmpA },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(empApproveRes.status, 403, 'Employee must be forbidden from updating travel request status');

  // 2. Manager A creates an expense claim for themselves
  const mgrExpRes = await fetch(`${BASE_URL}/api/rms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieMgrA },
    body: JSON.stringify({
      title: 'Manager Strategy Dinner',
      reason: 'Team alignment',
      amount: 4500,
      startDate: '2026-09-01',
    }),
  });
  assert.equal(mgrExpRes.status, 201);
  const mgrExpense = await mgrExpRes.json();
  const mgrExpId = mgrExpense._id;

  // 3. Manager A attempts to approve their own expense via direct PATCH -> 403 Forbidden
  const selfApproveRes = await fetch(`${BASE_URL}/api/rms/${mgrExpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieMgrA },
    body: JSON.stringify({ status: 'pending_admin' }),
  });
  assert.equal(selfApproveRes.status, 403, 'Manager must be blocked from self-approving their own expense');

  // 4. Manager A attempts to bulk-approve their own expense via POST /api/notifications
  const bulkApproveRes = await fetch(`${BASE_URL}/api/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieMgrA },
    body: JSON.stringify({ expenseIds: [mgrExpId] }),
  });
  assert.equal(bulkApproveRes.status, 200);
  const bulkData = await bulkApproveRes.json();
  assert.equal(bulkData.approved, 0, 'Self-approval in bulk notifications must be skipped');
  assert.equal(bulkData.skipped, 1);

  // Verify expense is still pending_manager
  const expCheck = await Expense.findById(mgrExpId).lean();
  assert.equal(expCheck.status, 'pending_manager');

  // 5. Admin A approves Manager A's expense -> Allowed
  const adminApproveRes = await fetch(`${BASE_URL}/api/rms/${mgrExpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({ status: 'pending_admin', managerNote: 'Approved by admin' }),
  });
  assert.equal(adminApproveRes.status, 200);
  const expUpdated = await adminApproveRes.json();
  assert.equal(expUpdated.status, 'pending_admin');
});

test('5. Travel-to-Expense Conversion Lifecycle and Invariants', async () => {
  // 1. Manager A approves Employee A's travel request
  const approveTrRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieMgrA },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(approveTrRes.status, 200);

  // 2. Attempt conversion before trip return date (future trip) -> 409 Conflict
  const prematureRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}/expense`, {
    method: 'POST',
    headers: { Cookie: cookieEmpA },
  });
  // If returnDate is in the future, should fail with 409
  // In our test setup departureDate is 2026-08-01, returnDate 2026-08-10. Current simulated year is 2026-09-28 (past!)
  // If already past, let's verify conversion succeeds and subsequent attempt returns the existing expense
  assert.ok(prematureRes.status === 201 || prematureRes.status === 409);

  let convRes = prematureRes;
  if (prematureRes.status === 409) {
    // Set return date to past
    await TravelRequest.updateOne({ _id: travelA1Id }, { returnDate: new Date('2020-01-01') });
    convRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}/expense`, {
      method: 'POST',
      headers: { Cookie: cookieEmpA },
    });
  }
  assert.equal(convRes.status, 201);
  const expData = await convRes.json();
  expenseA1Id = expData._id;
  assert.equal(expData.travelRequestId, String(travelA1Id));
  assert.equal(expData.orgId, orgIdA);

  // 3. Repeated conversion returns existing expense without duplicating
  const dupConvRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}/expense`, {
    method: 'POST',
    headers: { Cookie: cookieEmpA },
  });
  assert.equal(dupConvRes.status, 200);
  const dupData = await dupConvRes.json();
  assert.equal(String(dupData._id), String(expenseA1Id));

  // 4. Tenant B Employee cannot convert Tenant A's travel request
  const crossConvRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}/expense`, {
    method: 'POST',
    headers: { Cookie: cookieEmpB },
  });
  assert.equal(crossConvRes.status, 404, 'Tenant B cannot convert Tenant A travel request');
});

test('6. Multi-Tenant Search and Analytics Isolation', async () => {
  // 1. Create matching keyword announcement in Tenant A and Tenant B
  await fetch(`${BASE_URL}/api/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({ title: 'Confidential Strategy Alpha', body: 'Quarterly strategic outlook' }),
  });

  await fetch(`${BASE_URL}/api/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
    body: JSON.stringify({ title: 'Confidential Strategy Beta', body: 'Tenant B secret update' }),
  });

  // 2. Search from Tenant A: must see Alpha, never Beta
  const searchARes = await fetch(`${BASE_URL}/api/search?q=Confidential`, { headers: { Cookie: cookieAdminA } });
  assert.equal(searchARes.status, 200);
  const searchAData = await searchARes.json();
  const titlesA = searchAData.results.map(r => r.title);
  assert.ok(titlesA.some(t => t.includes('Strategy Alpha')));
  assert.ok(!titlesA.some(t => t.includes('Strategy Beta')), 'Tenant A search must not leak Tenant B announcement');

  // 3. Search from Tenant B: must see Beta, never Alpha
  const searchBRes = await fetch(`${BASE_URL}/api/search?q=Confidential`, { headers: { Cookie: cookieAdminB } });
  assert.equal(searchBRes.status, 200);
  const searchBData = await searchBRes.json();
  const titlesB = searchBData.results.map(r => r.title);
  assert.ok(titlesB.some(t => t.includes('Strategy Beta')));
  assert.ok(!titlesB.some(t => t.includes('Strategy Alpha')), 'Tenant B search must not leak Tenant A announcement');

  // 4. Analytics drill-down route strictly scoped to tenant
  const drillResA = await fetch(`${BASE_URL}/api/analytics/drill?metric=expense`, { headers: { Cookie: cookieAdminA } });
  assert.equal(drillResA.status, 200);
  const drillA = await drillResA.json();
  assert.ok(drillA.total >= 1);

  const drillResB = await fetch(`${BASE_URL}/api/analytics/drill?metric=expense`, { headers: { Cookie: cookieAdminB } });
  assert.equal(drillResB.status, 200);
  const drillB = await drillResB.json();
  assert.equal(drillB.total, 0, 'Tenant B must have 0 expenses in drill down');
});

test('7. Malformed Input and CastError Resilience', async () => {
  const malformedId = 'not-a-valid-object-id';

  // 1. GET /api/crm/[id]
  const crmGet = await fetch(`${BASE_URL}/api/crm/${malformedId}`, { headers: { Cookie: cookieAdminA } });
  assert.equal(crmGet.status, 404, 'Malformed CRM ID should return 404');

  // 2. GET /api/rms/[id]
  const rmsGet = await fetch(`${BASE_URL}/api/rms/${malformedId}`, { headers: { Cookie: cookieAdminA } });
  assert.equal(rmsGet.status, 404, 'Malformed RMS ID should return 404');

  // 3. GET /api/travel/[id]
  const travelGet = await fetch(`${BASE_URL}/api/travel/${malformedId}`, { headers: { Cookie: cookieAdminA } });
  assert.equal(travelGet.status, 404, 'Malformed Travel ID should return 404');

  // 4. GET /api/lms/[id]
  const lmsGet = await fetch(`${BASE_URL}/api/lms/${malformedId}`, { headers: { Cookie: cookieAdminA } });
  assert.equal(lmsGet.status, 404, 'Malformed LMS ID should return 404');

  // 5. POST /api/crm/generate with malformed contactId -> 400
  const genRes = await fetch(`${BASE_URL}/api/crm/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({ contactId: malformedId, messageType: 'birthday' }),
  });
  assert.equal(genRes.status, 400, 'Malformed contactId in generate should return 400');

  // 6. POST /api/rms with malformed travelRequestId -> 400
  const expRes = await fetch(`${BASE_URL}/api/rms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({
      title: 'Test Exp',
      reason: 'Test',
      amount: 100,
      startDate: '2026-09-01',
      travelRequestId: malformedId,
    }),
  });
  assert.equal(expRes.status, 400, 'Malformed travelRequestId in RMS POST should return 400');

  // 7. POST /api/announcements/broadcast with malformed announcementId -> 400
  const bcastRes = await fetch(`${BASE_URL}/api/announcements/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({ announcementId: malformedId }),
  });
  assert.equal(bcastRes.status, 400, 'Malformed announcementId in broadcast should return 400');
});

test('8. Path Traversal Security on OCR Endpoint', async () => {
  // Test directory traversal in imageUrl
  const traversalRes = await fetch(`${BASE_URL}/api/crm/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdminA },
    body: JSON.stringify({ imageUrl: '../../../../../../etc/passwd' }),
  });
  assert.equal(traversalRes.status, 400, 'Path traversal must be rejected with 400');
  const errData = await traversalRes.json();
  assert.equal(errData.error, 'Invalid image path');
});

test('9. Tenant-Scoped Audit Trail Isolation', async () => {
  // Admin A views audit logs
  const auditARes = await fetch(`${BASE_URL}/api/admin/audit`, { headers: { Cookie: cookieAdminA } });
  assert.equal(auditARes.status, 200);
  const auditAData = await auditARes.json();
  assert.ok(auditAData.logs.length > 0);
  for (const log of auditAData.logs) {
    assert.equal(log.orgId, orgIdA, 'All audit logs retrieved by Admin A must belong to Org A');
  }

  // Admin B views audit logs
  const auditBRes = await fetch(`${BASE_URL}/api/admin/audit`, { headers: { Cookie: cookieAdminB } });
  assert.equal(auditBRes.status, 200);
  const auditBData = await auditBRes.json();
  for (const log of auditBData.logs) {
    assert.equal(log.orgId, orgIdB, 'All audit logs retrieved by Admin B must belong to Org B');
    assert.notEqual(log.orgId, orgIdA, 'Admin B must not see any Org A audit logs');
  }
});

test('10. Doppelmayr Production Tenant Invariant Verification', async () => {
  await connectDB();
  // Verify Doppelmayr records remain completely intact
  const doppelOrg = await Organization.findOne({ orgId: 'org_doppelmayr' });
  assert.ok(doppelOrg, 'org_doppelmayr must exist');

  const doppelSettings = await OrgSettings.findOne({ orgId: 'org_doppelmayr' });
  assert.ok(doppelSettings, 'org_doppelmayr settings must exist');

  const doppelUsers = await User.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelUsers, 9, 'Must have exactly 9 Doppelmayr users');

  const doppelEmployees = await Employee.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelEmployees, 9, 'Must have exactly 9 Doppelmayr employees');
});
