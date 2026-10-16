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
import { runDeletionSteps, orgDisbandSteps, personalSteps } from '@/lib/account/deletion'

/**
 * DELETE /api/user/account
 * Authenticated self-service account and personal data deletion.
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
          },
          { status: 400 }
        )
      }

      // Owner is the sole member: disband the tenant — unless it holds a lifetime grant (a protected system organisation).
      // Decided by persisted entitlement data, never by a hardcoded organisation id.
      disband = !org?.lifetimeGrant
    }

    // Ordered, idempotent, retryable purge (see lib/account/deletion.ts). Nothing is reported as deleted unless every step succeeded;
    // on failure the account is left intact and signed in, so the same request can simply be repeated.
    const outcome = await runDeletionSteps([...(disband ? orgDisbandSteps(orgId) : []), ...personalSteps(userId, orgId)])
    const auditBase = { orgId, performedBy: userId, performedByName: `${user.firstName} ${user.lastName}`.trim(), targetId: userId, targetType: 'user' as const }
    if (!outcome.ok) {
      await AuditLog.create({ ...auditBase, action: 'user.account_deletion_incomplete', metadata: { failed: outcome.failed, at: new Date() } }).catch(() => undefined)
      return NextResponse.json({ error: 'We could not finish deleting your account. Nothing further was removed after the failing step. Please try again in a moment.', code: 'deletion_incomplete', retry: true }, { status: 500 })
    }
    // Every record is gone: record the completion (the audit log is the one deliberately retained trail — pseudonymisation policy: docs/ACCOUNT_DELETION_POLICY.md).
    try {
      await AuditLog.create({
        ...auditBase,
        action: 'user.account_deleted',
        metadata: { email: user.email, deletedAt: new Date(), reason: 'User self-service account deletion', disbandedOrganisation: disband, ip: req.headers.get('x-forwarded-for') || 'unknown' },
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

export const DELETE = dbGuard(DELETE_handler)
