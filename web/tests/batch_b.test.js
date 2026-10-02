const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';
process.env.MONGODB_URI = MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ==';

// Use jiti with alias to import TypeScript modules
const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});
const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const Leave = jiti(path.resolve(__dirname, '../models/Leave.ts')).default;
const Expense = jiti(path.resolve(__dirname, '../models/Expense.ts')).default;
const Contact = jiti(path.resolve(__dirname, '../models/Contact.ts')).default;
const Announcement = jiti(path.resolve(__dirname, '../models/Announcement.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const { signToken } = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));
const { writeAudit } = jiti(path.resolve(__dirname, '../lib/audit.ts'));
const { getUserById, updateUser } = jiti(path.resolve(__dirname, '../lib/auth/userService.ts'));
const { getAnnouncementRecipients, getBirthdayNotificationRecipients } = jiti(path.resolve(__dirname, '../lib/cron-recipients.ts'));

const ORG_A = 'org_test_batchb_a_' + Date.now();
const ORG_B = 'org_test_batchb_b_' + Date.now();

let adminA, empA, tokenAdminA, tokenEmpA;
let adminB, empB, tokenAdminB, tokenEmpB;

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }

  // Seed Tenant A users
  adminA = await User.create({
    email: `admin_a_${Date.now()}@tenant-a.test`,
    passwordHash: 'dummy_hash',
    firstName: 'Admin',
    lastName: 'TenantA',
    role: 'admin',
    orgId: ORG_A,
    permissions: ['all'],
    isActive: true,
    isBanned: false,
  });

  empA = await User.create({
    email: `emp_a_${Date.now()}@tenant-a.test`,
    passwordHash: 'dummy_hash',
    firstName: 'Employee',
    lastName: 'TenantA',
    role: 'employee',
    orgId: ORG_A,
    permissions: ['lms.apply'],
    isActive: true,
    isBanned: false,
  });

  await Employee.create({
    clerkUserId: String(empA._id),
    employeeId: 'EMP-BA-' + Date.now(),
    createdByUserId: String(adminA._id),
    firstName: 'Employee',
    lastName: 'TenantA',
    email: empA.email,
    department: 'Engineering_A',
    designation: 'Engineer A',
    orgId: ORG_A,
    joiningDate: new Date(),
  });

  // Seed Tenant B users
  adminB = await User.create({
    email: `admin_b_${Date.now()}@tenant-b.test`,
    passwordHash: 'dummy_hash',
    firstName: 'Admin',
    lastName: 'TenantB',
    role: 'admin',
    orgId: ORG_B,
    permissions: ['all'],
    isActive: true,
    isBanned: false,
  });

  empB = await User.create({
    email: `emp_b_${Date.now()}@tenant-b.test`,
    passwordHash: 'dummy_hash',
    firstName: 'Employee',
    lastName: 'TenantB',
    role: 'employee',
    orgId: ORG_B,
    permissions: ['rms.apply'],
    isActive: true,
    isBanned: false,
  });

  await Employee.create({
    clerkUserId: String(empB._id),
    employeeId: 'EMP-BB-' + Date.now(),
    createdByUserId: String(adminB._id),
    firstName: 'Employee',
    lastName: 'TenantB',
    email: empB.email,
    department: 'Engineering_B',
    designation: 'Engineer B',
    orgId: ORG_B,
    joiningDate: new Date(),
  });

  // Generate valid JWT tokens for both tenants
  tokenAdminA = await signToken({
    id: String(adminA._id),
    orgId: ORG_A,
    email: adminA.email,
    role: adminA.role,
    firstName: adminA.firstName,
    lastName: adminA.lastName,
    fullName: `${adminA.firstName} ${adminA.lastName}`,
    permissions: adminA.permissions,
    isActive: true,
    isBanned: false,
    mustChangePassword: false,
  });

  tokenEmpA = await signToken({
    id: String(empA._id),
    orgId: ORG_A,
    email: empA.email,
    role: empA.role,
    firstName: empA.firstName,
    lastName: empA.lastName,
    fullName: `${empA.firstName} ${empA.lastName}`,
    permissions: empA.permissions,
    isActive: true,
    isBanned: false,
    mustChangePassword: false,
  });

  tokenAdminB = await signToken({
    id: String(adminB._id),
    orgId: ORG_B,
    email: adminB.email,
    role: adminB.role,
    firstName: adminB.firstName,
    lastName: adminB.lastName,
    fullName: `${adminB.firstName} ${adminB.lastName}`,
    permissions: adminB.permissions,
    isActive: true,
    isBanned: false,
    mustChangePassword: false,
  });

  tokenEmpB = await signToken({
    id: String(empB._id),
    orgId: ORG_B,
    email: empB.email,
    role: empB.role,
    firstName: empB.firstName,
    lastName: empB.lastName,
    fullName: `${empB.firstName} ${empB.lastName}`,
    permissions: empB.permissions,
    isActive: true,
    isBanned: false,
    mustChangePassword: false,
  });
});

test('1. Admin A can GET own User A, but cannot GET Admin B or User B (404 isolation)', async () => {
  // Admin A GET own employee A -> 200 OK
  const resOwn = await fetch(`${BASE_URL}/api/admin/users/${empA._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resOwn.status, 200);
  const ownData = await resOwn.json();
  assert.equal(ownData.user.id, String(empA._id));
  assert.equal(ownData.user.orgId, ORG_A);

  // Admin A GET Admin B -> 404 Not Found (safe: does not reveal target existence)
  const resAdminB = await fetch(`${BASE_URL}/api/admin/users/${adminB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resAdminB.status, 404);
  const errAdminB = await resAdminB.json();
  assert.equal(errAdminB.error, 'Not found');

  // Admin A GET Employee B -> 404 Not Found
  const resEmpB = await fetch(`${BASE_URL}/api/admin/users/${empB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resEmpB.status, 404);

  // Reverse: Admin B GET Employee A -> 404 Not Found
  const resReverse = await fetch(`${BASE_URL}/api/admin/users/${empA._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminB}` },
  });
  assert.equal(resReverse.status, 404);
});

test('2. Admin A cannot PATCH User B (404 and no modifications made)', async () => {
  const originalName = empB.firstName;
  const res = await fetch(`${BASE_URL}/api/admin/users/${empB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ firstName: 'HACKED_BY_ADMIN_A' }),
  });

  assert.equal(res.status, 404);

  // DB check: Verify User B in Tenant B was completely untouched
  const checkEmpB = await User.findById(empB._id).lean();
  assert.equal(checkEmpB.firstName, originalName);
});

test('3. Admin A cannot change Admin B or User B role', async () => {
  const originalRole = empB.role;
  const res = await fetch(`${BASE_URL}/api/admin/users/${empB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'admin' }),
  });

  assert.equal(res.status, 404);

  // Verify role did not change
  const checkEmpB = await User.findById(empB._id).lean();
  assert.equal(checkEmpB.role, originalRole);
});

test('4. Admin A cannot modify Admin B or User B permissions', async () => {
  const originalPerms = empB.permissions;
  const res = await fetch(`${BASE_URL}/api/admin/users/${empB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ permissions: ['all', 'admin.super'] }),
  });

  assert.equal(res.status, 404);

  // Verify permissions did not change
  const checkEmpB = await User.findById(empB._id).lean();
  assert.deepEqual(checkEmpB.permissions, originalPerms);
});

test('5. Admin A cannot ban Admin B or User B', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/users/${empB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ banned: true }),
  });

  assert.equal(res.status, 404);

  // Verify banned state did not change
  const checkEmpB = await User.findById(empB._id).lean();
  assert.equal(checkEmpB.isBanned, false);
});

test('6. Admin A cannot delete Admin B or User B', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/users/${empB._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });

  assert.equal(res.status, 404);

  // Verify User B still exists in database
  const checkEmpB = await User.findById(empB._id).lean();
  assert.ok(checkEmpB, 'User B must still exist in DB');
  assert.equal(checkEmpB.orgId, ORG_B);
});

test('7. Analytics A contains ONLY Tenant A data and zero Tenant B data', async () => {
  // Create distinct leaves/expenses for Tenant A and Tenant B
  await Leave.create({
    userId: String(empA._id),
    userName: 'TenantA_UniqueEmployee',
    orgId: ORG_A,
    type: 'casual',
    days: 3,
    status: 'approved',
    startDate: new Date(),
    endDate: new Date(),
    reason: 'Tenant A Reason',
  });

  await Leave.create({
    userId: String(empB._id),
    userName: 'TenantB_UniqueEmployee',
    orgId: ORG_B,
    type: 'sick',
    days: 5,
    status: 'approved',
    startDate: new Date(),
    endDate: new Date(),
    reason: 'Tenant B Reason',
  });

  const res = await fetch(`${BASE_URL}/api/analytics/software`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  // Summary counts must reflect only Tenant A
  assert.equal(data.summary.totalUsers, 2, 'Tenant A has exactly 2 users (Admin A + Emp A)');

  // Verify user list has no Tenant B records
  const emails = data.users.map(u => u.email);
  assert.ok(emails.includes(adminA.email));
  assert.ok(emails.includes(empA.email));
  assert.ok(!emails.includes(adminB.email), 'Admin B must NOT appear in Tenant A analytics');
  assert.ok(!emails.includes(empB.email), 'Employee B must NOT appear in Tenant A analytics');

  const names = data.users.map(u => u.name);
  assert.ok(!names.some(n => n.includes('TenantB')), 'Tenant B names must not appear in Tenant A analytics');
});

test('8. Analytics B contains ONLY Tenant B data and zero Tenant A data', async () => {
  const res = await fetch(`${BASE_URL}/api/analytics/software`, {
    headers: { Authorization: `Bearer ${tokenAdminB}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.summary.totalUsers, 2, 'Tenant B has exactly 2 users (Admin B + Emp B)');

  const emails = data.users.map(u => u.email);
  assert.ok(emails.includes(adminB.email));
  assert.ok(emails.includes(empB.email));
  assert.ok(!emails.includes(adminA.email), 'Admin A must NOT appear in Tenant B analytics');
  assert.ok(!emails.includes(empA.email), 'Employee A must NOT appear in Tenant B analytics');

  const names = data.users.map(u => u.name);
  assert.ok(!names.some(n => n.includes('TenantA')), 'Tenant A names must not appear in Tenant B analytics');
});

test('9. Cron recipient selection never crosses organizations', async () => {
  // Verify Announcement recipient isolation
  const recipientsA = await getAnnouncementRecipients(ORG_A);
  const recipientsB = await getAnnouncementRecipients(ORG_B);

  assert.ok(recipientsA.includes(adminA.email));
  assert.ok(recipientsA.includes(empA.email));
  assert.ok(!recipientsA.includes(adminB.email), 'Recipient list A must never contain Tenant B admin');
  assert.ok(!recipientsA.includes(empB.email), 'Recipient list A must never contain Tenant B employee');

  assert.ok(recipientsB.includes(adminB.email));
  assert.ok(recipientsB.includes(empB.email));
  assert.ok(!recipientsB.includes(adminA.email), 'Recipient list B must never contain Tenant A admin');
  assert.ok(!recipientsB.includes(empA.email), 'Recipient list B must never contain Tenant A employee');

  // Verify Birthday manager/admin recipient isolation
  const birthdayRecipientsA = await getBirthdayNotificationRecipients(ORG_A);
  const birthdayRecipientsB = await getBirthdayNotificationRecipients(ORG_B);

  assert.ok(birthdayRecipientsA.includes(adminA.email));
  assert.ok(!birthdayRecipientsA.includes(adminB.email), 'Birthday alert A must never notify Tenant B admin');
  assert.ok(!birthdayRecipientsA.includes(empA.email), 'Regular employees should not receive manager birthday alerts');

  assert.ok(birthdayRecipientsB.includes(adminB.email));
  assert.ok(!birthdayRecipientsB.includes(adminA.email), 'Birthday alert B must never notify Tenant A admin');
});

test('10. Audit records strictly preserve exact organization context', async () => {
  // Perform an audited action in Tenant A
  await writeAudit({
    action: 'user.permissions_changed',
    performedBy: String(adminA._id),
    performedByName: 'Admin TenantA',
    targetId: String(empA._id),
    targetType: 'user',
    metadata: { permissions: ['lms.apply', 'lms.approve'] },
    orgId: ORG_A,
  });

  // Verify audit log document
  const logA = await AuditLog.findOne({ orgId: ORG_A, action: 'user.permissions_changed' }).lean();
  assert.ok(logA, 'Audit log entry for Tenant A must exist');
  assert.equal(logA.orgId, ORG_A);
  assert.equal(logA.performedBy, String(adminA._id));
  assert.equal(logA.targetId, String(empA._id));

  // Query Tenant B audit logs — must be completely empty of Tenant A's events
  const logB = await AuditLog.find({ orgId: ORG_B }).lean();
  assert.equal(logB.length, 0, 'Tenant B audit log must have zero records from Tenant A');
});

test('11. Regex sanitization in search endpoint prevents ReDoS and syntax errors', async () => {
  const dangerousQuery = '.*+?^${}()|[]\\';
  const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(dangerousQuery)}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });

  // Must not crash or return 500
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.results));
});

test('12. Admin A cannot GET or PATCH LeaveBalance of User B', async () => {
  // GET User B balance with Admin A token -> 404
  const resGet = await fetch(`${BASE_URL}/api/admin/balances/${empB._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resGet.status, 404);

  // PATCH User B balance with Admin A token -> 404
  const resPatch = await fetch(`${BASE_URL}/api/admin/balances/${empB._id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ casual: 25 }),
  });
  assert.equal(resPatch.status, 404);

  // Verify no balance was upserted for User B under ORG_A or ORG_B by Admin A
  const checkBal = await LeaveBalance.findOne({ userId: String(empB._id), casual: 25 }).lean();
  assert.equal(checkBal, null, 'No balance change should have occurred');
});

test.after(async () => {
  // Clean up all test tenant records
  const userIds = [adminA?._id, adminB?._id, empA?._id, empB?._id].filter(Boolean).map(String);
  await Organization.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await OrgSettings.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await User.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await Employee.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await Leave.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await Expense.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await Contact.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await Announcement.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await AuditLog.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  await LeaveBalance.deleteMany({ orgId: { $in: [ORG_A, ORG_B] } });
  if (userIds.length > 0) {
    await RefreshToken.deleteMany({ userId: { $in: userIds } });
  }
  await mongoose.disconnect();
});

