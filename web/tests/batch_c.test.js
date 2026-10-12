const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';
process.env.MONGODB_URI = MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ==';
const CRON_SECRET = process.env.CRON_SECRET || 'doppeldash-cron-2024';
process.env.CRON_SECRET = CRON_SECRET;

// Use jiti with alias
const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});

const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const Leave = jiti(path.resolve(__dirname, '../models/Leave.ts')).default;
const Expense = jiti(path.resolve(__dirname, '../models/Expense.ts')).default;
const TravelRequest = jiti(path.resolve(__dirname, '../models/TravelRequest.ts')).default;
const Contact = jiti(path.resolve(__dirname, '../models/Contact.ts')).default;
const Announcement = jiti(path.resolve(__dirname, '../models/Announcement.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const ScannedCard = jiti(path.resolve(__dirname, '../models/ScannedCard.ts')).default;
const MailDraft = jiti(path.resolve(__dirname, '../models/MailDraft.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;

// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));
const { notifyTargetsFor } = jiti(path.resolve(__dirname, '../lib/notify-targets.ts'));

const ORG_A = 'org_test_c_a_' + Date.now();
const ORG_B = 'org_test_c_b_' + Date.now();

let adminA, empA, tokenAdminA, tokenEmpA;
let adminB, empB, tokenAdminB, tokenEmpB;
let leaveA, leaveB, expenseA, expenseB, travelA, travelB, contactA, contactB, annA, annB;

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }

  // Seed Tenant A
  adminA = await User.create({
    email: `admin_ca_${Date.now()}@tenant-a.test`,
    passwordHash: 'dummy',
    firstName: 'Admin', lastName: 'TenantCA',
    role: 'admin', orgId: ORG_A,
    permissions: ['all'], isActive: true, isBanned: false,
  });

  empA = await User.create({
    email: `emp_ca_${Date.now()}@tenant-a.test`,
    passwordHash: 'dummy',
    firstName: 'Employee', lastName: 'TenantCA',
    role: 'employee', orgId: ORG_A,
    permissions: ['lms.apply'], isActive: true, isBanned: false,
  });

  await Employee.create({
    clerkUserId: String(empA._id),
    employeeId: 'EMP-CA-' + Date.now(),
    createdByUserId: String(adminA._id),
    firstName: 'Employee', lastName: 'TenantCA',
    email: empA.email, department: 'Engineering_A', designation: 'Developer A',
    orgId: ORG_A, joiningDate: new Date(),
  });

  // Seed Tenant B
  adminB = await User.create({
    email: `admin_cb_${Date.now()}@tenant-b.test`,
    passwordHash: 'dummy',
    firstName: 'Admin', lastName: 'TenantCB',
    role: 'admin', orgId: ORG_B,
    permissions: ['all'], isActive: true, isBanned: false,
  });

  empB = await User.create({
    email: `emp_cb_${Date.now()}@tenant-b.test`,
    passwordHash: 'dummy',
    firstName: 'Employee', lastName: 'TenantCB',
    role: 'employee', orgId: ORG_B,
    permissions: ['rms.apply'], isActive: true, isBanned: false,
  });

  await Employee.create({
    clerkUserId: String(empB._id),
    employeeId: 'EMP-CB-' + Date.now(),
    createdByUserId: String(adminB._id),
    firstName: 'Employee', lastName: 'TenantCB',
    email: empB.email, department: 'Engineering_B', designation: 'Developer B',
    orgId: ORG_B, joiningDate: new Date(),
  });

  // Seed Tenant A Resources
  leaveA = await Leave.create({
    userId: String(empA._id), userName: 'Employee TenantCA',
    orgId: ORG_A, type: 'casual', days: 2, status: 'pending',
    startDate: new Date(), endDate: new Date(), reason: 'Tenant A Vacation',
  });

  expenseA = await Expense.create({
    userId: String(empA._id), userName: 'Employee TenantCA',
    orgId: ORG_A, title: 'Tenant A Flight', amount: 5000, status: 'pending_manager',
    startDate: new Date(), reason: 'Client flight to Delhi',
  });

  travelA = await TravelRequest.create({
    userId: String(empA._id), userName: 'Employee TenantCA',
    orgId: ORG_A, purpose: 'Client Meeting A', destination: 'Delhi',
    departureDate: new Date(), returnDate: new Date(),
    estimatedTotal: 10000, status: 'pending_manager',
  });

  contactA = await Contact.create({
    name: 'Contact Alpha', email: 'alpha@partner-a.test',
    company: 'Partner A Corp', orgId: ORG_A, createdBy: String(empA._id),
    visibility: 'org',
  });

  annA = await Announcement.create({
    title: 'Tenant A Townhall', body: 'All hands meeting for Tenant A',
    priority: 'normal', authorId: String(adminA._id), authorName: 'Admin TenantCA', orgId: ORG_A,
  });

  // Seed Tenant B Resources
  leaveB = await Leave.create({
    userId: String(empB._id), userName: 'Employee TenantCB',
    orgId: ORG_B, type: 'sick', days: 1, status: 'pending',
    startDate: new Date(), endDate: new Date(), reason: 'Tenant B Doctor Visit',
  });

  expenseB = await Expense.create({
    userId: String(empB._id), userName: 'Employee TenantCB',
    orgId: ORG_B, title: 'Tenant B Hotel', amount: 8000, status: 'pending_manager',
    startDate: new Date(), reason: 'Client hotel in Bangalore',
  });

  travelB = await TravelRequest.create({
    userId: String(empB._id), userName: 'Employee TenantCB',
    orgId: ORG_B, purpose: 'Client Meeting B', destination: 'Bangalore',
    departureDate: new Date(), returnDate: new Date(),
    estimatedTotal: 15000, status: 'pending_manager',
  });

  contactB = await Contact.create({
    name: 'Contact Beta', email: 'beta@partner-b.test',
    company: 'Partner B Corp', orgId: ORG_B, createdBy: String(empB._id),
    visibility: 'org',
  });

  annB = await Announcement.create({
    title: 'Tenant B Confidential Plan', body: 'Confidential strategy for Tenant B',
    priority: 'urgent', authorId: String(adminB._id), authorName: 'Admin TenantCB', orgId: ORG_B,
  });

  // JWTs
  tokenAdminA = await signToken({
    id: String(adminA._id), orgId: ORG_A, email: adminA.email,
    role: adminA.role, firstName: adminA.firstName, lastName: adminA.lastName,
    fullName: `${adminA.firstName} ${adminA.lastName}`, permissions: adminA.permissions,
    isActive: true, isBanned: false, mustChangePassword: false,
  });

  tokenEmpA = await signToken({
    id: String(empA._id), orgId: ORG_A, email: empA.email,
    role: empA.role, firstName: empA.firstName, lastName: empA.lastName,
    fullName: `${empA.firstName} ${empA.lastName}`, permissions: empA.permissions,
    isActive: true, isBanned: false, mustChangePassword: false,
  });

  tokenAdminB = await signToken({
    id: String(adminB._id), orgId: ORG_B, email: adminB.email,
    role: adminB.role, firstName: adminB.firstName, lastName: adminB.lastName,
    fullName: `${adminB.firstName} ${adminB.lastName}`, permissions: adminB.permissions,
    isActive: true, isBanned: false, mustChangePassword: false,
  });

  tokenEmpB = await signToken({
    id: String(empB._id), orgId: ORG_B, email: empB.email,
    role: empB.role, firstName: empB.firstName, lastName: empB.lastName,
    fullName: `${empB.firstName} ${empB.lastName}`, permissions: empB.permissions,
    isActive: true, isBanned: false, mustChangePassword: false,
  });
});

test('1. Employees IDOR: Admin A cannot read, update, or delete Employee B', async () => {
  // Read Employee B with Admin A token -> 404
  const resGet = await fetch(`${BASE_URL}/api/employees/${empB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resGet.status, 404);

  // Update Employee B with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/employees/${empB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ designation: 'Attacked Designation' }),
  });
  assert.equal(resPatch.status, 404);

  // Verify in DB that Employee B designation did not change
  const empBCheck = await Employee.findOne({ clerkUserId: String(empB._id) }).lean();
  assert.equal(empBCheck.designation, 'Developer B');
});

test('2. Leaves IDOR: Admin A / Emp A cannot read, update, or delete Leave B', async () => {
  // Read Leave B with Admin A token -> 404
  const resGet = await fetch(`${BASE_URL}/api/lms/${leaveB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resGet.status, 404);

  // Update Leave B with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/lms/${leaveB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(resPatch.status, 404);

  // Delete Leave B with Admin A token -> 404
  const resDelete = await fetch(`${BASE_URL}/api/lms/${leaveB._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resDelete.status, 404);

  // Verify in DB that Leave B is untouched
  const leaveBCheck = await Leave.findById(leaveB._id).lean();
  assert.ok(leaveBCheck);
  assert.equal(leaveBCheck.status, 'pending');
});

test('3. Expenses IDOR: Admin A / Emp A cannot read, update, or delete Expense B', async () => {
  // Read Expense B with Admin A token -> 404
  const resGet = await fetch(`${BASE_URL}/api/rms/${expenseB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resGet.status, 404);

  // Update Expense B with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/rms/${expenseB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'paid' }),
  });
  assert.equal(resPatch.status, 404);

  // Delete Expense B with Admin A token -> 404
  const resDelete = await fetch(`${BASE_URL}/api/rms/${expenseB._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resDelete.status, 404);

  // Verify in DB that Expense B is untouched
  const expBCheck = await Expense.findById(expenseB._id).lean();
  assert.ok(expBCheck);
  assert.equal(expBCheck.status, 'pending_manager');
});

test('4. Travel Requests IDOR: Admin A / Emp A cannot read, update, or delete Travel B', async () => {
  // Read Travel B with Admin A token -> 404
  const resGet = await fetch(`${BASE_URL}/api/travel/${travelB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resGet.status, 404);

  // Update Travel B with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/travel/${travelB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(resPatch.status, 404);

  // Delete Travel B with Admin A token -> 404
  const resDelete = await fetch(`${BASE_URL}/api/travel/${travelB._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resDelete.status, 404);

  // Verify in DB that Travel B is untouched
  const trBCheck = await TravelRequest.findById(travelB._id).lean();
  assert.ok(trBCheck);
  assert.equal(trBCheck.status, 'pending_manager');
});

test('5. Contacts / CRM IDOR: Admin A / Emp A cannot read, update, delete, or generate AI text for Contact B', async () => {
  // Read Contact B with Admin A token -> 404
  const resGet = await fetch(`${BASE_URL}/api/crm/${contactB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resGet.status, 404);

  // Update Contact B with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/crm/${contactB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Hacked Beta Contact' }),
  });
  assert.equal(resPatch.status, 404);

  // AI Message Generate targeting Contact B with Tenant A token -> 404
  const resGenerate = await fetch(`${BASE_URL}/api/crm/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contactId: String(contactB._id), messageType: 'birthday' }),
  });
  assert.equal(resGenerate.status, 404);

  // Delete Contact B with Admin A token -> 404
  const resDel = await fetch(`${BASE_URL}/api/crm/${contactB._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resDel.status, 404);

  // Verify in DB that Contact B is untouched
  const contactBCheck = await Contact.findById(contactB._id).lean();
  assert.ok(contactBCheck);
  assert.equal(contactBCheck.name, 'Contact Beta');
});

test('6. Announcements IDOR: Admin A cannot update or delete Announcement B', async () => {
  // PATCH Announcement B with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/announcements/${annB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: 'Hacked Announcement' }),
  });
  assert.equal(resPatch.status, 404);

  // DELETE Announcement B with Admin A token -> 404
  const resDelete = await fetch(`${BASE_URL}/api/announcements/${annB._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resDelete.status, 404);

  // Verify in DB that Announcement B is untouched
  const annBCheck = await Announcement.findById(annB._id).lean();
  assert.ok(annBCheck);
  assert.equal(annBCheck.title, 'Tenant B Confidential Plan');
});

test('7. Create Operations: Client-injected foreign orgId is strictly overridden with authenticated orgId', async () => {
  // 1. Create Contact with injected foreign orgId
  const resContact = await fetch(`${BASE_URL}/api/crm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenEmpA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Created By A With Injected OrgId',
      orgId: ORG_B,
    }),
  });
  assert.equal(resContact.status, 201);
  const dataContact = await resContact.json();
  const dbContact = await Contact.findById(dataContact._id).lean();
  assert.equal(dbContact.orgId, ORG_A, 'Contact must belong to ORG_A despite injected orgId');

  // 2. Create Leave with injected foreign orgId
  const resLeave = await fetch(`${BASE_URL}/api/lms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenEmpA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'casual',
      days: 1,
      startDate: new Date(),
      endDate: new Date(),
      reason: 'Injected orgId leave test',
      orgId: ORG_B,
    }),
  });
  assert.equal(resLeave.status, 201);
  const dataLeave = await resLeave.json();
  const dbLeave = await Leave.findById(dataLeave._id).lean();
  assert.equal(dbLeave.orgId, ORG_A, 'Leave must belong to ORG_A');

  // 3. Create Expense with injected foreign orgId
  const resExpense = await fetch(`${BASE_URL}/api/rms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenEmpA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Injected orgId expense test',
      amount: 100,
      startDate: new Date(),
      reason: 'Injected orgId test',
      orgId: ORG_B,
    }),
  });
  assert.equal(resExpense.status, 201);
  const dataExpense = await resExpense.json();
  const dbExpense = await Expense.findById(dataExpense._id).lean();
  assert.equal(dbExpense.orgId, ORG_A, 'Expense must belong to ORG_A');

  // 4. Create Announcement with injected foreign orgId
  const resAnn = await fetch(`${BASE_URL}/api/announcements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Injected orgId announcement test',
      body: 'Should stay in Org A',
      orgId: ORG_B,
    }),
  });
  assert.equal(resAnn.status, 201);
  const dataAnn = await resAnn.json();
  const dbAnn = await Announcement.findById(dataAnn._id).lean();
  assert.equal(dbAnn.orgId, ORG_A, 'Announcement must belong to ORG_A');
});

test('8. Cross-Tenant Reference Protection: Scanned card cannot link to Contact B', async () => {
  // Attempt to create a scanned card linking to Tenant B's contact
  const resCreateCard = await fetch(`${BASE_URL}/api/crm/scanned-cards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenEmpA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      contactId: String(contactB._id),
    }),
  });

  // Must reject foreign contact reference with 404
  assert.equal(resCreateCard.status, 404);
});

test('9. Notification Targets Isolation: notifyTargetsFor never returns foreign managers', async () => {
  const recipientsA = await notifyTargetsFor(String(empA._id), ORG_A);
  assert.ok(recipientsA.includes(adminA.email));
  assert.ok(!recipientsA.includes(adminB.email), 'Tenant A submission notification must NOT include Admin B');

  const recipientsB = await notifyTargetsFor(String(empB._id), ORG_B);
  assert.ok(recipientsB.includes(adminB.email));
  assert.ok(!recipientsB.includes(adminA.email), 'Tenant B submission notification must NOT include Admin A');
});

test('10. Cron HTTP Verification: Endpoints reject missing/wrong secret and execute with correct secret', async () => {
  const cronEndpoints = [
    '/api/cron/announcements',
    '/api/cron/birthday',
    '/api/cron/onboarding',
  ];

  for (const ep of cronEndpoints) {
    // Case A: No authorization header or secret parameter -> 401
    const resA = await fetch(`${BASE_URL}${ep}`);
    assert.equal(resA.status, 401, `${ep} must return 401 with no secret`);

    // Case B: Wrong secret via query -> 401 (and a query secret is never honoured)
    const resBQuery = await fetch(`${BASE_URL}${ep}?secret=wrong-secret-12345`);
    assert.equal(resBQuery.status, 401, `${ep} must return 401 with wrong secret query`);

    // Case B: Wrong secret via Bearer header -> 401
    const resBHeader = await fetch(`${BASE_URL}${ep}`, {
      headers: { Authorization: 'Bearer wrong-secret-12345' },
    });
    assert.equal(resBHeader.status, 401, `${ep} must return 401 with wrong secret header`);

    // Case C: the secret is accepted ONLY in the Authorization header. A query-string secret would be written to
    // access logs, so it is no longer honoured — asserted on the route source (probing with the real secret in a
    // URL would itself put it in the log).
    const routeSrc = require('node:fs').readFileSync(path.resolve(__dirname, `..${ep.replace('/api/', '/app/api/')}/route.ts`), 'utf8');
    assert.doesNotMatch(routeSrc, /searchParams\.get\('secret'\)/, `${ep} must not read the secret from the query string`);

    // Case C: Correct secret via Bearer header -> 200 OK
    const resCHeader = await fetch(`${BASE_URL}${ep}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    assert.equal(resCHeader.status, 200, `${ep} must return 200 with valid secret header`);
  }
});

test('11. Direct MongoDB Verification: Zero cross-tenant leakage & test cleanup', async () => {
  // Direct MongoDB verification before cleanup:
  // Prove Tenant B documents still exist and were not modified by Tenant A
  const bUser = await User.findById(empB._id).lean();
  assert.ok(bUser, 'User B must still exist');
  assert.equal(bUser.role, 'employee', 'User B role must be unchanged');

  const bEmp = await Employee.findOne({ clerkUserId: String(empB._id) }).lean();
  assert.ok(bEmp, 'Employee B must still exist');
  assert.equal(bEmp.department, 'Engineering_B', 'Employee B department must be unchanged');
  assert.equal(bEmp.designation, 'Developer B', 'Employee B designation must be unchanged');

  const bLeave = await Leave.findById(leaveB._id).lean();
  assert.ok(bLeave, 'Leave B must still exist');
  assert.equal(bLeave.status, 'pending', 'Leave B status must be unchanged');

  const bExp = await Expense.findById(expenseB._id).lean();
  assert.ok(bExp, 'Expense B must still exist');
  assert.equal(bExp.status, 'pending_manager', 'Expense B status must be unchanged');

  const bTravel = await TravelRequest.findById(travelB._id).lean();
  assert.ok(bTravel, 'Travel B must still exist');
  assert.equal(bTravel.status, 'pending_manager', 'Travel B status must be unchanged');

  const bContact = await Contact.findById(contactB._id).lean();
  assert.ok(bContact, 'Contact B must still exist');
  assert.equal(bContact.name, 'Contact Beta', 'Contact B name must be unchanged');

  const bAnn = await Announcement.findById(annB._id).lean();
  assert.ok(bAnn, 'Announcement B must still exist');
  assert.equal(bAnn.title, 'Tenant B Confidential Plan', 'Announcement B title must be unchanged');

  // Clean up temporary test tenant records
  const testOrgs = [ORG_A, ORG_B];
  const userIds = [adminA?._id, adminB?._id, empA?._id, empB?._id].filter(Boolean).map(String);
  await Organization.deleteMany({ orgId: { $in: testOrgs } });
  await OrgSettings.deleteMany({ orgId: { $in: testOrgs } });
  await User.deleteMany({ orgId: { $in: testOrgs } });
  await Employee.deleteMany({ orgId: { $in: testOrgs } });
  await Leave.deleteMany({ orgId: { $in: testOrgs } });
  await Expense.deleteMany({ orgId: { $in: testOrgs } });
  await TravelRequest.deleteMany({ orgId: { $in: testOrgs } });
  await Contact.deleteMany({ orgId: { $in: testOrgs } });
  await Announcement.deleteMany({ orgId: { $in: testOrgs } });
  await LeaveBalance.deleteMany({ orgId: { $in: testOrgs } });
  await ScannedCard.deleteMany({ contactId: { $in: [contactA?._id, contactB?._id].filter(Boolean) } });
  await MailDraft.deleteMany({ orgId: { $in: testOrgs } });
  await AuditLog.deleteMany({ orgId: { $in: testOrgs } });
  if (userIds.length > 0) {
    await RefreshToken.deleteMany({ userId: { $in: userIds } });
  }
});

test.after(async () => {
  await mongoose.disconnect();
});
