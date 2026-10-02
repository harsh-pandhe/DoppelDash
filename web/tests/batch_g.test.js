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
const Invitation = jiti(path.resolve(__dirname, '../models/Invitation.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;

// Tracking sets for safe teardown
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();
const createdTestInviteIds = new Set();

let tenantGData = null;
let tokenAdminG = null;
let doppelmayrUsersBaseline = 0;

let ipSeq = 700;
function registerPost(body) {
  return fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
  await Organization.ensureDoppelmayr();
  doppelmayrUsersBaseline = await User.countDocuments({ orgId: 'org_doppelmayr' });
});

test.after(async () => {
  const orgList = Array.from(createdTestOrgs);
  const userList = Array.from(createdTestUserIds);
  const inviteList = Array.from(createdTestInviteIds);

  if (orgList.length > 0 || userList.length > 0 || inviteList.length > 0) {
    await Organization.deleteMany({ orgId: { $in: orgList } });
    await OrgSettings.deleteMany({ orgId: { $in: orgList } });
    await User.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: userList } }] });
    await Employee.deleteMany({ $or: [{ orgId: { $in: orgList } }, { clerkUserId: { $in: userList } }] });
    await LeaveBalance.deleteMany({ $or: [{ orgId: { $in: orgList } }, { userId: { $in: userList } }] });
    await Invitation.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: inviteList } }] });
    await AuditLog.deleteMany({ orgId: { $in: orgList } });
    await RefreshToken.deleteMany({ userId: { $in: userList } });
  }

  // Ensure Doppelmayr invariant
  const doppelmayrUsersAfter = await User.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelmayrUsersAfter, doppelmayrUsersBaseline, 'Doppelmayr user count must not change');

  await mongoose.disconnect();
});

// -------------------------------------------------------------
// 1. SETUP: REGISTER TENANT G
// -------------------------------------------------------------
test('1. Setup: Register Tenant G admin', async () => {
  const ts = Date.now();
  const res = await registerPost({
    organizationName: 'Batch G Organization',
    name: 'Admin Batch G',
    email: `admin_g_${ts}@batch-g-test.com`,
    password: 'Password123!',
  });
  assert.equal(res.status, 201);
  tenantGData = await res.json();
  tokenAdminG = tenantGData.accessToken;
  createdTestOrgs.add(tenantGData.organization.orgId);
  createdTestUserIds.add(tenantGData.user.id);
});

// -------------------------------------------------------------
// 2. ADMIN INVITATION CREATION UX INTEGRATION
// -------------------------------------------------------------
let invite1Token = null;
let invite1Id = null;
let invite1Email = null;

test('2. Admin invitation creation reflects backend response & fallback invite link', async () => {
  const ts = Date.now();
  invite1Email = `engineer_${ts}@batch-g-test.com`;

  const res = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: invite1Email,
      role: 'employee',
      firstName: 'Alan',
      lastName: 'Turing',
      department: 'Algorithms',
      designation: 'Staff Scientist',
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.invitation?._id, 'Must return invitation._id');
  assert.ok(data.inviteUrl, 'Must return inviteUrl fallback');
  assert.equal(typeof data.emailDelivery?.delivered, 'boolean', 'Must clearly report email delivery status');
  assert.equal(data.emailDelivery?.delivered, false, 'Unconfigured SMTP must return delivered: false');

  // Verify inviteUrl contains token and points to /invite?token=...
  const url = new URL(data.inviteUrl);
  assert.equal(url.pathname, '/invite');
  const token = url.searchParams.get('token');
  assert.ok(token, 'inviteUrl must have token param');
  assert.equal(token.length, 64, 'Token must be 64-char hex');

  invite1Token = token;
  invite1Id = data.invitation._id;
  createdTestInviteIds.add(invite1Id);
});

// -------------------------------------------------------------
// 3. VERIFY VALID INVITATION (/api/auth/invitations/[token])
// -------------------------------------------------------------
test('3. GET /api/auth/invitations/[token] returns verified invitation details', async () => {
  const res = await fetch(`${BASE_URL}/api/auth/invitations/${invite1Token}`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.valid, true);
  assert.equal(data.status, 'pending');
  assert.equal(data.email, invite1Email);
  assert.equal(data.role, 'employee');
  assert.equal(data.firstName, 'Alan');
  assert.equal(data.lastName, 'Turing');
  assert.equal(data.department, 'Algorithms');
  assert.equal(data.designation, 'Staff Scientist');
  assert.equal(data.organizationName, 'Batch G Organization');
  assert.ok(!data.tokenHash, 'Must never expose tokenHash');
});

// -------------------------------------------------------------
// 4. INVALID TOKEN RENDERS NOT FOUND / INVALID ERROR
// -------------------------------------------------------------
test('4. GET /api/auth/invitations/[token] with invalid token returns 404 invalid error', async () => {
  const fakeToken = '0000000000000000000000000000000000000000000000000000000000000000';
  const res = await fetch(`${BASE_URL}/api/auth/invitations/${fakeToken}`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.valid, false);
  assert.equal(data.reason, 'invalid_token');
});

// -------------------------------------------------------------
// 5. EXPIRED INVITATION RENDERS EXPIRED ERROR
// -------------------------------------------------------------
test('5. Expired invitation verification returns 410 expired error', async () => {
  // Create an invitation and backdate its expiresAt
  const ts = Date.now();
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: `expired_${ts}@batch-g-test.com`,
      role: 'employee',
    }),
  });
  assert.equal(resCreate.status, 201);
  const created = await resCreate.json();
  const inviteId = created.invitation._id;
  createdTestInviteIds.add(inviteId);

  const token = new URL(created.inviteUrl).searchParams.get('token');

  // Expire it in DB
  await Invitation.updateOne(
    { _id: new mongoose.Types.ObjectId(inviteId) },
    { $set: { expiresAt: new Date(Date.now() - 3600000) } }
  );

  const resVerify = await fetch(`${BASE_URL}/api/auth/invitations/${token}`);
  assert.equal(resVerify.status, 410);
  const data = await resVerify.json();
  assert.equal(data.valid, false);
  assert.equal(data.reason, 'expired');
});

// -------------------------------------------------------------
// 6. REVOKED INVITATION RENDERS REVOKED ERROR
// -------------------------------------------------------------
let revokedInviteId = null;
test('6. Revoked invitation verification returns 410 revoked error', async () => {
  const ts = Date.now();
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: `revoked_${ts}@batch-g-test.com`,
      role: 'employee',
    }),
  });
  assert.equal(resCreate.status, 201);
  const created = await resCreate.json();
  revokedInviteId = created.invitation._id;
  createdTestInviteIds.add(revokedInviteId);

  const token = new URL(created.inviteUrl).searchParams.get('token');

  // Revoke it via Admin API
  const resRevoke = await fetch(`${BASE_URL}/api/admin/invitations/${revokedInviteId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
  });
  assert.equal(resRevoke.status, 200);

  // Verify it returns 410 revoked
  const resVerify = await fetch(`${BASE_URL}/api/auth/invitations/${token}`);
  assert.equal(resVerify.status, 410);
  const data = await resVerify.json();
  assert.equal(data.valid, false);
  assert.equal(data.reason, 'revoked');
});

// -------------------------------------------------------------
// 7. CLIENT CANNOT INFLUENCE ROLE OR ORG THROUGH FRONTEND
// -------------------------------------------------------------
let acceptedUserId = null;

test('7. Client cannot influence role or org through acceptance request', async () => {
  // Attacker tries to pass role: 'admin' and orgId: 'org_doppelmayr'
  const res = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify({
      token: invite1Token,
      password: 'SecurePassword123!',
      firstName: 'Alan',
      lastName: 'Turing',
      role: 'admin',                // Tamper attempt
      orgId: 'org_doppelmayr',      // Tamper attempt
      organizationId: 'org_doppelmayr',
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.user, 'Must return user');
  assert.equal(data.user.role, 'employee', 'Must enforce invitation role (employee), NOT client-supplied role');
  assert.equal(data.user.orgId, tenantGData.organization.orgId, 'Must enforce invitation orgId, NOT client-supplied orgId');
  assert.notEqual(data.user.orgId, 'org_doppelmayr', 'Must never allow claiming Doppelmayr tenant');

  acceptedUserId = data.user.id;
  createdTestUserIds.add(acceptedUserId);

  // Check Set-Cookie contains auth token
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Must set auth cookie');
  assert.ok(setCookie.includes('dd_session='), 'Must set dd_session cookie');

  // Verify in DB directly
  const dbUser = await User.findById(acceptedUserId);
  assert.equal(dbUser.role, 'employee');
  assert.equal(dbUser.orgId, tenantGData.organization.orgId);

  const dbEmployee = await Employee.findOne({ clerkUserId: acceptedUserId });
  assert.equal(dbEmployee.orgId, tenantGData.organization.orgId);
  assert.equal(dbEmployee.department, 'Algorithms');
  assert.equal(dbEmployee.designation, 'Staff Scientist');
});

// -------------------------------------------------------------
// 8. PREVENT DUPLICATE SUBMISSION / RE-USE OF ACCEPTED TOKEN
// -------------------------------------------------------------
test('8. Duplicate acceptance attempt is rejected as already accepted', async () => {
  const res = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify({
      token: invite1Token,
      password: 'AnotherPassword123!',
    }),
  });

  const data = await res.json();
  assert.equal(res.status, 409);
  assert.match(data.error, /already (?:been )?accepted/i);

  // Also check verification endpoint returns already_accepted
  const resVerify = await fetch(`${BASE_URL}/api/auth/invitations/${invite1Token}`);
  assert.equal(resVerify.status, 410);
  const verifyData = await resVerify.json();
  assert.equal(verifyData.valid, false);
  assert.equal(verifyData.reason, 'already_accepted');
});

// -------------------------------------------------------------
// 9. ADMIN INVITATIONS LISTING AND STATUS REPORTING
// -------------------------------------------------------------
test('9. Admin invitations listing reflects pending, accepted, and revoked statuses', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/invitations`, {
    headers: {
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
  });
  assert.equal(res.status, 200);
  const invitations = await res.json();
  assert.ok(Array.isArray(invitations));

  // Verify invite1 shows status 'accepted'
  const inv1 = invitations.find(i => i._id.toString() === invite1Id.toString());
  assert.ok(inv1, 'invite1 must be in listing');
  assert.equal(inv1.status, 'accepted');
  assert.ok(inv1.acceptedAt, 'Must have acceptedAt timestamp');
  assert.ok(!inv1.tokenHash, 'Must NOT expose tokenHash in list');
  assert.ok(!inv1.token, 'Must NOT expose raw token in list');

  // Verify revoked invite shows status 'revoked'
  const invRevoked = invitations.find(i => i._id.toString() === revokedInviteId.toString());
  assert.ok(invRevoked, 'revoked invite must be in listing');
  assert.equal(invRevoked.status, 'revoked');
  assert.ok(invRevoked.revokedAt, 'Must have revokedAt timestamp');
});

// -------------------------------------------------------------
// 10. RESEND INVITATION GENERATES NEW EXPIRATION AND LINK
// -------------------------------------------------------------
test('10. Admin resend invitation extends expiration and generates a fresh valid token', async () => {
  const ts = Date.now();
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: `resend_${ts}@batch-g-test.com`,
      role: 'employee',
    }),
  });
  assert.equal(resCreate.status, 201);
  const created = await resCreate.json();
  const inviteId = created.invitation._id;
  createdTestInviteIds.add(inviteId);

  const originalToken = new URL(created.inviteUrl).searchParams.get('token');

  // Trigger resend
  const resResend = await fetch(`${BASE_URL}/api/admin/invitations/${inviteId}/resend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminG}`,
      'X-Forwarded-For': `10.99.7.${ipSeq++}`,
    },
  });
  assert.equal(resResend.status, 200);
  const resentData = await resResend.json();
  assert.ok(resentData.inviteUrl, 'Resend must return inviteUrl');

  const newToken = new URL(resentData.inviteUrl).searchParams.get('token');
  assert.notEqual(newToken, originalToken, 'Resend must cycle to a new token');

  // Verify the new token works
  const resVerifyNew = await fetch(`${BASE_URL}/api/auth/invitations/${newToken}`);
  assert.equal(resVerifyNew.status, 200);
  const verifyData = await resVerifyNew.json();
  assert.equal(verifyData.valid, true);

  // Verify the old token is invalidated
  const resVerifyOld = await fetch(`${BASE_URL}/api/auth/invitations/${originalToken}`);
  assert.equal(resVerifyOld.status, 404);
});
