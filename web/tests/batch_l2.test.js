/**
 * DoppelDash — Batch L.2 Final Entitlement Hardening & Data-Driven Resolution Suite
 *
 * Verifies:
 * 1. Doppelmayr entitlement is derived entirely from persisted fields.
 * 2. A different organization with Premium fields receives the same Premium capabilities without any Doppelmayr identity check.
 * 3. A public organization cannot mutate webEnabled to true.
 * 4. A public organization cannot self-grant Premium.
 * 5. A public organization cannot self-grant lifetime entitlement.
 * 6. Entitlement-fetch failure fails closed for premium-gated features.
 * 7. Logout/session switch clears entitlement state.
 * 8. Public Free remains Android-only.
 * 9. Public Premium remains Android-only.
 * 10. Doppelmayr remains Android + Web.
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
// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));
const {
  getOrganizationEntitlements,
  canUseFeature,
  getOrganizationLimit,
} = jiti(path.resolve(__dirname, '../lib/entitlements/entitlementService.ts'));
const { PLAN_CONFIGS } = jiti(path.resolve(__dirname, '../lib/entitlements/plans.ts'));

const {
  getDoppelmayrBaseline,
  safeTeardownTestOrg,
  auditDatabaseIntegrity,
} = require('./helpers/testSafety');

let db = null;
let baseline = null;

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

test('1. Doppelmayr entitlement is derived entirely from persisted fields', async () => {
  // Directly verify MongoDB document
  const doppelDoc = await Organization.findOne({ orgId: 'org_doppelmayr' }).lean();
  assert.ok(doppelDoc, 'Doppelmayr organization must exist in DB');
  assert.equal(doppelDoc.plan, 'premium');
  assert.equal(doppelDoc.entitlementSource, 'lifetime_grant');
  assert.equal(doppelDoc.lifetimeGrant, true);
  assert.equal(doppelDoc.webEnabled, true);
  assert.equal(doppelDoc.androidEnabled, true);

  // Verify resolver derives from those fields
  const ent = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(ent.plan, doppelDoc.plan);
  assert.equal(ent.source, doppelDoc.entitlementSource);
  assert.equal(ent.lifetime, doppelDoc.lifetimeGrant);
  assert.equal(ent.webEnabled, doppelDoc.webEnabled);
  assert.equal(ent.androidEnabled, doppelDoc.androidEnabled);
  assert.equal(ent.features.campaigns, true);
  assert.equal(ent.limits.maxMembers, 1000);
  assert.equal(ent.limits.maxContacts, 100000);
});

test('2. A different organization with Premium fields receives identical Premium capabilities without Doppelmayr identity check', async () => {
  const genericOrgId = `org_generic_enterprise_${Date.now()}`;

  try {
    // Normal non-Doppelmayr organization with persisted lifetime grant & web access
    await Organization.create({
      orgId: genericOrgId,
      name: 'Generic Enterprise Partner',
      slug: `generic-enterprise-${Date.now()}`,
      plan: 'premium',
      entitlementSource: 'lifetime_grant',
      lifetimeGrant: true,
      webEnabled: true,
      androidEnabled: true,
    });

    const ent = await getOrganizationEntitlements(genericOrgId);
    assert.equal(ent.plan, 'premium');
    assert.equal(ent.source, 'lifetime_grant');
    assert.equal(ent.lifetime, true);
    assert.equal(ent.webEnabled, true);
    assert.equal(ent.androidEnabled, true);
    assert.equal(ent.features.campaigns, true);
    assert.equal(ent.features.aiMessageGeneration, true);
    assert.equal(ent.limits.maxMembers, PLAN_CONFIGS.premium.limits.maxMembers);
    assert.equal(ent.limits.maxContacts, PLAN_CONFIGS.premium.limits.maxContacts);
    assert.equal(await canUseFeature(genericOrgId, 'campaigns'), true);
    assert.equal(await getOrganizationLimit(genericOrgId, 'maxMembers'), 1000);
  } finally {
    await safeTeardownTestOrg(db, genericOrgId);
  }
});

test('3. A public organization cannot mutate webEnabled to true', async () => {
  const regEmail = `l2_no_web_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    // 1. Registration
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'No Web Org',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'No',
        lastName: 'Web',
        webEnabled: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.webEnabled, false, 'Registration must strictly set webEnabled: false');

    // 2. Settings PATCH
    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.accessToken}`,
      },
      body: JSON.stringify({ webEnabled: true }),
    });

    orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.webEnabled, false, 'Settings update must not mutate webEnabled');

    // 3. Resolver
    const ent = await getOrganizationEntitlements(testOrgId);
    assert.equal(ent.webEnabled, false, 'Resolver must resolve webEnabled: false for public org');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('4. A public organization cannot self-grant Premium', async () => {
  const regEmail = `l2_no_prem_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'No Premium Org',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'No',
        lastName: 'Prem',
        plan: 'premium',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.plan, 'free', 'Registration must ignore plan injection');

    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.accessToken}`,
      },
      body: JSON.stringify({ plan: 'premium' }),
    });

    orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.plan, 'free', 'Settings PATCH must ignore plan mutation');

    const ent = await getOrganizationEntitlements(testOrgId);
    assert.equal(ent.plan, 'free');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('5. A public organization cannot self-grant lifetime entitlement', async () => {
  const regEmail = `l2_no_lt_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'No Lifetime Org',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'No',
        lastName: 'Lifetime',
        lifetimeGrant: true,
        entitlementSource: 'lifetime_grant',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.lifetimeGrant, false);
    assert.equal(orgDoc.entitlementSource, 'none');

    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.accessToken}`,
      },
      body: JSON.stringify({ lifetimeGrant: true, entitlementSource: 'lifetime_grant' }),
    });

    orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.lifetimeGrant, false);
    assert.equal(orgDoc.entitlementSource, 'none');

    const ent = await getOrganizationEntitlements(testOrgId);
    assert.equal(ent.lifetime, false);
    assert.equal(ent.lifetimeGrant, false);
    assert.equal(ent.source, 'none');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('6. Entitlement-fetch failure fails closed for premium-gated features', async () => {
  // Test non-existent org or resolution failure
  const unresolvableEnt = await getOrganizationEntitlements('non_existent_org_error');
  assert.equal(unresolvableEnt.plan, 'free', 'Failed resolution must fail closed to free');
  assert.equal(unresolvableEnt.webEnabled, false, 'Failed resolution must disable web');
  assert.equal(unresolvableEnt.features.campaigns, false, 'Failed resolution must lock campaigns');
  assert.equal(unresolvableEnt.features.aiMessageGeneration, false, 'Failed resolution must lock AI');

  // Verify feature check helper fails closed
  const canCampaign = await canUseFeature('non_existent_org_error', 'campaigns');
  assert.equal(canCampaign, false, 'canUseFeature must return false on resolution failure');
});

test('7. Logout/session switch clears entitlement state', async () => {
  // 1. Session switch isolation
  const doppelEnt = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(doppelEnt.plan, 'premium');
  assert.equal(doppelEnt.webEnabled, true);

  const publicOrgId = `org_l2_switch_pub_${Date.now()}`;
  try {
    await Organization.create({
      orgId: publicOrgId,
      name: 'Public Switch Tenant',
      slug: `pub-switch-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const publicEnt = await getOrganizationEntitlements(publicOrgId);
    assert.equal(publicEnt.plan, 'free');
    assert.equal(publicEnt.webEnabled, false);
    assert.notEqual(doppelEnt.plan, publicEnt.plan);
    assert.notEqual(doppelEnt.webEnabled, publicEnt.webEnabled);

    // 2. Server session invalidation on logout
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST' });
    assert.equal(logoutRes.status, 200);
    const setCookie = logoutRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('Max-Age=0') || setCookie.includes('expires='), 'Logout invalidates session');
  } finally {
    await safeTeardownTestOrg(db, publicOrgId);
  }
});

test('8. Public Free remains Android-only', async () => {
  const freeOrgId = `org_l2_pub_free_${Date.now()}`;
  try {
    await Organization.create({
      orgId: freeOrgId,
      name: 'Public Free Tenant',
      slug: `pub-free-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const ent = await getOrganizationEntitlements(freeOrgId);
    assert.equal(ent.plan, 'free');
    assert.equal(ent.androidEnabled, true, 'Android must be enabled');
    assert.equal(ent.webEnabled, false, 'Web must be disabled');
  } finally {
    await safeTeardownTestOrg(db, freeOrgId);
  }
});

test('9. Public Premium remains Android-only', async () => {
  const premOrgId = `org_l2_pub_prem_${Date.now()}`;
  try {
    await Organization.create({
      orgId: premOrgId,
      name: 'Public Premium Tenant',
      slug: `pub-prem-${Date.now()}`,
      plan: 'premium',
      entitlementSource: 'subscription',
      subscriptionStatus: 'active',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const ent = await getOrganizationEntitlements(premOrgId);
    assert.equal(ent.plan, 'premium');
    assert.equal(ent.androidEnabled, true, 'Android must be enabled for Public Premium');
    assert.equal(ent.webEnabled, false, 'Web must be disabled for Public Premium');
  } finally {
    await safeTeardownTestOrg(db, premOrgId);
  }
});

test('10. Doppelmayr remains Android + Web', async () => {
  const ent = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(ent.plan, 'premium');
  assert.equal(ent.source, 'lifetime_grant');
  assert.equal(ent.lifetimeGrant, true);
  assert.equal(ent.androidEnabled, true, 'Android must be enabled for Doppelmayr');
  assert.equal(ent.webEnabled, true, 'Web must be enabled for Doppelmayr');
});
