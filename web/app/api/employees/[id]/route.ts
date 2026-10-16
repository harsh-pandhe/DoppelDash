import mongoose from 'mongoose'
import { dbGuard } from '@/lib/http/dbGuard'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import User from '@/models/User'
import { getUser } from '@/lib/auth'
import { REVIEWER_EDITABLE, pickAllowed, badScalars } from '@/lib/employees/editable'

/**
 * Employee record by user id / employee id.
 *  GET   the owner, or a manager/admin of the SAME organisation. A colleague gets 403 (the directory — `/api/employees/directory` — is the
 *        colleague-safe view). The encrypted bank blob is never returned here (the owner reads it, decrypted, through `/api/employees/me`);
 *        medical details only to the owner and admins.
 *  PATCH manager/admin: work assignment only (see REVIEWER_EDITABLE). Everything else is refused with the field names.
 */
async function GET_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const emp = await Employee.findOne({ orgId, $or: [{ clerkUserId: params.id }, { employeeId: params.id }] }).lean()
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const role = user?.role || 'employee'
  const isOwner = emp.clerkUserId === userId
  if (!isOwner && role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { bankDetails: _bank, medicalDetails, ...rest } = emp as typeof emp & { bankDetails?: unknown }
  void _bank
  return NextResponse.json(isOwner || role === 'admin' ? { ...rest, medicalDetails } : rest)
}

async function PATCH_handler(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const target = await Employee.exists({ orgId, $or: [{ clerkUserId: params.id }, { employeeId: params.id }] })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = pickAllowed(await req.json().catch(() => null), REVIEWER_EDITABLE)
  if (!parsed) return NextResponse.json({ error: 'Invalid request', fields: ['body'] }, { status: 400 })
  if (parsed.rejected.length || parsed.bad.length) return NextResponse.json({ error: 'These fields cannot be changed here', fields: [...parsed.rejected, ...parsed.bad] }, { status: 400 })
  const invalid = badScalars(parsed.data)
  if (invalid.length) return NextResponse.json({ error: 'Invalid request', fields: invalid }, { status: 400 })
  if (!Object.keys(parsed.data).length) return NextResponse.json({ error: 'Nothing to update', fields: [] }, { status: 400 })

  // A reporting manager must be a manager/admin of THIS organisation.
  const rm = parsed.data.reportingManagerId
  if (typeof rm === 'string' && rm) {
    const ok = mongoose.isValidObjectId(rm) && (await User.exists({ _id: rm, orgId, role: { $in: ['manager', 'admin'] }, isActive: true }))
    if (!ok) return NextResponse.json({ error: 'Invalid request', fields: ['reportingManagerId'] }, { status: 400 })
  }

  try {
    const emp = await Employee.findOneAndUpdate({ orgId, $or: [{ clerkUserId: params.id }, { employeeId: params.id }] }, { $set: parsed.data }, { returnDocument: 'after', runValidators: true }).lean()
    if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { bankDetails: _b, ...out } = emp as typeof emp & { bankDetails?: unknown }
    void _b
    return NextResponse.json(out)
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    throw err
  }
}

export const GET = dbGuard(GET_handler)
export const PATCH = dbGuard(PATCH_handler)
