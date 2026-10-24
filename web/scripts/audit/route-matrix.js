#!/usr/bin/env node
/* Static inventory of every API route handler: method, auth, role gate, tenant scope, body parsing, validation, audit, tests.
 * Usage: node scripts/audit/route-matrix.js [--json out.json] [--md out.md]. Heuristic (regex) – a review aid, not a proof. */
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..', '..')
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
const routes = walk(path.join(root, 'app', 'api')).filter(f => /route\.ts$/.test(f))
const tests = walk(path.join(root, 'tests')).filter(f => f.endsWith('.js')).map(f => [path.basename(f), fs.readFileSync(f, 'utf8')])
const fuzzSrc = fs.readFileSync(path.join(root, 'tests', 'api_fuzz_matrix.test.js'), 'utf8')
const auditSrc = fs.readFileSync(path.join(root, 'tests', 'audit_events.test.js'), 'utf8')
const out = []
for (const f of routes) {
  const src = fs.readFileSync(f, 'utf8')
  const url = '/' + path.relative(path.join(root, 'app'), path.dirname(f)).replace(/\[\[?\.{0,3}(\w+)\]?\]/g, ':$1')
  const re = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
  let m; const methods = []
  while ((m = re.exec(src))) methods.push(m[1])
  const h = (rx) => rx.test(src)
  const mut = methods.filter(x => x !== 'GET')
  const needle = url.replace(/^\/api/, '/api')
  const testFiles = tests.filter(([, t]) => t.includes(url.replace(/:\w+/g, '')) || t.includes(url.split('/:')[0])).map(([n]) => n)
  out.push({
    route: url, file: path.relative(root, f), methods,
    auth: h(/getUser\(|requireAuth|getSession|verifyBearer|requireUser|authenticate|CRON_SECRET|verifyWebhook|webhook/i) ? 'yes' : (h(/export\s+(async\s+function|const)\s+(POST|PATCH|PUT|DELETE)/) ? 'NONE-FOUND' : 'n/a'),
    roleGate: h(/role\s*[!=]==?|isAdmin|requireRole|requireAdmin|canApprove|hasRole|assertRole|\['admin'/) ,
    tenantScope: h(/orgId/),
    safeBody: mut.length ? h(/readJsonObject/) : null,
    allowlist: mut.length ? h(/pick\(|PICK|apiFields|FIELDS/) : null,
    validation: mut.length ? h(/Invalid [a-z ]+'|fields\b|invalid[A-Z]\w+\(|\.safeParse|isValidObjectId|badFields/) : null,
    errorMapped: mut.length ? h(/try\s*{|dbGuard|catch\s*\(/) : null,
    audit: mut.length ? h(/writeAudit/) : null,
    revision: h(/revision/),
    tests: testFiles.length,
    fuzzed: fuzzSrc.includes(url.split('/:')[0] + '/') || fuzzSrc.includes("'" + url.split('/:')[0] + "'") || fuzzSrc.includes(url.split('/:')[0] + '`') || fuzzSrc.includes(url.split('/:')[0].replace('/api/', '') + '/') || fuzzSrc.includes("'" + url.split('/:')[0].replace('/api/', '') + "'"),
    auditTested: auditSrc.includes(url.split('/:')[0]),
  })
}
const json = JSON.stringify({ generatedBy: 'scripts/audit/route-matrix.js', handlers: out }, null, 2)
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
if (arg('--json')) fs.writeFileSync(arg('--json'), json + '\n')
if (arg('--md')) {
  const yn = v => v === null ? '–' : v ? 'Y' : '**N**'
  const rows = out.map(r => `| \`${r.route}\` | ${r.methods.join(',')} | ${r.auth} | ${yn(r.roleGate)} | ${yn(r.tenantScope)} | ${yn(r.safeBody)} | ${yn(r.allowlist)} | ${yn(r.validation)} | ${yn(r.errorMapped)} | ${yn(r.audit)} | ${r.tests} | ${r.fuzzed ? 'Y' : '–'} | ${r.auditTested ? 'Y' : '–'} |`)
  fs.writeFileSync(arg('--md'), `| Route | Methods | Auth | Role gate | Tenant | readJsonObject | Allowlist | Validation | Error map | Audit | Test files | Fuzz matrix | Audit test |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`)
}
if (!arg('--json') && !arg('--md')) console.log(json)
console.error(`${out.length} route files, ${out.reduce((a, r) => a + r.methods.length, 0)} handlers, ${out.reduce((a, r) => a + r.methods.filter(x => x !== 'GET').length, 0)} mutating`)
