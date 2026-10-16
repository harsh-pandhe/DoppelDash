import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import ScannedCard from '@/models/ScannedCard'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'
import { validateScannedCardInput } from '@/lib/ocr/card'

// PATCH — update parsed fields or link an imported contact
async function PATCH_handler(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const card = await ScannedCard.findOne({ _id: params.id, orgId })
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (card.uploadedBy !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const raw = await req.json().catch(() => null)
  const checked = validateScannedCardInput(raw, false)
  if (!checked.ok) return NextResponse.json({ error: checked.error, fields: checked.fields }, { status: checked.status })
  const body = checked.data
  if (body.imageData !== undefined) return NextResponse.json({ error: 'The card image cannot be replaced', fields: ['imageData'] }, { status: 400 })
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
async function DELETE_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const card = await ScannedCard.findOne({ _id: params.id, orgId })
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (card.uploadedBy !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await card.deleteOne()
  return NextResponse.json({ success: true })
}

export const PATCH = dbGuard(PATCH_handler)
export const DELETE = dbGuard(DELETE_handler)
