import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

export async function GET() {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'
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
export async function PATCH(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'
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
