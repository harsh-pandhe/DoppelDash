'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, CalendarClock, CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, List, Calendar, Filter, History } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import { timeAgo } from '@/lib/timeAgo'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { useUser } from '@clerk/nextjs'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

interface Leave {
  _id: string; userId: string; userName: string; type: string
  startDate: string; endDate: string; days: number; reason: string
  status: 'pending' | 'approved' | 'rejected'; managerNote?: string
  medicalDocs?: string[]; createdAt?: string
}

const STATUS_MAP = {
  pending:  { label: 'Pending',  variant: 'warning'     as const, icon: Clock },
  approved: { label: 'Approved', variant: 'success'     as const, icon: CheckCircle2 },
  rejected: { label: 'Rejected', variant: 'destructive' as const, icon: XCircle },
}
const TYPE_COLORS: Record<string, string> = {
  casual:  'bg-blue-100  text-blue-700',
  medical: 'bg-red-100   text-red-700',
  earned:  'bg-green-100 text-green-700',
}
const TYPE_CAL: Record<string, string> = {
  casual:  'bg-blue-400',
  medical: 'bg-red-400',
  earned:  'bg-green-400',
}

function RejectDialog({ onConfirm }: { onConfirm: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const confirm = () => {
    onConfirm(note)
    setNote('')
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" variant="secondary" className="text-red-600 hover:bg-red-50 border-red-200">Reject</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Reject Leave Request</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">Optionally provide a reason for the employee.</Dialog.Description>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            rows={3} placeholder="Reason for rejection (optional)…"
            className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          <div className="flex gap-3 mt-4 justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700" onClick={confirm}>Confirm Reject</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function LeaveCalendar({ leaves }: { leaves: Leave[] }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  const getLeavesForDay = (d: number) => {
    const date = new Date(year, month, d)
    return leaves.filter(l => {
      const start = new Date(l.startDate)
      const end   = new Date(l.endDate)
      start.setHours(0,0,0,0); end.setHours(23,59,59,999)
      return date >= start && date <= end
    })
  }

  const prev = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const next = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) }  else setMonth(m => m + 1) }

  return (
    <div className="bg-white rounded-2xl border border-surface-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button type="button" aria-label="Previous month" onClick={prev} className="p-1.5 rounded-lg hover:bg-surface transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <p className="font-bold text-gray-900 text-sm">{MONTHS[month]} {year}</p>
        <button type="button" aria-label="Next month" onClick={next} className="p-1.5 rounded-lg hover:bg-surface transition-colors"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <p key={d} className="text-center text-[10px] font-bold text-surface-muted py-1">{d}</p>)}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-y-1">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
          const dayLeaves = getLeavesForDay(d)
          const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          return (
            <div key={d} className="relative flex flex-col items-center py-1 group">
              <span className={`text-xs w-7 h-7 flex items-center justify-center rounded-full font-medium
                ${isToday ? 'bg-brand-500 text-white font-bold' : 'text-gray-700 hover:bg-surface'}`}>
                {d}
              </span>
              <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                {dayLeaves.slice(0, 3).map(l => (
                  <span
                    key={l._id}
                    title={`${l.userName || 'You'}: ${l.type} (${l.status})`}
                    className={`w-1.5 h-1.5 rounded-full ${l.status === 'rejected' ? 'bg-red-400' : l.status === 'approved' ? TYPE_CAL[l.type] || 'bg-green-400' : 'bg-yellow-400'}`}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-surface-border flex-wrap">
        {[
          { color: 'bg-yellow-400', label: 'Pending' },
          { color: 'bg-green-400',  label: 'Approved' },
          { color: 'bg-red-400',    label: 'Rejected' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-surface-muted">
            <span className={`w-2.5 h-2.5 rounded-full ${color}`} />{label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function LMSPage() {
  const { user } = useUser()
  const toast = useToast()
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  const [leaves,    setLeaves]    = useState<Leave[]>([])
  const [filter,    setFilter]    = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [loading,   setLoading]   = useState(true)
  const [view,      setView]      = useState<'list' | 'calendar'>('list')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const fetchLeaves = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo)   params.set('to',   dateTo)
      const res = await fetch(`/api/lms${params.toString() ? '?' + params : ''}`)
      if (!res.ok) { setLeaves([]); return }
      const data = await res.json()
      setLeaves(Array.isArray(data) ? data : [])
    } catch { setLeaves([]) }
    finally { setLoading(false) }
  }, [filter, dateFrom, dateTo])

  useEffect(() => { fetchLeaves() }, [fetchLeaves])

  const handleAction = async (id: string, status: 'approved' | 'rejected', note?: string) => {
    await fetch(`/api/lms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, managerNote: note }),
    })
    toast(status === 'approved' ? 'Leave approved' : 'Leave rejected', status === 'approved' ? 'success' : 'error')
    fetchLeaves()
  }

  return (
    <>
      <Header title="Leave Management" />
      <main className="flex-1 p-6 space-y-5">

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex gap-2 flex-wrap">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(s => (
              <button type="button" key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all
                  ${filter === s ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date range filter */}
            <button type="button" onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all
                ${(dateFrom || dateTo) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-surface-border text-gray-600 hover:border-brand-400'}`}>
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
            {/* View toggle */}
            <div className="flex items-center bg-white border border-surface-border rounded-lg p-0.5">
              {([['list', List], ['calendar', Calendar]] as const).map(([v, Icon]) => (
                <button type="button" key={v} onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
                    ${view === v ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Icon className="w-3.5 h-3.5" />{v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <Link href="/lms/new"><Button className="gap-2"><Plus className="w-4 h-4" /> Request Leave</Button></Link>
          </div>
        </div>

        {/* Date filter panel */}
        {showFilters && (
          <div className="flex items-end gap-3 p-4 bg-white rounded-xl border border-surface-border flex-wrap">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-muted uppercase tracking-wide">From</label>
              <input type="date" aria-label="From date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="h-9 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-muted uppercase tracking-wide">To</label>
              <input type="date" aria-label="To date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)}
                className="h-9 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            {(dateFrom || dateTo) && (
              <button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}
                className="px-3 h-9 rounded-lg text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                Clear
              </button>
            )}
          </div>
        )}

        {/* Leave balance chips (employee) */}
        {!isManager && (
          <div className="flex gap-3 flex-wrap">
            {[
              { label: 'Casual', max: 12, color: 'bg-blue-50 border-blue-200 text-blue-700' },
              { label: 'Medical', max: 6,  color: 'bg-red-50   border-red-200   text-red-700' },
              { label: 'Earned',  max: 15, color: 'bg-green-50 border-green-200 text-green-700' },
            ].map(({ label, max, color }) => {
              const used = leaves.filter(l => l.type === label.toLowerCase() && l.status === 'approved').reduce((a, l) => a + l.days, 0)
              return (
                <div key={label} className={`px-4 py-2 rounded-xl border text-sm font-semibold ${color}`}>
                  {label}: <span className="font-extrabold">{max - used}</span>/{max} days left
                </div>
              )
            })}
          </div>
        )}

        {/* Calendar view */}
        {view === 'calendar' && <LeaveCalendar leaves={leaves} />}

        {/* List view */}
        {view === 'list' && (
          loading ? (
            <ListSkeleton rows={4} />
          ) : leaves.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <CalendarClock className="w-12 h-12 text-brand-200 mb-3" />
              <p className="font-semibold text-gray-900 mb-1">No leave requests</p>
              <p className="text-sm text-surface-muted mb-4">Submit your first leave request.</p>
              <Link href="/lms/new"><Button size="sm">Request Leave</Button></Link>
            </div>
          ) : (
            <div className="space-y-3">
              {leaves.map(leave => {
                const s = STATUS_MAP[leave.status]
                const SIcon = s.icon
                return (
                  <Link key={leave._id} href={`/lms/${leave._id}`} className="block">
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${TYPE_COLORS[leave.type] || 'bg-gray-100 text-gray-700'}`}>
                            {leave.type}
                          </span>
                          <Badge variant={s.variant} className="gap-1 text-xs">
                            <SIcon className="w-3 h-3" />{s.label}
                          </Badge>
                          {isManager && <span className="text-xs text-surface-muted font-medium">{leave.userName}</span>}
                        </div>
                        <p className="text-sm font-semibold text-gray-900">{leave.reason}</p>
                        <p className="text-xs text-surface-muted mt-0.5">
                          {new Date(leave.startDate).toLocaleDateString('en-IN')} — {new Date(leave.endDate).toLocaleDateString('en-IN')} · <strong>{leave.days}</strong> day{leave.days > 1 ? 's' : ''}
                        </p>
                        {leave.createdAt && (
                          <p className="text-[11px] text-surface-muted mt-0.5 flex items-center gap-1">
                            <History className="w-3 h-3" /> Submitted {timeAgo(leave.createdAt)}
                          </p>
                        )}
                        {leave.managerNote && <p className="text-xs text-surface-muted italic mt-1">Note: {leave.managerNote}</p>}
                        {leave.medicalDocs && leave.medicalDocs.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
                            {leave.medicalDocs.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noreferrer"
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors">
                                Doc {i + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      {isManager && leave.status === 'pending' && (
                        <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          <RejectDialog onConfirm={n => handleAction(leave._id, 'rejected', n)} />
                          <Button type="button" size="sm" onClick={() => handleAction(leave._id, 'approved')}>Approve</Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  </Link>
                )
              })}
            </div>
          )
        )}
      </main>
    </>
  )
}
