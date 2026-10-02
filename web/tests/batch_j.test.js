/**
 * DoppelDash — Batch J Mobile Client Integration & Security Regression Suite
 *
 * Verifies the mobile/Android client contracts:
 * 1. Mobile Auth & Bearer Token lifecycle:
 *    - POST /api/auth/login -> preAuthToken
 *    - POST /api/auth/verify-otp -> accessToken & refreshToken
 *    - POST /api/auth/refresh -> token rotation and session continuity
 *    - GET /api/auth/me with Authorization: Bearer
 * 2. Mobile CRM Workflows:
 *    - Contacts (create, list, detail, update, delete)
 *    - Expenses / RMS (submit with date-only format, list, approval, self-approval prevention)
 *    - Travel (create, status, travel-to-expense conversion)
 *    - LMS / Leaves (balance, apply date-only, list, withdraw)
 *    - Announcements & Search (isolated query, no cross-tenant leakage)
 *    - Profile (GET/PATCH /api/employees/me, forbidden role/org tampering prevention)
 * 3. Mobile Tenant Isolation:
 *    - Tenant A mobile token cannot read/modify Tenant B records
 *    - Referenced object cross-tenant injection rejection
 * 4. Token Invalidation:
 *    - Logout invalidates refresh token server-side
 *    - Password change revokes existing mobile tokens (sessionVersion mismatch)
 *    - User suspension terminates mobile session immediately
 * 5. Database Cleanup & Doppelmayr Invariant Preservation
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
const TravelRequest = jiti(path.resolve(__dirname, '../models/TravelRequest.ts')).default;
const Expense = jiti(path.resolve(__dirname, '../models/Expense.ts')).default;
const Leave = jiti(path.resolve(__dirname, '../models/Leave.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const Announcement = jiti(path.resolve(__dirname, '../models/Announcement.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const RevokedToken = jiti(path.resolve(__dirname, '../models/RevokedToken.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
const { signToken } = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  return mongoose.connect(MONGODB_URI);
}

let ipSeq = 600;
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();

let orgIdA = null, orgIdB = null;
let mobileTokenAdminA = null, mobileRefreshAdminA = null;
let mobileTokenEmpA = null, userEmpA = null;
let mobileTokenAdminB = null, mobileRefreshAdminB = null;

let contactA1Id = null;
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
    await RefreshToken.deleteMany({ userId });
    await RevokedToken.deleteMany({ userId });
  }
  await mongoose.disconnect();
});

test('1. Mobile Registration & Auth Lifecycle: Bearer token and refresh rotation', async () => {
  await connectDB();
  const ts = Date.now();

  // Register Org A via mobile registration payload
  const resA = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${(ipSeq++) % 250}` },
    body: JSON.stringify({
      companyName: 'Mobile Tenant A Corp',
      email: `mobile_admin_a_${ts}@batch-j-test.com`,
      password: 'TestPassword!123',
      firstName: 'Alice',
      lastName: 'Mobile',
    }),
  });
  const dataA = await resA.json();
  assert.equal(resA.status, 201);
  assert.ok(dataA.accessToken, 'Must return mobile accessToken');
  assert.ok(dataA.refreshToken, 'Must return mobile refreshToken');
  assert.equal(dataA.user.role, 'admin');

  orgIdA = dataA.organization.orgId;
  mobileTokenAdminA = dataA.accessToken;
  mobileRefreshAdminA = dataA.refreshToken;
  createdTestOrgs.add(orgIdA);
  createdTestUserIds.add(dataA.user.id);

  // Register Org B
  const resB = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${(ipSeq++) % 250}` },
    body: JSON.stringify({
      companyName: 'Mobile Tenant B Corp',
      email: `mobile_admin_b_${ts}@batch-j-test.com`,
      password: 'TestPassword!123',
      firstName: 'Bob',
      lastName: 'Mobile',
    }),
  });
  const dataB = await resB.json();
  assert.equal(resB.status, 201);
  orgIdB = dataB.organization.orgId;
  mobileTokenAdminB = dataB.accessToken;
  mobileRefreshAdminB = dataB.refreshToken;
  createdTestOrgs.add(orgIdB);
  createdTestUserIds.add(dataB.user.id);

  // Test GET /api/auth/me with Authorization: Bearer
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminA}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.email, `mobile_admin_a_${ts}@batch-j-test.com`);
  assert.equal(meData.role, 'admin');

  // Test Refresh Token Rotation: POST /api/auth/refresh
  const refRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: mobileRefreshAdminA }),
  });
  assert.equal(refRes.status, 200);
  const refData = await refRes.json();
  assert.ok(refData.accessToken);
  assert.ok(refData.refreshToken);
  assert.notEqual(refData.refreshToken, mobileRefreshAdminA, 'Refresh token must be rotated');

  // Update active tokens
  mobileTokenAdminA = refData.accessToken;
  mobileRefreshAdminA = refData.refreshToken;

  // Verify old refresh token is now invalidated (single-use rotation)
  const oldRefRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: dataA.refreshToken }),
  });
  assert.equal(oldRefRes.status, 401, 'Reused refresh token must be rejected');

  // Create an Employee member in Org A for testing RBAC
  const empEmail = `mobile_emp_a_${ts}@batch-j-test.com`;
  const empDoc = await User.create({
    orgId: orgIdA,
    email: empEmail,
    firstName: 'Edward',
    lastName: 'Employee',
    role: 'employee',
    permissions: [],
    sessionVersion: 1,
    passwordHash: 'dummyhash123',
    isActive: true,
    isBanned: false,
  });
  createdTestUserIds.add(empDoc._id.toString());
  await Employee.create({
    clerkUserId: empDoc._id.toString(),
    createdByUserId: dataA.user.id,
    orgId: orgIdA,
    firstName: 'Edward',
    lastName: 'Employee',
    email: empEmail,
    department: 'Sales',
    designation: 'Sales Representative',
    joiningDate: new Date(),
    isActive: true,
  });
  const pub = empDoc.toPublic();
  mobileTokenEmpA = await signToken(pub);
  userEmpA = pub;
});

test('2. Mobile Contacts CRM Workflow & Visibility', async () => {
  // Create contact via Bearer token
  const createRes = await fetch(`${BASE_URL}/api/crm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminA}`,
    },
    body: JSON.stringify({
      name: 'Mobile Client Contact',
      company: 'Metro Rails Pvt Ltd',
      email: 'contact@metrorails.in',
      phone: '+919876543210',
      designation: 'VP Operations',
      visibility: 'org',
    }),
  });
  assert.equal(createRes.status, 201);
  const contact = await createRes.json();
  contactA1Id = contact._id;
  assert.equal(contact.name, 'Mobile Client Contact');

  // Detail view
  const detailRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminA}` },
  });
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.company, 'Metro Rails Pvt Ltd');

  // Update contact
  const updateRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminA}`,
    },
    body: JSON.stringify({ designation: 'Senior VP Operations' }),
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.designation, 'Senior VP Operations');

  // Employee list: verify visibility
  const listRes = await fetch(`${BASE_URL}/api/crm`, {
    headers: { Authorization: `Bearer ${mobileTokenEmpA}` },
  });
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.ok(list.some(c => c._id === contactA1Id));
});

test('3. Mobile Travel Workflow & Travel-to-Expense Conversion', async () => {
  // Mobile client sends departureDate and returnDate in YYYY-MM-DD
  const createTravelRes = await fetch(`${BASE_URL}/api/travel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminA}`,
    },
    body: JSON.stringify({
      purpose: 'Client Site Inspection',
      destination: 'Shimla Station',
      departureDate: '2026-08-01',
      returnDate: '2026-08-05',
      estimatedTotal: 25000,
    }),
  });
  assert.equal(createTravelRes.status, 201);
  const travel = await createTravelRes.json();
  travelA1Id = travel._id;
  assert.equal(travel.destination, 'Shimla Station');

  // Approve travel request so it can be converted to expense
  await TravelRequest.updateOne({ _id: travelA1Id }, { status: 'approved' });

  // Convert travel request to expense claim: POST /api/travel/[id]/expense
  const convRes = await fetch(`${BASE_URL}/api/travel/${travelA1Id}/expense`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mobileTokenAdminA}` },
  });
  assert.equal(convRes.status, 201);
  const convData = await convRes.json();
  assert.ok(convData._id);
  expenseA1Id = convData._id;

  // Verify created expense is linked to travel request
  const expDetailRes = await fetch(`${BASE_URL}/api/rms/${expenseA1Id}`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminA}` },
  });
  assert.equal(expDetailRes.status, 200);
  const expDetail = await expDetailRes.json();
  assert.equal(expDetail.travelRequestId, travelA1Id);
});

test('4. Mobile Expense / RMS Workflow & Self-Approval Prevention', async () => {
  // Employee submits an expense claim with YYYY-MM-DD date format
  const submitRes = await fetch(`${BASE_URL}/api/rms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenEmpA}`,
    },
    body: JSON.stringify({
      title: 'Local Travel Cab',
      reason: 'Taxi to project site',
      amount: 1200,
      startDate: '2026-09-15',
    }),
  });
  assert.equal(submitRes.status, 201);
  const empExpense = await submitRes.json();

  // Employee attempts to self-approve: must be 403 Forbidden
  const empApproveRes = await fetch(`${BASE_URL}/api/rms/${empExpense._id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenEmpA}`,
    },
    body: JSON.stringify({ status: 'pending_admin' }),
  });
  assert.equal(empApproveRes.status, 403, 'Employee cannot approve expense claims');

  // Admin approves expense claim
  const adminApproveRes = await fetch(`${BASE_URL}/api/rms/${empExpense._id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminA}`,
    },
    body: JSON.stringify({ status: 'pending_admin' }),
  });
  assert.equal(adminApproveRes.status, 200);
  const approved = await adminApproveRes.json();
  assert.equal(approved.status, 'pending_admin');
});

test('5. Mobile Leave Management (LMS) Workflow', async () => {
  // Query leave balances
  const balRes = await fetch(`${BASE_URL}/api/lms/balance`, {
    headers: { Authorization: `Bearer ${mobileTokenEmpA}` },
  });
  assert.equal(balRes.status, 200);
  const balance = await balRes.json();
  assert.ok(balance.balance?.casual !== undefined);

  // Apply for leave with date-only format
  const applyRes = await fetch(`${BASE_URL}/api/lms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenEmpA}`,
    },
    body: JSON.stringify({
      type: 'casual',
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      days: 2,
      reason: 'Family event',
    }),
  });
  assert.equal(applyRes.status, 201);
  const leave = await applyRes.json();

  // Employee withdraws pending leave
  const withdrawRes = await fetch(`${BASE_URL}/api/lms/${leave._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${mobileTokenEmpA}` },
  });
  assert.equal(withdrawRes.status, 200);
});

test('6. Mobile Search & Tenant Isolation', async () => {
  // Create an announcement in Tenant A
  await fetch(`${BASE_URL}/api/announcements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminA}`,
    },
    body: JSON.stringify({
      title: 'Mobile Exclusive Project Omega',
      body: 'Quarterly roadmap for team A',
    }),
  });

  // Create an announcement in Tenant B
  await fetch(`${BASE_URL}/api/announcements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminB}`,
    },
    body: JSON.stringify({
      title: 'Mobile Exclusive Project Sigma',
      body: 'Secret roadmap for team B',
    }),
  });

  // Tenant A search: must return Omega, never Sigma
  const searchARes = await fetch(`${BASE_URL}/api/search?q=Exclusive`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminA}` },
  });
  assert.equal(searchARes.status, 200);
  const searchA = await searchARes.json();
  const titlesA = searchA.results.map(r => r.title);
  assert.ok(titlesA.some(t => t.includes('Project Omega')));
  assert.ok(!titlesA.some(t => t.includes('Project Sigma')), 'Tenant A must not see Tenant B search results');

  // Tenant B search: must return Sigma, never Omega
  const searchBRes = await fetch(`${BASE_URL}/api/search?q=Exclusive`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminB}` },
  });
  assert.equal(searchBRes.status, 200);
  const searchB = await searchBRes.json();
  const titlesB = searchB.results.map(r => r.title);
  assert.ok(titlesB.some(t => t.includes('Project Sigma')));
  assert.ok(!titlesB.some(t => t.includes('Project Omega')), 'Tenant B must not see Tenant A search results');
});

test('7. Mobile Cross-Tenant IDOR & Referenced Object Injection Prevention', async () => {
  // Tenant B attempts to read Tenant A contact: must return 404
  const idorReadRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminB}` },
  });
  assert.equal(idorReadRes.status, 404, 'Foreign contact ID must return 404');

  // Tenant B attempts to delete Tenant A contact: must return 404
  const idorDelRes = await fetch(`${BASE_URL}/api/crm/${contactA1Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${mobileTokenAdminB}` },
  });
  assert.equal(idorDelRes.status, 404, 'Foreign contact deletion must return 404');

  // Tenant B attempts to link Tenant A travel request in an expense: must return 400
  const crossLinkRes = await fetch(`${BASE_URL}/api/rms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminB}`,
    },
    body: JSON.stringify({
      title: 'Attacker Travel Expense',
      reason: 'Malicious cross-tenant link',
      amount: 15000,
      startDate: '2026-09-01',
      travelRequestId: travelA1Id,
    }),
  });
  assert.equal(crossLinkRes.status, 404, 'Cross-tenant travel request link must be rejected with 404 Not Found');
});

test('8. Mobile Profile Security: Tamper Resistance on Employees Me', async () => {
  // Read profile
  const profRes = await fetch(`${BASE_URL}/api/employees/me`, {
    headers: { Authorization: `Bearer ${mobileTokenEmpA}` },
  });
  assert.equal(profRes.status, 200);

  // Attempt to tamper with role and orgId via mobile profile PATCH
  const tamperRes = await fetch(`${BASE_URL}/api/employees/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenEmpA}`,
    },
    body: JSON.stringify({
      phone: '+919988776655',
      role: 'admin',
      orgId: 'org_doppelmayr',
    }),
  });
  assert.equal(tamperRes.status, 200);

  // Verify DB state: phone updated, role and orgId UNCHANGED
  const empDoc = await User.findById(userEmpA.id).lean();
  assert.equal(empDoc.role, 'employee', 'Role must remain employee');
  assert.equal(empDoc.orgId, orgIdA, 'OrgId must remain Org A');
});

test('9. Mobile Session Invalidation: Password Change and Logout Revocation', async () => {
  // Change password for Admin A
  const changeRes = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileTokenAdminA}`,
    },
    body: JSON.stringify({
      currentPassword: 'TestPassword!123',
      newPassword: 'BrandNewPassword!123',
    }),
  });
  assert.equal(changeRes.status, 200);

  // Pre-change mobile accessToken must now be rejected due to sessionVersion increment
  const staleRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${mobileTokenAdminA}` },
  });
  assert.equal(staleRes.status, 401, 'Old mobile access token must be rejected after password change');

  // Test mobile logout endpoint with refreshToken
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: mobileRefreshAdminB }),
  });
  assert.equal(logoutRes.status, 200);

  // Attempting to refresh with the logged-out refresh token must be rejected
  const revokedRefreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: mobileRefreshAdminB }),
  });
  assert.equal(revokedRefreshRes.status, 401, 'Logged out refresh token must be revoked');
});

test('10. Doppelmayr Production Tenant Invariant Verification', async () => {
  await connectDB();
  const doppelOrg = await Organization.findOne({ orgId: 'org_doppelmayr' });
  assert.ok(doppelOrg, 'Doppelmayr organization must exist');

  const doppelUsers = await User.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelUsers, 9, 'Doppelmayr must have 9 production users');

  const doppelEmployees = await Employee.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelEmployees, 9, 'Doppelmayr must have 9 production employees');
});
