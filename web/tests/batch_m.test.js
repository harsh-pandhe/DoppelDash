/**
 * DoppelDash — Batch M Production Google Play Subscription Billing Suite
 *
 * Verifies:
 * 1. unverified token cannot grant Premium
 * 2. fake product ID cannot grant Premium
 * 3. client cannot inject subscriptionStatus
 * 4. client cannot inject plan=premium
 * 5. client cannot inject lifetimeGrant
 * 6. verified active subscription grants Premium
 * 7. verified expired subscription removes Premium
 * 8. canceled-but-active subscription remains Premium until expiry
 * 9. revoked/refunded subscription removes Premium
 * 10. duplicate purchase token is idempotent
 * 11. duplicate RTDN event is idempotent
 * 12. malformed RTDN cannot grant Premium
 * 13. Organization A cannot attach purchase to Organization B
 * 14. purchasing Premium does not enable Web
 * 15. Doppelmayr lifetime entitlement remains unchanged
 * 16. public Free remains Android-only
 * 17. public Premium remains Android-only
 * 18. entitlement resolver returns the verified subscription state
 */

const process = require('node:process');
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';
const DEFAULT_TEST_JWT_SECRET = process.env.JWT_SECRET || 'R2RJokZ9yAF3dLA/0sI7YDtcJxuIXwrfXDhmYxieukcucXlGzJxAqc1eBe6kYYmlchWutbnhbTD6Yn3+jMexXQ==';
process.env.JWT_SECRET = DEFAULT_TEST_JWT_SECRET;

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename, {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});

// Import models and services via jiti
const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const Subscription = jiti(path.resolve(__dirname, '../models/Subscription.ts')).default;
// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));
const {
  getOrganizationEntitlements,
  canUseFeature,
  getOrganizationLimit,
} = jiti(path.resolve(__dirname, '../lib/entitlements/entitlementService.ts'));
const { PLAY_CONFIG, RTDN_NOTIFICATION_TYPES } = jiti(path.resolve(__dirname, '../lib/billing/playConfig.ts'));

const {
  getDoppelmayrBaseline,
  safeTeardownTestOrg,
  auditDatabaseIntegrity,
} = require('./helpers/testSafety');

let db = null;
let baseline = null;

// Helper to create disposable test tenant
async function createTestTenant(suffix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(7);
  const orgId = `org_test_m_${suffix}_${ts}_${rand}`;
  const slug = `slug-${suffix}-${ts}-${rand}`;

  const org = await Organization.create({
    orgId,
    name: `Test Tenant ${suffix}`,
    slug,
    plan: 'free',
    entitlementSource: 'none',
    lifetimeGrant: false,
    webEnabled: false,
    androidEnabled: true,
  });

  const user = await User.create({
    email: `user_${suffix}_${ts}_${rand}@example.com`,
    firstName: 'Test',
    lastName: 'Admin',
    role: 'admin',
    orgId,
    isActive: true,
    isBanned: false,
    sessionVersion: 1,
    passwordHash: 'dummy_hash_for_jwt_session',
  });

  const token = await signToken({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    orgId,
    sessionVersion: 1,
  });

  return {
    orgId,
    slug,
    org,
    user,
    userId: user._id.toString(),
    token,
    teardown: async () => {
      await safeTeardownTestOrg(db, orgId, [user._id.toString()]);
    },
  };
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  db = mongoose.connection.db;

  // Clear ratelimits so tests aren't blocked by IP throttling
  await db.collection('ratelimits').deleteMany({});

  // Clean any stale non-Doppelmayr records before capturing baseline
  const foreignOrgs = await db.collection('organizations').find({
    orgId: { $nin: ['org_doppelmayr', 'doppelmayr'] },
  }).toArray();
  for (const fo of foreignOrgs) {
    await safeTeardownTestOrg(db, fo.orgId);
  }

  // Guarantee Doppelmayr lifetime grant in DB
  await Organization.ensureDoppelmayr();

  baseline = await getDoppelmayrBaseline(db);
  assert.equal(baseline.users, 9, 'Precondition: 9 real users exist');
  assert.equal(baseline.leavebalances, 9, 'Precondition: 9 leave balances exist');
});

test.after(async () => {
  // Teardown any remaining foreign test orgs
  const foreignOrgs = await db.collection('organizations').find({
    orgId: { $nin: ['org_doppelmayr', 'doppelmayr'] },
  }).toArray();
  for (const fo of foreignOrgs) {
    await safeTeardownTestOrg(db, fo.orgId);
  }

  // Audit database integrity
  const audit = await auditDatabaseIntegrity(db);
  assert.equal(audit.length, 0, `Database integrity violations: ${JSON.stringify(audit)}`);

  // Verify baseline Doppelmayr records remain unchanged
  const post = await getDoppelmayrBaseline(db);
  assert.equal(post.users, baseline.users, 'Post-condition: Doppelmayr users unchanged');
  assert.equal(post.leavebalances, baseline.leavebalances, 'Post-condition: Doppelmayr leave balances unchanged');
  assert.equal(post.organizations, baseline.organizations, 'Post-condition: Doppelmayr organizations count unchanged');

  await mongoose.disconnect();
});

test('1. unverified token cannot grant Premium', async () => {
  const tenant = await createTestTenant('unverified');
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: 'completely_fabricated_token_xyz',
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    assert.equal(res.status, 400, 'Must return 400 for unverified token');
    const data = await res.json();
    assert.ok(data.error, 'Must return error message');

    // Verify DB state
    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.plan, 'free', 'Organization plan must remain free');
    assert.equal(org.entitlementSource, 'none', 'Entitlement source must remain none');

    // Verify resolver state
    const ent = await getOrganizationEntitlements(tenant.orgId);
    assert.equal(ent.plan, 'free');
    assert.equal(ent.features.campaigns, false);
  } finally {
    await tenant.teardown();
  }
});

test('2. fake product ID cannot grant Premium', async () => {
  const tenant = await createTestTenant('fakeprod');
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: `test_play_active_${Date.now()}`,
        productId: 'hacked_super_premium_tier_999',
      }),
    });

    assert.equal(res.status, 400, 'Must return 400 for unconfigured product ID');
    const data = await res.json();
    assert.ok(data.error.includes('Invalid product ID'), 'Must state invalid product ID');

    // Verify DB state
    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.plan, 'free');
  } finally {
    await tenant.teardown();
  }
});

test('3. client cannot inject subscriptionStatus', async () => {
  const tenant = await createTestTenant('inject_sub_status');
  try {
    // Attempt via settings PATCH
    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        subscriptionStatus: 'active',
      }),
    });
    // Check DB field
    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.notEqual(org.subscriptionStatus, 'active', 'Client cannot inject subscriptionStatus via settings');

    // Attempt via verify payload with invalid token
    const verifyRes = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: 'invalid_token_attempt',
        productId: PLAY_CONFIG.premiumProductId,
        subscriptionStatus: 'active',
      }),
    });
    assert.equal(verifyRes.status, 400);
    const orgAfter = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.notEqual(orgAfter.subscriptionStatus, 'active');
  } finally {
    await tenant.teardown();
  }
});

test('4. client cannot inject plan=premium', async () => {
  const tenant = await createTestTenant('inject_plan');
  try {
    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        plan: 'premium',
      }),
    });

    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.plan, 'free', 'Organization plan must remain free');
  } finally {
    await tenant.teardown();
  }
});

test('5. client cannot inject lifetimeGrant', async () => {
  const tenant = await createTestTenant('inject_lifetime');
  try {
    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        lifetimeGrant: true,
      }),
    });

    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.lifetimeGrant, false, 'lifetimeGrant must remain false');
  } finally {
    await tenant.teardown();
  }
});

test('6. verified active subscription grants Premium', async () => {
  const tenant = await createTestTenant('verified_active');
  const token = `test_play_active_${Date.now()}_6`;
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    assert.equal(res.status, 200, 'Must verify active subscription successfully');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.subscription.status, 'active');
    assert.equal(data.entitlements.plan, 'premium');
    assert.equal(data.entitlements.features.campaigns, true);
    assert.equal(data.entitlements.limits.maxMembers, 1000);

    // Verify DB updates
    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.plan, 'premium');
    assert.equal(org.entitlementSource, 'subscription');
    assert.equal(org.subscriptionStatus, 'active');
    assert.ok(org.subscriptionId);

    const sub = await Subscription.findOne({ purchaseToken: token }).lean();
    assert.ok(sub);
    assert.equal(sub.orgId, tenant.orgId);
    assert.equal(sub.status, 'active');
    assert.equal(sub.provider, 'google_play');
    assert.equal(sub.linkedUserId, tenant.userId);
  } finally {
    await tenant.teardown();
  }
});

test('7. verified expired subscription removes Premium', async () => {
  const tenant = await createTestTenant('verified_expired');
  const token = `test_play_expired_${Date.now()}_7`;
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subscription.status, 'expired');
    assert.equal(data.entitlements.plan, 'free');
    assert.equal(data.entitlements.features.campaigns, false);

    // Resolver check
    const ent = await getOrganizationEntitlements(tenant.orgId);
    assert.equal(ent.plan, 'free');
    assert.equal(ent.features.campaigns, false);
    assert.equal(await canUseFeature(tenant.orgId, 'campaigns'), false);
  } finally {
    await tenant.teardown();
  }
});

test('8. canceled-but-active subscription remains Premium until expiry', async () => {
  const tenant = await createTestTenant('verified_canceled');
  const token = `test_play_canceled_${Date.now()}_8`;
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subscription.status, 'canceled');
    assert.equal(data.subscription.autoRenewing, false);
    // Period end is 20 days in the future, so plan remains Premium
    assert.equal(data.entitlements.plan, 'premium');
    assert.equal(data.entitlements.features.campaigns, true);

    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.cancelAtPeriodEnd, true);
    assert.equal(org.subscriptionStatus, 'canceled');

    const ent = await getOrganizationEntitlements(tenant.orgId);
    assert.equal(ent.plan, 'premium');
  } finally {
    await tenant.teardown();
  }
});

test('9. revoked/refunded subscription removes Premium', async () => {
  const tenant = await createTestTenant('verified_revoked');
  const token = `test_play_revoked_${Date.now()}_9`;
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subscription.status, 'revoked');
    assert.equal(data.entitlements.plan, 'free');
    assert.equal(data.entitlements.features.campaigns, false);

    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.plan, 'free');
    assert.equal(org.subscriptionStatus, 'revoked');
  } finally {
    await tenant.teardown();
  }
});

test('10. duplicate purchase token is idempotent', async () => {
  const tenant = await createTestTenant('idempotent');
  const token = `test_play_active_idem_${Date.now()}`;
  try {
    // Call 1
    const res1 = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();

    // Call 2
    const res2 = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();

    assert.equal(data1.subscription.id, data2.subscription.id, 'Must return same subscription record');

    const subs = await Subscription.find({ purchaseToken: token }).lean();
    assert.equal(subs.length, 1, 'Must only create 1 subscription record in DB');
  } finally {
    await tenant.teardown();
  }
});

test('11. duplicate RTDN event is idempotent', async () => {
  const tenant = await createTestTenant('rtdn_idem');
  const token = `test_play_active_rtdn_${Date.now()}`;
  try {
    // 1. Establish subscription
    const verifyRes = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });
    assert.equal(verifyRes.status, 200);

    const rtdnPayload = {
      message: {
        messageId: `msg_${Date.now()}_unique`,
        data: Buffer.from(
          JSON.stringify({
            subscriptionNotification: {
              version: '1.0',
              notificationType: RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED,
              purchaseToken: token,
              subscriptionId: PLAY_CONFIG.premiumProductId,
            },
          })
        ).toString('base64'),
      },
    };

    // First delivery
    const res1 = await fetch(`${BASE_URL}/api/billing/play/rtdn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rtdnPayload),
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.status, 'ok');

    // Duplicate delivery
    const res2 = await fetch(`${BASE_URL}/api/billing/play/rtdn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rtdnPayload),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.message, 'Event already processed');
  } finally {
    await tenant.teardown();
  }
});

test('12. malformed RTDN cannot grant Premium', async () => {
  // Test missing purchaseToken
  const res1 = await fetch(`${BASE_URL}/api/billing/play/rtdn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriptionNotification: {
        notificationType: RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED,
      },
    }),
  });
  assert.equal(res1.status, 400, 'Must reject missing purchaseToken');

  // Test non-existent token (safe ignore)
  const res2 = await fetch(`${BASE_URL}/api/billing/play/rtdn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriptionNotification: {
        notificationType: RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_PURCHASED,
        purchaseToken: 'unknown_token_that_does_not_exist',
      },
    }),
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.status, 'ignored', 'Must safely ignore unknown token without altering any tenant');
});

test('13. Organization A cannot attach purchase to Organization B', async () => {
  const tenantA = await createTestTenant('tenant_a');
  const tenantB = await createTestTenant('tenant_b');
  const sharedToken = `test_play_active_cross_${Date.now()}`;

  try {
    // 1. Tenant A attaches token
    const resA = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantA.token}`,
      },
      body: JSON.stringify({
        purchaseToken: sharedToken,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });
    assert.equal(resA.status, 200);

    // 2. Tenant B attempts to claim the same token
    const resB = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantB.token}`,
      },
      body: JSON.stringify({
        purchaseToken: sharedToken,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });
    assert.equal(resB.status, 409, 'Must reject already bound token with 409 Conflict');
    const dataB = await resB.json();
    assert.ok(dataB.error.includes('already associated with another organization'));

    // Tenant B remains Free
    const orgB = await Organization.findOne({ orgId: tenantB.orgId }).lean();
    assert.equal(orgB.plan, 'free');

    // 3. User A attempts to pass tenant B's orgId in request body
    const forgedToken = `test_play_active_forge_${Date.now()}`;
    const resForged = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantA.token}`,
      },
      body: JSON.stringify({
        purchaseToken: forgedToken,
        productId: PLAY_CONFIG.premiumProductId,
        orgId: tenantB.orgId, // malicious client body override
      }),
    });
    assert.equal(resForged.status, 200);

    // Verify forged token was attached to Org A (from session), NOT Org B
    const subForged = await Subscription.findOne({ purchaseToken: forgedToken }).lean();
    assert.equal(subForged.orgId, tenantA.orgId, 'Must bind strictly to session orgId');
    assert.notEqual(subForged.orgId, tenantB.orgId);
  } finally {
    await tenantA.teardown();
    await tenantB.teardown();
  }
});

test('14. purchasing Premium does not enable Web', async () => {
  const tenant = await createTestTenant('no_web');
  const token = `test_play_active_noweb_${Date.now()}`;
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.entitlements.plan, 'premium');
    assert.equal(data.entitlements.webEnabled, false, 'Web access must remain false after Premium purchase');

    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.webEnabled, false);
  } finally {
    await tenant.teardown();
  }
});

test('15. Doppelmayr lifetime entitlement remains unchanged', async () => {
  const doppelDoc = await Organization.findOne({ orgId: 'org_doppelmayr' }).lean();
  assert.ok(doppelDoc);
  assert.equal(doppelDoc.plan, 'premium');
  assert.equal(doppelDoc.entitlementSource, 'lifetime_grant');
  assert.equal(doppelDoc.lifetimeGrant, true);
  assert.equal(doppelDoc.webEnabled, true);
  assert.equal(doppelDoc.androidEnabled, true);

  const ent = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(ent.plan, 'premium');
  assert.equal(ent.source, 'lifetime_grant');
  assert.equal(ent.lifetime, true);
  assert.equal(ent.webEnabled, true);
  assert.equal(ent.androidEnabled, true);
});

test('16. public Free remains Android-only', async () => {
  const tenant = await createTestTenant('free_android');
  try {
    const ent = await getOrganizationEntitlements(tenant.orgId);
    assert.equal(ent.plan, 'free');
    assert.equal(ent.androidEnabled, true);
    assert.equal(ent.webEnabled, false);
  } finally {
    await tenant.teardown();
  }
});

test('17. public Premium remains Android-only', async () => {
  const tenant = await createTestTenant('prem_android');
  const token = `test_play_active_prem_android_${Date.now()}`;
  try {
    await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    const ent = await getOrganizationEntitlements(tenant.orgId);
    assert.equal(ent.plan, 'premium');
    assert.equal(ent.androidEnabled, true);
    assert.equal(ent.webEnabled, false);
  } finally {
    await tenant.teardown();
  }
});

test('18. entitlement resolver returns the verified subscription state', async () => {
  const tenant = await createTestTenant('resolver_state');
  const token = `test_play_active_resolver_${Date.now()}`;
  try {
    await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    const ent = await getOrganizationEntitlements(tenant.orgId);
    assert.equal(ent.plan, 'premium');
    assert.equal(ent.source, 'subscription');
    assert.equal(ent.lifetime, false);
    assert.equal(ent.subscription.status, 'active');
    assert.ok(ent.subscription.currentPeriodEnd);
    assert.equal(ent.features.campaigns, true);
    assert.equal(ent.features.aiMessageGeneration, true);
    assert.equal(ent.limits.maxMembers, 1000);
    assert.equal(ent.limits.maxContacts, 100000);
  } finally {
    await tenant.teardown();
  }
});

test('19. PENDING does not grant Premium', async () => {
  const tenant = await createTestTenant('pending_sub');
  const token = `test_play_pending_${Date.now()}`;
  try {
    const res = await fetch(`${BASE_URL}/api/billing/play/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenant.token}`,
      },
      body: JSON.stringify({
        purchaseToken: token,
        productId: PLAY_CONFIG.premiumProductId,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subscription.status, 'pending');
    assert.equal(data.entitlements.plan, 'free', 'PENDING subscription must not grant Premium plan');
    assert.equal(data.entitlements.features.campaigns, false);

    const org = await Organization.findOne({ orgId: tenant.orgId }).lean();
    assert.equal(org.plan, 'free');
    assert.equal(org.subscriptionStatus, 'pending');
  } finally {
    await tenant.teardown();
  }
});

test('20. Package name mismatch is rejected by verification service', async () => {
  const { verifySubscriptionPurchase } = jiti(path.resolve(__dirname, '../lib/billing/googlePlayService.ts'));
  const result = await verifySubscriptionPurchase({
    purchaseToken: `test_play_active_${Date.now()}`,
    productId: PLAY_CONFIG.premiumProductId,
    packageName: 'com.malicious.attacker.app',
  });

  assert.equal(result.verified, false);
  assert.ok(result.error.includes('Package name mismatch'));
});

test('21. Unauthenticated RTDN is rejected when secret is configured', async () => {
  const { POST: rtdnHandler } = jiti(path.resolve(__dirname, '../app/api/billing/play/rtdn/route.ts'));
  const { NextRequest } = require('next/server');
  const originalSecret = PLAY_CONFIG.rtdnSecret;
  try {
    PLAY_CONFIG.rtdnSecret = 'super_secret_rtdn_token_123';

    // 1. Call without token
    const req1 = new NextRequest('http://localhost:3000/api/billing/play/rtdn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testNotification: true }),
    });
    const res1 = await rtdnHandler(req1);
    assert.equal(res1.status, 401, 'Must return 401 Unauthorized when secret token is missing');

    // 2. Call with incorrect token
    const reqBad = new NextRequest('http://localhost:3000/api/billing/play/rtdn?token=wrong_secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testNotification: true }),
    });
    const resBad = await rtdnHandler(reqBad);
    assert.equal(resBad.status, 401, 'Must return 401 for incorrect secret token');

    // 3. Call with correct header
    const reqGood = new NextRequest('http://localhost:3000/api/billing/play/rtdn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rtdn-secret': 'super_secret_rtdn_token_123',
      },
      body: JSON.stringify({ testNotification: true }),
    });
    const resGood = await rtdnHandler(reqGood);
    assert.equal(resGood.status, 200, 'Must return 200 for authenticated secret header');
  } finally {
    PLAY_CONFIG.rtdnSecret = originalSecret;
  }
});
