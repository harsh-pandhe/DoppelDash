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

/**
 * A contact's e-mail is optional, but when present it must look like an address. The CRM API used to store any string ("not-an-email") on create (201)
 * and edit (200) because only the web form's browser check stopped it — found by the live staging acceptance run. Returns the offending field list or null.
 */
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export function invalidContactEmail(value: unknown): { error: string; fields: string[] } | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 254 || !PLAUSIBLE_EMAIL.test(value.trim())) return { error: 'Invalid contact', fields: ['email'] }
  return null
}

const FIELD_MAX: Record<string, number> = { name: 200, company: 200, designation: 200, phone: 50, gender: 50, caste: 50, religion: 50, notes: 10_000, reminderNote: 1_000 }
/**
 * Contact write validation shared by create and edit: a plausible e-mail (see above) and bounded text fields. A 5,000-character name used to be stored
 * (201) — found by the live acceptance run. `photo`, `timeline`, `sharedWith`, `projects` and `tags` have their own handling and are not limited here.
 */
export function invalidContactFields(picked: Record<string, unknown>): { error: string; fields: string[] } | null {
  const fields: string[] = []
  if (invalidContactEmail(picked.email)) fields.push('email')
  for (const [k, max] of Object.entries(FIELD_MAX)) {
    const v = picked[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string' || v.length > max) fields.push(k)
  }
  return fields.length ? { error: 'Invalid contact', fields } : null
}
