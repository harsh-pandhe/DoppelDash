/**
 * DoppelDash — Doppelmayr India outbound-mail brand: DATA PROVISIONING.
 *
 * RUN BOOK: docs/DOPPELMAYR_BRAND_PROVISIONING.md (production uses scripts/provision-doppelmayr-brand.js).
 *
 * Doppelmayr is an ordinary tenant. Its e-mails look Doppelmayr-branded because
 * its stored organisation settings say so (see lib/mail/brand.ts) — never
 * because runtime code recognises it. This module only WRITES that stored
 * configuration, once, idempotently, as part of data setup (dev seed, the
 * secret-gated /api/dev/migrate step and the operator script scripts/provision-doppelmayr-brand.js). Nothing at request time imports it.
 *
 * Guarantees:
 *   - no-op when the organisation does not exist (never creates an organisation)
 *   - never touches Organization (plan / lifetimeGrant / webEnabled / androidEnabled are untouched)
 *   - never overwrites a value an administrator already chose: it fills only a
 *     missing brand name and a missing brand colour. The legal company name
 *     (OrgSettings.companyName) is left exactly as stored.
 *   - safe to run any number of times
 */
import { connectDB } from '@/lib/db'
import Organization from '@/models/Organization'
import OrgSettings from '@/models/OrgSettings'

export const DOPPELMAYR_PROVISIONING = {
  orgId: 'org_doppelmayr',
  brandName: 'Doppelmayr India',
  brandColor: '#0057A8',
} as const

export interface BrandProvisionResult {
  orgFound: boolean
  settingsCreated: boolean
  /** Fields written by this run — or, with `dryRun`, the fields it WOULD write (empty when already provisioned). */
  changed: Array<'brandName' | 'brandColor'>
  dryRun: boolean
}

export async function ensureDoppelmayrBrand(
  target: { orgId: string; brandName: string; brandColor: string } = DOPPELMAYR_PROVISIONING,
  opts: { dryRun?: boolean } = {},
): Promise<BrandProvisionResult> {
  await connectDB()
  const { orgId, brandName, brandColor } = target
  const dryRun = opts.dryRun === true
  const result: BrandProvisionResult = { orgFound: false, settingsCreated: false, changed: [], dryRun }

  const org = await Organization.findOne({ orgId }).select('name').lean<{ name?: string } | null>()
  if (!org) return result
  result.orgFound = true

  // Read first: an upsert would refresh `updatedAt` even when nothing changes.
  const existing = await OrgSettings.findOne({ orgId }).select('brandName brandColor').lean<{ brandName?: string; brandColor?: string } | null>()
  if (!existing) {
    result.settingsCreated = true
    result.changed.push('brandName', 'brandColor')
    if (dryRun) return result
    try {
      // A brand-new settings row keeps the organisation's own name as its legal company name.
      await OrgSettings.create({ orgId, name: org.name || brandName, companyName: org.name || brandName, brandName, brandColor })
      return result
    } catch (err) {
      // A concurrent run created it first (unique orgId) — fall through and fill gaps only.
      if ((err as { code?: number }).code !== 11000) throw err
      result.settingsCreated = false
      result.changed = []
    }
  }

  const current = existing ?? (await OrgSettings.findOne({ orgId }).select('brandName brandColor').lean<{ brandName?: string; brandColor?: string } | null>())
  const needsColor = current?.brandColor === undefined
  const needsName = !current?.brandName
  if (needsColor) result.changed.push('brandColor')
  if (needsName) result.changed.push('brandName')
  if (dryRun) return result

  if (needsColor) await OrgSettings.updateOne({ orgId, brandColor: { $exists: false } }, { $set: { brandColor } })
  if (needsName) await OrgSettings.updateOne({ orgId, $or: [{ brandName: { $exists: false } }, { brandName: '' }] }, { $set: { brandName } })
  return result
}
