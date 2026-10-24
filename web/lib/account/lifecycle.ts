/**
 * Account lifecycle — owner decisions D-02.8, D-03.3 and D-03.4 (approved 2026-10-25).
 *
 *  D-02.8  Deletion is a 14-day SOFT delete: the account is deactivated (sign-in/refresh/session paths already refuse inactive users),
 *          credentials/sessions are revoked, and it can be restored by signing in with the password during the grace window.
 *          The irreversible purge runs later from the retention job, never inline.
 *  D-03.4  A sole-owner disband does NOT purge financial or HR records. The tenant is deactivated; non-financial tenant data is purged
 *          after the grace window; claims/leave/travel (and the private receipt files that belong to them) are kept until their
 *          retention period ends. Members who leave are pseudonymised ("Former member") on every retained record.
 *  D-03.3  Retention (engineering defaults — an accountant/lawyer must confirm): claims + receipts 8 y from payment, leave 3 y,
 *          other HR (travel) 2 y, audit 8 y. The purge job is dry-run by default, audited, and uses provider-confirmed file deletion.
 *
 * Everything here is idempotent. Nothing runs unless the retention cron route is called (NOT scheduled by this repository).
 */
import User from '@/models/User'
import Organization from '@/models/Organization'
import Expense from '@/models/Expense'
import Leave from '@/models/Leave'
import TravelRequest from '@/models/TravelRequest'
import AuditLog from '@/models/AuditLog'
import RefreshToken from '@/models/RefreshToken'
import Subscription from '@/models/Subscription'
import ReceiptUpload from '@/models/ReceiptUpload'
import { orgDisbandSteps, personalSteps, purgeOrgBlobs, runDeletionSteps, type DeletionStep } from '@/lib/account/deletion'
import { destroyAttachments } from '@/lib/uploads/attachmentStorage'

export const DELETION_GRACE_DAYS = 14
export const FORMER_MEMBER = 'Former member'
/** Years. D-03.3 recommended defaults; confirm with the company accountant/legal counsel before relying on them. */
export const RETENTION = { claimsYears: 8, leaveYears: 3, travelYears: 2, auditYears: 8 } as const

const DAY = 86_400_000
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
export const addYears = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setUTCFullYear(x.getUTCFullYear() + n); return x }
export const graceEnd = (from: Date) => addDays(from, DELETION_GRACE_DAYS)

/** Marks the account for deletion: deactivates it, ends every session, records the schedule. A disband also deactivates the organisation. */
export async function scheduleDeletion(opts: { userId: string; orgId: string; disband: boolean; now?: Date }): Promise<{ restoreUntil: Date }> {
  const now = opts.now ?? new Date()
  const restoreUntil = graceEnd(now)
  await User.updateOne({ _id: opts.userId }, { $set: { isActive: false, deletionRequestedAt: now, deletionScheduledFor: restoreUntil }, $inc: { sessionVersion: 1 } })
  await RefreshToken.deleteMany({ userId: opts.userId })
  if (opts.disband) await Organization.updateOne({ orgId: opts.orgId }, { $set: { disbandRequestedAt: now, disbandScheduledFor: restoreUntil } })
  return { restoreUntil }
}

/** Cancels a pending deletion (only inside the grace window). Returns false when there is nothing to restore. */
export async function restoreDeletion(userId: string, now: Date = new Date()): Promise<boolean> {
  const user = await User.findOne({ _id: userId, deletionScheduledFor: { $gt: now } }).select('orgId').lean<{ orgId?: string } | null>()
  if (!user) return false
  const res = await User.updateOne({ _id: userId, deletionScheduledFor: { $gt: now } }, { $set: { isActive: true }, $unset: { deletionRequestedAt: '', deletionScheduledFor: '' }, $inc: { sessionVersion: 1 } })
  if (res.modifiedCount && user.orgId) await Organization.updateOne({ orgId: user.orgId, disbandedAt: { $exists: false } }, { $unset: { disbandRequestedAt: '', disbandScheduledFor: '' } })
  return res.modifiedCount > 0
}

/** Replaces the member's name on every record that is retained after they leave (the user id is kept so the audit trail stays intact). */
export async function pseudonymiseMember(userId: string, orgId: string): Promise<void> {
  const claimIds = (await Expense.find({ orgId, userId }).select('_id').lean()).map(e => String(e._id))
  await Promise.all([
    Expense.updateMany({ orgId, userId }, { $set: { userName: FORMER_MEMBER } }),
    Leave.updateMany({ orgId, userId }, { $set: { userName: FORMER_MEMBER } }),
    TravelRequest.updateMany({ orgId, userId }, { $set: { userName: FORMER_MEMBER } }),
    AuditLog.updateMany({ orgId, performedBy: userId }, { $set: { performedByName: FORMER_MEMBER }, $unset: { 'metadata.email': '' } }),
    claimIds.length ? AuditLog.updateMany({ orgId, targetId: { $in: claimIds } }, { $set: { 'metadata.employeeName': FORMER_MEMBER } }) : Promise.resolve(),
  ])
}

/** The disband plan WITHOUT financial/HR records: contacts, mail, tokens, announcements etc. Claims, leave, travel, subscriptions and their private files stay. */
export function nonFinancialDisbandSteps(orgId: string): DeletionStep[][] {
  const keep = new Set(['private_files', 'expenses', 'travel', 'leave', 'subscriptions', 'organisation'])   // leave BALANCES are not records; they go with the tenant
  return orgDisbandSteps(orgId).map(group => group.filter(s => !keep.has(s.name))).filter(g => g.length > 0)
}

export interface PurgeReport {
  apply: boolean
  deletionsDue: number; deletionsExecuted: number; deletionsFailed: number
  expiredClaims: number; expiredLeave: number; expiredTravel: number; expiredAudit: number; orgShellsRemoved: number
}

const retentionCutoff = (now: Date, years: number) => addYears(now, -years)

/** Executes due soft-deletes, then removes records whose retention period ended. Dry-run (apply=false) only counts. */
export async function runRetentionPurge(opts: { apply: boolean; now?: Date; batch?: number }): Promise<PurgeReport> {
  const now = opts.now ?? new Date(), batch = opts.batch ?? 100
  const report: PurgeReport = { apply: opts.apply, deletionsDue: 0, deletionsExecuted: 0, deletionsFailed: 0, expiredClaims: 0, expiredLeave: 0, expiredTravel: 0, expiredAudit: 0, orgShellsRemoved: 0 }

  // 1. due soft-deletes ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const due = await User.find({ deletionScheduledFor: { $lte: now } }).select('orgId').limit(batch).lean<{ _id: unknown; orgId: string }[]>()
  report.deletionsDue = due.length
  if (opts.apply) {
    for (const u of due) {
      const userId = String(u._id), orgId = u.orgId
      const org = await Organization.findOne({ orgId }).lean<{ ownerId?: string; disbandRequestedAt?: Date; lifetimeGrant?: boolean } | null>()
      const disband = Boolean(org?.disbandRequestedAt && org.ownerId === userId && !org.lifetimeGrant)
      await pseudonymiseMember(userId, orgId)
      const groups = [...(disband ? nonFinancialDisbandSteps(orgId) : []), ...personalSteps(userId, orgId)]
      const outcome = await runDeletionSteps(groups)
      if (!outcome.ok) { report.deletionsFailed++; await AuditLog.create({ orgId, performedBy: 'system', performedByName: 'System', targetId: userId, targetType: 'user', action: 'user.account_deletion_incomplete', metadata: { failed: outcome.failed, at: now } }).catch(() => undefined); continue }
      if (disband) {
        await Organization.updateOne({ orgId }, { $set: { disbandedAt: now, retentionHoldUntil: addYears(now, RETENTION.claimsYears) }, $unset: { ownerId: '' } })
        await AuditLog.create({ orgId, performedBy: 'system', performedByName: 'System', targetId: orgId, targetType: 'organization', action: 'organization.disbanded', metadata: { retentionHoldUntil: addYears(now, RETENTION.claimsYears), at: now } }).catch(() => undefined)
      }
      await AuditLog.create({ orgId, performedBy: 'system', performedByName: 'System', targetId: userId, targetType: 'user', action: 'user.account_deleted', metadata: { deletedAt: now, disbandedOrganisation: disband, gracePeriodDays: DELETION_GRACE_DAYS } }).catch(() => undefined)
      report.deletionsExecuted++
    }
  }

  // 2. retention expiry ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const claimCutoff = retentionCutoff(now, RETENTION.claimsYears)
  const claimFilter = { $or: [{ paidAt: { $lt: claimCutoff } }, { paidAt: { $exists: false }, createdAt: { $lt: claimCutoff } }, { paidAt: null, createdAt: { $lt: claimCutoff } }] }
  report.expiredClaims = await Expense.countDocuments(claimFilter)
  const leaveFilter = { endDate: { $lt: retentionCutoff(now, RETENTION.leaveYears) } }
  report.expiredLeave = await Leave.countDocuments(leaveFilter)
  const travelFilter = { createdAt: { $lt: retentionCutoff(now, RETENTION.travelYears) } }
  report.expiredTravel = await TravelRequest.countDocuments(travelFilter)
  const auditFilter = { createdAt: { $lt: retentionCutoff(now, RETENTION.auditYears) } }
  report.expiredAudit = await AuditLog.countDocuments(auditFilter)

  if (opts.apply) {
    const claims = await Expense.find(claimFilter).select('orgId receipts lineItems').limit(batch).lean<{ _id: unknown; orgId: string; receipts?: string[]; lineItems?: { receiptUrl?: string }[] }[]>()
    for (const c of claims) {
      const files = [...(c.receipts || []), ...((c.lineItems || []).map(l => l.receiptUrl).filter(Boolean) as string[])]
      if (files.length) await destroyAttachments(files, c.orgId).catch(() => undefined)
      await Expense.deleteOne({ _id: c._id as never })
    }
    await Leave.deleteMany(leaveFilter)
    await TravelRequest.deleteMany(travelFilter)
    await AuditLog.deleteMany(auditFilter)

    // 3. disbanded tenants whose retained records are all gone ───────────────────────────────────────────────────────────
    const shells = await Organization.find({ disbandedAt: { $exists: true } }).select('orgId').lean<{ orgId: string }[]>()
    for (const s of shells) {
      const left = (await Expense.exists({ orgId: s.orgId })) || (await Leave.exists({ orgId: s.orgId })) || (await TravelRequest.exists({ orgId: s.orgId }))
      if (left) continue
      try {
        await purgeOrgBlobs(s.orgId)
        await Subscription.deleteMany({ orgId: s.orgId }); await ReceiptUpload.deleteMany({ orgId: s.orgId })
        await Organization.deleteOne({ orgId: s.orgId }); report.orgShellsRemoved++
      } catch { /* provider outage: the shell stays and the next run retries */ }
    }
  }
  return report
}
