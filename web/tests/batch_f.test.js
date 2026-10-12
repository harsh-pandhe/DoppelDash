const { captureForeignBaseline } = require('./helpers/baseline');
let FOREIGN;
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

/** Invitation previews are `POST /api/auth/invitations/verify` with the token in the body (never in a URL). */
const verifyInvite = token => fetch(`${BASE_URL}/api/auth/invitations/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  body: JSON.stringify({ token }),
});
/** The emailed invite link carries its token in the URL fragment; a legacy ?token= link is still parsed. */
const inviteTokenFrom = inviteUrl => {
  const u = new URL(inviteUrl);
  return new URLSearchParams(u.hash.replace(/^#/, '')).get('token') || u.searchParams.get('token');
};
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
// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));

// Tracking sets for safe teardown
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();
const createdTestInviteIds = new Set();

let tenantAData = null;
let tenantBData = null;
let tokenAdminA = null;
let tokenAdminB = null;
let tokenManagerA = null;

let ipSeq = 300;
function registerPost(body) {
  return fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.3.${ipSeq++}`,
    },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
  await Organization.ensureDoppelmayr();
  FOREIGN = await captureForeignBaseline(mongoose.connection.db);
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
  }
  await mongoose.disconnect();
});

// -------------------------------------------------------------
// 1. SETUP: REGISTER TENANTS AND MANAGERS
// -------------------------------------------------------------
test('1. Setup: Register Tenant A and Tenant B, creating Admin and Manager tokens', async () => {
  const ts = Date.now();

  // Register Tenant A
  const resA = await registerPost({
    organizationName: 'Invites Tenant A',
    name: 'Admin Alpha',
    email: `admin_f_a_${ts}@test-invites-a.com`,
    password: 'Password123!',
  });
  assert.equal(resA.status, 201);
  tenantAData = await resA.json();
  tokenAdminA = tenantAData.accessToken;
  createdTestOrgs.add(tenantAData.organization.orgId);
  createdTestUserIds.add(tenantAData.user.id);

  // Register Tenant B
  const resB = await registerPost({
    organizationName: 'Invites Tenant B',
    name: 'Admin Beta',
    email: `admin_f_b_${ts}@test-invites-b.com`,
    password: 'Password123!',
  });
  assert.equal(resB.status, 201);
  tenantBData = await resB.json();
  tokenAdminB = tenantBData.accessToken;
  createdTestOrgs.add(tenantBData.organization.orgId);
  createdTestUserIds.add(tenantBData.user.id);

  // Create Manager in Tenant A
  const mgrA = await User.create({
    orgId: tenantAData.organization.orgId,
    email: `mgr_alpha_${ts}@test-invites-a.com`,
    passwordHash: 'dummyhash',
    role: 'manager',
    permissions: [],
    firstName: 'Manager',
    lastName: 'Alpha',
    employeeId: 'EMP-9991',
  });
  createdTestUserIds.add(mgrA._id.toString());
  tokenManagerA = await signToken(mgrA.toPublic());
});

// -------------------------------------------------------------
// 2. CREATION: ADMIN A CREATES INVITATION
// -------------------------------------------------------------
let inviteAData = null;
test('2. Admin A creates a valid employee invitation with high-entropy token', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'new_employee_a@test-invites-a.com',
      role: 'employee',
      firstName: 'Ned',
      lastName: 'Newbie',
      department: 'Engineering',
      designation: 'Junior Developer',
    }),
  });

  assert.equal(res.status, 201);
  inviteAData = await res.json();
  assert.ok(inviteAData.invitation);
  assert.ok(inviteAData.rawToken);
  assert.ok(inviteAData.inviteUrl.includes(inviteAData.rawToken));
  assert.equal(inviteAData.invitation.orgId, tenantAData.organization.orgId);
  assert.equal(inviteAData.invitation.email, 'new_employee_a@test-invites-a.com');
  assert.equal(inviteAData.invitation.role, 'employee');
  createdTestInviteIds.add(inviteAData.invitation._id);

  // Verify DB record: raw token must NOT be stored in DB, only tokenHash
  const dbDoc = await Invitation.findById(inviteAData.invitation._id).lean();
  assert.ok(dbDoc.tokenHash);
  assert.notEqual(dbDoc.tokenHash, inviteAData.rawToken);
  assert.equal(dbDoc.tokenHash, Invitation.hashToken(inviteAData.rawToken));
  assert.equal(dbDoc.rawToken, undefined, 'rawToken must never be stored in MongoDB');
});

// -------------------------------------------------------------
// 3. ROLE SECURITY: CANNOT INVITE ADMIN
// -------------------------------------------------------------
test('3. Role Security: Creating an invitation with role "admin" is rejected (400)', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'hacker_admin@example.com',
      role: 'admin',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /admin/i);
});

// -------------------------------------------------------------
// 4. MANAGER RBAC: MANAGER CANNOT INVITE MANAGERS
// -------------------------------------------------------------
test('4. Manager RBAC: Manager cannot invite another manager (403)', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenManagerA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'manager_peer@test-invites-a.com',
      role: 'manager',
    }),
  });

  assert.equal(res.status, 403);
});

// -------------------------------------------------------------
// 5. TENANT ISOLATION ON CREATE: INJECTED ORGID IS OVERRIDDEN
// -------------------------------------------------------------
test('5. Tenant Isolation: Admin A cannot inject Tenant B orgId in invitation creation', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orgId: tenantBData.organization.orgId,
      organizationId: tenantBData.organization.orgId,
      email: 'injected_tenant@example.com',
      role: 'employee',
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.invitation.orgId, tenantAData.organization.orgId, 'Must strictly belong to Tenant A');
  assert.notEqual(data.invitation.orgId, tenantBData.organization.orgId);
  createdTestInviteIds.add(data.invitation._id);
});

// -------------------------------------------------------------
// 6. CROSS-TENANT READ & REVOKE ATTACK
// -------------------------------------------------------------
let inviteBData = null;
test('6. Cross-Tenant Read & Revoke: Admin A cannot access or revoke Tenant B invitation', async () => {
  // Admin B creates invitation B
  const resB = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'employee_b@test-invites-b.com',
      role: 'employee',
      firstName: 'Bob',
      lastName: 'Builder',
    }),
  });
  assert.equal(resB.status, 201);
  inviteBData = await resB.json();
  createdTestInviteIds.add(inviteBData.invitation._id);

  // Admin A tries to GET invitation B
  const getRes = await fetch(`${BASE_URL}/api/admin/invitations/${inviteBData.invitation._id}`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(getRes.status, 404, 'Admin A reading invitation B must return 404');

  // Admin A tries to DELETE / revoke invitation B
  const delRes = await fetch(`${BASE_URL}/api/admin/invitations/${inviteBData.invitation._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(delRes.status, 404, 'Admin A revoking invitation B must return 404');

  // Verify invitation B in MongoDB remains active and unrevoked
  const dbDocB = await Invitation.findById(inviteBData.invitation._id).lean();
  assert.equal(dbDocB.revokedAt, undefined, 'Invitation B must remain unrevoked');
});

// -------------------------------------------------------------
// 7. PUBLIC TOKEN VERIFICATION
// -------------------------------------------------------------
test('7. Public token verification returns metadata without consuming token', async () => {
  const verifyRes = await verifyInvite(inviteAData.rawToken);
  assert.equal(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.equal(verifyData.valid, true);
  assert.equal(verifyData.email, 'new_employee_a@test-invites-a.com');
  assert.equal(verifyData.role, 'employee');
  assert.equal(verifyData.orgId, tenantAData.organization.orgId);

  // Invalid token check
  const badRes = await verifyInvite('random_bogus_token_12345');
  assert.equal(badRes.status, 404);
});

// -------------------------------------------------------------
// 8. ACCEPTANCE: VALID ACCEPTANCE CREATES USER & EMPLOYEE
// -------------------------------------------------------------
let acceptedUserData = null;
test('8. Acceptance: Valid invitation acceptance creates User, Employee, and LeaveBalance matching tenant', async () => {
  const acceptRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: inviteAData.rawToken,
      password: 'StrongPassword123!',
      firstName: 'Ned',
      lastName: 'Newbie',
    }),
  });

  assert.equal(acceptRes.status, 200);
  acceptedUserData = await acceptRes.json();
  assert.ok(acceptedUserData.user);
  assert.ok(acceptedUserData.employee);
  assert.ok(acceptedUserData.accessToken);
  createdTestUserIds.add(acceptedUserData.user.id);

  // Tenant context assertions
  assert.equal(acceptedUserData.user.orgId, tenantAData.organization.orgId);
  assert.equal(acceptedUserData.employee.orgId, tenantAData.organization.orgId);
  assert.equal(acceptedUserData.user.role, 'employee');

  // Verify direct MongoDB records
  const dbUser = await User.findById(acceptedUserData.user.id).lean();
  const dbEmp = await Employee.findOne({ clerkUserId: acceptedUserData.user.id }).lean();
  const dbBal = await LeaveBalance.findOne({ userId: acceptedUserData.user.id }).lean();
  const dbInv = await Invitation.findById(inviteAData.invitation._id).lean();

  assert.ok(dbUser);
  assert.ok(dbEmp);
  assert.ok(dbBal);
  assert.ok(dbInv.acceptedAt, 'Invitation must be marked as accepted');

  // Tenant invariants
  assert.equal(dbUser.orgId, tenantAData.organization.orgId);
  assert.equal(dbEmp.orgId, tenantAData.organization.orgId);
  assert.equal(dbBal.orgId, tenantAData.organization.orgId);
  assert.equal(dbUser.orgId, dbEmp.orgId);

  // Verify Employee ID follows EMP-xxx format
  assert.match(dbEmp.employeeId, /^EMP-\d{3,}$/);
});

// -------------------------------------------------------------
// 9. SINGLE-USE GUARANTEE: REUSING TOKEN FAILS (409)
// -------------------------------------------------------------
test('9. Single-Use Guarantee: Attempting to accept an already-consumed invitation fails (409)', async () => {
  const reuseRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: inviteAData.rawToken,
      password: 'AnotherPassword123!',
    }),
  });

  assert.equal(reuseRes.status, 409);
  const data = await reuseRes.json();
  assert.match(data.error, /already been accepted/i);
});

// -------------------------------------------------------------
// 10. ACCEPTANCE TAMPERING DEFENSE
// -------------------------------------------------------------
test('10. Acceptance Tampering: Injected orgId or role in acceptance payload is ignored', async () => {
  // Create another invitation for Tenant A
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'tamper_test@test-invites-a.com',
      role: 'employee',
      firstName: 'Tamper',
      lastName: 'Target',
    }),
  });
  assert.equal(resCreate.status, 201);
  const inviteTamper = await resCreate.json();
  createdTestInviteIds.add(inviteTamper.invitation._id);

  // Invitee tries to inject orgId=Tenant B and role=admin
  const acceptRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: inviteTamper.rawToken,
      password: 'HackerPassword123!',
      orgId: tenantBData.organization.orgId,
      organizationId: tenantBData.organization.orgId,
      role: 'admin',
    }),
  });

  assert.equal(acceptRes.status, 200);
  const tamperData = await acceptRes.json();
  createdTestUserIds.add(tamperData.user.id);

  // Must strictly derive from invitation (Org A, role employee)
  assert.equal(tamperData.user.orgId, tenantAData.organization.orgId);
  assert.notEqual(tamperData.user.orgId, tenantBData.organization.orgId);
  assert.equal(tamperData.user.role, 'employee');
  assert.notEqual(tamperData.user.role, 'admin');
});

// -------------------------------------------------------------
// 11. REVOCATION: REVOKED INVITATION CANNOT BE ACCEPTED (410)
// -------------------------------------------------------------
test('11. Revocation: Admin A revokes invitation; subsequent acceptance fails (410)', async () => {
  // Create invitation to revoke
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'to_be_revoked@test-invites-a.com',
      role: 'employee',
    }),
  });
  const invRevoke = await resCreate.json();
  createdTestInviteIds.add(invRevoke.invitation._id);

  // Revoke it
  const delRes = await fetch(`${BASE_URL}/api/admin/invitations/${invRevoke.invitation._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(delRes.status, 200);

  // Attempt acceptance
  const acceptRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: invRevoke.rawToken,
      password: 'Password123!',
    }),
  });
  assert.equal(acceptRes.status, 410);
});

// -------------------------------------------------------------
// 12. EXPIRATION: EXPIRED INVITATION CANNOT BE ACCEPTED (410)
// -------------------------------------------------------------
test('12. Expiration: Expired invitation is rejected upon acceptance (410)', async () => {
  // Create invitation
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'expired_invite@test-invites-a.com',
      role: 'employee',
    }),
  });
  const invExpired = await resCreate.json();
  createdTestInviteIds.add(invExpired.invitation._id);

  // Manually backdate expiresAt in DB
  await Invitation.updateOne(
    { _id: invExpired.invitation._id },
    { $set: { expiresAt: new Date(Date.now() - 1000 * 60) } }
  );

  // Attempt acceptance
  const acceptRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: invExpired.rawToken,
      password: 'Password123!',
    }),
  });
  assert.equal(acceptRes.status, 410);
});

// -------------------------------------------------------------
// 13. RESEND: GENERATES NEW TOKEN AND INVALIDATES OLD ONE
// -------------------------------------------------------------
test('13. Resend: Generates a fresh raw token and invalidates the old token', async () => {
  // Create invitation
  const resCreate = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'resend_target@test-invites-a.com',
      role: 'employee',
    }),
  });
  const original = await resCreate.json();
  createdTestInviteIds.add(original.invitation._id);

  // Resend invitation
  const resResend = await fetch(`${BASE_URL}/api/admin/invitations/${original.invitation._id}/resend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resResend.status, 200);
  const resent = await resResend.json();
  assert.ok(resent.rawToken);
  assert.notEqual(resent.rawToken, original.rawToken, 'Resend must produce a distinct new token');

  // Old token must fail
  const oldAcceptRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: original.rawToken,
      password: 'Password123!',
    }),
  });
  assert.equal(oldAcceptRes.status, 404, 'Old token must be invalid');

  // New token must succeed
  const newAcceptRes = await fetch(`${BASE_URL}/api/auth/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: resent.rawToken,
      password: 'Password123!',
    }),
  });
  assert.equal(newAcceptRes.status, 200);
  const acceptedData = await newAcceptRes.json();
  createdTestUserIds.add(acceptedData.user.id);
});

// -------------------------------------------------------------
// 14. DUPLICATE USER PROTECTION: CANNOT INVITE EXISTING USER
// -------------------------------------------------------------
test('14. Duplicate Protection: Cannot invite existing user in same or different organization (409)', async () => {
  // Try to invite Admin A (same org)
  const resSame = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: tenantAData.user.email,
      role: 'employee',
    }),
  });
  assert.equal(resSame.status, 409);

  // Try to invite Admin B into Org A (cross-tenant invite collision)
  const resOther = await fetch(`${BASE_URL}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: tenantBData.user.email,
      role: 'employee',
    }),
  });
  assert.equal(resOther.status, 409);
});

// -------------------------------------------------------------
// 15. AUDIT LOGGING FOR INVITATION EVENTS
// -------------------------------------------------------------
test('15. Audit Logging: Invitation lifecycle events are properly recorded with exact tenant context', async () => {
  const auditLogs = await AuditLog.find({
    orgId: tenantAData.organization.orgId,
    targetType: 'invitation',
  }).lean();

  assert.ok(auditLogs.length > 0, 'Audit logs must be created for invitation events');
  const actions = auditLogs.map(l => l.action);
  assert.ok(actions.includes('invitation_created'));
  assert.ok(actions.includes('invitation_accepted'));
  assert.ok(actions.includes('invitation_revoked'));

  for (const log of auditLogs) {
    assert.equal(log.orgId, tenantAData.organization.orgId);
  }
});

// -------------------------------------------------------------
// 16. EXISTING DOPPELMAYR INTEGRITY
// -------------------------------------------------------------
test('16. Existing Doppelmayr records remain 100% intact', async () => {
  const doppelUsers = await User.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelEmps = await Employee.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelSettings = await OrgSettings.countDocuments({ orgId: 'org_doppelmayr' });

  assert.equal(doppelUsers, 9);
  assert.equal(doppelEmps, 9);
  assert.equal(doppelSettings, 1);
});

// -------------------------------------------------------------
// 17. DIRECT MONGODB VERIFICATION & CLEAN TEARDOWN
// -------------------------------------------------------------
test('17. Direct MongoDB Verification: Clean test teardown leaves zero test artifacts', async () => {
  const orgList = Array.from(createdTestOrgs);
  const userList = Array.from(createdTestUserIds);
  const inviteList = Array.from(createdTestInviteIds);

  // Cleanup
  await Organization.deleteMany({ orgId: { $in: orgList } });
  await OrgSettings.deleteMany({ orgId: { $in: orgList } });
  await User.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: userList } }] });
  await Employee.deleteMany({ $or: [{ orgId: { $in: orgList } }, { clerkUserId: { $in: userList } }] });
  await LeaveBalance.deleteMany({ $or: [{ orgId: { $in: orgList } }, { userId: { $in: userList } }] });
  await Invitation.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: inviteList } }] });
  await AuditLog.deleteMany({ orgId: { $in: orgList } });
  await RefreshToken.deleteMany({ userId: { $in: userList } });

  // Assert 0 test artifacts remain
  const testOrgsRemain = await Organization.countDocuments({ orgId: { $ne: 'org_doppelmayr' }, ...FOREIGN.created('organizations') });
  const testUsersRemain = await User.countDocuments({ orgId: { $ne: 'org_doppelmayr' }, ...FOREIGN.created('users') });
  const testInvitesRemain = await Invitation.countDocuments({ orgId: { $ne: 'org_doppelmayr' }, ...FOREIGN.created('invitations') });

  assert.equal(testOrgsRemain, 0);
  assert.equal(testUsersRemain, 0);
  assert.equal(testInvitesRemain, 0);
});
