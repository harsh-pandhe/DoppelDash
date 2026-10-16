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

test('X3. unusual values never break or corrupt the produced file: a >32767-char cell is truncated (the writer used to THROW and fail the whole export), XML-illegal control chars are dropped, lone surrogates replaced, null/undefined/objects/NaN/Infinity become empty, Dates become ISO text; the file re-reads and contains no formula', () => {
  const { buildBrandedSheet } = kit.load('lib/xlsxSheet.ts')
  const rows = [['\u0000\u0001ctl\u001f', '\ud800lone', 'x'.repeat(40000), true, new Date(0), { a: 1 }, null, undefined, [1, 2], Infinity, NaN, 0.1 + 0.2, '=1+1']]
  const ws = buildBrandedSheet(XLSX.utils, { title: 't', head: rows[0].map((_, i) => 'h' + i), rows, generated: 'd' })
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'R')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })   // would throw "Text length must not exceed 32767" before the fix
  const back = XLSX.read(buf, { type: 'buffer' }); const r = XLSX.utils.sheet_to_json(back.Sheets.R, { header: 1, defval: '' })[4]
  assert.equal(r[0], 'ctl'); assert.match(r[1], /^�lone$/); assert.equal(r[2].length, 32767); assert.ok(r[2].endsWith('…'))
  assert.equal(r[3], 'true'); assert.equal(r[4], '1970-01-01T00:00:00.000Z'); for (const i of [5, 6, 7, 8, 9, 10]) assert.equal(r[i], '', 'value ' + i)
  assert.equal(r[11], 0.1 + 0.2); assert.equal(r[12], '=1+1')
  for (const [k, c] of Object.entries(back.Sheets.R)) if (k[0] !== '!') assert.equal(c.f, undefined, k)
})
