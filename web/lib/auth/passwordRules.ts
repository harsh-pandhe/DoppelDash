/**
 * Password rules as the SERVER enforces them (client-safe, no Node imports).
 *
 * Every password endpoint (login-time change-password, reset confirm, invitation accept, setup, register)
 * accepts 8–128 characters and nothing else is required. The UI mirrors exactly that — it must never promise
 * (or demand) more or less than the API does. (A richer policy exists in lib/auth/passwordPolicy.ts but is not
 * wired into any route, so it is deliberately NOT shown to users.)
 *
 * Android shares the same contract: 8–128.
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export interface PasswordRuleState {
  length: boolean
  /** Only meaningful when a confirmation is being collected. */
  match: boolean
}

export function passwordRuleState(password: string, confirm?: string): PasswordRuleState {
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    match: confirm === undefined ? true : password.length > 0 && password === confirm,
  }
}

/** First problem as a sentence, or null when the password satisfies the contract. */
export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  if (confirm !== undefined && password !== confirm) return 'The two passwords don’t match.'
  return null
}
