import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  await connectDB()
  const { searchParams } = new URL(req.url)
  const filter: Record<string, unknown> = role === 'employee' ? { userId } : {}
  const status = searchParams.get('status')
  const from   = searchParams.get('from')
  const to     = searchParams.get('to')
  if (status) filter.status = status
  if (from || to) {
    filter.startDate = {}
    if (from) (filter.startDate as Record<string, unknown>).$gte = new Date(from)
    if (to)   (filter.startDate as Record<string, unknown>).$lte = new Date(to)
  }
  const expenses = await Expense.find(filter).sort({ createdAt: -1 }).limit(200).lean()
  return NextResponse.json(expenses)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  await connectDB()
  const body = await req.json()
  const expense = await Expense.create({
    ...body,
    userId,
    userName: user?.fullName || user?.firstName || 'Unknown',
    status: 'pending_manager',
  })
  return NextResponse.json(expense, { status: 201 })
}
