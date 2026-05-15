import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'

export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const contacts = await Contact.find({
    createdBy: userId,
    reminderDate: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // due within 7 days
  }, 'name email company reminderDate reminderNote').sort({ reminderDate: 1 }).limit(20).lean()
  return NextResponse.json(contacts)
}
