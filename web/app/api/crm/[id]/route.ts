import { NextRequest, NextResponse } from 'next/server'
import { readJsonObject, badBody } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sanitize } from '@/lib/sanitize'
import { encryptContact, decryptContact } from '@/lib/encrypt'
import mongoose from 'mongoose'
import { getUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { pick } from '@/lib/pick'
import { CONTACT_WRITE_FIELDS, TIMELINE_TYPES, visibilityClauses, canManageContact, canShareContact, sanitizeSharedWith, validationProblem } from '@/lib/crm/contactAccess'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const contact = await Contact.findOne({
    _id: params.id,
    orgId,
    $or: visibilityClauses(role, userId),
  }).lean()
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...decryptContact(contact), canManage: canManageContact(role, userId, contact.createdBy), canShare: canShareContact(userId, contact.createdBy) })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const filter = role === 'admin'
    ? { _id: params.id, orgId }
    : { _id: params.id, orgId, createdBy: userId }

  const rawBody = await readJsonObject(req)
  if (!rawBody) return badBody()
  const body = sanitize(rawBody) as Record<string, unknown>

  // timeline entry push
  if (body.timelineEntry) {
    const e = body.timelineEntry as Record<string, unknown>
    const title = typeof e?.title === 'string' ? e.title.trim() : ''
    if (!title || !(TIMELINE_TYPES as readonly string[]).includes(String(e.type))) {
      return NextResponse.json({ error: 'Invalid timeline entry', fields: ['type', 'title'] }, { status: 400 })
    }
    const entry = { type: e.type, title, body: typeof e.body === 'string' ? e.body : undefined, source: 'manual', date: e.date ? new Date(String(e.date)) : new Date() }
    if (Number.isNaN(entry.date.getTime())) return NextResponse.json({ error: 'Invalid timeline entry', fields: ['date'] }, { status: 400 })
    const contact = await Contact.findOneAndUpdate(
      filter,
      { $push: { timeline: { $each: [entry], $position: 0 } } },
      { returnDocument: 'after' }
    )
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ...decryptContact(contact.toObject()), canManage: true, canShare: canShareContact(userId, contact.createdBy) })
  }

  // Whitelist: ownership, share tokens, directory flags and greeting/reminder bookkeeping are server-owned.
  const rest = pick(body, CONTACT_WRITE_FIELDS) as Record<string, unknown>
  if ('sharedWith' in rest) rest.sharedWith = await sanitizeSharedWith(orgId, rest.sharedWith)
  const encrypted = encryptContact(rest)
  let contact
  try {
    contact = await Contact.findOneAndUpdate(filter, encrypted, { returnDocument: 'after', runValidators: true })
  } catch (err) {
    const problem = validationProblem(err)
    if (problem) return NextResponse.json(problem, { status: 400 })
    throw err
  }
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await writeAudit({
    action: 'contact_updated',
    performedBy: userId,
    performedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || userId,
    targetId: params.id,
    targetType: 'contact',
    orgId,
  })
  return NextResponse.json({ ...decryptContact(contact.toObject()), canManage: true, canShare: canShareContact(userId, contact.createdBy) })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const filter = role === 'admin'
    ? { _id: params.id, orgId }
    : { _id: params.id, orgId, createdBy: userId }

  const deleted = await Contact.findOneAndDelete(filter)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await writeAudit({
    action: 'contact_deleted',
    performedBy: userId,
    performedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || userId,
    targetId: params.id,
    targetType: 'contact',
    orgId,
  })

  return NextResponse.json({ success: true })
}
