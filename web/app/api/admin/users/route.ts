import { randomInt } from 'node:crypto'
import { readJsonObject, badBody } from '@/lib/http/body'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import { getMailService } from '@/lib/mail'
import { devOnly } from '@/lib/auth/devShortcuts'
import { getOrganizationLimit, getOrganizationUsage } from '@/lib/entitlements/entitlementService'

export async function GET() {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const year      = new Date().getFullYear()
  const allUsers  = await User.find({ orgId }).lean()
  const balances  = await LeaveBalance.find({ orgId, year }).lean()
  const employees = await Employee.find({ orgId }).lean()
  const balMap    = new Map(balances.map(b => [b.userId, b]))
  const empMap    = new Map(employees.map(e => [e.clerkUserId, e]))

  const filtered = role === 'admin'
    ? allUsers
    : allUsers.filter(u =>
        String(u._id) === userId ||
        empMap.get(String(u._id))?.createdByUserId === userId
      )

  const result = filtered.map(u => {
    const uid = String(u._id)
    const bal = balMap.get(uid)
    const emp = empMap.get(uid)
    return {
      id:          uid,
      name:        `${u.firstName} ${u.lastName}`.trim(),
      email:       u.email,
      role:        u.role,
      permissions: u.permissions || [],
      banned:      u.isBanned,
      mailAccess:  u.mailAccess ?? false,
      lastActive:  u.lastLoginAt,
      createdAt:   u.createdAt,
      balance: {
        casual:    bal?.casual    ?? 12,
        sick:      bal?.sick      ?? 6,
        earned:    bal?.earned    ?? 15,
        privilege: bal?.privilege ?? 2,
        restricted:bal?.restricted?? 2,
      },
      employee: emp ? {
        employeeId:         emp.employeeId,
        department:         emp.department,
        designation:        emp.designation,
        employeeType:       emp.employeeType,
        joiningDate:        emp.joiningDate,
        onboardingComplete: emp.onboardingComplete,
        privileges:         emp.privileges,
        photo:              emp.photo,
        lastLoginAt:        emp.lastLoginAt,
        reportingManagerId: emp.reportingManagerId || null,
      } : null,
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await readJsonObject(req)
  if (!body) return badBody()
  const { firstName, lastName, email, newRole, department, designation, employeeType, joiningDate, privileges, skipWelcomeEmail } = body

  if (!firstName || !lastName || !email || !newRole) {
    return NextResponse.json({ error: 'firstName, lastName, email, newRole required' }, { status: 400 })
  }
  if (role === 'manager' && newRole !== 'employee') {
    return NextResponse.json({ error: 'Managers can only create employees' }, { status: 403 })
  }

  await connectDB()

  const maxMembers = await getOrganizationLimit(orgId, 'maxMembers')
  const currentMembers = await getOrganizationUsage(orgId, 'members')
  if (currentMembers >= maxMembers) {
    return NextResponse.json(
      { error: `Organization member limit reached (${maxMembers}). Upgrade to Premium to add more team members.` },
      { status: 403 }
    )
  }

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })

  // Generate temp password
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  // CSPRNG — a credential must never come from Math.random().
  const tempPassword = Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('') + '#1'
  const hash = await User.hashPassword(tempPassword)

  const newUser = await User.create({
    orgId,
    email:              email.toLowerCase().trim(),
    passwordHash:       hash,
    role:               newRole,
    firstName,
    lastName,
    createdByUserId:    userId,
    mustChangePassword: true,
    isActive:           true,
    sessionVersion:     1,
  })
  const newUid = newUser._id.toString()

  let emp
  try {
    // Create Employee profile
    emp = await Employee.create({
      clerkUserId:     newUid,    // reuse field for our userId
      orgId,
      createdByUserId: userId,
      firstName, lastName, email,
      department:      department    || 'General',
      designation:     designation   || newRole,
      employeeType:    employeeType  || 'full_time',
      joiningDate:     joiningDate   ? new Date(joiningDate) : new Date(),
      onboardingComplete: false,
      onboardingStep:  0,
      privileges: privileges || {
        food:   { tier: 'none', dailyLimit: 0 },
        taxi:   { tier: 'none', perKmLimit: 0 },
        flight: { tier: 'none', enabled: false },
        hotel:  { tier: 'none', perNightLimit: 0 },
        travelAdvance: 0,
      },
    })

    // Initialise leave balance
    const year = new Date().getFullYear()
    await LeaveBalance.findOneAndUpdate(
      { orgId, userId: newUid, year },
      { $setOnInsert: { orgId, casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0 } },
      { upsert: true }
    )
  } catch (err) {
    await User.findByIdAndDelete(newUid)
    throw err
  }

  // Welcome e-mail with the temporary password — unless silent add was requested.
  // Rendered by the mail service (every value escaped); provider failures never throw.
  let emailSent = false
  if (!skipWelcomeEmail) {
    const result = await getMailService().sendAccountWelcome({
      to: email,
      orgId,
      firstName,
      tempPassword,
      signInUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/sign-in`,
    })
    emailSent = result.delivered
  }

  return NextResponse.json({
    success:     true,
    userId:      newUid,
    employeeId:  emp.employeeId,
    // The temporary password is a credential. It is handed back to the (authenticated)
    // admin ONLY when there is no other way for it to reach the new user: a silent
    // add, or a failed e-mail delivery — or on a developer machine for automation.
    tempPassword: (skipWelcomeEmail || !emailSent) ? tempPassword : devOnly(tempPassword),
    emailSent,
  })
}
