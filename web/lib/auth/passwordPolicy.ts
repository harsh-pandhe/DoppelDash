/**
 * DoppelDash — single source of truth for password rules.
 *
 * Pure TypeScript with no Node-only imports, so the exact same function runs on
 * the server (register / reset / change / invitation accept) and in the browser
 * (live strength meter). One policy means the UI can never promise something the
 * API then rejects.
 *
 * Policy (NIST 800-63B flavoured — length and a blocklist matter more than
 * arbitrary composition rules):
 *   - at least 8 characters and at most 72 BYTES (bcrypt silently ignores
 *     everything past byte 72, so a longer "password" would be a lie)
 *   - passphrases of 12+ characters are accepted as-is
 *   - shorter passwords need a letter AND a digit or symbol
 *   - never a commonly used password, a trivial pattern, or something derived
 *     from the user's own email / name
 */

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_PASSPHRASE_LENGTH = 12
export const PASSWORD_MAX_BYTES = 72

// Top breached / guessable passwords. Compared case-insensitively after
// stripping trailing digits/symbols the way attackers mutate them.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'pass1234', 'pass12345', 'qwerty', 'qwerty123', 'qwertyuiop', 'qwerty12', 'asdfghjkl', 'zxcvbnm',
  'letmein', 'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'administrator', 'root1234',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'superman',
  'batman', 'trustno1', 'master', 'shadow', 'abc123', 'abcd1234', 'abcdefgh', 'abcdefg1',
  'changeme', 'changeme1', 'default', 'secret', 'login', 'hello123', 'test1234', 'testtest',
  'doppeldash', 'doppeldash1', 'doppeldash123', 'doppelmayr', 'doppelmayr1', 'doppelmayr123',
  '11111111', '12345678', '123456789', '1234567890', '12341234', '87654321', '00000000', '88888888',
  'aaaaaaaa', 'qazwsxedc', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'passpass', 'iloveyou1', 'india123',
  'india@123', 'mumbai123', 'delhi123', 'google123', 'whatsapp', 'qwerty@123', 'admin@123', 'user1234',
])

export interface PasswordContext {
  email?: string
  firstName?: string
  lastName?: string
}

export interface PasswordRequirement {
  id: 'length' | 'variety' | 'common' | 'personal'
  label: string
  met: boolean
}

export interface PasswordCheck {
  ok: boolean
  /** Human readable reasons the password was rejected (empty when ok). */
  errors: string[]
  /** 0 (unusable) … 4 (strong). Drives the UI meter. */
  score: 0 | 1 | 2 | 3 | 4
  label: 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  requirements: PasswordRequirement[]
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isSequential(value: string): boolean {
  if (value.length < 4) return false
  const lower = value.toLowerCase()
  let asc = 0
  let desc = 0
  for (let i = 1; i < lower.length; i++) {
    const diff = lower.charCodeAt(i) - lower.charCodeAt(i - 1)
    if (diff === 1) asc++
    if (diff === -1) desc++
  }
  const span = lower.length - 1
  return asc === span || desc === span
}

function isRepeating(value: string): boolean {
  return value.length >= 4 && new Set(value.toLowerCase()).size <= 2
}

function mutationBase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0-9!@#$%^&*._-]+$/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
}

function isCommon(value: string): boolean {
  const lower = value.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return true
  const base = mutationBase(value)
  return base.length >= 4 && (COMMON_PASSWORDS.has(base) || COMMON_PASSWORDS.has(`${base}1`))
}

function containsPersonal(value: string, ctx: PasswordContext): boolean {
  const lower = value.toLowerCase()
  const tokens: string[] = []
  if (ctx.email) {
    const local = ctx.email.split('@')[0]?.toLowerCase() ?? ''
    if (local.length >= 4) tokens.push(local)
  }
  for (const part of [ctx.firstName, ctx.lastName]) {
    const t = (part ?? '').trim().toLowerCase()
    if (t.length >= 4) tokens.push(t)
  }
  return tokens.some(t => lower.includes(t))
}

export function checkPassword(password: unknown, ctx: PasswordContext = {}): PasswordCheck {
  const pw = typeof password === 'string' ? password : ''
  const errors: string[] = []

  // Letter ranges: Latin (+ext), Greek, Cyrillic, Devanagari — no `u` flag so it compiles for ES5 targets.
  const hasLetter = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0900-\u097F]/.test(pw)
  const hasDigit = /\d/.test(pw)
  const hasSymbol = /[^A-Za-z0-9\s\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0900-\u097F]/.test(pw)
  const bytes = byteLength(pw)

  const lengthOk = pw.length >= PASSWORD_MIN_LENGTH && bytes <= PASSWORD_MAX_BYTES
  const isPassphrase = pw.length >= PASSWORD_PASSPHRASE_LENGTH
  const varietyOk = isPassphrase || (hasLetter && (hasDigit || hasSymbol))
  const commonOk = pw.length > 0 && !isCommon(pw) && !isSequential(pw) && !isRepeating(pw)
  const personalOk = pw.length > 0 && !containsPersonal(pw, ctx)

  if (pw.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  } else if (bytes > PASSWORD_MAX_BYTES) {
    errors.push(`Password is too long — keep it under ${PASSWORD_MAX_BYTES} bytes.`)
  }
  if (pw.length >= PASSWORD_MIN_LENGTH && !varietyOk) {
    errors.push('Add a number or symbol, or make it a longer passphrase (12+ characters).')
  }
  if (pw.length >= PASSWORD_MIN_LENGTH && !commonOk) {
    errors.push('That password is too common or predictable. Choose something less guessable.')
  }
  if (pw.length >= PASSWORD_MIN_LENGTH && !personalOk) {
    errors.push('Don’t use your name or email in your password.')
  }

  const requirements: PasswordRequirement[] = [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH}+ characters`, met: lengthOk },
    { id: 'variety', label: 'Letter plus number or symbol (or 12+ characters)', met: pw.length > 0 && varietyOk },
    { id: 'common', label: 'Not a common password', met: commonOk },
    { id: 'personal', label: 'Doesn’t contain your name or email', met: personalOk },
  ]

  const ok = errors.length === 0 && pw.length > 0

  // Score is intentionally conservative: a rejected password can never score above 1.
  let score: 0 | 1 | 2 | 3 | 4 = 0
  if (pw.length > 0) {
    score = 1
    if (ok) {
      score = 2
      if (pw.length >= 12) score = 3
      if (pw.length >= 12 && ((hasDigit && hasSymbol) || pw.length >= 16)) score = 4
    }
  }
  const label = (['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score]

  return { ok, errors, score, label, requirements }
}

/** Convenience for API routes: returns the first error message or null. */
export function passwordError(password: unknown, ctx: PasswordContext = {}): string | null {
  const result = checkPassword(password, ctx)
  return result.ok ? null : (result.errors[0] ?? 'Choose a stronger password.')
}
