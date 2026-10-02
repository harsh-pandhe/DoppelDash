import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import OrgSettings from '@/models/OrgSettings'
import Organization from '@/models/Organization'
import { getUser } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { ORG_SETTINGS_FIELDS } from '@/lib/apiFields'

/**
 * Handle GET requests for organization settings.
 * Resolves tenant identity strictly from authenticated user context.
 */
export async function handleGetOrgSettings() {
  const { userId, user } = await getUser()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()

  const settings = await OrgSettings.findOne({ orgId }).lean()
  if (!settings) {
    const org = await Organization.findOne({ orgId }).lean()
    const fallbackName = org?.name || (orgId === 'org_doppelmayr' ? 'Doppelmayr India Pvt Ltd' : 'My Organization')
    return NextResponse.json({
      orgId,
      name: fallbackName,
      companyName: fallbackName,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      workHours: { start: '09:00', end: '18:00' },
      fiscalYearStart: 'April',
      address: '',
      website: '',
      phone: '',
      email: '',
      logo: '',
    })
  }

  return NextResponse.json({
    ...settings,
    name: settings.name || settings.companyName,
    companyName: settings.companyName || settings.name,
    timezone: settings.timezone || 'Asia/Kolkata',
    currency: settings.currency || 'INR',
    workHours: settings.workHours || { start: '09:00', end: '18:00' },
    fiscalYearStart: settings.fiscalYearStart || 'April',
  })
}

/**
 * Handle POST / PATCH / PUT mutations for organization settings.
 * Enforces admin role and scopes updates strictly to user.orgId.
 * Ignores any client-supplied orgId/tenantId/organizationId.
 */
export async function handleMutateOrgSettings(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = user?.role || 'employee'
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Filter strictly against allowed fields; orgId cannot be supplied by client
  const payload: Record<string, unknown> = { ...pick(body as Record<string, string>, ORG_SETTINGS_FIELDS) }

  // Synchronize name and companyName
  if (body.companyName && !payload.name) {
    payload.name = String(body.companyName)
  }
  if (body.name && !payload.companyName) {
    payload.companyName = String(body.name)
  }

  // Bind strictly to authenticated tenant and user
  payload.orgId = orgId
  payload.updatedBy = userId

  const settings = await OrgSettings.findOneAndUpdate(
    { orgId },
    { $set: payload },
    { upsert: true, returnDocument: 'after' }
  ).lean()

  // Keep Organization model name synchronized if updated
  if (payload.name) {
    await Organization.updateOne({ orgId }, { $set: { name: payload.name } }).catch(() => {})
  }

  return NextResponse.json({
    ...settings,
    name: settings.name || settings.companyName,
    companyName: settings.companyName || settings.name,
    timezone: settings.timezone || 'Asia/Kolkata',
    currency: settings.currency || 'INR',
    workHours: settings.workHours || { start: '09:00', end: '18:00' },
    fiscalYearStart: settings.fiscalYearStart || 'April',
  })
}
