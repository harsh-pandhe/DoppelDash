/**
 * Pure worksheet builder for the branded XLSX export (kept apart from lib/export.ts so it is testable without a browser).
 * The `xlsx` (SheetJS 0.18.5) package has unpatched advisories for PARSING untrusted workbooks; this app only WRITES.
 * Hardening on the write side: every string is forced to a plain string cell (`t: 's'`), so a value such as `=HYPERLINK(...)`
 * or `=cmd|...` is stored as text and never as a formula; any formula/hyperlink fields are removed; non-finite numbers, objects, null and undefined become
 * empty text; illegal XML control characters are dropped; over-long text is truncated (an over-long cell makes the xlsx writer throw).
 */
export type XlsxCell = string | number
const MAX_CELL = 32767
type Utils = { aoa_to_sheet: (a: unknown[][]) => Record<string, unknown> }

export function buildBrandedSheet(
  utils: Utils,
  opts: { title: string; subtitle?: string; head: string[]; rows: XlsxCell[][]; generated: string },
) {
  const clean = (v: unknown): XlsxCell => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : ''
    if (v == null) return ''
    if (v instanceof Date) v = Number.isNaN(v.getTime()) ? '' : v.toISOString()
    // XML 1.0 cannot carry most control characters (the writer would emit a corrupt file) and a cell holds at most 32767 characters
    // (the writer THROWS above that, which would fail the whole export). Unpaired surrogates are replaced for the same reason.
    const t = (typeof v === 'object' ? '' : String(v))
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
    return t.length > MAX_CELL ? t.slice(0, MAX_CELL - 1) + '…' : t
  }
  const aoa: XlsxCell[][] = [
    [`Doppelmayr India — ${opts.title}`],
    [[opts.subtitle, `Generated ${opts.generated}`].filter(Boolean).join('  ·  ')],
    [],
    opts.head.map(clean),
    ...opts.rows.map(r => r.map(clean)),
  ]
  const ws = utils.aoa_to_sheet(aoa)
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue
    const c = ws[k] as { t?: string; v?: unknown; f?: unknown; l?: unknown; F?: unknown; w?: unknown }
    delete c.f; delete c.F; delete c.l
    if (typeof c.v === 'string') { c.t = 's'; delete c.w }
  }
  ws['!cols'] = opts.head.map((h, c) => {
    const max = Math.max(String(h).length, ...opts.rows.map(r => String(r[c] ?? '').length))
    return { wch: Math.min(Math.max(max + 2, 10), 40) }
  })
  return ws
}
