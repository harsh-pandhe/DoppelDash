import Link from 'next/link'
import {
  Wallet, TrendingUp, Plane, AlertOctagon, ArrowUp, ArrowDown,
  Shield, ClipboardList, BarChart2, Users, Activity, UserPlus,
  Clock, FileText, ChevronRight,
} from 'lucide-react'
import { connectDB } from '@/lib/db'
import Expense       from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Leave         from '@/models/Leave'
import User          from '@/models/User'
import Employee      from '@/models/Employee'
import AuditLog      from '@/models/AuditLog'
import { timeAgo } from '@/lib/timeAgo'
import ApprovalsQueue, { type PendingItem } from './ApprovalsQueue'

interface Props {
  firstName: string
}

export default async function BossDashboard({ firstName }: Props) {
  await connectDB()

  const now      = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const day7     = new Date(now.getTime() -  7 * 86400000)
  const day30    = new Date(now.getTime() - 30 * 86400000)

  // ─── Financial pulse ───────────────────────────────────────────────
  const [toPayoutAgg, paidYtdAgg, advanceAgg, travelYtdAgg] = await Promise.all([
    Expense.aggregate([
      { $match: { status: 'pending_boss' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: { status: 'paid', paidAt: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    TravelRequest.aggregate([
      { $match: { status: { $in: ['approved', 'pending_boss'] }, advanceRequested: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$advanceRequested' }, count: { $sum: 1 } } },
    ]),
    TravelRequest.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: '$estimatedTotal' }, count: { $sum: 1 } } },
    ]),
  ])

  const toPay     = toPayoutAgg[0]?.total || 0;     const toPayCount     = toPayoutAgg[0]?.count || 0
  const paidYtd   = paidYtdAgg[0]?.total  || 0;     const paidYtdCount   = paidYtdAgg[0]?.count  || 0
  const advance   = advanceAgg[0]?.total  || 0;     const advanceCount   = advanceAgg[0]?.count  || 0
  const travelYtd = travelYtdAgg[0]?.total|| 0;     const travelYtdCount = travelYtdAgg[0]?.count|| 0

  // ─── Org health ────────────────────────────────────────────────────
  const [allUsers, employees, recentLogins, onboardingPending] = await Promise.all([
    User.find({ isBanned: false }).select('_id role lastLoginAt').lean(),
    Employee.find({}).select('clerkUserId lastLoginAt onboardingComplete').lean(),
    User.find({ lastLoginAt: { $gte: day7 } }).countDocuments(),
    Employee.countDocuments({ onboardingComplete: false }),
  ])

  const empMap = new Map(employees.map(e => [e.clerkUserId, e]))
  const activeIn7d  = allUsers.filter(u => {
    const emp = empMap.get(String(u._id))
    const ts = emp?.lastLoginAt || u.lastLoginAt
    return ts && new Date(ts) >= day7
  }).length
  const activeIn30d = allUsers.filter(u => {
    const emp = empMap.get(String(u._id))
    const ts = emp?.lastLoginAt || u.lastLoginAt
    return ts && new Date(ts) >= day30
  }).length
  const totalUsers  = allUsers.length

  // ─── Escalations (boss-only approvals queue) ───────────────────────
  const [pendingBossExp, pendingBossTravel, pendingLeaves] = await Promise.all([
    Expense.find({ status: 'pending_boss' }).sort({ createdAt: -1 }).limit(20).lean(),
    TravelRequest.find({ status: 'pending_boss' }).sort({ createdAt: -1 }).limit(20).lean(),
    Leave.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(20).lean(),
  ])

  const queue: PendingItem[] = [
    ...pendingBossExp.map(e => ({
      id: String(e._id), kind: 'expense' as const, userName: e.userName,
      title: e.title, subtitle: e.reason || '',
      badge: `₹${e.amount.toLocaleString('en-IN')}`,
      meta: `Submitted ${timeAgo(e.createdAt as Date)}`,
      href: '/rms',
    })),
    ...pendingBossTravel.map(t => ({
      id: String(t._id), kind: 'travel' as const, userName: t.userName,
      title: `${t.destination} — ${t.purpose}`,
      subtitle: `${new Date(t.departureDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' })} → ${new Date(t.returnDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}`,
      badge: `₹${t.estimatedTotal.toLocaleString('en-IN')}`,
      meta: `Submitted ${timeAgo(t.createdAt as Date)}${t.advanceRequested > 0 ? ` · ₹${t.advanceRequested.toLocaleString('en-IN')} advance` : ''}`,
      href: '/travel',
    })),
    ...pendingLeaves.map(l => ({
      id: String(l._id), kind: 'leave' as const, userName: l.userName,
      title: `${(l.type as string)[0].toUpperCase() + (l.type as string).slice(1)} · ${l.days} day${l.days !== 1 ? 's' : ''}`,
      subtitle: l.reason || '',
      badge: `${l.days}d`,
      meta: `Submitted ${timeAgo(l.createdAt as Date)}`,
      href: '/lms',
    })),
  ]

  // ─── Latest audit activity ─────────────────────────────────────────
  const latestAudit = await AuditLog.find({}).sort({ createdAt: -1 }).limit(8).lean()

  const greeting = (() => {
    const h = now.getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-6 w-full bg-surface-2">

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-dm-orange/10 border border-dm-orange/20 text-dm-orange px-2 py-0.5 rounded">
              <Shield className="w-3 h-3" />Executive
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-surface-muted">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
          <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tighter text-dm-graphite">
            {greeting}, <span className="text-dm-orange">{firstName}</span>
          </h1>
          <p className="text-sm text-dm-graphite-3 mt-1">
            {queue.length > 0
              ? <><strong className="text-dm-graphite">{queue.length}</strong> item{queue.length !== 1 ? 's' : ''} awaiting your final decision.</>
              : 'All escalations cleared.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users" className="flex items-center gap-1.5 px-3 py-2 bg-dm-graphite hover:bg-dm-graphite-2 text-white rounded-lg text-xs font-bold transition-colors">
            <Users className="w-3.5 h-3.5" />Manage team
          </Link>
        </div>
      </header>

      {/* ── ROW 1 — Financial pulse (4 KPIs) ──────────────────────────── */}
      <section>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-3 flex items-center gap-1.5">
          <Wallet className="w-3 h-3" />Financial pulse
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI
            label="To pay out"
            value={`₹${toPay.toLocaleString('en-IN')}`}
            sub={`${toPayCount} pending`}
            href="/rms"
            tone={toPay > 0 ? 'orange' : 'neutral'}
            icon={Wallet}
            urgent={toPayCount > 0}
          />
          <KPI
            label="Paid YTD"
            value={`₹${paidYtd.toLocaleString('en-IN')}`}
            sub={`${paidYtdCount} expenses`}
            href="/analytics"
            tone="success"
            icon={ArrowUp}
          />
          <KPI
            label="Advance outstanding"
            value={`₹${advance.toLocaleString('en-IN')}`}
            sub={`${advanceCount} travel${advanceCount !== 1 ? 's' : ''}`}
            href="/travel"
            tone="warning"
            icon={Plane}
          />
          <KPI
            label="Travel cost YTD"
            value={`₹${travelYtd.toLocaleString('en-IN')}`}
            sub={`${travelYtdCount} trip${travelYtdCount !== 1 ? 's' : ''}`}
            href="/travel"
            tone="neutral"
            icon={TrendingUp}
          />
        </div>
      </section>

      {/* ── ROW 2 — Org health ────────────────────────────────────────── */}
      <section>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-3 flex items-center gap-1.5">
          <Activity className="w-3 h-3" />Organisation health
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Total members */}
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <Users className="w-4 h-4 text-dm-graphite-3" />
              <Link href="/admin/users" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600 flex items-center gap-0.5">
                Manage <ChevronRight className="w-2.5 h-2.5" />
              </Link>
            </div>
            <p className="text-4xl font-black tracking-tighter text-dm-graphite tabular-nums">{totalUsers}</p>
            <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-1">Total members</p>
            <div className="mt-3 space-y-1.5">
              {[
                ['Active (7d)',  activeIn7d,  totalUsers],
                ['Active (30d)', activeIn30d, totalUsers],
              ].map(([label, val, max]) => (
                <div key={label as string}>
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <span className="text-surface-muted">{label}</span>
                    <span className="font-mono font-bold text-dm-graphite">{val}/{max}</span>
                  </div>
                  <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                    <div className="h-full bg-dm-orange transition-all" style={{ width: `${(Number(val) / Math.max(1, Number(max))) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Onboarding */}
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <UserPlus className="w-4 h-4 text-dm-graphite-3" />
              {onboardingPending > 0 && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-warning-bg text-status-warning">Action</span>}
            </div>
            <p className="text-4xl font-black tracking-tighter text-dm-graphite tabular-nums">{onboardingPending}</p>
            <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-1">Onboarding incomplete</p>
            <p className="text-xs text-dm-graphite-3 mt-3">
              {onboardingPending === 0
                ? 'All employees fully onboarded.'
                : `${onboardingPending} new ${onboardingPending === 1 ? 'member' : 'members'} haven't finished profile setup.`}
            </p>
            {onboardingPending > 0 && (
              <Link href="/admin/users" className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-dm-orange hover:text-dm-orange-600">
                Send reminders <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          {/* Recent logins (last 7d) */}
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <Clock className="w-4 h-4 text-dm-graphite-3" />
              <Link href="/analytics" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600 flex items-center gap-0.5">
                Analytics <ChevronRight className="w-2.5 h-2.5" />
              </Link>
            </div>
            <p className="text-4xl font-black tracking-tighter text-dm-graphite tabular-nums">{recentLogins}</p>
            <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-1">Logins last 7 days</p>
            <p className="text-xs text-dm-graphite-3 mt-3">
              {recentLogins >= totalUsers * 0.75
                ? <><span className="text-status-success font-bold">Healthy engagement.</span> Most of the team has been active recently.</>
                : recentLogins >= totalUsers * 0.5
                ? <><span className="text-status-warning font-bold">Moderate engagement.</span> Some members haven&apos;t logged in this week.</>
                : <><span className="text-status-danger font-bold">Low engagement.</span> Check if team is using the platform.</>}
            </p>
          </div>
        </div>
      </section>

      {/* ── ROW 3 — Escalations + admin shortcuts (2-col) ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6 items-start">

        {/* Escalations queue */}
        <div className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-surface-muted flex items-center gap-1.5">
            <AlertOctagon className="w-3 h-3" />Escalations awaiting boss
          </h2>
          <ApprovalsQueue items={queue} isBoss={true} />
        </div>

        {/* Admin shortcuts + audit feed */}
        <div className="space-y-4">
          {/* Admin shortcuts */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { href: '/admin/users', icon: Users,        label: 'Team',      sub: 'Manage roles' },
              { href: '/admin/audit', icon: ClipboardList,label: 'Audit log', sub: 'All actions' },
              { href: '/analytics',   icon: BarChart2,    label: 'Analytics', sub: 'Trends + usage' },
              { href: '/reports',     icon: FileText,     label: 'Reports',   sub: 'Export data' },
            ].map(({ href, icon: Icon, label, sub }) => (
              <Link
                key={href}
                href={href}
                className="bg-white border border-surface-border rounded-lg p-3 hover:border-dm-graphite hover:shadow-card-hover transition-all group"
              >
                <Icon className="w-4 h-4 text-dm-graphite-3 group-hover:text-dm-orange mb-2 transition-colors" />
                <p className="text-xs font-bold text-dm-graphite">{label}</p>
                <p className="text-[10px] text-surface-muted mt-0.5">{sub}</p>
              </Link>
            ))}
          </div>

          {/* Latest audit feed */}
          <section className="bg-white border border-surface-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-dm-graphite">Latest activity</h3>
              <Link href="/admin/audit" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600">All</Link>
            </div>
            {latestAudit.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-surface-muted">No activity yet.</p>
            ) : (
              <div className="divide-y divide-surface-border max-h-80 overflow-y-auto">
                {latestAudit.map(a => {
                  const action = a.action.includes('reject') ? 'danger' : a.action.includes('paid') || a.action.includes('approved') ? 'success' : 'neutral'
                  const tone = action === 'danger' ? 'bg-status-danger' : action === 'success' ? 'bg-status-success' : 'bg-dm-graphite-3'
                  return (
                    <div key={String(a._id)} className="px-4 py-2.5 flex items-start gap-2.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${tone} mt-1.5 flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-dm-graphite-2 truncate">
                          <strong className="font-bold text-dm-graphite">{a.performedByName}</strong>
                          <span className="text-surface-muted"> · </span>
                          <span className="font-mono">{a.action}</span>
                          {(a.metadata as Record<string, unknown>)?.employeeName ? (
                            <span className="text-surface-muted"> · {String((a.metadata as Record<string, unknown>).employeeName)}</span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-surface-muted mt-0.5">{timeAgo(a.createdAt as Date)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function KPI({ label, value, sub, href, tone, icon: Icon, urgent }: {
  label: string; value: string; sub: string; href: string
  tone: 'orange' | 'success' | 'warning' | 'neutral'
  icon: typeof Wallet; urgent?: boolean
}) {
  const toneColor = {
    orange:  'text-dm-orange',
    success: 'text-status-success',
    warning: 'text-status-warning',
    neutral: 'text-dm-graphite',
  }[tone]

  return (
    <Link
      href={href}
      className={`group bg-white border rounded-lg p-5 hover:shadow-card-hover transition-all relative ${urgent ? 'border-dm-orange' : 'border-surface-border hover:border-dm-graphite'}`}
    >
      {urgent && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-dm-orange animate-pulse" />}
      <Icon className={`w-4 h-4 mb-3 ${toneColor}`} />
      <p className={`text-3xl font-black tracking-tighter tabular-nums ${toneColor}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-1">{label}</p>
      <p className="text-[10px] text-dm-graphite-3 mt-2 flex items-center gap-1">
        {sub}
        <ArrowDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 -rotate-45 group-hover:translate-x-0.5 transition-all" />
      </p>
    </Link>
  )
}
