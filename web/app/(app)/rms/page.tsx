'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Receipt, IndianRupee, CheckCircle2, XCircle, Clock, CreditCard, Download, Filter, Loader2, History, LayoutList, Table2 } from 'lucide-react'
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
import FileUploader from '@/components/ui/file-uploader'

interface Expense {
  _id: string; userId: string; userName: string; title: string; reason: string
  amount: number; startDate: string; status: string; managerNote?: string; bossNote?: string
  receipts?: string[]; createdAt?: string
}

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'default' | 'success' | 'destructive' | 'secondary'; icon: React.ElementType; pipeline: number }> = {
  pending_manager: { label: 'Manager Review', variant: 'warning',     icon: Clock,        pipeline: 1 },
  pending_boss:    { label: 'Pending Payout',  variant: 'default',    icon: CreditCard,   pipeline: 2 },
  paid:            { label: 'Paid',            variant: 'success',    icon: CheckCircle2, pipeline: 3 },
  rejected:        { label: 'Rejected',        variant: 'destructive',icon: XCircle,      pipeline: 0 },
}

function PaymentProofDialog({ onConfirm }: { onConfirm: (proofUrl: string) => void }) {
  const [open,    setOpen]    = useState(false)
  const [proof,   setProof]   = useState<string[]>([])
  const [saving,  setSaving]  = useState(false)

  const confirm = async () => {
    setSaving(true)
    onConfirm(proof[0] || '')
    setProof([])
    setOpen(false)
    setSaving(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700">Mark Paid</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Confirm Payment</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">Upload the bank transfer screenshot or reference number to close the audit trail.</Dialog.Description>
          <FileUploader
            label="Payment Proof"
            hint="Bank transfer screenshot or reference · Optional"
            maxFiles={1}
            onChange={setProof}
          />
          <div className="flex gap-3 mt-5 justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700 gap-2" onClick={confirm} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirm Paid
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RejectDialog({ onConfirm }: { onConfirm: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const confirm = () => { onConfirm(note); setNote(''); setOpen(false) }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" variant="secondary" className="text-red-600 hover:bg-red-50 border-red-200">Reject</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Reject Expense</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">Optionally provide a reason for the employee.</Dialog.Description>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Reason for rejection (optional)…"
            className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
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

function exportCSV(expenses: Expense[]) {
  const headers = ['Title', 'Reason', 'Amount (₹)', 'Date', 'Status', 'Employee', 'Manager Note', 'Boss Note']
  const rows = expenses.map(e => [
    `"${e.title}"`, `"${e.reason}"`, e.amount,
    new Date(e.startDate).toLocaleDateString('en-IN'),
    e.status, `"${e.userName}"`,
    `"${e.managerNote || ''}"`, `"${e.bossNote || ''}"`,
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `expenses-${Date.now()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function RMSPage() {
  const { user } = useUser()
  const toast = useToast()
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'
  const isBoss    = role === 'boss'

  const [expenses,     setExpenses]     = useState<Expense[]>([])
  const [filter,       setFilter]       = useState<string>('all')
  const [loading,      setLoading]      = useState(true)
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [showFilters,  setShowFilters]  = useState(false)
  const [viewMode,     setViewMode]     = useState<'card' | 'table'>('card')

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo)   params.set('to',   dateTo)
      const res = await fetch(`/api/rms${params.toString() ? '?' + params : ''}`)
      if (!res.ok) { setExpenses([]); return }
      const data = await res.json()
      setExpenses(Array.isArray(data) ? data : [])
    } catch { setExpenses([]) }
    finally { setLoading(false) }
  }, [filter, dateFrom, dateTo])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  const handleAction = async (id: string, status: string, note?: string, paymentProof?: string) => {
    const body: Record<string, string> = { status }
    if (note) body[isManager && !isBoss ? 'managerNote' : 'bossNote'] = note
    if (status === 'paid') { body.paidBy = user?.id || ''; if (paymentProof) body.paymentProof = paymentProof }
    await fetch(`/api/rms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const labels: Record<string, string> = { pending_boss: 'Expense approved', paid: 'Marked as paid', rejected: 'Expense rejected' }
    toast(labels[status] || 'Updated', status === 'rejected' ? 'error' : 'success')
    fetchExpenses()
  }

  const totalPending = expenses.filter(e => e.status === 'pending_manager' || e.status === 'pending_boss')
    .reduce((s, e) => s + e.amount, 0)

  return (
    <>
      <Header title="Reimbursements" />
      <main className="flex-1 p-6 space-y-5">

        {/* Pipeline summary (manager/boss) */}
        {isManager && (
          <div className="flex gap-3 flex-wrap">
            {[
              { label: 'Manager Review', count: expenses.filter(e => e.status === 'pending_manager').length, color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
              { label: 'Pending Payout', count: expenses.filter(e => e.status === 'pending_boss').length,    color: 'bg-blue-50   border-blue-200   text-blue-700'   },
              { label: 'Paid',           count: expenses.filter(e => e.status === 'paid').length,             color: 'bg-green-50  border-green-200  text-green-700'  },
            ].map(({ label, count, color }) => (
              <div key={label} className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl border text-center ${color}`}>
                <p className="text-2xl font-extrabold">{count}</p>
                <p className="text-xs font-medium mt-0.5">{label}</p>
              </div>
            ))}
            {totalPending > 0 && (
              <div className="flex-1 min-w-[120px] px-4 py-3 rounded-xl border bg-orange-50 border-orange-200 text-orange-700 text-center">
                <p className="text-2xl font-extrabold">₹{totalPending.toLocaleString('en-IN')}</p>
                <p className="text-xs font-medium mt-0.5">Pending Value</p>
              </div>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex gap-2 flex-wrap">
            {['all', 'pending_manager', 'pending_boss', 'paid', 'rejected'].map(s => (
              <button type="button" key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all
                  ${filter === s ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                {s === 'all' ? 'All' : STATUS_MAP[s]?.label || s}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* View toggle */}
            <div className="flex rounded-lg border border-surface-border overflow-hidden">
              <button type="button" onClick={() => setViewMode('card')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-all
                  ${viewMode === 'card' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-surface'}`}>
                <LayoutList className="w-3.5 h-3.5" /> Cards
              </button>
              <button type="button" onClick={() => setViewMode('table')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-all
                  ${viewMode === 'table' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-surface'}`}>
                <Table2 className="w-3.5 h-3.5" /> Table
              </button>
            </div>
            <button type="button" onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all
                ${(dateFrom || dateTo) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-surface-border text-gray-600 hover:border-brand-400'}`}>
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
            {expenses.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(expenses)}>
                <Download className="w-4 h-4" /> Export CSV
              </Button>
            )}
            <Link href="/rms/new"><Button type="button" className="gap-2"><Plus className="w-4 h-4" /> Log Expense</Button></Link>
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

        {/* List */}
        {loading ? (
          <ListSkeleton rows={4} />
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Receipt className="w-12 h-12 text-brand-200 mb-3" />
            <p className="font-semibold text-gray-900 mb-1">No expense requests</p>
            <p className="text-sm text-surface-muted mb-4">Log your first travel or expense request.</p>
            <Link href="/rms/new"><Button type="button" size="sm">Log Expense</Button></Link>
          </div>
        ) : viewMode === 'table' ? (
          /* ── Table view ─────────────────────────────────────────── */
          <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide">Title</th>
                    <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide text-right">Amount</th>
                    <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide">Status</th>
                    {isManager && <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide">Employee</th>}
                    <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide">Receipts</th>
                    <th className="px-4 py-3 text-xs font-semibold text-surface-muted uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {expenses.map(exp => {
                    const s = STATUS_MAP[exp.status] || STATUS_MAP.rejected
                    const SIcon = s.icon
                    return (
                      <tr key={exp._id} className="hover:bg-surface transition-colors group">
                        <td className="px-4 py-3">
                          <Link href={`/rms/${exp._id}`} className="font-semibold text-gray-900 hover:text-brand-600 transition-colors">
                            {exp.title}
                          </Link>
                          <p className="text-xs text-surface-muted truncate max-w-[220px]">{exp.reason}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-gray-900 whitespace-nowrap">
                          ₹{exp.amount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-xs text-surface-muted whitespace-nowrap">
                          {new Date(exp.startDate).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={s.variant} className="gap-1 text-xs whitespace-nowrap">
                            <SIcon className="w-3 h-3" />{s.label}
                          </Badge>
                        </td>
                        {isManager && (
                          <td className="px-4 py-3 text-xs text-surface-muted">{exp.userName}</td>
                        )}
                        <td className="px-4 py-3">
                          {exp.receipts && exp.receipts.length > 0 ? (
                            <div className="flex gap-1 flex-wrap">
                              {exp.receipts.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noreferrer"
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors">
                                  Receipt {i + 1}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-surface-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {isManager && !isBoss && exp.status === 'pending_manager' && (
                              <>
                                <Button type="button" size="sm" onClick={() => handleAction(exp._id, 'pending_boss')}>Approve</Button>
                                <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                              </>
                            )}
                            {isBoss && exp.status === 'pending_boss' && (
                              <>
                                <PaymentProofDialog onConfirm={proof => handleAction(exp._id, 'paid', undefined, proof)} />
                                <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                              </>
                            )}
                            {(!isManager || (exp.status !== 'pending_manager' && exp.status !== 'pending_boss')) && (
                              <Link href={`/rms/${exp._id}`}>
                                <Button type="button" size="sm" variant="outline">View</Button>
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface">
                    <td className="px-4 py-3 text-xs font-semibold text-surface-muted">{expenses.length} records</td>
                    <td className="px-4 py-3 text-right font-extrabold text-gray-900 text-sm">
                      ₹{expenses.reduce((s, e) => s + e.amount, 0).toLocaleString('en-IN')}
                    </td>
                    <td colSpan={isManager ? 5 : 4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          /* ── Card view ──────────────────────────────────────────── */
          <div className="space-y-3">
            {expenses.map(exp => {
              const s = STATUS_MAP[exp.status] || STATUS_MAP.rejected
              const SIcon = s.icon
              return (
                <Link key={exp._id} href={`/rms/${exp._id}`} className="block">
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                        <IndianRupee className="w-5 h-5 text-orange-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold text-sm text-gray-900">{exp.title}</p>
                          <Badge variant={s.variant} className="gap-1 text-xs">
                            <SIcon className="w-3 h-3" />{s.label}
                          </Badge>
                          {isManager && <span className="text-xs text-surface-muted">{exp.userName}</span>}
                        </div>
                        <p className="text-xs text-surface-muted">{exp.reason}</p>
                        <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                          <p className="text-sm font-extrabold text-gray-900">₹{exp.amount.toLocaleString('en-IN')}</p>
                          <p className="text-xs text-surface-muted">{new Date(exp.startDate).toLocaleDateString('en-IN')}</p>
                          {exp.createdAt && (
                            <p className="text-[11px] text-surface-muted flex items-center gap-1">
                              <History className="w-3 h-3" /> {timeAgo(exp.createdAt)}
                            </p>
                          )}
                        </div>
                        {(exp.managerNote || exp.bossNote) && (
                          <p className="text-xs text-surface-muted italic mt-1">
                            Note: {exp.managerNote || exp.bossNote}
                          </p>
                        )}
                        {exp.receipts && exp.receipts.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
                            {exp.receipts.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noreferrer"
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors">
                                Receipt {i + 1}
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Pipeline dots */}
                        <div className="flex items-center gap-1.5 mt-2.5">
                          {[{ step: 1, label: 'Submitted' }, { step: 2, label: 'Manager OK' }, { step: 3, label: 'Paid' }].map(({ step, label }, i) => {
                            const done = exp.status !== 'rejected' && s.pipeline >= step
                            return (
                              <div key={step} className="flex items-center gap-1">
                                {i > 0 && <div className={`w-6 h-px ${done ? 'bg-green-400' : 'bg-surface-border'}`} />}
                                <div className={`w-2 h-2 rounded-full ${done ? 'bg-green-500' : 'bg-surface-border'}`} title={label} />
                              </div>
                            )
                          })}
                          <span className="text-[10px] text-surface-muted ml-1">pipeline</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        {isManager && !isBoss && exp.status === 'pending_manager' && (
                          <>
                            <Button type="button" size="sm" onClick={() => handleAction(exp._id, 'pending_boss')}>Approve</Button>
                            <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                          </>
                        )}
                        {isBoss && exp.status === 'pending_boss' && (
                          <>
                            <PaymentProofDialog onConfirm={proof => handleAction(exp._id, 'paid', undefined, proof)} />
                            <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
