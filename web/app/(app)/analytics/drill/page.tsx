'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

interface DrillRow {
  id: string; userName: string; status: string; createdAt: string
  primary: string; detail: string; value: string; date: string
}
interface DrillData {
  metric: string; status: string | null
  range: { from: string; to: string }
  page: number; totalPages: number; total: number; rows: DrillRow[]
}

const METRIC_LABEL: Record<string, string> = { leave: 'Leave requests', expense: 'Expense claims', travel: 'Travel requests' }

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  pending_manager: 'bg-amber-50 text-amber-700 border-amber-200',
  pending_boss: 'bg-blue-50 text-blue-700 border-blue-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  returned: 'bg-orange-50 text-orange-700 border-orange-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
}
const prettyStatus = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function DrillInner() {
  const params = useSearchParams()
  const router = useRouter()
  const [data, setData] = useState<DrillData | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const metric   = params.get('metric')   || 'leave'
  const status   = params.get('status')   || ''
  const from     = params.get('from')      || ''
  const to       = params.get('to')        || ''
  const dept     = params.get('dept')      || ''
  const employee = params.get('employee')  || ''

  const fetchData = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    qs.set('metric', metric)
    if (status)   qs.set('status', status)
    if (from)     qs.set('from', from)
    if (to)       qs.set('to', to)
    if (dept)     qs.set('dept', dept)
    if (employee) qs.set('employee', employee)
    qs.set('page', String(page))
    try {
      const r = await fetch(`/api/analytics/drill?${qs}`)
      setData(await r.json())
    } catch { setData(null) }
    finally { setLoading(false) }
  }, [metric, status, from, to, dept, employee, page])
  useEffect(() => { fetchData() }, [fetchData])

  const exportCsv = () => {
    if (!data) return
    const head = ['Name', 'Item', 'Detail', 'Value', 'Date', 'Status']
    const lines = data.rows.map(r =>
      [r.userName, r.primary, r.detail, r.value, fmtDate(r.date), prettyStatus(r.status)]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    const csv = [head.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${metric}${status ? '-' + status : ''}-drill.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <Header title="Drill-down" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={() => router.back()}
              className="w-9 h-9 rounded-xl border border-surface-border bg-white flex items-center justify-center hover:border-brand-400 transition-colors flex-shrink-0">
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">
                {METRIC_LABEL[metric] || metric}
                {status && <span className="text-brand-600"> · {prettyStatus(status)}</span>}
              </p>
              <p className="text-xs text-surface-muted truncate">
                {data ? `${data.total} record${data.total !== 1 ? 's' : ''}` : 'Loading…'}
                {data?.range && ` · ${fmtDate(data.range.from)} → ${fmtDate(data.range.to)}`}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={!data || data.rows.length === 0}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-surface-border p-5 space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-surface-border">
            <Inbox className="w-12 h-12 text-brand-200 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No matching records</p>
            <p className="text-sm text-surface-muted mt-1">Nothing in this segment for the selected range.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface text-left">
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-surface-muted">Name</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-surface-muted">Item</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-surface-muted">Value</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-surface-muted">Date</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-surface-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.id} className="border-b border-surface-border last:border-0 hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{r.userName}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[260px]">
                        <p className="font-medium truncate">{r.primary || '—'}</p>
                        {r.detail && <p className="text-xs text-surface-muted truncate">{r.detail}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-medium">{r.value || '—'}</td>
                      <td className="px-4 py-3 text-surface-muted whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {prettyStatus(r.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-surface-border">
                <p className="text-xs text-surface-muted">Page {data.page} of {data.totalPages}</p>
                <div className="flex gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="gap-1" disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}>
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1" disabled={page >= data.totalPages}
                    onClick={() => setPage(p => p + 1)}>
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}

export default function DrillPage() {
  return (
    <Suspense fallback={<><Header title="Drill-down" /><main className="flex-1 p-8"><Skeleton className="h-64 w-full" /></main></>}>
      <DrillInner />
    </Suspense>
  )
}
