'use client'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  TrendingUp, Activity, CheckCircle2, Clock, IndianRupee,
  Plane, Megaphone, AlertCircle, CalendarClock, Receipt, Layers,
  Building, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { BarChart, DonutChart, AreaChart } from '@/components/ui/charts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { timeAgo } from '@/lib/timeAgo'

/* ════════════ Types ════════════ */
interface MonthPoint   { label: string; count: number; days?: number; total?: number }
interface StatusBucket { _id: string; count: number; total?: number }
interface LeaveTypeBucket { _id: string; count: number; days: number }
interface TopSpender { userId: string; userName: string; total: number; count: number }
interface RecentAudit { action: string; performedByName: string; createdAt: string; metadata?: Record<string, unknown> }
export interface FilterOptions { departments: string[]; employees: { userId: string; name: string; department: string }[] }

export interface AnalyticsData {
  range: { from: string; to: string }
  filterOptions?: FilterOptions
  appliedFilters?: { dept: string | null; employee: string | null; status: string | null }
  compare?: 'mom' | 'yoy' | null
  previous?: { totalLeaves: number; approvedLeaves: number; totalExpenses: number; paidExpense: number }
  kpis: {
    totalLeaves: number; approvedLeaves: number; pendingLeaves: number
    totalExpenses: number; totalExpenseCount: number
    paidExpense: number; pendingPayout: number; pendingExpensesCount: number
    travelApproved: number; pendingTravel: number
    contactCount: number; contactsWithEmail: number
    announcementCount: number
    leavesIn30d: number; expensesIn30d: number; travelIn30d: number
  }
  leaveByMonth:    MonthPoint[]
  expenseByMonth:  MonthPoint[]
  leaveStatus:     StatusBucket[]
  expenseStatus:   StatusBucket[]
  travelStatus:    StatusBucket[]
  leaveType:       LeaveTypeBucket[]
  topSpenders:     TopSpender[]
  recentAudits:    RecentAudit[]
}

export type TileSize = 'sm' | 'md' | 'lg'
export type TileId =
  | 'kpi.totalLeaves' | 'kpi.approvedLeaves' | 'kpi.pendingLeaves'
  | 'kpi.totalExpenses' | 'kpi.paidExpense' | 'kpi.pendingPayout'
  | 'kpi.travelApproved' | 'kpi.pendingTravel'
  | 'kpi.contacts' | 'kpi.announcements'
  | 'chart.leaveByMonth' | 'chart.expenseByMonth'
  | 'chart.leaveStatus' | 'chart.expenseStatus' | 'chart.travelStatus'
  | 'chart.leaveType' | 'chart.featureUsage30d'
  | 'list.topSpenders' | 'list.recentActivity'
export type LayoutEntry = { id: TileId; size: TileSize }

export interface TileDef {
  id: TileId
  label: string
  description: string
  category: 'kpi' | 'chart' | 'list'
  defaultSize: TileSize
  icon: React.ElementType
}

export const TILE_CATALOG: TileDef[] = [
  { id: 'kpi.totalLeaves',     label: 'Total leaves',        description: 'Leave requests in range',      category: 'kpi', defaultSize: 'sm', icon: CalendarClock },
  { id: 'kpi.approvedLeaves',  label: 'Approved leaves',     description: 'Approved count',               category: 'kpi', defaultSize: 'sm', icon: CheckCircle2 },
  { id: 'kpi.pendingLeaves',   label: 'Pending leaves',      description: 'Awaiting decision',            category: 'kpi', defaultSize: 'sm', icon: Clock },
  { id: 'kpi.totalExpenses',   label: 'Total expense (₹)',   description: 'Sum of all claims in range',   category: 'kpi', defaultSize: 'sm', icon: Receipt },
  { id: 'kpi.paidExpense',     label: 'Paid out (₹)',        description: 'Sum reimbursed',               category: 'kpi', defaultSize: 'sm', icon: IndianRupee },
  { id: 'kpi.pendingPayout',   label: 'Pending payout (₹)',  description: 'Awaiting payout',              category: 'kpi', defaultSize: 'sm', icon: AlertCircle },
  { id: 'kpi.travelApproved',  label: 'Travel approved',     description: 'Cleared trips',                category: 'kpi', defaultSize: 'sm', icon: Plane },
  { id: 'kpi.pendingTravel',   label: 'Travel pending',      description: 'Awaiting approval',            category: 'kpi', defaultSize: 'sm', icon: Plane },
  { id: 'kpi.contacts',        label: 'CRM contacts',        description: 'Total / with email',           category: 'kpi', defaultSize: 'sm', icon: Building },
  { id: 'kpi.announcements',   label: 'Announcements',       description: 'Total posted',                 category: 'kpi', defaultSize: 'sm', icon: Megaphone },
  { id: 'chart.leaveByMonth',   label: 'Leave requests by month', description: 'Area trend over selected range', category: 'chart', defaultSize: 'md', icon: TrendingUp },
  { id: 'chart.expenseByMonth', label: 'Expense ₹ by month',      description: 'Area trend over range',          category: 'chart', defaultSize: 'md', icon: TrendingUp },
  { id: 'chart.leaveStatus',    label: 'Leave status breakdown',  description: 'Donut: approved / pending / rejected', category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.expenseStatus',  label: 'Expense status breakdown',description: 'Donut by stage',                category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.travelStatus',   label: 'Travel status breakdown', description: 'Donut by stage',                category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.leaveType',      label: 'Leave by type',           description: 'Casual / sick / earned etc.',   category: 'chart', defaultSize: 'md', icon: Layers },
  { id: 'chart.featureUsage30d',label: 'Feature usage · 30 days', description: 'Leaves vs expenses vs travel',  category: 'chart', defaultSize: 'md', icon: Activity },
  { id: 'list.topSpenders',     label: 'Top spenders',     description: 'Highest reimbursed in range',   category: 'list', defaultSize: 'md', icon: TrendingUp },
  { id: 'list.recentActivity',  label: 'Recent activity',  description: 'Latest audit log entries',      category: 'list', defaultSize: 'lg', icon: Activity },
]

export function tileById(id: TileId): TileDef | undefined {
  return TILE_CATALOG.find(t => t.id === id)
}

/* ════════════ Style maps ════════════ */
const LEAVE_STATUS_COLORS: Record<string, string> = { pending: '#FBBF24', approved: '#0a7d3b', rejected: '#c83838' }
const EXPENSE_STATUS_COLORS: Record<string, string> = { pending_manager: '#FBBF24', pending_admin: '#0057A8', paid: '#0a7d3b', rejected: '#c83838', returned: '#F97316' }
const TRAVEL_STATUS_COLORS: Record<string, string> = { pending_manager: '#FBBF24', pending_admin: '#0057A8', approved: '#0a7d3b', rejected: '#c83838', cancelled: '#94A3B8' }
const LEAVE_TYPE_COLORS: Record<string, string> = { casual: '#3B82F6', sick: '#EF4444', medical: '#EF4444', earned: '#22C55E', privilege: '#A855F7', restricted: '#F97316', lwp: '#6B7280' }

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/* ════════════ Tile body ════════════ */
export function TileBody({ def, data, drillBase, readOnly = false }: { def: TileDef; data: AnalyticsData; drillBase: string; readOnly?: boolean }) {
  // On read-only/public views, donut segments are not drillable (drill route needs auth).
  const dMetric = (m: 'leave' | 'expense' | 'travel') => (readOnly ? undefined : m)
  switch (def.id) {
    case 'kpi.totalLeaves':    return <KpiTile def={def} value={data.kpis.totalLeaves} hint="In selected range" />
    case 'kpi.approvedLeaves': return <KpiTile def={def} value={data.kpis.approvedLeaves} hint={`${data.kpis.totalLeaves} total`} tone="success" />
    case 'kpi.pendingLeaves':  return <KpiTile def={def} value={data.kpis.pendingLeaves} hint="Awaiting decision" tone={data.kpis.pendingLeaves > 0 ? 'warning' : 'neutral'} />
    case 'kpi.totalExpenses':  return <KpiTile def={def} value={inr(data.kpis.totalExpenses)} hint={`${data.kpis.totalExpenseCount} claim${data.kpis.totalExpenseCount !== 1 ? 's' : ''}`} />
    case 'kpi.paidExpense':    return <KpiTile def={def} value={inr(data.kpis.paidExpense)} hint="Reimbursed so far" tone="success" />
    case 'kpi.pendingPayout':  return <KpiTile def={def} value={inr(data.kpis.pendingPayout)} hint={`${data.kpis.pendingExpensesCount} pending`} tone={data.kpis.pendingPayout > 0 ? 'warning' : 'neutral'} />
    case 'kpi.travelApproved': return <KpiTile def={def} value={data.kpis.travelApproved} hint="Cleared trips" tone="success" />
    case 'kpi.pendingTravel':  return <KpiTile def={def} value={data.kpis.pendingTravel} hint="Awaiting approval" tone={data.kpis.pendingTravel > 0 ? 'warning' : 'neutral'} />
    case 'kpi.contacts':       return <KpiTile def={def} value={data.kpis.contactCount} hint={`${data.kpis.contactsWithEmail} with email`} />
    case 'kpi.announcements':  return <KpiTile def={def} value={data.kpis.announcementCount} hint="Total posted" />
    case 'chart.leaveByMonth':
      return <ChartCard def={def}><AreaChart data={data.leaveByMonth.map(m => ({ label: m.label, value: m.count }))} color="#0057A8" /></ChartCard>
    case 'chart.expenseByMonth':
      return <ChartCard def={def}><AreaChart data={data.expenseByMonth.map(m => ({ label: m.label, value: m.total ?? 0 }))} color="#003B73" unit="₹" /></ChartCard>
    case 'chart.leaveStatus':
      return <DonutCard def={def} metric={dMetric('leave')} drillBase={drillBase} data={data.leaveStatus.map(s => ({ label: s._id, raw: s._id, value: s.count, color: LEAVE_STATUS_COLORS[s._id] || '#94A3B8' }))} />
    case 'chart.expenseStatus':
      return <DonutCard def={def} metric={dMetric('expense')} drillBase={drillBase} data={data.expenseStatus.map(s => ({ label: s._id.replace(/_/g, ' '), raw: s._id, value: s.count, color: EXPENSE_STATUS_COLORS[s._id] || '#94A3B8' }))} />
    case 'chart.travelStatus':
      return <DonutCard def={def} metric={dMetric('travel')} drillBase={drillBase} data={data.travelStatus.map(s => ({ label: s._id.replace(/_/g, ' '), raw: s._id, value: s.count, color: TRAVEL_STATUS_COLORS[s._id] || '#94A3B8' }))} />
    case 'chart.leaveType':
      return <DonutCard def={def} data={data.leaveType.map(s => ({ label: s._id, value: s.count, color: LEAVE_TYPE_COLORS[s._id] || '#94A3B8' }))} />
    case 'chart.featureUsage30d':
      return <ChartCard def={def}><BarChart data={[{ label: 'Leaves', value: data.kpis.leavesIn30d }, { label: 'Expenses', value: data.kpis.expensesIn30d }, { label: 'Travel', value: data.kpis.travelIn30d }]} color="#0057A8" /></ChartCard>
    case 'list.topSpenders':   return <TopSpendersCard def={def} data={data.topSpenders} />
    case 'list.recentActivity':return <RecentActivityCard def={def} data={data.recentAudits} />
    default: return null
  }
}

/* ════════════ Primitives ════════════ */
export function KpiTile({ def, value, hint, tone = 'neutral', current, previous, compareLabel }: {
  def: TileDef; value: number | string; hint?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  current?: number; previous?: number; compareLabel?: string
}) {
  const valueColor = { neutral: 'text-ink', success: 'text-emerald-600', warning: 'text-amber-600', danger: 'text-red-600' }[tone]
  const Icon = def.icon
  let delta: { pct: number; up: boolean } | null = null
  if (typeof current === 'number' && typeof previous === 'number') {
    if (previous === 0) delta = current > 0 ? { pct: 100, up: true } : null
    else { const p = ((current - previous) / Math.abs(previous)) * 100; delta = { pct: Math.round(p), up: p >= 0 } }
  }
  return (
    <div className="bg-surface-1 rounded-2xl border border-surface-border p-4 h-full flex flex-col justify-between min-h-[120px]">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">{def.label}</p>
        <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center flex-shrink-0"><Icon className="w-3.5 h-3.5 text-surface-muted" /></div>
      </div>
      <div>
        <div className="flex items-end gap-2">
          <p className={`text-3xl font-extrabold tabular-nums tracking-tighter ${valueColor}`}>{value}</p>
          {delta && (
            <span className={`mb-1 inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${delta.up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`} title={`vs previous ${compareLabel || 'period'}`}>
              {delta.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{Math.abs(delta.pct)}%
            </span>
          )}
        </div>
        {hint && <p className="text-[11px] text-surface-muted mt-1 truncate">{hint}</p>}
      </div>
    </div>
  )
}

function ChartCard({ def, children }: { def: TileDef; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-ink-muted">{def.label}</CardTitle><p className="text-xs text-surface-muted">{def.description}</p></CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

type DonutDatum = { label: string; value: number; color: string; raw?: string }
function DonutCard({ def, data, metric, drillBase }: {
  def: TileDef; data: DonutDatum[]; metric?: 'leave' | 'expense' | 'travel'; drillBase?: string
}) {
  const router = useRouter()
  const empty = data.every(d => d.value === 0)
  const canDrill = !!metric
  const rawByLabel = useMemo(() => new Map(data.map(d => [d.label, d.raw ?? d.label])), [data])
  const goDrill = (label: string) => {
    if (!metric) return
    const raw = rawByLabel.get(label) ?? label
    router.push(`/analytics/drill?metric=${metric}&status=${encodeURIComponent(raw)}${drillBase ? '&' + drillBase : ''}`)
  }
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-ink-muted">{def.label}</CardTitle>
        {canDrill && !empty && <p className="text-[11px] text-surface-muted">Click a segment to drill into records</p>}
      </CardHeader>
      <CardContent className="pt-0">
        {empty ? <p className="text-xs text-surface-muted py-8 text-center">No data in this range.</p> : (
          <div className="flex items-center gap-6">
            <DonutChart data={data} size={100} onSegmentClick={canDrill ? goDrill : undefined} />
            <div className="space-y-2 flex-1 min-w-0">
              {data.filter(d => d.value > 0).map(s => (
                <button key={s.label} type="button" disabled={!canDrill} onClick={() => goDrill(s.label)}
                  className={`flex items-center gap-2 w-full text-left ${canDrill ? 'hover:bg-surface/60 rounded-md -mx-1 px-1 py-0.5 cursor-pointer' : 'cursor-default'}`}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-ink-muted capitalize truncate flex-1">{s.label}</span>
                  <span className="text-xs font-bold text-ink ml-auto">{s.value}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TopSpendersCard({ def, data }: { def: TileDef; data: TopSpender[] }) {
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-ink-muted">{def.label}</CardTitle><p className="text-xs text-surface-muted">{def.description}</p></CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? <p className="text-xs text-surface-muted py-6 text-center">No paid expenses yet.</p> : (
          <ul className="divide-y divide-surface-border">
            {data.map((s, i) => (
              <li key={s.userId} className="py-2.5 flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-surface-3 text-ink-muted' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-surface text-surface-muted'}`}>{i + 1}</span>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-ink truncate">{s.userName}</p><p className="text-[10px] text-surface-muted">{s.count} claim{s.count !== 1 ? 's' : ''}</p></div>
                <span className="text-sm font-extrabold text-ink tabular-nums">{inr(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function actionLabel(action: string): string {
  const parts = action.split('.')
  return `${(parts[1] || '').replace(/_/g, ' ')} ${parts[0] || action}`.trim() || action
}

function RecentActivityCard({ def, data }: { def: TileDef; data: RecentAudit[] }) {
  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-ink-muted">{def.label}</CardTitle><p className="text-xs text-surface-muted">{def.description}</p></CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? <p className="text-xs text-surface-muted py-6 text-center">Nothing to show yet.</p> : (
          <ul className="divide-y divide-surface-border">
            {data.map((a, i) => {
              const meta = a.metadata || {}
              const employeeName = (meta.employeeName as string | undefined) || ''
              const amount = meta.amount as number | undefined
              const days = meta.days as number | undefined
              const dest = meta.destination as string | undefined
              return (
                <li key={i} className="py-2.5 flex items-start gap-3">
                  <Activity className="w-3.5 h-3.5 text-surface-muted flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink"><strong className="font-semibold">{a.performedByName}</strong><span className="text-ink-muted"> · {actionLabel(a.action)}</span>{employeeName && <span className="text-ink-muted"> for {employeeName}</span>}</p>
                    <p className="text-[10px] text-surface-muted">{dest && <>{dest} · </>}{days !== undefined && <>{days}d · </>}{amount !== undefined && <>{inr(amount)} · </>}{timeAgo(a.createdAt)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
