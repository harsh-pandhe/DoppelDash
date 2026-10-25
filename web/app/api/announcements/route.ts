import mongoose from 'mongoose'
import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject, badBody } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailUrgentAnnouncement } from '@/lib/email'
import { getUser, listUsers } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { invalidAnnouncementFields } from '@/lib/announcements/validation'
import { sanitizeMailHtml } from '@/lib/sanitizeHtml'
import { pick } from '@/lib/pick'
import { ANNOUNCEMENT_CREATE_FIELDS } from '@/lib/apiFields'

async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId
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

async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const effectiveOrgId = orgId
  await connectDB()
  const body = await readJsonObject(req)
  if (!body) return badBody()
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null
  const isFutureScheduled = !!(scheduledFor && scheduledFor.getTime() > Date.now())
  if (typeof body.body === 'string') body.body = sanitizeMailHtml(body.body)
  // Explicit validation: an empty title used to surface Mongoose's ValidationError as a bare 500, and a 5,000-character title was stored (found by the live
  // acceptance run). Limits are generous for real announcements but bound the record size.
  const badFields = invalidAnnouncementFields(body, { partial: false })
  if (badFields.length) return NextResponse.json({ error: 'Invalid announcement', fields: badFields }, { status: 400 })
  let item
  try {
    item = await Announcement.create({
    ...pick(body, ANNOUNCEMENT_CREATE_FIELDS),
    scheduledFor: scheduledFor ?? undefined,
    // Mark immediate urgent posts as already-emailed so the publish cron skips them
    urgentEmailSent: body.priority === 'urgent' && !isFutureScheduled,
    authorId:   userId,
    authorName: user?.fullName || user?.firstName || 'Unknown',
    orgId:      effectiveOrgId,
  })
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) return NextResponse.json({ error: 'Invalid announcement' }, { status: 400 })
    throw err
  }

  await writeAudit({
    action: 'announcement.created', performedBy: userId, performedByName: user?.fullName || 'Unknown',
    targetId: String(item._id), targetType: 'announcement', orgId: effectiveOrgId,
    metadata: { priority: item.priority, pinned: !!item.pinned, scheduled: isFutureScheduled },
  })

  // Fire-and-forget urgent broadcast — skip when scheduled for the future (cron sends at publish time)
  if (body.priority === 'urgent' && !isFutureScheduled) {
    ;(async () => {
      try {
        const users  = await listUsers({ limit: 500, orgId: effectiveOrgId })
        const emails = users.map(u => u.email).filter((e): e is string => Boolean(e))
        if (emails.length) {
          emailUrgentAnnouncement({ orgId: effectiveOrgId,
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

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
