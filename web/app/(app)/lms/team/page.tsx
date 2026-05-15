'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronLeft, ChevronRight, CalendarClock, CalendarDays, Users,
  CircleDot, Sparkles, X,
} from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Leave {
  _id: string; userName: string; userId: string
  type: string; startDate: string; endDate: string
  days: number; status: 'pending' | 'approved' | 'rejected'
}

interface Holiday {
  _id?: string; name: string; date: string; type: string
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const TYPE_FILTERS = [
  { id: 'all',        label: 'All',        color: 'bg-brand-500'   },
  { id: 'casual',     label: 'Casual',     color: 'bg-blue-400'    },
  { id: 'sick',       label: 'Sick',       color: 'bg-red-400'     },
  { id: 'earned',     label: 'Earned',     color: 'bg-green-400'   },
  { id: 'privilege',  label: 'Privilege',  color: 'bg-purple-400'  },
  { id: 'lwp',        label: 'LWP',        color: 'bg-gray-400'    },
  { id: 'restricted', label: 'Restricted', color: 'bg-orange-400'  },
] as const

function leaveChipClasses(l: Leave): string {
  if (l.status === 'pending') return 'bg-yellow-100 text-yellow-800 border-yellow-300'
  if (l.type === 'casual')      return 'bg-blue-100 text-blue-800 border-blue-300'
  if (l.type === 'sick' || l.type === 'medical') return 'bg-red-100 text-red-800 border-red-300'
  if (l.type === 'privilege')   return 'bg-purple-100 text-purple-800 border-purple-300'
  if (l.type === 'lwp')         return 'bg-gray-200 text-gray-800 border-gray-300'
  if (l.type === 'restricted')  return 'bg-orange-100 text-orange-800 border-orange-300'
  if (l.type === 'earned')      return 'bg-green-100 text-green-800 border-green-300'
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

function iconBgFor(type: string): string {
  if (type === 'casual')                                  return 'bg-blue-100   text-blue-700'
  if (type === 'sick' || type === 'medical')              return 'bg-red-100    text-red-700'
  if (type === 'privilege')                               return 'bg-purple-100 text-purple-700'
  if (type === 'lwp')                                     return 'bg-gray-100   text-gray-700'
  if (type === 'restricted')                              return 'bg-orange-100 text-orange-700'
  if (type === 'earned')                                  return 'bg-green-100  text-green-700'
  return 'bg-gray-100 text-gray-600'
}

export default function TeamCalendarPage() {
  const today = new Date()
  const [year,    setYear]    = useState(today.getFullYear())
  const [month,   setMonth]   = useState(today.getMonth())
  const [leaves,  setLeaves]  = useState<Leave[]>([])
  const [holidays,setHolidays]= useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<string>('all')
  const [selected,setSelected]= useState<{ date: number; leaves: Leave[]; holiday: Holiday | null } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [lRes, hRes] = await Promise.all([
        fetch('/api/lms'),
        fetch(`/api/holidays?year=${year}`),
      ])
      const lData = await lRes.json()
      const hData = await hRes.json()
      setLeaves(Array.isArray(lData) ? lData.filter((l: Leave) => l.status !== 'rejected') : [])
      setHolidays(Array.isArray(hData) ? hData : [])
    } catch { setLeaves([]); setHolidays([]) }
    finally { setLoading(false) }
  }, [year])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Filtering ─────────────────────────────────────────────────────────
  const filteredLeaves = useMemo(() => {
    if (filter === 'all') return leaves
    if (filter === 'sick') return leaves.filter(l => l.type === 'sick' || l.type === 'medical')
    return leaves.filter(l => l.type === filter)
  }, [leaves, filter])

  // ── Calendar helpers ──────────────────────────────────────────────────
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const prev = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const next = () => { if (month === 11) { setYear(y => y + 1); setMonth(0)  } else setMonth(m => m + 1) }
  const goToToday = () => {
    setYear(today.getFullYear()); setMonth(today.getMonth())
    setSelected(null)
  }

  const getLeavesForDay = useCallback((d: number) => {
    const date = new Date(year, month, d)
    return filteredLeaves.filter(l => {
      const start = new Date(l.startDate); const end = new Date(l.endDate)
      start.setHours(0,0,0,0); end.setHours(23,59,59,999)
      return date >= start && date <= end
    })
  }, [filteredLeaves, year, month])

  const getHolidayForDay = useCallback((d: number) => {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    return holidays.find(h => h.date.startsWith(dateStr)) || null
  }, [holidays, year, month])

  // ── Stats ─────────────────────────────────────────────────────────────
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const onLeaveToday = useMemo(() => {
    const t = new Date(todayStr)
    return leaves.filter(l => {
      const s = new Date(l.startDate); const e = new Date(l.endDate)
      s.setHours(0,0,0,0); e.setHours(23,59,59,999)
      return t >= s && t <= e && l.status === 'approved'
    })
  }, [leaves, todayStr])

  const todayMs = today.getTime()
  const onLeaveThisWeek = useMemo(() => {
    const t = new Date(todayMs)
    const sow = new Date(t); sow.setDate(t.getDate() - t.getDay()); sow.setHours(0,0,0,0)
    const eow = new Date(sow); eow.setDate(sow.getDate() + 6); eow.setHours(23,59,59,999)
    return leaves.filter(l => {
      const s = new Date(l.startDate); const e = new Date(l.endDate)
      return e >= sow && s <= eow && l.status === 'approved'
    }).length
  }, [leaves, todayMs])

  const pendingCount = useMemo(() => leaves.filter(l => l.status === 'pending').length, [leaves])

  const monthLeaves = useMemo(() =>
    filteredLeaves.filter(l => {
      const s = new Date(l.startDate); const e = new Date(l.endDate)
      const mStart = new Date(year, month, 1); const mEnd = new Date(year, month + 1, 0, 23, 59, 59)
      return e >= mStart && s <= mEnd
    }), [filteredLeaves, year, month])

  const uniqueUsers = Array.from(new Set(monthLeaves.map(l => l.userName))).sort()

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()

  return (
    <>
      <Header title="Team Leave Calendar" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* ── Stats row ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="On leave today"
            value={onLeaveToday.length}
            hint={onLeaveToday.length === 0 ? 'Full attendance' : onLeaveToday.slice(0, 2).map(l => l.userName.split(' ')[0]).join(', ') + (onLeaveToday.length > 2 ? ` +${onLeaveToday.length - 2}` : '')}
            tone="brand"
          />
          <StatCard label="On leave this week" value={onLeaveThisWeek} hint="Approved overlaps" tone="info" />
          <StatCard label="Pending review"     value={pendingCount}    hint={pendingCount > 0 ? <Link href="/lms" className="hover:underline">Open LMS →</Link> : 'All caught up'} tone="warn" />
          <StatCard label="People in view"     value={uniqueUsers.length} hint={`${monthLeaves.length} leaves in ${MONTHS[month]}`} tone="neutral" />
        </div>

        {/* ── Toolbar: type filters + today ───────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border
                  ${filter === f.id
                    ? 'bg-dm-graphite text-white border-dm-graphite'
                    : 'bg-white text-gray-600 border-surface-border hover:border-brand-400'}`}>
                <span className={`w-2 h-2 rounded-full ${f.color}`} />
                {f.label}
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={goToToday} disabled={isCurrentMonth && !selected}
            className="gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" /> Today
          </Button>
        </div>

        {/* ── Calendar + side panel ───────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">

          {/* Calendar */}
          <div className="bg-white rounded-2xl border border-surface-border p-5">
            {/* Nav */}
            <div className="flex items-center justify-between mb-5">
              <button type="button" aria-label="Previous month" onClick={prev}
                className="p-2 rounded-lg hover:bg-surface transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-base font-bold text-gray-900 tracking-tight">{MONTHS[month]} {year}</h2>
              <button type="button" aria-label="Next month" onClick={next}
                className="p-2 rounded-lg hover:bg-surface transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-2">
              {DAYS.map(d => (
                <p key={d} className="text-center text-[10px] font-bold text-surface-muted py-1 uppercase tracking-wide">{d}</p>
              ))}
            </div>

            {/* Grid */}
            {loading ? (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-surface-border animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                  const dayLeaves = getLeavesForDay(d)
                  const holiday   = getHolidayForDay(d)
                  const isToday   = d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
                  const isWeekend = new Date(year, month, d).getDay() % 6 === 0
                  const isSelected = selected?.date === d
                  const hasContent = dayLeaves.length > 0 || holiday
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!hasContent && !isToday}
                      onClick={() => setSelected(hasContent ? { date: d, leaves: dayLeaves, holiday } : null)}
                      className={`relative flex flex-col items-start p-1.5 rounded-lg border min-h-[72px] transition-all text-left
                        ${isSelected ? 'ring-2 ring-brand-400 border-brand-400 bg-brand-50/50' :
                          holiday ? 'border-brand-200 bg-[#e8f0fa]/50' :
                          isToday ? 'border-brand-400 bg-brand-50 shadow-sm' :
                          hasContent ? 'border-surface-border hover:border-brand-200 hover:bg-surface' :
                          isWeekend ? 'border-transparent bg-surface/40' :
                          'border-transparent hover:bg-surface'}
                        ${!hasContent && !isToday ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <span className={`text-xs font-bold mb-1 w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0
                        ${isToday ? 'bg-brand-500 text-white' :
                          holiday ? 'bg-brand-600 text-white' :
                          isWeekend ? 'text-surface-muted' : 'text-gray-700'}`}>
                        {d}
                      </span>
                      <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                        {holiday && (
                          <div className="flex items-center gap-1 px-1 py-0.5 rounded text-[8px] font-bold border bg-brand-100 text-brand-800 border-brand-200 truncate leading-tight"
                            title={holiday.name}>
                            <Sparkles className="w-2 h-2 flex-shrink-0" />
                            <span className="truncate">{holiday.name}</span>
                          </div>
                        )}
                        {dayLeaves.slice(0, holiday ? 1 : 2).map(l => (
                          <div key={l._id}
                            className={`flex items-center gap-1 px-1 py-0.5 rounded text-[8px] font-semibold border truncate leading-tight ${leaveChipClasses(l)}`}
                            title={`${l.userName} · ${l.type} · ${l.status}`}>
                            {l.status === 'pending' && <CircleDot className="w-2 h-2 flex-shrink-0" />}
                            <span className="truncate">{l.userName.split(' ')[0]}</span>
                          </div>
                        ))}
                        {dayLeaves.length > (holiday ? 1 : 2) && (
                          <span className="text-[8px] text-surface-muted font-bold px-1">
                            +{dayLeaves.length - (holiday ? 1 : 2)} more
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Legend */}
            <div className="mt-5 pt-4 border-t border-surface-border flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 text-[10px] text-surface-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-brand-500" />Today
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-surface-muted">
                <span className="w-2.5 h-2.5 rounded bg-brand-100 border border-brand-300" />Holiday
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-surface-muted">
                <CircleDot className="w-3 h-3 text-yellow-600" />Pending leave
              </span>
              <span className="ml-auto text-[10px] text-surface-muted">
                Click a day with activity to see details
              </span>
            </div>
          </div>

          {/* Side panel */}
          <aside className="space-y-3 lg:sticky lg:top-24">
            {selected ? (
              <DetailPanel
                date={selected.date}
                monthLabel={MONTHS[month]}
                year={year}
                leaves={selected.leaves}
                holiday={selected.holiday}
                onClose={() => setSelected(null)}
              />
            ) : (
              <UpcomingPanel leaves={leaves.filter(l => new Date(l.startDate) >= today).slice(0, 6)} holidays={holidays} />
            )}
          </aside>
        </div>
      </main>
    </>
  )
}

/* ─── Components ──────────────────────────────────────────────────────── */

function StatCard({ label, value, hint, tone }: {
  label: string
  value: number
  hint?: React.ReactNode
  tone: 'brand' | 'info' | 'warn' | 'neutral'
}) {
  const colorClasses = {
    brand:   'bg-white border-surface-border',
    info:    'bg-white border-surface-border',
    warn:    'bg-white border-surface-border',
    neutral: 'bg-white border-surface-border',
  }[tone]
  const valueColor = {
    brand:   'text-brand-600',
    info:    'text-blue-600',
    warn:    value > 0 ? 'text-amber-600' : 'text-gray-400',
    neutral: 'text-dm-graphite',
  }[tone]
  return (
    <div className={`rounded-2xl border p-4 ${colorClasses}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">{label}</p>
      <p className={`text-3xl font-extrabold tracking-tighter tabular-nums mt-1 ${valueColor}`}>{value}</p>
      {hint && <p className="text-[11px] text-surface-muted mt-1 truncate">{hint}</p>}
    </div>
  )
}

function DetailPanel({ date, monthLabel, year, leaves, holiday, onClose }: {
  date: number; monthLabel: string; year: number
  leaves: Leave[]; holiday: Holiday | null
  onClose: () => void
}) {
  const weekday = new Date(year, MONTHS_INDEX_LOOKUP[monthLabel], date).toLocaleDateString('en-IN', { weekday: 'long' })
  return (
    <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">{weekday}</p>
          <h3 className="font-extrabold text-gray-900 text-base tracking-tight">{monthLabel} {date}, {year}</h3>
        </div>
        <button type="button" aria-label="Close detail" onClick={onClose}
          className="p-1.5 rounded-lg text-surface-muted hover:bg-surface transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {holiday && (
        <div className="px-4 py-3 bg-brand-50/50 border-b border-brand-200 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-brand-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">{holiday.name}</p>
            <p className="text-[10px] capitalize text-surface-muted">{holiday.type} holiday</p>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2 flex items-center gap-1.5">
          <Users className="w-3 h-3" /> On leave ({leaves.length})
        </p>
        {leaves.length === 0 ? (
          <p className="text-xs text-surface-muted py-2">Nobody on leave this day.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {leaves.map(l => (
              <li key={l._id} className="py-2.5 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBgFor(l.type)}`}>
                  <CalendarClock className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{l.userName}</p>
                  <p className="text-[10px] text-surface-muted capitalize">{l.type} · {l.days} day{l.days !== 1 ? 's' : ''}</p>
                </div>
                <Badge variant={l.status === 'approved' ? 'success' : 'warning'} className="text-[10px] capitalize flex-shrink-0">
                  {l.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function UpcomingPanel({ leaves, holidays }: { leaves: Leave[]; holidays: Holiday[] }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const upcomingHolidays = holidays
    .map(h => ({ ...h, dateObj: new Date(h.date) }))
    .filter(h => h.dateObj >= today)
    .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime())
    .slice(0, 4)

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted flex items-center gap-1.5">
            <Users className="w-3 h-3" /> Upcoming leaves
          </p>
        </div>
        {leaves.length === 0 ? (
          <p className="text-xs text-surface-muted px-4 py-5 text-center">No upcoming leaves on record.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {leaves.map(l => {
              const start = new Date(l.startDate)
              return (
                <li key={l._id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex flex-col items-center w-9 flex-shrink-0">
                    <span className="text-[9px] font-bold uppercase text-surface-muted leading-none">
                      {start.toLocaleDateString('en-IN', { month: 'short' })}
                    </span>
                    <span className="text-lg font-extrabold text-dm-graphite leading-none tracking-tighter">{start.getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{l.userName}</p>
                    <p className="text-[10px] text-surface-muted capitalize">{l.type} · {l.days} day{l.days !== 1 ? 's' : ''}</p>
                  </div>
                  <Badge variant={l.status === 'approved' ? 'success' : 'warning'} className="text-[9px] capitalize flex-shrink-0">
                    {l.status}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Upcoming holidays
          </p>
        </div>
        {upcomingHolidays.length === 0 ? (
          <p className="text-xs text-surface-muted px-4 py-5 text-center">No upcoming holidays this year.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {upcomingHolidays.map(h => (
              <li key={h.name + h.date} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex flex-col items-center w-9 flex-shrink-0">
                  <span className="text-[9px] font-bold uppercase text-brand-500 leading-none">
                    {h.dateObj.toLocaleDateString('en-IN', { month: 'short' })}
                  </span>
                  <span className="text-lg font-extrabold text-dm-graphite leading-none tracking-tighter">
                    {h.dateObj.getDate()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{h.name}</p>
                  <p className="text-[10px] text-surface-muted capitalize">{h.type} holiday</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const MONTHS_INDEX_LOOKUP: Record<string, number> = MONTHS.reduce((acc, m, i) => {
  acc[m] = i; return acc
}, {} as Record<string, number>)
