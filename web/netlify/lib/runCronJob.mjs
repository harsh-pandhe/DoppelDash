/**
 * Shared body of the Netlify Scheduled Functions. Calls ONE job route of THIS site with the bearer secret from the function's own environment.
 * Fail closed and quiet: no target/secret -> no request; the secret only travels in the Authorization header (never a URL); the log line holds the job
 * name, HTTP status and the `sent` count only (the route returns counts only), so scheduler logs carry no personal data and no secret.
 * Required site env (names only): CRON_SECRET (same value the app checks) and CRON_TARGET_URL (bare https origin of THIS site, e.g. the staging site).
 */
export const JOBS = { birthday: 'GET', announcements: 'GET', onboarding: 'GET' }

export async function runCronJob(job, env = process.env, fetchImpl = fetch, log = console) {
  if (!Object.prototype.hasOwnProperty.call(JOBS, job)) throw new Error('unknown job')
  let target
  try { target = new URL(env.CRON_TARGET_URL || '') } catch { log.error(`[cron:${job}] not run: CRON_TARGET_URL is missing or invalid`); return { ok: false, status: 0 } }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  if ((target.protocol !== 'https:' && !loopback) || target.username || target.password || target.search || (target.pathname && target.pathname !== '/')) {
    log.error(`[cron:${job}] not run: CRON_TARGET_URL must be a bare https origin`); return { ok: false, status: 0 }
  }
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) { log.error(`[cron:${job}] not run: CRON_SECRET is not set (the route would refuse anyway)`); return { ok: false, status: 0 } }
  try {
    const r = await fetchImpl(`${target.origin}/api/cron/${job}`, { method: JOBS[job], headers: { Authorization: `Bearer ${env.CRON_SECRET}` }, redirect: 'manual', signal: AbortSignal.timeout(25000) })
    let sent = null; try { const j = await r.json(); if (j && Number.isInteger(j.sent)) sent = j.sent } catch { /* not json */ }
    const ok = r.status === 200
    ;(ok ? log.log : log.error)(`[cron:${job}] status=${r.status}${sent !== null ? ` sent=${sent}` : ''}`)
    return { ok, status: r.status, sent }
  } catch (e) { log.error(`[cron:${job}] request failed: ${(e && e.name) || 'Error'}`); return { ok: false, status: 0 } }
}
