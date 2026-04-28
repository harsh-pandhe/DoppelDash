import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailUrgentAnnouncement } from '@/lib/email'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const items = await Announcement.find().sort({ pinned: -1, createdAt: -1 }).limit(50).lean()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  const item = await Announcement.create({
    ...body,
    authorId:   userId,
    authorName: user?.fullName || user?.firstName || 'Unknown',
  })

  // Send email to everyone for urgent announcements (fire-and-forget)
  if (body.priority === 'urgent') {
    ;(async () => {
      try {
        const client = await clerkClient()
        const { data: users } = await client.users.getUserList({ limit: 200 })
        const emails = users
          .map(u => u.primaryEmailAddress?.emailAddress)
          .filter((e): e is string => Boolean(e))
        if (emails.length) {
          emailUrgentAnnouncement({ emails, title: body.title, body: body.body })
        }
      } catch { /* best-effort */ }
    })()
  }

  return NextResponse.json(item, { status: 201 })
}
