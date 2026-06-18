import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import ScannedCard from '@/models/ScannedCard'
import { getUser } from '@/lib/auth'

// GET — list the caller's scanned cards (newest first)
export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const cards = await ScannedCard.find({ uploadedBy: userId }).sort({ createdAt: -1 }).limit(200).lean()
  return NextResponse.json(cards)
}

// POST — store a scanned card (image + OCR result)
export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    imageData?: string
    ocrSource?: 'gemini' | 'ollama' | 'fallback'
    rawText?: string
    parsedFields?: Record<string, string | null>
    contactId?: string
  }
  if (!body.imageData) return NextResponse.json({ error: 'imageData required' }, { status: 400 })

  await connectDB()
  // Strip nulls from parsed fields so schema stays clean
  const parsed: Record<string, string> = {}
  for (const [k, v] of Object.entries(body.parsedFields || {})) {
    if (v) parsed[k] = v
  }

  const card = await ScannedCard.create({
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
