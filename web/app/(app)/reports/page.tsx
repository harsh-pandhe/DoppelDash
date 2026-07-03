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
import { ErrorState } from '@/components/ui/error-state'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import { SortableTileGrid } from '@/components/SortableTileGrid'
import { brandedPDF, brandedXLSX, brandedCSV, fmtDate } from '@/lib/export'

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

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

const DATE_PRESETS = [
  { label: 'Today',         fn: () => { const d = ymd(new Date()); return { from: d, to: d } } },
  { label: 'Last 7 days',   fn: () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate()-6); return { from: ymd(f), to: ymd(t) } } },
  { label: 'This month',    fn: () => { const t = new Date(); return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: ymd(t) } } },
  { label: 'Last 3 months', fn: () => { const t = new Date(); const f = new Date(t); f.setMonth(f.getMonth()-3); return { from: ymd(f), to: ymd(t) } } },
  { label: 'This year',     fn: () => { const t = new Date(); return { from: `${t.getFullYear()}-01-01`, to: ymd(t) } } },
]

const AVATAR_GRADIENTS = ['from-brand-400 to-brand-600','from-[#003B73] to-[#0057A8]','from-orange-400 to-red-500','from-emerald-400 to-green-600','from-pink-400 to-rose-500','from-cyan-400 to-teal-600']
const avatarGradient = (name: string) => AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length]
const initialsOf = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/* ════════════════════════════════════════════════════════════════════════════
   Exporters
   ══════════════════════════════════════════════════════════════════════════ */

function exportLeaveCSV(data: LeaveRow[]) {
  brandedCSV({
    title: 'Leave Report', subtitle: 'By employee',
    head: ['Employee','Requests','Days Taken','Approved','Rejected'],
    rows: data.map(r => [r._id.userName, r.totalRequests, r.totalDays, r.approved, r.rejected]),
    filename: `leave-report-${fmtDate()}.csv`,
  })
}
function exportExpenseCSV(data: ExpenseRow[]) {
  brandedCSV({
    title: 'Expense Report', subtitle: 'By employee',
    head: ['Employee','Requests','Total (Rs.)','Paid (Rs.)','Pending (Rs.)'],
    rows: data.map(r => [r._id.userName, r.totalRequests, r.totalAmount, r.paid, r.pending]),
    filename: `expense-report-${fmtDate()}.csv`,
  })
}
function exportTravelCSV(data: TravelRow[]) {
  brandedCSV({
    title: 'Travel Report', subtitle: 'By employee',
    head: ['Employee','Requests','Estimated (Rs.)','Approved'],
    rows: data.map(r => [r._id.userName, r.totalRequests, r.totalEstimate, r.approved]),
    filename: `travel-report-${fmtDate()}.csv`,
  })
}

async function exportFullPDF(d: ReportData, dateLabel: string) {
  const sections = [
    {
      title: 'Leave summary',
      head: ['Employee','Requests','Days','Approved','Rejected'],
      rows: d.leaveSummary.map(r => [r._id.userName, r.totalRequests, r.totalDays, r.approved, r.rejected]),
    },
    {
      title: 'Expense summary',
      head: ['Employee','Requests','Total','Paid','Pending'],
      rows: d.expenseSummary.map(r => [r._id.userName, r.totalRequests, `Rs.${r.totalAmount.toLocaleString('en-IN')}`, `Rs.${r.paid.toLocaleString('en-IN')}`, `Rs.${r.pending.toLocaleString('en-IN')}`]),
    },
    ...(d.travelSummary.length ? [{
      title: 'Travel summary',
      head: ['Employee','Requests','Estimated','Approved'],
      rows: d.travelSummary.map(r => [r._id.userName, r.totalRequests, `Rs.${r.totalEstimate.toLocaleString('en-IN')}`, r.approved]),
    }] : []),
  ]
  await brandedPDF({ title: 'Management Report', subtitle: dateLabel, sections, filename: `doppeldash-report-${fmtDate()}.pdf` })
}

/* ════════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */

export default function ReportsPage() {
  const [data,    setData]    = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
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
      if (!res.ok) throw new Error()
      const json = await res.json()
      setData(json)
      setError(false)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setData(null)
      setError(true)
    }
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
              <p className="text-sm font-bold text-ink">Reports</p>
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
          <div className="bg-surface-1 rounded-2xl border border-surface-border p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {DATE_PRESETS.map(({ label, fn }) => (
                <button key={label} type="button"
                  onClick={() => { const r = fn(); setFrom(r.from); setTo(r.to) }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface border border-surface-border text-ink-muted hover:border-brand-400 hover:text-brand-600 transition-all">
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
              <div key={i} className="bg-surface-1 rounded-2xl border border-surface-border p-5 space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-8 w-1/2" />
              </div>
            ))}
          </div>
        ) : !data ? (
          error ? (
            <div className="bg-surface-1 rounded-2xl border border-surface-border">
              <ErrorState onRetry={() => fetchData()} variant="block" />
            </div>
          ) : (
            <div className="text-center py-20 bg-surface-1 rounded-2xl border border-surface-border">
              <BarChart3 className="w-12 h-12 text-brand-200 mx-auto mb-3" />
              <p className="font-semibold text-ink">No report data yet</p>
              <p className="text-sm text-surface-muted mt-1">Reports populate as leave, expense, and travel records are created.</p>
            </div>
          )
        ) : layout.length === 0 ? (
          <div className="text-center py-16 bg-surface-1 rounded-2xl border-2 border-dashed border-surface-border">
            <Layers className="w-12 h-12 text-brand-200 mx-auto mb-3" />
            <p className="font-semibold text-ink">Your report is empty</p>
            <p className="text-sm text-surface-muted mt-1 mb-4">Add tiles to build a tailored report.</p>
            <Button type="button" className="gap-2" onClick={() => { setEditMode(true); setCatalogOpen(true) }}>
              <Plus className="w-4 h-4" /> Add your first tile
            </Button>
          </div>
        ) : (
          <>
            <SortableTileGrid
              items={layout.map((e, idx) => {
                const colSpan = e.size === 'sm' ? 'col-span-2 sm:col-span-1' :
                                e.size === 'md' ? 'col-span-2' :
                                                  'col-span-2 lg:col-span-4'
                return { id: `${idx}::${e.id}`, tileId: e.id, size: e.size, origIdx: idx, className: `${colSpan} group` }
              })}
              editing={editMode}
              onReorder={(next) => setLayout(next.map(n => ({ id: n.tileId, size: n.size })))}
              className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-min"
              renderTile={(entry) => {
                const origIdx = entry.origIdx
                const real    = layout[origIdx]
                const def     = tileById(real.id); if (!def) return null
                return (
                  <>
                    {editMode && (
                      <div className="absolute top-1 right-1 sm:-top-2 sm:-right-2 z-20 flex items-center gap-0.5 bg-surface-1 border border-surface-border rounded-full shadow-md p-0.5">
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
                        <button type="button" aria-label={`Cycle size (currently ${real.size})`} title={`Size: ${real.size} — click to cycle`}
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
                  </>
                )
              }}
            />

            {editMode && (
              <button type="button" onClick={() => setCatalogOpen(true)}
                className="w-full min-h-[80px] mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-surface-border hover:border-brand-400 hover:bg-brand-50/30 transition-colors text-surface-muted hover:text-brand-600">
                <Plus className="w-5 h-5" />
                <span className="text-xs font-semibold">Add tile</span>
              </button>
            )}
          </>
        )}

        {/* Catalog */}
        <Modal open={catalogOpen} onOpenChange={setCatalogOpen} size="2xl">
          <ModalHeader title="Add a tile" description="Pick a metric, summary table, or breakdown to add to your report." />
          <ModalBody>
            {available.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="font-semibold text-ink-muted">Every tile is already on your report.</p>
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
                              <p className="text-sm font-bold text-ink">{t.label}</p>
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
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setCatalogOpen(false)}>Close</Button>
          </ModalFooter>
        </Modal>
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
    neutral: 'text-ink',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger:  'text-red-600',
  }[tone]
  const Icon = def.icon
  return (
    <div className="bg-surface-1 rounded-2xl border border-surface-border p-4 h-full flex flex-col justify-between min-h-[120px]">
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
    <div className="bg-surface-1 rounded-2xl border border-surface-border overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-brand-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink truncate">{def.label}</p>
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
      <span className="font-semibold text-ink truncate">{name}</span>
    </div>
  )
}

function LeaveSummaryTile({ def, rows, dateLabel }: { def: TileDef; rows: LeaveRow[]; dateLabel: string }) {
  const xlsx = () => brandedXLSX({
    title: 'Leave Report', subtitle: dateLabel,
    head: ['Employee','Requests','Days','Approved','Rejected'],
    rows: rows.map(r => [r._id.userName, r.totalRequests, r.totalDays, r.approved, r.rejected]),
    sheet: 'Leave', filename: `leave-report-${fmtDate()}.xlsx`,
  })
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
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <table className="w-full text-sm min-w-[640px]">
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
                  <td className="py-3 px-5"><span className="font-bold text-ink">{r.totalDays}</span> <span className="text-surface-muted">days</span></td>
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
  const xlsx = () => brandedXLSX({
    title: 'Expense Report', subtitle: dateLabel,
    head: ['Employee','Requests','Total','Paid','Pending'],
    rows: rows.map(r => [r._id.userName, r.totalRequests, r.totalAmount, r.paid, r.pending]),
    sheet: 'Expense', filename: `expense-report-${fmtDate()}.xlsx`,
  })
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
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <table className="w-full text-sm min-w-[640px]">
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
                  <td className="py-3 px-5 font-bold text-ink">{inr(r.totalAmount)}</td>
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
  const xlsx = () => brandedXLSX({
    title: 'Travel Report', subtitle: dateLabel,
    head: ['Employee','Requests','Estimated','Approved'],
    rows: rows.map(r => [r._id.userName, r.totalRequests, r.totalEstimate, r.approved]),
    sheet: 'Travel', filename: `travel-report-${fmtDate()}.xlsx`,
  })
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
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <table className="w-full text-sm min-w-[640px]">
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
                  <td className="py-3 px-5 font-bold text-ink">{inr(r.totalEstimate)}</td>
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
              <span className="text-sm capitalize font-medium text-ink-muted">{t._id}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-ink">{t.days} days</span>
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
              <span className="text-sm capitalize font-medium text-ink-muted">{s._id.replace(/_/g, ' ')}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-ink">{inr(s.amount ?? 0)}</span>
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
              <span className="text-sm capitalize font-medium text-ink-muted">{s._id.replace(/_/g, ' ')}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-ink">{inr(s.total ?? 0)}</span>
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
                      <p className="text-sm font-semibold text-ink truncate">{b.name}</p>
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
