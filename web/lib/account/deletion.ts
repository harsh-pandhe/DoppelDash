/**
 * Account / organisation deletion orchestration (P0-02).
 *
 * MongoDB here is a standalone server (no multi-document transactions), so completeness comes from an ORDERED, IDEMPOTENT, RETRYABLE plan:
 *   1. private blobs first (the ReceiptUpload manifest is the only record of what exists — its rows stay until the provider confirmed deletion),
 *   2. tenant / personal data,
 *   3. the organisation and the user record LAST — so while anything is still pending the caller can still authenticate and simply retry.
 * Every step is safe to repeat. The route reports success ONLY if every step succeeded; otherwise `deletion_incomplete` (HTTP 500, retry).
 *
 * WHICH data is deleted vs retained is a product/legal decision (checklist D-02): see docs/ACCOUNT_DELETION_POLICY.md. This module encodes the
 * recommended default and keeps the policy in ONE place (`orgDisbandSteps` / `personalSteps`).
 */
import type { Model } from 'mongoose'
import Organization from '@/models/Organization'
import OrgSettings from '@/models/OrgSettings'
import Subscription from '@/models/Subscription'
import Contact from '@/models/Contact'
import ScannedCard from '@/models/ScannedCard'
import CampaignLog from '@/models/CampaignLog'
import Announcement from '@/models/Announcement'
import PublicHoliday from '@/models/PublicHoliday'
import SharedDashboard from '@/models/SharedDashboard'
import Invitation from '@/models/Invitation'
import LeaveBalance from '@/models/LeaveBalance'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import ReceiptUpload from '@/models/ReceiptUpload'
import InboxMessage from '@/models/InboxMessage'
import OrgMailConfig from '@/models/OrgMailConfig'
import OutlookToken from '@/models/OutlookToken'
import SyncState from '@/models/SyncState'
import UsageCounter from '@/models/UsageCounter'
import User from '@/models/User'
import Employee from '@/models/Employee'
import RefreshToken from '@/models/RefreshToken'
import PasswordResetToken from '@/models/PasswordResetToken'
import PasskeyCredential from '@/models/PasskeyCredential'
import UserEmailConfig from '@/models/UserEmailConfig'
import MailDraft from '@/models/MailDraft'
import { destroyReceiptAsset, parseReceiptRef } from '@/lib/uploads/attachmentStorage'

export interface DeletionStep { name: string; run: () => Promise<void> }
export interface DeletionOutcome { ok: boolean; failed: string[]; done: string[] }

/** Runs every step in order (a failing step does not stop the independent ones, except those flagged `after`), collecting failures. */
export async function runDeletionSteps(groups: DeletionStep[][]): Promise<DeletionOutcome> {
  const failed: string[] = [], done: string[] = []
  for (const group of groups) {
    // a later group runs only if everything before it succeeded (blobs → data → org/user), so pending work is never orphaned
    if (failed.length) break
    for (const step of group) {
      try { await step.run(); done.push(step.name) } catch (err) { failed.push(step.name); console.error('[account-deletion] step failed', step.name, (err as Error)?.name) }
    }
  }
  return { ok: failed.length === 0, failed, done }
}

const many = <T>(name: string, model: Model<T>, filter: Record<string, unknown>): DeletionStep => ({ name, run: async () => { await model.deleteMany(filter as never) } })

/** Deletes every private blob listed in the org's upload manifest; a manifest row is removed only after the provider confirmed (deleted / not found). */
export async function purgeOrgBlobs(orgId: string): Promise<void> {
  let failures = 0
  for (;;) {
    const rows = await ReceiptUpload.find({ orgId }).select('publicId').limit(200).lean()
    if (!rows.length) break
    let progressed = 0
    for (const r of rows) {
      const pid = r.publicId
      const res = parseReceiptRef(`cld:${pid}.png`, orgId) ? await destroyReceiptAsset(pid, orgId) : 'error'
      if (res === 'error') { failures++; continue }
      await ReceiptUpload.deleteOne({ _id: r._id }); progressed++
    }
    if (progressed === 0) break
  }
  if (failures > 0 || (await ReceiptUpload.exists({ orgId }))) throw new Error('private files could not be deleted')
}

export function orgDisbandSteps(orgId: string): DeletionStep[][] {
  return [
    [{ name: 'private_files', run: () => purgeOrgBlobs(orgId) }],
    [
      many('expenses', Expense, { orgId }), many('travel', TravelRequest, { orgId }), many('leave', Leave, { orgId }), many('leave_balances', LeaveBalance, { orgId }),
      many('contacts', Contact, { orgId }), many('scanned_cards', ScannedCard, { orgId }), many('campaigns', CampaignLog, { orgId }), many('announcements', Announcement, { orgId }),
      many('holidays', PublicHoliday, { orgId }), many('shared_dashboards', SharedDashboard, { orgId }), many('invitations', Invitation, { orgId }),
      many('inbox', InboxMessage, { orgId }), many('mail_config', OrgMailConfig, { orgId }), many('outlook_tokens', OutlookToken, { orgId }), many('sync_state', SyncState, { orgId }),
      many('usage', UsageCounter, { orgId }), many('subscriptions', Subscription, { orgId }), many('settings', OrgSettings, { orgId }),
    ],
    [{ name: 'organisation', run: async () => { await Organization.deleteOne({ orgId }) } }],
  ]
}

export function personalSteps(userId: string, orgId: string): DeletionStep[][] {
  return [[
    many('refresh_tokens', RefreshToken, { userId }), many('reset_tokens', PasswordResetToken, { userId }), many('passkeys', PasskeyCredential, { userId }),
    many('email_config', UserEmailConfig, { userId }), many('drafts', MailDraft, { ownerId: userId, orgId }), many('outlook_token', OutlookToken, { userId, orgId }),
    many('leave_balances_self', LeaveBalance, { userId, orgId }),
  ], [
    { name: 'employee_record', run: async () => { await Employee.deleteOne({ clerkUserId: userId }) } },
    { name: 'user', run: async () => { await User.findByIdAndDelete(userId) } },
  ]]
}
