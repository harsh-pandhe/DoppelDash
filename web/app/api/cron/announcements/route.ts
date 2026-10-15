import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailUrgentAnnouncement } from '@/lib/email'
import { getAnnouncementRecipients } from '@/lib/cron-recipients'

// Called by system cron: */5 * * * * curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/announcements
// Sends urgent-announcement emails for posts whose scheduledFor time has now passed.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
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

  let sent = 0
  const titles: string[] = []
  for (const a of due) {
    // A record without a tenant is never assigned one — skip it.
    if (!a.orgId) continue
    // ATOMIC CLAIM before sending (overlapping runs cannot both send the same announcement).
    const claimed = await Announcement.findOneAndUpdate({ _id: a._id, urgentEmailSent: { $ne: true } }, { $set: { urgentEmailSent: true } }, { projection: { _id: 1 } })
    if (!claimed) continue
    try {
      const emails = await getAnnouncementRecipients(a.orgId)
      if (emails.length) {
        await emailUrgentAnnouncement({ orgId: a.orgId, emails, title: a.title, body: a.body, senderName: a.authorName || 'Management' })
      }
      sent++; titles.push(a.title)
    } catch {
      await Announcement.updateOne({ _id: a._id }, { $set: { urgentEmailSent: false } }).catch(() => undefined)   // retry on the next run
    }
  }

  return NextResponse.json({ sent, titles })
}
