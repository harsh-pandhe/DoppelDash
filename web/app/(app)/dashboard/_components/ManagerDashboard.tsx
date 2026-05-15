import Link from 'next/link'
import { CalendarClock, Receipt, Plane, ArrowRight, BarChart2, Megaphone } from 'lucide-react'
import { connectDB } from '@/lib/db'
import Leave    from '@/models/Leave'
import Expense  from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import User     from '@/models/User'
import Employee from '@/models/Employee'
import { timeAgo } from '@/lib/timeAgo'
import ApprovalsQueue, { type PendingItem } from './ApprovalsQueue'
import TeamPanel from './TeamPanel'

interface Props {
  userId:    string
  firstName: string
  isBoss:    boolean
}

export default async function ManagerDashboard({ firstName, isBoss }: Props) {
  await connectDB()

  // ─── Approvals queue (3 kinds aggregated) ──────────────────────────
  const expenseStatusToReview = isBoss ? 'pending_boss' : 'pending_manager'
  const travelStatusToReview  = isBoss ? 'pending_boss' : 'pending_manager'

  const [pendingLeaves, pendingExpenses, pendingTravel] = await Promise.all([
    Leave.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(50).lean(),
    Expense.find({ status: expenseStatusToReview }).sort({ createdAt: -1 }).limit(50).lean(),
    TravelRequest.find({ status: travelStatusToReview }).sort({ createdAt: -1 }).limit(50).lean(),
  ])

  const queue: PendingItem[] = [
    ...pendingLeaves.map(l => ({
      id:       String(l._id),
      kind:     'leave' as const,
      userName: l.userName,
      title:    `${(l.type as string) === 'medical' ? 'Sick' : l.type[0].toUpperCase() + l.type.slice(1)} · ${l.days} day${l.days !== 1 ? 's' : ''}`,
      subtitle: l.reason || '',
      badge:    `${l.days}d`,
      meta:     `Submitted ${timeAgo(l.createdAt as Date)}`,
      href:     '/lms',
    })),
    ...pendingExpenses.map(e => ({
      id:       String(e._id),
      kind:     'expense' as const,
      userName: e.userName,
      title:    e.title,
      subtitle: e.reason || '',
      badge:    `₹${e.amount.toLocaleString('en-IN')}`,
      meta:     `Submitted ${timeAgo(e.createdAt as Date)}${e.hasLineItems && Array.isArray(e.lineItems) ? ` · ${e.lineItems.length} line items` : ''}`,
      href:     '/rms',
    })),
    ...pendingTravel.map(t => ({
      id:       String(t._id),
      kind:     'travel' as const,
      userName: t.userName,
      title:    `${t.destination} — ${t.purpose}`,
      subtitle: `${new Date(t.departureDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} → ${new Date(t.returnDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
      badge:    `₹${t.estimatedTotal.toLocaleString('en-IN')}`,
      meta:     `Submitted ${timeAgo(t.createdAt as Date)}${t.advanceRequested > 0 ? ` · ₹${t.advanceRequested.toLocaleString('en-IN')} advance` : ''}`,
      href:     '/travel',
    })),
  ].sort((a, b) => a.meta.localeCompare(b.meta))   // recency-ish

  // ─── Team data ──────────────────────────────────────────────────────
  const [team, employees] = await Promise.all([
    User.find({ role: { $in: ['employee', 'manager'] } }).select('firstName lastName role').lean(),
    Employee.find({}).select('clerkUserId department onboardingComplete').lean(),
  ])
  const empMap = new Map(employees.map(e => [e.clerkUserId, e]))
  const teamMembers = team.map(u => ({
    id:         String(u._id),
    name:       `${u.firstName} ${u.lastName}`.trim(),
    role:       u.role,
    department: empMap.get(String(u._id))?.department || 'General',
    onboardingComplete: empMap.get(String(u._id))?.onboardingComplete ?? true,
  })).filter(m => m.role !== 'manager' || isBoss)   // managers see employees, boss sees both

  // ─── On leave today ─────────────────────────────────────────────────
  const today  = new Date(); today.setHours(0, 0, 0, 0)
  const todayLeaves = await Leave.find({
    status: 'approved',
    startDate: { $lte: new Date(today.getTime() + 86400000 - 1) },
    endDate:   { $gte: today },
  }).select('userName type endDate').lean()

  // ─── 14-day availability ────────────────────────────────────────────
  const horizon = new Date(today.getTime() + 14 * 86400000)
  const upcomingLeaves = await Leave.find({
    status: 'approved',
    startDate: { $lt: horizon },
    endDate:   { $gte: today },
  }).select('startDate endDate').lean()

  const availability = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() + i * 86400000)
    const count = upcomingLeaves.filter(l => {
      const s = new Date(l.startDate as Date); s.setHours(0, 0, 0, 0)
      const e = new Date(l.endDate as Date);   e.setHours(23, 59, 59, 999)
      return s <= d && d <= e
    }).length
    return { date: d, count }
  })

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-6 w-full bg-surface-2">

      {/* ── Hero strip: greeting + jump links ─────────────────────────── */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-surface-muted">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tighter text-dm-graphite mt-1">
            {greeting}, <span className="text-dm-orange">{firstName}</span>
          </h1>
          <p className="text-sm text-dm-graphite-3 mt-1">
            {queue.length > 0
              ? <><strong className="text-dm-graphite">{queue.length}</strong> item{queue.length !== 1 ? 's' : ''} need your decision today.</>
              : 'Inbox clear. Nice work.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { href: '/lms/team',     icon: CalendarClock, label: 'Calendar' },
            { href: '/announcements',icon: Megaphone,     label: 'News' },
            { href: '/analytics',    icon: BarChart2,     label: 'Analytics' },
          ].map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-white border border-surface-border rounded-lg text-xs font-bold text-dm-graphite hover:border-dm-graphite hover:bg-surface-1 transition-colors"
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </Link>
          ))}
        </div>
      </header>

      {/* ── 2-column action layout ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6 items-start">

        {/* LEFT — Approvals queue */}
        <div className="space-y-6">
          <ApprovalsQueue items={queue} isBoss={isBoss} />

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { kind: 'leave',   count: pendingLeaves.length,   icon: CalendarClock, href: '/lms' },
              { kind: 'expense', count: pendingExpenses.length, icon: Receipt,       href: '/rms' },
              { kind: 'travel',  count: pendingTravel.length,   icon: Plane,         href: '/travel' },
            ].map(s => {
              const Icon = s.icon
              return (
                <Link
                  key={s.kind}
                  href={s.href}
                  className="bg-white border border-surface-border rounded-lg p-4 hover:border-dm-graphite hover:shadow-card-hover transition-all group"
                >
                  <Icon className="w-4 h-4 text-dm-graphite-3 mb-2" />
                  <p className="text-3xl font-black text-dm-graphite tabular-nums tracking-tighter">{s.count}</p>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-1 flex items-center gap-1">
                    Pending {s.kind} <ArrowRight className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                  </p>
                </Link>
              )
            })}
          </div>
        </div>

        {/* RIGHT — Team panel */}
        <div>
          <TeamPanel
            team={teamMembers}
            onLeaveToday={todayLeaves.map(l => ({
              userName: l.userName,
              type:     l.type,
              endDate:  l.endDate as Date,
            }))}
            availability={availability}
          />
        </div>
      </div>
    </main>
  )
}
