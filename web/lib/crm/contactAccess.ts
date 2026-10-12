import mongoose from 'mongoose'
import User from '@/models/User'

/** Fields a client may set when creating OR updating a contact. Everything else (orgId, createdBy, shareToken,
 *  shareTokenExpiresAt, isEmployee, employeeClerkId, birthdayGreetingSent, reminderDismissedAt) is server-owned. */
export const CONTACT_WRITE_FIELDS = [
  'name', 'email', 'phone', 'company', 'designation', 'gender', 'caste', 'religion',
  'notes', 'tags', 'projects', 'photo', 'birthday', 'anniversary',
  'reminderDate', 'reminderNote', 'timeline', 'visibility', 'sharedWith', 'colorLabel',
] as const

export const TIMELINE_TYPES = ['email', 'meeting', 'note', 'call'] as const

/** Who can READ a contact: owner, org-visible, explicitly shared, team (manager+), boss_only (admin). */
export function visibilityClauses(role: string, userId: string): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [{ createdBy: userId }, { visibility: 'org' }, { sharedWith: userId }]
  if (role === 'manager' || role === 'admin') clauses.push({ visibility: 'team' })
  if (role === 'admin') clauses.push({ visibility: 'boss_only' })
  return clauses
}

/** Who can EDIT/DELETE: the creator, or an admin of the same organisation. */
export function canManageContact(role: string, userId: string, createdBy: string): boolean {
  return role === 'admin' || createdBy === userId
}

/** Only the creator may mint/revoke the public share link (matches /crm/[id]/share). */
export function canShareContact(userId: string, createdBy: string): boolean {
  return createdBy === userId
}

/** Keep only ids of users who belong to `orgId`; a client cannot "share" with arbitrary strings or other tenants. */
export async function sanitizeSharedWith(orgId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return []
  const valid = ids.filter((x): x is string => typeof x === 'string' && mongoose.isValidObjectId(x))
  if (!valid.length) return []
  const found = await User.find({ orgId, _id: { $in: valid } }).select('_id').lean()
  return found.map(u => String(u._id))
}

/** Maps Mongoose validation/cast failures to a 400 payload; null for anything else. */
export function validationProblem(err: unknown): { error: string; fields: string[] } | null {
  if (err instanceof mongoose.Error.ValidationError) return { error: 'Invalid contact', fields: Object.keys(err.errors) }
  if (err instanceof mongoose.Error.CastError) return { error: 'Invalid contact', fields: [err.path] }
  return null
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
