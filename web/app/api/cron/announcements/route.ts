import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { claim, finish, release, claimableFragment } from '@/lib/cron/claim'
import { emailUrgentAnnouncement } from '@/lib/email'
import { getAnnouncementRecipients } from '@/lib/cron-recipients'

// Called by system cron: */5 * * * * curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/announcements
// Sends urgent-announcement emails for posts whose scheduledFor time has now passed.
async function GET_handler(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const now = new Date()

  const coll = Announcement.collection as unknown as import('mongodb').Collection<import('mongodb').Document>
  const due = await Announcement.find({
    priority: 'urgent',
    urgentEmailSent: { $ne: true },
    scheduledFor: { $ne: null, $lte: now },
    ...claimableFragment('urgentEmail', now),
  }).lean()

  if (!due.length) return NextResponse.json({ sent: 0 })

  let sent = 0
  for (const a of due) {
    // A record without a tenant is never assigned one — skip it.
    if (!a.orgId) continue
    // ATOMIC LEASE before sending (overlapping runs cannot both send; a crashed run's lease expires and it is retried; bounded per day).
    if (!(await claim(coll, a._id, { urgentEmailSent: { $ne: true } }, 'urgentEmail', now))) continue
    try {
      const emails = await getAnnouncementRecipients(a.orgId)
      if (emails.length) {
        await emailUrgentAnnouncement({ orgId: a.orgId, emails, title: a.title, body: a.body, senderName: a.authorName || 'Management' })
      }
      await finish(coll, a._id, 'urgentEmail', { urgentEmailSent: true })
      sent++
    } catch {
      await release(coll, a._id, 'urgentEmail').catch(() => undefined)
    }
  }

  // Counts only: the scheduler's run history/logs (often third-party or public) must never carry announcement titles.
  return NextResponse.json({ sent })
}

export const GET = dbGuard(GET_handler)
