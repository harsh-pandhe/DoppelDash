'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Download, TrendingUp, Receipt, Cake, Users, FileSpreadsheet, FileText,
  CalendarDays, BarChart3, Plane, Plus, X, ChevronUp, ChevronDown,
  Pencil, CheckCircle, RotateCcw, Sparkles, Layers, IndianRupee, Clock, Filter,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import * as Dialog from '@radix-ui/react-dialog'
import { SortableTileGrid } from '@/components/SortableTileGrid'

/* ════════════════════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════════════════ */

interface LeaveRow   { _id: { userId: string; userName: string }; totalRequests: number; totalDays: number; approved: number; rejected: number }
interface ExpenseRow { _id: { userId: string; userName: string }; totalRequests: number; totalAmount: number; paid: number; pending: number }
interface TravelRow  { _id: { userId: string; userName: string }; totalRequests: number; totalEstimate: number; approved: number }
interface TypeBucket { _id: string; count: number; days: number }
interface StatusBucket { _id: string; count: number; amount?: number; total?: number }
interface BirthdayRow {
  source: 'employee' | 'contact'
  kind:   'birthday' | 'work_anniversary'
  name:   string
  company?: string
  photo?: string
  date:   string
  daysUntil: number
  years?: number
}

interface ReportData {
  leaveSummary:          LeaveRow[]
  expenseSummary:        ExpenseRow[]
  travelSummary:         TravelRow[]
  leaveByType:           TypeBucket[]
  expenseByStatus:       StatusBucket[]
  travelByStatus:        StatusBucket[]
  upcomingBirthdays:     BirthdayRow[]
  upcomingAnniversaries: BirthdayRow[]
}

type TileSize = 'sm' | 'md' | 'lg'
type LayoutEntry = { id: TileId; size: TileSize }

/* ════════════════════════════════════════════════════════════════════════════
   Tile catalog
   ══════════════════════════════════════════════════════════════════════════ */

type TileId =
  | 'kpi.leaveDays' | 'kpi.leaveRequests' | 'kpi.approvedLeaves'
  | 'kpi.expenseTotal' | 'kpi.expensePaid' | 'kpi.expensePending'
  | 'kpi.travelRequests' | 'kpi.travelApproved'
  | 'kpi.upcomingBirthdays' | 'kpi.leaveTypes'
  | 'table.leaveSummary' | 'table.expenseSummary' | 'table.travelSummary'
  | 'list.leaveByType' | 'list.expenseByStatus' | 'list.travelByStatus'
  | 'list.upcomingBirthdays' | 'list.upcomingAnniversaries'

interface TileDef {
  id:          TileId
  label:       string
  description: string
  category:    'kpi' | 'table' | 'list'
  defaultSize: TileSize
  icon:        React.ElementType
}

const TILE_CATALOG: TileDef[] = [
  // KPIs
  { id: 'kpi.leaveDays',         label: 'Total leave days',     description: 'Days off in range',           category: 'kpi', defaultSize: 'sm', icon: CalendarDays },
  { id: 'kpi.leaveRequests',     label: 'Leave requests',       description: 'Submissions in range',        category: 'kpi', defaultSize: 'sm', icon: TrendingUp },
  { id: 'kpi.approvedLeaves',    label: 'Approved leaves',      description: 'Approved count',              category: 'kpi', defaultSize: 'sm', icon: CheckCircle },
  { id: 'kpi.expenseTotal',      label: 'Total expense (₹)',    description: 'Sum of all claims',           category: 'kpi', defaultSize: 'sm', icon: Receipt },
  { id: 'kpi.expensePaid',       label: 'Paid out (₹)',         description: 'Sum reimbursed',              category: 'kpi', defaultSize: 'sm', icon: IndianRupee },
  { id: 'kpi.expensePending',    label: 'Pending payout (₹)',   description: 'Awaiting payout',             category: 'kpi', defaultSize: 'sm', icon: Clock },
  { id: 'kpi.travelRequests',    label: 'Travel requests',      description: 'All travel submissions',      category: 'kpi', defaultSize: 'sm', icon: Plane },
  { id: 'kpi.travelApproved',    label: 'Travel approved',      description: 'Cleared trips',               category: 'kpi', defaultSize: 'sm', icon: CheckCircle },
  { id: 'kpi.upcomingBirthdays', label: 'Upcoming birthdays',   description: 'Next 30 days · CRM',          category: 'kpi', defaultSize: 'sm', icon: Cake },
  { id: 'kpi.leaveTypes',        label: 'Leave types in use',   description: 'Distinct categories',         category: 'kpi', defaultSize: 'sm', icon: Layers },
  // Tables
  { id: 'table.leaveSummary',    label: 'Leave summary by employee',   description: 'Sortable table · CSV/XLSX export',  category: 'table', defaultSize: 'lg', icon: TrendingUp },
  { id: 'table.expenseSummary',  label: 'Expense summary by employee', description: 'Sortable table · CSV/XLSX export',  category: 'table', defaultSize: 'lg', icon: Receipt },
  { id: 'table.travelSummary',   label: 'Travel summary by employee',  description: 'Estimates and approval count',      category: 'table', defaultSize: 'lg', icon: Plane },
  // Lists
  { id: 'list.leaveByType',      label: 'Leave by type',         description: 'Days + request counts per type',     category: 'list', defaultSize: 'md', icon: BarChart3 },
  { id: 'list.expenseByStatus',  label: 'Expense by status',     description: 'Amount + count by stage',            category: 'list', defaultSize: 'md', icon: BarChart3 },
  { id: 'list.travelByStatus',   label: 'Travel by status',      description: 'Estimates by stage',                 category: 'list', defaultSize: 'md', icon: BarChart3 },
  { id: 'list.upcomingBirthdays',    label: 'Upcoming birthdays',     description: 'Next 30 days · employees + CRM contacts',  category: 'list', defaultSize: 'md', icon: Cake },
  { id: 'list.upcomingAnniversaries',label: 'Work anniversaries',     description: 'Next 30 days · employees',                 category: 'list', defaultSize: 'md', icon: Sparkles },
]

const DEFAULT_LAYOUT: LayoutEntry[] = [
  { id: 'kpi.leaveDays',         size: 'sm' },
  { id: 'kpi.expenseTotal',      size: 'sm' },
  { id: 'kpi.expensePaid',       size: 'sm' },
  { id: 'kpi.upcomingBirthdays', size: 'sm' },
  { id: 'table.leaveSummary',    size: 'lg' },
  { id: 'table.expenseSummary',  size: 'lg' },
  { id: 'list.leaveByType',      size: 'md' },
  { id: 'list.expenseByStatus',  size: 'md' },
  { id: 'list.upcomingBirthdays',size: 'md' },
]

const LAYOUT_KEY = 'doppeldash-reports-layout-v1'

const tileById = (id: TileId) => TILE_CATALOG.find(t => t.id === id)
function loadLayout(): LayoutEntry[] {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    return (JSON.parse(raw) as LayoutEntry[]).filter(e => tileById(e.id))
  } catch { return DEFAULT_LAYOUT }
}
function saveLayout(l: LayoutEntry[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)) } catch { /* quota */ }
}

const DATE_PRESETS = [
  { label: 'Today',         fn: () => { const d = new Date().toISOString().slice(0,10); return { from: d, to: d } } },
  { label: 'Last 7 days',   fn: () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate()-6); return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10) } } },
  { label: 'This month',    fn: () => { const t = new Date(); return { from: new Date(t.getFullYear(), t.getMonth(), 1).toISOString().slice(0,10), to: t.toISOString().slice(0,10) } } },
  { label: 'Last 3 months', fn: () => { const t = new Date(); const f = new Date(t); f.setMonth(f.getMonth()-3); return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10) } } },
  { label: 'This year',     fn: () => { const t = new Date(); return { from: `${t.getFullYear()}-01-01`, to: t.toISOString().slice(0,10) } } },
]

const AVATAR_GRADIENTS = ['from-brand-400 to-brand-600','from-[#003B73] to-[#0057A8]','from-orange-400 to-red-500','from-emerald-400 to-green-600','from-pink-400 to-rose-500','from-cyan-400 to-teal-600']
const avatarGradient = (name: string) => AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length]
const initialsOf = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/* ════════════════════════════════════════════════════════════════════════════
   Exporters
   ══════════════════════════════════════════════════════════════════════════ */

function downloadBlob(content: string | Blob, filename: string, mime: string) {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const a    = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

function exportLeaveCSV(data: LeaveRow[]) {
  const rows = data.map(r => [`"${r._id.userName}"`, r.totalRequests, r.totalDays, r.approved, r.rejected])
  const csv  = [['Employee','Requests','Days Taken','Approved','Rejected'].join(','), ...rows.map(r => r.join(','))].join('\n')
  downloadBlob(csv, `leave-report-${Date.now()}.csv`, 'text/csv')
}
function exportExpenseCSV(data: ExpenseRow[]) {
  const rows = data.map(r => [`"${r._id.userName}"`, r.totalRequests, r.totalAmount, r.paid, r.pending])
  const csv  = [['Employee','Requests','Total (₹)','Paid (₹)','Pending (₹)'].join(','), ...rows.map(r => r.join(','))].join('\n')
  downloadBlob(csv, `expense-report-${Date.now()}.csv`, 'text/csv')
}
function exportTravelCSV(data: TravelRow[]) {
  const rows = data.map(r => [`"${r._id.userName}"`, r.totalRequests, r.totalEstimate, r.approved])
  const csv  = [['Employee','Requests','Estimated (₹)','Approved'].join(','), ...rows.map(r => r.join(','))].join('\n')
  downloadBlob(csv, `travel-report-${Date.now()}.csv`, 'text/csv')
}

async function exportXLSX(rows: (string | number)[][], header: string[], sheet: string, filename: string) {
  const { utils, writeFile } = await import('xlsx')
  const ws = utils.aoa_to_sheet([header, ...rows])
  const wb = utils.book_new(); utils.book_append_sheet(wb, ws, sheet)
  writeFile(wb, filename)
}

async function exportFullPDF(d: ReportData, dateLabel: string) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF()
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text('DoppelDash — Report', 14, 20)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text(`Doppelmayr India  |  ${dateLabel}  |  Generated ${new Date().toLocaleDateString('en-IN')}`, 14, 27)
  let y = 36
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('Leave summary', 14, y); y += 4
  autoTable(doc, {
    startY: y,
    head: [['Employee','Requests','Days','Approved','Rejected']],
    body: d.leaveSummary.map(r => [r._id.userName, r.totalRequests, r.totalDays, r.approved, r.rejected]),
    styles: { fontSize: 9 }, headStyles: { fillColor: [0, 87, 168] },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('Expense summary', 14, y); y += 4
  autoTable(doc, {
    startY: y,
    head: [['Employee','Requests','Total','Paid','Pending']],
    body: d.expenseSummary.map(r => [r._id.userName, r.totalRequests, `Rs.${r.totalAmount.toLocaleString('en-IN')}`, `Rs.${r.paid.toLocaleString('en-IN')}`, `Rs.${r.pending.toLocaleString('en-IN')}`]),
    styles: { fontSize: 9 }, headStyles: { fillColor: [0, 87, 168] },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  if (d.travelSummary.length) {
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text('Travel summary', 14, y); y += 4
    autoTable(doc, {
      startY: y,
      head: [['Employee','Requests','Estimated','Approved']],
      body: d.travelSummary.map(r => [r._id.userName, r.totalRequests, `Rs.${r.totalEstimate.toLocaleString('en-IN')}`, r.approved]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [0, 87, 168] },
    })
  }
  doc.save(`doppeldash-report-${Date.now()}.pdf`)
}

/* ════════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */

export default function ReportsPage() {
  const [data,    setData]    = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutEntry[]>(DEFAULT_LAYOUT)

  useEffect(() => { setLayout(loadLayout()) }, [])
  useEffect(() => { saveLayout(layout) }, [layout])

  const dateLabel = from || to ? `${from || '…'} → ${to || '…'}` : 'All time'

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to',   to)
    try {
      const res  = await fetch(`/api/reports?${params}`)
      const json = await res.json()
      setData(json)
    } catch { setData(null) }
    finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { fetchData() }, [fetchData])

  const activeIds = useMemo(() => new Set(layout.map(l => l.id)), [layout])
  const available = TILE_CATALOG.filter(t => !activeIds.has(t.id))

  const addTile    = (id: TileId) => {
    const def = tileById(id); if (!def) return
    setLayout(l => [...l, { id, size: def.defaultSize }])
    setCatalogOpen(false)
  }
  const removeTile = (idx: number) => setLayout(l => l.filter((_, i) => i !== idx))
  const moveTile   = (idx: number, dir: -1 | 1) => setLayout(l => {
    const j = idx + dir
    if (j < 0 || j >= l.length) return l
    const next = l.slice()
    ;[next[idx], next[j]] = [next[j], next[idx]]
    return next
  })
  const cycleSize  = (idx: number) => setLayout(l => {
    const sizes: TileSize[] = ['sm', 'md', 'lg']
    return l.map((e, i) => i === idx ? { ...e, size: sizes[(sizes.indexOf(e.size) + 1) % 3] } : e)
  })
  const resetLayout = () => setLayout(DEFAULT_LAYOUT)

  return (
    <>
      <Header title="Reports" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#003B73] to-[#0057A8] flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">Reports</p>
              <p className="text-xs text-surface-muted truncate">{layout.length} tile{layout.length !== 1 ? 's' : ''} · {dateLabel}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {data && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => exportFullPDF(data, dateLabel)}>
                <FileText className="w-3.5 h-3.5" /> Full PDF
              </Button>
            )}
            <Button type="button" variant={showFilter ? 'default' : 'outline'} size="sm" className="gap-1.5"
              onClick={() => setShowFilter(f => !f)}>
              <Filter className="w-3.5 h-3.5" /> Date range
            </Button>
            <Button type="button" variant={editMode ? 'default' : 'outline'} size="sm" className="gap-1.5"
              onClick={() => setEditMode(e => !e)}>
              {editMode ? <CheckCircle className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
              {editMode ? 'Done' : 'Edit layout'}
            </Button>
          </div>
        </div>

        {/* Date filter */}
        {showFilter && (
          <div className="bg-white rounded-2xl border border-surface-border p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {DATE_PRESETS.map(({ label, fn }) => (
                <button key={label} type="button"
                  onClick={() => { const r = fn(); setFrom(r.from); setTo(r.to) }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface border border-surface-border text-gray-600 hover:border-brand-400 hover:text-brand-600 transition-all">
                  {label}
                </button>
              ))}
              {(from || to) && (
                <button type="button" onClick={() => { setFrom(''); setTo('') }}
                  className="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">From</label>
                <input type="date" aria-label="Report from date" value={from} onChange={e => setFrom(e.target.value)}
                  className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">To</label>
                <input type="date" aria-label="Report to date" value={to} min={from} onChange={e => setTo(e.target.value)}
                  className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
              </div>
            </div>
          </div>
        )}

        {/* Edit-mode banner */}
        {editMode && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-brand-50 border border-brand-200 flex-wrap">
            <p className="text-xs font-semibold text-brand-700 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Edit mode — reorder, resize, remove tiles. Saved to your browser.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setCatalogOpen(true)}>
                <Plus className="w-3.5 h-3.5" /> Add tile
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                onClick={resetLayout}>
                <RotateCcw className="w-3.5 h-3.5" /> Reset to default
              </Button>
            </div>
          </div>
        )}

        {/* Tile grid */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-surface-border p-5 space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-8 w-1/2" />
              </div>
            ))}
          </div>
        ) : !data ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-surface-border">
            <BarChart3 className="w-12 h-12 text-brand-200 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No report data yet</p>
            <p className="text-sm text-surface-muted mt-1">Reports populate as leave, expense, and travel records are created.</p>
          </div>
        ) : layout.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-surface-border">
            <Layers className="w-12 h-12 text-brand-200 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">Your report is empty</p>
            <p className="text-sm text-surface-muted mt-1 mb-4">Add tiles to build a tailored report.</p>
            <Button type="button" className="gap-2" onClick={() => { setEditMode(true); setCatalogOpen(true) }}>
              <Plus className="w-4 h-4" /> Add your first tile
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-min">
            <SortableTileGrid
              items={layout.map((e, idx) => ({ id: `${idx}::${e.id}`, tileId: e.id, size: e.size, origIdx: idx }))}
              editing={editMode}
              onReorder={(next) => setLayout(next.map(n => ({ id: n.tileId, size: n.size })))}
              className="contents"
              renderTile={(entry) => {
                const origIdx = entry.origIdx
                const real    = layout[origIdx]
                const def     = tileById(real.id); if (!def) return null
                const colSpan = real.size === 'sm' ? 'col-span-2 sm:col-span-1' :
                                real.size === 'md' ? 'col-span-2' :
                                                     'col-span-2 lg:col-span-4'
                return (
                  <div className={`${colSpan} relative group`}>
                    {editMode && (
                      <div className="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 bg-white border border-surface-border rounded-full shadow-md p-0.5">
                        <button type="button" aria-label="Move up" disabled={origIdx === 0}
                          onClick={() => moveTile(origIdx, -1)}
                          className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" aria-label="Move down" disabled={origIdx === layout.length - 1}
                          onClick={() => moveTile(origIdx, 1)}
                          className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" aria-label="Cycle size" title={`Size: ${real.size}`}
                          onClick={() => cycleSize(origIdx)}
                          className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-surface transition-colors">
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" aria-label="Remove tile"
                          onClick={() => removeTile(origIdx)}
                          className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 text-red-500 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <TileBody def={def} data={data} dateLabel={dateLabel} />
                  </div>
                )
              }}
            />

            {editMode && (
              <button type="button" onClick={() => setCatalogOpen(true)}
                className="col-span-2 lg:col-span-1 min-h-[120px] flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-surface-border hover:border-brand-400 hover:bg-brand-50/30 transition-colors text-surface-muted hover:text-brand-600">
                <Plus className="w-5 h-5" />
                <span className="text-xs font-semibold">Add tile</span>
              </button>
            )}
          </div>
        )}

        {/* Catalog */}
        <Dialog.Root open={catalogOpen} onOpenChange={setCatalogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
            <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Add a tile</Dialog.Title>
              <Dialog.Description className="text-sm text-surface-muted mb-5">
                Pick a metric, summary table, or breakdown to add to your report.
              </Dialog.Description>
              {available.length === 0 ? (
                <div className="text-center py-10">
                  <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="font-semibold text-gray-700">Every tile is already on your report.</p>
                  <p className="text-xs text-surface-muted mt-1">Remove some to free up slots.</p>
                </div>
              ) : (
                ['kpi', 'table', 'list'].map(cat => {
                  const inCat = available.filter(t => t.category === cat)
                  if (inCat.length === 0) return null
                  return (
                    <div key={cat} className="mb-5 last:mb-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2">
                        {cat === 'kpi' ? 'KPI tiles' : cat === 'table' ? 'Summary tables' : 'Breakdown lists'}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {inCat.map(t => {
                          const Icon = t.icon
                          return (
                            <button key={t.id} type="button" onClick={() => addTile(t.id)}
                              className="flex items-start gap-3 p-3 rounded-xl border border-surface-border hover:border-brand-400 hover:bg-brand-50/30 transition-colors text-left">
                              <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                                <Icon className="w-4 h-4 text-brand-600" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-gray-900">{t.label}</p>
                                <p className="text-[11px] text-surface-muted leading-tight">{t.description}</p>
                              </div>
                              <Plus className="w-4 h-4 text-surface-muted flex-shrink-0 mt-1" />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}
              <div className="flex justify-end mt-5 pt-4 border-t border-surface-border">
                <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Close</Button></Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </main>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Tile body
   ══════════════════════════════════════════════════════════════════════════ */

function TileBody({ def, data, dateLabel }: { def: TileDef; data: ReportData; dateLabel: string }) {
  switch (def.id) {
    case 'kpi.leaveDays':
      return <KpiTile def={def} value={data.leaveSummary.reduce((s, r) => s + r.totalDays, 0)} hint={`${data.leaveSummary.reduce((s, r) => s + r.totalRequests, 0)} requests`} />
    case 'kpi.leaveRequests':
      return <KpiTile def={def} value={data.leaveSummary.reduce((s, r) => s + r.totalRequests, 0)} hint={`${data.leaveSummary.length} employee${data.leaveSummary.length !== 1 ? 's' : ''}`} />
    case 'kpi.approvedLeaves':
      return <KpiTile def={def} value={data.leaveSummary.reduce((s, r) => s + r.approved, 0)} hint="Approved count" tone="success" />
    case 'kpi.expenseTotal':
      return <KpiTile def={def} value={inr(data.expenseSummary.reduce((s, r) => s + r.totalAmount, 0))} hint={`${data.expenseSummary.reduce((s, r) => s + r.totalRequests, 0)} claims`} />
    case 'kpi.expensePaid':
      return <KpiTile def={def} value={inr(data.expenseSummary.reduce((s, r) => s + r.paid, 0))} hint="Reimbursed" tone="success" />
    case 'kpi.expensePending':
      const pend = data.expenseSummary.reduce((s, r) => s + r.pending, 0)
      return <KpiTile def={def} value={inr(pend)} hint="Awaiting payout" tone={pend > 0 ? 'warning' : 'neutral'} />
    case 'kpi.travelRequests':
      return <KpiTile def={def} value={data.travelSummary.reduce((s, r) => s + r.totalRequests, 0)} hint={`${data.travelSummary.length} employee${data.travelSummary.length !== 1 ? 's' : ''}`} />
    case 'kpi.travelApproved':
      return <KpiTile def={def} value={data.travelSummary.reduce((s, r) => s + r.approved, 0)} hint="Cleared trips" tone="success" />
    case 'kpi.upcomingBirthdays':
      return <KpiTile def={def} value={data.upcomingBirthdays.length} hint="Next 30 days · CRM" />
    case 'kpi.leaveTypes':
      return <KpiTile def={def} value={data.leaveByType.length} hint="Distinct categories" />

    case 'table.leaveSummary':
      return <LeaveSummaryTile def={def} rows={data.leaveSummary} dateLabel={dateLabel} />
    case 'table.expenseSummary':
      return <ExpenseSummaryTile def={def} rows={data.expenseSummary} dateLabel={dateLabel} />
    case 'table.travelSummary':
      return <TravelSummaryTile def={def} rows={data.travelSummary} dateLabel={dateLabel} />

    case 'list.leaveByType':
      return <LeaveByTypeTile def={def} rows={data.leaveByType} />
    case 'list.expenseByStatus':
      return <ExpenseByStatusTile def={def} rows={data.expenseByStatus} />
    case 'list.travelByStatus':
      return <TravelByStatusTile def={def} rows={data.travelByStatus} />
    case 'list.upcomingBirthdays':
      return <BirthdaysTile def={def} rows={data.upcomingBirthdays} />
    case 'list.upcomingAnniversaries':
      return <BirthdaysTile def={def} rows={data.upcomingAnniversaries} />
    default:
      return null
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   Primitives
   ══════════════════════════════════════════════════════════════════════════ */

function KpiTile({ def, value, hint, tone = 'neutral' }: {
  def: TileDef; value: number | string; hint?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const valueColor = {
    neutral: 'text-dm-graphite',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger:  'text-red-600',
  }[tone]
  const Icon = def.icon
  return (
    <div className="bg-white rounded-2xl border border-surface-border p-4 h-full flex flex-col justify-between min-h-[120px]">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">{def.label}</p>
        <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-surface-muted" />
        </div>
      </div>
      <div>
        <p className={`text-3xl font-extrabold tabular-nums tracking-tighter ${valueColor}`}>{value}</p>
        {hint && <p className="text-[11px] text-surface-muted mt-1 truncate">{hint}</p>}
      </div>
    </div>
  )
}

function TileShell({ def, actions, children }: { def: TileDef; actions?: React.ReactNode; children: React.ReactNode }) {
  const Icon = def.icon
  return (
    <div className="bg-white rounded-2xl border border-surface-border overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-brand-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{def.label}</p>
            <p className="text-[11px] text-surface-muted truncate">{def.description}</p>
          </div>
        </div>
        {actions && <div className="flex gap-1.5 flex-shrink-0">{actions}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function AvatarCell({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${avatarGradient(name)} flex items-center justify-center flex-shrink-0`}>
        <span className="text-white font-bold text-[9px]">{initialsOf(name)}</span>
      </div>
      <span className="font-semibold text-gray-900 truncate">{name}</span>
    </div>
  )
}

function LeaveSummaryTile({ def, rows, dateLabel }: { def: TileDef; rows: LeaveRow[]; dateLabel: string }) {
  const xlsx = () => exportXLSX(
    rows.map(r => [r._id.userName, r.totalRequests, r.totalDays, r.approved, r.rejected]),
    ['Employee','Requests','Days','Approved','Rejected'], 'Leave Report', `leave-report-${Date.now()}.xlsx`
  )
  return (
    <TileShell def={def} actions={rows.length > 0 ? (
      <>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={xlsx} title={`Range: ${dateLabel}`}>
          <FileSpreadsheet className="w-3 h-3" /> XLSX
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={() => exportLeaveCSV(rows)}>
          <Download className="w-3 h-3" /> CSV
        </Button>
      </>
    ) : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm text-surface-muted py-8 text-center">No leave data for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface">
                {['Employee','Requests','Days','Approved','Rejected'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-widest text-surface-muted py-3 px-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id.userId} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                  <td className="py-3 px-5"><AvatarCell name={r._id.userName} /></td>
                  <td className="py-3 px-5 text-surface-muted">{r.totalRequests}</td>
                  <td className="py-3 px-5"><span className="font-bold text-dm-graphite">{r.totalDays}</span> <span className="text-surface-muted">days</span></td>
                  <td className="py-3 px-5"><span className="font-semibold text-emerald-600">{r.approved}</span></td>
                  <td className="py-3 px-5"><span className="font-semibold text-red-600">{r.rejected}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TileShell>
  )
}

function ExpenseSummaryTile({ def, rows, dateLabel }: { def: TileDef; rows: ExpenseRow[]; dateLabel: string }) {
  const xlsx = () => exportXLSX(
    rows.map(r => [r._id.userName, r.totalRequests, r.totalAmount, r.paid, r.pending]),
    ['Employee','Requests','Total','Paid','Pending'], 'Expense Report', `expense-report-${Date.now()}.xlsx`
  )
  return (
    <TileShell def={def} actions={rows.length > 0 ? (
      <>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={xlsx} title={`Range: ${dateLabel}`}>
          <FileSpreadsheet className="w-3 h-3" /> XLSX
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={() => exportExpenseCSV(rows)}>
          <Download className="w-3 h-3" /> CSV
        </Button>
      </>
    ) : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm text-surface-muted py-8 text-center">No expense data for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface">
                {['Employee','Claims','Total','Paid','Pending'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-widest text-surface-muted py-3 px-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id.userId} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                  <td className="py-3 px-5"><AvatarCell name={r._id.userName} /></td>
                  <td className="py-3 px-5 text-surface-muted">{r.totalRequests}</td>
                  <td className="py-3 px-5 font-bold text-dm-graphite">{inr(r.totalAmount)}</td>
                  <td className="py-3 px-5 font-semibold text-emerald-600">{inr(r.paid)}</td>
                  <td className="py-3 px-5 font-semibold text-amber-600">{inr(r.pending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TileShell>
  )
}

function TravelSummaryTile({ def, rows, dateLabel }: { def: TileDef; rows: TravelRow[]; dateLabel: string }) {
  const xlsx = () => exportXLSX(
    rows.map(r => [r._id.userName, r.totalRequests, r.totalEstimate, r.approved]),
    ['Employee','Requests','Estimated','Approved'], 'Travel Report', `travel-report-${Date.now()}.xlsx`
  )
  return (
    <TileShell def={def} actions={rows.length > 0 ? (
      <>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={xlsx} title={`Range: ${dateLabel}`}>
          <FileSpreadsheet className="w-3 h-3" /> XLSX
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={() => exportTravelCSV(rows)}>
          <Download className="w-3 h-3" /> CSV
        </Button>
      </>
    ) : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm text-surface-muted py-8 text-center">No travel data for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface">
                {['Employee','Requests','Estimated','Approved'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-widest text-surface-muted py-3 px-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id.userId} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                  <td className="py-3 px-5"><AvatarCell name={r._id.userName} /></td>
                  <td className="py-3 px-5 text-surface-muted">{r.totalRequests}</td>
                  <td className="py-3 px-5 font-bold text-dm-graphite">{inr(r.totalEstimate)}</td>
                  <td className="py-3 px-5 font-semibold text-emerald-600">{r.approved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TileShell>
  )
}

function LeaveByTypeTile({ def, rows }: { def: TileDef; rows: TypeBucket[] }) {
  return (
    <TileShell def={def}>
      <div className="p-4 space-y-2.5">
        {rows.length === 0 ? <p className="text-sm text-surface-muted">No data.</p> : rows.map(t => (
          <div key={t._id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-500" />
              <span className="text-sm capitalize font-medium text-gray-700">{t._id}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gray-900">{t.days} days</span>
              <span className="text-xs text-surface-muted ml-2">{t.count} req</span>
            </div>
          </div>
        ))}
      </div>
    </TileShell>
  )
}

function ExpenseByStatusTile({ def, rows }: { def: TileDef; rows: StatusBucket[] }) {
  return (
    <TileShell def={def}>
      <div className="p-4 space-y-2.5">
        {rows.length === 0 ? <p className="text-sm text-surface-muted">No data.</p> : rows.map(s => (
          <div key={s._id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm capitalize font-medium text-gray-700">{s._id.replace(/_/g, ' ')}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gray-900">{inr(s.amount ?? 0)}</span>
              <span className="text-xs text-surface-muted ml-2">{s.count} req</span>
            </div>
          </div>
        ))}
      </div>
    </TileShell>
  )
}

function TravelByStatusTile({ def, rows }: { def: TileDef; rows: StatusBucket[] }) {
  return (
    <TileShell def={def}>
      <div className="p-4 space-y-2.5">
        {rows.length === 0 ? <p className="text-sm text-surface-muted">No data.</p> : rows.map(s => (
          <div key={s._id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#0057A8]" />
              <span className="text-sm capitalize font-medium text-gray-700">{s._id.replace(/_/g, ' ')}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gray-900">{inr(s.total ?? 0)}</span>
              <span className="text-xs text-surface-muted ml-2">{s.count} req</span>
            </div>
          </div>
        ))}
      </div>
    </TileShell>
  )
}

function BirthdaysTile({ def, rows }: { def: TileDef; rows: BirthdayRow[] }) {
  const isAnniv = def.id === 'list.upcomingAnniversaries'
  return (
    <TileShell def={def}>
      <div className="p-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <Users className="w-8 h-8 text-brand-200 mb-2" />
            <p className="text-sm text-surface-muted">
              {isAnniv ? 'No work anniversaries in the next 30 days.' : 'No birthdays in the next 30 days.'}
            </p>
            <p className="text-xs text-surface-muted mt-0.5">
              {isAnniv
                ? 'Joining dates come from employee records.'
                : 'Employee DOBs come from onboarding; CRM contact DOBs from the contact card.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {rows.map((b, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  {b.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.photo} alt={b.name} className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${avatarGradient(b.name)} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white font-bold text-[10px]">{initialsOf(b.name)}</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{b.name}</p>
                      {b.source === 'employee' && (
                        <span className="text-[9px] font-bold px-1.5 py-0 rounded-full bg-brand-50 text-brand-700 border border-brand-200">Team</span>
                      )}
                    </div>
                    {b.company && <p className="text-xs text-surface-muted truncate">{b.company}</p>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-xs font-bold text-brand-600">
                    {b.daysUntil === 0 ? 'Today' : `In ${b.daysUntil} day${b.daysUntil > 1 ? 's' : ''}`}
                  </p>
                  <p className="text-[10px] text-surface-muted">
                    {new Date(b.date).toLocaleDateString('en-IN', { day:'numeric', month:'long' })}
                    {isAnniv && b.years !== undefined && ` · ${b.years}y`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TileShell>
  )
}
