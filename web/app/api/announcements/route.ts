import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailUrgentAnnouncement } from '@/lib/email'
import { getUser, listUsers } from '@/lib/auth'

export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const items = await Announcement.find().sort({ pinned: -1, createdAt: -1 }).limit(50).lean()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  const item = await Announcement.create({
    ...body,
    authorId:   userId,
    authorName: user?.fullName || user?.firstName || 'Unknown',
  })

  // Fire-and-forget urgent broadcast
  if (body.priority === 'urgent') {
    ;(async () => {
      try {
        const users  = await listUsers({ limit: 500 })
        const emails = users.map(u => u.email).filter((e): e is string => Boolean(e))
        if (emails.length) {
          emailUrgentAnnouncement({
            emails,
            title:      body.title,
            body:       body.body,
            senderName: user?.fullName || user?.firstName || 'Management',
          })
        }
      } catch { /* best-effort */ }
    })()
  }

  return NextResponse.json(item, { status: 201 })
}
