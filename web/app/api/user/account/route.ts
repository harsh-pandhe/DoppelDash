import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { connectDB } from '@/lib/db'
import { getUser } from '@/lib/auth/getUser'
import User from '@/models/User'
import Employee from '@/models/Employee'
import Organization from '@/models/Organization'
import AuditLog from '@/models/AuditLog'
import Contact from '@/models/Contact'
import LeaveBalance from '@/models/LeaveBalance'
import PasskeyCredential from '@/models/PasskeyCredential'
import PasswordResetToken from '@/models/PasswordResetToken'
import RefreshToken from '@/models/RefreshToken'
import RevokedToken from '@/models/RevokedToken'
import UserEmailConfig from '@/models/UserEmailConfig'
import MailDraft from '@/models/MailDraft'
import OrgSettings from '@/models/OrgSettings'
import Subscription from '@/models/Subscription'
import ScannedCard from '@/models/ScannedCard'
import CampaignLog from '@/models/CampaignLog'
import Announcement from '@/models/Announcement'
import PublicHoliday from '@/models/PublicHoliday'
import SharedDashboard from '@/models/SharedDashboard'
import Invitation from '@/models/Invitation'
import { COOKIE_NAME } from '@/lib/auth/jwt'

/**
 * DELETE /api/user/account
 * Authenticated self-service account and personal data deletion.
 * Satisfies Google Play Data Safety requirements and DPDP Act / GDPR compliance.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId, user, orgId: sessionOrgId } = await getUser(req)
    if (!userId || !user || !sessionOrgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await connectDB()

    // Tenant context comes only from the verified session — never defaulted.
    const orgId = sessionOrgId
    const org = await Organization.findOne({ orgId })

    const isOrgOwner = Boolean(org && org.ownerId === userId)

    if (isOrgOwner) {
      // Check if there are other active users in this organization
      const otherMembersCount = await User.countDocuments({
        orgId,
        _id: { $ne: userId },
      })

      if (otherMembersCount > 0) {
        return NextResponse.json(
          {
            error:
              'As the organization owner, you cannot delete your account while other members remain in the organization. Please transfer ownership or remove other members before deleting your account.',
          },
          { status: 400 }
        )
      }

      // Owner is the sole member: disband the tenant — unless it holds a lifetime
      // grant (a protected system organisation). Decided by persisted entitlement
      // data, never by a hardcoded organisation id.
      if (!org?.lifetimeGrant) {
        await Promise.allSettled([
          Organization.deleteOne({ orgId }),
          OrgSettings.deleteOne({ orgId }),
          Subscription.deleteMany({ orgId }),
          Contact.deleteMany({ orgId }),
          ScannedCard.deleteMany({ orgId }),
          CampaignLog.deleteMany({ orgId }),
          Announcement.deleteMany({ orgId }),
          PublicHoliday.deleteMany({ orgId }),
          SharedDashboard.deleteMany({ orgId }),
          Invitation.deleteMany({ orgId }),
          LeaveBalance.deleteMany({ orgId }),
        ])
      }
    }

    // Record audit log entry before deleting records
    try {
      await AuditLog.create({
        orgId,
        action: 'user.account_deleted',
        performedBy: userId,
        performedByName: `${user.firstName} ${user.lastName}`.trim(),
        targetId: userId,
        targetType: 'user',
        metadata: {
          email: user.email,
          deletedAt: new Date(),
          reason: 'User self-service account deletion',
          ip: req.headers.get('x-forwarded-for') || 'unknown',
        },
      })
    } catch (err) {
      console.error('Failed to write deletion audit log:', err)
    }

    // Invalidate active token defensively in RevokedToken
    const authHeader = req.headers.get('authorization')
    const token = req.cookies.get(COOKIE_NAME)?.value || authHeader?.match(/^Bearer (.+)$/)?.[1]
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      try {
        await RevokedToken.create({
          tokenIdentifier: tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        })
      } catch {
        // Ignore duplicate key collision
      }
    }

    // Purge personal employee record, balances, and credentials
    await Promise.allSettled([
      Employee.deleteOne({ clerkUserId: userId }),
      LeaveBalance.deleteMany({ userId }),
      RefreshToken.deleteMany({ userId }),
      PasswordResetToken.deleteMany({ userId }),
      PasskeyCredential.deleteMany({ userId }),
      UserEmailConfig.deleteMany({ userId }),
      MailDraft.deleteMany({ userId }),
      User.findByIdAndDelete(userId),
    ])

    const response = NextResponse.json({
      success: true,
      message: 'Your account and personal data have been permanently deleted.',
    })

    // Clear session cookie
    response.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[account-deletion] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred while processing account deletion.' },
      { status: 500 }
    )
  }
}
