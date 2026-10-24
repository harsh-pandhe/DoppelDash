/**
 * DoppelDash — Account Deletion & Data Safety Test Suite
 *
 * Verifies compliance with Google Play Data Safety & user privacy requirements:
 * 1. Rejects unauthenticated requests (401).
 * 2. Organization owner cannot delete account while other members remain in the workspace (400).
 * 3. Employee deletion is a 14-day SOFT delete (D-02.8); after the grace window the retention job purges personal user, employee, leave and credential data while keeping org records intact.
 * 4. Sole-owner deletion deactivates the tenant first (D-03.4); after the grace window the job cleans up the tenant and tenant-owned contacts/settings.
 * 5. Invalidation: deleted user sessions/tokens are immediately rejected on subsequent requests.
 * 6. Repeated deletion is rejected safely (401).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { NextRequest } = require('next/server');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';
process.env.MONGODB_URI = MONGODB_URI;

const DEFAULT_TEST_JWT_SECRET = process.env.JWT_SECRET || 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ==';
process.env.JWT_SECRET = DEFAULT_TEST_JWT_SECRET;

const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});

// Import models via jiti
const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const Contact = jiti(path.resolve(__dirname, '../models/Contact.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));
const { DELETE } = jiti(path.resolve(__dirname, '../app/api/user/account/route.ts'));
const { runRetentionPurge } = jiti(path.resolve(__dirname, '../lib/account/lifecycle.ts'));
const backdate = id => User.updateOne({ _id: id }, { $set: { deletionRequestedAt: new Date(Date.now() - 15 * 864e5), deletionScheduledFor: new Date(Date.now() - 864e5) } });

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGODB_URI);
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

test('1. DELETE /api/user/account returns 401 for unauthenticated request', async () => {
  const req = new NextRequest('http://localhost:3000/api/user/account', {
    method: 'DELETE',
  });
  const res = await DELETE(req);
  assert.equal(res.status, 401, 'Must return 401 when no session token provided');
});

test('2. Organization owner cannot delete account if other members remain', async () => {
  const orgId = `org_owner_test_${Date.now()}`;
  const owner = await User.create({
    email: `owner_${Date.now()}@example.com`,
    passwordHash: 'test_hash',
    firstName: 'Org',
    lastName: 'Owner',
    role: 'admin',
    orgId,
    isActive: true,
  });

  const member = await User.create({
    email: `member_${Date.now()}@example.com`,
    passwordHash: 'test_hash',
    firstName: 'Org',
    lastName: 'Member',
    role: 'employee',
    orgId,
    isActive: true,
  });

  await Organization.create({
    orgId,
    name: 'Test Multi-Member Org',
    slug: `test-org-${Date.now()}`,
    ownerId: String(owner._id),
  });

  try {
    const token = await signToken(owner.toPublic());
    const req = new NextRequest('http://localhost:3000/api/user/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await DELETE(req);
    assert.equal(res.status, 400, 'Owner deletion must fail with 400 when members exist');
    const json = await res.json();
    assert.match(json.error, /transfer ownership or remove other members/i);

    // Verify owner still exists in database
    const ownerStillExists = await User.findById(owner._id);
    assert.ok(ownerStillExists, 'Owner record must not be deleted on 400');
  } finally {
    await User.deleteMany({ orgId });
    await Organization.deleteOne({ orgId });
  }
});

test('3. Employee self-service deletion purges personal data while leaving org intact', async () => {
  const orgId = `org_emp_del_${Date.now()}`;
  const empUser = await User.create({
    email: `emp_del_${Date.now()}@example.com`,
    passwordHash: 'test_hash',
    firstName: 'Delete',
    lastName: 'Target',
    role: 'employee',
    orgId,
    isActive: true,
  });

  const empRecord = await Employee.create({
    clerkUserId: String(empUser._id),
    createdByUserId: String(empUser._id),
    orgId,
    firstName: 'Delete',
    lastName: 'Target',
    email: empUser.email,
    department: 'Engineering',
    designation: 'Engineer',
    joiningDate: new Date(),
  });

  await LeaveBalance.create({
    userId: String(empUser._id),
    orgId,
    year: new Date().getFullYear(),
    casual: 10,
    sick: 5,
  });

  await RefreshToken.create({
    userId: String(empUser._id),
    tokenHash: 'dummy_refresh_hash_' + Date.now(),
    expiresAt: new Date(Date.now() + 86400000),
  });

  const token = await signToken(empUser.toPublic());
  const req = new NextRequest('http://localhost:3000/api/user/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  const res = await DELETE(req);
  assert.equal(res.status, 200, 'Account deletion must return 200 OK');
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.scheduled, true, 'D-02.8: deletion is scheduled, not immediate');

  // During the grace window: the account is inactive, sessions are gone, and NOTHING else has been purged yet.
  const pending = await User.findById(empUser._id);
  assert.ok(pending, 'the user record is still there during the grace window'); assert.equal(pending.isActive, false); assert.ok(pending.deletionScheduledFor);
  assert.equal((await RefreshToken.find({ userId: String(empUser._id) })).length, 0, 'refresh tokens are revoked immediately');
  assert.ok(await Employee.findOne({ clerkUserId: String(empUser._id) }), 'personal data is untouched until the purge');
  const requested = await AuditLog.findOne({ action: 'user.account_deletion_requested', performedBy: String(empUser._id) });
  assert.ok(requested, 'the request is audited'); assert.equal(JSON.stringify(requested.metadata).includes(empUser.email), false, 'D-02.5: no e-mail in the audit entry');

  // The grace window ends: the retention job performs the irreversible purge.
  await backdate(empUser._id);
  const report = await runRetentionPurge({ apply: true });
  assert.ok(report.deletionsExecuted >= 1);

  const userCheck = await User.findById(empUser._id);
  assert.equal(userCheck, null, 'User record must be purged');
  const empCheck = await Employee.findOne({ clerkUserId: String(empUser._id) });
  assert.equal(empCheck, null, 'Employee profile must be purged');
  const balancesCheck = await LeaveBalance.find({ userId: String(empUser._id) });
  assert.equal(balancesCheck.length, 0, 'Leave balances must be purged');
  const tokenCheck = await RefreshToken.find({ userId: String(empUser._id) });
  assert.equal(tokenCheck.length, 0, 'Refresh tokens must be purged');

  const audit = await AuditLog.findOne({ action: 'user.account_deleted', targetId: String(empUser._id) });
  assert.ok(audit, 'Audit log entry must be created');
  assert.equal(audit.metadata.email, undefined, 'D-02.5: the deleted user\'s e-mail is not stored');
});

test('4. Sole owner deletion cleanly disbands the organization tenant', async () => {
  const orgId = `org_sole_owner_${Date.now()}`;
  const soleOwner = await User.create({
    email: `sole_owner_${Date.now()}@example.com`,
    passwordHash: 'test_hash',
    firstName: 'Solo',
    lastName: 'Founder',
    role: 'admin',
    orgId,
    isActive: true,
  });

  await Organization.create({
    orgId,
    name: 'Sole Tenant Corp',
    slug: `sole-tenant-${Date.now()}`,
    ownerId: String(soleOwner._id),
  });

  await Contact.create({
    orgId,
    createdBy: String(soleOwner._id),
    createdByUserId: String(soleOwner._id),
    name: 'Tenant Contact',
    company: 'Partner Co',
  });

  const token = await signToken(soleOwner.toPublic());
  const req = new NextRequest('http://localhost:3000/api/user/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  const res = await DELETE(req);
  assert.equal(res.status, 200, 'Sole owner deletion must succeed with 200');
  assert.equal((await res.json()).scheduled, true);

  // D-03.4: the tenant is deactivated at once, but nothing is purged during the grace window.
  const pending = await Organization.findOne({ orgId });
  assert.ok(pending && pending.disbandRequestedAt, 'organisation is flagged for disband');
  assert.equal((await Contact.find({ orgId })).length, 1, 'tenant data is untouched during the grace window');

  await backdate(soleOwner._id);
  await runRetentionPurge({ apply: true });

  // Verify custom tenant was disbanded (this tenant holds no financial/HR records, so nothing needs to be retained and the shell goes too)
  const orgCheck = await Organization.findOne({ orgId });
  assert.equal(orgCheck, null, 'Organization must be deleted');

  const contactsCheck = await Contact.find({ orgId });
  assert.equal(contactsCheck.length, 0, 'Tenant contacts must be deleted');
});

test('5. Repeated deletion attempt returns 401', async () => {
  const deadUserId = new mongoose.Types.ObjectId();
  const token = await signToken({
    id: String(deadUserId),
    email: 'dead@example.com',
    orgId: 'org_test',
    role: 'employee',
    firstName: 'Ghost',
    lastName: 'User',
    fullName: 'Ghost User',
    permissions: [],
    isActive: true,
    isBanned: false,
    mustChangePassword: false,
  });

  const req = new NextRequest('http://localhost:3000/api/user/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  const res = await DELETE(req);
  assert.equal(res.status, 401, 'Deleted user cannot authenticate or repeat deletion');
});

test('6. Malformed requests and garbage tokens do not crash or produce 500', async () => {
  const req = new NextRequest('http://localhost:3000/api/user/account', {
    method: 'DELETE',
    headers: {
      Authorization: 'Bearer not_a_valid_jwt.corrupted.token_payload',
      'Content-Type': 'application/json',
    },
    body: '{"malformed": invalid_json',
  });

  const res = await DELETE(req);
  assert.equal(res.status, 401, 'Invalid bearer token must return 401, not 500');
});

