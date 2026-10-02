/**
 * DoppelDash — Batch J.1 Data Integrity & Test Isolation Proof Suite
 *
 * Proves that:
 * 1. Test tenant creation succeeds.
 * 2. Test data is isolated from Doppelmayr.
 * 3. Test teardown removes all test data.
 * 4. Doppelmayr counts remain unchanged after the complete test.
 * 5. Leave balances for Doppelmayr remain present and mapped to the correct users.
 * 6. No orphan LeaveBalance records can remain.
 * 7. No orphan refresh tokens remain.
 * 8. No foreign-org business records remain.
 * 9. Re-running the test suite repeatedly produces the same clean final state.
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

const {
  assertSafeTeardown,
  getDoppelmayrBaseline,
  safeTeardownTestOrg,
  auditDatabaseIntegrity,
} = require('./helpers/testSafety');

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  return mongoose.connect(MONGODB_URI);
}

let baseline = null;
let doppelmayrUsers = [];
let testOrgIdA = null;
let testAdminUserA = null;
let testEmployeeUserA = null;
let testAdminTokenA = null;
let testContactAId = null;
let ipSeq = 700;

test.before(async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // Capture baseline of Doppelmayr records before any test execution
  baseline = await getDoppelmayrBaseline(db);
  doppelmayrUsers = await db.collection('users').find({ orgId: 'org_doppelmayr' }).toArray();

  assert.equal(doppelmayrUsers.length, 9, 'Must have exactly 9 Doppelmayr users in baseline');
  assert.equal(baseline.leavebalances, 9, 'Must have exactly 9 Doppelmayr leave balances in baseline');
  assert.equal(baseline.employees, 9, 'Must have exactly 9 Doppelmayr employees in baseline');
});

test.after(async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // Ensure any active test org is safely cleaned up
  if (testOrgIdA) {
    const userIds = [testAdminUserA?._id, testEmployeeUserA?._id].filter(Boolean);
    await safeTeardownTestOrg(db, testOrgIdA, userIds);
  }

  await mongoose.disconnect();
});

test('1. Test tenant creation succeeds', async () => {
  await connectDB();
  const db = mongoose.connection.db;
  const ts = Date.now();

  // Register a test organization via public API
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `198.51.100.${(ipSeq++) % 250}`,
    },
    body: JSON.stringify({
      companyName: `J1 Isolation Test Enterprise ${ts}`,
      email: `admin_j1_${ts}@isolation-test.com`,
      password: 'Password123!',
      firstName: 'Isolation',
      lastName: 'Admin',
    }),
  });

  assert.equal(res.status, 201, 'Registration should return 201 Created');
  const regData = await res.json();
  testOrgIdA = regData.user.orgId;
  assert.ok(testOrgIdA, 'Created organization should have an orgId');
  assert.notEqual(testOrgIdA, 'org_doppelmayr', 'Test orgId must never be org_doppelmayr');

  testAdminTokenA = regData.accessToken;
  assert.ok(testAdminTokenA, 'Registration should return accessToken');

  // Verify DB state for new tenant
  const orgDoc = await Organization.findOne({ orgId: testOrgIdA }).lean();
  assert.ok(orgDoc, 'Organization doc must exist');

  testAdminUserA = await User.findOne({ email: `admin_j1_${ts}@isolation-test.com` }).lean();
  assert.ok(testAdminUserA, 'Admin user doc must exist');
  assert.equal(testAdminUserA.orgId, testOrgIdA);
  assert.equal(testAdminUserA.role, 'admin');

  const empDoc = await Employee.findOne({ clerkUserId: String(testAdminUserA._id) }).lean();
  assert.ok(empDoc, 'Employee doc must exist for admin');
  assert.equal(empDoc.orgId, testOrgIdA);

  const balDoc = await LeaveBalance.findOne({ userId: String(testAdminUserA._id) }).lean();
  assert.ok(balDoc, 'LeaveBalance doc must exist for admin');
  assert.equal(balDoc.orgId, testOrgIdA);
  assert.equal(balDoc.year, new Date().getFullYear());

  // Create second user (employee) in this test tenant
  testEmployeeUserA = await User.create({
    email: `employee_j1_${ts}@isolation-test.com`,
    passwordHash: 'dummy_hash',
    firstName: 'Isolation',
    lastName: 'Employee',
    role: 'employee',
    orgId: testOrgIdA,
    permissions: ['rms.apply', 'lms.apply'],
    isActive: true,
    isBanned: false,
    sessionVersion: 1,
  });

  await Employee.create({
    clerkUserId: String(testEmployeeUserA._id),
    employeeId: `EMP-J1-${ts}`,
    createdByUserId: String(testAdminUserA._id),
    firstName: 'Isolation',
    lastName: 'Employee',
    email: testEmployeeUserA.email,
    department: 'Testing',
    designation: 'QA Engineer',
    orgId: testOrgIdA,
    joiningDate: new Date(),
  });

  await LeaveBalance.create({
    orgId: testOrgIdA,
    userId: String(testEmployeeUserA._id),
    year: new Date().getFullYear(),
    casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0,
  });

  // Create business records under test tenant: Contact, Expense, Leave, TravelRequest, Announcement
  const testContact = await Contact.create({
    orgId: testOrgIdA,
    createdBy: String(testAdminUserA._id),
    name: 'J1 Test Contact Alpha',
    company: 'Alpha Partner Corp',
    email: `alpha_${ts}@partner.com`,
    phone: '+1 555 0100',
    type: 'partner',
    status: 'lead',
  });
  testContactAId = String(testContact._id);

  await Expense.create({
    orgId: testOrgIdA,
    userId: String(testEmployeeUserA._id),
    userName: 'Isolation Employee',
    title: 'Test Software Subscription',
    reason: 'Monthly software tooling',
    startDate: new Date(),
    amount: 199,
    category: 'software',
    status: 'pending_manager',
    expenseDate: new Date(),
  });

  await Leave.create({
    orgId: testOrgIdA,
    userId: String(testEmployeeUserA._id),
    userName: 'Isolation Employee',
    type: 'casual',
    startDate: new Date(),
    endDate: new Date(),
    days: 1,
    status: 'pending',
    reason: 'Personal test appointment',
  });

  await TravelRequest.create({
    orgId: testOrgIdA,
    userId: String(testEmployeeUserA._id),
    userName: 'Isolation Employee',
    purpose: 'Team planning sprint',
    destination: 'Berlin Office',
    departureDate: new Date(),
    returnDate: new Date(Date.now() + 86400000 * 3),
    estimatedTotal: 850,
    status: 'pending_manager',
  });

  await Announcement.create({
    orgId: testOrgIdA,
    authorId: String(testAdminUserA._id),
    authorName: 'Isolation Admin',
    title: 'Tenant A Welcome Note',
    body: 'Welcome to Isolation Test Tenant!',
    priority: 'normal',
  });

  // Verify test records created with testOrgIdA
  const testContactCount = await Contact.countDocuments({ orgId: testOrgIdA });
  assert.equal(testContactCount, 1, 'Should have created 1 test contact');
  const testBalanceCount = await LeaveBalance.countDocuments({ orgId: testOrgIdA });
  assert.equal(testBalanceCount, 2, 'Should have created 2 test leave balances');
});

test('2. Test data is isolated from Doppelmayr', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // 1. Query contacts using Test Tenant Admin token
  const resContacts = await fetch(`${BASE_URL}/api/crm`, {
    headers: { Authorization: `Bearer ${testAdminTokenA}` },
  });
  assert.equal(resContacts.status, 200);
  const contactsData = await resContacts.json();
  const returnedContacts = Array.isArray(contactsData) ? contactsData : (contactsData.contacts || contactsData.results || []);
  assert.ok(Array.isArray(returnedContacts), 'Should return contacts array');
  assert.equal(returnedContacts.length, 1, 'Test tenant must only see its own 1 contact');
  assert.equal(returnedContacts[0]._id, testContactAId);

  // 2. Query admin users using Test Tenant token
  const resUsers = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${testAdminTokenA}` },
  });
  assert.equal(resUsers.status, 200);
  const usersData = await resUsers.json();
  const usersArray = Array.isArray(usersData) ? usersData : (usersData.users || []);
  assert.ok(Array.isArray(usersArray));
  assert.equal(usersArray.length, 2, 'Test tenant admin must only see its own 2 users');
  const returnedEmails = usersArray.map(u => u.email);
  for (const dUser of doppelmayrUsers) {
    assert.ok(!returnedEmails.includes(dUser.email), `Doppelmayr user ${dUser.email} leaked to test tenant!`);
  }

  // 3. Attempt cross-tenant contact access
  const doppelContact = await db.collection('contacts').findOne({ orgId: 'org_doppelmayr' });
  assert.ok(doppelContact, 'Doppelmayr must have contacts');

  const resCrossContact = await fetch(`${BASE_URL}/api/crm/${doppelContact._id}`, {
    headers: { Authorization: `Bearer ${testAdminTokenA}` },
  });
  assert.equal(resCrossContact.status, 404, 'Test tenant must receive 404 when accessing Doppelmayr contact');

  // 4. Attempt cross-tenant leave balance access
  const doppelUser = doppelmayrUsers[0];
  const resCrossBal = await fetch(`${BASE_URL}/api/admin/balances/${doppelUser._id}`, {
    headers: { Authorization: `Bearer ${testAdminTokenA}` },
  });
  assert.equal(resCrossBal.status, 404, 'Test tenant must receive 404 when accessing Doppelmayr balance');
});

test('3. Test teardown removes all test data', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  const testUserIds = [testAdminUserA._id, testEmployeeUserA._id];
  await safeTeardownTestOrg(db, testOrgIdA, testUserIds);

  // Verify all collections are clean of testOrgIdA
  assert.equal(await Organization.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await OrgSettings.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await User.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await Employee.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await Contact.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await Expense.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await TravelRequest.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await Leave.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await LeaveBalance.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await Announcement.countDocuments({ orgId: testOrgIdA }), 0);
  assert.equal(await AuditLog.countDocuments({ orgId: testOrgIdA }), 0);

  // Mark cleaned
  testOrgIdA = null;
});

test('4. Doppelmayr counts remain unchanged after the complete test', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  const currentBaseline = await getDoppelmayrBaseline(db);
  for (const [coll, count] of Object.entries(baseline)) {
    assert.equal(
      currentBaseline[coll],
      count,
      `Count mismatch in collection '${coll}': expected baseline ${count}, found ${currentBaseline[coll]}`
    );
  }

  // Also verify publicholidays and passkeycredentials
  const holidays = await db.collection('publicholidays').countDocuments();
  assert.equal(holidays, 11, 'Public holidays count must remain 11');
  const passkeys = await db.collection('passkeycredentials').countDocuments();
  assert.equal(passkeys, 1, 'Passkey credentials count must remain 1');
});

test('5. Leave balances for Doppelmayr remain present and mapped to the correct users', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  const currentBalances = await db.collection('leavebalances').find({ orgId: 'org_doppelmayr' }).toArray();
  assert.equal(currentBalances.length, 9, 'Must have exactly 9 Doppelmayr leave balances');

  for (const user of doppelmayrUsers) {
    const uid = user._id.toString();
    const bal = currentBalances.find(b => b.userId === uid);
    assert.ok(bal, `LeaveBalance missing for Doppelmayr user ${user.email} (${uid})`);
    assert.equal(bal.orgId, 'org_doppelmayr');
    assert.equal(bal.year, 2026);
    assert.equal(bal.casual, 12);
    assert.equal(bal.sick, 6);
    assert.equal(bal.earned, 15);
    assert.equal(bal.privilege, 2);
    assert.equal(bal.restricted, 2);
    assert.equal(bal.lwpDays, 0);

    // Verify employee correspondence
    const emp = await db.collection('employees').findOne({ clerkUserId: uid, orgId: 'org_doppelmayr' });
    assert.ok(emp, `Employee missing for Doppelmayr user ${user.email} (${uid})`);
  }
});

test('6. No orphan LeaveBalance records can remain', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  const allBalances = await db.collection('leavebalances').find({}).toArray();
  assert.equal(allBalances.length, 9, 'Total database leave balances must equal exactly 9 (only Doppelmayr)');

  const userIds = new Set(doppelmayrUsers.map(u => u._id.toString()));
  for (const bal of allBalances) {
    assert.equal(typeof bal.userId, 'string', 'LeaveBalance.userId must be a string');
    assert.ok(userIds.has(bal.userId), `Orphan LeaveBalance detected with userId ${bal.userId}`);
    assert.equal(bal.orgId, 'org_doppelmayr');
  }

  // Safety Assertion Proof: verify that our safety harness prevents teardown on org_doppelmayr
  assert.throws(
    () => assertSafeTeardown('org_doppelmayr'),
    /CRITICAL SAFETY VIOLATION/,
    'Harness must reject any destructive teardown on org_doppelmayr'
  );
  assert.throws(
    () => assertSafeTeardown('doppelmayr'),
    /CRITICAL SAFETY VIOLATION/,
    'Harness must reject any destructive teardown on doppelmayr slug'
  );
});

test('7. No orphan refresh tokens remain', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  const allTokens = await db.collection('refreshtokens').find({}).toArray();
  const validUserIds = new Set((await db.collection('users').find({}).toArray()).map(u => u._id.toString()));

  for (const tok of allTokens) {
    assert.equal(typeof tok.userId, 'string', 'RefreshToken.userId must be a string');
    assert.ok(validUserIds.has(tok.userId), `Orphan RefreshToken detected with userId ${tok.userId}`);
  }
});

test('8. No foreign-org business records remain', async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // Verify relational integrity across the entire database
  const violations = await auditDatabaseIntegrity(db);
  assert.deepEqual(violations, [], `Relational integrity violations found:\n${violations.join('\n')}`);

  // Query each collection for any non-Doppelmayr records
  const foreignOrgs = await db.collection('organizations').find({
    slug: { $ne: 'doppelmayr' },
    orgId: { $ne: 'org_doppelmayr' },
  }).toArray();
  assert.equal(foreignOrgs.length, 0, 'No foreign organizations should exist');

  const foreignUsers = await db.collection('users').find({ orgId: { $ne: 'org_doppelmayr' } }).toArray();
  assert.equal(foreignUsers.length, 0, 'No foreign users should exist');

  const foreignContacts = await db.collection('contacts').find({ orgId: { $ne: 'org_doppelmayr' } }).toArray();
  assert.equal(foreignContacts.length, 0, 'No foreign contacts should exist');
});

test('9. Re-running the test suite repeatedly produces the same clean final state', async () => {
  await connectDB();
  const db = mongoose.connection.db;
  const ts = Date.now();

  // Spin up an ephemeral tenant B to test cycle idempotency
  const testOrgB = `org_test_idempotent_${ts}`;
  const testUserB = await User.create({
    email: `idempotent_${ts}@test.com`,
    passwordHash: 'dummy_hash',
    firstName: 'Idempotent',
    lastName: 'User',
    role: 'employee',
    orgId: testOrgB,
    sessionVersion: 1,
  });

  await Employee.create({
    clerkUserId: String(testUserB._id),
    employeeId: `EMP-IDEM-${ts}`,
    createdByUserId: String(testUserB._id),
    firstName: 'Idempotent',
    lastName: 'User',
    email: testUserB.email,
    department: 'Quality Assurance',
    designation: 'Test Engineer',
    orgId: testOrgB,
    joiningDate: new Date(),
  });

  await LeaveBalance.create({
    orgId: testOrgB,
    userId: String(testUserB._id),
    year: 2026,
    casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0,
  });

  // Perform teardown
  await safeTeardownTestOrg(db, testOrgB, [testUserB._id]);

  // Final verification: database is strictly in original pristine state
  const postViolations = await auditDatabaseIntegrity(db);
  assert.deepEqual(postViolations, [], 'Post-idempotency audit must have 0 violations');

  const finalBaseline = await getDoppelmayrBaseline(db);
  for (const [coll, count] of Object.entries(baseline)) {
    assert.equal(finalBaseline[coll], count, `Final baseline count mismatch in '${coll}'`);
  }
});
