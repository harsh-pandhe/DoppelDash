'use client'
import { useState, useEffect, useCallback } from 'react'
import { Download, Filter, ShieldCheck, Search, X } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { ListSkeleton } from '@/components/ui/skeleton'
import { useUrlState } from '@/lib/useUrlState'
import { useAutoRefresh } from '@/lib/useAutoRefresh'
import { brandedCSV, fmtDate } from '@/lib/export'

interface AuditEntry {
  _id: string; action: string; performedBy: string; performedByName: string
  targetId: string; targetType: string; metadata: Record<string, unknown>; createdAt: string
}

const GREEN = { gradient: 'from-green-400 to-emerald-500', dot: 'bg-green-500'  }
const RED   = { gradient: 'from-red-400 to-rose-500',      dot: 'bg-red-500'    }
const BLUE  = { gradient: 'from-blue-400 to-blue-600',     dot: 'bg-blue-500'   }
const AMBER = { gradient: 'from-orange-400 to-amber-500',  dot: 'bg-orange-500' }
const PURPLE= { gradient: 'from-purple-400 to-violet-600', dot: 'bg-purple-500' }

const ACTION_META: Record<string, { gradient: string; dot: string }> = {
  'leave.approved':        GREEN,
  'leave.rejected':        RED,
  'leave.withdrawn':       RED,
  'expense.paid':          GREEN,
  'expense.rejected':      RED,
  'expense.pending_admin': BLUE,
  'expense.pending_manager':      AMBER,
  'expense.returned_to_employee': AMBER,
  'expense.returned_to_manager':  AMBER,
  'expense.resubmitted':   BLUE,
  'expense.withdrawn':     RED,
  'expense.deleted':       RED,
  'travel.approved':       GREEN,
  'travel.rejected':       RED,
  'travel.pending_admin':  BLUE,
  'travel.pending_manager': AMBER,
  'travel.cancelled':      RED,
  'user.role_changed':            PURPLE,
  'user.mail_access_changed':     PURPLE,
  'user.permissions_changed':     PURPLE,
  'user.privileges_changed':      PURPLE,
  'user.reporting_manager_changed': PURPLE,
  'user.banned':           RED,
  'user.unbanned':         GREEN,
  'balance.updated':       AMBER,
}

const G = 'bg-green-50 text-green-700 border-green-200'
const R = 'bg-red-50 text-red-700 border-red-200'
const B = 'bg-blue-50 text-blue-700 border-blue-200'
const A = 'bg-orange-50 text-orange-700 border-orange-200'
const P = 'bg-purple-50 text-purple-700 border-purple-200'

const ACTION_LABEL_COLORS: Record<string, string> = {
  'leave.approved':        G,
  'leave.rejected':        R,
  'leave.withdrawn':       R,
  'expense.paid':          G,
  'expense.rejected':      R,
  'expense.pending_admin': B,
  'expense.pending_manager':      A,
  'expense.returned_to_employee': A,
  'expense.returned_to_manager':  A,
  'expense.resubmitted':   B,
  'expense.withdrawn':     R,
  'expense.deleted':       R,
  'travel.approved':       G,
  'travel.rejected':       R,
  'travel.pending_admin':  B,
  'travel.pending_manager': A,
  'travel.cancelled':      R,
  'user.role_changed':            P,
  'user.mail_access_changed':     P,
  'user.permissions_changed':     P,
  'user.privileges_changed':      P,
  'user.reporting_manager_changed': P,
  'user.banned':           R,
  'user.unbanned':         G,
  'balance.updated':       A,
}

const AVATAR_GRADIENTS = ['from-brand-400 to-brand-600','from-purple-400 to-violet-600','from-orange-400 to-red-500','from-emerald-400 to-green-600','from-pink-400 to-rose-500','from-cyan-400 to-teal-600']
function avatarGradient(name: string) { return AVATAR_GRADIENTS[(name || 'A').charCodeAt(0) % AVATAR_GRADIENTS.length] }

function exportCSV(logs: AuditEntry[]) {
  brandedCSV({
    title: 'Audit Log',
    subtitle: `${logs.length} entries`,
    head: ['Action', 'Performed By', 'Type', 'Target ID', 'Metadata', 'Date'],
    rows: logs.map(l => [
      l.action, l.performedByName, l.targetType, l.targetId,
      JSON.stringify(l.metadata).replace(/"/g, "'"),
      fmtDate(l.createdAt),
    ]),
    filename: `audit-${fmtDate()}.csv`,
  })
}

const TYPE_FILTERS = ['all', 'leave', 'expense', 'travel', 'user', 'balance'] as const
type TypeFilter = typeof TYPE_FILTERS[number]

const ACTION_OPTIONS = [
  'all',
  'leave.approved', 'leave.rejected', 'leave.withdrawn',
  'expense.paid', 'expense.rejected', 'expense.pending_admin', 'expense.returned_to_employee', 'expense.resubmitted',
  'travel.approved', 'travel.rejected', 'travel.pending_admin', 'travel.cancelled',
  'user.role_changed', 'user.banned', 'user.unbanned', 'user.permissions_changed', 'user.privileges_changed', 'user.reporting_manager_changed',
  'balance.updated',
] as const

const PAGE_SIZE = 50

export default function AuditPage() {
  const [logs,       setLogs]       = useState<AuditEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total,      setTotal]      = useState(0)
  const [hasMore,    setHasMore]    = useState(false)
  const [typeFilterRaw, setTypeFilterRaw] = useUrlState('type', 'all')
  const typeFilter    = typeFilterRaw as TypeFilter
  const setTypeFilter = (v: TypeFilter) => setTypeFilterRaw(v)
  const [from,       setFrom]       = useState('')
  const [to,         setTo]         = useState('')
  const [showFilters,setShowFilters]= useState(false)
  const [actionFilter, setActionFilter] = useUrlState('action', 'all')
  const [q,          setQ]          = useState('')
  const [debQ,       setDebQ]       = useState('')

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const buildParams = useCallback((skip: number) => {
    const params = new URLSearchParams()
    if (typeFilter !== 'all')   params.set('type', typeFilter)
    if (actionFilter !== 'all') params.set('action', actionFilter)
    if (debQ.trim())            params.set('q', debQ.trim())
    if (from)                   params.set('from', from)
    if (to)                     params.set('to',   to)
    params.set('limit', String(PAGE_SIZE))
    params.set('skip',  String(skip))
    return params
  }, [typeFilter, actionFilter, debQ, from, to])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const res  = await fetch(`/api/admin/audit?${buildParams(0)}`)
    const data = await res.json()
    setLogs(Array.isArray(data?.logs) ? data.logs : [])
    setTotal(data?.total || 0)
    setHasMore(!!data?.hasMore)
    setLoading(false)
  }, [buildParams])

  const loadMore = async () => {
    setLoadingMore(true)
    const res  = await fetch(`/api/admin/audit?${buildParams(logs.length)}`)
    const data = await res.json()
    setLogs(prev => [...prev, ...(Array.isArray(data?.logs) ? data.logs : [])])
    setHasMore(!!data?.hasMore)
    setLoadingMore(false)
  }

  const clearAll = () => { setQ(''); setFrom(''); setTo(''); setActionFilter('all'); setTypeFilter('all') }
  const hasFilters = !!(q || from || to || actionFilter !== 'all' || typeFilter !== 'all')

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useAutoRefresh(fetchLogs, { intervalMs: 25_000 })

  return (
    <>
      <Header title="Audit Log" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-4 w-full bg-surface-2">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Audit Log</p>
              <p className="text-xs text-surface-muted">Showing {logs.length} of {total} entr{total !== 1 ? 'ies' : 'y'}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all
                ${showFilters ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-surface-border text-gray-600 hover:border-brand-400'}`}>
              <Filter className="w-3.5 h-3.5" /> Filters{hasFilters && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
            {logs.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(logs)}>
                <Download className="w-4 h-4" /> Export CSV
              </Button>
            )}
          </div>
        </div>

        {/* Search bar — always visible */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
          <input type="text" placeholder="Search action or person…" value={q} onChange={e => setQ(e.target.value)}
            aria-label="Search audit log"
            className="w-full h-10 pl-9 pr-9 rounded-xl border border-surface-border bg-white text-sm focus:outline-none focus:border-brand-500" />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted hover:text-gray-700">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Type filter pills */}
        <div className="flex gap-2 flex-wrap">
          {TYPE_FILTERS.map(t => (
            <button type="button" key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all
                ${typeFilter === t ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Detailed filter panel */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-white rounded-2xl border border-surface-border">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Action</label>
              <select aria-label="Action filter" value={actionFilter} onChange={e => setActionFilter(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-surface-border text-xs focus:outline-none focus:border-brand-500">
                {ACTION_OPTIONS.map(a => (
                  <option key={a} value={a}>{a === 'all' ? 'All actions' : a}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">From</label>
              <input type="date" aria-label="From date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">To</label>
              <input type="date" aria-label="To date" value={to} min={from} onChange={e => setTo(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div className="flex items-end">
              {hasFilters && (
                <button type="button" onClick={clearAll}
                  className="w-full h-9 px-3 rounded-xl text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Log entries */}
        {loading ? <ListSkeleton rows={6} /> : logs.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center mb-4">
              <ShieldCheck className="w-8 h-8 text-surface-muted" />
            </div>
            <p className="font-bold text-gray-900 mb-1">No audit entries</p>
            <p className="text-sm text-surface-muted">Activity will appear here as actions are taken.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
            {logs.map((log, i) => {
              const meta = ACTION_META[log.action] || { gradient: 'from-gray-400 to-gray-500', dot: 'bg-gray-400' }
              const labelColor = ACTION_LABEL_COLORS[log.action] || 'bg-gray-50 text-gray-700 border-gray-200'
              const isLast = i === logs.length - 1
              const initials = (log.performedByName || 'Unknown').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
              return (
                <div key={log._id} className={`flex items-start gap-4 p-4 hover:bg-surface/50 transition-colors ${!isLast ? 'border-b border-surface-border' : ''}`}>
                  {/* Actor avatar */}
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${avatarGradient(log.performedByName)} flex items-center justify-center flex-shrink-0`}>
                    <span className="text-white font-bold text-[10px]">{initials}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Action badge */}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${labelColor}`}>
                          {log.action}
                        </span>
                        {/* Dot indicator */}
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                      </div>
                      <p className="text-[10px] text-surface-muted flex-shrink-0">
                        {new Date(log.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <p className="text-xs text-gray-700 mt-1">
                      <strong className="font-semibold">{log.performedByName}</strong>
                      <span className="text-surface-muted"> · {log.targetType}</span>
                      {log.metadata.employeeName ? <span> → {String(log.metadata.employeeName)}</span> : null}
                      {log.metadata.newRole ? <span> → <span className="font-semibold">{String(log.metadata.newRole)}</span></span> : null}
                    </p>
                    {Object.keys(log.metadata).length > 0 && (
                      <p className="text-[10px] text-surface-muted mt-0.5 truncate">
                        {Object.entries(log.metadata).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2">
              {loadingMore ? 'Loading…' : `Load more (${total - logs.length} older)`}
            </Button>
          </div>
        )}
      </main>
    </>
  )
}
