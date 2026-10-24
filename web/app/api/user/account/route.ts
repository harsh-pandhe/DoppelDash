import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import crypto from 'crypto'
import { connectDB } from '@/lib/db'
import { getUser } from '@/lib/auth/getUser'
import User from '@/models/User'
import Organization from '@/models/Organization'
import AuditLog from '@/models/AuditLog'
import RevokedToken from '@/models/RevokedToken'
import { COOKIE_NAME } from '@/lib/auth/jwt'
import { scheduleDeletion, DELETION_GRACE_DAYS } from '@/lib/account/lifecycle'

/**
 * DELETE /api/user/account
 * Authenticated self-service account and personal data deletion (14-day soft delete — see lib/account/lifecycle.ts).
 * Satisfies Google Play Data Safety requirements and DPDP Act / GDPR compliance.
 */
async function DELETE_handler(req: NextRequest) {
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
    let disband = false

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
            code: 'owner_must_transfer',
            transferEndpoint: '/api/org/transfer-ownership',
          },
          { status: 400 }
        )
      }

      // Owner is the sole member: disband the tenant — unless it holds a lifetime grant (a protected system organisation).
      // Decided by persisted entitlement data, never by a hardcoded organisation id.
      disband = !org?.lifetimeGrant
    }

    // D-02.8 (owner decision, 2026-10-25): deletion is a 14-day SOFT delete. The account is deactivated and every session is revoked now; the data is
    // untouched and the person can restore the account by signing in with their password. The irreversible purge (and, for a disband, the
    // retention rules of D-03.3/D-03.4) runs later from the retention job (lib/account/lifecycle.ts) — never inline.
    // D-02.5: the audit entry carries ids only, never the e-mail address.
    const { restoreUntil } = await scheduleDeletion({ userId, orgId, disband })
    try {
      await AuditLog.create({
        orgId, performedBy: userId, performedByName: `${user.firstName} ${user.lastName}`.trim(), targetId: userId, targetType: 'user',
        action: 'user.account_deletion_requested',
        metadata: { requestedAt: new Date(), restoreUntil, disbandOrganisation: disband, gracePeriodDays: DELETION_GRACE_DAYS },
      })
    } catch (err) {
      console.error('Failed to write deletion audit log:', err)
    }

    // Invalidate the presented token so it cannot be replayed
    const authHeader = req.headers.get('authorization')
    const token = req.cookies.get(COOKIE_NAME)?.value || authHeader?.match(/^Bearer (.+)$/)?.[1]
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      try {
        await RevokedToken.create({ tokenIdentifier: tokenHash, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      } catch {
        // Ignore duplicate key collision
      }
    }

    const response = NextResponse.json({
      success: true,
      scheduled: true,
      restoreUntil: restoreUntil.toISOString(),
      gracePeriodDays: DELETION_GRACE_DAYS,
      message: `Your account is scheduled for deletion and you have been signed out. Sign in again within ${DELETION_GRACE_DAYS} days to restore it; after that your personal data is permanently deleted.`,
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

export const DELETE = dbGuard(DELETE_handler)
