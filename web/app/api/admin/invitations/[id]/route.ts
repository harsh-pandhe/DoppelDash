import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import Invitation from '@/models/Invitation'
import { revokeInvitation } from '@/lib/invitations/invitationService'

export async function GET(
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

  const query: Record<string, unknown> = { _id: id, orgId }
  if (role === 'manager') {
    query.invitedBy = userId
  }

  const invitation = await Invitation.findOne(query)
    .select('-tokenHash')
    .lean()

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  return NextResponse.json(invitation)
}

export async function DELETE(
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
    const revoked = await revokeInvitation({
      invitationId: id,
      orgId,
      performedBy: userId,
      performedByName: user?.fullName || 'Administrator',
    })

    if (!revoked) {
      return NextResponse.json({ error: 'Invitation not found in this organization' }, { status: 404 })
    }

    return NextResponse.json({
      message: 'Invitation revoked successfully',
      invitationId: id,
      revokedAt: revoked.revokedAt,
    })
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string }
    const status = error.statusCode || 400
    return NextResponse.json({ error: error.message || 'Failed to revoke invitation' }, { status })
  }
}
