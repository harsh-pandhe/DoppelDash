import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import { getUser } from '@/lib/auth'
import Organization from '@/models/Organization'
import User from '@/models/User'
import { writeAudit } from '@/lib/audit'

/**
 * Owner decision D-02.7 (approved 2026-10-25): an organisation owner who wants to leave while members remain must first transfer ownership.
 *
 *   POST /api/org/transfer-ownership   { "newOwnerId": "<user id>" }
 *
 *  - Only the CURRENT owner of the caller's organisation may call it (403 otherwise). The tenant comes from the verified session, never from the body.
 *  - The new owner must be another ACTIVE, non-banned ADMIN of the same organisation (400 otherwise): ownership never goes to someone who
 *    cannot administer the tenant, and never across tenants (a foreign / unknown id is answered exactly like an unknown one: 404).
 *  - The swap is a single conditional update (`ownerId` must still be the caller): two concurrent transfers give one success and one 409.
 *  - Audited as `org.ownership_transferred` with user ids only (no e-mail addresses).
 */
async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await readJsonObject(req)
  if (!body || typeof (body as { newOwnerId?: unknown }).newOwnerId !== 'string' || !mongoose.isValidObjectId((body as { newOwnerId: string }).newOwnerId)
      || Object.keys(body).some(k => k !== 'newOwnerId')) {
    return NextResponse.json({ error: 'Invalid request', fields: ['newOwnerId'] }, { status: 400 })
  }
  const newOwnerId = (body as { newOwnerId: string }).newOwnerId

  await connectDB()
  const org = await Organization.findOne({ orgId }).select('ownerId').lean<{ ownerId?: string } | null>()
  if (!org || org.ownerId !== userId) return NextResponse.json({ error: 'Only the organisation owner can transfer ownership.', code: 'not_owner' }, { status: 403 })
  if (newOwnerId === userId) return NextResponse.json({ error: 'You already own this organisation.', fields: ['newOwnerId'], code: 'already_owner' }, { status: 400 })

  const target = await User.findOne({ _id: newOwnerId, orgId }).select('role isActive isBanned').lean<{ role: string; isActive: boolean; isBanned: boolean } | null>()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!target.isActive || target.isBanned) return NextResponse.json({ error: 'The new owner must be an active member.', fields: ['newOwnerId'], code: 'new_owner_inactive' }, { status: 400 })
  if (target.role !== 'admin') return NextResponse.json({ error: 'The new owner must be an admin of this organisation.', fields: ['newOwnerId'], code: 'new_owner_must_be_admin' }, { status: 400 })

  const swapped = await Organization.findOneAndUpdate({ orgId, ownerId: userId }, { $set: { ownerId: newOwnerId } }, { returnDocument: 'after' })
  if (!swapped) return NextResponse.json({ error: 'Ownership changed while you were transferring it. Refresh and try again.', code: 'ownership_conflict' }, { status: 409 })

  await writeAudit({
    action: 'org.ownership_transferred', performedBy: userId, performedByName: user.fullName || user.firstName || 'Owner',
    targetId: orgId, targetType: 'organization', metadata: { from: userId, to: newOwnerId }, orgId,
  })
  return NextResponse.json({ success: true, ownerId: newOwnerId })
}

export const POST = dbGuard(POST_handler)
