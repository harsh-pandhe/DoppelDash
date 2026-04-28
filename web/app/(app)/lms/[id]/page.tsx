'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, CalendarClock, CheckCircle2, XCircle, Clock,
  Calendar, FileText, AlertCircle, User, Paperclip,
} from 'lucide-react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { useUser } from '@clerk/nextjs'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

interface Leave {
  _id: string; userId: string; userName: string
  type: 'casual' | 'medical' | 'earned'
  startDate: string; endDate: string; days: number
  reason: string; status: 'pending' | 'approved' | 'rejected'
  medicalDocs?: string[]; managerNote?: string; approvedBy?: string
  createdAt: string; updatedAt: string
}

const STATUS_META = {
  pending:  { label: 'Pending Approval', icon: Clock,        color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  approved: { label: 'Approved',         icon: CheckCircle2, color: 'text-green-700  bg-green-50  border-green-200'  },
  rejected: { label: 'Rejected',         icon: XCircle,      color: 'text-red-700    bg-red-50    border-red-200'    },
}
const TYPE_META = {
  casual:  { label: 'Casual Leave',  color: 'bg-blue-100  text-blue-700  border-blue-200'  },
  medical: { label: 'Medical Leave', color: 'bg-red-100   text-red-700   border-red-200'   },
  earned:  { label: 'Earned Leave',  color: 'bg-green-100 text-green-700 border-green-200' },
}

const PIPELINE = [
  { key: 'submitted',    label: 'Submitted',    desc: 'Request received' },
  { key: 'under_review', label: 'Under Review', desc: 'Manager reviewing' },
  { key: 'decision',     label: 'Decision',     desc: 'Approved / Rejected' },
]

function getPipelineStep(status: string) {
  if (status === 'approved' || status === 'rejected') return 2
  return 1
}

function RejectDialog({ onConfirm }: { onConfirm: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300">
          <XCircle className="w-4 h-4" /> Reject
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Reject Leave Request</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">Employee will be notified with your reason.</Dialog.Description>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Reason for rejection (optional)…"
            className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          <div className="flex gap-3 mt-4 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
            <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700"
              onClick={() => { onConfirm(note); setNote(''); setOpen(false) }}>Confirm Reject</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function LeaveDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const { user } = useUser()
  const toast    = useToast()
  const role      = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  const [leave,   setLeave]   = useState<Leave | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(false)

  const fetchLeave = useCallback(async () => {
    const res = await fetch(`/api/lms/${id}`)
    if (!res.ok) { router.push('/lms'); return }
    setLeave(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => { fetchLeave() }, [fetchLeave])

  const action = async (status: 'approved' | 'rejected', managerNote?: string) => {
    setActing(true)
    const res = await fetch(`/api/lms/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, managerNote }),
    })
    if (res.ok) {
      setLeave(await res.json())
      toast(status === 'approved' ? 'Leave approved' : 'Leave rejected', status === 'approved' ? 'success' : 'error')
    } else {
      toast('Action failed', 'error')
    }
    setActing(false)
  }

  if (loading) return (
    <>
      <Header title="Leave" />
      <main className="flex-1 p-6 max-w-4xl">
        <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-surface-border animate-pulse" />)}</div>
      </main>
    </>
  )
  if (!leave) return null

  const s   = STATUS_META[leave.status]
  const t   = TYPE_META[leave.type] || TYPE_META.casual
  const StatusIcon = s.icon

  const startFmt = new Date(leave.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const endFmt   = new Date(leave.endDate).toLocaleDateString('en-IN',   { day: 'numeric', month: 'long', year: 'numeric' })
  const submittedFmt = new Date(leave.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  const pipelineStep = getPipelineStep(leave.status)
  const hasDocs = leave.medicalDocs && leave.medicalDocs.length > 0

  return (
    <>
      <Header title="Leave Detail" />
      <main className="flex-1 p-6 max-w-4xl space-y-5 animate-fade-in">
        <Link href="/lms" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Leave Management
        </Link>

        {/* Status banner */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.color}`}>
          <StatusIcon className="w-5 h-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-sm">{s.label}</p>
            {leave.managerNote && <p className="text-xs mt-0.5 opacity-80">Note: {leave.managerNote}</p>}
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${t.color}`}>{t.label}</span>
        </div>

        {/* Progress tracker */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-widest">Application Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              {PIPELINE.map((step, i) => {
                const done    = pipelineStep >= i
                const current = pipelineStep === i
                const isLast  = i === PIPELINE.length - 1
                return (
                  <div key={step.key} className="flex items-center flex-1">
                    <div className="flex flex-col items-center flex-1">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all
                        ${done && !current ? 'bg-green-500 border-green-500' : current ? 'bg-brand-500 border-brand-500' : 'bg-white border-surface-border'}`}>
                        {done && !current
                          ? <CheckCircle2 className="w-5 h-5 text-white" />
                          : current
                            ? <Clock className="w-4 h-4 text-white" />
                            : <span className="text-xs font-bold text-surface-muted">{i + 1}</span>
                        }
                      </div>
                      <p className={`text-xs font-semibold mt-1.5 text-center ${done || current ? 'text-gray-900' : 'text-surface-muted'}`}>
                        {step.label}
                      </p>
                      <p className="text-[10px] text-surface-muted text-center leading-tight mt-0.5">{step.desc}</p>
                    </div>
                    {!isLast && (
                      <div className={`h-0.5 flex-1 mx-1 rounded transition-all ${pipelineStep > i ? 'bg-green-400' : 'bg-surface-border'}`} />
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Main info */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Leave Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {isManager && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                  <User className="w-5 h-5 text-brand-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold">Employee</p>
                    <p className="text-sm font-bold text-gray-900">{leave.userName}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                  <Calendar className="w-5 h-5 text-brand-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold">From</p>
                    <p className="text-sm font-bold text-gray-900">{startFmt}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                  <Calendar className="w-5 h-5 text-purple-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold">To</p>
                    <p className="text-sm font-bold text-gray-900">{endFmt}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                <CalendarClock className="w-5 h-5 text-orange-500 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold">Duration</p>
                  <p className="text-sm font-bold text-gray-900">{leave.days} day{leave.days > 1 ? 's' : ''}</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface border border-surface-border">
                <p className="text-[10px] text-surface-muted uppercase tracking-wide font-semibold mb-1">Reason for Leave</p>
                <p className="text-sm text-gray-900">{leave.reason}</p>
              </div>

              <p className="text-xs text-surface-muted px-1">Submitted on {submittedFmt}</p>
            </CardContent>
          </Card>

          {/* Documents + action */}
          <div className="space-y-4">
            {/* Supporting Documents */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-brand-500" /> Supporting Documents
                </CardTitle>
                <p className="text-xs text-surface-muted">
                  {leave.type === 'medical'
                    ? 'Medical certificate or prescription attached with this request.'
                    : 'Any supporting documents attached by the employee.'}
                </p>
              </CardHeader>
              <CardContent>
                {hasDocs ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {leave.medicalDocs!.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 p-3 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-all">
                        <FileText className="w-5 h-5 text-brand-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-brand-700 truncate">Document {i + 1}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-surface-border">
                    <AlertCircle className="w-4 h-4 text-surface-muted flex-shrink-0" />
                    <p className="text-xs text-surface-muted">
                      {leave.type === 'medical'
                        ? 'No medical documents uploaded — verify with employee before approving.'
                        : 'No supporting documents attached for this request.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action panel */}
            {isManager && leave.status === 'pending' && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-brand-500" /> Manager Action
                  </CardTitle>
                  <p className="text-xs text-surface-muted">Review the request details and make a decision.</p>
                </CardHeader>
                <CardContent>
                  {leave.type === 'medical' && !hasDocs && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 mb-4">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <p className="text-xs font-semibold text-amber-700">Medical leave without documents — confirm with employee before approving.</p>
                    </div>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    <Button className="gap-2" onClick={() => action('approved')} disabled={acting}>
                      <CheckCircle2 className="w-4 h-4" /> Approve Leave
                    </Button>
                    <RejectDialog onConfirm={note => action('rejected', note)} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Final decision card */}
            {leave.status !== 'pending' && (
              <Card className={leave.status === 'approved' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    {leave.status === 'approved'
                      ? <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                      : <XCircle      className="w-6 h-6 text-red-600   flex-shrink-0" />
                    }
                    <div>
                      <p className={`font-bold text-sm ${leave.status === 'approved' ? 'text-green-800' : 'text-red-800'}`}>
                        {leave.status === 'approved' ? 'Leave was approved' : 'Leave was rejected'}
                      </p>
                      {leave.managerNote && (
                        <p className={`text-xs mt-0.5 ${leave.status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>
                          Manager note: {leave.managerNote}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
