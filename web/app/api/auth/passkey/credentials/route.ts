import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import PasskeyCredential from '@/models/PasskeyCredential'
import { writeAudit } from '@/lib/audit'

/** List the signed-in user's passkeys. */
export async function GET() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const creds = await PasskeyCredential.find({ userId, orgId })
    .select('nickname deviceType backedUp lastUsedAt createdAt')
    .sort({ createdAt: -1 }).lean()

  return NextResponse.json({
    passkeys: creds.map(c => ({
      id:         String(c._id),
      nickname:   c.nickname || 'Passkey',
      deviceType: c.deviceType,
      backedUp:   c.backedUp,
      lastUsedAt: c.lastUsedAt,
      createdAt:  c.createdAt,
    })),
  })
}

/** Remove a passkey by its document id. */
export async function DELETE(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await connectDB()
  const deleted = await PasskeyCredential.findOneAndDelete({ _id: id, userId, orgId })
  if (!deleted) return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })

  writeAudit({
    action: 'user.passkey_removed', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: { nickname: deleted.nickname || '' },
    orgId,
  })
  return NextResponse.json({ ok: true })
}
