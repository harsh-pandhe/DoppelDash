'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  TrendingUp, Filter, Activity, CheckCircle2, Clock, IndianRupee,
  Plane, Megaphone, AlertCircle, CalendarClock, Receipt, Layers,
  Plus, X, ChevronUp, ChevronDown, RotateCcw, Pencil, Sparkles,
  CheckCircle, Building,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import { BarChart, DonutChart } from '@/components/ui/charts'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import * as Dialog from '@radix-ui/react-dialog'
import { timeAgo } from '@/lib/timeAgo'
import { SortableTileGrid } from '@/components/SortableTileGrid'

/* ════════════════════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════════════════ */

interface MonthPoint   { label: string; count: number; days?: number; total?: number }
interface StatusBucket { _id: string; count: number; total?: number }
interface LeaveTypeBucket { _id: string; count: number; days: number }
interface TopSpender { userId: string; userName: string; total: number; count: number }
interface RecentAudit {
  action: string
  performedByName: string
  createdAt: string
  metadata?: Record<string, unknown>
}

interface AnalyticsData {
  range: { from: string; to: string }
  kpis: {
    totalLeaves: number; approvedLeaves: number; pendingLeaves: number
    totalExpenses: number; totalExpenseCount: number
    paidExpense: number; pendingPayout: number; pendingExpensesCount: number
    travelApproved: number; pendingTravel: number
    contactCount: number; contactsWithEmail: number
    announcementCount: number
    leavesIn30d: number; expensesIn30d: number; travelIn30d: number
  }
  leaveByMonth:    MonthPoint[]
  expenseByMonth:  MonthPoint[]
  leaveStatus:     StatusBucket[]
  expenseStatus:   StatusBucket[]
  travelStatus:    StatusBucket[]
  leaveType:       LeaveTypeBucket[]
  topSpenders:     TopSpender[]
  recentAudits:    RecentAudit[]
}

type TileSize = 'sm' | 'md' | 'lg'   // sm = 1col, md = 2col on lg+, lg = full-width
type LayoutEntry = { id: TileId; size: TileSize }

/* ════════════════════════════════════════════════════════════════════════════
   Tile catalog
   ══════════════════════════════════════════════════════════════════════════ */

type TileId =
  | 'kpi.totalLeaves' | 'kpi.approvedLeaves' | 'kpi.pendingLeaves'
  | 'kpi.totalExpenses' | 'kpi.paidExpense' | 'kpi.pendingPayout'
  | 'kpi.travelApproved' | 'kpi.pendingTravel'
  | 'kpi.contacts' | 'kpi.announcements'
  | 'chart.leaveByMonth' | 'chart.expenseByMonth'
  | 'chart.leaveStatus' | 'chart.expenseStatus' | 'chart.travelStatus'
  | 'chart.leaveType' | 'chart.featureUsage30d'
  | 'list.topSpenders' | 'list.recentActivity'

interface TileDef {
  id:           TileId
  label:        string
  description:  string
  category:     'kpi' | 'chart' | 'list'
  defaultSize:  TileSize
  icon:         React.ElementType
}

const TILE_CATALOG: TileDef[] = [
  // KPI tiles (1 column)
  { id: 'kpi.totalLeaves',     label: 'Total leaves',        description: 'Leave requests in range',      category: 'kpi', defaultSize: 'sm', icon: CalendarClock },
  { id: 'kpi.approvedLeaves',  label: 'Approved leaves',     description: 'Approved count',               category: 'kpi', defaultSize: 'sm', icon: CheckCircle2 },
  { id: 'kpi.pendingLeaves',   label: 'Pending leaves',      description: 'Awaiting decision',            category: 'kpi', defaultSize: 'sm', icon: Clock },
  { id: 'kpi.totalExpenses',   label: 'Total expense (₹)',   description: 'Sum of all claims in range',   category: 'kpi', defaultSize: 'sm', icon: Receipt },
  { id: 'kpi.paidExpense',     label: 'Paid out (₹)',        description: 'Sum reimbursed',               category: 'kpi', defaultSize: 'sm', icon: IndianRupee },
  { id: 'kpi.pendingPayout',   label: 'Pending payout (₹)',  description: 'Awaiting payout',              category: 'kpi', defaultSize: 'sm', icon: AlertCircle },
  { id: 'kpi.travelApproved',  label: 'Travel approved',     description: 'Cleared trips',                category: 'kpi', defaultSize: 'sm', icon: Plane },
  { id: 'kpi.pendingTravel',   label: 'Travel pending',      description: 'Awaiting approval',            category: 'kpi', defaultSize: 'sm', icon: Plane },
  { id: 'kpi.contacts',        label: 'CRM contacts',        description: 'Total / with email',           category: 'kpi', defaultSize: 'sm', icon: Building },
  { id: 'kpi.announcements',   label: 'Announcements',       description: 'Total posted',                 category: 'kpi', defaultSize: 'sm', icon: Megaphone },
  // Charts (2 columns)
  { id: 'chart.leaveByMonth',   label: 'Leave requests by month', description: 'Bar chart over selected range', category: 'chart', defaultSize: 'md', icon: TrendingUp },
  { id: 'chart.expenseByMonth', label: 'Expense ₹ by month',      description: 'Submitted value over range',    category: 'chart', defaultSize: 'md', icon: TrendingUp },
  { id: 'chart.leaveStatus',    label: 'Leave status breakdown',  description: 'Donut: approved / pending / rejected', category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.expenseStatus',  label: 'Expense status breakdown',description: 'Donut by stage',                category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.travelStatus',   label: 'Travel status breakdown', description: 'Donut by stage',                category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.leaveType',      label: 'Leave by type',           description: 'Casual / sick / earned etc.',   category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.featureUsage30d',label: 'Feature usage · 30 days', description: 'Leaves vs expenses vs travel',  category: 'chart', defaultSize: 'md', icon: Activity },
  // Lists
  { id: 'list.topSpenders',     label: 'Top spenders',     description: 'Highest reimbursed in range',   category: 'list', defaultSize: 'md', icon: TrendingUp },
  { id: 'list.recentActivity',  label: 'Recent activity',  description: 'Latest audit log entries',      category: 'list', defaultSize: 'lg', icon: Activity },
]

const DEFAULT_LAYOUT: LayoutEntry[] = [
  { id: 'kpi.pendingLeaves',    size: 'sm' },
  { id: 'kpi.pendingPayout',    size: 'sm' },
  { id: 'kpi.pendingTravel',    size: 'sm' },
  { id: 'kpi.paidExpense',      size: 'sm' },
  { id: 'chart.leaveByMonth',   size: 'md' },
  { id: 'chart.expenseByMonth', size: 'md' },
  { id: 'chart.leaveStatus',    size: 'md' },
  { id: 'chart.expenseStatus',  size: 'md' },
  { id: 'list.topSpenders',     size: 'md' },
  { id: 'list.recentActivity',  size: 'lg' },
]

const LAYOUT_KEY = 'doppeldash-analytics-layout-v1'

function tileById(id: TileId): TileDef | undefined {
  return TILE_CATALOG.find(t => t.id === id)
}

function loadLayout(): LayoutEntry[] {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as LayoutEntry[]
    return parsed.filter(e => tileById(e.id))   // drop unknown ids
  } catch { return DEFAULT_LAYOUT }
}

function saveLayout(layout: LayoutEntry[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* quota */ }
}

/* ════════════════════════════════════════════════════════════════════════════
   Style maps
   ══════════════════════════════════════════════════════════════════════════ */

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: '#FBBF24', approved: '#0a7d3b', rejected: '#c83838',
}
const EXPENSE_STATUS_COLORS: Record<string, string> = {
  pending_manager: '#FBBF24', pending_boss: '#0057A8', paid: '#0a7d3b', rejected: '#c83838', returned: '#F97316',
}
const TRAVEL_STATUS_COLORS: Record<string, string> = {
  pending_manager: '#FBBF24', pending_boss: '#0057A8', approved: '#0a7d3b', rejected: '#c83838', cancelled: '#94A3B8',
}
const LEAVE_TYPE_COLORS: Record<string, string> = {
  casual: '#3B82F6', sick: '#EF4444', medical: '#EF4444', earned: '#22C55E',
  privilege: '#A855F7', restricted: '#F97316', lwp: '#6B7280',
}

const DATE_PRESETS = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'This year',     months: 12 },
]

function monthsAgo(n: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().split('T')[0]
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/* ════════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */

export default function AnalyticsPage() {
  const [data,    setData]    = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [from,    setFrom]    = useState(monthsAgo(6))
  const [to,      setTo]      = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutEntry[]>(DEFAULT_LAYOUT)

  useEffect(() => { setLayout(loadLayout()) }, [])
  useEffect(() => { saveLayout(layout) }, [layout])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to',   to)
    try {
      const r = await fetch(`/api/analytics?${params}`)
      const d = await r.json()
      setData(d)
    } catch { setData(null) }
    finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { fetchData() }, [fetchData])

  const activeIds  = useMemo(() => new Set(layout.map(l => l.id)), [layout])
  const availableTiles = TILE_CATALOG.filter(t => !activeIds.has(t.id))

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
      <Header title="Analytics" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#003B73] to-[#0057A8] flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">Analytics overview</p>
              <p className="text-xs text-surface-muted truncate">
                {layout.length} tile{layout.length !== 1 ? 's' : ''}
                {data?.range && ` · ${new Date(data.range.from).toLocaleDateString('en-IN', { day:'numeric', month:'short' })} → ${new Date(data.range.to).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
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

        {/* Date filter row */}
        {showFilter && (
          <div className="flex items-end gap-3 p-4 bg-white rounded-2xl border border-surface-border flex-wrap">
            <div className="flex gap-2 flex-wrap">
              {DATE_PRESETS.map(p => (
                <button key={p.label} type="button"
                  onClick={() => { setFrom(monthsAgo(p.months)); setTo('') }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-surface-border text-gray-600 hover:border-brand-400 hover:text-brand-600 transition-all">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 ml-auto flex-wrap">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">From</label>
                <input type="date" aria-label="From date" value={from} onChange={e => setFrom(e.target.value)}
                  className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">To</label>
                <input type="date" aria-label="To date" value={to} min={from} onChange={e => setTo(e.target.value)}
                  className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
              </div>
              {(from !== monthsAgo(6) || to) && (
                <button type="button" onClick={() => { setFrom(monthsAgo(6)); setTo('') }}
                  className="px-3 h-9 rounded-xl text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        {/* Edit-mode banner */}
        {editMode && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-brand-50 border border-brand-200 flex-wrap">
            <p className="text-xs font-semibold text-brand-700 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Edit mode — use the controls on each tile to reorder, resize, or remove. Saved automatically.
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
            <TrendingUp className="w-12 h-12 text-brand-200 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No analytics data yet</p>
            <p className="text-sm text-surface-muted mt-1">Tiles will populate as leave, expense, and travel records are created.</p>
          </div>
        ) : layout.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-surface-border">
            <Layers className="w-12 h-12 text-brand-200 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">Your dashboard is empty</p>
            <p className="text-sm text-surface-muted mt-1 mb-4">Add tiles to start tracking metrics.</p>
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
                const def     = tileById(real.id)
                if (!def) return null
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
                    <TileBody def={def} data={data} />
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

        {/* Tile catalog dialog */}
        <Dialog.Root open={catalogOpen} onOpenChange={setCatalogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
            <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Add a tile</Dialog.Title>
              <Dialog.Description className="text-sm text-surface-muted mb-5">
                Pick a metric or chart to drop into your dashboard. You can reorder and resize after.
              </Dialog.Description>
              {availableTiles.length === 0 ? (
                <div className="text-center py-10">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="font-semibold text-gray-700">Every tile is already on your dashboard.</p>
                  <p className="text-xs text-surface-muted mt-1">Remove some to free up slots.</p>
                </div>
              ) : (
                ['kpi', 'chart', 'list'].map(cat => {
                  const inCat = availableTiles.filter(t => t.category === cat)
                  if (inCat.length === 0) return null
                  return (
                    <div key={cat} className="mb-5 last:mb-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2">
                        {cat === 'kpi' ? 'KPI tiles' : cat === 'chart' ? 'Charts' : 'Lists'}
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
   Tile body renderer
   ══════════════════════════════════════════════════════════════════════════ */

function TileBody({ def, data }: { def: TileDef; data: AnalyticsData }) {
  switch (def.id) {
    case 'kpi.totalLeaves':
      return <KpiTile def={def} value={data.kpis.totalLeaves} hint="In selected range" />
    case 'kpi.approvedLeaves':
      return <KpiTile def={def} value={data.kpis.approvedLeaves} hint={`${data.kpis.totalLeaves} total`} tone="success" />
    case 'kpi.pendingLeaves':
      return <KpiTile def={def} value={data.kpis.pendingLeaves} hint="Awaiting decision" tone={data.kpis.pendingLeaves > 0 ? 'warning' : 'neutral'} />
    case 'kpi.totalExpenses':
      return <KpiTile def={def} value={inr(data.kpis.totalExpenses)} hint={`${data.kpis.totalExpenseCount} claim${data.kpis.totalExpenseCount !== 1 ? 's' : ''}`} />
    case 'kpi.paidExpense':
      return <KpiTile def={def} value={inr(data.kpis.paidExpense)} hint="Reimbursed so far" tone="success" />
    case 'kpi.pendingPayout':
      return <KpiTile def={def} value={inr(data.kpis.pendingPayout)} hint={`${data.kpis.pendingExpensesCount} pending`} tone={data.kpis.pendingPayout > 0 ? 'warning' : 'neutral'} />
    case 'kpi.travelApproved':
      return <KpiTile def={def} value={data.kpis.travelApproved} hint="Cleared trips" tone="success" />
    case 'kpi.pendingTravel':
      return <KpiTile def={def} value={data.kpis.pendingTravel} hint="Awaiting approval" tone={data.kpis.pendingTravel > 0 ? 'warning' : 'neutral'} />
    case 'kpi.contacts':
      return <KpiTile def={def} value={data.kpis.contactCount} hint={`${data.kpis.contactsWithEmail} with email`} />
    case 'kpi.announcements':
      return <KpiTile def={def} value={data.kpis.announcementCount} hint="Total posted" />

    case 'chart.leaveByMonth':
      return (
        <ChartCard def={def}>
          <BarChart data={data.leaveByMonth.map(m => ({ label: m.label, value: m.count }))} color="#0057A8" />
        </ChartCard>
      )
    case 'chart.expenseByMonth':
      return (
        <ChartCard def={def}>
          <BarChart data={data.expenseByMonth.map(m => ({ label: m.label, value: m.total ?? 0 }))} color="#003B73" unit="₹" />
        </ChartCard>
      )
    case 'chart.leaveStatus':
      return (
        <DonutCard def={def}
          data={data.leaveStatus.map(s => ({ label: s._id, value: s.count, color: LEAVE_STATUS_COLORS[s._id] || '#94A3B8' }))} />
      )
    case 'chart.expenseStatus':
      return (
        <DonutCard def={def}
          data={data.expenseStatus.map(s => ({ label: s._id.replace(/_/g, ' '), value: s.count, color: EXPENSE_STATUS_COLORS[s._id] || '#94A3B8' }))} />
      )
    case 'chart.travelStatus':
      return (
        <DonutCard def={def}
          data={data.travelStatus.map(s => ({ label: s._id.replace(/_/g, ' '), value: s.count, color: TRAVEL_STATUS_COLORS[s._id] || '#94A3B8' }))} />
      )
    case 'chart.leaveType':
      return (
        <DonutCard def={def}
          data={data.leaveType.map(s => ({ label: s._id, value: s.count, color: LEAVE_TYPE_COLORS[s._id] || '#94A3B8' }))} />
      )
    case 'chart.featureUsage30d':
      return (
        <ChartCard def={def}>
          <BarChart data={[
            { label: 'Leaves',   value: data.kpis.leavesIn30d   },
            { label: 'Expenses', value: data.kpis.expensesIn30d },
            { label: 'Travel',   value: data.kpis.travelIn30d   },
          ]} color="#0057A8" />
        </ChartCard>
      )

    case 'list.topSpenders':
      return <TopSpendersCard def={def} data={data.topSpenders} />
    case 'list.recentActivity':
      return <RecentActivityCard def={def} data={data.recentAudits} />
    default:
      return null
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   Tile primitives
   ══════════════════════════════════════════════════════════════════════════ */

function KpiTile({ def, value, hint, tone = 'neutral' }: {
  def: TileDef
  value: number | string
  hint?: string
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

function ChartCard({ def, children }: { def: TileDef; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-gray-700">{def.label}</CardTitle>
        <p className="text-xs text-surface-muted">{def.description}</p>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

function DonutCard({ def, data }: { def: TileDef; data: { label: string; value: number; color: string }[] }) {
  const empty = data.every(d => d.value === 0)
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-gray-700">{def.label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {empty ? (
          <p className="text-xs text-surface-muted py-8 text-center">No data in this range.</p>
        ) : (
          <div className="flex items-center gap-6">
            <DonutChart data={data} size={100} />
            <div className="space-y-2 flex-1 min-w-0">
              {data.filter(d => d.value > 0).map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-gray-600 capitalize truncate flex-1">{s.label}</span>
                  <span className="text-xs font-bold text-gray-900 ml-auto">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TopSpendersCard({ def, data }: { def: TileDef; data: TopSpender[] }) {
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-gray-700">{def.label}</CardTitle>
        <p className="text-xs text-surface-muted">{def.description}</p>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <p className="text-xs text-surface-muted py-6 text-center">No paid expenses yet.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {data.map((s, i) => (
              <li key={s.userId} className="py-2.5 flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                  ${i === 0 ? 'bg-amber-100 text-amber-700' :
                    i === 1 ? 'bg-gray-200 text-gray-700' :
                    i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-surface text-surface-muted'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{s.userName}</p>
                  <p className="text-[10px] text-surface-muted">{s.count} claim{s.count !== 1 ? 's' : ''}</p>
                </div>
                <span className="text-sm font-extrabold text-dm-graphite tabular-nums">{inr(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function actionLabel(action: string): string {
  const parts = action.split('.')
  const noun  = parts[0] || action
  const verb  = parts[1] || ''
  return `${verb.replace(/_/g, ' ')} ${noun}`.trim() || action
}

function RecentActivityCard({ def, data }: { def: TileDef; data: RecentAudit[] }) {
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-gray-700">{def.label}</CardTitle>
        <p className="text-xs text-surface-muted">{def.description}</p>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <p className="text-xs text-surface-muted py-6 text-center">Nothing to show yet.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {data.map((a, i) => {
              const meta = a.metadata || {}
              const employeeName = (meta.employeeName as string | undefined) || ''
              const amount = meta.amount as number | undefined
              const days = meta.days as number | undefined
              const dest = meta.destination as string | undefined
              return (
                <li key={i} className="py-2.5 flex items-start gap-3">
                  <Activity className="w-3.5 h-3.5 text-surface-muted flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <strong className="font-semibold">{a.performedByName}</strong>
                      <span className="text-gray-600"> · {actionLabel(a.action)}</span>
                      {employeeName && <span className="text-gray-600"> for {employeeName}</span>}
                    </p>
                    <p className="text-[10px] text-surface-muted">
                      {dest && <>{dest} · </>}
                      {days !== undefined && <>{days}d · </>}
                      {amount !== undefined && <>{inr(amount)} · </>}
                      {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
