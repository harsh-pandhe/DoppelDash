import { listUsers } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailUrgentAnnouncement } from '@/lib/email'

// Called by system cron: */5 * * * * curl http://localhost:3000/api/cron/announcements?secret=<CRON_SECRET>
// Sends urgent-announcement emails for posts whose scheduledFor time has now passed.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const now = new Date()

  const due = await Announcement.find({
    priority: 'urgent',
    urgentEmailSent: { $ne: true },
    scheduledFor: { $ne: null, $lte: now },
  }).lean()

  if (!due.length) return NextResponse.json({ sent: 0 })

  let emails: string[] = []
  try {
    const users = await listUsers({ limit: 500 })
    emails = users.map(u => u.email).filter((e): e is string => Boolean(e))
  } catch { /* best-effort */ }

  let sent = 0
  for (const a of due) {
    if (emails.length) {
      await emailUrgentAnnouncement({
        emails,
        title:      a.title,
        body:       a.body,
        senderName: a.authorName || 'Management',
      })
    }
    await Announcement.findByIdAndUpdate(a._id, { urgentEmailSent: true })
    sent++
  }

  return NextResponse.json({ sent, titles: due.map(a => a.title) })
}
