import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import TravelRequest from '@/models/TravelRequest'
import { getUser } from '@/lib/auth'
import { emailTravelSubmitted } from '@/lib/email'
import { notifyTargetsFor } from '@/lib/notify-targets'

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  await connectDB()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const query: Record<string, unknown> = isManager ? {} : { userId }
  if (status && status !== 'all') query.status = status
  const requests = await TravelRequest.find(query).sort({ createdAt: -1 }).limit(200).lean()
  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userName = user?.fullName || user?.firstName || 'Employee'

  await connectDB()
  const body = await req.json()
  const { purpose, destination, departureDate, returnDate, legs, estimatedTotal, advanceRequested, accommodation } = body

  if (!purpose || !destination || !departureDate || !returnDate) {
    return NextResponse.json({ error: 'purpose, destination, dates required' }, { status: 400 })
  }

  const tr = await TravelRequest.create({
    userId, userName,
    purpose, destination,
    departureDate: new Date(departureDate),
    returnDate:    new Date(returnDate),
    legs: (legs || []).map((l: { date: string; [k: string]: unknown }) => ({ ...l, date: new Date(l.date) })),
    estimatedTotal: estimatedTotal || 0,
    advanceRequested: advanceRequested || 0,
    accommodation,
    status: 'pending_manager',
  })

  // Notify reporting manager (+ boss); fallback to all managers if no chain set
  ;(async () => {
    try {
      const recipients = await notifyTargetsFor(userId)
      for (const email of recipients) {
        emailTravelSubmitted({
          managerEmail: email,
          employeeName: userName,
          purpose, destination,
          departureDate: new Date(departureDate),
          returnDate:    new Date(returnDate),
          estimatedTotal:   estimatedTotal || 0,
          advanceRequested: advanceRequested || 0,
        })
      }
    } catch { /* best-effort */ }
  })()

  return NextResponse.json(tr, { status: 201 })
}
