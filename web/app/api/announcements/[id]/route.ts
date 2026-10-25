import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject, badBody } from '@/lib/http/body'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { getUser } from '@/lib/auth'
import { sanitizeMailHtml } from '@/lib/sanitizeHtml'
import { pick } from '@/lib/pick'
import { writeAudit } from '@/lib/audit'
import { invalidAnnouncementFields, ANNOUNCEMENT_EDIT_FIELDS } from '@/lib/announcements/validation'

async function PATCH_handler(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const effectiveOrgId = orgId
  await connectDB()
  const body = await readJsonObject(req)
  if (!body) return badBody()
  // Allowlist (Phase 12): the old handler passed the whole body to the update, so a caller could rewrite authorName/urgentEmailSent/createdAt or send
  // raw update operators. Only the editable content fields are accepted; ownership and delivery flags stay server-owned.
  const edit = pick(body, ANNOUNCEMENT_EDIT_FIELDS) as Record<string, unknown>
  const badFields = invalidAnnouncementFields(edit, { partial: true })
  if (badFields.length) return NextResponse.json({ error: 'Invalid announcement', fields: badFields }, { status: 400 })
  if ('scheduledFor' in edit) edit.scheduledFor = edit.scheduledFor ? new Date(edit.scheduledFor as string) : null
  if (typeof edit.body === 'string') edit.body = sanitizeMailHtml(edit.body)
  const item = await Announcement.findOneAndUpdate({ _id: params.id, orgId: effectiveOrgId }, { $set: edit }, { returnDocument: 'after', runValidators: true })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await writeAudit({
    action: 'announcement.updated', performedBy: userId, performedByName: user?.fullName || 'Unknown',
    targetId: params.id, targetType: 'announcement', orgId: effectiveOrgId, metadata: { fields: Object.keys(edit) },
  })
  return NextResponse.json(item)
}

async function DELETE_handler(_: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const effectiveOrgId = orgId
  await connectDB()
  const res = await Announcement.findOneAndDelete({ _id: params.id, orgId: effectiveOrgId })
  if (!res) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await writeAudit({
    action: 'announcement.deleted', performedBy: userId, performedByName: user?.fullName || 'Unknown',
    targetId: params.id, targetType: 'announcement', orgId: effectiveOrgId,
  })
  return NextResponse.json({ success: true })
}

export const PATCH = dbGuard(PATCH_handler)
export const DELETE = dbGuard(DELETE_handler)
