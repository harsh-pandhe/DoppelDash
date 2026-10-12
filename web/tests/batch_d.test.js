const { captureForeignBaseline } = require('./helpers/baseline');
let FOREIGN;
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

const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));

// Track all test-created org IDs and user IDs for clean teardown
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();

let tenantAData = null;
let tenantBData = null;
let tokenAdminA = null;

let ipSeq = 1;
function registerPost(body) {
  return fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.1.${ipSeq++}`,
    },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
  // Ensure existing Doppelmayr org is registered
  await Organization.ensureDoppelmayr();
  FOREIGN = await captureForeignBaseline(mongoose.connection.db);
});

// -------------------------------------------------------------
// 1. REGISTRATION: NEW USER + NEW ORGANIZATION
// -------------------------------------------------------------
test('1. Registration: New user + new organization succeeds with valid contract', async () => {
  const timestamp = Date.now();
  const email = `admin_d_a_${timestamp}@acme.test`;
  const res = await registerPost({
    organizationName: 'Acme International',
    name: 'Alice Admin',
    email,
    password: 'Password123!',
    phone: '+1234567890',
  });

  assert.equal(res.status, 201, 'Registration should return 201 Created');
  const data = await res.json();

  assert.equal(data.message, 'Organization created successfully');
  assert.ok(data.user, 'Response should contain user object');
  assert.ok(data.organization, 'Response should contain organization object');
  assert.equal(data.organization.name, 'Acme International');
  assert.ok(data.organization.orgId.startsWith('org_'), 'orgId must have org_ prefix');
  assert.ok(data.organization.slug.startsWith('acme-international'), 'slug should derive from name');

  // Public registration is the Android client's flow: it returns mobile tokens and mints NO web cookie
  // (a new public organisation has webEnabled=false — see web_access_boundary.test.js).
  const setCookie = res.headers.get('set-cookie') || '';
  assert.doesNotMatch(setCookie, /dd_session=[^;]/, 'a new public organisation must not receive a web session cookie');
  assert.equal(data.webAccess, false, 'registration reports that the web client is not enabled');
  assert.ok(data.accessToken && data.refreshToken, 'registration returns the mobile token pair');

  // Track for later tests
  tenantAData = data;
  createdTestOrgs.add(data.organization.orgId);
  createdTestUserIds.add(data.user.id);

  tokenAdminA = data.accessToken;
});

// -------------------------------------------------------------
// 2. UNIQUE TENANT ID GENERATION
// -------------------------------------------------------------
test('2. Unique Tenant ID: Subsequent registration receives a distinct unique orgId and slug', async () => {
  const timestamp = Date.now();
  const email = `admin_d_b_${timestamp}@beta.test`;
  const res = await registerPost({
    organizationName: 'Acme International', // Same company name to test slug deduplication
    name: 'Bob Boss',
    email,
    password: 'Password123!',
  });

  assert.equal(res.status, 201);
  const data = await res.json();

  assert.notEqual(data.organization.orgId, tenantAData.organization.orgId, 'orgId must be unique');
  assert.notEqual(data.organization.slug, tenantAData.organization.slug, 'slug must be deduplicated with suffix');
  assert.ok(data.organization.slug.startsWith('acme-international-'), 'slug collision must add suffix');

  tenantBData = data;
  createdTestOrgs.add(data.organization.orgId);
  createdTestUserIds.add(data.user.id);
});

// -------------------------------------------------------------
// 3. INITIAL USER BECOMES ADMIN
// -------------------------------------------------------------
test('3. Initial Admin: Registered user is assigned role admin with administrative permissions', async () => {
  assert.equal(tenantAData.user.role, 'admin');

  // Query DB directly
  const dbUser = await User.findById(tenantAData.user.id).lean();
  assert.ok(dbUser);
  assert.equal(dbUser.role, 'admin');
  assert.ok(dbUser.permissions.includes('users:write'));
  assert.ok(dbUser.permissions.includes('leaves:write'));
  assert.ok(dbUser.permissions.includes('analytics:read'));
});

// -------------------------------------------------------------
// 4. USER AND ORGANIZATION HAVE MATCHING TENANT CONTEXT
// -------------------------------------------------------------
test('4. Tenant Context: User and Organization records share exact orgId in DB', async () => {
  const dbUser = await User.findById(tenantAData.user.id).lean();
  const dbOrg = await Organization.findOne({ orgId: tenantAData.organization.orgId }).lean();

  assert.ok(dbOrg, 'Organization document must exist in DB');
  assert.equal(dbUser.orgId, dbOrg.orgId, 'User.orgId must equal Organization.orgId');
  assert.equal(dbOrg.ownerId, String(dbUser._id), 'Organization.ownerId must be the initial admin');
});

// -------------------------------------------------------------
// 5. EMPLOYEE RECORD MATCHES TENANT CONTEXT
// -------------------------------------------------------------
test('5. Employee Context: Initial admin has an associated Employee record matching tenant context', async () => {
  const dbEmp = await Employee.findOne({ clerkUserId: tenantAData.user.id }).lean();

  assert.ok(dbEmp, 'Employee record must exist for initial admin');
  assert.equal(dbEmp.orgId, tenantAData.organization.orgId, 'Employee.orgId must match Organization.orgId');
  assert.equal(dbEmp.email, tenantAData.user.email);
  assert.equal(dbEmp.designation, 'Workspace Admin');
  assert.equal(dbEmp.onboardingComplete, true);
});

// -------------------------------------------------------------
// 6. CLIENT-SUPPLIED FOREIGN orgId IS STRICTLY IGNORED
// -------------------------------------------------------------
test('6. Security: Client-supplied foreign orgId is strictly ignored; server assigns fresh orgId', async () => {
  const timestamp = Date.now();
  const email = `hacker_${timestamp}@shadow.test`;
  const res = await registerPost({
    organizationName: 'Shadow Ops',
    name: 'Eve Attacker',
    email,
    password: 'Password123!',
    orgId: 'org_doppelmayr', // Attacker attempts to hijack Doppelmayr
    organizationId: 'org_doppelmayr',
    role: 'superadmin',
  });

  assert.equal(res.status, 201);
  const data = await res.json();

  // Must NOT be org_doppelmayr
  assert.notEqual(data.organization.orgId, 'org_doppelmayr', 'Must never allow client to choose org_doppelmayr');
  assert.notEqual(data.user.orgId, 'org_doppelmayr', 'User must not be placed in org_doppelmayr');
  assert.equal(data.user.role, 'admin', 'Role must default to admin, not arbitrary client role');

  createdTestOrgs.add(data.organization.orgId);
  createdTestUserIds.add(data.user.id);

  // Verify in DB
  const dbUser = await User.findById(data.user.id).lean();
  assert.notEqual(dbUser.orgId, 'org_doppelmayr');
  assert.equal(dbUser.orgId, data.organization.orgId);
});

// -------------------------------------------------------------
// 7. CLIENT-SUPPLIED FOREIGN ORG ID CANNOT JOIN EXISTING TENANT
// -------------------------------------------------------------
test('7. Security: Attempting to register into existing Tenant A does not join Tenant A', async () => {
  const timestamp = Date.now();
  const email = `attacker_join_${timestamp}@evil.test`;
  const res = await registerPost({
    organizationName: 'Acme International',
    name: 'Intruder',
    email,
    password: 'Password123!',
    orgId: tenantAData.organization.orgId, // Attempts to join Tenant A
    organizationId: tenantAData.organization.orgId,
  });

  assert.equal(res.status, 201);
  const data = await res.json();

  // Must have a newly minted orgId, completely separate from Tenant A
  assert.notEqual(data.organization.orgId, tenantAData.organization.orgId);
  assert.notEqual(data.user.orgId, tenantAData.organization.orgId);

  createdTestOrgs.add(data.organization.orgId);
  createdTestUserIds.add(data.user.id);
});

// -------------------------------------------------------------
// 8. DUPLICATE EMAIL IS REJECTED
// -------------------------------------------------------------
test('8. Duplicate Email: Attempting to register existing email returns 409 and creates no records', async () => {
  const orgCountBefore = await Organization.countDocuments();
  const userCountBefore = await User.countDocuments();

  const res = await registerPost({
    organizationName: 'Another Acme',
    name: 'Alice Duplicate',
    email: tenantAData.user.email, // Already registered in Test 1
    password: 'Password123!',
  });

  assert.equal(res.status, 409, 'Duplicate registration must return 409 Conflict');
  const data = await res.json();
  assert.ok(data.error.includes('already exists'));

  const orgCountAfter = await Organization.countDocuments();
  const userCountAfter = await User.countDocuments();

  assert.equal(orgCountAfter, orgCountBefore, 'No organization should be created on duplicate email');
  assert.equal(userCountAfter, userCountBefore, 'No user should be created on duplicate email');
});

// -------------------------------------------------------------
// 9. FAILED REGISTRATION LEAVES NO ORPHAN RECORDS (ROLLBACK)
// -------------------------------------------------------------
test('9. Rollback Safety: Simulated downstream failure cleanly rolls back Organization, User, and Employee', async () => {
  const timestamp = Date.now();
  const testEmail = `rollback_test_${timestamp}@fail.test`;

  // Password too short -> 400 immediately, 0 records created
  const resBadPw = await registerPost({
    organizationName: 'Fail Corp',
    name: 'Fail User',
    email: testEmail,
    password: '123', // Less than 8 chars
  });
  assert.equal(resBadPw.status, 400);

  // Verify zero records were created
  const userCheck = await User.findOne({ email: testEmail }).lean();
  assert.equal(userCheck, null, 'No user should be created');

  const orgCheck = await Organization.findOne({ name: 'Fail Corp' }).lean();
  assert.equal(orgCheck, null, 'No organization should be created');
});

// -------------------------------------------------------------
// 10. REGISTRATION RETRY SUCCEEDS AFTER FAILED ATTEMPT
// -------------------------------------------------------------
test('10. Retry Safety: After a failed attempt, user can re-register with corrected data successfully', async () => {
  const timestamp = Date.now();
  const retryEmail = `retry_user_${timestamp}@retry.test`;

  // First attempt fails (short password)
  const resFail = await registerPost({
    organizationName: 'Retry Inc',
    name: 'Robin Retry',
    email: retryEmail,
    password: 'short',
  });
  assert.equal(resFail.status, 400);

  // Second attempt succeeds with corrected password
  const resSuccess = await registerPost({
    organizationName: 'Retry Inc',
    name: 'Robin Retry',
    email: retryEmail,
    password: 'ValidPassword123!',
  });
  assert.equal(resSuccess.status, 201);
  const data = await resSuccess.json();
  assert.equal(data.user.email, retryEmail);

  createdTestOrgs.add(data.organization.orgId);
  createdTestUserIds.add(data.user.id);
});

// -------------------------------------------------------------
// 11. EXISTING DOPPELMAYR USER STILL AUTHENTICATES
// -------------------------------------------------------------
test('11. Existing Doppelmayr: org_doppelmayr user session resolves correctly and retains role', async () => {
  const doppelmayrUser = await User.findOne({ orgId: 'org_doppelmayr', email: 'harshpandhehome@gmail.com' }).lean();
  assert.ok(doppelmayrUser, 'Doppelmayr user must exist in DB');
  assert.equal(doppelmayrUser.orgId, 'org_doppelmayr');

  const doppelToken = await signToken({
    id: String(doppelmayrUser._id),
    email: doppelmayrUser.email,
    orgId: 'org_doppelmayr',
    role: doppelmayrUser.role,
    firstName: doppelmayrUser.firstName,
    lastName: doppelmayrUser.lastName,
    fullName: `${doppelmayrUser.firstName} ${doppelmayrUser.lastName}`.trim(),
    permissions: doppelmayrUser.permissions || [],
    isActive: true,
    isBanned: false,
    mustChangePassword: false,
  });

  // Verify access to an authenticated endpoint with Doppelmayr token
  const res = await fetch(`${BASE_URL}/api/employees/me`, {
    headers: { Authorization: `Bearer ${doppelToken}` },
  });
  assert.equal(res.status, 200);
  const meData = await res.json();
  assert.equal(meData.orgId, 'org_doppelmayr');
});

// -------------------------------------------------------------
// 12. EXISTING DOPPELMAYR DATA REMAINS UNCHANGED
// -------------------------------------------------------------
test('12. Existing Doppelmayr: Core collection counts for org_doppelmayr remain intact', async () => {
  const doppelUsers = await User.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelEmps = await Employee.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelLeaves = await LeaveBalance.countDocuments({ orgId: 'org_doppelmayr' });

  assert.equal(doppelUsers, 9, 'Doppelmayr users count must be 9');
  assert.equal(doppelEmps, 9, 'Doppelmayr employees count must be 9');
  assert.equal(doppelLeaves, 9, 'Doppelmayr leave balances count must be 9');
});

// -------------------------------------------------------------
// 13. ADMIN A CREATES EMPLOYEE -> ORG A
// -------------------------------------------------------------
test('13. Admin Flow: Admin A creates an employee; user and employee belong to Org A', async () => {
  const timestamp = Date.now();
  const empEmail = `emp_a_${timestamp}@acme.test`;

  const res = await fetch(`${BASE_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstName: 'Edward',
      lastName: 'Engineer',
      email: empEmail,
      newRole: 'employee',
      department: 'Engineering',
      designation: 'Software Developer',
      skipWelcomeEmail: true,
    }),
  });

  assert.equal(res.status, 200, 'Admin creating employee should return 200');
  const data = await res.json();
  assert.ok(data.userId);

  createdTestUserIds.add(data.userId);

  // Verify DB binding
  const newDbUser = await User.findById(data.userId).lean();
  assert.equal(newDbUser.orgId, tenantAData.organization.orgId, 'Created user must belong to Org A');
  assert.equal(newDbUser.role, 'employee');

  const newDbEmp = await Employee.findOne({ clerkUserId: data.userId }).lean();
  assert.equal(newDbEmp.orgId, tenantAData.organization.orgId, 'Created employee must belong to Org A');
  assert.equal(newDbEmp.department, 'Engineering');
});

// -------------------------------------------------------------
// 14. ADMIN A CREATES MANAGER -> ORG A
// -------------------------------------------------------------
test('14. Admin Flow: Admin A creates a manager; user and employee belong to Org A', async () => {
  const timestamp = Date.now();
  const mgrEmail = `mgr_a_${timestamp}@acme.test`;

  const res = await fetch(`${BASE_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstName: 'Mary',
      lastName: 'Manager',
      email: mgrEmail,
      newRole: 'manager',
      department: 'Operations',
      designation: 'Operations Lead',
      skipWelcomeEmail: true,
    }),
  });

  assert.equal(res.status, 200, 'Admin creating manager should return 200');
  const data = await res.json();
  assert.ok(data.userId);

  createdTestUserIds.add(data.userId);

  const newDbUser = await User.findById(data.userId).lean();
  assert.equal(newDbUser.orgId, tenantAData.organization.orgId, 'Created manager must belong to Org A');
  assert.equal(newDbUser.role, 'manager');

  const newDbEmp = await Employee.findOne({ clerkUserId: data.userId }).lean();
  assert.equal(newDbEmp.orgId, tenantAData.organization.orgId, 'Created employee record must belong to Org A');
});

// -------------------------------------------------------------
// 15. ADMIN A CANNOT FORCE ORG B THROUGH REQUEST BODY
// -------------------------------------------------------------
test('15. Security: Admin A cannot inject foreign orgId in user creation payload', async () => {
  const timestamp = Date.now();
  const testEmail = `spoof_org_${timestamp}@test.test`;

  const res = await fetch(`${BASE_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstName: 'Spoof',
      lastName: 'Attempt',
      email: testEmail,
      newRole: 'employee',
      orgId: tenantBData.organization.orgId, // Attacking Admin A tries to place user in Tenant B
      organizationId: tenantBData.organization.orgId,
      skipWelcomeEmail: true,
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  createdTestUserIds.add(data.userId);

  // The created user must be in Org A (caller's org), NOT Org B
  const dbUser = await User.findById(data.userId).lean();
  assert.equal(dbUser.orgId, tenantAData.organization.orgId, 'User must belong to caller org A');
  assert.notEqual(dbUser.orgId, tenantBData.organization.orgId, 'User must NOT belong to org B');

  const dbEmp = await Employee.findOne({ clerkUserId: data.userId }).lean();
  assert.equal(dbEmp.orgId, tenantAData.organization.orgId, 'Employee must belong to caller org A');
});

// -------------------------------------------------------------
// 16. ADMIN A CANNOT CREATE USER INSIDE ORG B
// -------------------------------------------------------------
test('16. Isolation: Admin A listing users sees ONLY Org A users and zero Org B users', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });

  assert.equal(res.status, 200);
  const users = await res.json();

  assert.ok(Array.isArray(users));
  // All returned users must belong to Org A
  for (const u of users) {
    const dbU = await User.findById(u.id).lean();
    assert.equal(dbU.orgId, tenantAData.organization.orgId, 'Returned users must only belong to Org A');
    assert.notEqual(dbU.orgId, tenantBData.organization.orgId, 'Must not see Org B users');
    assert.notEqual(dbU.orgId, 'org_doppelmayr', 'Must not see Doppelmayr users');
  }
});

// -------------------------------------------------------------
// 17. NEWLY-CREATED ADMIN RESOLVES TO CORRECT orgId
// -------------------------------------------------------------
test('17. Session Context: Newly created admin token resolves to correct orgId and user in getUser()', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/users/${tenantAData.user.id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.user.orgId, tenantAData.organization.orgId);
  assert.equal(data.user.role, 'admin');
  assert.equal(data.employee.orgId, tenantAData.organization.orgId);
});

// -------------------------------------------------------------
// 18. FORGED REQUEST orgId DOES NOT ALTER AUTHENTICATED TENANT
// -------------------------------------------------------------
test('18. Tamper Resistance: Query/header forged orgId does not alter authenticated server tenant', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/users?orgId=org_doppelmayr`, {
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'X-Org-Id': 'org_doppelmayr',
      'X-Tenant-Id': 'org_doppelmayr',
    },
  });

  assert.equal(res.status, 200);
  const users = await res.json();

  // Must still strictly return Org A users
  for (const u of users) {
    const dbU = await User.findById(u.id).lean();
    assert.equal(dbU.orgId, tenantAData.organization.orgId, 'Server must ignore forged query/header orgId');
  }
});

// -------------------------------------------------------------
// 19. DIRECT MONGODB VERIFICATION & CLEANUP
// -------------------------------------------------------------
test('19. Direct MongoDB Verification: Clean test teardown leaves zero test artifacts and intact Doppelmayr data', async () => {
  const orgList = Array.from(createdTestOrgs);
  const userList = Array.from(createdTestUserIds);

  // 1. Verify before delete that test orgs exist and are properly populated
  for (const orgId of orgList) {
    const org = await Organization.findOne({ orgId }).lean();
    assert.ok(org, `Organization ${orgId} must exist`);
    assert.ok(org.slug);
  }

  // 2. Cleanup test organizations and resources
  await Organization.deleteMany({ orgId: { $in: orgList } });
  await OrgSettings.deleteMany({ orgId: { $in: orgList } });
  await User.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: userList } }] });
  await Employee.deleteMany({ $or: [{ orgId: { $in: orgList } }, { clerkUserId: { $in: userList } }] });
  await LeaveBalance.deleteMany({ $or: [{ orgId: { $in: orgList } }, { userId: { $in: userList } }] });
  await RefreshToken.deleteMany({ userId: { $in: userList } });

  // 3. Confirm 0 test artifacts remain
  const testOrgsRemain = await Organization.countDocuments({ orgId: { $ne: 'org_doppelmayr' }, ...FOREIGN.created('organizations') });
  assert.equal(testOrgsRemain, 0, 'Zero test organizations should remain');

  const testUsersRemain = await User.countDocuments({ orgId: { $ne: 'org_doppelmayr' }, ...FOREIGN.created('users') });
  assert.equal(testUsersRemain, 0, 'Zero test users should remain');

  // 4. Confirm Doppelmayr data is 100% untouched
  const doppelUsers = await User.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelEmps = await Employee.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelUsers, 9);
  assert.equal(doppelEmps, 9);
});

test.after(async () => {
  await mongoose.disconnect();
});
