import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject, badBody } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import MailDraft, { IMailRecipient } from '@/models/MailDraft'
import { getUser } from '@/lib/auth'

// GET — list the caller's drafts (no bodies, keep payload light)
async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const drafts = await MailDraft.find(
    { ownerId: userId, orgId },
    'subject recipients updatedAt createdAt versions.savedAt'
  ).sort({ updatedAt: -1 }).limit(100).lean()

  return NextResponse.json(drafts.map(d => ({
    _id: d._id,
    subject: d.subject,
    recipients: d.recipients,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
    versionCount: d.versions?.length || 0,
  })))
}

// POST — create a new draft
async function POST_handler(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const body = await readJsonObject<{ subject?: string; bodyHtml?: string; recipients?: IMailRecipient[] }>(req)
  if (!body) return badBody()
  const draft = await MailDraft.create({
    ownerId:    userId,
    orgId,
    subject:    body.subject || '',
    bodyHtml:   body.bodyHtml || '',
    recipients: body.recipients || [],
  })
  return NextResponse.json(draft, { status: 201 })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
