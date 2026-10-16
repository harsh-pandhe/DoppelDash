import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import { ensureDoppelmayrBrand } from '@/lib/provisioning/doppelmayrBrand'

async function POST_handler(req: NextRequest) {
  const required = process.env.DEV_SEED_SECRET
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
    return NextResponse.json({ error: 'Destructive seed is disabled in production' }, { status: 403 })
  }
  if (!required) {
    return NextResponse.json({ error: 'DEV_SEED_SECRET must be configured to run migrate' }, { status: 403 })
  }
  const provided = req.headers.get('x-seed-secret')   // header only: a query string would be written to access logs
  if (provided !== required) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  // Phase 0 — Multi-tenant orgId backfill to 'org_doppelmayr'
  const tenantCollections = [
    'users',
    'employees',
    'leaves',
    'leavebalances',
    'expenses',
    'travelrequests',
    'contacts',
    'scannedcards',
    'campaignlogs',
    'announcements',
    'inboxmessages',
    'maildrafts',
    'useremailconfigs',
    'outlooktokens',
    'syncstates',
    'passkeycredentials',
    'auditlogs',
    'shareddashboards',
    'publicholidays',
    'orgsettings',
  ]

  for (const coll of tenantCollections) {
    try {
      const r = await db.collection(coll).updateMany(
        { $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }] },
        { $set: { orgId: 'org_doppelmayr' } }
      )
      result[`org_${coll}`] = r.modifiedCount
    } catch {
      result[`org_${coll}`] = 0
    }
  }

  // Outbound-mail brand for the Doppelmayr tenant: stored configuration, idempotent, never overwrites admin edits.
  const brand = await ensureDoppelmayrBrand()
  result.doppelmayrBrandFieldsWritten = brand.changed.length

  // sanity: current role distribution
  const roles = await db.collection('users').aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray()

  return NextResponse.json({ success: true, migrated: result, rolesNow: roles })
}

export const POST = dbGuard(POST_handler)
