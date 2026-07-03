import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

const SHARE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days

// Get (or create) the current share link for a contact. Reuses an unexpired
// token; issues a fresh one if missing/expired.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()

  const contact = await Contact.findOne({ _id: params.id, createdBy: userId })
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const expired = !contact.shareToken || !contact.shareTokenExpiresAt || new Date(contact.shareTokenExpiresAt) < new Date()
  if (expired) {
    contact.shareToken = randomBytes(16).toString('hex')
    contact.shareTokenExpiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_MS)
    await contact.save()
  }

  return NextResponse.json({ token: contact.shareToken, expiresAt: contact.shareTokenExpiresAt, url: `/contact/${contact.shareToken}` })
}

// Force-regenerate the share link, invalidating the old one
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()

  const contact = await Contact.findOne({ _id: params.id, createdBy: userId })
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  contact.shareToken = randomBytes(16).toString('hex')
  contact.shareTokenExpiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_MS)
  await contact.save()

  return NextResponse.json({ token: contact.shareToken, expiresAt: contact.shareTokenExpiresAt, url: `/contact/${contact.shareToken}` })
}

// Revoke the share link
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()

  const contact = await Contact.findOneAndUpdate(
    { _id: params.id, createdBy: userId },
    { shareToken: null, shareTokenExpiresAt: null }
  )
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
