import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await connectDB()
  const body = await req.json()
  const leave = await Leave.findByIdAndUpdate(
    params.id,
    { ...body, approvedBy: userId },
    { new: true }
  )
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(leave)
}
