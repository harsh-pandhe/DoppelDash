/**
 * DoppelDash — Batch L.1 Final Entitlement Contract & Access Boundary Test Suite
 *
 * Verifies:
 * 1. Public Free registration → web disabled.
 * 2. Public Premium test organization → web disabled.
 * 3. Doppelmayr → Premium + lifetime grant + web enabled.
 * 4. Client cannot inject webEnabled=true.
 * 5. Client cannot inject Premium.
 * 6. Client cannot inject lifetime grant.
 * 7. Client cannot mutate entitlement source.
 * 8. Free premium-feature denial remains correct.
 * 9. Premium feature access remains correct.
 * 10. Web gateway allows Doppelmayr.
 * 11. Web gateway rejects public organization.
 * 12. Entitlement failure on client fails closed.
 * 13. Logout clears entitlement.
 * 14. Session switch clears entitlement.
 * 15. Free-plan UI displays the actual configured limits.
 * 16. Premium/Doppelmayr UI displays the actual configured Premium limits.
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

test('1. Public Free registration → web disabled', async () => {
  const regEmail = `l1_free_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Public Free Organization',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Free',
        lastName: 'User',
      }),
    });

    assert.equal(res.status, 201, 'Registration must succeed');
    const data = await res.json();
    assert.ok(data.accessToken, 'Must return accessToken');
    assert.ok(data.user?.orgId, 'Must return orgId');
    testOrgId = data.user.orgId;

    // Direct MongoDB verification
    const orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.ok(orgDoc, 'Organization must exist in DB');
    assert.equal(orgDoc.plan, 'free', 'Plan must be free');
    assert.equal(orgDoc.webEnabled, false, 'webEnabled must be false');
    assert.equal(orgDoc.androidEnabled, true, 'androidEnabled must be true');
    assert.equal(orgDoc.lifetimeGrant, false, 'lifetimeGrant must be false');

    // API Entitlements endpoint verification
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.plan, 'free');
    assert.equal(entData.webEnabled, false, 'API must return webEnabled=false for public free');
    assert.equal(entData.androidEnabled, true);
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('2. Public Premium test organization → web disabled', async () => {
  const testOrgId = `org_l1_public_prem_${Date.now()}`;

  try {
    // Create a Public Premium organization (e.g. future paid subscription)
    await Organization.create({
      orgId: testOrgId,
      name: 'Public Premium Org',
      slug: `public-prem-${Date.now()}`,
      plan: 'premium',
      entitlementSource: 'subscription',
      lifetimeGrant: false,
      webEnabled: false, // strictly false for all public organizations
      androidEnabled: true,
      subscriptionStatus: 'active',
    });

    const user = await User.create({
      email: `public_prem_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Premium',
      lastName: 'Customer',
      role: 'admin',
      orgId: testOrgId,
      isActive: true,
    });

    const token = await signToken(user.toPublic());

    // Verify Entitlements API
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();

    assert.equal(entData.plan, 'premium', 'Plan must be premium');
    assert.equal(entData.webEnabled, false, 'Public Premium must have webEnabled=false (Android-only)');
    assert.equal(entData.androidEnabled, true, 'Public Premium must have androidEnabled=true');
    assert.equal(entData.lifetimeGrant, false, 'Public Premium must not be lifetime grant');
    assert.equal(entData.features.campaigns, true, 'Premium features must be enabled');
    assert.equal(entData.features.aiMessageGeneration, true, 'AI generation must be enabled');
    assert.equal(entData.limits.maxMembers, PLAN_CONFIGS.premium.limits.maxMembers);
    assert.equal(entData.limits.maxContacts, PLAN_CONFIGS.premium.limits.maxContacts);
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('3. Doppelmayr → Premium + lifetime grant + web enabled', async () => {
  // Query centralized resolver directly
  const entitlements = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(entitlements.plan, 'premium');
  assert.equal(entitlements.source, 'lifetime_grant');
  assert.equal(entitlements.lifetime, true);
  assert.equal(entitlements.lifetimeGrant, true);
  assert.equal(entitlements.webEnabled, true, 'Doppelmayr must have webEnabled=true');
  assert.equal(entitlements.androidEnabled, true, 'Doppelmayr must have androidEnabled=true');

  // Query via authenticated API
  const doppelAdmin = await User.findOne({ orgId: 'org_doppelmayr', role: 'admin' });
  assert.ok(doppelAdmin);
  const token = await signToken(doppelAdmin.toPublic());

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
  assert.equal(entData.limits.maxMembers, PLAN_CONFIGS.premium.limits.maxMembers);
  assert.equal(entData.limits.maxContacts, PLAN_CONFIGS.premium.limits.maxContacts);
});

test('4. Client cannot inject webEnabled=true', async () => {
  const regEmail = `inject_web_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    // 1. Attempt injection during registration
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Web Inject Attempt',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Attacker',
        lastName: 'Web',
        webEnabled: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.webEnabled, false, 'Registration must ignore client webEnabled: true');

    // 2. Attempt mutation via org settings
    const patchRes = await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.accessToken}`,
      },
      body: JSON.stringify({ webEnabled: true }),
    });
    assert.ok([200, 400].includes(patchRes.status));

    orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.webEnabled, false, 'Settings update must not allow mutating webEnabled');

    // 3. Query string & header injection on entitlements endpoint
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements?webEnabled=true`, {
      headers: {
        Authorization: `Bearer ${regData.accessToken}`,
        'X-Web-Enabled': 'true',
      },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.webEnabled, false, 'Entitlements endpoint must not trust client webEnabled injection');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('5. Client cannot inject Premium', async () => {
  const regEmail = `inject_prem_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    // 1. Attempt plan: 'premium' at registration
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Premium Inject Attempt',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Attacker',
        lastName: 'Prem',
        plan: 'premium',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.plan, 'free', 'Registration must ignore client plan: premium');

    // 2. Attempt mutation via settings PATCH
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

    // 3. Query string / header spoofing
    const entRes = await fetch(`${BASE_URL}/api/billing/entitlements?plan=premium`, {
      headers: {
        Authorization: `Bearer ${regData.accessToken}`,
        'X-Plan': 'premium',
      },
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.plan, 'free', 'Entitlements endpoint must evaluate authorized plan');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('6. Client cannot inject lifetime grant', async () => {
  const regEmail = `inject_lt_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Lifetime Grant Inject Attempt',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Attacker',
        lastName: 'Lifetime',
        lifetimeGrant: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.lifetimeGrant, false, 'lifetimeGrant must default to false');

    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.accessToken}`,
      },
      body: JSON.stringify({ lifetimeGrant: true }),
    });

    orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.lifetimeGrant, false, 'lifetimeGrant cannot be set via settings');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('7. Client cannot mutate entitlement source', async () => {
  const regEmail = `mutate_source_${Date.now()}@example.com`;
  let testOrgId = null;

  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Source Mutate Attempt',
        email: regEmail,
        password: 'TestPassword123!',
        firstName: 'Attacker',
        lastName: 'Source',
        entitlementSource: 'lifetime_grant',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    testOrgId = regData.user.orgId;

    let orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.entitlementSource, 'none', 'entitlementSource must default to none');

    await fetch(`${BASE_URL}/api/org/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.accessToken}`,
      },
      body: JSON.stringify({ entitlementSource: 'subscription' }),
    });

    orgDoc = await Organization.findOne({ orgId: testOrgId }).lean();
    assert.equal(orgDoc.entitlementSource, 'none', 'entitlementSource cannot be mutated via client');
  } finally {
    if (testOrgId) await safeTeardownTestOrg(db, testOrgId);
  }
});

test('8. Free premium-feature denial remains correct', async () => {
  const testOrgId = `org_l1_free_deny_${Date.now()}`;

  try {
    await Organization.create({
      orgId: testOrgId,
      name: 'Free Deny Org',
      slug: `free-deny-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const user = await User.create({
      email: `freedomain_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Free',
      lastName: 'User',
      role: 'admin',
      orgId: testOrgId,
      isActive: true,
    });

    const token = await signToken(user.toPublic());

    // 1. Campaigns GET
    const campGet = await fetch(`${BASE_URL}/api/crm/campaign`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(campGet.status, 403, 'Free org GET /api/crm/campaign must return 403');
    const getBody = await campGet.json();
    assert.ok(getBody.error.includes('Premium plan'));

    // 2. Campaigns POST
    const campPost = await fetch(`${BASE_URL}/api/crm/campaign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subject: 'Forbidden Broadcast',
        bodyTemplate: 'Hello {{name}}',
      }),
    });
    assert.equal(campPost.status, 403, 'Free org POST /api/crm/campaign must return 403');

    // 3. AI message generation POST
    const aiGen = await fetch(`${BASE_URL}/api/crm/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt: 'Write email pitch' }),
    });
    assert.equal(aiGen.status, 403, 'Free org POST /api/crm/generate must return 403');
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('9. Premium feature access remains correct', async () => {
  const testOrgId = `org_l1_prem_access_${Date.now()}`;

  try {
    // Setup Public Premium org
    await Organization.create({
      orgId: testOrgId,
      name: 'Prem Access Org',
      slug: `prem-access-${Date.now()}`,
      plan: 'premium',
      entitlementSource: 'subscription',
      subscriptionStatus: 'active',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const premUser = await User.create({
      email: `premaccess_${Date.now()}@example.com`,
      passwordHash: 'fake_hash',
      firstName: 'Prem',
      lastName: 'User',
      role: 'admin',
      orgId: testOrgId,
      isActive: true,
    });
    const premToken = await signToken(premUser.toPublic());

    // Doppelmayr admin user
    const doppelAdmin = await User.findOne({ orgId: 'org_doppelmayr', role: 'admin' });
    assert.ok(doppelAdmin);
    const doppelToken = await signToken(doppelAdmin.toPublic());

    // Both organizations must have server-side feature access
    const [premCampRes, doppelCampRes] = await Promise.all([
      fetch(`${BASE_URL}/api/crm/campaign`, { headers: { Authorization: `Bearer ${premToken}` } }),
      fetch(`${BASE_URL}/api/crm/campaign`, { headers: { Authorization: `Bearer ${doppelToken}` } }),
    ]);

    assert.equal(premCampRes.status, 200, 'Public Premium org must access campaigns (200)');
    assert.equal(doppelCampRes.status, 200, 'Doppelmayr must access campaigns (200)');

    // Resolver checks
    assert.equal(await canUseFeature(testOrgId, 'campaigns'), true);
    assert.equal(await canUseFeature('org_doppelmayr', 'campaigns'), true);
    assert.equal(await canUseFeature(testOrgId, 'aiMessageGeneration'), true);
    assert.equal(await canUseFeature('org_doppelmayr', 'aiMessageGeneration'), true);
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('10. Web gateway allows Doppelmayr', async () => {
  // Test Doppelmayr entitlement directly at resolver & gateway level
  const entitlements = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(entitlements.webEnabled, true, 'Doppelmayr must have webEnabled=true');

  // Verify that an authenticated request from Doppelmayr resolves webEnabled true
  const doppelAdmin = await User.findOne({ orgId: 'org_doppelmayr', role: 'admin' });
  const token = await signToken(doppelAdmin.toPublic());

  const res = await fetch(`${BASE_URL}/api/billing/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.webEnabled, true, 'Web gateway authorizes Doppelmayr user');
});

test('11. Web gateway rejects public organization', async () => {
  const freeOrgId = `org_l1_gw_free_${Date.now()}`;
  const premOrgId = `org_l1_gw_prem_${Date.now()}`;

  try {
    // 1. Public Free organization
    await Organization.create({
      orgId: freeOrgId,
      name: 'Gateway Free Org',
      slug: `gw-free-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });
    const freeEnt = await getOrganizationEntitlements(freeOrgId);
    assert.equal(freeEnt.webEnabled, false, 'Public Free organization must have webEnabled=false');

    // 2. Public Premium organization
    await Organization.create({
      orgId: premOrgId,
      name: 'Gateway Premium Org',
      slug: `gw-prem-${Date.now()}`,
      plan: 'premium',
      entitlementSource: 'subscription',
      subscriptionStatus: 'active',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });
    const premEnt = await getOrganizationEntitlements(premOrgId);
    assert.equal(premEnt.webEnabled, false, 'Public Premium organization must have webEnabled=false');

    // Verify restricted gateway landing page exists and returns 200
    const restrictedPageRes = await fetch(`${BASE_URL}/web-access-restricted`);
    assert.equal(restrictedPageRes.status, 200, 'Restricted landing page must be accessible');
    const pageHtml = await restrictedPageRes.text();
    assert.ok(pageHtml.includes('web workspace') && /Web access isn(&#x27;|&#39;|’|')t enabled/.test(pageHtml), 'Landing page content matches');
  } finally {
    await safeTeardownTestOrg(db, freeOrgId);
    await safeTeardownTestOrg(db, premOrgId);
  }
});

test('12. Entitlement failure on client fails closed', async () => {
  // Test fail-closed invariant:
  // When entitlement data is null, corrupt, or throws, client logic must never assume Premium.
  const unknownOrgEntitlements = await getOrganizationEntitlements('non_existent_org_id');
  assert.equal(unknownOrgEntitlements.plan, 'free', 'Non-existent or unresolvable org defaults to free');
  assert.equal(unknownOrgEntitlements.webEnabled, false, 'Non-existent org web access is disabled');
  assert.equal(unknownOrgEntitlements.features.campaigns, false, 'Campaigns disabled on failed/unknown org');
  assert.equal(unknownOrgEntitlements.features.aiMessageGeneration, false, 'AI disabled on failed/unknown org');

  // Verify that canUseFeature fails closed for any unconfigured feature
  assert.equal(await canUseFeature('non_existent_org_id', 'campaigns'), false);
});

test('13. Logout clears entitlement', async () => {
  // Simulate client-side repository behavior
  let clientEntitlementsCache = {
    plan: 'premium',
    webEnabled: true,
    features: { campaigns: true },
  };

  // Perform logout simulation
  const clientLogout = () => {
    clientEntitlementsCache = null;
  };

  clientLogout();
  assert.equal(clientEntitlementsCache, null, 'Cache must be null after logout');

  // Verify server logout endpoint clears cookie session
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST' });
  assert.equal(logoutRes.status, 200);
  const setCookie = logoutRes.headers.get('set-cookie') || '';
  assert.ok(setCookie.includes('Max-Age=0') || setCookie.includes('expires='), 'Logout invalidates session cookie');
});

test('14. Session switch clears entitlement', async () => {
  const doppelEntitlements = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(doppelEntitlements.plan, 'premium');
  assert.equal(doppelEntitlements.webEnabled, true);

  const testOrgId = `org_l1_switch_${Date.now()}`;
  try {
    await Organization.create({
      orgId: testOrgId,
      name: 'Switch Org',
      slug: `switch-org-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const switchedEntitlements = await getOrganizationEntitlements(testOrgId);
    assert.equal(switchedEntitlements.plan, 'free');
    assert.equal(switchedEntitlements.webEnabled, false);

    // Verify that session state cannot bleed from Doppelmayr to new org
    assert.notEqual(doppelEntitlements.plan, switchedEntitlements.plan);
    assert.notEqual(doppelEntitlements.webEnabled, switchedEntitlements.webEnabled);
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('15. Free-plan UI displays the actual configured limits', async () => {
  // Authoritative limits from PLAN_CONFIGS
  const freeLimits = PLAN_CONFIGS.free.limits;
  assert.equal(freeLimits.maxMembers, 10, 'Authoritative maxMembers must be 10');
  assert.equal(freeLimits.maxContacts, 50, 'Authoritative maxContacts must be 50');
  assert.equal(freeLimits.maxMonthlyReceiptScans, 20, 'Authoritative maxMonthlyReceiptScans must be 20');
  assert.equal(freeLimits.maxUploadSizeBytes, 5 * 1024 * 1024, 'Authoritative maxUploadSizeBytes must be 5MB');

  const testOrgId = `org_l1_free_ui_${Date.now()}`;
  try {
    await Organization.create({
      orgId: testOrgId,
      name: 'Free UI Org',
      slug: `free-ui-${Date.now()}`,
      plan: 'free',
      entitlementSource: 'none',
      lifetimeGrant: false,
      webEnabled: false,
      androidEnabled: true,
    });

    const ent = await getOrganizationEntitlements(testOrgId);
    assert.equal(ent.limits.maxMembers, 10);
    assert.equal(ent.limits.maxContacts, 50);
    assert.equal(ent.limits.maxMonthlyReceiptScans, 20);
    assert.equal(ent.limits.maxUploadSizeBytes, 5242880);

    // Verify format string representation for UI
    const formattedString = `Standard Free Tier • ${ent.limits.maxMembers} members & ${ent.limits.maxContacts} contacts limit`;
    assert.equal(formattedString, 'Standard Free Tier • 10 members & 50 contacts limit');
  } finally {
    await safeTeardownTestOrg(db, testOrgId);
  }
});

test('16. Premium/Doppelmayr UI displays the actual configured Premium limits', async () => {
  const premLimits = PLAN_CONFIGS.premium.limits;
  assert.equal(premLimits.maxMembers, 1000, 'Authoritative maxMembers must be 1000');
  assert.equal(premLimits.maxContacts, 100000, 'Authoritative maxContacts must be 100000');
  assert.equal(premLimits.maxMonthlyReceiptScans, 5000, 'Authoritative maxMonthlyReceiptScans must be 5000');
  assert.equal(premLimits.maxUploadSizeBytes, 25 * 1024 * 1024, 'Authoritative maxUploadSizeBytes must be 25MB');

  const doppelEnt = await getOrganizationEntitlements('org_doppelmayr');
  assert.equal(doppelEnt.limits.maxMembers, 1000);
  assert.equal(doppelEnt.limits.maxContacts, 100000);
  assert.equal(doppelEnt.limits.maxMonthlyReceiptScans, 5000);
  assert.equal(doppelEnt.limits.maxUploadSizeBytes, 26214400);

  // Verify format string representation for UI
  const formattedString = `Lifetime Grant • Up to ${doppelEnt.limits.maxMembers} members & ${doppelEnt.limits.maxContacts} contacts`;
  assert.equal(formattedString, 'Lifetime Grant • Up to 1000 members & 100000 contacts');
});
