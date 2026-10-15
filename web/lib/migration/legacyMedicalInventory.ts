/**
 * READ-ONLY inventory of leave medical documents that predate the private `leave_medical` contract (they are plain, publicly deliverable
 * Cloudinary URLs). It never writes, never prints a URL or file name (records are identified by leave id, a short SHA-256 fingerprint and a class),
 * and the optional public-reachability probe (HEAD only) is off unless asked for. See docs/LEGACY_MEDICAL_MIGRATION.md.
 */
import crypto from 'node:crypto'
import Leave from '@/models/Leave'
import ReceiptUpload from '@/models/ReceiptUpload'
import { ALLOWED_FORMATS, parseReceiptRef } from '@/lib/uploads/attachmentStorage'

export type DocClass = 'private_ref' | 'legacy_public_url' | 'legacy_authenticated_url' | 'external_url' | 'proxy_path' | 'unknown'
export interface InventoryItem {
  leaveId: string; orgId: string; index: number; cls: DocClass; fingerprint: string; ext: string | null; extSupported: boolean
  inOrgFolder: boolean | null            // legacy URL only: does the path sit in THIS organisation's document/receipt folder?
  manifest: 'ok' | 'missing' | 'mismatch' | null   // private refs only
  url?: string                            // kept in memory for the optional probe, NEVER serialised into the report
}

const fp = (v: string) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 12)
const extOf = (v: string): string | null => { const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(v); return m ? m[1].toLowerCase() : null }

export function classify(value: string, orgId: string): Pick<InventoryItem, 'cls' | 'ext' | 'extSupported' | 'inOrgFolder'> {
  const ext = extOf(value); const extSupported = !!ext && (ALLOWED_FORMATS as readonly string[]).includes(ext)
  if (value.startsWith('cld:')) return { cls: parseReceiptRef(value, orgId) ? 'private_ref' : 'unknown', ext, extSupported, inOrgFolder: null }
  if (value.startsWith('/api/')) return { cls: 'proxy_path', ext, extSupported, inOrgFolder: null }
  let u: URL | null = null; try { u = new URL(value) } catch { /* not a URL */ }
  if (!u || !/^https?:$/.test(u.protocol)) return { cls: 'unknown', ext, extSupported, inOrgFolder: null }
  if (u.hostname.endsWith('res.cloudinary.com') || u.hostname.endsWith('cloudinary.com')) {
    const inOrg = u.pathname.includes(`/doppeldash/${orgId}/`)
    if (/\/authenticated\//.test(u.pathname)) return { cls: 'legacy_authenticated_url', ext, extSupported, inOrgFolder: inOrg }
    return { cls: 'legacy_public_url', ext, extSupported, inOrgFolder: inOrg }
  }
  return { cls: 'external_url', ext, extSupported, inOrgFolder: null }
}

export async function collectInventory(opts: { orgId?: string; limit?: number } = {}): Promise<{ items: InventoryItem[]; orphanManifestRows: number; deletingRows: number; leavesScanned: number }> {
  const filter: Record<string, unknown> = { 'medicalDocs.0': { $exists: true } }
  if (opts.orgId) filter.orgId = opts.orgId
  const items: InventoryItem[] = []; let leavesScanned = 0
  const refsByOrg = new Map<string, Set<string>>()
  for await (const l of Leave.find(filter).select('_id orgId medicalDocs').lean().cursor()) {
    leavesScanned++
    if (opts.limit && leavesScanned > opts.limit) break
    const orgId = String(l.orgId); const id = String(l._id)
    const docs: string[] = l.medicalDocs || []
    for (let index = 0; index < docs.length; index++) {
      const v = docs[index]
      const c = classify(String(v), orgId)
      let manifest: InventoryItem['manifest'] = null
      if (c.cls === 'private_ref') {
        const parsed = parseReceiptRef(String(v), orgId)!
        const row = await ReceiptUpload.findOne({ orgId, publicId: parsed.publicId }).select('purpose claimedBy state').lean()
        manifest = !row ? 'missing' : (row.purpose === 'leave_medical' && row.claimedBy === id && row.state === 'attached') ? 'ok' : 'mismatch'
        if (!refsByOrg.has(orgId)) refsByOrg.set(orgId, new Set()); refsByOrg.get(orgId)!.add(parsed.publicId)
      }
      items.push({ leaveId: id, orgId, index, cls: c.cls, fingerprint: fp(String(v)), ext: c.ext, extSupported: c.extSupported, inOrgFolder: c.inOrgFolder, manifest, url: /^https?:/.test(String(v)) ? String(v) : undefined })
    }
  }
  // leave_medical manifest rows that no leave references (abandoned uploads or damage) — counted, never touched
  let orphanManifestRows = 0, deletingRows = 0
  for await (const r of ReceiptUpload.find({ purpose: 'leave_medical', ...(opts.orgId ? { orgId: opts.orgId } : {}) }).select('orgId publicId state claimedBy').lean().cursor()) {
    if (r.state === 'deleting') deletingRows++
    if (!refsByOrg.get(String(r.orgId))?.has(String(r.publicId))) orphanManifestRows++
  }
  return { items, orphanManifestRows, deletingRows, leavesScanned }
}

export async function probePublic(items: InventoryItem[], fetchImpl: typeof fetch = fetch, concurrency = 4): Promise<Record<string, number>> {
  const out: Record<string, number> = {}; const queue = items.filter(i => i.cls === 'legacy_public_url' && i.url && /^https:\/\/res\.cloudinary\.com\//.test(i.url))
  const bump = (k: string) => { out[k] = (out[k] || 0) + 1 }
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let it = queue.pop(); it; it = queue.pop()) {
      try { const r = await fetchImpl(it.url!, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) }); bump(r.status === 200 ? 'publicly_reachable_200' : `status_${r.status}`) }
      catch { bump('probe_error') }
    }
  }))
  return out
}

export function buildReport(inv: Awaited<ReturnType<typeof collectInventory>>, meta: { db: string; probe?: Record<string, number> | null }) {
  const by = <K extends string>(f: (i: InventoryItem) => K) => inv.items.reduce<Record<string, number>>((a, i) => { const k = f(i); a[k] = (a[k] || 0) + 1; return a }, {})
  const dupes = new Map<string, InventoryItem[]>(); for (const i of inv.items) { const a = dupes.get(i.fingerprint) || []; a.push(i); dupes.set(i.fingerprint, a) }
  const duplicates: { fingerprint: string; count: number; orgs: number; leaves: string[] }[] = []
  dupes.forEach((a, fingerprint) => { if (a.length > 1) duplicates.push({ fingerprint, count: a.length, orgs: Array.from(new Set(a.map(x => x.orgId))).length, leaves: a.slice(0, 5).map(x => x.leaveId) }) })
  const legacy = inv.items.filter(i => i.cls === 'legacy_public_url')
  const eligible = legacy.filter(i => i.extSupported && i.inOrgFolder === true)
  const perOrg: Record<string, { documents: number; legacyPublic: number; privateRefs: number }> = {}
  for (const i of inv.items) { const o = perOrg[i.orgId] ||= { documents: 0, legacyPublic: 0, privateRefs: 0 }; o.documents++; if (i.cls === 'legacy_public_url') o.legacyPublic++; if (i.cls === 'private_ref') o.privateRefs++ }
  return {
    tool: 'legacy-medical-inventory/1', readOnly: true, generatedAt: new Date().toISOString(), database: meta.db,
    totals: { leavesScanned: inv.leavesScanned, documents: inv.items.length, byClass: by(i => i.cls), byExtension: by(i => i.ext ?? 'none'), unsupportedExtension: inv.items.filter(i => i.cls !== 'private_ref' && !i.extSupported).length },
    legacyPublic: { count: legacy.length, eligibleForMigration: eligible.length, notInOrgFolder: legacy.filter(i => i.inOrgFolder === false).length, unsupportedExtension: legacy.filter(i => !i.extSupported).length, publicReachability: meta.probe ?? 'not probed' },
    privateRefs: { manifest: by(i => i.cls === 'private_ref' ? (i.manifest ?? 'n/a') : 'skip') , orphanManifestRows: inv.orphanManifestRows, rowsBeingDeleted: inv.deletingRows },
    duplicates: duplicates.slice(0, 50), perOrganisation: perOrg,
    // identifiers only (no URLs / file names): enough to find the record
    findings: inv.items.filter(i => i.cls !== 'private_ref' || i.manifest !== 'ok').slice(0, 200).map(i => ({ leaveId: i.leaveId, orgId: i.orgId, index: i.index, class: i.cls, fingerprint: i.fingerprint, extension: i.ext, manifest: i.manifest, inOrgFolder: i.inOrgFolder })),
  }
}

/** Per-record migration PLAN (no execution): what the future apply step would do, one entry per eligible document. */
export function buildPlan(inv: Awaited<ReturnType<typeof collectInventory>>) {
  return inv.items.filter(i => i.cls === 'legacy_public_url').map(i => ({
    leaveId: i.leaveId, orgId: i.orgId, index: i.index, fingerprint: i.fingerprint,
    action: i.extSupported && i.inOrgFolder === true ? 'copy_to_private_then_rewrite_ref' : 'manual_review',
    reason: !i.extSupported ? 'unsupported_extension' : i.inOrgFolder !== true ? 'asset_outside_organisation_folder' : null,
  }))
}
