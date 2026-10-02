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
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const { signToken } = jiti(path.resolve(__dirname, '../lib/auth/jwt.ts'));

// Tracking sets for safe teardown
const createdTestOrgs = new Set();
const createdTestUserIds = new Set();

let tenantAData = null;
let tenantBData = null;
let tokenAdminA = null;
let tokenAdminB = null;
let tokenEmpA = null;

let ipSeq = 200;
function registerPost(body) {
  return fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.99.2.${ipSeq++}`,
    },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
  await Organization.ensureDoppelmayr();
});

test.after(async () => {
  // Ensure test data cleanup
  const orgList = Array.from(createdTestOrgs);
  const userList = Array.from(createdTestUserIds);
  if (orgList.length > 0 || userList.length > 0) {
    await Organization.deleteMany({ orgId: { $in: orgList } });
    await OrgSettings.deleteMany({ orgId: { $in: orgList } });
    await User.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: userList } }] });
    await Employee.deleteMany({ $or: [{ orgId: { $in: orgList } }, { clerkUserId: { $in: userList } }] });
    await LeaveBalance.deleteMany({ $or: [{ orgId: { $in: orgList } }, { userId: { $in: userList } }] });
  }
  await mongoose.disconnect();
});

// -------------------------------------------------------------
// 1. SETUP & NEW ORGANIZATION ISOLATED SETTINGS
// -------------------------------------------------------------
test('1. Setup: Register Tenant A and Tenant B, verifying isolated OrgSettings created for each', async () => {
  const ts = Date.now();

  // Register Tenant A
  const resA = await registerPost({
    organizationName: 'Tenant Alpha Corp',
    name: 'Alice Alpha',
    email: `admin_alpha_${ts}@test-tenant-a.com`,
    password: 'Password123!',
  });
  assert.equal(resA.status, 201);
  tenantAData = await resA.json();
  tokenAdminA = tenantAData.accessToken;
  createdTestOrgs.add(tenantAData.organization.orgId);
  createdTestUserIds.add(tenantAData.user.id);

  // Register Tenant B
  const resB = await registerPost({
    organizationName: 'Tenant Beta Ltd',
    name: 'Bob Beta',
    email: `admin_beta_${ts}@test-tenant-b.com`,
    password: 'Password123!',
  });
  assert.equal(resB.status, 201);
  tenantBData = await resB.json();
  tokenAdminB = tenantBData.accessToken;
  createdTestOrgs.add(tenantBData.organization.orgId);
  createdTestUserIds.add(tenantBData.user.id);

  // Verify DB records exist and have distinct orgIds
  const settingsA = await OrgSettings.findOne({ orgId: tenantAData.organization.orgId }).lean();
  const settingsB = await OrgSettings.findOne({ orgId: tenantBData.organization.orgId }).lean();

  assert.ok(settingsA, 'Tenant A settings must exist in DB');
  assert.ok(settingsB, 'Tenant B settings must exist in DB');
  assert.notEqual(settingsA.orgId, settingsB.orgId, 'Tenant A and B must have different orgIds');
  assert.equal(settingsA.name, 'Tenant Alpha Corp');
  assert.equal(settingsB.name, 'Tenant Beta Ltd');

  // Create an employee in Tenant A for permission testing
  const empA = await User.create({
    orgId: tenantAData.organization.orgId,
    email: `emp_alpha_${ts}@test-tenant-a.com`,
    passwordHash: 'dummyhash',
    role: 'employee',
    permissions: [],
    firstName: 'Emp',
    lastName: 'Alpha',
    employeeId: 'EMP-1111',
  });
  createdTestUserIds.add(empA._id.toString());
  tokenEmpA = await signToken({
    id: empA._id.toString(),
    userId: empA._id.toString(),
    email: empA.email,
    role: 'employee',
    orgId: tenantAData.organization.orgId,
    firstName: 'Emp',
    lastName: 'Alpha',
    permissions: [],
  });
});

// -------------------------------------------------------------
// 2. READ: TENANT A CAN READ OWN SETTINGS
// -------------------------------------------------------------
test('2. Tenant A can read its own settings via GET /api/org/settings and /api/admin/settings', async () => {
  // Test /api/org/settings
  const resOrg = await fetch(`${BASE_URL}/api/org/settings`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resOrg.status, 200);
  const dataOrg = await resOrg.json();
  assert.equal(dataOrg.orgId, tenantAData.organization.orgId);
  assert.equal(dataOrg.name, 'Tenant Alpha Corp');

  // Test /api/admin/settings
  const resAdmin = await fetch(`${BASE_URL}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(resAdmin.status, 200);
  const dataAdmin = await resAdmin.json();
  assert.equal(dataAdmin.orgId, tenantAData.organization.orgId);
  assert.equal(dataAdmin.name, 'Tenant Alpha Corp');
});

// -------------------------------------------------------------
// 3. READ: TENANT B CAN READ OWN SETTINGS
// -------------------------------------------------------------
test('3. Tenant B can read its own settings via GET /api/org/settings and /api/admin/settings', async () => {
  const res = await fetch(`${BASE_URL}/api/org/settings`, {
    headers: { Authorization: `Bearer ${tokenAdminB}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.orgId, tenantBData.organization.orgId);
  assert.equal(data.name, 'Tenant Beta Ltd');
});

// -------------------------------------------------------------
// 4. READ ISOLATION: TENANT A CANNOT READ TENANT B SETTINGS
// -------------------------------------------------------------
test('4. Cross-Tenant Read Isolation: Tenant A cannot retrieve Tenant B settings via query or header injection', async () => {
  const forgedRes = await fetch(`${BASE_URL}/api/admin/settings?orgId=${tenantBData.organization.orgId}`, {
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'X-Org-Id': tenantBData.organization.orgId,
      'X-Tenant-Id': tenantBData.organization.orgId,
      'X-Organization-Id': tenantBData.organization.orgId,
    },
  });

  assert.equal(forgedRes.status, 200);
  const data = await forgedRes.json();
  // Must return Tenant A's settings, NOT Tenant B's
  assert.equal(data.orgId, tenantAData.organization.orgId, 'Must return caller orgId, ignoring query/header params');
  assert.notEqual(data.orgId, tenantBData.organization.orgId);
  assert.equal(data.name, 'Tenant Alpha Corp');
});

// -------------------------------------------------------------
// 5. UPDATE: TENANT A CAN UPDATE ITS OWN SETTINGS
// -------------------------------------------------------------
test('5. Tenant A can update its own settings (companyName, timezone, currency, etc.)', async () => {
  // Test PATCH /api/admin/settings
  const patchRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      companyName: 'TENANT_A_COMPANY',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      address: 'Plot 42, Tech Park, Alpha City',
      website: 'https://alpha.example.com',
      phone: '+91 98765 43210',
    }),
  });

  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.orgId, tenantAData.organization.orgId);
  assert.equal(patchData.name, 'TENANT_A_COMPANY');
  assert.equal(patchData.companyName, 'TENANT_A_COMPANY');
  assert.equal(patchData.timezone, 'Asia/Kolkata');
  assert.equal(patchData.currency, 'INR');
  assert.equal(patchData.website, 'https://alpha.example.com');

  // Verify directly in MongoDB
  const dbDoc = await OrgSettings.findOne({ orgId: tenantAData.organization.orgId }).lean();
  assert.equal(dbDoc.name, 'TENANT_A_COMPANY');
  assert.equal(dbDoc.timezone, 'Asia/Kolkata');

  // Also verify Organization model was kept in sync
  const orgDoc = await Organization.findOne({ orgId: tenantAData.organization.orgId }).lean();
  assert.equal(orgDoc.name, 'TENANT_A_COMPANY');
});

// -------------------------------------------------------------
// 6. UPDATE: TENANT B UPDATES OWN SETTINGS INDEPENDENTLY
// -------------------------------------------------------------
test('6. Tenant B updates its own settings to distinct values', async () => {
  const putRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      companyName: 'TENANT_B_COMPANY',
      timezone: 'Europe/London',
      currency: 'GBP',
      address: '10 Downing Court, London',
      website: 'https://beta.example.co.uk',
    }),
  });

  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.orgId, tenantBData.organization.orgId);
  assert.equal(putData.name, 'TENANT_B_COMPANY');
  assert.equal(putData.timezone, 'Europe/London');
  assert.equal(putData.currency, 'GBP');

  // Verify Tenant A remained completely unchanged
  const aDoc = await OrgSettings.findOne({ orgId: tenantAData.organization.orgId }).lean();
  assert.equal(aDoc.name, 'TENANT_A_COMPANY');
  assert.equal(aDoc.timezone, 'Asia/Kolkata');
  assert.equal(aDoc.currency, 'INR');
});

// -------------------------------------------------------------
// 7. CROSS-TENANT WRITE ATTACK: INJECTED FOREIGN ORGID
// -------------------------------------------------------------
test('7. Cross-Tenant Write Attack: Admin A cannot modify Tenant B settings via body orgId injection', async () => {
  // Admin A sends malicious payload with orgId: tenantB
  const attackRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orgId: tenantBData.organization.orgId,
      organizationId: tenantBData.organization.orgId,
      tenantId: tenantBData.organization.orgId,
      companyName: 'ATTACKED_BY_ADMIN_A',
      timezone: 'America/New_York',
    }),
  });

  // Request completes for Admin A's tenant, but MUST NOT touch Tenant B
  assert.equal(attackRes.status, 200);

  // Tenant B in MongoDB MUST be 100% unchanged
  const bDoc = await OrgSettings.findOne({ orgId: tenantBData.organization.orgId }).lean();
  assert.equal(bDoc.name, 'TENANT_B_COMPANY', 'Tenant B companyName must remain untampered');
  assert.equal(bDoc.timezone, 'Europe/London', 'Tenant B timezone must remain untampered');
  assert.equal(bDoc.currency, 'GBP', 'Tenant B currency must remain untampered');
  assert.notEqual(bDoc.name, 'ATTACKED_BY_ADMIN_A');
});

// -------------------------------------------------------------
// 8. QUERY & HEADER TAMPERING ON MUTATION
// -------------------------------------------------------------
test('8. Query and header tampering on mutation strictly adheres to authenticated tenant context', async () => {
  const tamperRes = await fetch(`${BASE_URL}/api/org/settings?orgId=${tenantBData.organization.orgId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
      'X-Org-Id': tenantBData.organization.orgId,
      'X-Tenant-Id': tenantBData.organization.orgId,
    },
    body: JSON.stringify({
      companyName: 'TENANT_A_CONFIRMED',
      timezone: 'Asia/Kolkata',
    }),
  });

  assert.equal(tamperRes.status, 200);
  const data = await tamperRes.json();
  assert.equal(data.orgId, tenantAData.organization.orgId);
  assert.equal(data.name, 'TENANT_A_CONFIRMED');

  // Verify B remains unaffected
  const bDoc = await OrgSettings.findOne({ orgId: tenantBData.organization.orgId }).lean();
  assert.equal(bDoc.name, 'TENANT_B_COMPANY');
});

// -------------------------------------------------------------
// 9. RBAC: NON-ADMIN CANNOT MUTATE SETTINGS
// -------------------------------------------------------------
test('9. RBAC: Employee can GET own org settings but cannot POST/PATCH/PUT (403 Forbidden)', async () => {
  // GET should succeed for employee
  const getRes = await fetch(`${BASE_URL}/api/org/settings`, {
    headers: { Authorization: `Bearer ${tokenEmpA}` },
  });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.orgId, tenantAData.organization.orgId);

  // POST must be forbidden (403)
  const postRes = await fetch(`${BASE_URL}/api/org/settings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenEmpA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companyName: 'HACKED_BY_EMPLOYEE' }),
  });
  assert.equal(postRes.status, 403);

  // PATCH must be forbidden (403)
  const patchRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenEmpA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companyName: 'HACKED_BY_EMPLOYEE' }),
  });
  assert.equal(patchRes.status, 403);

  // Verify settings remain unchanged
  const aDoc = await OrgSettings.findOne({ orgId: tenantAData.organization.orgId }).lean();
  assert.equal(aDoc.name, 'TENANT_A_CONFIRMED');
});

// -------------------------------------------------------------
// 10. DATABASE UNIQUENESS: ORGID UNIQUE INDEX ENFORCEMENT
// -------------------------------------------------------------
test('10. Database Uniqueness: OrgSettings orgId is unique and rejects duplicate insert', async () => {
  let duplicateError = null;
  try {
    await OrgSettings.create({
      orgId: tenantAData.organization.orgId,
      name: 'Duplicate Org',
      updatedBy: 'someone',
    });
  } catch (err) {
    duplicateError = err;
  }

  assert.ok(duplicateError, 'Duplicate orgId insert must throw error');
  // MongoDB duplicate key error code is 11000
  assert.equal(duplicateError.code, 11000, 'Error code must be 11000 (duplicate key)');
});

// -------------------------------------------------------------
// 11. NO GLOBAL / DEFAULT SETTINGS LEAKAGE
// -------------------------------------------------------------
test('11. No global/default settings record causes cross-tenant sharing', async () => {
  // Ensure no singleton record with _id="default" or orgId="default" exists
  const defaultById = await OrgSettings.collection.findOne({ _id: 'default' });
  assert.equal(defaultById, null);

  const defaultByOrgId = await OrgSettings.findOne({ orgId: 'default' }).lean();
  assert.equal(defaultByOrgId, null);

  // Every single settings record in DB must have a valid orgId
  const allSettings = await OrgSettings.find({}).lean();
  for (const s of allSettings) {
    assert.ok(s.orgId, `OrgSettings ${s._id} must have an orgId`);
    assert.match(s.orgId, /^org_/, 'orgId must begin with org_ prefix');
  }
});

// -------------------------------------------------------------
// 12. EXISTING DOPPELMAYR SETTINGS REMAIN INTACT
// -------------------------------------------------------------
test('12. Existing org_doppelmayr settings remain intact and isolated', async () => {
  const doppelSettings = await OrgSettings.findOne({ orgId: 'org_doppelmayr' }).lean();
  assert.ok(doppelSettings, 'org_doppelmayr settings must exist');
  assert.equal(doppelSettings.name, 'Doppelmayr India Pvt Ltd');
  assert.equal(doppelSettings.website, 'https://www.doppelmayr.com');
  assert.equal(doppelSettings.email, 'info@doppelmayr.com');
  assert.notEqual(doppelSettings.name, 'TENANT_A_COMPANY');
  assert.notEqual(doppelSettings.name, 'TENANT_B_COMPANY');
});

// -------------------------------------------------------------
// 13. DIRECT MONGODB VERIFICATION & CLEAN TEARDOWN
// -------------------------------------------------------------
test('13. Direct MongoDB Verification: Clean test teardown leaves zero test artifacts and intact Doppelmayr data', async () => {
  const orgList = Array.from(createdTestOrgs);
  const userList = Array.from(createdTestUserIds);

  // 1. Verify before delete that both test tenant settings exist
  const countTestSettings = await OrgSettings.countDocuments({ orgId: { $in: orgList } });
  assert.equal(countTestSettings, 2, 'Exactly 2 test OrgSettings records should exist before cleanup');

  // 2. Perform teardown
  await Organization.deleteMany({ orgId: { $in: orgList } });
  await OrgSettings.deleteMany({ orgId: { $in: orgList } });
  await User.deleteMany({ $or: [{ orgId: { $in: orgList } }, { _id: { $in: userList } }] });
  await Employee.deleteMany({ $or: [{ orgId: { $in: orgList } }, { clerkUserId: { $in: userList } }] });
  await LeaveBalance.deleteMany({ $or: [{ orgId: { $in: orgList } }, { userId: { $in: userList } }] });
  await RefreshToken.deleteMany({ userId: { $in: userList } });

  // 3. Confirm 0 test artifacts remain
  const testOrgsRemain = await Organization.countDocuments({ orgId: { $ne: 'org_doppelmayr' } });
  assert.equal(testOrgsRemain, 0);

  const testSettingsRemain = await OrgSettings.countDocuments({ orgId: { $ne: 'org_doppelmayr' } });
  assert.equal(testSettingsRemain, 0);

  const testUsersRemain = await User.countDocuments({ orgId: { $ne: 'org_doppelmayr' } });
  assert.equal(testUsersRemain, 0);

  // 4. Confirm Doppelmayr data is 100% untouched
  const doppelUsers = await User.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelEmps = await Employee.countDocuments({ orgId: 'org_doppelmayr' });
  const doppelSettingsRemain = await OrgSettings.countDocuments({ orgId: 'org_doppelmayr' });
  assert.equal(doppelUsers, 9);
  assert.equal(doppelEmps, 9);
  assert.equal(doppelSettingsRemain, 1);
});
