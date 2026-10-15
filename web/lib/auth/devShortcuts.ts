/**
 * DoppelDash — the ONE place that decides whether development-only auth
 * conveniences may exist (static OTP code, reset links in API responses,
 * OTP/secret console logging, raw invite tokens in API responses…).
 *
 * Why centralised: scattered `NODE_ENV !== 'production'` checks are fragile — a
 * staging deploy with a mistaken NODE_ENV would silently hand out reset links.
 * Here the rule is "allowed only on a developer machine":
 *
 *   - NODE_ENV must be unset, 'development' or 'test'  (NOT 'production', NOT 'staging', …)
 *   - AND the process must not be running on a deploy platform
 *     (Netlify, Vercel, AWS Lambda, Cloud Run, Render, Railway, Fly, Heroku)
 *
 * Always evaluated at call time (never cached at import) so tests and runtime
 * environment changes behave predictably.
 */

const PLATFORM_MARKERS = [
  'NETLIFY', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV', 'LAMBDA_TASK_ROOT',
  'K_SERVICE', 'RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'DYNO',
] as const

/** True when running on a recognised hosting platform, regardless of NODE_ENV. */
export function isDeployedPlatform(env: NodeJS.ProcessEnv = process.env): boolean {
  return PLATFORM_MARKERS.some(key => Boolean(env[key]))
}

/** True for any environment that must be treated as production-grade. */
export function isProductionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV as string | undefined
  const localEnv = nodeEnv === undefined || nodeEnv === '' || nodeEnv === 'development' || nodeEnv === 'test'
  return !localEnv || isDeployedPlatform(env)
}

/** Dev-only auth shortcuts (static OTP, secrets in responses) are permitted. */
export function isDevAuthShortcutAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProductionLike(env)
}

/**
 * Console-logging of OTPs / tokens is OFF unless a developer opts in explicitly
 * (AUTH_DEV_LOG_SECRETS=true) AND dev shortcuts are allowed. Never in production.
 */
export function shouldLogAuthSecrets(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevAuthShortcutAllowed(env) && env.AUTH_DEV_LOG_SECRETS === 'true'
}

/**
 * Wrap a secret that may be echoed to automation in dev (reset URL, raw invite
 * token…). Returns `undefined` — so JSON drops the key — everywhere else.
 */
export function devOnly<T>(value: T, env: NodeJS.ProcessEnv = process.env): T | undefined {
  return isDevAuthShortcutAllowed(env) ? value : undefined
}
