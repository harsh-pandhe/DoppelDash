'use client'
import { useState, useEffect, useCallback } from 'react'
import { Download, Filter } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ListSkeleton } from '@/components/ui/skeleton'

interface AuditEntry {
  _id: string; action: string; performedBy: string; performedByName: string
  targetId: string; targetType: string; metadata: Record<string, unknown>; createdAt: string
}

const ACTION_COLORS: Record<string, string> = {
  'leave.approved':    'bg-green-100 text-green-700',
  'leave.rejected':    'bg-red-100   text-red-700',
  'expense.paid':      'bg-green-100 text-green-700',
  'expense.rejected':  'bg-red-100   text-red-700',
  'expense.pending_boss': 'bg-blue-100 text-blue-700',
  'user.role_changed': 'bg-purple-100 text-purple-700',
  'user.banned':       'bg-red-100   text-red-700',
  'user.unbanned':     'bg-green-100 text-green-700',
  'balance.updated':   'bg-orange-100 text-orange-700',
}

function exportCSV(logs: AuditEntry[]) {
  const rows = logs.map(l => [
    `"${l.action}"`, `"${l.performedByName}"`, `"${l.targetType}"`, `"${l.targetId}"`,
    `"${JSON.stringify(l.metadata).replace(/"/g, "'")}"`,
    new Date(l.createdAt).toLocaleString('en-IN'),
  ])
  const csv  = [['Action','Performed By','Type','Target ID','Metadata','Date'].join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `audit-${Date.now()}.csv`; a.click()
}

export default function AuditPage() {
  const [logs,    setLogs]    = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (from) params.set('from', from)
    if (to)   params.set('to',   to)
    const res  = await fetch(`/api/admin/audit?${params}`)
    const data = await res.json()
    setLogs(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [typeFilter, from, to])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  return (
    <>
      <Header title="Audit Log" />
      <main className="flex-1 p-6 space-y-5">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {(['all','leave','expense','user','balance'] as const).map(t => (
              <button type="button" key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all
                  ${typeFilter === t ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all
                ${(from||to) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-surface-border text-gray-600'}`}>
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
            {logs.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(logs)}>
                <Download className="w-4 h-4" /> Export CSV
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="flex items-end gap-3 p-4 bg-white rounded-xl border border-surface-border flex-wrap">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-muted uppercase tracking-wide">From</label>
              <input type="date" aria-label="From date" value={from} onChange={e => setFrom(e.target.value)}
                className="h-9 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-muted uppercase tracking-wide">To</label>
              <input type="date" aria-label="To date" value={to} min={from} onChange={e => setTo(e.target.value)}
                className="h-9 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            {(from||to) && (
              <button type="button" onClick={() => { setFrom(''); setTo('') }}
                className="px-3 h-9 rounded-lg text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50">Clear</button>
            )}
          </div>
        )}

        {loading ? <ListSkeleton rows={6} /> : logs.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <p className="font-bold text-gray-900">No audit entries</p>
            <p className="text-sm text-surface-muted mt-1">Activity will appear here as actions are taken.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <Card key={log._id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-3 flex items-start gap-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700'}`}>
                    {log.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-900">
                      <strong>{log.performedByName}</strong> · {log.targetType}
                      {log.metadata.employeeName ? ` → ${String(log.metadata.employeeName)}` : null}
                      {log.metadata.newRole ? ` → ${String(log.metadata.newRole)}` : null}
                    </p>
                    {Object.keys(log.metadata).length > 0 && (
                      <p className="text-[10px] text-surface-muted mt-0.5 truncate">
                        {Object.entries(log.metadata).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(' · ')}
                      </p>
                    )}
                  </div>
                  <p className="text-[10px] text-surface-muted flex-shrink-0">
                    {new Date(log.createdAt).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
