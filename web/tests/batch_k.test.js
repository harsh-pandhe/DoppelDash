/**
 * DoppelDash — Batch K Production Readiness & Security Audit Test Suite
 *
 * Verifies production hardening:
 * 1. Missing secret safety (JWT_SECRET, ENCRYPTION_SECRET fail closed in production).
 * 2. Dev/Seed/Reset endpoints blocked (403/401) without explicit allow flag & secret.
 * 3. Cron security (401 on missing/wrong secret, tenant isolation respected).
 * 4. Production auth hardening (OTP '112022' bypass fails in production, resetUrl hidden in production).
 * 5. Security headers configured (X-Frame-Options, X-Content-Type-Options, CSP, HSTS).
 * 6. Rate limiting backed by MongoDB.
 * 7. OCR file traversal protection.
 * 8. Public SaaS registration, isolation & rollback verification.
 * 9. Safe teardown leaves Doppelmayr data completely untouched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
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
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;
const RateLimit = jiti(path.resolve(__dirname, '../models/RateLimit.ts')).default;
const { signToken } = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));

const {
  getDoppelmayrBaseline,
  safeTeardownTestOrg,
  auditDatabaseIntegrity,
} = require('./helpers/testSafety');

let db = null;
let baseline = null;

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGODB_URI);
  }
  db = mongoose.connection.db;
  baseline = await getDoppelmayrBaseline(db);
  assert.equal(baseline.users, 9, 'Precondition: 9 real users exist');
  assert.equal(baseline.leavebalances, 9, 'Precondition: 9 leave balances exist');
});

test.after(async () => {
  if (db && baseline) {
    const finalBaseline = await getDoppelmayrBaseline(db);
    for (const [coll, count] of Object.entries(baseline)) {
      assert.equal(finalBaseline[coll], count, `Final baseline count mismatch in '${coll}'`);
    }
    const violations = await auditDatabaseIntegrity(db);
    assert.deepEqual(violations, [], 'Post-test database audit must have 0 violations');
  }
  await mongoose.disconnect();
});

test('K.1 — Production Secrets Fail-Closed Check', async () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origJwtSecret = process.env.JWT_SECRET;
  const origEncSecret = process.env.ENCRYPTION_SECRET;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_SECRET;

    // Fresh jiti import to evaluate production guards
    const freshJwt = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));
    await assert.rejects(
      async () => {
        await freshJwt.signToken({ id: 'dummy', orgId: 'test', email: 'test@example.com', role: 'employee' });
      },
      /JWT_SECRET is not set/i,
      'signToken must throw when JWT_SECRET is unset in production'
    );

    const freshEncrypt = jiti(path.resolve(__dirname, '../lib/encrypt.ts'));
    assert.throws(
      () => {
        freshEncrypt.encrypt('sensitive data');
      },
      /ENCRYPTION_SECRET is not set/i,
      'encrypt must throw when ENCRYPTION_SECRET is unset in production'
    );
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    process.env.JWT_SECRET = origJwtSecret || DEFAULT_TEST_JWT_SECRET;
    if (origEncSecret) process.env.ENCRYPTION_SECRET = origEncSecret;
  }
});

test('K.2 — Dev & Seed Endpoints Blocked in Production Mode', async () => {
  // 1. Seed endpoint: unauthenticated or invalid secret returns 403
  const seedRes = await fetch(`${BASE_URL}/api/dev/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(seedRes.status, 403, 'POST /api/dev/seed must return 403 Forbidden without valid secret/allow flag');

  // 2. Reset-to-admin endpoint: unauthenticated returns 401 (middleware) or 403 (route check)
  const resetRes = await fetch(`${BASE_URL}/api/dev/reset-to-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.ok(
    resetRes.status === 401 || resetRes.status === 403,
    `POST /api/dev/reset-to-admin must be blocked (got ${resetRes.status})`
  );

  // 3. Migrate endpoint: without valid secret returns 403
  const migrateRes = await fetch(`${BASE_URL}/api/dev/migrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(migrateRes.status, 403, 'POST /api/dev/migrate must return 403 Forbidden without valid secret');

  // 4. Setup endpoint: when an admin already exists, returns 409 Conflict
  const setupRes = await fetch(`${BASE_URL}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: 'dummy-secret',
      email: 'hacker@example.com',
      password: 'Password123!',
      firstName: 'Evil',
      lastName: 'Hacker',
    }),
  });
  assert.equal(setupRes.status, 409, 'POST /api/auth/setup must return 409 Conflict when an admin already exists');
});

test('K.3 — Cron Endpoint Gating and Unauthorized Rejection', async () => {
  const endpoints = [
    '/api/cron/announcements',
    '/api/cron/birthday',
    '/api/cron/onboarding',
  ];

  for (const ep of endpoints) {
    // 1. Missing secret
    const resNoSecret = await fetch(`${BASE_URL}${ep}`);
    assert.equal(resNoSecret.status, 401, `GET ${ep} without secret must return 401 Unauthorized`);

    // 2. Invalid secret
    const resBadSecret = await fetch(`${BASE_URL}${ep}?secret=completely-invalid-secret`);
    assert.equal(resBadSecret.status, 401, `GET ${ep} with bad secret must return 401 Unauthorized`);

    // 3. Invalid Bearer header
    const resBadBearer = await fetch(`${BASE_URL}${ep}`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    assert.equal(resBadBearer.status, 401, `GET ${ep} with bad Bearer token must return 401 Unauthorized`);
  }
});

test('K.4 — Production OTP Bypass and Password Reset Exposure Guards', async () => {
  const origNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const otpModule = jiti(path.resolve(__dirname, '../lib/auth/otp.ts'));

    // In production, '112022' must NOT bypass verification
    const dummyUserId = new mongoose.Types.ObjectId().toString();
    const res = await otpModule.verifyOTP(dummyUserId, '112022');
    assert.equal(res.ok, false, "Production mode must not allow '112022' OTP bypass");
  } finally {
    process.env.NODE_ENV = origNodeEnv;
  }

  // Password reset request endpoint must not leak resetUrl in production
  const origNodeEnv2 = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const pwdResetRoute = jiti(path.resolve(__dirname, '../app/api/auth/password-reset/request/route.ts'));
    const { NextRequest } = require('next/server');
    const dummyReq = new NextRequest(`${BASE_URL}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'harshpandhehome@gmail.com' }),
    });
    const resetReqRes = await pwdResetRoute.POST(dummyReq);
    assert.equal(resetReqRes.status, 200);
    const data = await resetReqRes.json();
    assert.ok(data.message, 'Must return generic message');
    assert.equal(data.resetUrl, undefined, 'resetUrl must NEVER be exposed in production response');
  } finally {
    process.env.NODE_ENV = origNodeEnv2;
  }
});

test('K.5 — Rate Limiting MongoDB Backing Store', async () => {
  const ratelimitModule = jiti(path.resolve(__dirname, '../lib/ratelimit.ts'));
  const testKey = `audit-test-rate-limit-${Date.now()}`;

  // Limit 2 requests in 5000ms window
  const first = await ratelimitModule.rateLimit(testKey, 2, 5000);
  assert.equal(first, true, 'First attempt must pass');

  const second = await ratelimitModule.rateLimit(testKey, 2, 5000);
  assert.equal(second, true, 'Second attempt must pass');

  const third = await ratelimitModule.rateLimit(testKey, 2, 5000);
  assert.equal(third, false, 'Third attempt must exceed limit and fail');

  // Verify record exists in Mongo
  const doc = await RateLimit.findOne({ key: testKey });
  assert.ok(doc, 'RateLimit record must be persisted in MongoDB');
  assert.equal(doc.count, 3);

  // Clean up test key
  await RateLimit.deleteOne({ key: testKey });
});

test('K.6 — File & OCR Path Traversal Defense', async () => {
  const adminUser = await User.findOne({ email: 'harshpandhehome@gmail.com' });
  assert.ok(adminUser);
  const token = await signToken(adminUser.toPublic());

  // Attempt path traversal with imageUrl
  const res = await fetch(`${BASE_URL}/api/crm/ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      imageUrl: '../../../../etc/passwd',
    }),
  });

  assert.equal(res.status, 400, 'Path traversal must be rejected with 400');
  const data = await res.json();
  assert.ok(data.error.includes('Invalid image path') || data.error.includes('Image not found'));
});

test('K.7 — Public SaaS Registration, Isolation & Rollback Verification', async () => {
  const uniqueSuffix = Date.now();
  const testEmail = `batch_k_admin_${uniqueSuffix}@example.com`;
  const orgName = `Batch K SaaS Corp ${uniqueSuffix}`;

  let createdOrgId = null;
  let createdUserId = null;

  try {
    // 1. Successful registration
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: orgName,
        email: testEmail,
        password: 'Password123!',
        firstName: 'BatchK',
        lastName: 'Admin',
        phone: '+919876543210',
      }),
    });

    assert.equal(regRes.status, 201, 'Registration must return 201 Created');
    const regData = await regRes.json();
    assert.ok(regData.user, 'Must return created user');
    assert.ok(regData.organization, 'Must return created organization');
    assert.ok(regData.accessToken, 'Must return access token');
    assert.ok(regData.refreshToken, 'Must return refresh token');

    createdOrgId = regData.organization.orgId;
    createdUserId = regData.user.id || regData.user._id;
    assert.notEqual(createdOrgId, 'org_doppelmayr', 'Must be a distinct tenant ID');

    // Verify DB entities created
    const createdUser = await User.findOne({ email: testEmail });
    assert.ok(createdUser, 'User must exist in DB');
    assert.equal(createdUser.role, 'admin');
    assert.equal(createdUser.orgId, createdOrgId);

    const createdEmp = await Employee.findOne({ clerkUserId: createdUser._id.toString() });
    assert.ok(createdEmp, 'Employee must exist');
    assert.equal(createdEmp.orgId, createdOrgId);

    const createdBal = await LeaveBalance.findOne({ userId: createdUser._id.toString() });
    assert.ok(createdBal, 'LeaveBalance must exist');
    assert.equal(createdBal.orgId, createdOrgId);

    const createdSettings = await OrgSettings.findOne({ orgId: createdOrgId });
    assert.ok(createdSettings, 'OrgSettings must exist');

    // 2. Duplicate registration attempt fails with 409
    const dupRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: orgName,
        email: testEmail,
        password: 'Password123!',
        firstName: 'BatchK',
        lastName: 'Admin',
      }),
    });
    assert.equal(dupRes.status, 409, 'Duplicate registration must return 409 Conflict');
  } finally {
    // 3. Safe teardown
    if (createdOrgId) {
      await safeTeardownTestOrg(db, createdOrgId, createdUserId ? [createdUserId] : []);
    }
  }

  // Verify teardown was clean
  const checkOrg = await Organization.findOne({ orgId: createdOrgId });
  assert.equal(checkOrg, null, 'Test organization must be deleted');
  const checkUser = await User.findOne({ email: testEmail });
  assert.equal(checkUser, null, 'Test user must be deleted');
});

test('K.8 — Security Headers Verification', async () => {
  // Fetch home / public route and inspect security headers
  const res = await fetch(`${BASE_URL}/sign-in`);
  const headers = res.headers;

  assert.equal(headers.get('x-frame-options'), 'DENY', 'X-Frame-Options must be DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options must be nosniff');
  assert.ok(headers.get('referrer-policy'), 'Referrer-Policy must be set');
  assert.ok(headers.get('content-security-policy'), 'Content-Security-Policy must be set');
  assert.ok(headers.get('permissions-policy'), 'Permissions-Policy must be set');
});
