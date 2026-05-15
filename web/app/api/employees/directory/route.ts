import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import { getUser, listUsers } from '@/lib/auth'

export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const clerkUsers = await listUsers({ limit: 500 })

  const employees = await Employee.find(
    { isActive: true },
    'clerkUserId firstName lastName email phone photo department designation employeeId joiningDate'
  ).lean()
  const empMap = new Map(employees.map(e => [e.clerkUserId, e]))

  const directory = clerkUsers
    .filter(u => !(u.banned))
    .map(u => {
      const emp = empMap.get(u.id)
      return {
        clerkUserId: u.id,
        name:        u.fullName || `${u.firstName} ${u.lastName}`.trim(),
        email:       u.email || emp?.email || '',
        phone:       emp?.phone || '',
        photo:       emp?.photo || '',
        department:  emp?.department || '',
        designation: emp?.designation || '',
        employeeId:  emp?.employeeId || '',
        role:        u.role || 'employee',
        joiningDate: emp?.joiningDate || null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json(directory)
}
