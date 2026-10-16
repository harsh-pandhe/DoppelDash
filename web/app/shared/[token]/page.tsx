'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { TrendingUp, Lock, AlertTriangle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { TileBody, tileById, type AnalyticsData, type LayoutEntry } from '../../(app)/analytics/analyticsTiles'

interface SharedResponse {
  readOnly: boolean
  ownerName: string
  expiresAt: string | null
  layout: LayoutEntry[]
  data: AnalyticsData
  error?: string
  expired?: boolean
}

export default function SharedDashboardPage() {
  const params = useParams<{ token: string }>()   // Next 15: the page `params` prop is a Promise; the hook is synchronous in client components
  const [res, setRes] = useState<SharedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/analytics/shared/${params.token}`)
        const d = await r.json()
        if (!r.ok) { setError(d.error || 'Unable to load this dashboard.'); return }
        setRes(d)
      } catch { setError('Unable to load this dashboard.') }
      finally { setLoading(false) }
    })()
  }, [params.token])

  return (
    <div className="min-h-screen bg-surface-2">
      {/* Read-only banner */}
      <div className="bg-gradient-to-r from-[#003B73] to-[#0057A8] text-white">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight">DoppelDash · Shared dashboard</p>
              <p className="text-[11px] text-white/75 truncate">
                {res ? `Shared by ${res.ownerName}` : 'DoppelDash'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold bg-white/15 rounded-full px-3 py-1">
            <Lock className="w-3 h-3" /> Read-only
            {res?.expiresAt && <span className="text-white/70">· expires {new Date(res.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto p-5 lg:p-8 space-y-5">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-surface-border p-5 space-y-3">
                <Skeleton className="h-4 w-1/3" /><Skeleton className="h-8 w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-24 bg-surface-1 rounded-2xl border border-surface-border max-w-lg mx-auto mt-10">
            <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
            <p className="font-bold text-ink text-lg">Dashboard unavailable</p>
            <p className="text-sm text-surface-muted mt-1.5">{error}</p>
          </div>
        ) : res ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-min">
              {res.layout.filter(e => tileById(e.id)).map((e, idx) => {
                const def = tileById(e.id)!
                const colSpan = e.size === 'sm' ? 'col-span-2 sm:col-span-1' : e.size === 'md' ? 'col-span-2' : 'col-span-2 lg:col-span-4'
                return (
                  <div key={`${idx}-${e.id}`} className={colSpan}>
                    <TileBody def={def} data={res.data} drillBase="" readOnly />
                  </div>
                )
              })}
            </div>
            <p className="text-center text-[11px] text-surface-muted pt-4">
              This is a read-only snapshot. Data reflects the share owner&apos;s access at view time.
            </p>
          </>
        ) : null}
      </main>
    </div>
  )
}
