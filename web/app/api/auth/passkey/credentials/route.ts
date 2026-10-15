import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import PasskeyCredential from '@/models/PasskeyCredential'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/ratelimit'

/** List the signed-in user's passkeys. */
export async function GET() {
  const { userId, orgId } = await getUser()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`pk-creds-list:${userId}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

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
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`pk-creds-del:${userId}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts — wait 1 minute' }, { status: 429 })
  }

  const raw = await req.text().catch(() => '')
  if (raw.length > 64 * 1024) {
    return NextResponse.json({ error: 'Payload too large', code: 'payload_too_large' }, { status: 413 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { id } = body as { id?: unknown }
  if (!id || typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  await connectDB()
  let deleted = null
  try {
    deleted = await PasskeyCredential.findOneAndDelete({ _id: id.trim(), userId, orgId })
  } catch {
    // CastError on invalid ObjectId format is a clean 404, never 500
    return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })
  }
  if (!deleted) return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })

  await writeAudit({
    action: 'user.passkey_removed', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: { nickname: deleted.nickname || '' },
    orgId,
  })
  return NextResponse.json({ ok: true })
}
