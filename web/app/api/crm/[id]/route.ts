import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sanitize } from '@/lib/sanitize'
import { encryptContact, decryptContact } from '@/lib/encrypt'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const contact = await Contact.findOne({ _id: params.id, createdBy: userId }).lean()
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(decryptContact(contact))
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const body = sanitize(await req.json()) as Record<string, unknown>

  // timeline entry push
  if (body.timelineEntry) {
    const contact = await Contact.findOneAndUpdate(
      { _id: params.id, createdBy: userId },
      { $push: { timeline: { $each: [body.timelineEntry], $position: 0 } } },
      { new: true }
    )
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(decryptContact(contact.toObject()))
  }

  const { timelineEntry: _, ...rest } = body
  const encrypted = encryptContact(rest)
  const contact = await Contact.findOneAndUpdate(
    { _id: params.id, createdBy: userId },
    encrypted,
    { new: true }
  )
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(decryptContact(contact.toObject()))
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  await Contact.findOneAndDelete({ _id: params.id, createdBy: userId })
  return NextResponse.json({ success: true })
}
