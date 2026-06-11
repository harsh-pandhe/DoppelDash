import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import MailDraft from '@/models/MailDraft'
import { getUser } from '@/lib/auth'

const MAX_VERSIONS = 20

// GET — full draft incl. version history
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const draft = await MailDraft.findOne({ _id: params.id, ownerId: userId }).lean()
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(draft)
}

// PATCH — save: snapshot the current content as a version, then overwrite
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const draft = await MailDraft.findOne({ _id: params.id, ownerId: userId })
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as { subject?: string; bodyHtml?: string; recipients?: unknown[] }

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
  if (body.recipients !== undefined) draft.recipients = body.recipients as typeof draft.recipients
  await draft.save()

  return NextResponse.json(draft)
}

// DELETE — remove draft
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const res = await MailDraft.deleteOne({ _id: params.id, ownerId: userId })
  if (res.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
