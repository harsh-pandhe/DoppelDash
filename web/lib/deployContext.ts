/**
 * Deploy-context safety (P0-05). A hosted deploy that is not explicitly declared production/staging must never reach a database.
 *
 * Netlify deploy previews run unreviewed PR code with whatever environment variables the site has. Netlify's own `CONTEXT` variable is
 * a build-time value and is not reliable at runtime, so the rule is positive and owner-controlled: on any recognised hosting platform
 * (see isDeployedPlatform) the variable DD_DEPLOY_CONTEXT must be `production` or `staging`. Set it per deploy context in the Netlify UI
 * (production: `production`; previews/branch deploys: leave unset, or `staging` ONLY together with a disposable database and
 * non-production credentials). Unset/unknown ⇒ the database is unreachable (fail closed) and preview builds also cancel themselves
 * (netlify.toml `ignore`). Local development and the test suites are unaffected (no platform marker present).
 */
import { isDeployedPlatform } from '@/lib/auth/devShortcuts'

export type DataAccessDecision = { allowed: true; context: string } | { allowed: false; reason: string }

export function dataAccessDecision(env: NodeJS.ProcessEnv = process.env): DataAccessDecision {
  if (!isDeployedPlatform(env)) return { allowed: true, context: 'local' }
  const declared = (env.DD_DEPLOY_CONTEXT || '').trim().toLowerCase()
  if (declared === 'production' || declared === 'staging') {
    // a declared production context must not coexist with a Netlify preview/branch-deploy build context when that value is visible
    const ctx = (env.CONTEXT || '').toLowerCase()
    if (declared === 'production' && (ctx === 'deploy-preview' || ctx === 'branch-deploy')) return { allowed: false, reason: 'DD_DEPLOY_CONTEXT=production conflicts with a preview build context' }
    return { allowed: true, context: declared }
  }
  return { allowed: false, reason: 'DD_DEPLOY_CONTEXT is not set to production or staging on this hosted deployment; database access is disabled' }
}

/** Throws (fail closed) when this process must not touch data. The message is generic and contains no configuration values. */
export function assertDataAccessAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const d = dataAccessDecision(env)
  if (!d.allowed) throw new Error(`[deploy-context] ${d.reason}`)
}
