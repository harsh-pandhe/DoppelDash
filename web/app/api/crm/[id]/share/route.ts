import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { randomBytes } from 'crypto'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

const SHARE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days

// Get (or create) the current share link for a contact. Reuses an unexpired
// token; issues a fresh one if missing/expired.
async function GET_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()

  const contact = await Contact.findOne({ _id: params.id, orgId, createdBy: userId })
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
async function POST_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()

  const contact = await Contact.findOne({ _id: params.id, orgId, createdBy: userId })
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  contact.shareToken = randomBytes(16).toString('hex')
  contact.shareTokenExpiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_MS)
  await contact.save()

  return NextResponse.json({ token: contact.shareToken, expiresAt: contact.shareTokenExpiresAt, url: `/contact/${contact.shareToken}` })
}

// Revoke the share link
async function DELETE_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()

  const contact = await Contact.findOneAndUpdate(
    { _id: params.id, orgId, createdBy: userId },
    { shareToken: null, shareTokenExpiresAt: null }
  )
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
export const DELETE = dbGuard(DELETE_handler)
