import mongoose from 'mongoose'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import OrgSettings from '@/models/OrgSettings'
import Organization from '@/models/Organization'
import {
  signToken,
  COOKIE_NAME,
  COOKIE_OPTS,
  signMobileAccessToken,
  issueMobileRefreshToken,
} from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`register:${ip}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Too many registration attempts — please wait 1 minute' }, { status: 429 })
  }

  try {
    const body = await req.json()
    const organizationName = (body.organizationName || body.companyName || '').trim()
    const email = (body.email || '').toLowerCase().trim()
    const password = body.password || ''
    let firstName = (body.firstName || '').trim()
    let lastName = (body.lastName || '').trim()

    if (!firstName && typeof body.name === 'string') {
      const parts = body.name.trim().split(/\s+/)
      firstName = parts[0] || ''
      lastName = parts.slice(1).join(' ') || 'Admin'
    }
    if (!lastName && firstName) {
      lastName = 'Admin'
    }
    const phone = (body.phone || '').trim()

    if (!organizationName || !email || !password || !firstName) {
      return NextResponse.json(
        { error: 'Organization name, email, password, and name are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    await connectDB()

    const normalizedEmail = email
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Generate unique, server-derived tenant ID and slug (strictly ignoring client-supplied orgId)
    const orgId = Organization.generateOrgId()
    const slug = await Organization.generateUniqueSlug(organizationName)

    let session: mongoose.ClientSession | null = null
    let useTransaction = false
    try {
      const client = mongoose.connection.getClient() as unknown as { topology?: { description?: { type?: string } } }
      const topologyType = client?.topology?.description?.type
      if (topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded') {
        session = await mongoose.startSession()
        session.startTransaction()
        useTransaction = true
      }
    } catch {
      session = null
      useTransaction = false
    }

    let createdUid: string | null = null
    let createdOrgId: string | null = null

    try {
      const hash = await User.hashPassword(password)
      const userPayload = {
        orgId,
        email: normalizedEmail,
        passwordHash: hash,
        role: 'admin' as const,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        mustChangePassword: false,
        isActive: true,
        sessionVersion: 1,
        permissions: [
          'users:read',
          'users:write',
          'leaves:read',
          'leaves:write',
          'expenses:read',
          'expenses:write',
          'travel:read',
          'travel:write',
          'crm:read',
          'crm:write',
          'mail:read',
          'mail:write',
          'analytics:read',
          'audit:read',
        ],
      }

      let newUser
      if (useTransaction && session) {
        const docs = await User.create([userPayload], { session })
        newUser = docs[0]
      } else {
        newUser = await User.create(userPayload)
      }

      const uid = newUser._id.toString()
      createdUid = uid
      createdOrgId = orgId

      // Create Organization record with Free plan and mobile-only access (Batch L)
      const organizationDocPayload = {
        orgId,
        name: organizationName,
        slug,
        ownerId: uid,
        plan: 'free' as const,
        entitlementSource: 'none' as const,
        lifetimeGrant: false,
        webEnabled: false,
        androidEnabled: true,
        subscriptionStatus: 'none' as const,
        trialStatus: 'none' as const,
      }
      if (useTransaction && session) {
        await Organization.create([organizationDocPayload], { session })
      } else {
        await Organization.create(organizationDocPayload)
      }

      // Initialize organization settings for this specific org
      const orgPayload = {
        orgId,
        name: organizationName,
        companyName: organizationName,
        phone: phone || '',
        updatedBy: uid,
      }
      if (useTransaction && session) {
        await OrgSettings.create([orgPayload], { session })
      } else {
        await OrgSettings.create(orgPayload)
      }

      // Create Employee record for this admin
      const employeePayload = {
        clerkUserId: uid,
        orgId,
        createdByUserId: uid,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        phone: phone || '',
        department: 'Executive',
        designation: 'Workspace Admin',
        employeeType: 'full_time' as const,
        joiningDate: new Date(),
        onboardingComplete: true,
        onboardingStep: 3,
        privileges: {
          food: { tier: 'premium' as const, dailyLimit: 5000 },
          taxi: { tier: 'ac_premium' as const, perKmLimit: 50 },
          flight: { tier: 'business' as const, enabled: true },
          hotel: { tier: 'premium' as const, perNightLimit: 15000 },
          travelAdvance: 50000,
        },
      }
      if (useTransaction && session) {
        await Employee.create([employeePayload], { session })
      } else {
        await Employee.create(employeePayload)
      }

      // Initialise standard leave balance
      const year = new Date().getFullYear()
      const leavePayload = {
        userId: uid,
        orgId,
        year,
        casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0,
      }
      if (useTransaction && session) {
        await LeaveBalance.create([leavePayload], { session })
      } else {
        await LeaveBalance.create(leavePayload)
      }

      if (useTransaction && session) {
        await session.commitTransaction()
      }

      const pub = newUser.toPublic()
      const token = await signToken(pub)
      const accessToken = await signMobileAccessToken(pub)
      const refreshToken = await issueMobileRefreshToken(pub.id)

      const res = NextResponse.json(
        {
          message: 'Organization created successfully',
          user: pub,
          organization: {
            orgId,
            name: organizationName,
            slug,
          },
          companyName: organizationName,
          mustChangePassword: false,
          accessToken,
          refreshToken,
        },
        { status: 201 }
      )

      res.cookies.set(COOKIE_NAME, token, COOKIE_OPTS)
      return res
    } catch (innerError: unknown) {
      if (useTransaction && session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction()
          }
        } catch (abortErr) {
          console.error('Failed to abort transaction:', abortErr)
        }
      }
      // Compensating rollback cleanup for standalone MongoDB or partial creation:
      if (createdOrgId) {
        try { await Organization.deleteMany({ orgId: createdOrgId }) } catch {}
        try { await OrgSettings.deleteMany({ orgId: createdOrgId }) } catch {}
        try { await Employee.deleteMany({ orgId: createdOrgId }) } catch {}
        try { await LeaveBalance.deleteMany({ orgId: createdOrgId }) } catch {}
        try { await User.deleteMany({ orgId: createdOrgId }) } catch {}
      }
      if (createdUid) {
        try { await User.findByIdAndDelete(createdUid) } catch {}
        try { await Employee.deleteMany({ clerkUserId: createdUid }) } catch {}
        try { await LeaveBalance.deleteMany({ userId: createdUid }) } catch {}
      }
      throw innerError
    } finally {
      if (session) {
        try { await session.endSession() } catch {}
      }
    }
  } catch (error: unknown) {
    console.error('Registration failed:', error)
    const msg = process.env.NODE_ENV === 'production'
      ? 'Registration failed. Please try again later.'
      : (error instanceof Error ? error.message : 'Registration failed')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
