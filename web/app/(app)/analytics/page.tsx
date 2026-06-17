'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useToast } from '@/components/ui/toast'
import { downloadCsv, downloadTilePng, tileCsvRows } from './tileExport'
import {
  TrendingUp, Filter, Layers,
  Plus, X, ChevronUp, ChevronDown, RotateCcw, Pencil, Sparkles,
  CheckCircle, CheckCircle2,
  MoreHorizontal, ImageDown, FileText, Share2, Copy, Trash2, Link2,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import { SortableTileGrid } from '@/components/SortableTileGrid'
import {
  TileBody, tileById, TILE_CATALOG,
  type TileDef, type TileId, type TileSize, type LayoutEntry, type AnalyticsData,
} from './analyticsTiles'

/* ════════════════════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════════════════ */



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


const DATE_PRESETS = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'This year',     months: 12 },
]

/* ── Saved custom date-range presets (localStorage) ── */
type SavedPreset = { label: string; from: string; to: string }
const PRESETS_KEY = 'doppeldash-date-presets-v1'
function loadPresets(): SavedPreset[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]') as SavedPreset[] } catch { return [] }
}
function savePresets(p: SavedPreset[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)) } catch { /* quota */ }
}

function monthsAgo(n: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().split('T')[0]
}


/* ════════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */

export default function AnalyticsPage() {
  const [data,    setData]    = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [from,    setFrom]    = useState(monthsAgo(6))
  const [to,      setTo]      = useState('')
  const [dept,     setDept]     = useState('')
  const [employee, setEmployee] = useState('')
  const [status,   setStatus]   = useState('')
  const [compare,  setCompare]  = useState<'none' | 'mom' | 'yoy'>('none')
  const [showFilter, setShowFilter] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutEntry[]>(DEFAULT_LAYOUT)
  const [presets, setPresets] = useState<SavedPreset[]>([])
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => { setLayout(loadLayout()); setPresets(loadPresets()) }, [])
  useEffect(() => { saveLayout(layout) }, [layout])

  const saveCurrentPreset = () => {
    const fromLabel = from ? new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'start'
    const toLabel   = to   ? new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'now'
    const label = `${fromLabel} → ${toLabel}`
    if (presets.some(p => p.from === from && p.to === to)) return
    const next = [...presets, { label, from, to }]
    setPresets(next); savePresets(next)
  }
  const applyPreset  = (p: SavedPreset) => { setFrom(p.from); setTo(p.to) }
  const deletePreset = (idx: number) => { const next = presets.filter((_, i) => i !== idx); setPresets(next); savePresets(next) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from)     params.set('from', from)
    if (to)       params.set('to',   to)
    if (dept)     params.set('dept', dept)
    if (employee) params.set('employee', employee)
    if (status)   params.set('status', status)
    if (compare !== 'none') params.set('compare', compare)
    try {
      const r = await fetch(`/api/analytics?${params}`)
      if (!r.ok) throw new Error()
      const d = await r.json()
      setData(d)
      setError(false)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setData(null)
      setError(true)
    }
    finally { setLoading(false) }
  }, [from, to, dept, employee, status, compare])
  useEffect(() => { fetchData() }, [fetchData])

  const activeIds  = useMemo(() => new Set(layout.map(l => l.id)), [layout])
  const availableTiles = TILE_CATALOG.filter(t => !activeIds.has(t.id))

  // Querystring carrying current range + dimension filters into the drill-down page
  const drillBase = useMemo(() => {
    const p = new URLSearchParams()
    if (from)     p.set('from', from)
    if (to)       p.set('to', to)
    if (dept)     p.set('dept', dept)
    if (employee) p.set('employee', employee)
    return p.toString()
  }, [from, to, dept, employee])

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
                {(dept || employee || status) && <span className="text-brand-600 font-semibold"> · filtered</span>}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button type="button" variant={showFilter ? 'default' : 'outline'} size="sm" className="gap-1.5"
              onClick={() => setShowFilter(f => !f)}>
              <Filter className="w-3.5 h-3.5" /> Filters
            </Button>
            <div className="inline-flex rounded-lg border border-surface-border overflow-hidden">
              {(['none', 'mom', 'yoy'] as const).map(c => (
                <button key={c} type="button" onClick={() => setCompare(c)}
                  className={`px-2.5 h-8 text-xs font-semibold transition-colors ${compare === c ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-surface'}`}>
                  {c === 'none' ? 'No compare' : c.toUpperCase()}
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5"
              onClick={() => setShareOpen(true)} disabled={layout.length === 0}>
              <Share2 className="w-3.5 h-3.5" /> Share
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
            <div className="flex gap-2 flex-wrap items-center">
              {DATE_PRESETS.map(p => (
                <button key={p.label} type="button"
                  onClick={() => { setFrom(monthsAgo(p.months)); setTo('') }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-surface-border text-gray-600 hover:border-brand-400 hover:text-brand-600 transition-all">
                  {p.label}
                </button>
              ))}
              {presets.map((p, i) => (
                <span key={`${p.from}-${p.to}-${i}`} className="inline-flex items-center rounded-xl border border-brand-200 bg-brand-50 overflow-hidden">
                  <button type="button" onClick={() => applyPreset(p)}
                    className="px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors">
                    {p.label}
                  </button>
                  <button type="button" aria-label="Delete preset" onClick={() => deletePreset(i)}
                    className="px-1.5 py-1.5 text-brand-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={saveCurrentPreset}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-dashed border-surface-border text-surface-muted hover:border-brand-400 hover:text-brand-600 transition-all inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> Save range
              </button>
            </div>

            {/* Dimension filters (managers) */}
            {data?.filterOptions && (
              <div className="flex items-end gap-2 flex-wrap w-full border-t border-surface-border pt-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Department</label>
                  <select aria-label="Filter by department" value={dept}
                    onChange={e => { setDept(e.target.value); setEmployee('') }}
                    className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 bg-white">
                    <option value="">All departments</option>
                    {data.filterOptions.departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Employee</label>
                  <select aria-label="Filter by employee" value={employee}
                    onChange={e => setEmployee(e.target.value)}
                    className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 bg-white">
                    <option value="">All employees</option>
                    {data.filterOptions.employees
                      .filter(emp => !dept || emp.department === dept)
                      .map(emp => <option key={emp.userId} value={emp.userId}>{emp.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Status</label>
                  <select aria-label="Filter by status" value={status}
                    onChange={e => setStatus(e.target.value)}
                    className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 bg-white">
                    <option value="">Any status</option>
                    <option value="pending">Pending (leave)</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="pending_manager">Pending manager</option>
                    <option value="pending_admin">Pending boss</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
                {(dept || employee || status) && (
                  <button type="button" onClick={() => { setDept(''); setEmployee(''); setStatus('') }}
                    className="px-3 h-9 rounded-xl text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                    Clear filters
                  </button>
                )}
              </div>
            )}
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
          error ? (
            <div className="bg-white rounded-2xl border border-surface-border">
              <ErrorState onRetry={() => fetchData()} variant="block" />
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-2xl border border-surface-border">
              <TrendingUp className="w-12 h-12 text-brand-200 mx-auto mb-3" />
              <p className="font-semibold text-gray-900">No analytics data yet</p>
              <p className="text-sm text-surface-muted mt-1">Tiles will populate as leave, expense, and travel records are created.</p>
            </div>
          )
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
                const def     = tileById(real.id)
                if (!def) return null
                return (
                  <>
                    {editMode && (
                      <div className="absolute top-1 right-1 sm:-top-2 sm:-right-2 z-20 flex items-center gap-0.5 bg-white border border-surface-border rounded-full shadow-md p-0.5">
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
                    <ExportableTile def={def} data={data} drillBase={drillBase} disabled={editMode} />
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

        {/* Tile catalog dialog */}
        <Modal open={catalogOpen} onOpenChange={setCatalogOpen} size="2xl">
          <ModalHeader title="Add a tile" description="Pick a metric or chart to drop into your dashboard. You can reorder and resize after." />
          <ModalBody>
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
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setCatalogOpen(false)}>Close</Button>
          </ModalFooter>
        </Modal>

        <ShareDialog open={shareOpen} onOpenChange={setShareOpen}
          layout={layout} filters={{ from, to, dept, employee, status }} />

      </main>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Share dialog
   ══════════════════════════════════════════════════════════════════════════ */

type ShareRow = { token: string; expiresAt: string | null; viewCount: number; createdAt: string; expired: boolean }

function ShareDialog({ open, onOpenChange, layout, filters }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  layout: LayoutEntry[]
  filters: { from: string; to: string; dept: string; employee: string; status: string }
}) {
  const toast = useToast()
  const [expiry, setExpiry] = useState<'24h' | '7d' | '30d' | 'never'>('7d')
  const [shares, setShares] = useState<ShareRow[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const fullUrl = (t: string) => `${origin}/shared/${t}`

  const refresh = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/analytics/share'); const d = await r.json(); setShares(d.shares || []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (open) refresh() }, [open, refresh])

  const create = async () => {
    setCreating(true)
    try {
      const r = await fetch('/api/analytics/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout, filters, expiry }),
      })
      const d = await r.json()
      if (!r.ok) { toast(d.error || 'Failed to create link', 'error'); return }
      await navigator.clipboard.writeText(fullUrl(d.token)).catch(() => {})
      toast('Share link created & copied', 'success')
      refresh()
    } catch { toast('Failed to create link', 'error') }
    finally { setCreating(false) }
  }
  const copy = async (t: string) => { await navigator.clipboard.writeText(fullUrl(t)).catch(() => {}); toast('Link copied', 'success') }
  const revoke = async (t: string) => {
    const r = await fetch(`/api/analytics/share/${t}`, { method: 'DELETE' })
    if (r.ok) { toast('Link revoked', 'success'); refresh() } else toast('Failed to revoke', 'error')
  }

  const fmtExpiry = (e: string | null) => e ? new Date(e).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never'

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg">
      <ModalHeader
        title="Share dashboard"
        description="Generate a read-only public link. It snapshots your current tiles + filters. Anyone with the link can view — no login needed."
        icon={Share2}
      />
      <ModalBody>
        <div className="flex items-end gap-2">
          <div className="space-y-1 flex-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Link expires</label>
            <select aria-label="Link expiry" value={expiry} onChange={e => setExpiry(e.target.value as typeof expiry)}
              className="w-full h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 bg-white">
              <option value="24h">In 24 hours</option>
              <option value="7d">In 7 days</option>
              <option value="30d">In 30 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          <Button type="button" className="gap-1.5" onClick={create} disabled={creating}>
            <Link2 className="w-3.5 h-3.5" /> {creating ? 'Creating…' : 'Create link'}
          </Button>
        </div>

        <div className="border-t border-surface-border pt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2">Active links</p>
          {loading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : shares.length === 0 ? (
            <p className="text-xs text-surface-muted py-4 text-center">No share links yet.</p>
          ) : (
            <ul className="space-y-2">
              {shares.map(s => (
                <li key={s.token} className={`flex items-center gap-2 p-2.5 rounded-xl border ${s.expired ? 'border-red-200 bg-red-50/40' : 'border-surface-border'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-gray-700 truncate">/shared/{s.token.slice(0, 12)}…</p>
                    <p className="text-[11px] text-surface-muted">
                      {s.expired ? <span className="text-red-600 font-semibold">Expired</span> : `Expires ${fmtExpiry(s.expiresAt)}`}
                      {' · '}{s.viewCount} view{s.viewCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  {!s.expired && (
                    <button type="button" aria-label="Copy link" onClick={() => copy(s.token)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface text-gray-500 transition-colors">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button type="button" aria-label="Revoke link" onClick={() => revoke(s.token)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
      </ModalFooter>
    </Modal>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Tile body renderer
   ══════════════════════════════════════════════════════════════════════════ */

/* Wraps a tile with a hover ⋯ menu offering CSV (data tiles) + PNG (all tiles) export. */
function ExportableTile({ def, data, drillBase, disabled }: { def: TileDef; data: AnalyticsData; drillBase: string; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const csvRows = tileCsvRows(def.id, data)

  const slug = def.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const doCsv = () => {
    if (!csvRows) return
    downloadCsv(csvRows, `${slug}.csv`)
    setOpen(false)
    toast('CSV exported', 'success')
  }
  const doPng = async () => {
    if (!ref.current) return
    setBusy(true); setOpen(false)
    try { await downloadTilePng(ref.current, `${slug}.png`); toast('PNG exported', 'success') }
    catch { toast('PNG export failed', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div ref={ref} className="relative h-full">
      {!disabled && (
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button type="button" aria-label="Export tile" onClick={() => setOpen(o => !o)}
            className="w-7 h-7 rounded-lg bg-white/90 border border-surface-border flex items-center justify-center hover:bg-surface shadow-sm">
            {busy ? <span className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /> : <MoreHorizontal className="w-4 h-4 text-gray-500" />}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 w-40 bg-white border border-surface-border rounded-xl shadow-lg overflow-hidden py-1">
                {csvRows && (
                  <button type="button" onClick={doCsv}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-surface text-left">
                    <FileText className="w-3.5 h-3.5 text-surface-muted" /> Export CSV
                  </button>
                )}
                <button type="button" onClick={doPng}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-surface text-left">
                  <ImageDown className="w-3.5 h-3.5 text-surface-muted" /> Export PNG
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <TileBody def={def} data={data} drillBase={drillBase} />
    </div>
  )
}

