/**
 * XLSX export hardening (Phase 8): xlsx 0.18.5 has unpatched PARSE advisories; the app only writes. These tests pin the write-side guarantees:
 * attacker-controlled cell text (formula / DDE / hyperlink payloads) is stored as inert text and never as a formula or link.
 * The test itself reads its own synthetic output with SheetJS (test-only, trusted data).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')
const XLSX = require('xlsx')

const PAYLOADS = ['=1+1', '=HYPERLINK("http://evil.example/x","click")', '+SUM(1,2)', '-2+3', '@SUM(1,1)', '=cmd|\' /C calc\'!A0', '\t=1+1', '\r=1+1', '__proto__', 'constructor']

test('X1. hostile strings become plain string cells: no formula (.f), no hyperlink (.l), type string, text preserved; non-finite numbers become empty', () => {
  const { buildBrandedSheet } = kit.load('lib/xlsxSheet.ts')
  const ws = buildBrandedSheet(XLSX.utils, { title: '=T', subtitle: '@S', head: ['=H1', 'H2'], rows: [[...PAYLOADS.slice(0, 2)], [PAYLOADS[2], Infinity], ...PAYLOADS.slice(3).map(p => [p, NaN])], generated: '01 Jan 2026' })
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'R')
  const cells = Object.entries(wb.Sheets.R).filter(([k]) => k[0] !== '!')
  assert.ok(cells.length >= 10)
  for (const [k, c] of cells) { assert.equal(c.f, undefined, `${k} must not be a formula`); assert.equal(c.l, undefined, `${k} must not be a link`); assert.ok(c.t === 's' || c.t === 'n', k + ' ' + c.t) }
  const text = new Set(cells.filter(([, c]) => c.t === 's').map(([, c]) => c.v))
  for (const p of PAYLOADS) assert.ok(text.has(p), 'payload preserved verbatim as text: ' + JSON.stringify(p))
  assert.equal(cells.filter(([, c]) => c.t === 'n' && !Number.isFinite(c.v)).length, 0)
  assert.equal(Object.prototype.polluted, undefined)
})

test('X2. the serialized workbook contains no <f> formula element and round-trips the payload as shared/inline strings', () => {
  const { buildBrandedSheet } = kit.load('lib/xlsxSheet.ts')
  const ws = buildBrandedSheet(XLSX.utils, { title: 't', head: ['a'], rows: PAYLOADS.map(p => [p]), generated: 'd' })
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'R')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const back = XLSX.read(buf, { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json(back.Sheets.R, { header: 1 }).flat()
  for (const p of PAYLOADS) assert.ok(rows.includes(p.replace(/\r/g, '\n')) || rows.includes(p), 'round-trip ' + JSON.stringify(p))
  const raw = buf.toString('latin1'); assert.doesNotMatch(raw, /<f[ >]/, 'compressed or not, no formula element in plain text parts')
  for (const [k, c] of Object.entries(back.Sheets.R)) if (k[0] !== '!') assert.equal(c.f, undefined, k)
})
