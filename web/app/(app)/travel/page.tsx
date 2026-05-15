'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plane, Plus, Clock, CheckCircle2, XCircle, ChevronRight, Loader2, MapPin, CalendarDays, IndianRupee, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useUser } from '@/lib/useUser'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { useUrlState } from '@/lib/useUrlState'
import { useAutoRefresh } from '@/lib/useAutoRefresh'
import { timeAgo } from '@/lib/timeAgo'

interface TravelRequest {
  _id: string; userId: string; userName: string
  purpose: string; destination: string
  departureDate: string; returnDate: string
  estimatedTotal: number; advanceRequested: number
  status: string; managerNote?: string; bossNote?: string
  createdAt: string
}

const STATUS_CFG: Record<string, { label: string; icon: React.ElementType; ring: string; text: string; dot: string }> = {
  pending_manager: { label: 'Manager Review', icon: Clock,        ring: 'ring-yellow-200 bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  pending_boss:    { label: 'Boss Approval',  icon: Clock,        ring: 'ring-blue-200 bg-blue-50',     text: 'text-blue-700',   dot: 'bg-blue-400'   },
  approved:        { label: 'Approved',       icon: CheckCircle2, ring: 'ring-green-200 bg-green-50',   text: 'text-green-700',  dot: 'bg-green-500'  },
  rejected:        { label: 'Rejected',       icon: XCircle,      ring: 'ring-red-200 bg-red-50',       text: 'text-red-700',    dot: 'bg-red-400'    },
  cancelled:       { label: 'Cancelled',      icon: XCircle,      ring: 'ring-gray-200 bg-gray-50',     text: 'text-gray-500',   dot: 'bg-gray-400'   },
}

const AVATAR_GRADIENTS = ['from-brand-400 to-brand-600','from-purple-400 to-violet-600','from-orange-400 to-red-500','from-emerald-400 to-green-600','from-pink-400 to-rose-500']
const avatarGradient = (n: string) => AVATAR_GRADIENTS[n.charCodeAt(0) % AVATAR_GRADIENTS.length]

export default function TravelPage() {
  const { user } = useUser()
  const toast    = useToast()
  const role     = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'
  const isBoss    = role === 'boss'

  const [requests, setRequests] = useState<TravelRequest[]>([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useUrlState('status', 'all')
  const [acting,   setActing]   = useState<string | null>(null)

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/travel')
    const data = await res.json()
    setRequests(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchRequests() }, [fetchRequests])
  useAutoRefresh(fetchRequests)

  const act = async (id: string, status: string, note?: string) => {
    setActing(id)
    const noteKey = isBoss ? 'bossNote' : 'managerNote'
    await fetch(`/api/travel/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, [noteKey]: note }),
    })
    toast(status === 'approved' ? 'Travel approved' : status === 'rejected' ? 'Travel rejected' : 'Sent for boss approval', status === 'rejected' ? 'error' : 'success')
    setActing(null)
    fetchRequests()
  }

  const cancel = async (id: string) => {
    await fetch(`/api/travel/${id}`, { method: 'DELETE' })
    toast('Request cancelled', 'info')
    fetchRequests()
  }

  const FILTERS = ['all', 'pending_manager', 'pending_boss', 'approved', 'rejected']
  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  const pendingCount = requests.filter(r =>
    (isManager && !isBoss && r.status === 'pending_manager') ||
    (isBoss && r.status === 'pending_boss')
  ).length

  return (
    <>
      <Header title="Travel Requests" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* Hero */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#003B73] to-[#0057A8] flex items-center justify-center flex-shrink-0">
              <Plane className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Travel Requests</p>
              <p className="text-xs text-surface-muted">{requests.length} total{pendingCount > 0 ? ` · ${pendingCount} need action` : ''}</p>
            </div>
          </div>
          <Link href="/travel/new">
            <Button className="gap-2 bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2]">
              <Plus className="w-4 h-4" /> New Request
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all
                ${filter === f ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
              {f === 'all' ? `All (${requests.length})` : STATUS_CFG[f]?.label || f}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">{[...Array(4)].map((_,i) => <div key={i} className="h-28 rounded-2xl bg-surface-border animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Plane}
            title={filter === 'all' ? 'No travel requests yet' : `No ${STATUS_CFG[filter]?.label || filter} requests`}
            description={filter === 'all' ? 'Submit a request before your trip to get advance approval and reimbursement caps.' : 'Try a different filter.'}
            action={filter === 'all' ? { label: 'New Travel Request', href: '/travel/new', icon: Plus } : undefined}
            secondaryAction={filter !== 'all' ? { label: 'Show all', onClick: () => setFilter('all') } : undefined}
          />
        ) : (
          <div className="space-y-3">
            {filtered.map(r => {
              const s = STATUS_CFG[r.status] || STATUS_CFG.pending_manager
              const SIcon = s.icon
              const canManagerApprove = !isBoss && isManager && r.status === 'pending_manager'
              const canBossApprove    = isBoss && r.status === 'pending_boss'
              const canCancel         = r.userId === user?.id && r.status === 'pending_manager'

              return (
                <div key={r._id} className="bg-white rounded-2xl border border-surface-border p-5 space-y-3 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${avatarGradient(r.userName)} flex items-center justify-center flex-shrink-0`}>
                        <span className="text-white font-bold text-[10px]">{r.userName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{r.purpose}</p>
                        {isManager && <p className="text-xs text-surface-muted">{r.userName}</p>}
                      </div>
                    </div>
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 text-xs font-bold ${s.ring} ${s.text}`}>
                      <SIcon className="w-3 h-3" />{s.label}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-surface-muted">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.destination}</span>
                    <span className="flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {new Date(r.departureDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' })} —{' '}
                      {new Date(r.returnDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-gray-700">
                      <IndianRupee className="w-3 h-3" />₹{r.estimatedTotal.toLocaleString('en-IN')} est.
                    </span>
                    {r.advanceRequested > 0 && (
                      <span className="flex items-center gap-1 text-orange-600 font-semibold">
                        Advance: ₹{r.advanceRequested.toLocaleString('en-IN')}
                      </span>
                    )}
                    <span className="ml-auto">{timeAgo(r.createdAt)}</span>
                  </div>

                  {(r.managerNote || r.bossNote) && (
                    <p className="text-xs text-surface-muted italic border-t border-surface-border pt-2">
                      &ldquo;{r.managerNote || r.bossNote}&rdquo;
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="pt-1 border-t border-surface-border">
                    <div className="flex flex-wrap gap-2 items-center justify-between">
                      {(canManagerApprove || canBossApprove || canCancel) ? (
                        <div className="flex flex-wrap gap-2">
                          {canManagerApprove && (
                            <>
                              <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700"
                                onClick={() => act(r._id, 'pending_boss')} disabled={acting === r._id}>
                                {acting === r._id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                                Forward to Boss
                              </Button>
                              <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                onClick={() => act(r._id, 'approved')} disabled={acting === r._id}>
                                <CheckCircle2 className="w-3 h-3" /> Approve Directly
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                                onClick={() => act(r._id, 'rejected')} disabled={acting === r._id}>
                                <XCircle className="w-3 h-3" /> Reject
                              </Button>
                            </>
                          )}
                          {canBossApprove && (
                            <>
                              <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700"
                                onClick={() => act(r._id, 'approved')} disabled={acting === r._id}>
                                {acting === r._id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
                                onClick={() => act(r._id, 'pending_manager')} disabled={acting === r._id}>
                                <RotateCcw className="w-3 h-3" /> Send Back
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                                onClick={() => act(r._id, 'rejected')} disabled={acting === r._id}>
                                <XCircle className="w-3 h-3" /> Reject
                              </Button>
                            </>
                          )}
                          {canCancel && (
                            <Button size="sm" variant="outline" className="gap-1.5 text-gray-600"
                              onClick={() => cancel(r._id)}>
                              <XCircle className="w-3 h-3" /> Cancel Request
                            </Button>
                          )}
                        </div>
                      ) : <div className="min-w-[0]" />}

                      <Link href={`/travel/${r._id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-brand-600">
                        View details <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
