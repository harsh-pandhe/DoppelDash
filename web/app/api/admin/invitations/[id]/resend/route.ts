import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { resendInvitation } from '@/lib/invitations/invitationService'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await connectDB()
  const orgId = user?.orgId || 'org_doppelmayr'

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
      rawToken: result.rawToken,
      inviteUrl: result.inviteUrl,
      emailDelivery: result.emailDelivery,
    })
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string }
    const status = error.statusCode || 400
    return NextResponse.json({ error: error.message || 'Failed to resend invitation' }, { status })
  }
}
