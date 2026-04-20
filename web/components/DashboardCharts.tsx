'use client'
import { useEffect, useState } from 'react'
import { BarChart, DonutChart } from '@/components/ui/charts'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MonthPoint { label: string; count: number; days?: number; total?: number }
interface StatusBucket { _id: string; count: number }
interface Analytics {
  leaveByMonth: MonthPoint[]; expenseByMonth: MonthPoint[]
  leaveStatus: StatusBucket[]; expenseStatus: StatusBucket[]
}

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending:  '#FBBF24', approved: '#22C55E', rejected: '#EF4444',
}
const EXPENSE_STATUS_COLORS: Record<string, string> = {
  pending_manager: '#FBBF24', pending_boss: '#3B82F6', paid: '#22C55E', rejected: '#EF4444',
}

export default function DashboardCharts() {
  const [data,    setData]    = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/analytics')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-surface-border p-5 space-y-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-28 w-full" />
          </div>
        ))}
      </div>
    )
  }
  if (!data) return null

  const leaveStatusData = data.leaveStatus.map(s => ({
    label: s._id, value: s.count, color: LEAVE_STATUS_COLORS[s._id] || '#94A3B8',
  }))
  const expenseStatusData = data.expenseStatus.map(s => ({
    label: s._id.replace('_', ' '), value: s.count, color: EXPENSE_STATUS_COLORS[s._id] || '#94A3B8',
  }))

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Analytics — Last 6 Months</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Leave requests trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700">Leave Requests</CardTitle>
            <p className="text-xs text-surface-muted">Total requests per month</p>
          </CardHeader>
          <CardContent className="pt-0">
            <BarChart
              data={data.leaveByMonth.map(m => ({ label: m.label, value: m.count }))}
              color="#7C3AED"
            />
          </CardContent>
        </Card>

        {/* Expense trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700">Expense Amount (₹)</CardTitle>
            <p className="text-xs text-surface-muted">Total reimbursements per month</p>
          </CardHeader>
          <CardContent className="pt-0">
            <BarChart
              data={data.expenseByMonth.map(m => ({ label: m.label, value: m.total ?? 0 }))}
              color="#F97316"
              unit="₹"
            />
          </CardContent>
        </Card>

        {/* Leave status donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700">Leave Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex items-center gap-6">
            <DonutChart data={leaveStatusData} size={90} />
            <div className="space-y-2">
              {leaveStatusData.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-gray-600 capitalize">{s.label}</span>
                  <span className="text-xs font-bold text-gray-900 ml-auto pl-4">{s.value}</span>
                </div>
              ))}
              {leaveStatusData.length === 0 && <p className="text-xs text-surface-muted">No data yet.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Expense status donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700">Expense Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex items-center gap-6">
            <DonutChart data={expenseStatusData} size={90} />
            <div className="space-y-2">
              {expenseStatusData.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-gray-600 capitalize">{s.label}</span>
                  <span className="text-xs font-bold text-gray-900 ml-auto pl-4">{s.value}</span>
                </div>
              ))}
              {expenseStatusData.length === 0 && <p className="text-xs text-surface-muted">No data yet.</p>}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
