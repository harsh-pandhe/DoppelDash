import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import TravelRequest from '@/models/TravelRequest'
import Expense from '@/models/Expense'
import { getUser } from '@/lib/auth'

const MODE_CATEGORY: Record<string, string> = {
  train: 'travel', flight: 'flight', bus: 'travel',
  taxi: 'taxi', own_vehicle: 'travel', other: 'misc',
}

// Auto-create an expense claim from a completed (approved + returned) travel request.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const tr = await TravelRequest.findOne({ _id: params.id, orgId })
  if (!tr) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tr.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (tr.status !== 'approved') return NextResponse.json({ error: 'Travel not approved' }, { status: 409 })
  if (tr.returnDate > new Date()) return NextResponse.json({ error: 'Trip not finished yet' }, { status: 409 })
  if (tr.expenseId) {
    const existing = await Expense.findOne({ _id: tr.expenseId, orgId }).lean()
    if (existing) return NextResponse.json(existing)
  }

  // Prefill line items from legs + accommodation
  const lineItems = (tr.legs || []).map(l => ({
    description: `${l.mode} · ${l.from} → ${l.to}`,
    amount: l.estimatedCost || 0,
    date: l.date,
    category: MODE_CATEGORY[l.mode] || 'travel',
    status: 'pending' as const,
  }))
  if (tr.accommodation?.required && tr.accommodation.estimatedCost) {
    lineItems.push({
      description: `Accommodation · ${tr.accommodation.city || tr.destination}`,
      amount: tr.accommodation.estimatedCost,
      date: tr.accommodation.checkIn || tr.departureDate,
      category: 'hotel',
      status: 'pending' as const,
    })
  }
  const total = lineItems.reduce((a, l) => a + l.amount, 0)

  const expense = await Expense.create({
    userId: tr.userId,
    userName: tr.userName,
    orgId,
    title: `Travel — ${tr.destination}`,
    reason: tr.purpose,
    amount: total,
    travelFrom: tr.legs?.[0]?.from,
    travelTo: tr.destination,
    startDate: tr.departureDate,
    endDate: tr.returnDate,
    lineItems,
    hasLineItems: lineItems.length > 0,
    travelRequestId: String(tr._id),
    receipts: tr.itineraryDocs || [],
    status: 'pending_manager',
  })

  tr.expenseId = String(expense._id)
  await tr.save()

  return NextResponse.json(expense, { status: 201 })
}
