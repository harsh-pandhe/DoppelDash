import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'

/**
 * Reset the org back to a clean slate: keep ONLY admin account(s) and real
 * reference data (public holidays + org settings). Wipes every fake/seeded
 * and transactional record so a fresh org can be built by hand.
 *
 * Secret-gated exactly like /api/dev/seed — in production it stays disabled
 * unless ALLOW_DEV_SEED=true, so a leaked DEV_SEED_SECRET alone can't erase data.
 *
 *   POST /api/dev/reset-to-admin?secret=<DEV_SEED_SECRET>   (header x-seed-secret also accepted)
 *
 * KEEPS:   users(role=admin) + their Employee profile / LeaveBalance / passkeys /
 *          email config / outlook token, all PublicHolidays, all OrgSettings.
 * WIPES:   every non-admin user & profile, all leaves / expenses / travel /
 *          contacts / scanned cards / announcements / audit logs / inbox /
 *          campaign logs / mail drafts / sync state.
 */
export async function POST(req: NextRequest) {
  const required = process.env.DEV_SEED_SECRET
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
    return NextResponse.json({ error: 'Destructive reset is disabled in production' }, { status: 403 })
  }
  if (!required) {
    return NextResponse.json({ error: 'DEV_SEED_SECRET must be configured to run reset' }, { status: 403 })
  }
  const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-seed-secret')
  if (provided !== required) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const db = mongoose.connection.db
  if (!db) return NextResponse.json({ error: 'No DB connection' }, { status: 500 })

  // Identify the admin(s) to preserve. Refuse to run if there is none —
  // wiping into a zero-admin state would lock everyone out.
  const admins = await db.collection('users').find({ role: 'admin' }, { projection: { _id: 1, email: 1 } }).toArray()
  if (admins.length === 0) {
    return NextResponse.json({ error: 'No admin user found — refusing to wipe into a no-login state' }, { status: 400 })
  }
  const adminIds = admins.map(a => a._id.toString())

  const deleted: Record<string, number> = {}

  // Non-admin accounts + their per-user records
  deleted.users          = (await db.collection('users').deleteMany({ role: { $ne: 'admin' } })).deletedCount
  deleted.employees      = (await db.collection('employees').deleteMany({ clerkUserId: { $nin: adminIds } })).deletedCount
  deleted.leaveBalances  = (await db.collection('leavebalances').deleteMany({ userId: { $nin: adminIds } })).deletedCount
  deleted.passkeys       = (await db.collection('passkeycredentials').deleteMany({ userId: { $nin: adminIds } })).deletedCount
  deleted.emailConfigs   = (await db.collection('useremailconfigs').deleteMany({ userId: { $nin: adminIds } })).deletedCount
  deleted.outlookTokens  = (await db.collection('outlooktokens').deleteMany({ userId: { $nin: adminIds } })).deletedCount

  // Fully-wiped transactional / content collections
  for (const col of [
    'leaves', 'expenses', 'travelrequests', 'contacts', 'scannedcards',
    'announcements', 'auditlogs', 'inboxmessages', 'campaignlogs',
    'maildrafts', 'syncstates',
  ]) {
    deleted[col] = (await db.collection(col).deleteMany({})).deletedCount
  }

  const kept = {
    admins:        admins.map(a => a.email),
    publicHolidays: await db.collection('publicholidays').countDocuments(),
    orgSettings:    await db.collection('orgsettings').countDocuments(),
  }

  return NextResponse.json({ success: true, kept, deleted })
}
