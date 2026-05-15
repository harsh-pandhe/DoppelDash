import Link from 'next/link'
import {
  CalendarClock, Receipt, Plane, ScanLine, ArrowRight, Pin, Calendar,
  Clock, CheckCircle2, XCircle, RotateCcw, Megaphone, Plus,
} from 'lucide-react'
import { connectDB } from '@/lib/db'
import Leave         from '@/models/Leave'
import Expense       from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import LeaveBalance  from '@/models/LeaveBalance'
import Announcement  from '@/models/Announcement'
import PublicHoliday from '@/models/PublicHoliday'
import { timeAgo } from '@/lib/timeAgo'

interface Props {
  userId:    string
  firstName: string
}

const LEAVE_TYPES = [
  { key: 'casual',     label: 'Casual',    color: 'bg-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700' },
  { key: 'sick',       label: 'Sick',      color: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700' },
  { key: 'earned',     label: 'Earned',    color: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700' },
  { key: 'privilege',  label: 'Privilege', color: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700' },
] as const

const STATUS_META: Record<string, { label: string; icon: typeof Clock; tone: string }> = {
  pending:          { label: 'Pending',  icon: Clock,        tone: 'bg-status-warning-bg text-status-warning' },
  pending_manager:  { label: 'Pending',  icon: Clock,        tone: 'bg-status-warning-bg text-status-warning' },
  pending_boss:     { label: 'Pending',  icon: Clock,        tone: 'bg-status-info-bg text-status-info' },
  approved:         { label: 'Approved', icon: CheckCircle2, tone: 'bg-status-success-bg text-status-success' },
  paid:             { label: 'Paid',     icon: CheckCircle2, tone: 'bg-status-success-bg text-status-success' },
  rejected:         { label: 'Rejected', icon: XCircle,      tone: 'bg-status-danger-bg text-status-danger' },
  returned:         { label: 'Revise',   icon: RotateCcw,    tone: 'bg-status-warning-bg text-status-warning' },
}

export default async function EmployeeDashboard({ userId, firstName }: Props) {
  await connectDB()
  const year = new Date().getFullYear()
  const today = new Date()
  const in30  = new Date(today.getTime() + 30 * 86400000)

  const [
    myLeaves, myExpenses, myTravel,
    balance, pinnedAnnos, upcomingHolidays, returnedExpenses,
  ] = await Promise.all([
    Leave.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    Expense.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    TravelRequest.find({ userId }).sort({ createdAt: -1 }).limit(4).lean(),
    LeaveBalance.findOne({ userId, year }).lean(),
    Announcement.find({ pinned: true }).sort({ createdAt: -1 }).limit(3).lean(),
    PublicHoliday.find({ date: { $gte: today, $lt: in30 } }).sort({ date: 1 }).limit(4).lean(),
    Expense.find({ userId, status: 'returned' }).sort({ updatedAt: -1 }).limit(3).lean(),
  ])

  // Approved leave days taken (per type)
  const approvedLeaves = myLeaves.filter(l => l.status === 'approved')
  const used = {
    casual:    approvedLeaves.filter(l => l.type === 'casual').reduce((s, l) => s + l.days, 0),
    sick:      approvedLeaves.filter(l => l.type === 'sick' || (l.type as string) === 'medical').reduce((s, l) => s + l.days, 0),
    earned:    approvedLeaves.filter(l => l.type === 'earned').reduce((s, l) => s + l.days, 0),
    privilege: approvedLeaves.filter(l => l.type === 'privilege').reduce((s, l) => s + l.days, 0),
  }
  const bal = balance || { casual: 12, sick: 6, earned: 15, privilege: 2 }

  // Recent activity (last 5 across leaves + expenses + travel)
  type Activity = { ts: number; kind: 'leave' | 'expense' | 'travel'; title: string; status: string; href: string }
  const activity: Activity[] = [
    ...myLeaves.map(l => ({
      ts: new Date(l.createdAt as Date).getTime(),
      kind: 'leave' as const,
      title: `${(l.type as string)[0].toUpperCase() + (l.type as string).slice(1)} leave · ${l.days}d`,
      status: l.status, href: '/lms',
    })),
    ...myExpenses.map(e => ({
      ts: new Date(e.createdAt as Date).getTime(),
      kind: 'expense' as const,
      title: `${e.title} · ₹${e.amount.toLocaleString('en-IN')}`,
      status: e.status, href: '/rms',
    })),
    ...myTravel.map(t => ({
      ts: new Date(t.createdAt as Date).getTime(),
      kind: 'travel' as const,
      title: `${t.destination} · ${t.purpose.slice(0, 30)}`,
      status: t.status, href: '/travel',
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 5)

  // Reimbursements waiting (pending + pending_boss for this user)
  const pendingReimb = myExpenses.filter(e => e.status === 'pending_manager' || e.status === 'pending_boss')
  const pendingAmt   = pendingReimb.reduce((s, e) => s + e.amount, 0)

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-6 w-full bg-surface-2">

      {/* ── Hero greeting ─────────────────────────────────────────────── */}
      <header>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-surface-muted">
          {today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tighter text-dm-graphite mt-1">
          {greeting}, <span className="text-dm-orange">{firstName}</span>
        </h1>
        <p className="text-sm text-dm-graphite-3 mt-1">
          {returnedExpenses.length > 0
            ? <><strong className="text-status-warning">{returnedExpenses.length}</strong> expense{returnedExpenses.length !== 1 ? 's' : ''} need revision.</>
            : pendingReimb.length > 0
            ? <><strong className="text-dm-graphite">₹{pendingAmt.toLocaleString('en-IN')}</strong> reimbursement{pendingReimb.length !== 1 ? 's' : ''} pending.</>
            : 'All your requests are settled. Have a productive day.'}
        </p>
      </header>

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/lms',    icon: CalendarClock, label: 'Request leave',  hint: 'Casual · Sick · Earned' },
            { href: '/rms',    icon: Receipt,       label: 'Log expense',    hint: 'Reimbursement' },
            { href: '/travel', icon: Plane,         label: 'Travel request', hint: 'Pre-trip approval' },
            { href: '/crm',    icon: ScanLine,      label: 'Add contact',    hint: 'Scan business card' },
          ].map(({ href, icon: Icon, label, hint }) => (
            <Link
              key={href}
              href={href}
              className="group bg-white border border-surface-border rounded-lg p-4 hover:border-dm-graphite hover:shadow-card-hover transition-all"
            >
              <div className="w-9 h-9 rounded-md bg-surface-2 group-hover:bg-dm-orange-50 flex items-center justify-center mb-3 transition-colors">
                <Icon className="w-4 h-4 text-dm-graphite-3 group-hover:text-dm-orange transition-colors" />
              </div>
              <p className="text-sm font-bold text-dm-graphite">{label}</p>
              <p className="text-[10px] text-surface-muted mt-0.5">{hint}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Returned expenses banner (urgent for employee) ────────────── */}
      {returnedExpenses.length > 0 && (
        <section className="bg-status-warning-bg border border-status-warning/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-status-warning">
                {returnedExpenses.length} expense{returnedExpenses.length !== 1 ? 's' : ''} need revision
              </p>
              <p className="text-xs text-dm-graphite-2 mt-0.5">Manager sent back for changes. Open and resubmit.</p>
              <div className="mt-2 space-y-1">
                {returnedExpenses.map(e => (
                  <Link key={String(e._id)} href="/rms" className="block text-xs text-status-warning hover:underline">
                    → {e.title} · ₹{e.amount.toLocaleString('en-IN')}
                    {e.managerNote && <span className="text-dm-graphite-3 italic"> — &quot;{e.managerNote.slice(0, 60)}&quot;</span>}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-start">

        {/* LEFT — Activity feed + Reimbursements pending */}
        <div className="space-y-6">

          {/* Recent activity */}
          <section className="bg-white border border-surface-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-dm-graphite">My recent requests</h2>
              <span className="text-[10px] font-mono text-surface-muted">LAST {activity.length}</span>
            </div>
            {activity.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Calendar className="w-8 h-8 text-surface-muted/50 mx-auto mb-2" />
                <p className="text-sm font-semibold text-dm-graphite">Nothing submitted yet</p>
                <p className="text-xs text-surface-muted mt-1">Your leave / expense / travel requests will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-surface-border">
                {activity.map((a, i) => {
                  const meta = STATUS_META[a.status] || STATUS_META.pending
                  const SIcon = meta.icon
                  const KindIcon = a.kind === 'leave' ? CalendarClock : a.kind === 'expense' ? Receipt : Plane
                  return (
                    <Link key={i} href={a.href} className="block px-5 py-3 hover:bg-surface-2/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <KindIcon className="w-4 h-4 text-dm-graphite-3 flex-shrink-0" />
                        <p className="text-sm font-semibold text-dm-graphite flex-1 truncate">{a.title}</p>
                        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.tone}`}>
                          <SIcon className="w-2.5 h-2.5" />{meta.label}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>

          {/* Reimbursements pending */}
          {pendingReimb.length > 0 && (
            <section className="bg-white border border-surface-border rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-dm-graphite">Reimbursements waiting</h2>
                <Link href="/rms" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600 flex items-center gap-1">
                  All <ArrowRight className="w-2.5 h-2.5" />
                </Link>
              </div>
              <div className="px-5 py-4">
                <p className="text-3xl font-black tracking-tighter text-dm-graphite tabular-nums">
                  ₹{pendingAmt.toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-1">
                  Across {pendingReimb.length} claim{pendingReimb.length !== 1 ? 's' : ''}
                </p>
                <div className="mt-4 space-y-1.5">
                  {pendingReimb.slice(0, 4).map(e => (
                    <div key={String(e._id)} className="flex items-center justify-between text-xs py-1.5 border-b border-surface-border last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-dm-graphite truncate">{e.title}</p>
                        <p className="text-[10px] text-surface-muted">{timeAgo(e.createdAt as Date)} · {e.status === 'pending_boss' ? 'Awaiting payout' : 'Manager review'}</p>
                      </div>
                      <span className="font-mono font-bold text-dm-graphite tabular-nums flex-shrink-0">
                        ₹{e.amount.toLocaleString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT — Balances + Holidays + Announcements */}
        <div className="space-y-6">

          {/* Leave balance gauges */}
          <section className="bg-white border border-surface-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-dm-graphite">Leave balance</h2>
              <span className="text-[10px] font-mono text-surface-muted">{year}</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {LEAVE_TYPES.map(t => {
                const total = (bal as Record<string, number>)[t.key] || 0
                const usedDays = used[t.key]
                const remaining = Math.max(0, total - usedDays)
                const pct = total > 0 ? Math.min(100, (usedDays / total) * 100) : 0
                return (
                  <div key={t.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold flex items-center gap-1.5`}>
                        <span className={`w-2 h-2 rounded-full ${t.color}`} />
                        <span className="text-dm-graphite">{t.label}</span>
                      </span>
                      <span className="text-xs font-mono">
                        <span className="font-bold text-dm-graphite">{remaining}</span>
                        <span className="text-surface-muted"> / {total}</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className={`h-full ${t.color} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <Link href="/lms" className="block px-5 py-2.5 border-t border-surface-border bg-surface-2/50 text-center text-[11px] font-bold text-dm-orange hover:bg-surface-2 transition-colors">
              <Plus className="w-3 h-3 inline mr-1" />Request leave
            </Link>
          </section>

          {/* Upcoming holidays */}
          {upcomingHolidays.length > 0 && (
            <section className="bg-white border border-surface-border rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-dm-graphite">Upcoming holidays</h2>
                <Link href="/lms/holidays" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600">All</Link>
              </div>
              <div className="divide-y divide-surface-border">
                {upcomingHolidays.map(h => {
                  const d = new Date(h.date as Date)
                  const daysAway = Math.ceil((d.getTime() - today.getTime()) / 86400000)
                  return (
                    <div key={String(h._id)} className="px-5 py-2.5 flex items-center gap-3">
                      <div className="text-center flex-shrink-0">
                        <p className="text-[9px] font-bold uppercase text-surface-muted leading-none">{d.toLocaleDateString('en-IN', { month: 'short' })}</p>
                        <p className="text-lg font-black tracking-tighter text-dm-graphite leading-none mt-0.5">{d.getDate()}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-dm-graphite truncate">{h.name}</p>
                        <p className="text-[10px] text-surface-muted capitalize">
                          {daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`} · {h.type}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Pinned announcements */}
          {pinnedAnnos.length > 0 && (
            <section className="bg-white border border-surface-border rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-dm-graphite flex items-center gap-1.5">
                  <Pin className="w-3 h-3" />Pinned
                </h2>
                <Link href="/announcements" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600">All</Link>
              </div>
              <div className="divide-y divide-surface-border">
                {pinnedAnnos.map(a => (
                  <Link key={String(a._id)} href="/announcements" className="block px-5 py-2.5 hover:bg-surface-2/50 transition-colors">
                    <div className="flex items-start gap-2">
                      <Megaphone className="w-3.5 h-3.5 text-dm-orange flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-dm-graphite truncate">{a.title}</p>
                        <p className="text-[10px] text-surface-muted line-clamp-1">
                          {(a.body || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 80)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}
