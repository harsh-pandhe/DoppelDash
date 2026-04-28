import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { writeAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId: actorId } = await auth()
  if (!actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor     = await currentUser().catch(() => null)
  const actorRole = (actor?.unsafeMetadata?.role as string) || 'employee'
  if (actorRole !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body   = await req.json()
  const client = await clerkClient()

  if (body.permissions !== undefined) {
    const target = await client.users.getUser(params.userId)
    const existing = target.unsafeMetadata || {}
    await client.users.updateUserMetadata(params.userId, {
      unsafeMetadata: { ...existing, permissions: body.permissions },
    })
    writeAudit({
      action: 'user.permissions_changed', performedBy: actorId,
      performedByName: actor?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { permissions: body.permissions },
    })
  }

  if (body.role !== undefined) {
    const target = await client.users.getUser(params.userId)
    const existing = target.unsafeMetadata || {}
    await client.users.updateUserMetadata(params.userId, {
      unsafeMetadata: { ...existing, role: body.role },
    })
    writeAudit({
      action:          'user.role_changed',
      performedBy:     actorId,
      performedByName: actor?.fullName || 'Boss',
      targetId:        params.userId,
      targetType:      'user',
      metadata:        { newRole: body.role },
    })
  }

  if (body.banned === true) {
    await client.users.banUser(params.userId)
    writeAudit({
      action:          'user.banned',
      performedBy:     actorId,
      performedByName: actor?.fullName || 'Boss',
      targetId:        params.userId,
      targetType:      'user',
      metadata:        {},
    })
  }

  if (body.banned === false) {
    await client.users.unbanUser(params.userId)
    writeAudit({
      action:          'user.unbanned',
      performedBy:     actorId,
      performedByName: actor?.fullName || 'Boss',
      targetId:        params.userId,
      targetType:      'user',
      metadata:        {},
    })
  }

  return NextResponse.json({ success: true })
}
