/**
 * DoppelDash — Batch L Organization Entitlement & Access Separation Test Suite
 *
 * Verifies:
 * 1. New public registration defaults to Free (plan: 'free', lifetimeGrant: false, webEnabled: false).
 * 2. Client cannot request Premium during registration.
 * 3. Client cannot request 'doppelmayr' plan.
 * 4. Client cannot mutate entitlement through body/query/header.
 * 5. Free feature restriction is enforced server-side (403 on campaigns and AI generation).
 * 6. Premium organization receives Premium capability.
 * 7. Doppelmayr receives Premium capability.
 * 8. Doppelmayr's Premium result comes through centralized entitlement resolver (lifetime_grant).
 * 9. Cross-tenant entitlement injection fails.
 * 10. Public organization cannot enable Web access through client input.
 * 11. Doppelmayr Web access resolves correctly (webEnabled: true).
 * 12. User role changes do not alter organization plan.
 * 13. Entitlement clearing on session switch prevents stale cache reuse.
 * 14. Zero residual test data; Doppelmayr records remain pristine.
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
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
// Public organisations are Android-class (webEnabled=false): fixtures authenticate with mobile access tokens,
// exactly as the Android client does. Web-cookie behaviour is covered with web-enabled fixtures (batch_h/h1, web_access_boundary).
const { signMobileAccessToken: signToken } = jiti(path.resolve(__dirname, '../lib/auth/mobileTokens.ts'));
const {
  getOrganizationEntitlements,
  canUseFeature,
  getOrganizationLimit,
  getOrganizationUsage,
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

test('1. New public registration defaults to Free plan with web access disabled', async () => {
  const regEmail = `test_free_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Free Acme Corp',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Alice',
        lastName: 'Free',
      }),
    });

    assert.equal(res.status, 201, 'Registration must succeed');
    const data = await res.json();
    assert.ok(data.accessToken, 'Must return accessToken');
    assert.ok(data.user?.orgId, 'Must return orgId');
    testOrgId = data.user.orgId;

    // Direct MongoDB inspection
    const orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.ok(orgDoc, 'Organization must exist in DB');
    assert.equal(orgDoc.plan, 'free', 'Plan must default to free');
    assert.equal(orgDoc.entitlementSource, 'none', 'Entitlement source must default to none');
    assert.equal(orgDoc.lifetimeGrant, false, 'lifetimeGrant must default to false');
    assert.equal(orgDoc.webEnabled, false, 'webEnabled must default to false');
    assert.equal(orgDoc.androidEnabled, true, 'androidEnabled must default to true');

    // Verify Entitlements API endpoint
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.plan, 'free');
    assert.equal(entData.source, 'none');
    assert.equal(entData.lifetimeGrant, false);
    assert.equal(entData.webEnabled, false);
    assert.equal(entData.androidEnabled, true);
    assert.equal(entData.features.campaigns, false);
    assert.equal(entData.features.aiMessageGeneration, false);
    assert.equal(entData.limits.maxMembers, PLAN_CONFIGS.free.limits.maxMembers);
    assert.equal(entData.limits.maxContacts, PLAN_CONFIGS.free.limits.maxContacts);
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('2. Client cannot request Premium during registration', async () => {
  const regEmail = `test_premium_exploit_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Sneaky Corp',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Bob',
        lastName: 'Sneak',
        plan: 'premium',
        lifetimeGrant: true,
        webEnabled: true,
        entitlementSource: 'lifetime_grant',
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    testOrgId = data.user.orgId;

    const orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.plan, 'free', 'Client-injected plan: premium MUST be ignored');
    assert.equal(orgDoc.lifetimeGrant, false, 'Client-injected lifetimeGrant MUST be ignored');
    assert.equal(orgDoc.webEnabled, false, 'Client-injected webEnabled MUST be ignored');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('3. Client cannot request plan = doppelmayr during registration', async () => {
  const regEmail = `test_doppel_exploit_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Fake Doppelmayr',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Charlie',
        lastName: 'Impostor',
        plan: 'doppelmayr',
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    testOrgId = data.user.orgId;

    const orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.plan, 'free', 'plan = doppelmayr is strictly disallowed and defaults to free');
    assert.notEqual(testOrgId, 'org_doppelmayr', 'Must not hijack org_doppelmayr');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('4. Client cannot mutate entitlement through body, query, or headers', async () => {
  const testOrgId = `org_test_mutate_${Date.now()}`;

  try {
    await Organization.create({
      orgId: testOrgId,
      name: 'Mutation Test Org',
      slug: `test-mutate-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const user = await User.create({
      email: `mutate_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Mutate',
      lastName: 'Tester',
      role: 'admin',
      orgId: testOrgId,
      isActive: true,
    });

    const token = await signToken(user.toPublic());

    // Attempt mutation via org settings PATCH
    const patchRes = await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan: 'premium',
        lifetimeGrant: true,
        webEnabled: true,
        entitlementSource: 'lifetime_grant',
      }),
    });
    assert.ok([200, 400].includes(patchRes.status));

    // Verify DB document remained unchanged
    const orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.plan, 'free', 'Plan must remain free');
    assert.equal(orgDoc.lifetimeGrant, false, 'lifetimeGrant must remain false');
    assert.equal(orgDoc.webEnabled, false, 'webEnabled must remain false');

    // Attempt query-string and header spoofing on /api/billing/entitlements
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements?plan=premium&webEnabled=true`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Plan': 'premium',
        'X-Web-Enabled': 'true',
      },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.plan, 'free', 'Server must evaluate authenticated org, not query/header spoofing');
    assert.equal(entData.webEnabled, false, 'Server must not trust header/query webEnabled');
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('5. Free feature restriction is enforced server-side', async () => {
  const testOrgId = `org_test_free_enforce_${Date.now()}`;

  try {
    await Organization.create({
      orgId: testOrgId,
      name: 'Free Enforce Org',
      slug: `free-enforce-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const user = await User.create({
      email: `freeenforce_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Free',
      lastName: 'Enforce',
      role: 'admin',
      orgId: testOrgId,
      isActive: true,
    });

    const token = await signToken(user.toPublic());

    // 1. /api/crm/campaign GET
    const campGetRes = await fetch(`${BASE_URL}/api/crm/campaign`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(campGetRes.status, 403, 'Free org GET /api/crm/campaign must return 403');
    const campGetData = await campGetRes.json();
    assert.ok(campGetData.error.includes('Premium plan'));

    // 2. /api/crm/campaign POST
    const campPostRes = await fetch(`${BASE_URL}/api/crm/campaign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subject: 'Unauthorized Campaign',
        bodyTemplate: 'Hello {{name}}',
      }),
    });
    assert.equal(campPostRes.status, 403, 'Free org POST /api/crm/campaign must return 403');

    // 3. /api/crm/generate POST (AI Message Generation)
    const aiRes = await fetch(`${BASE_URL}/api/crm/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        prompt: 'Draft introductory pitch',
        context: 'Sales lead',
      }),
    });
    assert.equal(aiRes.status, 403, 'Free org POST /api/crm/generate must return 403');
    const aiData = await aiRes.json();
    assert.ok(aiData.error.includes('Premium plan'));
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('6. Premium organization receives Premium capability', async () => {
  const testOrgId = `org_test_premium_${Date.now()}`;

  try {
    await Organization.create({
      orgId: testOrgId,
      name: 'Paid Premium Org',
      slug: `premium-org-${Date.now()}`,
      plan: 'premium',
      entitlementSource: 'subscription',
      lifetimeGrant: false,
      webEnabled: true,
      androidEnabled: true,
      subscriptionStatus: 'active',
    });

    const user = await User.create({
      email: `premium_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Prem',
      lastName: 'Admin',
      role: 'admin',
      orgId: testOrgId,
      isActive: true,
    });

    const token = await signToken(user.toPublic());

    // 1. /api/crm/campaign GET
    const campGetRes = await fetch(`${BASE_URL}/api/crm/campaign`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(campGetRes.status, 200, 'Premium org GET /api/crm/campaign must return 200');

    // 2. /api/billing/entitlements
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.plan, 'premium');
    assert.equal(entData.source, 'subscription');
    assert.equal(entData.features.campaigns, true);
    assert.equal(entData.features.aiMessageGeneration, true);
    assert.equal(entData.limits.maxMembers, PLAN_CONFIGS.premium.limits.maxMembers);
    assert.equal(entData.webEnabled, true);
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('7. Doppelmayr receives Premium capability through generic APIs', async () => {
  const doppelAdmin = await User.findOne({ orgId: 'org_doppelmayr', role: 'admin' });
  assert.ok(doppelAdmin, 'Real Doppelmayr admin user must exist');

  const token = await signToken(doppelAdmin.toPublic());

  // /api/crm/campaign GET
  const campGetRes = await fetch(`${BASE_URL}/api/crm/campaign`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(campGetRes.status, 200, 'Doppelmayr GET /api/crm/campaign must succeed with 200');

  // /api/billing/entitlements
  const entRes = await fetch(`${BASE_URL}/api/billing/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(entRes.status, 200);
  const entData = await entRes.json();
  assert.equal(entData.plan, 'premium');
  assert.equal(entData.source, 'lifetime_grant');
  assert.equal(entData.lifetimeGrant, true);
  assert.equal(entData.webEnabled, true);
  assert.equal(entData.androidEnabled, true);
  assert.equal(entData.features.campaigns, true);
  assert.equal(entData.features.aiMessageGeneration, true);
  assert.equal(entData.limits.maxMembers, PLAN_CONFIGS.premium.limits.maxMembers);
});

test('8. Doppelmayr Premium result comes through centralized entitlement resolver', async () => {
  const entitlements = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(entitlements.plan, 'premium');
  assert.equal(entitlements.source, 'lifetime_grant');
  assert.equal(entitlements.lifetimeGrant, true);
  assert.equal(entitlements.webEnabled, true);
  assert.equal(entitlements.androidEnabled, true);
  assert.equal(entitlements.features.campaigns, true);
  assert.equal(entitlements.features.aiMessageGeneration, true);
  assert.equal(entitlements.limits.maxMembers, 1000);
  assert.equal(entitlements.limits.maxContacts, 100000);

  const canCampaign = await canUseFeature('org_doppelmayr', 'campaigns');
  assert.equal(canCampaign, true);

  const maxMembers = await getOrganizationLimit('org_doppelmayr', 'maxMembers');
  assert.equal(maxMembers, 1000);

  const usage = await getOrganizationUsage('org_doppelmayr', 'members');
  assert.equal(usage, 9, 'Doppelmayr has 9 members in baseline');
});

test('9. Cross-tenant entitlement injection fails', async () => {
  const freeOrgId = `org_test_cross_free_${Date.now()}`;

  try {
    await Organization.create({
      orgId: freeOrgId,
      name: 'Cross Tenant Free',
      slug: `cross-free-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const user = await User.create({
      email: `crossfree_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Cross',
      lastName: 'Free',
      role: 'admin',
      orgId: freeOrgId,
      isActive: true,
    });

    const freeToken = await signToken(user.toPublic());

    // Attempt to call campaigns with Doppelmayr orgId in headers and query
    const res = await fetch(`${BASE_URL}/api/crm/campaign?orgId=org_doppelmayr`, {
      headers: {
        Authorization: `Bearer ${freeToken}`,
        'X-Org-Id': 'org_doppelmayr',
        'X-Tenant-Id': 'org_doppelmayr',
      },
    });

    assert.equal(res.status, 403, 'Cross-tenant spoofing must not bypass Free plan restriction');
  } finally {
    await safeTeardownTestOrg(db, freeOrgId);
  }
});

test('10. Public organization cannot enable Web access through client input', async () => {
  const freeOrgId = `org_test_no_web_${Date.now()}`;

  try {
    await Organization.create({
      orgId: freeOrgId,
      name: 'No Web Org',
      slug: `no-web-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const user = await User.create({
      email: `noweb_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'No',
      lastName: 'Web',
      role: 'admin',
      orgId: freeOrgId,
      isActive: true,
    });

    const ent = await getOrganizationEntitlements(freeOrgId);
    assert.equal(ent.webEnabled, false, 'Free org webEnabled must resolve to false');

    const token = await signToken(user.toPublic());

    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const entData = await entRes.json();
    assert.equal(entData.webEnabled, false);
  } finally {
    await safeTeardownTestOrg(db, freeOrgId);
  }
});

test('11. Doppelmayr Web access resolves correctly', async () => {
  const ent = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(ent.webEnabled, true, 'Doppelmayr must have webEnabled === true');
  assert.equal(ent.androidEnabled, true, 'Doppelmayr must have androidEnabled === true');
});

test('12. User role changes do not alter organization plan', async () => {
  const freeOrgId = `org_test_role_plan_${Date.now()}`;

  try {
    await Organization.create({
      orgId: freeOrgId,
      name: 'Role Independence Org',
      slug: `role-plan-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    // Admin user in free org
    const adminUser = await User.create({
      email: `roleadmin_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Role',
      lastName: 'Admin',
      role: 'admin',
      orgId: freeOrgId,
      isActive: true,
    });
    const adminToken = await signToken(adminUser.toPublic());

    // Employee user in free org
    const empUser = await User.create({
      email: `roleemp_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Role',
      lastName: 'Emp',
      role: 'employee',
      orgId: freeOrgId,
      isActive: true,
    });
    const employeeToken = await signToken(empUser.toPublic());

    const adminEnt = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then(r => r.json());

    const empEnt = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    }).then(r => r.json());

    assert.equal(adminEnt.plan, 'free', 'Admin role does NOT elevate organization to premium');
    assert.equal(empEnt.plan, 'free', 'Employee role receives organization free plan');

    // Doppelmayr employee (non-admin)
    const doppelEmp = await User.findOne({ orgId: 'org_doppelmayr', role: 'employee' });
    assert.ok(doppelEmp, 'Doppelmayr employee must exist');
    const doppelEmpToken = await signToken(doppelEmp.toPublic());

    const doppelEmpEnt = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${doppelEmpToken}` },
    }).then(r => r.json());

    assert.equal(doppelEmpEnt.plan, 'premium', 'Employee in Premium org receives organization Premium plan');
  } finally {
    await safeTeardownTestOrg(db, freeOrgId);
  }
});

test('13. Entitlement clearing on session switch prevents stale cache reuse', async () => {
  const { EntitlementRepository } = jiti(path.resolve(__dirname, '../tests/helpers/mockEntitlementRepo.js'));

  let fetchedOrg = 'org_doppelmayr';
  const mockDio = {
    get: async (path) => {
      assert.equal(path, '/billing/entitlements');
      const ent = await getOrganizationEntitlements(fetchedOrg);
      return { data: ent };
    },
  };

  const repo = new EntitlementRepository(mockDio);

  // User 1: Doppelmayr
  fetchedOrg = 'org_doppelmayr';
  const ent1 = await repo.fetchEntitlements();
  assert.equal(ent1.plan, 'premium');
  assert.equal(repo.isPremium, true);

  // Logout/clear session
  repo.clear();
  assert.equal(repo.current, null);
  assert.equal(repo.isPremium, false);

  // User 2: Free org
  const freeOrgId = `org_test_switch_${Date.now()}`;
  try {
    await Organization.create({
      orgId: freeOrgId,
      name: 'Switch Free Org',
      slug: `switch-free-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    fetchedOrg = freeOrgId;
    const ent2 = await repo.fetchEntitlements();
    assert.equal(ent2.plan, 'free');
    assert.equal(repo.isPremium, false);
    assert.equal(repo.canUse('campaigns'), false);
  } finally {
    await safeTeardownTestOrg(db, freeOrgId);
  }
});
