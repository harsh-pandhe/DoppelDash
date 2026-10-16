import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import ScannedCard from '@/models/ScannedCard'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'
import { validateScannedCardInput } from '@/lib/ocr/card'

// GET — list the caller's scanned cards (newest first)
async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const cards = await ScannedCard.find({ orgId, uploadedBy: userId }).sort({ createdAt: -1 }).limit(200).lean()
  return NextResponse.json(cards)
}

// POST — store a scanned card (image + OCR result)
async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json().catch(() => null)
  const checked = validateScannedCardInput(raw, true)
  if (!checked.ok) return NextResponse.json({ error: checked.error, fields: checked.fields }, { status: checked.status })
  const body = checked.data

  await connectDB()
  if (body.contactId) {
    if (!mongoose.isValidObjectId(body.contactId)) {
      return NextResponse.json({ error: 'Invalid contactId' }, { status: 400 })
    }
    const contact = await Contact.findOne({ _id: body.contactId, orgId })
    if (!contact) return NextResponse.json({ error: 'Referenced contact not found in this organization' }, { status: 404 })
  }

  const card = await ScannedCard.create({
    orgId,
    uploadedBy:     userId,
    uploadedByName: user?.fullName || user?.firstName || 'Unknown',
    imageData:      body.imageData!,
    ocrSource:      body.ocrSource || 'fallback',
    rawText:        body.rawText,
    parsedFields:   body.parsedFields || {},
    contactId:      body.contactId,
  })
  return NextResponse.json(card, { status: 201 })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
