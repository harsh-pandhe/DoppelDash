import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import ScannedCard from '@/models/ScannedCard'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

// PATCH — update parsed fields or link an imported contact
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()
  const card = await ScannedCard.findOne({ _id: params.id, orgId })
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (card.uploadedBy !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { parsedFields?: Record<string, string>; contactId?: string; ocrSource?: 'gemini' | 'ollama' | 'fallback' }
  if (body.parsedFields) card.parsedFields = body.parsedFields
  if (typeof body.contactId === 'string') {
    if (!mongoose.isValidObjectId(body.contactId)) {
      return NextResponse.json({ error: 'Invalid contactId' }, { status: 400 })
    }
    const contact = await Contact.findOne({ _id: body.contactId, orgId })
    if (!contact) return NextResponse.json({ error: 'Referenced contact not found in this organization' }, { status: 404 })
    card.contactId = body.contactId
  }
  if (body.ocrSource) card.ocrSource = body.ocrSource
  await card.save()
  return NextResponse.json(card)
}

// DELETE — remove a scanned card
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()
  const card = await ScannedCard.findOne({ _id: params.id, orgId })
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (card.uploadedBy !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await card.deleteOne()
  return NextResponse.json({ success: true })
}
