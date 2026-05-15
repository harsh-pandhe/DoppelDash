import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import { sendEmail } from '@/lib/email'

export async function GET() {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const year      = new Date().getFullYear()
  const allUsers  = await User.find({}).lean()
  const balances  = await LeaveBalance.find({ year }).lean()
  const employees = await Employee.find({}).lean()
  const balMap    = new Map(balances.map(b => [b.userId, b]))
  const empMap    = new Map(employees.map(e => [e.clerkUserId, e]))

  const filtered = role === 'boss'
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
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { firstName, lastName, email, newRole, department, designation, employeeType, joiningDate, privileges } = body

  if (!firstName || !lastName || !email || !newRole) {
    return NextResponse.json({ error: 'firstName, lastName, email, newRole required' }, { status: 400 })
  }
  if (role === 'manager' && newRole !== 'employee') {
    return NextResponse.json({ error: 'Managers can only create employees' }, { status: 403 })
  }

  await connectDB()

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })

  // Generate temp password
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const tempPassword = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('') + '#1'
  const hash = await User.hashPassword(tempPassword)

  const newUser = await User.create({
    email:              email.toLowerCase().trim(),
    passwordHash:       hash,
    role:               newRole,
    firstName,
    lastName,
    createdByUserId:    userId,
    mustChangePassword: true,
    isActive:           true,
  })
  const newUid = newUser._id.toString()

  // Create Employee profile
  const emp = await Employee.create({
    clerkUserId:     newUid,    // reuse field for our userId
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
    { userId: newUid, year },
    { $setOnInsert: { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0 } },
    { upsert: true }
  )

  // Send welcome email with credentials
  try {
    await sendEmail(
      email,
      'Welcome to DoppelDash — Your Login Details',
      `<div style="font-family:sans-serif;max-width:500px">
        <h2>Welcome to DoppelDash, ${firstName}!</h2>
        <p>Your account has been created. Use these credentials to sign in:</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Temporary Password:</strong> <code style="font-size:18px;letter-spacing:2px;background:#f3f4f6;padding:4px 8px;border-radius:4px">${tempPassword}</code></p>
        <p>You will be asked to set a new password on first login.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/sign-in">Sign in to DoppelDash →</a></p>
      </div>`
    )
  } catch { /* best-effort */ }

  return NextResponse.json({
    success:     true,
    userId:      newUid,
    employeeId:  emp.employeeId,
    tempPassword,
  })
}
