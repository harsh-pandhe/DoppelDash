/**
 * DoppelDash — operator trigger for the scheduled jobs, for STAGING verification (and for the scheduler to call). Prints status codes and counts only —
 * never the secret, never a response body that could hold data.
 *   STAGING_APP_URL=https://staging.example STAGING_CRON_SECRET=<staging secret> node web/scripts/trigger-cron.js [--jobs=birthday,announcements,onboarding] [--repeat=2] [--parallel]
 * Safety: the secret is read from the environment only and sent in the Authorization header (never the URL). Refuses to run unless the base URL is https
 * (or loopback) AND DD_ALLOW_TARGET=<exact host> names the host you intend to hit; refuses any host listed in PRODUCTION_HOSTS. Exit 0 = every call 200.
 * `receipts-cleanup` is excluded on purpose (separate approval, see docs/SCHEDULED_JOBS.md).
 */
const args = process.argv.slice(2); const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const env = process.env
const JOBS = { birthday: 'GET', announcements: 'GET', onboarding: 'GET' }
const fail = (m, c = 2) => { console.error('REFUSING TO RUN — nothing was contacted: ' + m); process.exit(c) }
const base = (env.STAGING_APP_URL || '').replace(/\/+$/, '')
let u; try { u = new URL(base) } catch { fail('STAGING_APP_URL is required (e.g. https://staging.example)') }
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
if (u.protocol !== 'https:' && !loopback) fail('the target must be https (or loopback).')
if (u.username || u.password || u.search || (u.pathname && u.pathname !== '/')) fail('the target must be a bare origin (no credentials, path or query).')
if (!env.STAGING_CRON_SECRET || env.STAGING_CRON_SECRET.length < 16) fail('STAGING_CRON_SECRET (the STAGING secret, >=16 chars) is required.')
if (env.DD_ALLOW_TARGET !== u.host) fail(`DD_ALLOW_TARGET must equal the target host exactly (${u.host}) — a deliberate second confirmation.`)
const prod = (env.PRODUCTION_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
if (prod.includes(u.host)) fail('that host is listed in PRODUCTION_HOSTS.')
const jobs = (flag('jobs') || Object.keys(JOBS).join(',')).split(',').map(s => s.trim()).filter(Boolean)
for (const j of jobs) if (!JOBS[j]) fail(`unknown job "${j}" (allowed: ${Object.keys(JOBS).join(', ')})`)
const repeat = Math.min(Math.max(parseInt(flag('repeat') || '1', 10) || 1, 1), 10), parallel = args.includes('--parallel')
const call = async (job, auth) => {
  const t0 = Date.now()
  try {
    const r = await fetch(`${base}/api/cron/${job}`, { method: JOBS[job], headers: auth ? { Authorization: auth } : {}, redirect: 'manual', signal: AbortSignal.timeout(60000) })
    let sent = null; try { const j = await r.json(); if (j && Number.isInteger(j.sent)) sent = j.sent } catch { /* not json */ }
    return { job, status: r.status, sent, ms: Date.now() - t0 }
  } catch (e) { return { job, status: 0, sent: null, ms: Date.now() - t0, err: (e && e.name) || 'Error' } }
}
;(async () => {
  let bad = 0; const line = r => console.log(`${r.status === 200 ? 'PASS' : 'FAIL'}  ${r.job.padEnd(14)} status=${r.status}${r.sent !== null ? ` sent=${r.sent}` : ''} ${r.ms}ms${r.err ? ' ' + r.err : ''}`)
  // negative control first: the job must refuse a wrong bearer
  for (const j of jobs) { const r = await call(j, 'Bearer not-the-secret'); const ok = r.status === 401; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${j.padEnd(14)} wrong-secret → ${r.status} (want 401)`) }
  for (let i = 1; i <= repeat; i++) {
    console.log(`-- run ${i}/${repeat}${parallel ? ' (all jobs in parallel: overlap check)' : ''}`)
    const rs = parallel ? await Promise.all(jobs.map(j => call(j, `Bearer ${env.STAGING_CRON_SECRET}`))) : []
    if (!parallel) for (const j of jobs) rs.push(await call(j, `Bearer ${env.STAGING_CRON_SECRET}`))
    for (const r of rs) { line(r); if (r.status !== 200) bad++ }
  }
  console.log(bad ? `${bad} CHECK(S) FAILED` : 'ALL CHECKS PASSED'); process.exit(bad ? 1 : 0)
})()
