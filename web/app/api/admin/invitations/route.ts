import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import Invitation from '@/models/Invitation'
import User from '@/models/User'
import { createInvitation } from '@/lib/invitations/invitationService'
import { getOrganizationLimit, getOrganizationUsage } from '@/lib/entitlements/entitlementService'

export async function GET() {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await connectDB()
  const orgId = user?.orgId || 'org_doppelmayr'

  const query: Record<string, unknown> = { orgId }
  if (role === 'manager') {
    query.invitedBy = userId
  }

  const invitations = await Invitation.find(query)
    .select('-tokenHash')
    .sort({ createdAt: -1 })
    .lean()

  const now = new Date()
  const payload = invitations.map((inv) => {
    let status: 'pending' | 'accepted' | 'revoked' | 'expired' = 'pending'
    if (inv.acceptedAt) status = 'accepted'
    else if (inv.revokedAt) status = 'revoked'
    else if (inv.expiresAt && new Date(inv.expiresAt) < now) status = 'expired'
    return {
      ...inv,
      status,
    }
  })

  return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userRole = user?.role || 'employee'
  if (userRole !== 'admin' && userRole !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const role = typeof body.role === 'string' ? body.role.trim() : 'employee'
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
  const department = typeof body.department === 'string' ? body.department.trim() : 'General'
  const designation = typeof body.designation === 'string' ? body.designation.trim() : ''
  const employeeType = (typeof body.employeeType === 'string' && ['full_time', 'part_time', 'intern', 'contractor'].includes(body.employeeType))
    ? (body.employeeType as 'full_time' | 'part_time' | 'intern' | 'contractor')
    : 'full_time'

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  // Prevent role escalation: invitations cannot create admins
  if (role === 'admin') {
    return NextResponse.json({ error: 'Invitations cannot be issued for admin role' }, { status: 400 })
  }

  if (role !== 'employee' && role !== 'manager') {
    return NextResponse.json({ error: 'Role must be either employee or manager' }, { status: 400 })
  }

  // Managers can only invite employees
  if (userRole === 'manager' && role !== 'employee') {
    return NextResponse.json({ error: 'Managers can only invite employees' }, { status: 403 })
  }

  await connectDB()
  const orgId = user?.orgId || 'org_doppelmayr'

  // Pre-validate existing user to return 409 Conflict prior to capacity checks
  const existingUser = await User.findOne({ email }).lean()
  if (existingUser) {
    if (existingUser.orgId === orgId) {
      return NextResponse.json(
        { error: 'A user with this email already exists in this organization' },
        { status: 409 }
      )
    } else {
      return NextResponse.json(
        { error: 'This email address is already registered in another organization' },
        { status: 409 }
      )
    }
  }

  const maxMembers = await getOrganizationLimit(orgId, 'maxMembers')
  const currentMembers = await getOrganizationUsage(orgId, 'members')
  if (currentMembers >= maxMembers) {
    return NextResponse.json(
      { error: `Organization member limit reached (${maxMembers}). Upgrade to Premium to invite more team members.` },
      { status: 403 }
    )
  }

  try {
    const result = await createInvitation({
      orgId,
      email,
      role,
      firstName,
      lastName,
      department,
      designation,
      employeeType,
      invitedBy: userId,
      invitedByName: user?.fullName || 'Administrator',
    })

    return NextResponse.json(
      {
        message: 'Invitation created successfully',
        invitation: result.invitation,
        rawToken: result.rawToken,
        inviteUrl: result.inviteUrl,
        emailDelivery: result.emailDelivery,
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string }
    const status = error.statusCode || 400
    return NextResponse.json({ error: error.message || 'Failed to create invitation' }, { status })
  }
}
