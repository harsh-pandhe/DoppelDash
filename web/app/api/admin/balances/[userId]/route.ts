import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import LeaveBalance from '@/models/LeaveBalance'
import { writeAudit } from '@/lib/audit'

export async function GET(_: NextRequest, { params }: { params: { userId: string } }) {
  const { userId: actorId } = await auth()
  if (!actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await currentUser().catch(() => null)
  if ((me?.unsafeMetadata?.role as string) !== 'boss')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const year = new Date().getFullYear()
  const bal  = await LeaveBalance.findOne({ userId: params.userId, year }).lean()
  return NextResponse.json(bal || { userId: params.userId, year, casual: 12, medical: 6, earned: 15 })
}

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId: actorId } = await auth()
  if (!actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await currentUser().catch(() => null)
  if ((me?.unsafeMetadata?.role as string) !== 'boss')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  const year = new Date().getFullYear()
  const bal  = await LeaveBalance.findOneAndUpdate(
    { userId: params.userId, year },
    { ...body, userId: params.userId, year },
    { upsert: true, new: true }
  )

  writeAudit({
    action:          'balance.updated',
    performedBy:     actorId,
    performedByName: me?.fullName || 'Boss',
    targetId:        params.userId,
    targetType:      'balance',
    metadata:        { casual: body.casual, medical: body.medical, earned: body.earned },
  })

  return NextResponse.json(bal)
}
