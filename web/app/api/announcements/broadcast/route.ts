import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { emailAnnouncement, buildAnnouncementEmail } from '@/lib/email'
import { getUser, listUsers } from '@/lib/auth'
import { getUserTransporter } from '@/lib/userEmail'

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { announcementId, targetRoles } = await req.json()
  if (!announcementId) return NextResponse.json({ error: 'announcementId required' }, { status: 400 })
  if (!mongoose.isValidObjectId(announcementId)) return NextResponse.json({ error: 'Invalid announcementId' }, { status: 400 })

  const effectiveOrgId = user?.orgId || orgId || 'org_doppelmayr'
  await connectDB()
  const ann = await Announcement.findOne({ _id: announcementId, orgId: effectiveOrgId }).lean() as {
    title: string; body: string; priority?: string
  } | null
  if (!ann) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const users  = await listUsers({ limit: 500, orgId: effectiveOrgId })
  const roles: string[] = Array.isArray(targetRoles) && targetRoles.length
    ? targetRoles
    : ['employee', 'manager', 'admin']
  const emails = users
    .filter(u => roles.includes(u.role || 'employee'))
    .map(u => u.email)
    .filter((e): e is string => Boolean(e))

  if (!emails.length) return NextResponse.json({ error: 'No recipients found' }, { status: 400 })

  const senderName = user?.fullName || user?.firstName || 'Management'

  // Prefer sender's connected SMTP — branded HTML for both channels
  const userSmtp = await getUserTransporter(userId)
  const channel  = userSmtp ? 'user_smtp' : 'smtp'

  if (userSmtp) {
    const { html, text, subject } = buildAnnouncementEmail({
      title:    ann.title,
      body:     ann.body,
      priority: ann.priority,
      senderName,
    })
    await Promise.allSettled(emails.map(to =>
      userSmtp.transporter.sendMail({ from: userSmtp.from, to, subject, html, text })
    ))
  } else {
    await emailAnnouncement({
      emails,
      title:      ann.title,
      body:       ann.body,
      priority:   ann.priority,
      senderName,
    })
  }

  return NextResponse.json({ sent: emails.length, channel })
}
