import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const contacts = await Contact.find({
    orgId,
    createdBy: userId,
    reminderDate: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // due within 7 days
    $or: [
      { reminderDismissedAt: { $exists: false } },
      { $expr: { $lt: ['$reminderDismissedAt', '$reminderDate'] } },
    ],
  }, 'name email company reminderDate reminderNote').sort({ reminderDate: 1 }).limit(20).lean()
  return NextResponse.json(contacts)
}

// Dismiss a reminder so it stops resurfacing until the reminderDate is changed
async function PATCH_handler(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { contactId } = await req.json().catch(() => ({})) as { contactId?: string }
  if (!contactId) return NextResponse.json({ error: 'contactId required' }, { status: 400 })
  if (!mongoose.isValidObjectId(contactId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await connectDB()
  const contact = await Contact.findOneAndUpdate(
    { _id: contactId, orgId, createdBy: userId },
    { reminderDismissedAt: new Date() }
  )
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}

export const GET = dbGuard(GET_handler)
export const PATCH = dbGuard(PATCH_handler)
