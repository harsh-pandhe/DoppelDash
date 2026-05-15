import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { getUser, updateUser, getUserById } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body   = await req.json()
  const target = await getUserById(params.userId)
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (Array.isArray(body.permissions))        patch.permissions = body.permissions
  if (typeof body.role     === 'string')      patch.role        = body.role
  if (typeof body.banned   === 'boolean')     patch.isBanned    = body.banned
  if (typeof body.firstName === 'string')     patch.firstName   = body.firstName
  if (typeof body.lastName  === 'string')     patch.lastName    = body.lastName

  await updateUser(params.userId, patch)

  const empPatch: Record<string, unknown> = {}
  if (body.privileges && typeof body.privileges === 'object') empPatch.privileges = body.privileges
  if (typeof body.reportingManagerId === 'string')             empPatch.reportingManagerId = body.reportingManagerId
  if (body.reportingManagerId === null)                        empPatch.reportingManagerId = null
  if (typeof body.department === 'string')                     empPatch.department  = body.department
  if (typeof body.designation === 'string')                    empPatch.designation = body.designation
  if (Object.keys(empPatch).length) {
    await connectDB()
    await Employee.findOneAndUpdate(
      { clerkUserId: params.userId },
      empPatch,
      { returnDocument: 'after' }
    )
  }

  if (body.permissions !== undefined) {
    writeAudit({
      action: 'user.permissions_changed', performedBy: userId,
      performedByName: user?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { permissions: body.permissions, employeeName: target.fullName },
    })
  }

  if (body.privileges !== undefined) {
    writeAudit({
      action: 'user.privileges_changed', performedBy: userId,
      performedByName: user?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { privileges: body.privileges, employeeName: target.fullName },
    })
  }
  if (body.role !== undefined) {
    writeAudit({
      action: 'user.role_changed', performedBy: userId,
      performedByName: user?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { newRole: body.role, employeeName: target.fullName },
    })
  }
  if (body.banned === true) {
    writeAudit({
      action: 'user.banned', performedBy: userId,
      performedByName: user?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { employeeName: target.fullName },
    })
  }
  if (body.banned === false) {
    writeAudit({
      action: 'user.unbanned', performedBy: userId,
      performedByName: user?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { employeeName: target.fullName },
    })
  }
  if (body.reportingManagerId !== undefined) {
    writeAudit({
      action: 'user.reporting_manager_changed', performedBy: userId,
      performedByName: user?.fullName || 'Boss', targetId: params.userId,
      targetType: 'user', metadata: { reportingManagerId: body.reportingManagerId, employeeName: target.fullName },
    })
  }

  return NextResponse.json({ success: true })
}
