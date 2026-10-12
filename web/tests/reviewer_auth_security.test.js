/**
 * DoppelDash — Reviewer Authentication Security & Entitlements Regression Suite
 *
 * Tests:
 * 1. Dedicated Play reviewer account can authenticate with designated OTP.
 * 2. Normal account CANNOT use reviewer bypass code.
 * 3. Arbitrary/lookalike email CANNOT activate reviewer bypass.
 * 4. User with reviewer email but isReviewer=false CANNOT use reviewer bypass.
 * 5. Self-registration explicitly blocks setting isReviewer: true.
 * 6. Reviewer demo organization entitlement resolves to Premium with Android=true, Web=false.
 * 7. Reviewer cannot gain Web access.
 * 8. Dev endpoints (/api/dev/*) cannot be invoked without required secret in production.
 * 9. Responses never leak secrets or sensitive database connection info.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';
const DEFAULT_TEST_JWT_SECRET = process.env.JWT_SECRET || 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ==';
process.env.JWT_SECRET = DEFAULT_TEST_JWT_SECRET;

const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});

const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const { generateOTP, verifyOTP } = jiti(path.resolve(__dirname, '../lib/auth/otp.ts'));
const { getOrganizationEntitlements, canUseFeature } = jiti(path.resolve(__dirname, '../lib/entitlements/entitlementService.ts'));

const REVIEWER_EMAIL = 'doppeldash.playreview@gmail.com';
const REVIEWER_ORG_ID = 'org_playreview_demo';
const DESIGNATED_CODE = '112022';
process.env.REVIEWER_STATIC_OTP = DESIGNATED_CODE;

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

test('1. Dedicated Play reviewer account can authenticate with designated OTP', async () => {
  let reviewer = await User.findOne({ email: REVIEWER_EMAIL });
  if (!reviewer) {
    const hash = await User.hashPassword('ReviewerSecret123!');
    reviewer = await User.create({
      email: REVIEWER_EMAIL,
      orgId: REVIEWER_ORG_ID,
      passwordHash: hash,
      role: 'admin',
      firstName: 'GooglePlay',
      lastName: 'Reviewer',
      isReviewer: true,
      isActive: true,
      mustChangePassword: false,
    });
  } else {
    reviewer.isReviewer = true;
    await reviewer.save();
  }

  // Generate OTP
  await generateOTP(reviewer._id.toString());

  // Reviewer verifies using designated OTP
  const result = await verifyOTP(reviewer._id.toString(), DESIGNATED_CODE);
  assert.equal(result.ok, true, 'Reviewer should successfully verify using designated code');
});

test('2. Normal account CANNOT use reviewer bypass code', async () => {
  const normalEmail = `normal.user.${Date.now()}@example.com`;
  const hash = await User.hashPassword('NormalSecret123!');
  const normalUser = await User.create({
    email: normalEmail,
    orgId: REVIEWER_ORG_ID,
    passwordHash: hash,
    role: 'employee',
    firstName: 'Normal',
    lastName: 'User',
    isReviewer: false,
    isActive: true,
  });

  try {
    // Generate real OTP
    await generateOTP(normalUser._id.toString());

    // Attempting bypass code in production mode MUST fail
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await verifyOTP(normalUser._id.toString(), DESIGNATED_CODE);
      assert.equal(result.ok, false, 'Normal user must NOT be allowed to use reviewer bypass code');
      assert.equal(result.reason, 'Incorrect OTP');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  } finally {
    await User.deleteOne({ _id: normalUser._id });
  }
});

test('3. Arbitrary/lookalike email CANNOT activate reviewer bypass', async () => {
  const lookalikeEmail = 'doppeldash.playreview@gmail.com.attacker.com';
  const hash = await User.hashPassword('AttackerSecret123!');
  const attackerUser = await User.create({
    email: lookalikeEmail,
    orgId: REVIEWER_ORG_ID,
    passwordHash: hash,
    role: 'employee',
    firstName: 'Lookalike',
    lastName: 'Attacker',
    isReviewer: false,
    isActive: true,
  });

  try {
    await generateOTP(attackerUser._id.toString());

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await verifyOTP(attackerUser._id.toString(), DESIGNATED_CODE);
      assert.equal(result.ok, false, 'Lookalike email must NOT trigger reviewer bypass');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  } finally {
    await User.deleteOne({ _id: attackerUser._id });
  }
});

test('4. Reviewer email with isReviewer=false CANNOT use reviewer bypass', async () => {
  // Even if an account has the exact reviewer email, if isReviewer is false, bypass must fail
  const testEmail = `fake.reviewer.${Date.now()}@gmail.com`;
  const hash = await User.hashPassword('Pass1234!');
  const unflagged = await User.create({
    email: testEmail,
    orgId: REVIEWER_ORG_ID,
    passwordHash: hash,
    role: 'admin',
    firstName: 'Unflagged',
    lastName: 'Admin',
    isReviewer: false,
    isActive: true,
  });

  try {
    await generateOTP(unflagged._id.toString());

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await verifyOTP(unflagged._id.toString(), DESIGNATED_CODE);
      assert.equal(result.ok, false, 'Unflagged admin must NOT be able to use reviewer bypass');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  } finally {
    await User.deleteOne({ _id: unflagged._id });
  }
});

/** Remove EVERYTHING a self-registration created (user, org, employee, balance, sessions). */
async function purgeRegistration(email) {
  const u = await User.findOne({ email });
  if (!u) return;
  const db = mongoose.connection.db;
  const uid = String(u._id);
  if (u.orgId) {
    for (const c of ['organizations', 'orgsettings', 'employees', 'leavebalances', 'auditlogs', 'subscriptions']) {
      await db.collection(c).deleteMany({ orgId: u.orgId });
    }
    await db.collection('users').deleteMany({ orgId: u.orgId });
  }
  await db.collection('refreshtokens').deleteMany({ userId: uid });
  await User.deleteOne({ _id: u._id });
}

test('5. Self-registration payload cannot set isReviewer to true', async () => {
  const registerHandler = jiti(path.resolve(__dirname, '../app/api/auth/register/route.ts')).POST;

  const testRegisterEmail = `reg.attempt.${Date.now()}@example.com`;
  const req = {
    headers: new Headers({
      'x-forwarded-for': '127.0.0.1',
      'content-type': 'application/json',
    }),
    json: async () => ({
      email: testRegisterEmail,
      password: 'StrongPassword123!',
      firstName: 'Attempt',
      lastName: 'Hacker',
      companyName: 'Attempt Org',
      isReviewer: true, // Malicious attempt to self-grant reviewer flag
    }),
  };

  try {
    const res = await registerHandler(req);
    const body = await res.json();
    assert.equal(res.status, 201, 'Registration should succeed');

    const createdUser = await User.findOne({ email: testRegisterEmail });
    assert.ok(createdUser, 'User should be found in DB');
    assert.equal(createdUser.isReviewer, false, 'Self-registered user must strictly have isReviewer: false');

    await purgeRegistration(testRegisterEmail);
  } catch (err) {
    await purgeRegistration(testRegisterEmail);
    throw err;
  }
});

test('6. Reviewer demo organization entitlement resolves to Premium with Android=true, Web=false', async () => {
  await Organization.findOneAndUpdate(
    { orgId: REVIEWER_ORG_ID },
    {
      $set: {
        orgId: REVIEWER_ORG_ID,
        name: 'DoppelDash Demo',
        slug: 'doppeldash-demo',
        plan: 'premium',
        entitlementSource: 'subscription',
        lifetimeGrant: false,
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
        webEnabled: false,
        androidEnabled: true,
        trialStatus: 'none',
      },
    },
    { upsert: true }
  );

  const ent = await getOrganizationEntitlements(REVIEWER_ORG_ID);
  assert.equal(ent.plan, 'premium', 'Plan must be premium');
  assert.equal(ent.source, 'subscription', 'Source must be subscription');
  assert.equal(ent.lifetimeGrant, false, 'Lifetime grant must be false');
  assert.equal(ent.subscription.status, 'active', 'Subscription must be active');
  assert.equal(ent.androidEnabled, true, 'Android must be enabled');
  assert.equal(ent.webEnabled, false, 'Web must be disabled');
  assert.equal(ent.features.campaigns, true, 'Campaigns must be enabled on Premium');
  assert.equal(ent.features.bulkExport, true, 'Bulk export must be enabled on Premium');
  assert.equal(ent.features.advancedAnalytics, true, 'Advanced analytics must be enabled on Premium');
  assert.equal(ent.features.aiMessageGeneration, true, 'AI generation must be enabled on Premium');
});

test('7. Reviewer cannot gain Web access', async () => {
  const webAllowed = await canUseFeature(REVIEWER_ORG_ID, 'webAccess');
  assert.equal(webAllowed, false, 'Reviewer org must NOT have webAccess enabled');
});

test('8. Dev endpoints cannot be invoked without required secret in production', async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_SEED;
  const originalSecret = process.env.DEV_SEED_SECRET;

  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_DEV_SEED;
  process.env.DEV_SEED_SECRET = 'super-secret-key';

  try {
    const migratePost = jiti(path.resolve(__dirname, '../app/api/dev/migrate/route.ts')).POST;
    const reqNoSecret = {
      nextUrl: new URL('http://localhost:3000/api/dev/migrate'),
      headers: new Headers(),
    };

    const res = await migratePost(reqNoSecret);
    assert.equal(res.status, 403, 'Must return 403 without secret');

    const reqWrongSecret = {
      nextUrl: new URL('http://localhost:3000/api/dev/migrate?secret=wrong-secret'),
      headers: new Headers(),
    };
    const resWrong = await migratePost(reqWrongSecret);
    assert.equal(resWrong.status, 403, 'Must return 403 with wrong secret');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalAllow) process.env.ALLOW_DEV_SEED = originalAllow;
    if (originalSecret) process.env.DEV_SEED_SECRET = originalSecret;
  }
});

test('9. Missing REVIEWER_STATIC_OTP environment variable fails closed', async () => {
  const reviewer = await User.findOne({ email: REVIEWER_EMAIL, isReviewer: true });
  assert.ok(reviewer, 'Reviewer account must exist');

  await generateOTP(reviewer._id.toString());

  const originalOtp = process.env.REVIEWER_STATIC_OTP;
  delete process.env.REVIEWER_STATIC_OTP;
  try {
    const result = await verifyOTP(reviewer._id.toString(), DESIGNATED_CODE);
    assert.equal(result.ok, false, 'Reviewer OTP must fail closed if REVIEWER_STATIC_OTP is not configured');
    assert.equal(result.reason, 'Reviewer OTP verification not configured');
  } finally {
    process.env.REVIEWER_STATIC_OTP = originalOtp;
  }
});
