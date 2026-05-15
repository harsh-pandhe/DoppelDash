import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import { getUser } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const emp = await Employee.findOne({
    $or: [{ clerkUserId: params.id }, { employeeId: params.id }]
  }).lean()
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(emp)
}

// Manager/boss can update employee record (privileges, designation, etc.)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  delete body.clerkUserId   // immutable
  delete body.employeeId    // immutable

  const emp = await Employee.findOneAndUpdate(
    { $or: [{ clerkUserId: params.id }, { employeeId: params.id }] },
    { $set: body },
    { returnDocument: 'after' }
  )
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(emp)
}
