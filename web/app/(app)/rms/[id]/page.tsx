'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, IndianRupee, Clock, CheckCircle2, XCircle, CreditCard, MapPin, Calendar, FileText, Loader2, AlertCircle, Receipt, X, ZoomIn } from 'lucide-react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { useUser } from '@/lib/useUser'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import FileUploader from '@/components/ui/file-uploader'

interface Expense {
  _id: string; userId: string; userName: string
  title: string; reason: string; amount: number
  travelFrom?: string; travelTo?: string
  startDate: string; endDate?: string
  receipts: string[]; status: string
  managerNote?: string; bossNote?: string; paymentProof?: string
  approvedBy?: string; paidBy?: string
  createdAt: string; updatedAt: string
}

const STATUS_META: Record<string, { label: string; variant: 'warning'|'default'|'success'|'destructive'; icon: React.ElementType; pipeline: number; color: string }> = {
  pending_manager: { label: 'Manager Review', variant: 'warning',     icon: Clock,        pipeline: 1, color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  pending_boss:    { label: 'Pending Payout',  variant: 'default',    icon: CreditCard,   pipeline: 2, color: 'text-blue-600   bg-blue-50   border-blue-200'   },
  paid:            { label: 'Paid',            variant: 'success',    icon: CheckCircle2, pipeline: 3, color: 'text-green-600  bg-green-50  border-green-200'  },
  rejected:        { label: 'Rejected',        variant: 'destructive',icon: XCircle,      pipeline: 0, color: 'text-red-600    bg-red-50    border-red-200'    },
}

const PIPELINE = [
  { step: 1, label: 'Submitted',    sub: 'Employee logged expense' },
  { step: 2, label: 'Manager OK',   sub: 'Forwarded for payout'   },
  { step: 3, label: 'Paid',         sub: 'Amount disbursed'        },
]

function ReceiptViewer({ urls }: { urls: string[] }) {
  const [open,     setOpen]     = useState(false)
  const [current,  setCurrent]  = useState(0)

  const isImage = (url: string) => /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) || url.includes('cloudinary')

  const open_ = (i: number) => { setCurrent(i); setOpen(true) }

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {urls.map((url, i) => (
          isImage(url) ? (
            <button key={i} type="button" onClick={() => open_(i)}
              className="relative group aspect-square rounded-xl overflow-hidden border border-surface-border hover:border-brand-400 transition-all shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Receipt ${i + 1}`} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ) : (
            <a key={i} href={url} target="_blank" rel="noreferrer"
              className="aspect-square flex flex-col items-center justify-center rounded-xl border border-surface-border bg-surface hover:border-brand-400 hover:bg-brand-50/50 transition-all gap-1.5">
              <FileText className="w-6 h-6 text-brand-400" />
              <span className="text-[10px] text-surface-muted font-semibold">PDF {i + 1}</span>
            </a>
          )
        ))}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50 backdrop-blur-sm" />
          <Dialog.Content className="fixed z-50 inset-0 flex items-center justify-center p-4" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Receipt viewer</Dialog.Title>
            <div className="relative max-w-3xl w-full">
              <button type="button" aria-label="Close receipt viewer" onClick={() => setOpen(false)}
                className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[current]} alt={`Receipt ${current + 1}`}
                className="w-full max-h-[80vh] object-contain rounded-xl" />
              {urls.length > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  {urls.map((_, i) => (
                    <button key={i} type="button" aria-label={`View receipt ${i + 1}`} onClick={() => setCurrent(i)}
                      className={`w-2 h-2 rounded-full transition-all ${i === current ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/70'}`} />
                  ))}
                </div>
              )}
              <div className="flex justify-center gap-3 mt-3">
                {current > 0 && (
                  <button type="button" aria-label="Previous receipt" onClick={() => setCurrent(c => c - 1)}
                    className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors">← Prev</button>
                )}
                <a href={urls[current]} target="_blank" rel="noreferrer"
                  className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors">Open Full</a>
                {current < urls.length - 1 && (
                  <button type="button" aria-label="Next receipt" onClick={() => setCurrent(c => c + 1)}
                    className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors">Next →</button>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function NoteDialog({ title, desc, confirmLabel, confirmClass, onConfirm, children }: {
  title: string; desc: string; confirmLabel: string; confirmClass: string
  onConfirm: (note: string) => void; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">{desc}</Dialog.Description>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Add a note (optional)…"
            className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          <div className="flex gap-3 mt-4 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
            <Button type="button" size="sm" className={confirmClass} onClick={() => { onConfirm(note); setNote(''); setOpen(false) }}>{confirmLabel}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaymentDialog({ onConfirm }: { onConfirm: (proof: string) => void }) {
  const [open, setOpen]   = useState(false)
  const [files, setFiles] = useState<string[]>([])
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button className="gap-2 bg-green-600 hover:bg-green-700"><CreditCard className="w-4 h-4" /> Mark as Paid</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Confirm Payment</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">Upload bank transfer screenshot or UTR number for audit trail.</Dialog.Description>
          <FileUploader label="Payment Proof" hint="Bank screenshot · Optional" maxFiles={1} onChange={setFiles} />
          <div className="flex gap-3 mt-5 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
            <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { onConfirm(files[0] || ''); setFiles([]); setOpen(false) }}>
              Confirm Paid
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function ExpenseDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const { user } = useUser()
  const toast    = useToast()
  const role     = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'
  const isBoss    = role === 'boss'

  const [expense, setExpense] = useState<Expense | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const isOwner = !!(user && expense && expense.userId === user.id)
  const [newStatus, setNewStatus] = useState('pending_manager')
  const [statusNote, setStatusNote] = useState('')

  const fetchExpense = useCallback(async () => {
    const res = await fetch(`/api/rms/${id}`)
    if (!res.ok) { router.push('/rms'); return }
    setExpense(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => { fetchExpense() }, [fetchExpense])

  useEffect(() => {
    if (expense) {
      setNewStatus(expense.status)
      setStatusNote('')
    }
  }, [expense])

  const action = async (status: string, note?: string, paymentProof?: string) => {
    setActing(true)
    const body: Record<string, string> = { status }
    if (note) body[isBoss ? 'bossNote' : 'managerNote'] = note
    if (paymentProof) body.paymentProof = paymentProof
    if (status === 'paid') body.paidBy = user?.id || ''
    const res = await fetch(`/api/rms/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setExpense(await res.json())
      const msg: Record<string, string> = { pending_boss: 'Approved — forwarded for payout', paid: 'Marked as paid', rejected: 'Expense rejected' }
      toast(msg[status] || 'Updated', status === 'rejected' ? 'error' : 'success')
    } else {
      toast('Action failed', 'error')
    }
    setActing(false)
  }

  const withdraw = async () => {
    setActing(true)
    const res = await fetch(`/api/rms/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast('Reimbursement withdrawn', 'info')
      router.push('/rms')
    } else {
      toast('Could not withdraw — refresh and retry', 'error')
      setActing(false)
    }
  }

  if (loading) return (
    <>
      <Header title="Expense" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl w-full mx-auto bg-surface-2">
        <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-surface-border animate-pulse" />)}</div>
      </main>
    </>
  )

  if (!expense) return null
  const s = STATUS_META[expense.status] || STATUS_META.rejected
  const StatusIcon = s.icon

  return (
    <>
      <Header title="Expense Detail" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl space-y-5 animate-fade-in w-full mx-auto bg-surface-2">
        <Link href="/rms" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Reimbursements
        </Link>

        {/* Status banner */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.color}`}>
          <StatusIcon className="w-5 h-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-sm">{s.label}</p>
            {expense.managerNote && <p className="text-xs mt-0.5">Manager note: {expense.managerNote}</p>}
            {expense.bossNote    && <p className="text-xs mt-0.5">Finance note: {expense.bossNote}</p>}
          </div>
          <Badge variant={s.variant} className="flex-shrink-0">{s.label}</Badge>
        </div>

        {/* Pipeline tracker */}
        {expense.status !== 'rejected' && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                {PIPELINE.map((p, i) => {
                  const done    = s.pipeline >= p.step
                  const current = s.pipeline === p.step - 1
                  return (
                    <div key={p.step} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all
                          ${done ? 'bg-green-500 text-white shadow-sm' : current ? 'bg-brand-100 text-brand-600 border-2 border-brand-300' : 'bg-surface border-2 border-surface-border text-surface-muted'}`}>
                          {done ? <CheckCircle2 className="w-4 h-4" /> : p.step}
                        </div>
                        <p className={`text-xs font-semibold mt-1.5 text-center ${done ? 'text-green-600' : 'text-surface-muted'}`}>{p.label}</p>
                        <p className="text-[10px] text-surface-muted text-center">{p.sub}</p>
                      </div>
                      {i < PIPELINE.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-2 rounded ${s.pipeline > p.step ? 'bg-green-400' : 'bg-surface-border'}`} />
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Expense info */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Expense Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xl font-extrabold text-gray-900">{expense.title}</p>
              <p className="text-sm text-surface-muted mt-1">{expense.reason}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                <IndianRupee className="w-5 h-5 text-orange-500 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold">Amount</p>
                  <p className="text-lg font-extrabold text-gray-900">₹{expense.amount.toLocaleString('en-IN')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                <Calendar className="w-5 h-5 text-brand-500 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold">Date</p>
                  <p className="text-sm font-bold text-gray-900">{new Date(expense.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  {expense.endDate && <p className="text-xs text-surface-muted">to {new Date(expense.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
                </div>
              </div>
            </div>

            {(expense.travelFrom || expense.travelTo) && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                <MapPin className="w-5 h-5 text-purple-500 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold mb-0.5">Travel</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {expense.travelFrom} {expense.travelFrom && expense.travelTo && '→'} {expense.travelTo}
                  </p>
                </div>
              </div>
            )}

            {isManager && (
              <div className="pt-1 border-t border-surface-border">
                <p className="text-xs text-surface-muted font-semibold uppercase tracking-wide mb-1">Submitted by</p>
                <p className="text-sm font-bold text-gray-900">{expense.userName}</p>
                <p className="text-xs text-surface-muted">Submitted {new Date(expense.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Receipts */}
        {expense.receipts?.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4" /> Bills &amp; Receipts
                <span className="ml-auto text-xs font-normal text-surface-muted">{expense.receipts.length} file{expense.receipts.length > 1 ? 's' : ''}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptViewer urls={expense.receipts} />
            </CardContent>
          </Card>
        )}

        {/* Payment proof */}
        {expense.paymentProof && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4 text-green-500" /> Payment Proof</CardTitle></CardHeader>
            <CardContent>
              <a href={expense.paymentProof} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-green-200 bg-green-50 text-green-700 text-sm font-semibold hover:bg-green-100 transition-colors">
                <FileText className="w-4 h-4" /> View Payment Proof
              </a>
            </CardContent>
          </Card>
        )}

        {/* Status update */}
        {(isManager || isBoss) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-brand-500" /> Change Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-surface-muted">New status</span>
                  <select value={newStatus} onChange={e => setNewStatus(e.target.value)}
                    className="w-full rounded-xl border border-surface-border bg-white px-3.5 py-2 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                    {(isBoss ? [
                      { value: 'pending_boss', label: 'Pending payout' },
                      { value: 'paid', label: 'Paid' },
                      { value: 'rejected', label: 'Rejected' },
                      { value: 'returned', label: 'Returned to employee' },
                    ] : [
                      { value: 'pending_manager', label: 'Pending manager' },
                      { value: 'pending_boss', label: 'Pending payout' },
                      { value: 'rejected', label: 'Rejected' },
                      { value: 'returned', label: 'Returned to employee' },
                    ]).map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-3">
                  <Button className="gap-2" onClick={() => action(newStatus, statusNote)} disabled={acting || newStatus === expense.status}>
                    <CheckCircle2 className="w-4 h-4" /> Update status
                  </Button>
                  {newStatus === 'paid' && isBoss && (
                    <span className="text-xs text-surface-muted">Proof optional after update.</span>
                  )}
                </div>
              </div>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-surface-muted">Note</span>
                <textarea value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={3}
                  placeholder="Optional note for the employee or finance team…"
                  className="w-full rounded-xl border border-surface-border px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
              </label>
              {expense.status === 'paid' && !isBoss && (
                <p className="text-xs text-surface-muted">Paid expenses can only be changed by finance or a boss account.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Owner withdraw — pending_manager or returned only */}
        {isOwner && !isManager && (expense.status === 'pending_manager' || expense.status === 'returned') && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" /> Withdraw Request
              </CardTitle>
              <p className="text-xs text-surface-muted">
                {expense.status === 'returned'
                  ? 'This was returned for revision. You can revise it from the list, or withdraw it entirely.'
                  : 'Cancel this pending request before your manager reviews it.'}
              </p>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline"
                className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                onClick={() => setWithdrawOpen(true)} disabled={acting}>
                <XCircle className="w-4 h-4" /> Withdraw request
              </Button>
              <Dialog.Root open={withdrawOpen} onOpenChange={setWithdrawOpen}>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
                  <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                    <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Withdraw reimbursement?</Dialog.Title>
                    <Dialog.Description className="text-sm text-surface-muted mb-5">
                      This removes <strong className="text-gray-900">{expense.title}</strong> for <strong className="text-gray-900">₹{expense.amount.toLocaleString('en-IN')}</strong>. You can submit a new one anytime.
                    </Dialog.Description>
                    <div className="flex gap-3 justify-end">
                      <Dialog.Close asChild>
                        <Button type="button" variant="outline" size="sm">Keep request</Button>
                      </Dialog.Close>
                      <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700 gap-1.5"
                        onClick={withdraw} disabled={acting}>
                        {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        Withdraw
                      </Button>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </CardContent>
          </Card>
        )}

        {/* Action panel */}
        {isManager && expense.status !== 'paid' && expense.status !== 'rejected' && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-brand-500" /> Review Action
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 flex-wrap">
                {/* Manager approves → moves to pending_boss */}
                {!isBoss && expense.status === 'pending_manager' && (
                  <NoteDialog
                    title="Approve Expense" desc="Expense will be forwarded to finance for payment."
                    confirmLabel="Approve" confirmClass="bg-brand-500 hover:bg-brand-600 text-white"
                    onConfirm={note => action('pending_boss', note)}>
                    <Button className="gap-2" disabled={acting}>
                      <CheckCircle2 className="w-4 h-4" /> Approve
                    </Button>
                  </NoteDialog>
                )}

                {/* Boss marks paid */}
                {isBoss && expense.status === 'pending_boss' && (
                  <PaymentDialog onConfirm={proof => action('paid', undefined, proof)} />
                )}

                {/* Both can reject */}
                <NoteDialog
                  title="Reject Expense" desc="Employee will be notified with your reason."
                  confirmLabel="Confirm Reject" confirmClass="bg-red-600 hover:bg-red-700 text-white"
                  onConfirm={note => action('rejected', note)}>
                  <Button variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300" disabled={acting}>
                    <XCircle className="w-4 h-4" /> Reject
                  </Button>
                </NoteDialog>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  )
}
