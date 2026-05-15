import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sanitize } from '@/lib/sanitize'
import { encryptContact, decryptContact } from '@/lib/encrypt'
import { getUser } from '@/lib/auth'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const visClauses: Record<string, unknown>[] = [
    { createdBy: userId },
    { visibility: 'org' },
    { sharedWith: userId },
  ]
  if (role === 'manager' || role === 'boss') visClauses.push({ visibility: 'team' })
  if (role === 'boss') visClauses.push({ visibility: 'boss_only' })

  const contact = await Contact.findOne({
    _id: params.id,
    $or: visClauses,
  }).lean()
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(decryptContact(contact))
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const visClauses: Record<string, unknown>[] = [
    { createdBy: userId },
    { visibility: 'org' },
    { sharedWith: userId },
  ]
  if (role === 'manager' || role === 'boss') visClauses.push({ visibility: 'team' })
  if (role === 'boss') visClauses.push({ visibility: 'boss_only' })
  const filter = { _id: params.id, $or: visClauses }

  const body = sanitize(await req.json()) as Record<string, unknown>

  // timeline entry push
  if (body.timelineEntry) {
    const contact = await Contact.findOneAndUpdate(
      filter,
      { $push: { timeline: { $each: [body.timelineEntry], $position: 0 } } },
      { returnDocument: 'after' }
    )
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(decryptContact(contact.toObject()))
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { timelineEntry, ...rest } = body
  const encrypted = encryptContact(rest)
  const contact = await Contact.findOneAndUpdate(
    filter,
    encrypted,
    { returnDocument: 'after' }
  )
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(decryptContact(contact.toObject()))
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const visClauses: Record<string, unknown>[] = [
    { createdBy: userId },
    { visibility: 'org' },
    { sharedWith: userId },
  ]
  if (role === 'manager' || role === 'boss') visClauses.push({ visibility: 'team' })
  if (role === 'boss') visClauses.push({ visibility: 'boss_only' })
  const filter = { _id: params.id, $or: visClauses }

  await Contact.findOneAndDelete(filter)
  return NextResponse.json({ success: true })
}
