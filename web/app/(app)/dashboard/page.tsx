export const dynamic = 'force-dynamic'
import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Users, CalendarClock, Receipt, Clock, AlertCircle, TrendingUp, ArrowRight, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Header from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import DashboardCharts from '@/components/DashboardCharts'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import Announcement from '@/models/Announcement'

async function getData(userId: string, role: string) {
  try {
    await connectDB()
    const isManager = role !== 'employee'
    const [
      contacts, myLeaves, pendingLeaves, myExpenses, pendingExpenses,
      recentLeaves, recentExpenses,
      approvedLeaveDays, paidExpenseTotal,
      pinnedAnnouncements,
    ] = await Promise.all([
      Contact.countDocuments({ createdBy: userId }),
      Leave.countDocuments({ userId }),
      isManager ? Leave.countDocuments({ status: 'pending' }) : Promise.resolve(0),
      Expense.countDocuments({ userId }),
      isManager ? Expense.countDocuments({ status: 'pending_manager' }) : Promise.resolve(0),
      Leave.find(isManager ? {} : { userId }).sort({ createdAt: -1 }).limit(5).lean(),
      Expense.find(isManager ? {} : { userId }).sort({ createdAt: -1 }).limit(5).lean(),
      Leave.aggregate([{ $match: { userId, status: 'approved' } }, { $group: { _id: null, total: { $sum: '$days' } } }]),
      Expense.aggregate([{ $match: { userId, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Announcement.find({ pinned: true }).sort({ createdAt: -1 }).limit(3).lean(),
    ])
    return {
      contacts, myLeaves, pendingLeaves, myExpenses, pendingExpenses,
      recentLeaves: recentLeaves as unknown as Array<Record<string, unknown>>,
      recentExpenses: recentExpenses as unknown as Array<Record<string, unknown>>,
      approvedDays: (approvedLeaveDays[0] as { total?: number } | undefined)?.total ?? 0,
      paidTotal: (paidExpenseTotal[0] as { total?: number } | undefined)?.total ?? 0,
      pinnedAnnouncements: pinnedAnnouncements as unknown as Array<Record<string, unknown>>,
    }
  } catch {
    return { contacts: 0, myLeaves: 0, pendingLeaves: 0, myExpenses: 0, pendingExpenses: 0, recentLeaves: [], recentExpenses: [], approvedDays: 0, paidTotal: 0, pinnedAnnouncements: [] }
  }
}

import { statusBadge, statusLabel } from '@/lib/statusColors'

const STAGGER = ['animate-fade-up-1', 'animate-fade-up-2', 'animate-fade-up-3', 'animate-fade-up-4']

export default async function DashboardPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const d = await getData(userId, role)
  const isManagerOrBoss = role === 'manager' || role === 'boss'

  const statCards = [
    { title: 'CRM Contacts',      value: d.contacts,      icon: Users,         color: 'text-brand-500',  bg: 'bg-brand-50',   href: '/crm' },
    { title: 'My Leave Requests', value: d.myLeaves,       icon: CalendarClock, color: 'text-purple-500', bg: 'bg-purple-50',  href: '/lms' },
    { title: 'My Expenses',       value: d.myExpenses,     icon: Receipt,       color: 'text-orange-500', bg: 'bg-orange-50',  href: '/rms' },
  ]

  return (
    <>
      <Header title="Dashboard" />
      <main className="flex-1 p-6 space-y-6 animate-fade-in">

        {/* Greeting */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-gray-900 tracking-tight">
              Good {greeting()}, {user?.firstName || 'there'} 👋
            </h2>
            <p className="text-sm text-surface-muted mt-0.5">Here&apos;s your workspace snapshot for today.</p>
          </div>
          <Badge variant={role === 'boss' ? 'warning' : role === 'manager' ? 'default' : 'secondary'} className="capitalize text-xs px-3 py-1 font-bold tracking-wide">
            {role}
          </Badge>
        </div>

        {/* Pinned announcements */}
        {d.pinnedAnnouncements.length > 0 && (
          <div className="space-y-2">
            {d.pinnedAnnouncements.map((a: Record<string, unknown>) => (
              <Link key={String(a._id)} href="/announcements"
                className="flex items-start gap-3 px-4 py-3 rounded-xl bg-brand-50 border border-brand-100 hover:bg-brand-100 transition-colors">
                <Megaphone className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-800 truncate">{String(a.title)}</p>
                  <p className="text-xs text-brand-600 truncate">{String(a.body)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {statCards.map(({ title, value, icon: Icon, color, bg, href }, i) => (
            <Link key={title} href={href} className={STAGGER[i]}>
              <Card className="stat-card cursor-pointer h-full">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-6 h-6 ${color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{value}</p>
                    <p className="text-sm text-surface-muted">{title}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Personal stats bar */}
        <div className="grid grid-cols-2 gap-4 animate-fade-up-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-lg font-extrabold text-gray-900 tabular-nums">{d.approvedDays} <span className="text-sm font-normal text-surface-muted">days</span></p>
                <p className="text-xs text-surface-muted">Leave taken this year</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                <Receipt className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-lg font-extrabold text-gray-900 tabular-nums">₹{d.paidTotal.toLocaleString('en-IN')}</p>
                <p className="text-xs text-surface-muted">Reimbursed this year</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Manager pending queue */}
        {isManagerOrBoss && (d.pendingLeaves > 0 || d.pendingExpenses > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/lms">
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-yellow-400">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-yellow-50 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-2xl font-extrabold text-gray-900">{d.pendingLeaves}</p>
                    <p className="text-sm text-surface-muted">Leaves pending approval</p>
                  </div>
                  {d.pendingLeaves > 0 && <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />}
                </CardContent>
              </Card>
            </Link>
            <Link href="/rms">
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-accent-500">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-6 h-6 text-red-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-2xl font-extrabold text-gray-900">{d.pendingExpenses}</p>
                    <p className="text-sm text-surface-muted">Expenses pending approval</p>
                  </div>
                  {d.pendingExpenses > 0 && <span className="w-2 h-2 rounded-full bg-accent-500 animate-pulse" />}
                </CardContent>
              </Card>
            </Link>
          </div>
        )}

        {/* Two-col activity + actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Recent Leaves */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700">Recent Leave Requests</CardTitle>
              <Link href="/lms" className="text-xs text-brand-500 hover:text-brand-700 flex items-center gap-1 font-semibold">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {d.recentLeaves.length === 0 ? (
                <p className="text-sm text-surface-muted py-4 text-center">No leave requests yet.</p>
              ) : d.recentLeaves.map((l: Record<string, unknown>) => (
                <div key={String(l._id)} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{String(l.reason || '')}</p>
                    <p className="text-xs text-surface-muted">{String(l.days || '')} days · {new Date(String(l.startDate)).toLocaleDateString('en-IN')}</p>
                    {isManagerOrBoss && <p className="text-xs text-surface-muted font-medium">{String(l.userName || '')}</p>}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-3 flex-shrink-0 ${statusBadge(String(l.status))}`}>
                    {statusLabel(String(l.status))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent Expenses */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700">Recent Expenses</CardTitle>
              <Link href="/rms" className="text-xs text-brand-500 hover:text-brand-700 flex items-center gap-1 font-semibold">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {d.recentExpenses.length === 0 ? (
                <p className="text-sm text-surface-muted py-4 text-center">No expense requests yet.</p>
              ) : d.recentExpenses.map((e: Record<string, unknown>) => (
                <div key={String(e._id)} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{String(e.title || '')}</p>
                    <p className="text-xs text-surface-muted">₹{Number(e.amount || 0).toLocaleString('en-IN')} · {new Date(String(e.startDate)).toLocaleDateString('en-IN')}</p>
                    {isManagerOrBoss && <p className="text-xs text-surface-muted font-medium">{String(e.userName || '')}</p>}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-3 flex-shrink-0 ${statusBadge(String(e.status))}`}>
                    {statusLabel(String(e.status))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Analytics charts */}
        <DashboardCharts />

        {/* Quick actions */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-bold text-gray-700">Quick Actions</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 pt-0">
            {[
              { label: 'New Contact',   href: '/crm/new',  icon: Users,         color: 'bg-brand-500' },
              { label: 'Request Leave', href: '/lms/new',  icon: CalendarClock, color: 'bg-purple-500' },
              { label: 'Log Expense',   href: '/rms/new',  icon: Receipt,       color: 'bg-orange-500' },
            ].map(({ label, href, icon: Icon, color }) => (
              <Link
                key={label} href={href}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-surface-border hover:border-brand-300 hover:bg-brand-50 transition-all group"
              >
                <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs font-semibold text-gray-700 text-center group-hover:text-brand-700">{label}</span>
              </Link>
            ))}
          </CardContent>
        </Card>

      </main>
    </>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
