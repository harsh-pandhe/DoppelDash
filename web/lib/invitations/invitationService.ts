import Invitation, { IInvitation } from '@/models/Invitation'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import Organization from '@/models/Organization'
import { writeAudit } from '@/lib/audit'
import { getMailService } from '@/lib/mail'
import { signToken } from '@/lib/auth/jwt'
import { signMobileAccessToken, issueMobileRefreshToken } from '@/lib/auth/mobileTokens'

export class HttpError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    Object.setPrototypeOf(this, HttpError.prototype)
  }
}

export interface CreateInvitationInput {
  orgId: string
  email: string
  role: 'employee' | 'manager'
  firstName?: string
  lastName?: string
  department?: string
  designation?: string
  employeeType?: 'full_time' | 'part_time' | 'intern' | 'contractor'
  invitedBy: string
  invitedByName: string
}

export interface InvitationResult {
  invitation: IInvitation
  rawToken: string
  inviteUrl: string
  emailDelivery: {
    attempted: boolean
    delivered: boolean
    message: string
  }
}

/**
 * Send the invitation e-mail through the mail provider (lib/mail).
 * Templates escape every interpolated value (organisation name, inviter name…),
 * and provider failures are reduced to `false` — never thrown, never leaked.
 */
export async function sendInvitationEmail(opts: {
  to: string
  orgId: string
  inviteUrl: string
  organizationName: string
  role: string
  inviterName: string
}): Promise<boolean> {
  const result = await getMailService().sendInvitation({
    to: opts.to,
    orgId: opts.orgId,
    organizationName: opts.organizationName,
    role: opts.role,
    inviterName: opts.inviterName,
    inviteUrl: opts.inviteUrl,
  })
  return result.delivered
}

/**
 * Create a new organization invitation with high-entropy token.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<InvitationResult> {
  const email = input.email.toLowerCase().trim()

  // 1. Role validation: invitations can only create 'employee' or 'manager'
  if (input.role !== 'employee' && input.role !== 'manager') {
    throw new HttpError('Invitations can only be issued for employee or manager roles', 400)
  }

  // 2. Check for existing registered users with this email
  const existingUser = await User.findOne({ email }).lean()
  if (existingUser) {
    if (existingUser.orgId === input.orgId) {
      throw new HttpError('A user with this email already exists in this organization', 409)
    } else {
      throw new HttpError('This email address is already registered in another organization', 409)
    }
  }

  // 3. Invalidate any existing pending invitations for this email in this tenant
  await Invitation.updateMany(
    {
      orgId: input.orgId,
      email,
      acceptedAt: { $exists: false },
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } }
  )

  // 4. Generate high-entropy token and hash
  const rawToken = Invitation.generateRawToken()
  const tokenHash = Invitation.hashToken(rawToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  // 5. Store invitation record (ONLY tokenHash is persisted)
  const invitation = await Invitation.create({
    orgId: input.orgId,
    email,
    role: input.role,
    firstName: input.firstName?.trim(),
    lastName: input.lastName?.trim(),
    department: input.department?.trim() || 'General',
    designation: input.designation?.trim() || (input.role === 'manager' ? 'Manager' : 'Staff'),
    employeeType: input.employeeType || 'full_time',
    tokenHash,
    expiresAt,
    invitedBy: input.invitedBy,
  })

  // 6. Write audit log entry
  await writeAudit({
    action: 'invitation_created',
    performedBy: input.invitedBy,
    performedByName: input.invitedByName,
    targetId: invitation._id.toString(),
    targetType: 'invitation',
    orgId: input.orgId,
    metadata: {
      email,
      role: input.role,
      department: invitation.department,
      designation: invitation.designation,
      expiresAt,
    },
  })

  // 7. Format invitation link
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  // Token in the URL FRAGMENT: browsers never send it to the server, so it cannot reach access logs,
  // proxies or Referer headers. The invite page reads it client-side and POSTs it in a request body.
  const inviteUrl = `${appUrl}/invite#token=${rawToken}`

  // 8. Resolve organization name for email
  const org = await Organization.findOne({ orgId: input.orgId }).lean()
  const orgName = org?.name || 'Your Organization'

  // 9. Attempt email delivery
  let delivered = false
  try {
    delivered = await sendInvitationEmail({
      to: email,
      orgId: input.orgId,
      inviteUrl,
      organizationName: orgName,
      role: input.role,
      inviterName: input.invitedByName,
    })
  } catch {
    delivered = false
  }

  const emailDelivery = {
    attempted: true,
    delivered,
    message: delivered
      ? 'Invitation email sent successfully.'
      : 'Invitation generated successfully. Email delivery provider not configured in this environment.',
  }

  return {
    invitation,
    rawToken,
    inviteUrl,
    emailDelivery,
  }
}

/**
 * Verify an invitation token without consuming it.
 */
export async function verifyInvitationToken(rawToken: string) {
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false, reason: 'missing_token' }
  }

  const tokenHash = Invitation.hashToken(rawToken)
  const invitation = await Invitation.findOne({ tokenHash }).lean()

  if (!invitation) {
    return { valid: false, reason: 'invalid_token' }
  }

  if (invitation.acceptedAt) {
    return { valid: false, reason: 'already_accepted' }
  }

  if (invitation.revokedAt) {
    return { valid: false, reason: 'revoked' }
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    return { valid: false, reason: 'expired' }
  }

  const org = await Organization.findOne({ orgId: invitation.orgId }).lean()

  return {
    valid: true,
    status: 'pending',
    email: invitation.email,
    role: invitation.role,
    firstName: invitation.firstName,
    lastName: invitation.lastName,
    department: invitation.department,
    designation: invitation.designation,
    orgId: invitation.orgId,
    organizationName: org?.name || 'Organization',
    expiresAt: invitation.expiresAt,
  }
}

/**
 * Accept invitation, create User + Employee + LeaveBalance atomically,
 * and issue an authenticated session.
 */
export async function acceptInvitation(params: {
  rawToken: string
  password: string
  firstName?: string
  lastName?: string
}) {
  const { rawToken, password } = params
  if (!rawToken) {
    throw new HttpError('Token is required', 400)
  }

  if (!password || password.length < 8) {
    throw new HttpError('Password must be at least 8 characters', 400)
  }

  const tokenHash = Invitation.hashToken(rawToken)
  const now = new Date()

  // 1. Atomically consume invitation to prevent concurrent double-spend
  const invitation = await Invitation.findOneAndUpdate(
    {
      tokenHash,
      acceptedAt: { $exists: false },
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { acceptedAt: now } },
    { returnDocument: 'after' }
  )

  if (!invitation) {
    // Determine specific failure reason
    const existing = await Invitation.findOne({ tokenHash }).lean()
    if (!existing) {
      throw new HttpError('Invalid invitation token', 404)
    }
    if (existing.acceptedAt) {
      throw new HttpError('Invitation has already been accepted', 409)
    }
    if (existing.revokedAt) {
      throw new HttpError('Invitation has been revoked', 410)
    }
    if (new Date(existing.expiresAt) <= now) {
      throw new HttpError('Invitation has expired', 410)
    }
    throw new HttpError('Unable to accept invitation', 400)
  }

  const { orgId, email, role, department, designation, employeeType } = invitation
  const firstName = (params.firstName || invitation.firstName || 'Invited').trim()
  const lastName = (params.lastName || invitation.lastName || 'User').trim()

  let createdUserId: string | null = null

  try {
    // 2. Double-check duplicate email
    const duplicate = await User.findOne({ email }).lean()
    if (duplicate) {
      throw new HttpError('User account already exists for this email', 409)
    }

    // 3. Hash password
    const passwordHash = await User.hashPassword(password)

    // 4. Create User
    const user = await User.create({
      orgId,
      email,
      passwordHash,
      role,
      firstName,
      lastName,
      createdByUserId: invitation.invitedBy,
      isActive: true,
      mustChangePassword: false,
      sessionVersion: 1,
    })
    createdUserId = user._id.toString()

    // 5. Create Employee
    const employee = await Employee.create({
      clerkUserId: createdUserId,
      orgId,
      createdByUserId: invitation.invitedBy,
      firstName,
      lastName,
      email,
      department: department || 'General',
      designation: designation || (role === 'manager' ? 'Manager' : 'Staff'),
      employeeType: (employeeType === 'contractor' ? 'contract' : employeeType) || 'full_time',
      joiningDate: new Date(),
      onboardingComplete: false,
      onboardingStep: 0,
      privileges: {
        food: { tier: 'none', dailyLimit: 0 },
        taxi: { tier: 'none', perKmLimit: 0 },
        flight: { tier: 'none', enabled: false },
        hotel: { tier: 'none', perNightLimit: 0 },
        travelAdvance: 0,
      },
    })

    // 6. Initialize LeaveBalance for current year
    const year = new Date().getFullYear()
    await LeaveBalance.findOneAndUpdate(
      { orgId, userId: createdUserId, year },
      {
        $setOnInsert: {
          orgId,
          casual: 12,
          sick: 6,
          earned: 15,
          privilege: 2,
          restricted: 2,
          lwpDays: 0,
        },
      },
      { upsert: true }
    )

    // 7. Write audit log
    await writeAudit({
      action: 'invitation_accepted',
      performedBy: createdUserId,
      performedByName: `${firstName} ${lastName}`.trim(),
      targetId: invitation._id.toString(),
      targetType: 'invitation',
      orgId,
      metadata: {
        email,
        role,
        userId: createdUserId,
        employeeId: employee.employeeId,
      },
    })

    // 8. Issue a REAL authenticated session: web cookie JWT, short-lived mobile
    //    access token, and an opaque rotating refresh token in its own device family.
    await User.findByIdAndUpdate(createdUserId, {
      lastLoginAt: now, lastActiveAt: now, $inc: { loginCount: 1 },
    })
    const pub = user.toPublic()
    const sessionToken = await signToken(pub)
    const accessToken = await signMobileAccessToken(pub)
    const refreshToken = await issueMobileRefreshToken(createdUserId, { sessionVersion: pub.sessionVersion })

    return {
      success: true,
      user: pub,
      employee: {
        employeeId: employee.employeeId,
        department: employee.department,
        designation: employee.designation,
        orgId: employee.orgId,
      },
      /** httpOnly web cookie value. */
      sessionToken,
      /** Mobile Bearer access token (15 min). */
      accessToken,
      /** Opaque, rotating, single-use refresh token — never a JWT. */
      refreshToken,
    }
  } catch (err) {
    // COMPENSATING ROLLBACK: clean up any partially created records
    if (createdUserId) {
      await User.findByIdAndDelete(createdUserId).catch(() => {})
      await Employee.deleteOne({ clerkUserId: createdUserId }).catch(() => {})
      await LeaveBalance.deleteMany({ userId: createdUserId }).catch(() => {})
    }
    // Revert invitation acceptedAt
    await Invitation.updateOne({ _id: invitation._id }, { $unset: { acceptedAt: 1 } }).catch(() => {})
    throw err
  }
}

/**
 * Revoke a pending invitation. Scoped strictly to the caller's orgId.
 */
export async function revokeInvitation(opts: {
  invitationId: string
  orgId: string
  performedBy: string
  performedByName: string
}) {
  const invitation = await Invitation.findOne({
    _id: opts.invitationId,
    orgId: opts.orgId,
  })

  if (!invitation) {
    return null
  }

  if (invitation.acceptedAt) {
    throw new HttpError('Cannot revoke an already accepted invitation', 400)
  }

  invitation.revokedAt = new Date()
  await invitation.save()

  await writeAudit({
    action: 'invitation_revoked',
    performedBy: opts.performedBy,
    performedByName: opts.performedByName,
    targetId: invitation._id.toString(),
    targetType: 'invitation',
    orgId: opts.orgId,
    metadata: { email: invitation.email },
  })

  return invitation
}

/**
 * Resend an invitation with a newly generated high-entropy token and extended expiration.
 */
export async function resendInvitation(opts: {
  invitationId: string
  orgId: string
  performedBy: string
  performedByName: string
}): Promise<InvitationResult | null> {
  const invitation = await Invitation.findOne({
    _id: opts.invitationId,
    orgId: opts.orgId,
  })

  if (!invitation) {
    return null
  }

  if (invitation.acceptedAt) {
    throw new HttpError('Cannot resend an already accepted invitation', 400)
  }

  const rawToken = Invitation.generateRawToken()
  const tokenHash = Invitation.hashToken(rawToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  invitation.tokenHash = tokenHash
  invitation.expiresAt = expiresAt
  invitation.revokedAt = undefined
  await invitation.save()

  await writeAudit({
    action: 'invitation_resend',
    performedBy: opts.performedBy,
    performedByName: opts.performedByName,
    targetId: invitation._id.toString(),
    targetType: 'invitation',
    orgId: opts.orgId,
    metadata: { email: invitation.email, expiresAt },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  // Token in the URL FRAGMENT: browsers never send it to the server, so it cannot reach access logs,
  // proxies or Referer headers. The invite page reads it client-side and POSTs it in a request body.
  const inviteUrl = `${appUrl}/invite#token=${rawToken}`

  const org = await Organization.findOne({ orgId: opts.orgId }).lean()
  const orgName = org?.name || 'Your Organization'

  let delivered = false
  try {
    delivered = await sendInvitationEmail({
      to: invitation.email,
      orgId: opts.orgId,
      inviteUrl,
      organizationName: orgName,
      role: invitation.role,
      inviterName: opts.performedByName,
    })
  } catch {
    delivered = false
  }

  const emailDelivery = {
    attempted: true,
    delivered,
    message: delivered
      ? 'Invitation email sent successfully.'
      : 'Invitation generated successfully. Email delivery provider not configured in this environment.',
  }

  return {
    invitation,
    rawToken,
    inviteUrl,
    emailDelivery,
  }
}
