/**
 * Phase 12C — branded export helpers. One place for PDF + Excel/CSV output so
 * every module (Reports, RMS, Travel, Contacts, Audit) ships consistent,
 * Doppelmayr-branded deliverables.
 *
 * Heavy deps (jspdf, xlsx) are lazy-imported so they stay out of the main bundle.
 */
import { buildBrandedSheet } from '@/lib/xlsxSheet'

const BRAND_BLUE: [number, number, number] = [0, 87, 168] // #0057A8
const GRAPHITE:   [number, number, number] = [40, 40, 40]
const MUTED:      [number, number, number] = [120, 120, 120]
const FOOTER_TEXT = 'Confidential — Doppelmayr India'

/** Date as DD-MMM-YYYY (the app-wide export date format). */
export function fmtDate(d: Date | string | number = new Date()): string {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  const day = String(dt.getDate()).padStart(2, '0')
  const mon = dt.toLocaleString('en-US', { month: 'short' })
  return `${day}-${mon}-${dt.getFullYear()}`
}

function triggerDownload(content: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(content)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export interface TableSection {
  title: string
  head: string[]
  rows: (string | number)[][]
}

/**
 * Branded multi-table PDF: wordmark header, report title + generated date,
 * blue table headers, "Confidential" footer with page numbers.
 */
export async function brandedPDF(opts: {
  title: string
  subtitle?: string          // e.g. a date range like "This Month"
  sections: TableSection[]
  filename: string
}) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const { DOPPELMAYR_LOGO_PNG, DOPPELMAYR_LOGO_WH } = await import('./brandLogo')
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()

  // ── Header: official Doppelmayr logo (falls back to text wordmark) ──
  const logoW = 34
  const logoH = logoW * (DOPPELMAYR_LOGO_WH.h / DOPPELMAYR_LOGO_WH.w)
  try {
    doc.addImage(DOPPELMAYR_LOGO_PNG, 'PNG', 14, 10, logoW, logoH)
  } catch {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...BRAND_BLUE)
    doc.text('DOPPELMAYR', 14, 18)
  }
  // right-aligned company line
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('Doppelmayr India Pvt Ltd', pageW - 14, 14, { align: 'right' })
  doc.text('www.doppelmayr.com', pageW - 14, 19, { align: 'right' })

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...GRAPHITE)
  doc.text(opts.title, 14, 32)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED)
  const meta = [opts.subtitle, `Generated ${fmtDate()}`].filter(Boolean).join('  ·  ')
  doc.text(meta, 14, 38)
  doc.setDrawColor(...BRAND_BLUE); doc.setLineWidth(0.6)
  doc.line(14, 41, pageW - 14, 41)

  let y = 48
  for (const s of opts.sections) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GRAPHITE)
    doc.text(s.title, 14, y); y += 3
    autoTable(doc, {
      startY: y,
      head: [s.head],
      body: s.rows.map(r => r.map(c => String(c))),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages()
  const pageH = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text(FOOTER_TEXT, 14, pageH - 8)
    doc.text(`Page ${i} of ${pages}`, pageW - 14, pageH - 8, { align: 'right' })
  }

  doc.save(opts.filename)
}

/**
 * Branded XLSX: a title block (report name + date) above the table, then the
 * header row + data. Single sheet. Falls back to CSV transparently if needed.
 */
export async function brandedXLSX(opts: {
  title: string
  subtitle?: string
  head: string[]
  rows: (string | number)[][]
  sheet?: string
  filename: string
}) {
  const { utils, writeFile } = await import('xlsx')
  const ws = buildBrandedSheet(utils, { title: opts.title, subtitle: opts.subtitle, head: opts.head, rows: opts.rows, generated: fmtDate() })
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, opts.sheet || 'Report')
  writeFile(wb, opts.filename)
}

/** Branded CSV with a title/date preamble + footer line. */
export function brandedCSV(opts: {
  title: string
  subtitle?: string
  head: string[]
  rows: (string | number)[][]
  filename: string
}) {
  const esc = (v: string | number) => {
    let s = String(v)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = [
    esc(`Doppelmayr India — ${opts.title}`),
    esc([opts.subtitle, `Generated ${fmtDate()}`].filter(Boolean).join(' · ')),
    '',
    opts.head.map(esc).join(','),
    ...opts.rows.map(r => r.map(esc).join(',')),
    '',
    esc(FOOTER_TEXT),
  ]
  triggerDownload(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), opts.filename)
}
