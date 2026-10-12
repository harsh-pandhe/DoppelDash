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
  for (const a of due) {
    // A record without a tenant is never assigned one — skip it.
    if (!a.orgId) continue
    const emails = await getAnnouncementRecipients(a.orgId)

    if (emails.length) {
      await emailUrgentAnnouncement({
        orgId: a.orgId,
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
