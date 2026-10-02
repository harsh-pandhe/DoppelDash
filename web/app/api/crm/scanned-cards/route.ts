import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import ScannedCard from '@/models/ScannedCard'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

// GET — list the caller's scanned cards (newest first)
export async function GET() {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()
  const cards = await ScannedCard.find({ orgId, uploadedBy: userId }).sort({ createdAt: -1 }).limit(200).lean()
  return NextResponse.json(cards)
}

// POST — store a scanned card (image + OCR result)
export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'

  const body = await req.json() as {
    imageData?: string
    ocrSource?: 'gemini' | 'ollama' | 'fallback'
    rawText?: string
    parsedFields?: Record<string, string | null>
    contactId?: string
  }
  if (!body.imageData) return NextResponse.json({ error: 'imageData required' }, { status: 400 })
  if (body.imageData.length > 1_500_000) return NextResponse.json({ error: 'imageData too large' }, { status: 400 })

  await connectDB()
  if (body.contactId) {
    if (!mongoose.isValidObjectId(body.contactId)) {
      return NextResponse.json({ error: 'Invalid contactId' }, { status: 400 })
    }
    const contact = await Contact.findOne({ _id: body.contactId, orgId })
    if (!contact) return NextResponse.json({ error: 'Referenced contact not found in this organization' }, { status: 404 })
  }

  // Strip nulls from parsed fields so schema stays clean
  const parsed: Record<string, string> = {}
  for (const [k, v] of Object.entries(body.parsedFields || {})) {
    if (v) parsed[k] = v
  }

  const card = await ScannedCard.create({
    orgId,
    uploadedBy:     userId,
    uploadedByName: user?.fullName || user?.firstName || 'Unknown',
    imageData:      body.imageData,
    ocrSource:      body.ocrSource || 'fallback',
    rawText:        body.rawText,
    parsedFields:   parsed,
    contactId:      body.contactId,
  })
  return NextResponse.json(card, { status: 201 })
}
