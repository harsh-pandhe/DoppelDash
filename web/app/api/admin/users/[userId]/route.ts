import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { getUser, updateUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import type { UserRole } from '@/models/User'

const VALID_ROLES: UserRole[] = ['admin', 'manager', 'employee']

export async function GET(_req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()

  // Target user must strictly belong to the calling admin's organization
  const target = await User.findOne({ _id: params.userId, orgId: effectiveOrgId }).lean()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const emp = await Employee.findOne({ clerkUserId: params.userId, orgId: effectiveOrgId }).lean()

  return NextResponse.json({
    user: {
      id: String(target._id),
      email: target.email,
      orgId: target.orgId,
      role: target.role,
      firstName: target.firstName,
      lastName: target.lastName,
      fullName: `${target.firstName} ${target.lastName}`.trim(),
      permissions: target.permissions || [],
      isActive: target.isActive,
      isBanned: target.isBanned,
      mailAccess: target.mailAccess ?? false,
      createdAt: target.createdAt,
    },
    employee: emp,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()

  // Verify target user belongs to the calling admin's organization
  const target = await User.findOne({ _id: params.userId, orgId: effectiveOrgId }).lean()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()

  // Self-demotion / self-ban protection: An admin cannot lock themselves out
  if (params.userId === userId) {
    if (body.banned === true) {
      return NextResponse.json({ error: 'Cannot ban your own account' }, { status: 400 })
    }
    if (typeof body.role === 'string' && body.role !== 'admin') {
      return NextResponse.json({ error: 'Cannot demote your own admin account' }, { status: 400 })
    }
  }

  if (typeof body.role === 'string' && !VALID_ROLES.includes(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (Array.isArray(body.permissions))        patch.permissions = body.permissions
  if (typeof body.role     === 'string')      patch.role        = body.role
  if (typeof body.banned   === 'boolean')     patch.isBanned    = body.banned
  if (typeof body.mailAccess === 'boolean')   patch.mailAccess  = body.mailAccess
  if (typeof body.firstName === 'string')     patch.firstName   = body.firstName
  if (typeof body.lastName  === 'string')     patch.lastName    = body.lastName

  if (Object.keys(patch).length > 0) {
    await updateUser(params.userId, patch, effectiveOrgId)
  }

  const empPatch: Record<string, unknown> = {}
  if (body.privileges && typeof body.privileges === 'object') empPatch.privileges = body.privileges
  if (typeof body.reportingManagerId === 'string')             empPatch.reportingManagerId = body.reportingManagerId
  if (body.reportingManagerId === null)                        empPatch.reportingManagerId = null
  if (typeof body.department === 'string')                     empPatch.department  = body.department
  if (typeof body.designation === 'string')                    empPatch.designation = body.designation
  if (Object.keys(empPatch).length > 0) {
    await Employee.findOneAndUpdate(
      { clerkUserId: params.userId, orgId: effectiveOrgId },
      empPatch,
      { returnDocument: 'after' }
    )
  }

  const targetFullName = `${target.firstName} ${target.lastName}`.trim()
  const actorName = user?.fullName || 'Boss'

  if (body.permissions !== undefined) {
    writeAudit({
      action: 'user.permissions_changed', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { permissions: body.permissions, employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }
  if (body.privileges !== undefined) {
    writeAudit({
      action: 'user.privileges_changed', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { privileges: body.privileges, employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }
  if (body.role !== undefined) {
    writeAudit({
      action: 'user.role_changed', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { newRole: body.role, employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }
  if (body.banned === true) {
    writeAudit({
      action: 'user.banned', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }
  if (body.banned === false) {
    writeAudit({
      action: 'user.unbanned', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }
  if (body.reportingManagerId !== undefined) {
    writeAudit({
      action: 'user.reporting_manager_changed', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { reportingManagerId: body.reportingManagerId, employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }
  if (body.mailAccess !== undefined) {
    writeAudit({
      action: 'user.mail_access_changed', performedBy: userId,
      performedByName: actorName, targetId: params.userId,
      targetType: 'user', metadata: { mailAccess: body.mailAccess, employeeName: targetFullName },
      orgId: effectiveOrgId,
    })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { userId: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (params.userId === userId) {
    return NextResponse.json({ error: 'Cannot delete your own admin account' }, { status: 400 })
  }

  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()

  // Target user must strictly belong to the calling admin's organization
  const target = await User.findOne({ _id: params.userId, orgId: effectiveOrgId }).lean()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await User.findOneAndDelete({ _id: params.userId, orgId: effectiveOrgId })
  await Employee.findOneAndDelete({ clerkUserId: params.userId, orgId: effectiveOrgId })
  await LeaveBalance.deleteMany({ userId: params.userId, orgId: effectiveOrgId })

  const targetFullName = `${target.firstName} ${target.lastName}`.trim()
  const actorName = user?.fullName || 'Boss'

  writeAudit({
    action: 'user.deleted',
    performedBy: userId,
    performedByName: actorName,
    targetId: params.userId,
    targetType: 'user',
    metadata: { email: target.email, employeeName: targetFullName },
    orgId: effectiveOrgId,
  })

  return NextResponse.json({ success: true })
}
