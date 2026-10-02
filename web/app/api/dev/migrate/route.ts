import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import Organization from '@/models/Organization'
import OrgSettings from '@/models/OrgSettings'
import Contact from '@/models/Contact'
import Expense from '@/models/Expense'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('x-seed-secret')
  const required = process.env.DEV_SEED_SECRET || 'dd-reset-7x9k2'
  if (secret !== required) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const action = req.nextUrl.searchParams.get('action')

  if (action === 'seed_reviewer') {
    try {
      await connectDB()
      const db = mongoose.connection.db
      if (!db) return NextResponse.json({ error: 'No DB connection' }, { status: 500 })

      // 1. Ensure Organization 'DoppelDash Demo'
      let org = await Organization.findOne({ slug: 'doppeldash-demo' })
      if (!org) {
        org = await Organization.create({
          orgId: 'org_playreview_demo',
          name: 'DoppelDash Demo',
          slug: 'doppeldash-demo',
          plan: 'premium',
          entitlementSource: 'subscription',
          lifetimeGrant: false,
          subscriptionStatus: 'active',
          currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
          webEnabled: false,
          androidEnabled: true,
        })
      } else {
        org.plan = 'premium'
        org.entitlementSource = 'subscription'
        org.lifetimeGrant = false
        org.subscriptionStatus = 'active'
        org.currentPeriodEnd = new Date('2099-01-01T00:00:00Z')
        org.webEnabled = false
        org.androidEnabled = true
        await org.save()
      }

      // 2. Upsert Reviewer User
      const reviewerEmail = 'doppeldash.playreview@gmail.com'
      const password = req.nextUrl.searchParams.get('pwd') || 'PlayReview#2026'
      const passwordHash = await bcrypt.hash(password, 10)

      let user = await User.findOne({ email: reviewerEmail })
      if (!user) {
        user = await User.create({
          email: reviewerEmail,
          orgId: org.orgId,
          passwordHash,
          role: 'admin',
          firstName: 'GooglePlay',
          lastName: 'Reviewer',
          isActive: true,
          isBanned: false,
          mustChangePassword: false,
          tourSeen: true,
          mailAccess: true,
          permissions: ['all'],
          sessionVersion: 1,
        })
      } else {
        user.orgId = org.orgId
        user.passwordHash = passwordHash
        user.role = 'admin'
        user.isActive = true
        user.isBanned = false
        user.mustChangePassword = false
        user.tourSeen = true
        user.mailAccess = true
        user.permissions = ['all']
        await user.save()
      }

      // 3. Upsert Employee profile
      await Employee.findOneAndUpdate(
        { email: reviewerEmail },
        {
          clerkUserId: user._id.toString(),
          email: reviewerEmail,
          orgId: org.orgId,
          firstName: 'GooglePlay',
          lastName: 'Reviewer',
          department: 'Operations',
          designation: 'Admin Reviewer',
          employeeId: 'REV-001',
          onboardingComplete: true,
          privileges: {
            food: { tier: 'premium', dailyLimit: 5000 },
            taxi: { tier: 'ac_premium', perKmLimit: 50 },
            flight: { tier: 'business', enabled: true },
            hotel: { tier: 'premium', perNightLimit: 15000 },
            travelAdvance: 50000,
          },
        },
        { upsert: true, new: true }
      )

      // 4. Upsert LeaveBalance
      await LeaveBalance.findOneAndUpdate(
        { userId: user._id.toString() },
        {
          userId: user._id.toString(),
          orgId: org.orgId,
          casual: 12,
          sick: 10,
          privilege: 15,
        },
        { upsert: true, new: true }
      )

      // 5. Upsert OrgSettings
      await OrgSettings.findOneAndUpdate(
        { orgId: org.orgId },
        {
          orgId: org.orgId,
          name: 'DoppelDash Demo',
          companyName: 'DoppelDash Demo',
        },
        { upsert: true, new: true }
      )

      // 6. Safe demo CRM contact
      await Contact.findOneAndUpdate(
        { orgId: org.orgId, email: 'partner@acme.example' },
        {
          orgId: org.orgId,
          name: 'Acme Technologies',
          company: 'Acme Corporation',
          email: 'partner@acme.example',
          phone: '+1-555-0199',
          stage: 'lead',
          notes: 'Demo customer account for Google Play store review and evaluation.',
        },
        { upsert: true, new: true }
      )

      // 7. Safe demo expense
      await Expense.findOneAndUpdate(
        { orgId: org.orgId, title: 'Demo Business Travel Receipt' },
        {
          orgId: org.orgId,
          userId: user._id.toString(),
          employeeName: 'GooglePlay Reviewer',
          title: 'Demo Business Travel Receipt',
          amount: 2500,
          currency: 'INR',
          category: 'travel',
          status: 'approved',
          date: new Date(),
          description: 'Demonstration approved corporate travel receipt.',
        },
        { upsert: true, new: true }
      )

      const entitlements = await getOrganizationEntitlements(org.orgId)

      return NextResponse.json({
        success: true,
        reviewer: {
          email: user.email,
          orgId: org.orgId,
          orgName: org.name,
          role: user.role,
          plan: entitlements.plan,
          entitlementSource: entitlements.source,
          lifetimeGrant: entitlements.lifetimeGrant,
          webEnabled: entitlements.webEnabled,
          androidEnabled: entitlements.androidEnabled,
          features: entitlements.features,
        },
      })
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  }

  const rawUri = process.env.MONGODB_URI || ''
  const maskedUri = rawUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')
  let dbStatus = 'disconnected'
  let connectError: string | null = null
  let collections: string[] = []

  try {
    await connectDB()
    const db = mongoose.connection.db
    if (db) {
      dbStatus = 'connected'
      const cols = await db.listCollections().toArray()
      collections = cols.map(c => c.name)
    }
  } catch (err: unknown) {
    connectError = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json({
    status: 'ok',
    dbStatus,
    maskedUri,
    connectError,
    collections,
    nodeEnv: process.env.NODE_ENV,
  })
}

export async function POST(req: NextRequest) {
  const required = process.env.DEV_SEED_SECRET
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
    return NextResponse.json({ error: 'Destructive seed is disabled in production' }, { status: 403 })
  }
  if (!required) {
    return NextResponse.json({ error: 'DEV_SEED_SECRET must be configured to run migrate' }, { status: 403 })
  }
  const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-seed-secret')
  if (provided !== required) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const db = mongoose.connection.db
  if (!db) return NextResponse.json({ error: 'No DB connection' }, { status: 500 })

  const result: Record<string, number> = {}

  // 10A — roles + mail access
  result.roleBossToAdmin   = (await db.collection('users').updateMany({ role: 'boss' }, { $set: { role: 'admin' } })).modifiedCount
  result.mailAccessInit     = (await db.collection('users').updateMany({ mailAccess: { $exists: false } }, { $set: { mailAccess: false } })).modifiedCount
  result.mailAccessAdminMgr = (await db.collection('users').updateMany({ role: { $in: ['admin', 'manager'] } }, { $set: { mailAccess: true } })).modifiedCount

  // 11E / 11F — status + note field renames
  result.expenseStatus = (await db.collection('expenses').updateMany({ status: 'pending_boss' }, { $set: { status: 'pending_admin' } })).modifiedCount
  result.travelStatus  = (await db.collection('travelrequests').updateMany({ status: 'pending_boss' }, { $set: { status: 'pending_admin' } })).modifiedCount
  result.expenseNote   = (await db.collection('expenses').updateMany({ bossNote: { $exists: true } }, { $rename: { bossNote: 'adminNote' } })).modifiedCount
  result.travelNote    = (await db.collection('travelrequests').updateMany({ bossNote: { $exists: true } }, { $rename: { bossNote: 'adminNote' } })).modifiedCount

  // Phase 0 — Multi-tenant orgId backfill to 'org_doppelmayr'
  const tenantCollections = [
    'users',
    'employees',
    'leaves',
    'leavebalances',
    'expenses',
    'travelrequests',
    'contacts',
    'scannedcards',
    'campaignlogs',
    'announcements',
    'inboxmessages',
    'maildrafts',
    'useremailconfigs',
    'outlooktokens',
    'syncstates',
    'passkeycredentials',
    'auditlogs',
    'shareddashboards',
    'publicholidays',
    'orgsettings',
  ]

  for (const coll of tenantCollections) {
    try {
      const r = await db.collection(coll).updateMany(
        { $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }] },
        { $set: { orgId: 'org_doppelmayr' } }
      )
      result[`org_${coll}`] = r.modifiedCount
    } catch {
      result[`org_${coll}`] = 0
    }
  }

  // sanity: current role distribution
  const roles = await db.collection('users').aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray()

  return NextResponse.json({ success: true, migrated: result, rolesNow: roles })
}
