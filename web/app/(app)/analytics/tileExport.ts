/**
 * Per-tile export helpers: CSV serializers for data tiles + PNG snapshot of any tile DOM node.
 * html2canvas is lazy-imported only when a PNG export actually runs (keeps it out of the main bundle).
 */

const csvCell = (v: unknown) => {
  let s = String(v ?? '')
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
const toCsv = (rows: (string | number)[][]) => rows.map(r => r.map(csvCell).join(',')).join('\n')

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadCsv(rows: (string | number)[][], filename: string) {
  download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename)
}

export async function downloadTilePng(node: HTMLElement, filename: string) {
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(node, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false })
  await new Promise<void>((resolve) => canvas.toBlob((b) => { if (b) download(b, filename); resolve() }, 'image/png'))
}

/* ── CSV builders keyed by tile id. Returns null for tiles with no tabular data. ── */
type AnalyticsLike = {
  kpis: Record<string, number>
  leaveByMonth: { label: string; count: number; days?: number }[]
  expenseByMonth: { label: string; count: number; total?: number }[]
  leaveStatus: { _id: string; count: number }[]
  expenseStatus: { _id: string; count: number; total?: number }[]
  travelStatus: { _id: string; count: number; total?: number }[]
  leaveType: { _id: string; count: number; days?: number }[]
  topSpenders: { userName: string; total: number; count: number }[]
  recentAudits: { action: string; performedByName: string; createdAt: string }[]
}

export function tileCsvRows(tileId: string, d: AnalyticsLike): (string | number)[][] | null {
  switch (tileId) {
    case 'chart.leaveByMonth':
      return [['Month', 'Requests', 'Days'], ...d.leaveByMonth.map(m => [m.label, m.count, m.days ?? 0])]
    case 'chart.expenseByMonth':
      return [['Month', 'Claims', 'Total (INR)'], ...d.expenseByMonth.map(m => [m.label, m.count, m.total ?? 0])]
    case 'chart.leaveStatus':
      return [['Status', 'Count'], ...d.leaveStatus.map(s => [s._id, s.count])]
    case 'chart.expenseStatus':
      return [['Status', 'Count', 'Total (INR)'], ...d.expenseStatus.map(s => [s._id, s.count, s.total ?? 0])]
    case 'chart.travelStatus':
      return [['Status', 'Count', 'Estimated (INR)'], ...d.travelStatus.map(s => [s._id, s.count, s.total ?? 0])]
    case 'chart.leaveType':
      return [['Type', 'Count', 'Days'], ...d.leaveType.map(s => [s._id, s.count, s.days ?? 0])]
    case 'chart.featureUsage30d':
      return [['Feature', 'Last 30 days'], ['Leaves', d.kpis.leavesIn30d], ['Expenses', d.kpis.expensesIn30d], ['Travel', d.kpis.travelIn30d]]
    case 'list.topSpenders':
      return [['Name', 'Total paid (INR)', 'Claims'], ...d.topSpenders.map(s => [s.userName, s.total, s.count])]
    case 'list.recentActivity':
      return [['Action', 'By', 'When'], ...d.recentAudits.map(a => [a.action, a.performedByName, new Date(a.createdAt).toLocaleString('en-IN')])]
    default:
      return null  // KPI tiles: no tabular CSV (PNG only)
  }
}
