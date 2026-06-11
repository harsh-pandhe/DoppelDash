import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import MailDraft, { IMailRecipient } from '@/models/MailDraft'
import { getUser } from '@/lib/auth'

// GET — list the caller's drafts (no bodies, keep payload light)
export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const drafts = await MailDraft.find(
    { ownerId: userId },
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
export async function POST(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const body = await req.json() as { subject?: string; bodyHtml?: string; recipients?: IMailRecipient[] }
  const draft = await MailDraft.create({
    ownerId:    userId,
    subject:    body.subject || '',
    bodyHtml:   body.bodyHtml || '',
    recipients: body.recipients || [],
  })
  return NextResponse.json(draft, { status: 201 })
}
