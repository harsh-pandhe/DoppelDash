/**
 * DoppelDash — Doppelmayr India lifetime entitlement: DATA PROVISIONING (P0-03).
 *
 * Doppelmayr is an ordinary tenant whose STORED entitlement says: Premium for life, Web + Android enabled. Runtime code never recognises it
 * by name, slug or domain (see lib/entitlements/entitlementService.ts and lib/auth/webAccess.ts) — this module only WRITES those stored
 * fields, deliberately and auditably, from an operator script (scripts/provision-doppelmayr-entitlement.js). Nothing at request time imports it.
 *
 * Guarantees: never creates an organisation · writes exactly plan / entitlementSource / lifetimeGrant / webEnabled / androidEnabled ·
 * a dry run writes nothing · re-running when already provisioned writes nothing (no audit, no `updatedAt` churn) · every real change
 * writes one audit entry (who, when, why, before → after) in the SAME organisation.
 */
import { connectDB } from '@/lib/db'
import Organization from '@/models/Organization'
import AuditLog from '@/models/AuditLog'

export const DOPPELMAYR_ENTITLEMENT = {
  orgId: 'org_doppelmayr',
  fields: { plan: 'premium', entitlementSource: 'lifetime_grant', lifetimeGrant: true, webEnabled: true, androidEnabled: true },
} as const

type Fields = typeof DOPPELMAYR_ENTITLEMENT.fields
export interface EntitlementProvisionResult {
  orgFound: boolean
  dryRun: boolean
  before: Partial<Record<keyof Fields, unknown>>
  /** Fields that differ from the target (written when applying; reported only on a dry run). */
  changed: Array<keyof Fields>
  audited: boolean
}

export async function ensureLifetimeEntitlement(
  target: { orgId: string; fields?: Fields } = DOPPELMAYR_ENTITLEMENT,
  opts: { dryRun?: boolean; actor?: string; reason?: string } = {},
): Promise<EntitlementProvisionResult> {
  await connectDB()
  const fields = target.fields ?? DOPPELMAYR_ENTITLEMENT.fields
  const dryRun = opts.dryRun !== false
  const result: EntitlementProvisionResult = { orgFound: false, dryRun, before: {}, changed: [], audited: false }

  const org = await Organization.findOne({ orgId: target.orgId }).lean<Record<string, unknown> | null>()
  if (!org) return result
  result.orgFound = true
  for (const k of Object.keys(fields) as Array<keyof Fields>) result.before[k] = org[k]
  result.changed = (Object.keys(fields) as Array<keyof Fields>).filter(k => org[k] !== fields[k])
  if (dryRun || result.changed.length === 0) return result

  if (!opts.actor?.trim() || !opts.reason?.trim()) throw new Error('an actor and a reason are required to apply')
  const set = Object.fromEntries(result.changed.map(k => [k, fields[k]]))
  // Conditional on the organisation still holding the values we read: a concurrent run/admin change makes this a no-op that is re-evaluated next run.
  const res = await Organization.updateOne({ orgId: target.orgId, ...Object.fromEntries(result.changed.map(k => [k, org[k] === undefined ? { $exists: false } : org[k]])) }, { $set: set })
  if (res.modifiedCount === 0) throw new Error('the organisation changed while provisioning; nothing was written — re-run')
  await AuditLog.create({
    orgId: target.orgId, action: 'organization.entitlement_provisioned', performedBy: `operator:${opts.actor.trim().slice(0, 80)}`, performedByName: opts.actor.trim().slice(0, 80),
    targetId: target.orgId, targetType: 'organization',
    metadata: { reason: opts.reason.trim().slice(0, 300), changed: result.changed, before: result.before, after: set, at: new Date().toISOString() },
  })
  result.audited = true
  return result
}
