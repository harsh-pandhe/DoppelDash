/**
 * Which Employee fields each caller may write. Writes are an ALLOWLIST of top-level keys: a denylist (`delete body.privileges`) is bypassed by
 * dotted paths (`privileges.food.dailyLimit`) and operators (`$set`), which Mongo applies straight into nested schema paths.
 */
export const SELF_EDITABLE = ['firstName', 'lastName', 'phone', 'photo', 'gender', 'dateOfBirth', 'personalAnniversary', 'address', 'city', 'state',
  'bankDetails', 'emergencyContacts', 'medicalDetails', 'outOfOffice', 'onboardingStep'] as const
export const REVIEWER_EDITABLE = ['designation', 'department', 'employeeType', 'reportingManagerId', 'joiningDate', 'workAnniversary', 'privileges'] as const

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasOperatorKey = (v: unknown, depth = 0): boolean => {
  if (depth > 6) return true
  if (Array.isArray(v)) return v.some(x => hasOperatorKey(x, depth + 1))
  if (isObj(v)) return Object.keys(v).some(k => k.startsWith('$') || k.includes('.') || hasOperatorKey(v[k], depth + 1))
  return false
}

export type Picked = { data: Record<string, unknown>; rejected: string[]; bad: string[] }

/** Keeps only allowlisted top-level keys with operator-free values. `rejected` lists everything else (callers decide: drop silently for compatibility, or 400). */
export function pickAllowed(body: unknown, allowed: readonly string[]): Picked | null {
  if (!isObj(body)) return null
  const data: Record<string, unknown> = {}; const rejected: string[] = []; const bad: string[] = []
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue
    if (!allowed.includes(k)) rejected.push(k)          // not writable here (dotted paths and `$` operators land here too)
    else if (hasOperatorKey(v)) bad.push(k)             // writable field, but the VALUE smuggles operators / dotted keys
    else data[k] = v
  }
  return { data, rejected, bad }
}

/** Scalar fields must be strings (not `{ $gt: 1 }`); dates must parse. Returns the offending field names. */
export function badScalars(data: Record<string, unknown>): string[] {
  const bad: string[] = []
  for (const k of ['firstName', 'lastName', 'phone', 'photo', 'gender', 'address', 'city', 'state', 'designation', 'department', 'employeeType', 'reportingManagerId']) {
    if (k in data && data[k] !== null && typeof data[k] !== 'string') bad.push(k)
  }
  for (const k of ['dateOfBirth', 'personalAnniversary', 'joiningDate', 'workAnniversary']) {
    if (k in data && data[k] !== null && (typeof data[k] !== 'string' || Number.isNaN(new Date(data[k] as string).getTime()))) bad.push(k)
  }
  if ('onboardingStep' in data && (!Number.isInteger(data.onboardingStep) || (data.onboardingStep as number) < 0 || (data.onboardingStep as number) > 10)) bad.push('onboardingStep')
  for (const k of ['bankDetails', 'medicalDetails', 'outOfOffice', 'privileges']) if (k in data && data[k] !== null && !isObj(data[k])) bad.push(k)
  if ('emergencyContacts' in data && !Array.isArray(data.emergencyContacts)) bad.push('emergencyContacts')
  return bad
}
