import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject, badBody } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import MailDraft from '@/models/MailDraft'
import { getUser } from '@/lib/auth'
import { invalidDraftFields, cleanRecipients } from '@/lib/mail/draftValidation'

const MAX_VERSIONS = 20

// GET — full draft incl. version history
async function GET_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const draft = await MailDraft.findOne({ _id: params.id, ownerId: userId, orgId }).lean()
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(draft)
}

// PATCH — save: snapshot the current content as a version, then overwrite
async function PATCH_handler(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const draft = await MailDraft.findOne({ _id: params.id, ownerId: userId, orgId })
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await readJsonObject<{ subject?: string; bodyHtml?: string; recipients?: unknown[] }>(req)
  if (!body) return badBody()
  const bad = invalidDraftFields(body)
  if (bad.length) return NextResponse.json({ error: 'Invalid draft', fields: bad }, { status: 400 })

  // Auto-snapshot the outgoing content if it actually changed
  const contentChanged =
    (body.subject !== undefined && body.subject !== draft.subject) ||
    (body.bodyHtml !== undefined && body.bodyHtml !== draft.bodyHtml)
  if (contentChanged && (draft.subject || draft.bodyHtml)) {
    draft.versions.unshift({ subject: draft.subject, bodyHtml: draft.bodyHtml, savedAt: new Date() })
    draft.versions = draft.versions.slice(0, MAX_VERSIONS)
  }

  if (body.subject !== undefined)    draft.subject = body.subject
  if (body.bodyHtml !== undefined)   draft.bodyHtml = body.bodyHtml
  if (body.recipients !== undefined) draft.recipients = cleanRecipients(body.recipients as unknown[]) as typeof draft.recipients
  await draft.save()

  return NextResponse.json(draft)
}

// DELETE — remove draft
async function DELETE_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const res = await MailDraft.deleteOne({ _id: params.id, ownerId: userId, orgId })
  if (res.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export const GET = dbGuard(GET_handler)
export const PATCH = dbGuard(PATCH_handler)
export const DELETE = dbGuard(DELETE_handler)
