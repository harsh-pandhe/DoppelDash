/**
 * DoppelDash — Production Play Store Reviewer Account Provisioning Script
 *
 * Securely provisions or updates the dedicated Google Play reviewer account in the target MongoDB.
 *
 * USAGE:
 *   MONGODB_URI="<production_connection_string>" REVIEWER_PASSWORD="<strong_password>" node web/scripts/provision-production-reviewer.js
 *
 * SAFETY GUARANTEES:
 * - Never prints or logs the MONGODB_URI or REVIEWER_PASSWORD.
 * - Idempotent upsert of Organization, User, Employee, LeaveBalance, OrgSettings, and Demo data.
 * - Sets isReviewer: true strictly for doppeldash.playreview@gmail.com.
 * - Sets plan: premium, entitlementSource: subscription, webEnabled: false, androidEnabled: true.
 * - Verifies the bcrypt password hash in the database before completing.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri || (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://'))) {
    console.error('[ERROR] MONGODB_URI environment variable is missing or invalid.');
    console.error('Provide the target connection string via MONGODB_URI environment variable.');
    process.exit(1);
  }

  const reviewerPassword = process.env.REVIEWER_PASSWORD;
  if (!reviewerPassword || reviewerPassword.length < 8) {
    console.error('[ERROR] REVIEWER_PASSWORD environment variable is missing or too short (min 8 characters).');
    process.exit(1);
  }

  const reviewerEmail = 'doppeldash.playreview@gmail.com';
  const orgId = 'org_playreview_demo';
  const orgName = 'DoppelDash Demo';
  const orgSlug = 'doppeldash-demo';

  console.log('[1/6] Connecting to target database...');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  try {
    console.log('[2/6] Upserting demo organization...');
    const now = new Date();
    const periodEnd = new Date('2099-01-01T00:00:00Z');

    const orgDoc = await db.collection('organizations').findOneAndUpdate(
      { orgId },
      {
        $set: {
          orgId,
          name: orgName,
          slug: orgSlug,
          plan: 'premium',
          entitlementSource: 'subscription',
          lifetimeGrant: false,
          subscriptionStatus: 'active',
          currentPeriodEnd: periodEnd,
          webEnabled: false,
          androidEnabled: true,
          trialStatus: 'none',
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    console.log('[3/6] Hashing password and upserting reviewer user...');
    const passwordHash = await bcrypt.hash(reviewerPassword, 10);

    const userDoc = await db.collection('users').findOneAndUpdate(
      { email: reviewerEmail },
      {
        $set: {
          email: reviewerEmail,
          orgId,
          passwordHash,
          role: 'admin',
          firstName: 'GooglePlay',
          lastName: 'Reviewer',
          isReviewer: true,
          isActive: true,
          isBanned: false,
          mustChangePassword: false,
          tourSeen: true,
          mailAccess: true,
          permissions: ['all'],
          sessionVersion: 1,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          loginCount: 0,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const userId = (userDoc.value || userDoc)._id.toString();

    console.log('[4/6] Upserting reviewer employee profile & leave balance...');
    await db.collection('employees').findOneAndUpdate(
      { email: reviewerEmail },
      {
        $set: {
          clerkUserId: userId,
          email: reviewerEmail,
          orgId,
          firstName: 'GooglePlay',
          lastName: 'Reviewer',
          department: 'Operations',
          designation: 'Admin Reviewer',
          employeeId: 'REV-001',
          onboardingComplete: true,
          onboardingStep: 4,
          privileges: {
            food: { tier: 'premium', dailyLimit: 5000 },
            taxi: { tier: 'ac_premium', perKmLimit: 50 },
            flight: { tier: 'business', enabled: true },
            hotel: { tier: 'premium', perNightLimit: 15000 },
            travelAdvance: 50000,
          },
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    await db.collection('leavebalances').findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          orgId,
          casual: 12,
          sick: 10,
          privilege: 15,
          earned: 15,
          restricted: 2,
          lwpDays: 0,
          year: now.getFullYear(),
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    await db.collection('orgsettings').findOneAndUpdate(
      { orgId },
      {
        $set: {
          orgId,
          name: orgName,
          companyName: orgName,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    console.log('[5/6] Seeding demonstration CRM and Expense data...');
    await db.collection('contacts').findOneAndUpdate(
      { orgId, email: 'partner@acme.example' },
      {
        $set: {
          orgId,
          createdBy: userId,
          name: 'Acme Technologies',
          company: 'Acme Corporation',
          email: 'partner@acme.example',
          phone: '+1-555-0199',
          stage: 'lead',
          visibility: 'org',
          notes: 'Demo customer account for Google Play store review and evaluation.',
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    await db.collection('expenses').findOneAndUpdate(
      { orgId, title: 'Demo Business Travel Receipt' },
      {
        $set: {
          orgId,
          userId,
          employeeName: 'GooglePlay Reviewer',
          title: 'Demo Business Travel Receipt',
          amount: 2500,
          currency: 'INR',
          category: 'travel',
          status: 'paid',
          date: now,
          description: 'Demonstration approved corporate travel receipt.',
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    console.log('[6/6] Verifying provisioned state...');
    const verifyUser = await db.collection('users').findOne({ email: reviewerEmail });
    if (!verifyUser) throw new Error('Verification failed: User record not found.');
    if (!verifyUser.isReviewer) throw new Error('Verification failed: isReviewer flag is not true.');
    if (verifyUser.role !== 'admin') throw new Error('Verification failed: Role is not admin.');

    const passwordMatches = await bcrypt.compare(reviewerPassword, verifyUser.passwordHash);
    if (!passwordMatches) throw new Error('Verification failed: Password does not match persisted hash.');

    const verifyOrg = await db.collection('organizations').findOne({ orgId });
    if (!verifyOrg) throw new Error('Verification failed: Organization record not found.');
    if (verifyOrg.plan !== 'premium') throw new Error('Verification failed: Plan is not premium.');
    if (verifyOrg.webEnabled !== false) throw new Error('Verification failed: webEnabled is not false.');
    if (verifyOrg.androidEnabled !== true) throw new Error('Verification failed: androidEnabled is not true.');

    console.log('\n======================================================');
    console.log('  PRODUCTION PLAY REVIEWER SETUP VERIFIED');
    console.log('======================================================');
    console.log(`  Organization:       ${verifyOrg.name} (${verifyOrg.orgId})`);
    console.log(`  Plan:               ${verifyOrg.plan}`);
    console.log(`  Entitlement Source: ${verifyOrg.entitlementSource}`);
    console.log(`  Lifetime Grant:     ${verifyOrg.lifetimeGrant}`);
    console.log(`  Subscription:       ${verifyOrg.subscriptionStatus}`);
    console.log(`  Web Enabled:        ${verifyOrg.webEnabled}`);
    console.log(`  Android Enabled:    ${verifyOrg.androidEnabled}`);
    console.log(`  Reviewer Email:     ${verifyUser.email}`);
    console.log(`  Role:               ${verifyUser.role}`);
    console.log(`  isReviewer Flag:    ${verifyUser.isReviewer}`);
    console.log(`  mustChangePassword: ${verifyUser.mustChangePassword}`);
    console.log('  Password Hash:      VERIFIED (matches environment password)');
    console.log('======================================================\n');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
