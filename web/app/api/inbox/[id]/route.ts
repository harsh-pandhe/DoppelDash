import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import InboxMessage from '@/models/InboxMessage'
import { getUser } from '@/lib/auth'

function canAccessMail(user: { role?: string; mailAccess?: boolean } | null): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'manager') return true
  return Boolean(user.mailAccess)
}

// GET — full message (with body). Marks readByApp = true.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccessMail(user)) return NextResponse.json({ error: 'Mail access not granted' }, { status: 403 })

  const { id } = await params
  await connectDB()

  const msg = await InboxMessage.findOne({ _id: id, orgId }).lean()
  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!msg.readByApp) {
    await InboxMessage.updateOne({ _id: id, orgId }, { $set: { readByApp: true } })
  }

  return NextResponse.json({ ...msg, readByApp: true })
}

// PATCH — toggle read state ({ readByApp: boolean }).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccessMail(user)) return NextResponse.json({ error: 'Mail access not granted' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { readByApp?: boolean }
  await connectDB()

  const updated = await InboxMessage.findOneAndUpdate(
    { _id: id, orgId },
    { $set: { readByApp: body.readByApp ?? true } },
    { new: true },
  ).select('readByApp').lean()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true, readByApp: updated.readByApp })
}
