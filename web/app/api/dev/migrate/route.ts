import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'

/**
 * Non-destructive, idempotent data migration for Phase 10A / 11E / 11F.
 * Secret-gated like /api/dev/seed. Runs raw updateMany against the connected DB
 * so it works on prod without local Atlas creds.
 *
 *   POST /api/dev/migrate?secret=<DEV_SEED_SECRET>
 *
 * Safe to run multiple times (no-ops once applied).
 */
export async function POST(req: NextRequest) {
  const required = process.env.DEV_SEED_SECRET
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
    return NextResponse.json({ error: 'Destructive seed is disabled in production' }, { status: 403 })
  }
  if (process.env.NODE_ENV === 'production' && !required) {
    return NextResponse.json({ error: 'Disabled in production (no DEV_SEED_SECRET)' }, { status: 403 })
  }
  if (required) {
    const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-seed-secret')
    if (provided !== required) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await connectDB()
  const db = mongoose.connection.db
  if (!db) return NextResponse.json({ error: 'No DB connection' }, { status: 500 })

  const result: Record<string, number> = {}

  // 10A — roles + mail access
  result.roleBossToAdmin   = (await db.collection('users').updateMany({ role: 'boss' }, { $set: { role: 'admin' } })).modifiedCount
  result.mailAccessInit     = (await db.collection('users').updateMany({ mailAccess: { $exists: false } }, { $set: { mailAccess: false } })).modifiedCount
  result.mailAccessAdminMgr = (await db.collection('users').updateMany({ role: { $in: ['admin', 'manager'] } }, { $set: { mailAccess: true } })).modifiedCount

  // 11E / 11F — status + note field renames
  result.expenseStatus = (await db.collection('expenses').updateMany({ status: 'pending_boss' }, { $set: { status: 'pending_admin' } })).modifiedCount
  result.travelStatus  = (await db.collection('travelrequests').updateMany({ status: 'pending_boss' }, { $set: { status: 'pending_admin' } })).modifiedCount
  result.expenseNote   = (await db.collection('expenses').updateMany({ bossNote: { $exists: true } }, { $rename: { bossNote: 'adminNote' } })).modifiedCount
  result.travelNote    = (await db.collection('travelrequests').updateMany({ bossNote: { $exists: true } }, { $rename: { bossNote: 'adminNote' } })).modifiedCount

  // sanity: current role distribution
  const roles = await db.collection('users').aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray()

  return NextResponse.json({ success: true, migrated: result, rolesNow: roles })
}
