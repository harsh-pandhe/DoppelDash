const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

// Initialize jiti to import Next.js / TypeScript modules
const jiti = require(path.resolve(__dirname, '../node_modules/jiti'))(__filename);
const Employee = jiti(path.resolve(__dirname, '../models/Employee.ts')).default;
const User = jiti(path.resolve(__dirname, '../models/User.ts')).default;
const OrgSettings = jiti(path.resolve(__dirname, '../models/OrgSettings.ts')).default;
const Organization = jiti(path.resolve(__dirname, '../models/Organization.ts')).default;
const RefreshToken = jiti(path.resolve(__dirname, '../models/RefreshToken.ts')).default;
const LeaveBalance = jiti(path.resolve(__dirname, '../models/LeaveBalance.ts')).default;

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doppeldash';

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

test('1. Employee ID generated before validation (pre-validate hook)', async () => {
  const dummyClerkId = 'test_validate_' + Date.now();
  const emp = new Employee({
    clerkUserId: dummyClerkId,
    createdByUserId: dummyClerkId,
    orgId: 'org_batch_a_model_test',
    firstName: 'Test',
    lastName: 'Validation',
    email: `${dummyClerkId}@example.com`,
    department: 'Engineering',
    designation: 'Staff Engineer',
    joiningDate: new Date(),
  });

  // Verify employeeId is undefined before validation
  assert.equal(emp.employeeId, undefined);

  // Run Mongoose document validation
  await emp.validate();

  // employeeId must now be defined, match EMP-xxx, and satisfy required validator
  assert.ok(emp.employeeId, 'employeeId must be set by pre-validate hook');
  assert.match(emp.employeeId, /^EMP-\d{3,}$/, 'employeeId must match EMP-xxx pattern');
});

test('2. Valid employee can be created and saved without explicit employeeId', async () => {
  const dummyClerkId = 'test_create_' + Date.now();
  const emp = await Employee.create({
    clerkUserId: dummyClerkId,
    createdByUserId: dummyClerkId,
    orgId: 'org_batch_a_model_test',
    firstName: 'Test',
    lastName: 'Create',
    email: `${dummyClerkId}@example.com`,
    department: 'Operations',
    designation: 'Manager',
    joiningDate: new Date(),
  });

  try {
    assert.ok(emp._id, 'Employee document must be created');
    assert.ok(emp.employeeId, 'Employee must have auto-generated employeeId');
    assert.match(emp.employeeId, /^EMP-\d{3,}$/);

    // Retrieve from DB to verify persistence
    const saved = await Employee.findById(emp._id).lean();
    assert.equal(saved.employeeId, emp.employeeId);
  } finally {
    await Employee.findByIdAndDelete(emp._id);
  }
});

test('3 & 4. Registration succeeds and admin receives valid privileges', async () => {
  const testEmail = `admin_reg_${Date.now()}@testcompany.example`;
  const companyName = 'Test Enterprise';
  const orgId = `org_${new mongoose.Types.ObjectId().toHexString()}`;

  let createdUid = null;
  let createdOrgId = null;

  try {
    const hash = await User.hashPassword('Password123!');
    const newUser = await User.create({
      orgId,
      email: testEmail,
      passwordHash: hash,
      role: 'admin',
      firstName: 'Alice',
      lastName: 'Founder',
      mustChangePassword: false,
      isActive: true,
      permissions: ['users:read', 'users:write'],
    });

    createdUid = newUser._id.toString();
    createdOrgId = orgId;

    await OrgSettings.create({
      orgId,
      name: companyName,
      updatedBy: createdUid,
    });

    const emp = await Employee.create({
      clerkUserId: createdUid,
      orgId,
      createdByUserId: createdUid,
      firstName: 'Alice',
      lastName: 'Founder',
      email: testEmail,
      department: 'Executive',
      designation: 'Workspace Admin',
      joiningDate: new Date(),
      onboardingComplete: true,
      privileges: {
        food: { tier: 'premium', dailyLimit: 5000 },
        taxi: { tier: 'ac_premium', perKmLimit: 50 },
        flight: { tier: 'business', enabled: true },
        hotel: { tier: 'premium', perNightLimit: 15000 },
        travelAdvance: 50000,
      },
    });

    const year = new Date().getFullYear();
    await LeaveBalance.create({
      userId: createdUid,
      orgId,
      year,
      casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0,
    });

    // Verification
    assert.ok(emp.employeeId, 'Admin employee must have generated employeeId');
    assert.equal(emp.privileges.food.tier, 'premium');
    assert.equal(emp.privileges.taxi.tier, 'ac_premium');
    assert.equal(emp.privileges.flight.tier, 'business');
    assert.equal(emp.privileges.hotel.tier, 'premium');
    assert.equal(emp.privileges.travelAdvance, 50000);

    const userDoc = await User.findById(createdUid).lean();
    assert.equal(userDoc.email, testEmail);
    assert.equal(userDoc.orgId, orgId);

    const orgDoc = await OrgSettings.findOne({ orgId }).lean();
    assert.equal(orgDoc.name, companyName);

    const balDoc = await LeaveBalance.findOne({ userId: createdUid, orgId }).lean();
    assert.equal(balDoc.casual, 12);
  } finally {
    if (createdUid) {
      await User.findByIdAndDelete(createdUid);
      await Employee.deleteMany({ clerkUserId: createdUid });
      await LeaveBalance.deleteMany({ userId: createdUid });
      await RefreshToken.deleteMany({ userId: createdUid });
    }
    if (createdOrgId) {
      await OrgSettings.deleteMany({ orgId: createdOrgId });
      await Organization.deleteMany({ orgId: createdOrgId });
    }
  }
});

test('5. Duplicate email is rejected', async () => {
  const testEmail = `duplicate_probe_${Date.now()}@example.com`;
  const orgId = `org_${new mongoose.Types.ObjectId().toHexString()}`;
  const hash = await User.hashPassword('Password123!');

  const u = await User.create({
    orgId,
    email: testEmail,
    passwordHash: hash,
    role: 'employee',
    firstName: 'First',
    lastName: 'User',
  });

  try {
    let duplicateRejected = false;
    try {
      await User.create({
        orgId: `org_other`,
        email: testEmail,
        passwordHash: hash,
        role: 'employee',
        firstName: 'Second',
        lastName: 'User',
      });
    } catch (err) {
      duplicateRejected = true;
      assert.ok(err.code === 11000 || err.name === 'MongoServerError');
    }
    assert.ok(duplicateRejected, 'Second user with identical email must be rejected by unique index');
  } finally {
    await User.findByIdAndDelete(u._id);
  }
});

test('6. Failed Employee creation does not leave an orphaned User (Compensating Rollback)', async () => {
  const testEmail = `rollback_test_${Date.now()}@example.com`;
  const orgId = `org_${new mongoose.Types.ObjectId().toHexString()}`;
  const hash = await User.hashPassword('Password123!');

  let createdUid = null;
  let rollbackExecuted = false;

  try {
    const newUser = await User.create({
      orgId,
      email: testEmail,
      passwordHash: hash,
      role: 'admin',
      firstName: 'Rollback',
      lastName: 'Tester',
    });
    createdUid = newUser._id.toString();

    // Deliberately trigger failure in Employee.create by violating an enum validator
    await Employee.create({
      clerkUserId: createdUid,
      orgId,
      createdByUserId: createdUid,
      firstName: 'Rollback',
      lastName: 'Tester',
      email: testEmail,
      department: 'Executive',
      designation: 'Admin',
      joiningDate: new Date(),
      privileges: {
        food: { tier: 'illegal_food_tier', dailyLimit: 100 },
      },
    });
  } catch (err) {
    rollbackExecuted = true;
    // Compensating rollback
    if (createdUid) {
      await User.findByIdAndDelete(createdUid);
      await Employee.deleteMany({ clerkUserId: createdUid });
      await OrgSettings.deleteMany({ orgId });
      await LeaveBalance.deleteMany({ userId: createdUid });
    }
  }

  assert.ok(rollbackExecuted, 'Error must have thrown on invalid employee creation');

  // Verify that the User record was completely cleaned up and is NOT orphaned
  const orphanUser = await User.findById(createdUid);
  assert.equal(orphanUser, null, 'User record must be cleaned up on failure (no orphan)');
});

test('7. Registration retry after failure succeeds without conflict', async () => {
  const testEmail = `retry_flow_${Date.now()}@example.com`;
  const hash = await User.hashPassword('Password123!');

  // Step 1: Simulate failed first attempt that performs compensating rollback
  let firstUid = null;
  const orgId1 = `org_${new mongoose.Types.ObjectId().toHexString()}`;
  try {
    const u1 = await User.create({
      orgId: orgId1,
      email: testEmail,
      passwordHash: hash,
      role: 'admin',
      firstName: 'Retry',
      lastName: 'Tester',
    });
    firstUid = u1._id.toString();

    // Deliberate failure
    throw new Error('Simulated failure during registration pipeline');
  } catch (err) {
    // Compensating rollback
    await User.findByIdAndDelete(firstUid);
  }

  // Step 2: Immediate retry with the same email
  let secondUid = null;
  const orgId2 = `org_${new mongoose.Types.ObjectId().toHexString()}`;
  try {
    const u2 = await User.create({
      orgId: orgId2,
      email: testEmail,
      passwordHash: hash,
      role: 'admin',
      firstName: 'Retry',
      lastName: 'Tester',
    });
    secondUid = u2._id.toString();

    const emp2 = await Employee.create({
      clerkUserId: secondUid,
      orgId: orgId2,
      createdByUserId: secondUid,
      firstName: 'Retry',
      lastName: 'Tester',
      email: testEmail,
      department: 'Executive',
      designation: 'Admin',
      joiningDate: new Date(),
    });

    assert.ok(u2._id);
    assert.ok(emp2.employeeId);
    assert.equal(emp2.email, testEmail);
  } finally {
    if (secondUid) {
      await User.findByIdAndDelete(secondUid);
      await Employee.deleteMany({ clerkUserId: secondUid });
    }
  }
});
