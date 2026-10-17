/**
 * The public base URL of this deployment, normalised: whitespace and trailing slashes removed.
 * Every e-mailed link and OAuth redirect is built as `${appBaseUrl()}/path`. A trailing slash typed into NEXT_PUBLIC_APP_URL used to produce
 * `https://host//reset-password`, which the proxy treats as a protected path (it redirected to /sign-in instead of the reset page) — found by the live
 * staging browser test of the password-reset link — and would also have broken the invitation links and the Outlook redirect URI.
 */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env, fallback = 'http://localhost:3000'): string {
  const raw = (env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  return raw || fallback
}
