import mongoose from 'mongoose'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import OrgSettings from '@/models/OrgSettings'
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
    const {
      companyName,
      email,
      password,
      firstName,
      lastName,
      phone,
    } = body

    if (!companyName || !email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Company name, email, password, first name, and last name are required' },
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

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Generate unique, cryptographically distinct orgId
    const orgId = `org_${new mongoose.Types.ObjectId().toHexString()}`

    const hash = await User.hashPassword(password)
    const newUser = await User.create({
      orgId,
      email: normalizedEmail,
      passwordHash: hash,
      role: 'admin',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mustChangePassword: false,
      isActive: true,
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
    })

    const uid = newUser._id.toString()

    // Initialize organization settings for this specific org
    await OrgSettings.create({
      orgId,
      name: companyName.trim(),
      phone: phone?.trim() || '',
      updatedBy: uid,
    })

    // Create Employee record for this admin
    await Employee.create({
      clerkUserId: uid,
      orgId,
      createdByUserId: uid,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || '',
      department: 'Executive',
      designation: 'Workspace Admin',
      employeeType: 'full_time',
      joiningDate: new Date(),
      onboardingComplete: true,
      onboardingStep: 3,
      privileges: {
        food: { tier: 'unlimited', dailyLimit: 5000 },
        taxi: { tier: 'unlimited', perKmLimit: 50 },
        flight: { tier: 'business', enabled: true },
        hotel: { tier: 'five_star', perNightLimit: 15000 },
        travelAdvance: 50000,
      },
    })

    // Initialise standard leave balance
    const year = new Date().getFullYear()
    await LeaveBalance.create({
      userId: uid,
      orgId,
      year,
      casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0,
    })

    const pub = newUser.toPublic()
    const token = await signToken(pub)
    const accessToken = await signMobileAccessToken(pub)
    const refreshToken = await issueMobileRefreshToken(pub.id)

    const res = NextResponse.json(
      {
        message: 'Organization created successfully',
        user: pub,
        companyName: companyName.trim(),
        mustChangePassword: false,
        accessToken,
        refreshToken,
      },
      { status: 201 }
    )

    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTS)
    return res
  } catch (error: unknown) {
    console.error('Registration failed:', error)
    const msg = error instanceof Error ? error.message : 'Registration failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
