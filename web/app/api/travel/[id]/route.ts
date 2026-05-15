import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import TravelRequest from '@/models/TravelRequest'
import { writeAudit } from '@/lib/audit'
import { getUser, listUsers } from '@/lib/auth'
import {
  getUserEmail,
  emailTravelForwardedToBoss,
  emailTravelDecision,
} from '@/lib/email'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const tr = await TravelRequest.findById(params.id).lean()
  if (!tr) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (tr as unknown as { userId: string }).userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(tr)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const actorName = user?.fullName || user?.firstName || 'Manager'

  await connectDB()
  const body = await req.json()
  const { status, managerNote, bossNote } = body

  const tr = await TravelRequest.findById(params.id)
  if (!tr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // State machine
  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending_manager: ['pending_boss', 'approved', 'rejected'],
    pending_boss:    ['approved', 'rejected', 'pending_manager'],
    approved:        [],
    rejected:        [],
    cancelled:       [],
  }
  if (!VALID_TRANSITIONS[tr.status]?.includes(status)) {
    return NextResponse.json({ error: `Cannot move from ${tr.status} to ${status}` }, { status: 409 })
  }
  // Boss-only actions on pending_boss
  if (tr.status === 'pending_boss' && (status === 'approved' || status === 'rejected') && role !== 'boss') {
    return NextResponse.json({ error: 'Only the boss can approve at this stage' }, { status: 403 })
  }

  tr.status = status
  if (managerNote !== undefined) tr.managerNote = managerNote
  if (bossNote    !== undefined) tr.bossNote    = bossNote
  if (status === 'approved') { tr.approvedBy = userId; tr.approvedAt = new Date() }
  if (status === 'rejected') { tr.rejectedBy = userId; tr.rejectedAt = new Date() }
  await tr.save()

  writeAudit({
    action:          `travel.${status}`,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'travel_request',
    metadata:        { employeeName: tr.userName, destination: tr.destination, amount: tr.estimatedTotal, note: managerNote || bossNote },
  })

  // Notifications (fire-and-forget)
  if (status === 'pending_boss') {
    ;(async () => {
      try {
        const users = await listUsers({ limit: 500 })
        const bosses = users.filter(u => u.role === 'boss')
        for (const b of bosses) {
          if (b.email) {
            emailTravelForwardedToBoss({
              bossEmail:    b.email,
              employeeName: tr.userName,
              purpose:      tr.purpose,
              destination:  tr.destination,
              departureDate:tr.departureDate,
              returnDate:   tr.returnDate,
              estimatedTotal:   tr.estimatedTotal,
              advanceRequested: tr.advanceRequested,
            })
          }
        }
      } catch { /* best-effort */ }
    })()
  }
  if (status === 'approved' || status === 'rejected') {
    getUserEmail(tr.userId).then(email => {
      if (email) emailTravelDecision({
        employeeEmail: email,
        status,
        purpose:       tr.purpose,
        destination:   tr.destination,
        departureDate: tr.departureDate,
        returnDate:    tr.returnDate,
        estimatedTotal:tr.estimatedTotal,
        note:          managerNote || bossNote,
      })
    })
  }

  return NextResponse.json(tr)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const tr = await TravelRequest.findById(params.id)
  if (!tr) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tr.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (tr.status !== 'pending_manager') return NextResponse.json({ error: 'Cannot cancel — already actioned' }, { status: 409 })
  tr.status = 'cancelled'
  await tr.save()
  writeAudit({
    action:          'travel.cancelled',
    performedBy:     userId,
    performedByName: tr.userName,
    targetId:        params.id,
    targetType:      'travel_request',
    metadata:        { destination: tr.destination, amount: tr.estimatedTotal },
  })
  return NextResponse.json({ success: true })
}
