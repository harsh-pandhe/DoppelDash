import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { getUser } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  const item = await Announcement.findByIdAndUpdate(params.id, body, { returnDocument: 'after' })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  await Announcement.findByIdAndDelete(params.id)
  return NextResponse.json({ success: true })
}
