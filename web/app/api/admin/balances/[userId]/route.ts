import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import LeaveBalance from '@/models/LeaveBalance'
import { writeAudit } from '@/lib/audit'
import { getUser } from '@/lib/auth'

const DEFAULTS = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0 }

export async function GET(_: NextRequest, { params }: { params: { userId: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user?.role !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const year = new Date().getFullYear()
  const bal  = await LeaveBalance.findOne({ userId: params.userId, year }).lean()
  return NextResponse.json(bal || { userId: params.userId, year, ...DEFAULTS })
}

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user?.role !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  const year = new Date().getFullYear()
  const bal  = await LeaveBalance.findOneAndUpdate(
    { userId: params.userId, year },
    { ...body, userId: params.userId, year },
    { upsert: true, returnDocument: 'after' }
  )

  writeAudit({
    action:          'balance.updated',
    performedBy:     userId,
    performedByName: user?.fullName || 'Boss',
    targetId:        params.userId,
    targetType:      'balance',
    metadata:        { casual: body.casual, sick: body.sick, earned: body.earned, privilege: body.privilege, restricted: body.restricted },
  })

  return NextResponse.json(bal)
}
