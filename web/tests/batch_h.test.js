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
const PasswordResetToken = jiti(path.resolve(__dirname, '../models/PasswordResetToken.ts')).default;
const AuditLog = jiti(path.resolve(__dirname, '../models/AuditLog.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;

// Tracking sets for safe teardown
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();
const createdTestResetTokenIds = new Set();

let tenantHData = null;
let tokenAdminH = null;
let cookieAdminH = null;
let doppelmayrUsersBaseline = 0;

let ipSeq = 800;
function registerPost(body) {
  return fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
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
  const resetList = Array.from(createdTestResetTokenIds);

  if (orgList.length > 0 || userList.length > 0 || resetList.length > 0) {
    await Organization.deleteMany({ orgId: { $in: orgList } });
    await OrgSettings.deleteMany({ orgId: { $in: orgList } });
    await User.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: userList } }] });
    await Employee.deleteMany({ $or: [{ orgId: { $in: orgList } }, { clerkUserId: { $in: userList } }] });
    await LeaveBalance.deleteMany({ $or: [{ orgId: { $in: orgList } }, { userId: { $in: userList } }] });
    await PasswordResetToken.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: resetList } }] });
    await AuditLog.deleteMany({ orgId: { $in: orgList } });
    await RefreshToken.deleteMany({ userId: { $in: userList } });
  }

  // Ensure Doppelmayr invariant
  const doppelmayrUsersAfter = await User.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelmayrUsersAfter, doppelmayrUsersBaseline, 'Doppelmayr user count must not change');

  await mongoose.disconnect();
});

// -------------------------------------------------------------
// 1. SETUP: REGISTER TENANT H ADMIN
// -------------------------------------------------------------
let adminEmail = null;
test('1. Setup: Register Tenant H admin with secure session cookie', async () => {
  const ts = Date.now();
  adminEmail = `admin_h_${ts}@batch-h-test.com`;

  const res = await registerPost({
    organizationName: 'Batch H Testing Org',
    name: 'Admin Batch H',
    email: adminEmail,
    password: 'SecurePassword123!',
  });

  assert.equal(res.status, 201);
  tenantHData = await res.json();
  tokenAdminH = tenantHData.accessToken;
  createdTestOrgs.add(tenantHData.organization.orgId);
  createdTestUserIds.add(tenantHData.user.id);

  // Extract dd_session cookie
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Must set auth cookie');
  assert.match(setCookie, /dd_session=/);
  const cookieMatch = setCookie.match(/dd_session=([^;]+)/);
  assert.ok(cookieMatch, 'Must capture dd_session value');
  cookieAdminH = `dd_session=${cookieMatch[1]}`;
});

// -------------------------------------------------------------
// 2. LOGIN FLOW, WRONG PASSWORD, AND ENUMERATION RESISTANCE
// -------------------------------------------------------------
test('2. Login verification: correct credentials, wrong password, and nonexistent account', async () => {
  // A. Correct credentials
  const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'SecurePassword123!',
      orgId: 'org_doppelmayr', // Client injection attempt
      role: 'superadmin',      // Client injection attempt
    }),
  });
  assert.equal(resLogin.status, 200);
  const loginData = await resLogin.json();
  assert.equal(loginData.step, 'verify');
  assert.ok(loginData.preAuthToken, 'Must issue signed preAuthToken');
  assert.equal(loginData.email, adminEmail);

  const resOtp = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: loginData.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  assert.equal(resOtp.status, 200);
  const otpData = await resOtp.json();
  assert.equal(otpData.user.orgId, tenantHData.organization.orgId, 'Must enforce DB orgId, ignoring injected orgId');
  assert.equal(otpData.user.role, 'admin');

  // Verify Set-Cookie header contains dd_session
  const setCookie = resOtp.headers.get('set-cookie');
  assert.match(setCookie, /dd_session=/);
  assert.match(setCookie, /HttpOnly/i, 'Session cookie must be HttpOnly');
  assert.match(setCookie, /SameSite=Lax/i, 'Session cookie must have SameSite=Lax');

  // B. Wrong password
  const resBadPwd = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'IncorrectPassword999!',
    }),
  });
  assert.equal(resBadPwd.status, 401);
  const badPwdData = await resBadPwd.json();
  assert.match(badPwdData.error, /invalid email or password/i);

  // C. Nonexistent account (constant-time, same 401 error message to prevent enumeration)
  const resNoUser = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: `nonexistent_user_${Date.now()}@unknown.org`,
      password: 'SomePassword123!',
    }),
  });
  assert.equal(resNoUser.status, 401);
  const noUserData = await resNoUser.json();
  assert.match(noUserData.error, /invalid email or password/i);
});

// -------------------------------------------------------------
// 3. SESSION SECURITY: TAMPERING, MALFORMED TOKEN, & EXPIRY
// -------------------------------------------------------------
test('3. Session security: authenticated route works, missing/forged/malformed token rejected', async () => {
  // A. Valid session via cookie
  const resMe = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: cookieAdminH },
  });
  assert.equal(resMe.status, 200);
  const meData = await resMe.json();
  assert.equal(meData.email, adminEmail);
  assert.equal(meData.orgId, tenantHData.organization.orgId);

  // B. Missing session
  const resNoAuth = await fetch(`${BASE_URL}/api/auth/me`);
  assert.equal(resNoAuth.status, 401);

  // C. Malformed token (must not crash the server)
  const resMalformed = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: 'dd_session=not.a.valid.jwt.token' },
  });
  assert.equal(resMalformed.status, 401);

  // D. Forged signature / client-tampered payload
  const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NSIsIm9yZ0lkIjoib3JnX2RvcHBlbG1heXIiLCJyb2xlIjoiYWRtaW4ifQ.InsecureSignatureSample999999999999999999999';
  const resForged = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: `dd_session=${fakeToken}` },
  });
  assert.equal(resForged.status, 401);
});

// -------------------------------------------------------------
// 4. LOGOUT FLOW
// -------------------------------------------------------------
test('4. Logout clears session cookie and subsequent requests are rejected', async () => {
  // Login to create a dedicated session to test logout revocation
  const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'SecurePassword123!',
    }),
  });
  assert.equal(resLogin.status, 200);
  const loginData = await resLogin.json();

  const resOtp = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: loginData.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  assert.equal(resOtp.status, 200);
  const cookieMatch = resOtp.headers.get('set-cookie').match(/dd_session=([^;]+)/);
  const loggedOutToken = cookieMatch[1];
  const sessionToLogout = `dd_session=${loggedOutToken}`;

  const resLogout = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: sessionToLogout },
  });
  assert.equal(resLogout.status, 200);

  // Check Set-Cookie clears dd_session
  const setCookie = resLogout.headers.get('set-cookie');
  assert.ok(setCookie, 'Must return Set-Cookie');
  assert.match(setCookie, /dd_session=;/);
  assert.match(setCookie, /Max-Age=0/i);

  // Subsequent request with the cleared cookie fails
  const resAfter = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: 'dd_session=' },
  });
  assert.equal(resAfter.status, 401);

  // Subsequent request with the exact logged-out token via Authorization header also fails server-side
  const resBearerAfter = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loggedOutToken}` },
  });
  assert.equal(resBearerAfter.status, 401, 'Logged-out token must be rejected server-side via RevokedToken');
});

// -------------------------------------------------------------
// 5. ROLE & TENANT INVARIANTS (EMPLOYEE RBAC)
// -------------------------------------------------------------
let empUser = null;
let empToken = null;
let empCookie = null;
let empPassword = null;

test('5. Role and tenant invariants: Employee created in Tenant H cannot access Admin endpoints', async () => {
  const ts = Date.now();
  const empEmail = `employee_h_${ts}@batch-h-test.com`;

  // Admin H creates Employee H via User creation API
  const resCreate = await fetch(`${BASE_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminH}`,
    },
    body: JSON.stringify({
      email: empEmail,
      firstName: 'Emily',
      lastName: 'Employee',
      newRole: 'employee',
      department: 'Testing',
      designation: 'QA Engineer',
      skipWelcomeEmail: true,
    }),
  });
  assert.equal(resCreate.status, 200);
  const createdData = await resCreate.json();
  const tempPassword = createdData.tempPassword;
  assert.ok(tempPassword);
  empPassword = tempPassword;

  empUser = await User.findOne({ email: empEmail });
  assert.ok(empUser);
  assert.equal(empUser.orgId, tenantHData.organization.orgId);
  assert.equal(empUser.role, 'employee');
  createdTestUserIds.add(empUser._id.toString());

  // Employee H logs in
  const resEmpLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: empEmail,
      password: tempPassword,
    }),
  });
  assert.equal(resEmpLogin.status, 200);
  const empLoginData = await resEmpLogin.json();

  // Complete OTP
  const resEmpOtp = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      preAuthToken: empLoginData.preAuthToken,
      otp: '112022',
      method: 'email',
    }),
  });
  assert.equal(resEmpOtp.status, 200);
  const empOtpData = await resEmpOtp.json();
  empToken = empOtpData.accessToken;
  const cookieMatch = resEmpOtp.headers.get('set-cookie').match(/dd_session=([^;]+)/);
  empCookie = `dd_session=${cookieMatch[1]}`;

  // Employee H calls admin-only endpoint -> 403 Forbidden
  const resAdminRoute = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: { Cookie: empCookie },
  });
  assert.equal(resAdminRoute.status, 403, 'Employee must be rejected from admin routes with 403');
});

// -------------------------------------------------------------
// 6. ACCOUNT STATUS: SUSPENDED USER BLOCKED FROM LOGIN & APIS
// -------------------------------------------------------------
test('6. Suspended account: banned user cannot log in and existing session is rejected', async () => {
  // Suspend employee via Admin PATCH
  const resBan = await fetch(`${BASE_URL}/api/admin/users/${empUser._id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminH}`,
    },
    body: JSON.stringify({ banned: true }),
  });
  assert.equal(resBan.status, 200);

  try {
    // A. Suspended user login attempt is rejected with 403
    const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `10.99.8.${ipSeq++}`,
      },
      body: JSON.stringify({
        email: empUser.email,
        password: empPassword,
      }),
    });
    assert.equal(resLogin.status, 403);
    const loginErr = await resLogin.json();
    assert.match(loginErr.error, /suspended/i);

    // B. Suspended user's existing session cookie is immediately rejected via getUser() DB check
    const resProtected = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: empCookie },
    });
    assert.equal(resProtected.status, 401, 'Existing session of banned user must be rejected immediately');
  } finally {
    // Unban employee for subsequent tests
    const resUnban = await fetch(`${BASE_URL}/api/admin/users/${empUser._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdminH}`,
      },
      body: JSON.stringify({ banned: false }),
    });
    assert.equal(resUnban.status, 200);
  }
});

// -------------------------------------------------------------
// 7. CHANGE PASSWORD: VALIDATION, RE-AUTH, & OLD PASSWORD EXPIRY
// -------------------------------------------------------------
test('7. Change password: short password rejected, wrong current password rejected, valid update invalidates old password', async () => {
  // A. Short password (< 8 chars) rejected
  const resShort = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminH}`,
    },
    body: JSON.stringify({
      currentPassword: 'SecurePassword123!',
      newPassword: 'short',
    }),
  });
  assert.equal(resShort.status, 400);

  // B. Wrong current password rejected
  const resWrongCur = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminH}`,
    },
    body: JSON.stringify({
      currentPassword: 'WrongCurrentPassword999!',
      newPassword: 'NewValidPassword123!',
    }),
  });
  assert.equal(resWrongCur.status, 401);

  // C. Valid password change
  const resChange = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminH}`,
    },
    body: JSON.stringify({
      currentPassword: 'SecurePassword123!',
      newPassword: 'BrandNewSecurePassword123!',
    }),
  });
  assert.equal(resChange.status, 200);

  // D. Old password fails on login
  const resOldLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'SecurePassword123!',
    }),
  });
  assert.equal(resOldLogin.status, 401);

  // E. New password succeeds on login
  const resNewLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'BrandNewSecurePassword123!',
    }),
  });
  assert.equal(resNewLogin.status, 200);
});

// -------------------------------------------------------------
// 8. PASSWORD RESET LIFECYCLE & ENUMERATION RESISTANCE
// -------------------------------------------------------------
let resetTokenRaw = null;

test('8. Password reset request: generic response prevents enumeration, raw token never stored in DB', async () => {
  // A. Request reset for unknown email -> generic 200 response
  const resUnknown = await fetch(`${BASE_URL}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({ email: `ghost_user_${Date.now()}@nowhere.com` }),
  });
  assert.equal(resUnknown.status, 200);
  const unknownData = await resUnknown.json();
  assert.match(unknownData.message, /If an account exists.*link has been sent/i);

  // B. Request reset for existing admin
  const resValidReq = await fetch(`${BASE_URL}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({ email: adminEmail }),
  });
  assert.equal(resValidReq.status, 200);
  const validData = await resValidReq.json();
  assert.match(validData.message, /If an account exists.*link has been sent/i);
  assert.ok(validData.resetUrl, 'Dev/test environment surfaces resetUrl');

  // Extract token from URL
  const resetUrl = new URL(validData.resetUrl);
  resetTokenRaw = resetUrl.searchParams.get('token');
  assert.ok(resetTokenRaw);
  assert.equal(resetTokenRaw.length, 64, 'Token must be high-entropy 256-bit hex (64 chars)');

  // Verify in MongoDB: RAW token must NOT be in MongoDB, ONLY tokenHash
  const tokenDoc = await PasswordResetToken.findOne({ email: adminEmail }).sort({ createdAt: -1 });
  assert.ok(tokenDoc);
  createdTestResetTokenIds.add(tokenDoc._id.toString());
  assert.ok(tokenDoc.tokenHash);
  assert.notEqual(tokenDoc.tokenHash, resetTokenRaw, 'Raw token must never be stored in MongoDB');
  assert.equal(tokenDoc.tokenHash, PasswordResetToken.hashToken(resetTokenRaw));

  // C. Token verification endpoint
  const resVerify = await fetch(`${BASE_URL}/api/auth/password-reset/confirm?token=${resetTokenRaw}`);
  assert.equal(resVerify.status, 200);
  const verifyData = await resVerify.json();
  assert.equal(verifyData.valid, true);
  assert.equal(verifyData.email, adminEmail);
});

// -------------------------------------------------------------
// 9. PASSWORD RESET CONFIRMATION & SINGLE-USE GUARANTEE
// -------------------------------------------------------------
test('9. Password reset confirmation: executes successfully, rejects client tampering, and enforces single-use', async () => {
  // Attacker tries to inject role: 'admin' and orgId: 'org_doppelmayr' during reset
  const resConfirm = await fetch(`${BASE_URL}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      token: resetTokenRaw,
      newPassword: 'AfterResetPassword123!',
      role: 'superadmin',       // Tamper attempt
      orgId: 'org_doppelmayr',   // Tamper attempt
    }),
  });
  assert.equal(resConfirm.status, 200);
  const confirmData = await resConfirm.json();
  assert.match(confirmData.message, /reset successfully/i);

  // Verify user's tenant and role did NOT change in MongoDB
  const freshAdmin = await User.findOne({ email: adminEmail });
  assert.equal(freshAdmin.orgId, tenantHData.organization.orgId, 'Reset must not move account between organizations');
  assert.equal(freshAdmin.role, 'admin');

  // Verify single-use: Reusing the same token fails with 400
  const resReuse = await fetch(`${BASE_URL}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      token: resetTokenRaw,
      newPassword: 'AnotherPassword999!',
    }),
  });
  assert.equal(resReuse.status, 400);
  const reuseData = await resReuse.json();
  assert.match(reuseData.error, /already been used/i);

  // Verify login works with new reset password
  const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: 'AfterResetPassword123!',
    }),
  });
  assert.equal(resLogin.status, 200);
});

// -------------------------------------------------------------
// 10. PASSWORD RESET EXPIRATION
// -------------------------------------------------------------
test('10. Password reset expiration: expired token is rejected', async () => {
  // Request a fresh reset token
  const resReq = await fetch(`${BASE_URL}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({ email: adminEmail }),
  });
  assert.equal(resReq.status, 200);
  const data = await resReq.json();
  const token = new URL(data.resetUrl).searchParams.get('token');

  // Backdate expiration in DB to 10 minutes ago
  const tokenHash = PasswordResetToken.hashToken(token);
  await PasswordResetToken.updateOne(
    { tokenHash },
    { $set: { expiresAt: new Date(Date.now() - 600000) } }
  );

  // Attempting to confirm with expired token fails
  const resConfirm = await fetch(`${BASE_URL}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.8.${ipSeq++}`,
    },
    body: JSON.stringify({
      token,
      newPassword: 'ExpiredAttempt123!',
    }),
  });
  assert.equal(resConfirm.status, 400);
  const errData = await resConfirm.json();
  assert.match(errData.error, /expired/i);
});

// -------------------------------------------------------------
// 11. PROFILE AUTHORIZATION & ATTRIBUTE PROTECTION
// -------------------------------------------------------------
test('11. Profile authorization: PATCH /api/employees/me cannot tamper with orgId, role, or email; synchronizes names', async () => {
  // Employee H updates profile
  const resPatch = await fetch(`${BASE_URL}/api/employees/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${empToken}`,
    },
    body: JSON.stringify({
      firstName: 'Emmeline',
      lastName: 'Pankhurst',
      phone: '+91 9988776655',
      role: 'admin',                // Tamper attempt
      orgId: 'org_doppelmayr',      // Tamper attempt
      email: 'hacker@victim.com',   // Tamper attempt
      privileges: { food: { tier: 'premium' } }, // Privileged field tamper
    }),
  });
  assert.equal(resPatch.status, 200);

  // Verify in Employee DB
  const dbEmp = await Employee.findOne({ clerkUserId: empUser._id.toString() });
  assert.equal(dbEmp.firstName, 'Emmeline');
  assert.equal(dbEmp.lastName, 'Pankhurst');
  assert.equal(dbEmp.phone, '+91 9988776655');
  assert.equal(dbEmp.orgId, tenantHData.organization.orgId, 'Employee orgId must not change');
  assert.equal(dbEmp.email, empUser.email, 'Employee email must not change via profile PATCH');

  // Verify in User DB: names synchronized, role/orgId/email untouched
  const dbUser = await User.findById(empUser._id);
  assert.equal(dbUser.firstName, 'Emmeline');
  assert.equal(dbUser.lastName, 'Pankhurst');
  assert.equal(dbUser.role, 'employee', 'Role must remain employee');
  assert.equal(dbUser.orgId, tenantHData.organization.orgId, 'User orgId must not change');
  assert.equal(dbUser.email, empUser.email, 'User email must not change');
});

// -------------------------------------------------------------
// 12. RATE LIMITING ON SENSITIVE AUTH ENDPOINTS
// -------------------------------------------------------------
test('12. Rate limiting protects password reset from abuse', async () => {
  const abuseIp = '198.51.100.99';
  let rateLimited = false;

  for (let i = 0; i < 7; i++) {
    const res = await fetch(`${BASE_URL}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': abuseIp,
      },
      body: JSON.stringify({ email: adminEmail }),
    });

    if (res.status === 429) {
      rateLimited = true;
      const data = await res.json();
      assert.match(data.error, /too many.*wait/i);
      break;
    }
  }

  assert.ok(rateLimited, 'Password reset request must trigger rate limit (429) after excessive calls');
});
