'use client'
import { useState, useEffect, useCallback } from 'react'
import { Download, TrendingUp, Receipt, Cake, Users } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ListSkeleton } from '@/components/ui/skeleton'

interface LeaveSummaryRow  { _id: { userId: string; userName: string }; totalRequests: number; totalDays: number; approved: number }
interface ExpenseSummaryRow{ _id: { userId: string; userName: string }; totalRequests: number; totalAmount: number; paid: number }
interface TypeBucket       { _id: string; count: number; days: number }
interface StatusBucket     { _id: string; count: number; amount: number }
interface BirthdayRow      { name: string; company?: string; birthday: string; daysUntil: number }

interface ReportData {
  leaveSummary:   LeaveSummaryRow[]
  expenseSummary: ExpenseSummaryRow[]
  leaveByType:    TypeBucket[]
  expenseByStatus:StatusBucket[]
  upcomingBirthdays: BirthdayRow[]
}

function exportLeaveCSV(data: LeaveSummaryRow[]) {
  const rows = data.map(r => [`"${r._id.userName}"`, r.totalRequests, r.totalDays, r.approved])
  const csv  = [['Employee','Total Requests','Total Days','Approved'].join(','), ...rows.map(r => r.join(','))].join('\n')
  const a    = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `leave-report-${Date.now()}.csv`; a.click()
}

function exportExpenseCSV(data: ExpenseSummaryRow[]) {
  const rows = data.map(r => [`"${r._id.userName}"`, r.totalRequests, r.totalAmount, r.paid])
  const csv  = [['Employee','Total Requests','Total Amount (₹)','Paid (₹)'].join(','), ...rows.map(r => r.join(','))].join('\n')
  const a    = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `expense-report-${Date.now()}.csv`; a.click()
}

export default function ReportsPage() {
  const [data,    setData]    = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to',   to)
    const res  = await fetch(`/api/reports?${params}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <>
      <Header title="Reports" />
      <main className="flex-1 p-6 space-y-6">

        {/* Date range */}
        <div className="glass-card rounded-xl p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'Today',        fn: () => { const d = new Date().toISOString().slice(0, 10); setFrom(d); setTo(d) } },
              { label: 'Last 7 days',  fn: () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 6); setFrom(f.toISOString().slice(0,10)); setTo(t.toISOString().slice(0,10)) } },
              { label: 'This month',   fn: () => { const t = new Date(); setFrom(new Date(t.getFullYear(), t.getMonth(), 1).toISOString().slice(0,10)); setTo(t.toISOString().slice(0,10)) } },
              { label: 'Last 3 months',fn: () => { const t = new Date(); const f = new Date(t); f.setMonth(f.getMonth() - 3); setFrom(f.toISOString().slice(0,10)); setTo(t.toISOString().slice(0,10)) } },
              { label: 'This year',    fn: () => { const t = new Date(); setFrom(`${t.getFullYear()}-01-01`); setTo(t.toISOString().slice(0,10)) } },
            ].map(({ label, fn }) => (
              <button key={label} type="button" onClick={fn}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-surface-border text-gray-600 hover:border-brand-400 hover:text-brand-600 transition-all">
                {label}
              </button>
            ))}
            {(from || to) && (
              <button type="button" onClick={() => { setFrom(''); setTo('') }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                Clear
              </button>
            )}
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-muted uppercase tracking-wide">From</label>
              <input type="date" aria-label="Report from date" value={from} onChange={e => setFrom(e.target.value)}
                className="h-9 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-muted uppercase tracking-wide">To</label>
              <input type="date" aria-label="Report to date" value={to} min={from} onChange={e => setTo(e.target.value)}
                className="h-9 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <p className="text-xs text-surface-muted self-end pb-2">{!from && !to ? 'All-time data' : `${from || '…'} → ${to || '…'}`}</p>
          </div>
        </div>

        {loading ? <ListSkeleton rows={4} /> : !data ? null : (
          <>
            {/* Leave summary */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-500" /> Leave Summary by Employee
                </CardTitle>
                {data.leaveSummary.length > 0 && (
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => exportLeaveCSV(data.leaveSummary)}>
                    <Download className="w-3.5 h-3.5" /> CSV
                  </Button>
                )}
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                {data.leaveSummary.length === 0 ? <p className="text-sm text-surface-muted py-4 text-center">No leave data.</p> : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border">
                        {['Employee','Requests','Days Taken','Approved'].map(h => (
                          <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide text-surface-muted py-2 pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaveSummary.map(r => (
                        <tr key={r._id.userId} className="border-b border-surface-border last:border-0 hover:bg-surface">
                          <td className="py-2 pr-4 font-medium text-gray-900">{r._id.userName}</td>
                          <td className="py-2 pr-4 text-surface-muted">{r.totalRequests}</td>
                          <td className="py-2 pr-4 font-bold">{r.totalDays}</td>
                          <td className="py-2 pr-4 text-green-600 font-semibold">{r.approved}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Expense summary */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-orange-500" /> Expense Summary by Employee
                </CardTitle>
                {data.expenseSummary.length > 0 && (
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => exportExpenseCSV(data.expenseSummary)}>
                    <Download className="w-3.5 h-3.5" /> CSV
                  </Button>
                )}
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                {data.expenseSummary.length === 0 ? <p className="text-sm text-surface-muted py-4 text-center">No expense data.</p> : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border">
                        {['Employee','Requests','Total (₹)','Paid (₹)'].map(h => (
                          <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide text-surface-muted py-2 pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.expenseSummary.map(r => (
                        <tr key={r._id.userId} className="border-b border-surface-border last:border-0 hover:bg-surface">
                          <td className="py-2 pr-4 font-medium text-gray-900">{r._id.userName}</td>
                          <td className="py-2 pr-4 text-surface-muted">{r.totalRequests}</td>
                          <td className="py-2 pr-4 font-bold">₹{r.totalAmount.toLocaleString('en-IN')}</td>
                          <td className="py-2 pr-4 text-green-600 font-semibold">₹{r.paid.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Leave by type + Expense by status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-gray-700">Leave by Type</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {data.leaveByType.map(t => (
                    <div key={t._id} className="flex items-center justify-between py-1.5 border-b border-surface-border last:border-0">
                      <span className="text-sm capitalize font-medium text-gray-700">{t._id}</span>
                      <span className="text-sm font-bold">{t.count} req · {t.days} days</span>
                    </div>
                  ))}
                  {data.leaveByType.length === 0 && <p className="text-sm text-surface-muted py-2">No data.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-gray-700">Expense by Status</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {data.expenseByStatus.map(s => (
                    <div key={s._id} className="flex items-center justify-between py-1.5 border-b border-surface-border last:border-0">
                      <span className="text-sm capitalize font-medium text-gray-700">{s._id.replace('_',' ')}</span>
                      <span className="text-sm font-bold">{s.count} · ₹{s.amount.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                  {data.expenseByStatus.length === 0 && <p className="text-sm text-surface-muted py-2">No data.</p>}
                </CardContent>
              </Card>
            </div>

            {/* Upcoming birthdays */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Cake className="w-4 h-4 text-pink-500" /> Upcoming Birthdays (Next 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.upcomingBirthdays.length === 0 ? (
                  <div className="flex flex-col items-center py-6 text-center">
                    <Users className="w-8 h-8 text-brand-200 mb-2" />
                    <p className="text-sm text-surface-muted">No birthdays in the next 30 days.</p>
                    <p className="text-xs text-surface-muted mt-0.5">Add birthday dates to CRM contacts to see them here.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.upcomingBirthdays.map((b, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{b.name}</p>
                          {b.company && <p className="text-xs text-surface-muted">{b.company}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-pink-600">
                            {b.daysUntil === 0 ? '🎂 Today!' : `In ${b.daysUntil} day${b.daysUntil > 1 ? 's' : ''}`}
                          </p>
                          <p className="text-[10px] text-surface-muted">
                            {new Date(b.birthday).toLocaleDateString('en-IN', { day:'numeric', month:'long' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  )
}
