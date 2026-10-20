import mongoose from 'mongoose'
import { NextRequest, NextResponse } from 'next/server'
import { readJsonObject } from '@/lib/http/body'
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
  const { userId, orgId } = await getUser()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()

  const settings = await OrgSettings.findOne({ orgId }).lean()
  if (!settings) {
    const org = await Organization.findOne({ orgId }).lean()
    const fallbackName = org?.name || 'My Organization'
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

const SETTINGS_MAX: Record<string, number> = {
  name: 200, companyName: 200, timezone: 64, currency: 8, address: 1000,
  website: 300, phone: 50, email: 254, logo: 2000, fiscalYearStart: 20,
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Names of settings fields that are wrongly typed, oversized or malformed. */
export function invalidSettingsFields(body: Record<string, unknown>): string[] {
  const bad: string[] = []
  for (const [k, max] of Object.entries(SETTINGS_MAX)) {
    const v = body[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || v.length > max) bad.push(k)
  }
  if (typeof body.email === 'string' && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) bad.push('email')
  const wh = body.workHours
  if (wh !== undefined) {
    const o = wh as Record<string, unknown>
    if (!wh || typeof wh !== 'object' || Array.isArray(wh) || typeof o.start !== 'string' || typeof o.end !== 'string' || !HHMM.test(o.start) || !HHMM.test(o.end)) bad.push('workHours')
  }
  return bad
}

/**
 * Handle POST / PATCH / PUT mutations for organization settings.
 * Enforces admin role and scopes updates strictly to user.orgId.
 * Ignores any client-supplied orgId/tenantId/organizationId.
 */
export async function handleMutateOrgSettings(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = user?.role || 'employee'
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await connectDB()

  const body = await readJsonObject(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const picked = pick(body as Record<string, string>, ORG_SETTINGS_FIELDS) as Record<string, unknown>
  const badFields = invalidSettingsFields(picked)
  if (badFields.length) return NextResponse.json({ error: 'Invalid settings', fields: badFields }, { status: 400 })

  // Filter strictly against allowed fields; orgId cannot be supplied by client
  const payload: Record<string, unknown> = { ...picked }
  if (payload.workHours) {
    const w = payload.workHours as { start: string; end: string }
    payload.workHours = { start: w.start, end: w.end }
  }

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

  let settings
  try {
    settings = await OrgSettings.findOneAndUpdate(
      { orgId },
      { $set: payload },
      { upsert: true, returnDocument: 'after', runValidators: true }
    ).lean()
  } catch (e) {
    if (e instanceof mongoose.Error.ValidationError || e instanceof mongoose.Error.CastError) {
      return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })
    }
    throw e
  }

  // First-run setup finished (admin-only route, tenant from the session): clear the
  // server-side flag that /api/auth/me reports as onboarding.orgSetupRequired.
  if (body.completeSetup === true) {
    await Organization.updateOne({ orgId }, { $set: { setupRequired: false } })
  }

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
