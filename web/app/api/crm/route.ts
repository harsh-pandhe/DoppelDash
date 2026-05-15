import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sanitize } from '@/lib/sanitize'
import { encryptContact, decryptContact } from '@/lib/encrypt'
import { getUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const q    = searchParams.get('q') || ''
    const role = user?.role || 'employee'

    // Visibility rules:
    // - Owner (createdBy === me) always sees own
    // - visibility='org' → everyone in org sees it
    // - visibility='team' → managers + boss see it (employees in same team)
    // - visibility='boss_only' → only boss sees it
    // - sharedWith[] contains me → I see it
    const visClauses: Record<string, unknown>[] = [
      { createdBy: userId },
      { visibility: 'org' },
      { sharedWith: userId },
    ]
    if (role === 'manager' || role === 'boss') visClauses.push({ visibility: 'team' })
    if (role === 'boss')                       visClauses.push({ visibility: 'boss_only' })

    const filter: Record<string, unknown> = { $or: visClauses }
    if (q) filter.name = { $regex: q, $options: 'i' }
    const contacts = await Contact.find(filter).sort({ createdAt: -1 }).limit(200).lean()
    return NextResponse.json(contacts.map(c => decryptContact(c)))
  } catch (err) {
    console.error('[CRM GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const raw  = sanitize(await req.json())
  const body = encryptContact(raw as Record<string, unknown>)
  const contact = await Contact.create({ ...body, createdBy: userId })
  return NextResponse.json(decryptContact(contact.toObject()), { status: 201 })
}
