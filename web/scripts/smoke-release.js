/**
 * DoppelDash — read-only release smoke test for a RUNNING deployment (staging or production after an approved release). No credentials, no writes.
 *   node web/scripts/smoke-release.js --url=https://<host> [--expect-commit=<sha>] [--production]
 * Checks provenance (/api/health: status ok, commit matches), security headers + CSP on the sign-in page, anonymous access refused on protected APIs,
 * dev/seed routes refused, removed endpoints, legal/support pages, and that no response leaks a stack or connection string. `--production`
 * additionally requires HTTPS and `context: production`. Authenticated journeys (sign-in, entitlements, uploads, mail) are the manual checklist in
 * docs/RELEASE_CANDIDATE_RUNBOOK.md — this script only proves the deployment is the right build and fails closed.
 */
const args = process.argv.slice(2); const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const base = flag('url').replace(/\/+$/, ''); const expect = flag('expect-commit'); const prod = args.includes('--production')
if (!/^https?:\/\//.test(base)) { console.error('Usage: --url=https://host [--expect-commit=<sha>] [--production]'); process.exit(2) }
const out = []; const check = (name, ok, detail = '') => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const get = async (p, init = {}) => { try { const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init }); return { r, text: await r.text() } } catch (e) { return { r: null, text: '', err: e.name } } }
const LEAK = /mongodb(\+srv)?:\/\/|MongoServer|\bat [A-Za-z_.]+ \(.*:\d+:\d+\)|node_modules|ECONNREFUSED/i
;(async () => {
  if (prod) check('uses HTTPS', base.startsWith('https://'))
  const h = await get('/api/health'); let j = null; try { j = JSON.parse(h.text) } catch { /* not json */ }
  check('/api/health answers 200 {status:ok}', h.r?.status === 200 && j?.status === 'ok', h.err || `status ${h.r?.status}`)
  check('/api/health exposes only status/commit/context', !!j && Object.keys(j).sort().join() === 'commit,context,status')
  if (expect) check(`running commit matches ${expect.slice(0, 12)}`, !!j?.commit && (j.commit.startsWith(expect) || expect.startsWith(j.commit)), `reported ${j?.commit ? j.commit.slice(0, 12) : 'none'}`)
  if (prod) check('context is production', j?.context === 'production', `reported ${j?.context}`)
  const s = await get('/sign-in'); const csp = s.r?.headers.get('content-security-policy') || ''
  check('/sign-in serves 200', s.r?.status === 200); check('CSP present with frame-ancestors none + default-src self', /frame-ancestors 'none'/.test(csp) && /default-src 'self'/.test(csp))
  check('X-Frame-Options DENY, nosniff, HSTS', s.r?.headers.get('x-frame-options') === 'DENY' && s.r?.headers.get('x-content-type-options') === 'nosniff' && /max-age=/.test(s.r?.headers.get('strict-transport-security') || '') || (!prod && s.r?.headers.get('x-frame-options') === 'DENY'))
  check('no X-Powered-By header', !s.r?.headers.get('x-powered-by'))
  for (const p of ['/api/auth/me', '/api/rms', '/api/lms', '/api/crm', '/api/employees/me', '/api/admin/users', '/api/billing/entitlements', '/api/lms/000000000000000000000001/document/0.png']) {
    const r = await get(p); check(`anonymous ${p.replace(/[0-9a-f]{24}/, ':id')} refused (401)`, r.r?.status === 401 && !LEAK.test(r.text), `status ${r.r?.status}`)
  }
  const seed = await get('/api/dev/seed', { method: 'POST' }); check('/api/dev/seed refuses an unauthenticated POST', [401, 403, 404, 405].includes(seed.r?.status) && !/"ok":\s*true/.test(seed.text), `status ${seed.r?.status}`)
  const mig = await get('/api/dev/migrate', { method: 'POST' }); check('/api/dev/migrate refuses an unauthenticated POST', [401, 403, 404, 405].includes(mig.r?.status), `status ${mig.r?.status}`)
  const cron = await get('/api/cron/birthday'); check('cron endpoint refuses without the secret', cron.r?.status === 401)
  const inv = await get('/api/auth/invitations/probe'); check('removed invitation GET endpoint answers 405', inv.r?.status === 405)
  for (const p of ['/privacy', '/terms', '/support', '/delete-account', '/web-access-restricted']) { const r = await get(p); check(`${p} is public (200)`, r.r?.status === 200) }
  const bad = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }); check('malformed login body → 400 without internals', bad.r?.status === 400 && !LEAK.test(bad.text), `status ${bad.r?.status}`)
  const failed = out.filter(o => !o.ok).length; console.log(`\n${failed ? failed + ' CHECK(S) FAILED' : 'ALL SMOKE CHECKS PASS'} (${out.length} checks) against ${new URL(base).host}`); process.exit(failed ? 1 : 0)
})()
