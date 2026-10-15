#!/usr/bin/env node
/**
 * Machine-generated product-surface ledger (read-only scan; no network, no DB).
 *   node scripts/inventory/generate-ledger.js [--mobile ../path/to/DoppelDash-mobile] [--check]
 * Writes docs/ledger/ledger.json and docs/ledger/ROUTE_LEDGER.md. With --check it fails (exit 1) if the committed files are stale.
 * Heuristics are deliberately conservative text scans (guards, callers, tests); they locate rows to verify, they do NOT prove behaviour.
 */
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '../..')
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const mobile = path.resolve(arg('--mobile') || path.join(root, '../../../../../DoppelDash-mobile'))
const walk = (dir, pred, out = []) => { if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.next', '.git', 'build', '.dart_tool'].includes(e.name) || e.name.startsWith('.next')) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, pred, out); else if (pred(p)) out.push(p) } return out }
const read = p => fs.readFileSync(p, 'utf8')
const rel = (p, base = root) => path.relative(base, p).split(path.sep).join('/')

/* ── Web pages ── */
const pages = walk(path.join(root, 'app'), p => p.endsWith('/page.tsx')).map(p => {
  const r = rel(p).replace(/^app\//, '').replace(/(^|\/)page\.tsx$/, '')
  const url = '/' + r.split('/').filter(s => !/^\(.*\)$/.test(s)).join('/').replace(/\[\[\.\.\.(\w+)\]\]/g, '[...$1]')
  return { file: rel(p), url: url === '/' ? '/' : url.replace(/\/$/, ''), group: (r.match(/^\(([^)]+)\)/) || [])[1] || '' }
}).sort((a, b) => a.url.localeCompare(b.url))

/* ── API routes ── */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const apiFiles = walk(path.join(root, 'app/api'), p => p.endsWith('/route.ts'))
const testsText = walk(path.join(root, 'tests'), p => p.endsWith('.test.js')).map(p => ({ f: rel(p), t: read(p) }))
const apiRoutes = apiFiles.map(p => {
  let src = read(p); const url = '/api/' + rel(p).replace(/^app\/api\//, '').replace(/\/?route\.ts$/, '')
  // one level of delegation: routes that only call a shared handler inherit the handler's guards (e.g. lib/settings/orgSettingsHandler)
  for (const m of src.matchAll(/from\s+'@\/(lib\/[^']+)'/g)) { for (const ext of ['.ts', '/index.ts']) { const f = path.join(root, m[1] + ext); if (/[Hh]andler/.test(m[1]) && fs.existsSync(f)) src += '\n' + read(f) } }
  const methods = METHODS.filter(m => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`).test(src))
  const guards = []
  if (/getUser\(/.test(src)) guards.push('session'); if (/CRON_SECRET|verifyCron|cronAuth/.test(src)) guards.push('cron-secret'); if (/DEV_SEED_SECRET/.test(src)) guards.push('dev-secret')
  if (/role\s*[!=]==?\s*'(admin|manager)'|isManager|isAdmin|requireRole|role ===|\.role/.test(src)) guards.push('role-check'); if (/rateLimit\(/.test(src)) guards.push('rate-limit')
  if (/OUTLOOK_WEBHOOK_SECRET|RTDN|rtdnSecret|x-seed-secret|webhook/i.test(src)) guards.push('webhook/service-auth')
  if (/orgId/.test(src)) guards.push('tenant-scoped'); if (/webEnabled|isWebAccessAllowed/.test(src)) guards.push('web-access')
  const pub = guards.length === 0 || (!guards.includes('session') && !guards.includes('cron-secret') && !guards.includes('dev-secret') && !guards.includes('webhook/service-auth'))
  const pat = new RegExp('^' + url.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/\\\[[^/]+?\\\]/g, '[^/]+').replace(/\[[^/]+?\]/g, '[^/]+') + '$')
  return { url, file: rel(p), methods, guards, unauthenticatedByCode: pub, pat }
}).sort((a, b) => a.url.localeCompare(b.url))

/* ── Callers ── */
const norm = s => s.replace(/\$\{[^}]*\}/g, '[x]').replace(/\$\w+/g, '[x]').replace(/\?.*$/, '').replace(/\/+$/, '')
const webSrc = [...walk(path.join(root, 'app'), p => /\.(tsx?|jsx?)$/.test(p) && !p.includes('/app/api/')), ...walk(path.join(root, 'components'), p => /\.(tsx?)$/.test(p)), ...walk(path.join(root, 'lib'), p => /\.(tsx?)$/.test(p))]
const webCalls = new Map()
for (const p of webSrc) for (const m of read(p).matchAll(/[`'"](\/api\/[A-Za-z0-9_\-/[\]${}.:]*)/g)) { const u = norm(m[1]); if (!webCalls.has(u)) webCalls.set(u, new Set()); webCalls.get(u).add(rel(p)) }
const mobileOK = fs.existsSync(path.join(mobile, 'lib'))
const mobCalls = new Map()
if (mobileOK) for (const p of walk(path.join(mobile, 'lib'), p => p.endsWith('.dart'))) for (const m of read(p).matchAll(/\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*(?:'([^']+)'|"([^"]+)")/g)) { const u = '/api' + norm(m[2] || m[3]); if (!mobCalls.has(u)) mobCalls.set(u, new Set()); mobCalls.get(u).add(rel(p, mobile)) }
const matchCalls = (map, r) => [...map.entries()].filter(([u]) => r.pat.test(u.replace(/\[x\]/g, 'x'))).flatMap(([, s]) => [...s])
for (const r of apiRoutes) {
  r.webCallers = [...new Set(matchCalls(webCalls, r))].slice(0, 6); r.androidCallers = [...new Set(matchCalls(mobCalls, r))].slice(0, 6)
  const stem = r.url.replace(/^\/api\//, ''); r.tests = testsText.filter(t => t.t.includes('/api/' + stem.split('/[')[0])).map(t => t.f).slice(0, 8)
  delete r.pat
}

/* ── Android routes ── */
let androidRoutes = [], androidNav = []
if (mobileOK) {
  const app = read(path.join(mobile, 'lib/app.dart'))
  androidRoutes = [...app.matchAll(/path:\s*(?:'([^']+)'|(\w+))/g)].map(m => m[1] || `<const ${m[2]}>`)
  androidRoutes = [...new Set(androidRoutes)]
  const tests = walk(path.join(mobile, 'test'), p => p.endsWith('_test.dart')).map(p => ({ f: rel(p, mobile), t: read(p) }))
  androidRoutes = androidRoutes.map(r => ({ path: r, tests: tests.filter(t => t.t.includes(`'${r}'`)).map(t => t.f).slice(0, 4) }))
  androidNav = [...new Set([...read(path.join(mobile, 'lib/app.dart')).matchAll(/context\.(?:go|push|pushNamed|goNamed)\(\s*'([^']+)'/g)].map(m => m[1]))]
  for (const p of walk(path.join(mobile, 'lib/ui'), p => p.endsWith('.dart'))) for (const m of read(p).matchAll(/context\.(?:go|push)\(\s*'([^'$]+)'/g)) if (!androidNav.includes(m[1])) androidNav.push(m[1])
}

/* ── Providers / jobs ── */
const envNames = new Set(); for (const p of [...walk(path.join(root, 'app'), p => /\.tsx?$/.test(p)), ...walk(path.join(root, 'lib'), p => /\.tsx?$/.test(p)), ...walk(path.join(root, 'scripts'), p => p.endsWith('.js'))]) for (const m of read(p).matchAll(/process\.env\.([A-Z0-9_]+)/g)) envNames.add(m[1])
const PROV = { Cloudinary: /^CLOUDINARY_/, 'Gemini/Ollama OCR': /^(GEMINI_|OLLAMA_|OCR_)/, 'SMTP (outbound mail)': /^SMTP_/, 'IMAP (inbox)': /^IMAP_/, 'Outlook (OAuth/webhook)': /^OUTLOOK_/, 'Google Play billing/RTDN': /^GOOGLE_PLAY_/, 'MongoDB': /^MONGODB_/, 'Auth/crypto secrets': /^(JWT_|ENCRYPTION_|SETUP_SECRET|REFRESH_|REVIEWER_)/, 'Cron': /^(CRON_|RECEIPT_CLEANUP)/, 'Dev/test switches': /^(ALLOW_DEV_SEED|DEV_SEED_SECRET|TRAVEL_|DD_)/ }
const providers = Object.fromEntries(Object.entries(PROV).map(([k, rx]) => [k, [...envNames].filter(n => rx.test(n)).sort()]))
const jobs = apiRoutes.filter(r => r.url.startsWith('/api/cron/')).map(r => ({ url: r.url, methods: r.methods, guards: r.guards, scheduler: 'NOT CONFIGURED IN REPO (no vercel.json/netlify schedule)' }))
const hasSchedule = fs.existsSync(path.join(root, 'vercel.json')) || /\[\[?(functions|scheduled)/i.test(fs.existsSync(path.join(root, 'netlify.toml')) ? read(path.join(root, 'netlify.toml')) : '')
if (hasSchedule) jobs.forEach(j => { j.scheduler = 'declared (verify)' })

/* ── Web navigation links vs pages ── */
const segRx = u => '^' + u.split('/').map(s => /^\[\.\.\./.test(s) || /^\[\[\.\.\./.test(s) ? '(?:.+)?' : /^\[.*\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|\\[\]]/g, '\\$&')).join('/') + '$'
const pageRx = pages.map(p => new RegExp(segRx(p.url)))
const links = new Set(); for (const p of [...walk(path.join(root, 'components'), p => p.endsWith('.tsx')), ...walk(path.join(root, 'app'), p => p.endsWith('.tsx'))]) for (const m of read(p).matchAll(/(?:href|push|replace|path|to|url)\s*[:=(]?\s*\{?\s*[`'"](\/[A-Za-z0-9_\-/[\]${}.:]*)[`'"]/g)) { const u = norm(m[1]); if (!u.startsWith('/api') && u !== '') links.add(u) }
const deadLinks = [...links].filter(u => !pages.some(pg => pg.url.startsWith(u + '/[...')) && !pageRx.some(rx => rx.test(u.replace(/\[x\]/g, 'x')))).sort()
const orphanPages = pages.filter((p, i) => !pages[i].url.includes('[') && ![...links].some(l => l === p.url || l.startsWith(p.url + '/')) && !['/', '/sign-in'].includes(p.url)).map(p => p.url)

const ledger = { generatedFrom: { note: 'machine-generated; do not edit — run scripts/inventory/generate-ledger.js' }, counts: { webPages: pages.length, apiRoutes: apiRoutes.length, apiMethods: apiRoutes.reduce((n, r) => n + r.methods.length, 0), androidRoutes: androidRoutes.length, cronJobs: jobs.length }, pages, apiRoutes, androidRoutes, androidNav, providers, jobs, deadLinks, orphanPages }
const outDir = path.join(root, 'docs/ledger'); fs.mkdirSync(outDir, { recursive: true })
const json = JSON.stringify(ledger, null, 1) + '\n'
const md = []
md.push('# Route ledger (machine-generated)\n', 'Generated by `web/scripts/inventory/generate-ledger.js` — do not edit by hand. Guard/caller/test columns are text-scan heuristics that point at rows to verify; they are not proof of behaviour.\n')
md.push(`Counts: **${pages.length}** Web pages · **${apiRoutes.length}** API route files / **${ledger.counts.apiMethods}** methods · **${androidRoutes.length}** Android route paths · **${jobs.length}** cron endpoints.\n`)
md.push('## Web pages\n', '| URL | File | Group |', '|---|---|---|', ...pages.map(p => `| \`${p.url}\` | \`${p.file}\` | ${p.group} |`), '')
md.push('## API routes\n', '`unauth?` = no session/secret guard found by the scan (public by code — verify intent).\n', '| Route | Methods | Guards found | unauth? | Web callers | Android callers | Tests mentioning |', '|---|---|---|---|---|---|---|')
for (const r of apiRoutes) md.push(`| \`${r.url}\` | ${r.methods.join(', ')} | ${r.guards.join(', ') || '—'} | ${r.unauthenticatedByCode ? '**yes**' : ''} | ${r.webCallers.length ? r.webCallers.length : '—'} | ${r.androidCallers.length ? r.androidCallers.length : '**none**'} | ${r.tests.length || '**none**'} |`)
md.push('', '## Android routes (GoRouter `path:` in lib/app.dart)\n', '| Path | Tests referencing the path |', '|---|---|', ...androidRoutes.map(r => `| \`${r.path}\` | ${r.tests.length ? r.tests.map(t => '`' + t + '`').join(', ') : '**none**'} |`), '')
md.push('## Android navigation targets found in code\n', androidNav.map(n => '`' + n + '`').join(', ') || '(none)', '')
md.push('## Scheduled / cron endpoints\n', '| Endpoint | Methods | Guards | Scheduler |', '|---|---|---|---|', ...jobs.map(j => `| \`${j.url}\` | ${j.methods.join(', ')} | ${j.guards.join(', ')} | ${j.scheduler} |`), '')
md.push('## External providers (by environment-variable names read in code)\n', ...Object.entries(providers).map(([k, v]) => `* **${k}**: ${v.map(n => '`' + n + '`').join(', ') || '—'}`), '')
md.push('## Web link audit\n', `Links in components/pages that match no page: ${deadLinks.length ? deadLinks.map(u => '`' + u + '`').join(', ') : 'none'}.\n`, `Pages not linked from any component/page (static scan): ${orphanPages.length ? orphanPages.map(u => '`' + u + '`').join(', ') : 'none'}.\n`)
const mdOut = md.join('\n') + '\n'
if (process.argv.includes('--check')) { const same = fs.existsSync(path.join(outDir, 'ledger.json')) && read(path.join(outDir, 'ledger.json')) === json; if (!same) { console.error('docs/ledger is stale — regenerate'); process.exit(1) } process.exit(0) }
fs.writeFileSync(path.join(outDir, 'ledger.json'), json); fs.writeFileSync(path.join(outDir, 'ROUTE_LEDGER.md'), mdOut)
console.log(JSON.stringify(ledger.counts), 'deadLinks=', deadLinks.length, 'orphanPages=', orphanPages.length, 'unauthByCode=', apiRoutes.filter(r => r.unauthenticatedByCode).length, 'noAndroidCaller=', apiRoutes.filter(r => !r.androidCallers.length).length, 'noTests=', apiRoutes.filter(r => !r.tests.length).length)
