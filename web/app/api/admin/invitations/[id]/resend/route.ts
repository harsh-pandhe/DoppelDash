import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import crypto from 'node:crypto'
import { getUser, devOnly } from '@/lib/auth'
import { INVITE_LIMITS } from '@/lib/auth/limits'
import { rateLimit } from '@/lib/ratelimit'
import Invitation from '@/models/Invitation'
import { connectDB } from '@/lib/db'
import { resendInvitation } from '@/lib/invitations/invitationService'

async function POST_handler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await connectDB()

  // Same abuse limits as creation, keyed to the stored recipient (org-scoped lookup).
  const existing = await Invitation.findOne({ _id: id, orgId }).select('email').lean<{ email: string } | null>()
  if (existing) {
    const recipientKey = crypto.createHash('sha256').update(existing.email.toLowerCase()).digest('hex').slice(0, 32)
    const limited =
      !(await rateLimit(`invite:user:${userId}`, INVITE_LIMITS.perInviterPerHour, INVITE_LIMITS.hourMs)) ||
      !(await rateLimit(`invite:org-rcpt:${orgId}:${recipientKey}`, INVITE_LIMITS.perOrgRecipientPerDay, INVITE_LIMITS.dayMs)) ||
      !(await rateLimit(`invite:rcpt:${recipientKey}`, INVITE_LIMITS.perRecipientPerDay, INVITE_LIMITS.dayMs))
    if (limited) {
      return NextResponse.json({ error: 'Too many invitations sent — please try again later.' }, { status: 429 })
    }
  }

  try {
    const result = await resendInvitation({
      invitationId: id,
      orgId,
      performedBy: userId,
      performedByName: user?.fullName || 'Administrator',
    })

    if (!result) {
      return NextResponse.json({ error: 'Invitation not found in this organization' }, { status: 404 })
    }

    return NextResponse.json({
      message: 'Invitation resent successfully',
      invitation: result.invitation,
      rawToken: devOnly(result.rawToken),
      inviteUrl: result.emailDelivery.delivered ? devOnly(result.inviteUrl) : result.inviteUrl,
      emailDelivery: result.emailDelivery,
    })
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string }
    const status = error.statusCode || 400
    return NextResponse.json({ error: error.message || 'Failed to resend invitation' }, { status })
  }
}

export const POST = dbGuard(POST_handler)
