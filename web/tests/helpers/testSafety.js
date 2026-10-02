/**
 * DoppelDash — Test Safety & Data Integrity Harness
 *
 * Enforces strict boundaries between test fixtures and production Doppelmayr data:
 * 1. Hard-blocks any destructive teardown on protected organizations ('org_doppelmayr').
 * 2. Provides safe, tenant-scoped fixture cleanup that NEVER uses untyped $nin queries.
 * 3. Audits database relationships to guarantee zero orphaned records or foreign-org residue.
 */

const assert = require('node:assert/strict');

const PROTECTED_ORG_IDS = Object.freeze([
  'org_doppelmayr',
  'doppelmayr',
]);

const BUSINESS_COLLECTIONS = Object.freeze([
  'organizations',
  'orgsettings',
  'users',
  'employees',
  'contacts',
  'expenses',
  'travelrequests',
  'leaves',
  'leavebalances',
  'announcements',
  'auditlogs',
  'invitations',
  'subscriptions',
]);

/**
 * Asserts that the target orgId is not protected.
 * Throws a fatal Error if any test code attempts to delete protected data.
 */
function assertSafeTeardown(orgId) {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error(`[SAFETY VIOLATION] Invalid orgId supplied for teardown: ${JSON.stringify(orgId)}`);
  }
  if (PROTECTED_ORG_IDS.includes(orgId.toLowerCase().trim())) {
    throw new Error(
      `[CRITICAL SAFETY VIOLATION] Refusing destructive teardown on protected organization '${orgId}'! Real Doppelmayr data must NEVER be treated as a disposable test tenant.`
    );
  }
}

/**
 * Captures an exact baseline of Doppelmayr records.
 */
async function getDoppelmayrBaseline(db) {
  const baseline = {};
  for (const collName of BUSINESS_COLLECTIONS) {
    const query = collName === 'organizations'
      ? { $or: [{ orgId: 'org_doppelmayr' }, { slug: 'doppelmayr' }] }
      : { orgId: 'org_doppelmayr' };
    baseline[collName] = await db.collection(collName).countDocuments(query);
  }
  return baseline;
}

/**
 * Safely tears down a disposable test tenant.
 * Guaranteed to only target the specified testOrgId and testUserIds.
 */
async function safeTeardownTestOrg(db, testOrgId, testUserIds = []) {
  assertSafeTeardown(testOrgId);

  // 1. Collect all user IDs belonging to testOrgId so auth tokens can be cleaned up
  const orgUsers = await db.collection('users').find({ orgId: testOrgId }).toArray();
  const allUserIds = Array.from(new Set([...testUserIds.map(String), ...orgUsers.map(u => String(u._id))]));

  // 2. Delete all org-scoped records
  await db.collection('organizations').deleteOne({ $or: [{ orgId: testOrgId }, { slug: testOrgId }] });
  await db.collection('orgsettings').deleteMany({ orgId: testOrgId });
  await db.collection('users').deleteMany({ orgId: testOrgId });
  await db.collection('employees').deleteMany({ orgId: testOrgId });
  await db.collection('contacts').deleteMany({ orgId: testOrgId });
  await db.collection('travelrequests').deleteMany({ orgId: testOrgId });
  await db.collection('expenses').deleteMany({ orgId: testOrgId });
  await db.collection('leaves').deleteMany({ orgId: testOrgId });
  await db.collection('leavebalances').deleteMany({ orgId: testOrgId });
  await db.collection('announcements').deleteMany({ orgId: testOrgId });
  await db.collection('auditlogs').deleteMany({ orgId: testOrgId });
  await db.collection('invitations').deleteMany({ orgId: testOrgId });
  await db.collection('subscriptions').deleteMany({ orgId: testOrgId });

  // 3. Delete test user auth tokens (string userId match)
  if (allUserIds.length > 0) {
    await db.collection('refreshtokens').deleteMany({ userId: { $in: allUserIds } });
    await db.collection('revokedtokens').deleteMany({ userId: { $in: allUserIds } });
    await db.collection('passwordresettokens').deleteMany({ userId: { $in: allUserIds } });
  }
}

/**
 * Audits full relational integrity of the database.
 * Returns an array of integrity violation descriptions (empty if perfectly valid).
 */
async function auditDatabaseIntegrity(db) {
  const violations = [];

  const users = await db.collection('users').find({}).toArray();
  const userStringIds = new Set(users.map(u => u._id.toString()));
  const userOrgMap = new Map(users.map(u => [u._id.toString(), u.orgId]));

  // 1. Check Employees -> valid User + matching org
  const employees = await db.collection('employees').find({}).toArray();
  for (const emp of employees) {
    if (!userStringIds.has(emp.clerkUserId)) {
      violations.push(`Employee ${emp.employeeId} has clerkUserId ${emp.clerkUserId} not found in users`);
    } else if (userOrgMap.get(emp.clerkUserId) !== emp.orgId) {
      violations.push(`Employee ${emp.employeeId} orgId (${emp.orgId}) does not match User orgId (${userOrgMap.get(emp.clerkUserId)})`);
    }
  }

  // 2. Check LeaveBalances -> valid User + matching org + year
  const balances = await db.collection('leavebalances').find({}).toArray();
  const seenBalances = new Set();
  for (const bal of balances) {
    const key = `${bal.orgId}:${bal.userId}:${bal.year}`;
    if (seenBalances.has(key)) {
      violations.push(`Duplicate LeaveBalance found for key ${key}`);
    }
    seenBalances.add(key);

    if (!userStringIds.has(bal.userId)) {
      violations.push(`LeaveBalance ${bal._id} has userId ${bal.userId} not found in users`);
    } else if (userOrgMap.get(bal.userId) !== bal.orgId) {
      violations.push(`LeaveBalance ${bal._id} orgId (${bal.orgId}) does not match User orgId (${userOrgMap.get(bal.userId)})`);
    }
    if (!bal.year || typeof bal.year !== 'number') {
      violations.push(`LeaveBalance ${bal._id} has invalid year: ${bal.year}`);
    }
  }

  // 3. Check Leaves -> valid User + matching org
  const leaves = await db.collection('leaves').find({}).toArray();
  for (const l of leaves) {
    if (!userStringIds.has(l.userId)) {
      violations.push(`Leave ${l._id} has userId ${l.userId} not found in users`);
    } else if (userOrgMap.get(l.userId) !== l.orgId) {
      violations.push(`Leave ${l._id} orgId (${l.orgId}) does not match User orgId (${userOrgMap.get(l.userId)})`);
    }
  }

  // 4. Check Expenses -> valid User + matching org
  const expenses = await db.collection('expenses').find({}).toArray();
  for (const exp of expenses) {
    if (!userStringIds.has(exp.userId)) {
      violations.push(`Expense ${exp._id} has userId ${exp.userId} not found in users`);
    } else if (userOrgMap.get(exp.userId) !== exp.orgId) {
      violations.push(`Expense ${exp._id} orgId (${exp.orgId}) does not match User orgId (${userOrgMap.get(exp.userId)})`);
    }
  }

  // 5. Check TravelRequests -> valid User + matching org
  const travels = await db.collection('travelrequests').find({}).toArray();
  for (const tr of travels) {
    if (!userStringIds.has(tr.userId)) {
      violations.push(`TravelRequest ${tr._id} has userId ${tr.userId} not found in users`);
    } else if (userOrgMap.get(tr.userId) !== tr.orgId) {
      violations.push(`TravelRequest ${tr._id} orgId (${tr.orgId}) does not match User orgId (${userOrgMap.get(tr.userId)})`);
    }
  }

  // 6. Check RefreshTokens -> valid User
  const tokens = await db.collection('refreshtokens').find({}).toArray();
  for (const tok of tokens) {
    if (!userStringIds.has(tok.userId)) {
      violations.push(`RefreshToken ${tok._id} has userId ${tok.userId} not found in users`);
    }
  }

  // 7. Check Foreign Org residue (any non-Doppelmayr org when in test-clean state)
  const orgs = await db.collection('organizations').find({}).toArray();
  for (const org of orgs) {
    const slug = org.slug || org.orgId;
    if (slug !== 'doppelmayr' && org.orgId !== 'org_doppelmayr') {
      violations.push(`Foreign organization found in database: ${slug} (${org.orgId})`);
    }
  }

  return violations;
}

module.exports = {
  PROTECTED_ORG_IDS,
  BUSINESS_COLLECTIONS,
  assertSafeTeardown,
  getDoppelmayrBaseline,
  safeTeardownTestOrg,
  auditDatabaseIntegrity,
};
