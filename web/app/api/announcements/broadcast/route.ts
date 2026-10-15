import { NextRequest, NextResponse } from 'next/server'
import { readJsonObject, badBody } from '@/lib/http/body'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { buildAnnouncementEmail } from '@/lib/email'
import { resolveMailBrand } from '@/lib/mail'
import { getUser, listUsers } from '@/lib/auth'
import { getMailService } from '@/lib/mail'

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsedBody = await readJsonObject(req)
  if (!parsedBody) return badBody()
  const { announcementId, targetRoles } = parsedBody
  if (!announcementId) return NextResponse.json({ error: 'announcementId required' }, { status: 400 })
  if (!mongoose.isValidObjectId(announcementId)) return NextResponse.json({ error: 'Invalid announcementId' }, { status: 400 })

  const effectiveOrgId = orgId
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

  // Provider chosen by the backend (org provider / sender's mailbox when the plan
  // allows custom mail, else the platform mail service) — see lib/mail/resolver.ts.
  const sender = await getMailService().createSender('crm_email', { orgId: effectiveOrgId, userId })
  if ('failure' in sender) return NextResponse.json({ error: sender.failure.message }, { status: 503 })
  const channel = sender.channel === 'user_mailbox' ? 'user_smtp' : sender.channel === 'organization' ? 'org_smtp' : 'smtp'

  const brand = await resolveMailBrand(effectiveOrgId)
  const { html, text, subject } = buildAnnouncementEmail({
    brand,
    title:    ann.title,
    body:     ann.body,
    priority: ann.priority,
    senderName,
  })
  await Promise.allSettled(emails.map(to => sender.send({ to, subject, html, text, fromName: brand.isPlatform ? undefined : brand.name })))

  return NextResponse.json({ sent: emails.length, channel })
}
