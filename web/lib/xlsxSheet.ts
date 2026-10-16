/**
 * Pure worksheet builder for the branded XLSX export (kept apart from lib/export.ts so it is testable without a browser).
 * The `xlsx` (SheetJS 0.18.5) package has unpatched advisories for PARSING untrusted workbooks; this app only WRITES.
 * Hardening on the write side: every string is forced to a plain string cell (`t: 's'`), so a value such as `=HYPERLINK(...)`
 * or `=cmd|...` is stored as text and never as a formula; any formula/hyperlink fields are removed; and non-finite numbers become empty text.
 */
export type XlsxCell = string | number
type Utils = { aoa_to_sheet: (a: unknown[][]) => Record<string, unknown> }

export function buildBrandedSheet(
  utils: Utils,
  opts: { title: string; subtitle?: string; head: string[]; rows: XlsxCell[][]; generated: string },
) {
  const clean = (v: unknown): XlsxCell => (typeof v === 'number' ? (Number.isFinite(v) ? v : '') : v == null ? '' : String(v))
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
