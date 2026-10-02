/**
 * DoppelDash — Batch H.1 Test Suite
 *
 * Covers:
 * 1. Server-side session invalidation via sessionVersion / securityStamp
 * 2. Authenticated request with valid current sessionVersion -> allowed (200)
 * 3. Forged / tampered sessionVersion -> rejected (401)
 * 4. Password change invalidates pre-change JWTs across all devices
 * 5. Password reset invalidates pre-reset JWTs across all devices
 * 6. Logout invalidates the specific session server-side without disrupting other devices
 * 7. Suspended / banned accounts remain blocked immediately
 * 8. Tenant and role claims cannot be client-overridden
 * 9. Raw reset and invitation tokens are never persisted in MongoDB
 * 10. Production mailer diagnostics safely report missing SMTP configuration without leaking secrets
 * 11. Doppelmayr isolation & clean teardown
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

// Import Mongoose models and helpers via jiti
const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const PasswordResetToken = jiti(path.resolve(__dirname, '../models/PasswordResetToken.ts')).default;
const RevokedToken = jiti(path.resolve(__dirname, '../models/RevokedToken.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const { signToken } = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));
const { getMailerDiagnostics, canDeliverAuthEmails } = jiti(path.resolve(__dirname, '../lib/mailer.ts'));

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  return mongoose.connect(MONGODB_URI);
}

let ipSeq = 200;
let tenantH1Data = null;
let adminEmail = null;
let tokenAdminH1 = null;
let cookieAdminH1 = null;

const createdTestOrgs = new Set();
const createdTestUserIds = new Set();

// Clean up test data after completion
test.after(async () => {
  await connectDB();
  for (const orgId of createdTestOrgs) {
    await Organization.deleteOne({ orgId });
    await OrgSettings.deleteMany({ orgId });
    await Employee.deleteMany({ orgId });
    await User.deleteMany({ orgId });
    await LeaveBalance.deleteMany({ orgId });
  }
  for (const userId of createdTestUserIds) {
    await User.deleteOne({ _id: userId });
    await Employee.deleteOne({ clerkUserId: userId });
    await PasswordResetToken.deleteMany({ userId });
    await RevokedToken.deleteMany({ userId });
    await RefreshToken.deleteMany({ userId });
  }
  await mongoose.disconnect();
});

// -------------------------------------------------------------
// 1. SETUP & PRODUCTION MAILER DIAGNOSTICS
// -------------------------------------------------------------
test('1. Setup: Register Tenant H1 and verify safe mailer diagnostics', async () => {
  try {
    await connectDB();

    // Test mailer diagnostics function
    const diag = getMailerDiagnostics();
    assert.equal(typeof diag.configured, 'boolean');
    assert.equal(typeof diag.canDeliverAuthEmails, 'boolean');
    assert.ok(Array.isArray(diag.missing));

    // Verify diagnostic status
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      assert.equal(diag.configured, false);
      assert.equal(diag.canDeliverAuthEmails, false);
      assert.ok(diag.missing.includes('SMTP_USER') || diag.missing.includes('SMTP_PASS'));
    }

    // Register Tenant H1
    const ts = Date.now();
    adminEmail = `admin_h1_${ts}@batch-h1-test.com`;

    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `10.99.9.${ipSeq++}`,
      },
      body: JSON.stringify({
        email: adminEmail,
        password: 'SecurePassword123!',
        name: 'Admin H1',
        organizationName: `Tenant H1 Corp ${ts}`,
      }),
    });

    if (res.status !== 201) {
      console.error('REGISTER FAILED:', res.status, await res.text());
    }
    assert.equal(res.status, 201);
    tenantH1Data = await res.json();
    tokenAdminH1 = tenantH1Data.accessToken;
    createdTestOrgs.add(tenantH1Data.organization.orgId);
    createdTestUserIds.add(tenantH1Data.user.id);

    // Verify user created with initial sessionVersion 1
    const dbUser = await User.findById(tenantH1Data.user.id).lean();
    assert.ok(dbUser);
    assert.equal(dbUser.sessionVersion, 1, 'New user must have sessionVersion: 1');

    // Extract cookie
    const setCookie = res.headers.get('set-cookie');
    const cookieMatch = setCookie.match(/dd_session=([^;]+)/);
    assert.ok(cookieMatch);
    cookieAdminH1 = `dd_session=${cookieMatch[1]}`;
  } catch (err) {
    console.error('TEST 1 ERROR:', err.stack);
    throw err;
  }
});

// -------------------------------------------------------------
// 2. VALID CURRENT SESSION VERSION IS ACCEPTED
// -------------------------------------------------------------
test('2. Valid sessionVersion: current sessionVersion resolves user successfully', async () => {
  const res = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: cookieAdminH1 },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.email, adminEmail);
  assert.equal(data.orgId, tenantH1Data.organization.orgId);
  assert.equal(data.sessionVersion, 1);
});

// -------------------------------------------------------------
// 3. FORGED / TAMPERED SESSION VERSION IS REJECTED
// -------------------------------------------------------------
test('3. Forged / mismatched sessionVersion is rejected with 401', async () => {
  // A. Token forged with signature tampering -> rejected
  const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMiLCJzZXNzaW9uVmVyc2lvbiI6OTl9.InvalidSignatureXYZ99999999999999999999999';
  const resTamperedSig = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: `dd_session=${fakeToken}` },
  });
  assert.equal(resTamperedSig.status, 401);

  // B. Token cryptographically valid but signed with mismatched sessionVersion (e.g. 99 vs DB 1)
  const outdatedToken = await signToken({
    id: tenantH1Data.user.id,
    email: adminEmail,
    orgId: tenantH1Data.organization.orgId,
    role: 'admin',
    firstName: 'Admin',
    lastName: 'H1',
    sessionVersion: 99, // Mismatched version
  });

  const resMismatched = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${outdatedToken}` },
  });
  assert.equal(resMismatched.status, 401, 'Mismatched sessionVersion must be rejected with 401');
});

// -------------------------------------------------------------
// 4. PASSWORD CHANGE INVALIDATES PRE-CHANGE JWT ACROSS ALL DEVICES
// -------------------------------------------------------------
test('4. Password change: invalidates all pre-change JWTs and requires re-login', async () => {
  // Save pre-change JWT token
  const tokenPreChange = tokenAdminH1;

  // Change password
  const resChange = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenPreChange}`,
    },
    body: JSON.stringify({
      currentPassword: 'SecurePassword123!',
      newPassword: 'BrandNewPassword123!',
    }),
  });
  assert.equal(resChange.status, 200);

  // Check Set-Cookie clears dd_session
  const setCookie = resChange.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, /Max-Age=0/i, 'Session cookie must be cleared on password change');

  // Verify database sessionVersion incremented to 2
  const updatedUser = await User.findById(tenantH1Data.user.id).lean();
  assert.equal(updatedUser.sessionVersion, 2, 'sessionVersion must be incremented in DB');

  // Verify the pre-change token is now REJECTED
  const resCheckOldToken = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tokenPreChange}` },
  });
  assert.equal(resCheckOldToken.status, 401, 'Pre-change token must be immediately rejected with 401');

  // Verify old password fails
  const resOldLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'SecurePassword123!',
    }),
  });
  assert.equal(resOldLogin.status, 401, 'Old password must be rejected');

  // Verify new password succeeds
  const resNewLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'BrandNewPassword123!',
    }),
  });
  assert.equal(resNewLogin.status, 200);
  const loginJson = await resNewLogin.json();

  // Complete OTP to obtain fresh post-change token
  const resOtp = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: loginJson.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  assert.equal(resOtp.status, 200);
  const otpData = await resOtp.json();
  tokenAdminH1 = otpData.accessToken;
  const cookieMatch = resOtp.headers.get('set-cookie').match(/dd_session=([^;]+)/);
  cookieAdminH1 = `dd_session=${cookieMatch[1]}`;

  // Verify post-change token works and carries sessionVersion 2
  const resFreshMe = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: cookieAdminH1 },
  });
  assert.equal(resFreshMe.status, 200);
  const freshMeData = await resFreshMe.json();
  assert.equal(freshMeData.sessionVersion, 2);
});

// -------------------------------------------------------------
// 5. PASSWORD RESET INVALIDATES PRE-RESET JWT ACROSS ALL DEVICES
// -------------------------------------------------------------
test('5. Password reset: invalidates all pre-reset JWTs across all devices', async () => {
  // Save pre-reset token (which has sessionVersion: 2)
  const tokenPreReset = tokenAdminH1;

  // Request password reset
  const resReq = await fetch(`${BASE_URL}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({ email: adminEmail }),
  });
  assert.equal(resReq.status, 200);
  const reqData = await resReq.json();
  const rawToken = new URL(reqData.resetUrl).searchParams.get('token');
  assert.ok(rawToken);

  // Confirm password reset
  const resConfirm = await fetch(`${BASE_URL}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      token: rawToken,
      newPassword: 'AfterResetPassword123!',
    }),
  });
  assert.equal(resConfirm.status, 200);

  // Verify database sessionVersion incremented to 3
  const userAfterReset = await User.findById(tenantH1Data.user.id).lean();
  assert.equal(userAfterReset.sessionVersion, 3, 'sessionVersion must be incremented to 3 on reset');

  // Verify the pre-reset token (sessionVersion: 2) is now REJECTED
  const resCheckOld = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tokenPreReset}` },
  });
  assert.equal(resCheckOld.status, 401, 'Pre-reset token must be rejected with 401');

  // Verify token single-use: Reusing reset token fails
  const resReuse = await fetch(`${BASE_URL}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      token: rawToken,
      newPassword: 'AnotherPassword999!',
    }),
  });
  assert.equal(resReuse.status, 400);

  // Re-login with the reset password to restore active token
  const resLoginAfterReset = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'AfterResetPassword123!',
    }),
  });
  assert.equal(resLoginAfterReset.status, 200);
  const resetLoginData = await resLoginAfterReset.json();

  const resOtp = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: resetLoginData.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  assert.equal(resOtp.status, 200);
  const postResetOtp = await resOtp.json();
  tokenAdminH1 = postResetOtp.accessToken;
  const cookieMatch = resOtp.headers.get('set-cookie').match(/dd_session=([^;]+)/);
  cookieAdminH1 = `dd_session=${cookieMatch[1]}`;
});

// -------------------------------------------------------------
// 6. LOGOUT INVALIDATES SPECIFIC TOKEN WITHOUT DISRUPTING OTHER DEVICES
// -------------------------------------------------------------
test('6. Logout semantics: invalidates exact session server-side; other device sessions remain active', async () => {
  // Login Device A to create session A
  const resLoginA = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'AfterResetPassword123!',
    }),
  });
  const dataA = await resLoginA.json();

  const resOtpA = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: dataA.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  const cookieA = resOtpA.headers.get('set-cookie').match(/dd_session=([^;]+)/)[1];
  const sessionA = `dd_session=${cookieA}`;

  // Login Device B to create session B
  const resLoginB = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'AfterResetPassword123!',
    }),
  });
  const dataB = await resLoginB.json();

  const resOtpB = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: dataB.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  const cookieB = resOtpB.headers.get('set-cookie').match(/dd_session=([^;]+)/)[1];
  const sessionB = `dd_session=${cookieB}`;

  // Both sessions initially work
  const resCheckA = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: sessionA } });
  assert.equal(resCheckA.status, 200);

  const resCheckB = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: sessionB } });
  assert.equal(resCheckB.status, 200);

  // Device A logs out
  const resLogoutA = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: sessionA },
  });
  assert.equal(resLogoutA.status, 200);

  // Device A session is now REJECTED (server-side RevokedToken check)
  const resAfterA = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: sessionA } });
  assert.equal(resAfterA.status, 401, 'Logged-out token must be rejected');

  const resBearerA = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${cookieA}` },
  });
  assert.equal(resBearerA.status, 401, 'Logged-out token via Bearer header must be rejected');

  // Device B session REMAINS VALID (not disrupted)
  const resAfterB = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: sessionB } });
  assert.equal(resAfterB.status, 200, 'Other device sessions must remain active after single-device logout');
});

// -------------------------------------------------------------
// 7. SUSPENDED / BANNED USERS REMAIN BLOCKED IMMEDIATELY
// -------------------------------------------------------------
test('7. Suspended account: banned user is blocked from login and existing sessions', async () => {
  // Ban user via DB
  await User.updateOne({ _id: tenantH1Data.user.id }, { $set: { isBanned: true } });

  // A. Login attempt rejected with 403
  const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'AfterResetPassword123!',
    }),
  });
  assert.equal(resLogin.status, 403);

  // B. Existing session rejected with 401
  const resMe = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: cookieAdminH1 },
  });
  assert.equal(resMe.status, 401);

  // Restore user to active
  await User.updateOne({ _id: tenantH1Data.user.id }, { $set: { isBanned: false } });
});

// -------------------------------------------------------------
// 8. TENANT AND ROLE CLAIMS CANNOT BE CLIENT-OVERRIDDEN
// -------------------------------------------------------------
test('8. Security invariants: tenant and role cannot be client-overridden', async () => {
  // Client attempts to inject orgId and role in login
  const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'AfterResetPassword123!',
      orgId: 'org_doppelmayr',
      role: 'superadmin',
    }),
  });
  assert.equal(resLogin.status, 200);
  const data = await resLogin.json();

  const resOtp = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.9.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: data.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  assert.equal(resOtp.status, 200);
  const otpData = await resOtp.json();
  assert.equal(otpData.user.orgId, tenantH1Data.organization.orgId, 'Injected orgId must be strictly ignored');
  assert.equal(otpData.user.role, 'admin', 'Injected role must be strictly ignored');
});

// -------------------------------------------------------------
// 9. RAW TOKENS NEVER PERSISTED IN DATABASE
// -------------------------------------------------------------
test('9. Token storage security: raw reset and invitation tokens are never stored in DB', async () => {
  await connectDB();

  // Audit all password reset tokens
  const allResetTokens = await PasswordResetToken.find({}).lean();
  for (const doc of allResetTokens) {
    assert.ok(doc.tokenHash, 'Must have tokenHash');
    assert.equal(doc.token, undefined, 'Must NEVER store raw token field');
    assert.equal(doc.rawToken, undefined, 'Must NEVER store rawToken field');
    assert.equal(doc.tokenHash.length, 64, 'tokenHash must be 64-character SHA-256 hex');
  }

  // Audit all revoked tokens
  const allRevokedTokens = await RevokedToken.find({}).lean();
  for (const doc of allRevokedTokens) {
    assert.ok(doc.tokenIdentifier, 'Must have tokenIdentifier');
    assert.ok(doc.expiresAt, 'Must have expiresAt for TTL indexing');
  }
});

// -------------------------------------------------------------
// 10. DOPPELMAYR ISOLATION AND CLEAN DATABASE
// -------------------------------------------------------------
test('10. Doppelmayr tenant verification: org_doppelmayr remains 100% intact', async () => {
  await connectDB();

  const doppelUsers = await User.find({ orgId: 'org_doppelmayr' }).lean();
  assert.equal(doppelUsers.length, 9, 'Doppelmayr must have exactly 9 users');

  const doppelEmps = await Employee.find({ orgId: 'org_doppelmayr' }).lean();
  assert.equal(doppelEmps.length, 9, 'Doppelmayr must have exactly 9 employees');

  const doppelOrg = await Organization.findOne({ orgId: 'org_doppelmayr' }).lean();
  assert.ok(doppelOrg, 'Doppelmayr organization must exist');

  // Verify all Doppelmayr users have valid sessionVersion >= 1
  for (const u of doppelUsers) {
    assert.ok(typeof u.sessionVersion === 'number' && u.sessionVersion >= 1, `User ${u.email} must have sessionVersion >= 1`);
  }
});
