import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const filter: Record<string, unknown> = { createdBy: userId }
  if (q) filter.name = { $regex: q, $options: 'i' }
  const contacts = await Contact.find(filter).sort({ createdAt: -1 }).limit(100).lean()
  return NextResponse.json(contacts)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const body = await req.json()
  const contact = await Contact.create({ ...body, createdBy: userId })
  return NextResponse.json(contact, { status: 201 })
}
