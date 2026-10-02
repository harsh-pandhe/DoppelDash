import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailUrgentAnnouncement } from '@/lib/email'
import { getUser, listUsers } from '@/lib/auth'
import { sanitizeMailHtml } from '@/lib/sanitizeHtml'
import { pick } from '@/lib/pick'
import { ANNOUNCEMENT_CREATE_FIELDS } from '@/lib/apiFields'

export async function GET() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()
  const now = new Date()
  // Hide future-scheduled posts from everyone except their author
  const visibility = {
    orgId: effectiveOrgId,
    $or: [
      { scheduledFor: null },
      { scheduledFor: { $lte: now } },
      { authorId: userId },
    ],
  }
  const items = await Announcement.find(visibility).sort({ pinned: -1, createdAt: -1 }).limit(50).lean()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const effectiveOrgId = user?.orgId || orgId || 'org_doppelmayr'
  await connectDB()
  const body = await req.json()
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null
  const isFutureScheduled = !!(scheduledFor && scheduledFor.getTime() > Date.now())
  if (typeof body.body === 'string') body.body = sanitizeMailHtml(body.body)
  const item = await Announcement.create({
    ...pick(body, ANNOUNCEMENT_CREATE_FIELDS),
    scheduledFor: scheduledFor ?? undefined,
    // Mark immediate urgent posts as already-emailed so the publish cron skips them
    urgentEmailSent: body.priority === 'urgent' && !isFutureScheduled,
    authorId:   userId,
    authorName: user?.fullName || user?.firstName || 'Unknown',
    orgId:      effectiveOrgId,
  })

  // Fire-and-forget urgent broadcast — skip when scheduled for the future (cron sends at publish time)
  if (body.priority === 'urgent' && !isFutureScheduled) {
    ;(async () => {
      try {
        const users  = await listUsers({ limit: 500, orgId: effectiveOrgId })
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
