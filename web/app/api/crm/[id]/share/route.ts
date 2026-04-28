import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'

// Public endpoint — no auth — returns safe (non-encrypted) fields only
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB()
  const contact = await Contact.findById(params.id,
    'name email phone company designation photo tags website'
  ).lean()
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(contact)
}
