'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, CalendarClock, CheckCircle2, XCircle, Clock,
  ChevronLeft, ChevronRight, Calendar, Loader2, User,
  Paperclip, AlertCircle, FileText, Save,
  Users,
} from 'lucide-react'
import { useUser } from '@/lib/useUser'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Progress } from '@/components/ui/progress'
import { TabsRoot, TabsList, TabItem, TabsContent } from '@/components/ui/tabs'
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { useAutoRefresh } from '@/lib/useAutoRefresh'
import * as Dialog from '@radix-ui/react-dialog'
import FileUploader from '@/components/ui/file-uploader'
import { timeAgo } from '@/lib/timeAgo'

interface Leave {
  _id: string; userId: string; userName: string; type: string
  startDate: string; endDate: string; days: number; reason: string
  status: 'pending' | 'approved' | 'rejected'; managerNote?: string
  medicalDocs?: string[]; createdAt?: string
}

const TYPE_CFG: Record<string, { label: string; pill: string; dot: string; progress: string }> = {
  casual:     { label: 'Casual',     pill: 'bg-blue-100   text-blue-700',   dot: 'bg-blue-400',   progress: 'bg-blue-400'   },
  sick:       { label: 'Sick',       pill: 'bg-red-100    text-red-700',    dot: 'bg-red-400',    progress: 'bg-red-400'    },
  medical:    { label: 'Sick',       pill: 'bg-red-100    text-red-700',    dot: 'bg-red-400',    progress: 'bg-red-400'    }, // legacy compat
  earned:     { label: 'Earned',     pill: 'bg-green-100  text-green-700',  dot: 'bg-green-400',  progress: 'bg-green-400'  },
  lwp:        { label: 'LWP',        pill: 'bg-gray-100   text-gray-700',   dot: 'bg-gray-400',   progress: 'bg-gray-400'   },
  privilege:  { label: 'Privilege',  pill: 'bg-purple-100 text-purple-700', dot: 'bg-purple-400', progress: 'bg-purple-400' },
  restricted: { label: 'Restricted', pill: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400', progress: 'bg-orange-400' },
}
const STATUS_CFG = {
  pending:  { label: 'Pending',  icon: Clock,        ring: 'ring-yellow-200 bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  approved: { label: 'Approved', icon: CheckCircle2, ring: 'ring-green-200  bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500'  },
  rejected: { label: 'Rejected', icon: XCircle,      ring: 'ring-red-200    bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500'    },
}
const LEAVE_MAX: Record<string, number> = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwp: 999 }
const LEAVE_COLORS = [
  { type: 'casual',     label: 'Casual',     max: 12,  barClass: 'bg-blue-400'   },
  { type: 'sick',       label: 'Sick',       max: 6,   barClass: 'bg-red-400'    },
  { type: 'earned',     label: 'Earned',     max: 15,  barClass: 'bg-green-400'  },
  { type: 'privilege',  label: 'Privilege',  max: 2,   barClass: 'bg-purple-400' },
  { type: 'restricted', label: 'Restricted', max: 2,   barClass: 'bg-orange-400' },
]

/* ─── Leave Card ─────────────────────────────────────────────────────────── */
function LeaveCard({ leave, isManager, onSelect }: { leave: Leave; isManager: boolean; onSelect: () => void }) {
  const s = STATUS_CFG[leave.status]
  const t = TYPE_CFG[leave.type] || TYPE_CFG.casual
  const start = new Date(leave.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const end   = new Date(leave.endDate).toLocaleDateString('en-IN',   { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <button type="button" onClick={onSelect}
      className="group w-full text-left bg-white rounded-2xl border border-surface-border p-4 hover:border-brand-300 hover:shadow-md transition-all duration-200 flex flex-col gap-3">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.text}`}>{s.label}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.pill}`}>{t.label}</span>
      </div>

      {/* Reason */}
      <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{leave.reason}</p>

      {/* Date range */}
      <div className="flex items-center gap-1.5 text-xs text-surface-muted">
        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{start} — {end}</span>
        <span className="font-bold text-gray-700 ml-auto">{leave.days}d</span>
      </div>

      {/* Manager + docs */}
      <div className="flex items-center gap-2 flex-wrap">
        {isManager && (
          <span className="flex items-center gap-1 text-[10px] text-surface-muted">
            <User className="w-3 h-3" />{leave.userName}
          </span>
        )}
        {leave.medicalDocs && leave.medicalDocs.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-surface-muted">
            <Paperclip className="w-3 h-3" />{leave.medicalDocs.length} doc{leave.medicalDocs.length > 1 ? 's' : ''}
          </span>
        )}
        {leave.createdAt && (
          <span className="text-[10px] text-surface-muted ml-auto">{timeAgo(leave.createdAt)}</span>
        )}
      </div>

      {leave.managerNote && (
        <p className="text-[10px] text-surface-muted italic border-t border-surface-border pt-2">&ldquo;{leave.managerNote}&rdquo;</p>
      )}

      <div className={`h-px w-full rounded-full ${t.dot} opacity-30 group-hover:opacity-60 transition-opacity`} />
    </button>
  )
}

/* ─── Leave Detail Sheet ─────────────────────────────────────────────────── */
function LeaveDetailSheet({
  leave, open, onClose, isManager, onAction,
}: {
  leave: Leave | null; open: boolean; onClose: () => void
  isManager: boolean; onAction: (id: string, status: 'approved' | 'rejected', note?: string) => Promise<void>
}) {
  const [acting,     setActing]     = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)

  useEffect(() => { if (!open) { setShowReject(false); setRejectNote('') } }, [open])

  if (!leave) return null

  const s    = STATUS_CFG[leave.status]
  const t    = TYPE_CFG[leave.type] || TYPE_CFG.casual
  const Icon = s.icon

  const handleApprove = async () => {
    setActing(true); await onAction(leave._id, 'approved'); setActing(false); onClose()
  }
  const handleReject = async () => {
    setActing(true); await onAction(leave._id, 'rejected', rejectNote); setActing(false); onClose()
  }

  const PIPELINE = ['Submitted', 'Under Review', 'Decision']
  const pipelineStep = leave.status !== 'pending' ? 2 : 1

  return (
    <Sheet open={open} onOpenChange={onClose} side="right">
      <SheetHeader
        title="Leave Request"
        description={`${leave.userName || 'Your'} · ${t.label}`}
        onClose={onClose}
      />

      <SheetBody>
        {/* Status pill */}
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ring-1 ${s.ring}`}>
          <Icon className={`w-4 h-4 flex-shrink-0 ${s.text}`} />
          <span className={`text-sm font-bold ${s.text}`}>{s.label}</span>
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${t.pill}`}>{t.label}</span>
        </div>

        {/* Progress stepper */}
        <div className="flex items-center gap-2">
          {PIPELINE.map((step, i) => {
            const done = pipelineStep >= i
            return (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1 gap-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all
                    ${done ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-surface-border text-surface-muted'}`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <p className={`text-[10px] font-semibold text-center leading-tight ${done ? 'text-gray-800' : 'text-surface-muted'}`}>{step}</p>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1 rounded ${pipelineStep > i ? 'bg-brand-400' : 'bg-surface-border'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3">
          <InfoTile label="From"     value={new Date(leave.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} />
          <InfoTile label="To"       value={new Date(leave.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} />
          <InfoTile label="Duration" value={`${leave.days} day${leave.days > 1 ? 's' : ''}`} />
          <InfoTile label="Type"     value={t.label} />
        </div>

        <InfoTile label="Reason" value={leave.reason} full />

        {leave.createdAt && (
          <p className="text-xs text-surface-muted">Submitted {timeAgo(leave.createdAt)} · {new Date(leave.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        )}

        {/* Documents */}
        {leave.medicalDocs && leave.medicalDocs.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-surface-muted flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5" /> Supporting Documents
            </p>
            <div className="grid grid-cols-2 gap-2">
              {leave.medicalDocs.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 p-3 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors text-xs font-semibold text-brand-700">
                  <FileText className="w-4 h-4 flex-shrink-0" /> Doc {i + 1}
                </a>
              ))}
            </div>
          </div>
        )}

        {!leave.medicalDocs?.length && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-surface-border text-xs text-surface-muted">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {leave.type === 'medical' ? 'No medical docs — verify with employee.' : 'No supporting documents.'}
          </div>
        )}

        {/* Final decision */}
        {leave.status !== 'pending' && (
          <div className={`flex items-start gap-3 p-4 rounded-xl ring-1 ${s.ring}`}>
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${s.text}`} />
            <div>
              <p className={`text-sm font-bold ${s.text}`}>
                {leave.status === 'approved' ? 'Leave approved' : 'Leave rejected'}
              </p>
              {leave.managerNote && (
                <p className={`text-xs mt-0.5 ${s.text} opacity-80`}>Note: {leave.managerNote}</p>
              )}
            </div>
          </div>
        )}

        {/* Reject form inline */}
        {showReject && (
          <div className="space-y-3 p-4 bg-red-50 rounded-xl border border-red-200">
            <p className="text-sm font-semibold text-red-800">Reason for rejection (optional)</p>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
              placeholder="Manager note to employee…"
              className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:border-red-400" />
            <div className="flex gap-2">
              <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700 gap-1.5" onClick={handleReject} disabled={acting}>
                {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Confirm Reject
              </Button>
              <button type="button" onClick={() => setShowReject(false)} className="text-xs text-surface-muted hover:text-gray-700">Cancel</button>
            </div>
          </div>
        )}
      </SheetBody>

      {isManager && leave.status === 'pending' && !showReject && (
        <SheetFooter>
          <div className="flex gap-3">
            <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={handleApprove} disabled={acting}>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve
            </Button>
            <Button variant="outline" className="flex-1 gap-2 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setShowReject(true)}>
              <XCircle className="w-4 h-4" /> Reject
            </Button>
          </div>
        </SheetFooter>
      )}
    </Sheet>
  )
}

function InfoTile({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`p-3 rounded-xl bg-surface border border-surface-border ${full ? 'col-span-2' : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-surface-muted mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  )
}

/* ─── New Leave Dialog ───────────────────────────────────────────────────── */
function NewLeaveDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ type: 'casual', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayPeriod: 'morning' as 'morning' | 'afternoon' })
  const [docs, setDocs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [used,    setUsed]    = useState<Record<string, number>>({ casual: 0, sick: 0, earned: 0, privilege: 0, restricted: 0 })
  const toast = useToast()

  const [entitlement, setEntitlement] = useState<Record<string, number>>({ casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2 })

  useEffect(() => {
    if (!open) return
    fetch('/api/lms/balance').then(r => r.json()).then((d: {
      balance?: Record<string, { entitlement: number; used: number; remaining: number }>
    }) => {
      if (!d?.balance) return
      const u: Record<string, number> = {}
      const e: Record<string, number> = {}
      for (const [k, v] of Object.entries(d.balance)) {
        u[k] = v.used
        e[k] = v.entitlement
      }
      setUsed(u); setEntitlement(e)
    }).catch(() => {})
  }, [open])

  const rawDays = form.startDate && form.endDate
    ? Math.max(1, Math.ceil((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1)
    : 0
  const days    = form.isHalfDay ? 0.5 : rawDays
  const isSick  = form.type === 'sick'
  const isLWP   = form.type === 'lwp'
  const sickReq = isSick && rawDays > 2
  const balance = isLWP ? Infinity : Math.max(0, (entitlement[form.type] ?? LEAVE_MAX[form.type] ?? 0) - (used[form.type] ?? 0))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.startDate || !form.endDate || !form.reason.trim()) { setError('All fields are required.'); return }
    if (new Date(form.endDate) < new Date(form.startDate)) { setError('End date must be after start date.'); return }
    if (sickReq && docs.length === 0) { setError('Medical docs required for sick leave > 2 days.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/lms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type, startDate: form.startDate, endDate: form.endDate,
          reason: form.reason, days, medicalDocs: docs,
          isLWP, isHalfDay: form.isHalfDay, halfDayPeriod: form.isHalfDay ? form.halfDayPeriod : undefined,
        }),
      })
      if (!res.ok) throw new Error()
      toast('Leave request submitted', 'success')
      setOpen(false)
      setForm({ type: 'casual', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayPeriod: 'morning' })
      setDocs([])
      onCreated()
    } catch { setError('Failed to submit.') }
    finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button className="gap-2" data-new-leave><Plus className="w-4 h-4" /> Request Leave</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-surface-border px-6 py-4 flex items-center justify-between z-10">
            <div>
              <Dialog.Title className="text-base font-bold text-gray-900">New Leave Request</Dialog.Title>
              <Dialog.Description className="text-xs text-surface-muted mt-0.5">Fill in your leave details below.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="p-1.5 rounded-lg text-surface-muted hover:bg-surface transition-colors">
                <XCircle className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}

            {/* Leave type pills */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-surface-muted">Leave Type</label>
              <div className="grid grid-cols-3 gap-2">
                {['casual','sick','earned','privilege','restricted','lwp'].map(type => {
                  const bal = type === 'lwp' ? null : Math.max(0, (entitlement[type] ?? LEAVE_MAX[type] ?? 0) - (used[type] ?? 0))
                  const t = TYPE_CFG[type]
                  return (
                    <button key={type} type="button"
                      onClick={() => setForm(f => ({ ...f, type }))}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-xs font-bold transition-all
                        ${form.type === type
                          ? 'border-brand-400 bg-brand-50 text-brand-700 ring-2 ring-brand-400/20'
                          : 'border-surface-border text-gray-600 hover:border-gray-300'}`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${t.dot}`} />
                      <span>{t.label}</span>
                      <span className={`text-[10px] font-semibold ${bal !== null && bal <= 2 ? 'text-red-500' : 'text-surface-muted'}`}>
                        {bal === null ? 'Unpaid' : `${bal} left`}
                      </span>
                    </button>
                  )
                })}
              </div>
              {form.type === 'lwp' && (
                <p className="text-xs text-orange-600 font-semibold px-1">⚠ Leave Without Pay — salary deduction applies</p>
              )}
            </div>

            {/* Half-day option */}
            <div className="flex items-center gap-4 p-3 rounded-xl border border-surface-border bg-surface/50">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isHalfDay} onChange={e => setForm(f => ({...f, isHalfDay: e.target.checked}))} className="accent-brand-500 w-4 h-4" />
                <span className="text-sm font-semibold text-gray-700">Half Day</span>
              </label>
              {form.isHalfDay && (
                <div className="flex gap-2">
                  {(['morning', 'afternoon'] as const).map(p => (
                    <button key={p} type="button" onClick={() => setForm(f => ({...f, halfDayPeriod: p}))}
                      className={`px-3 py-1 rounded-full text-xs font-bold capitalize transition-all
                        ${form.halfDayPeriod === p ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              {[['startDate', 'Start Date', ''], ['endDate', 'End Date', form.startDate]].map(([name, label, min]) => (
                <div key={name} className="space-y-1.5">
                  <label htmlFor={name} className="text-xs font-bold uppercase tracking-wide text-surface-muted">{label}</label>
                  <input id={name} name={name} type="date" min={min || undefined}
                    value={(form as unknown as Record<string, string>)[name]}
                    onChange={e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                    required />
                </div>
              ))}
            </div>

            {days > 0 && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-50 border border-brand-200">
                <CalendarClock className="w-4 h-4 text-brand-500" />
                <span className="text-sm font-bold text-brand-700">{days} day{days !== 1 ? 's' : ''}</span>
                {form.isHalfDay && <span className="text-xs text-brand-600">(half day)</span>}
                {!isLWP && balance !== Infinity && balance < days && (
                  <span className="ml-auto text-xs text-red-500 font-semibold">⚠ Exceeds balance ({balance} left)</span>
                )}
                {isLWP && <span className="ml-auto text-xs text-orange-600 font-semibold">Salary deduction: {days}d</span>}
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <label htmlFor="reason" className="text-xs font-bold uppercase tracking-wide text-surface-muted">Reason</label>
              <textarea id="reason" name="reason" value={form.reason} rows={3}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Brief reason for leave…"
                className="w-full rounded-xl border border-surface-border px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                required />
            </div>

            {/* Documents */}
            {(isSick) && (
              <FileUploader
                label={sickReq ? 'Medical Documents (Required for >2 days)' : 'Medical Documents (Optional)'}
                hint="Doctor's note, prescription or hospital certificate · JPG, PNG, PDF"
                required={sickReq}
                variant={sickReq ? 'danger' : 'default'}
                onChange={setDocs}
                disabled={loading}
              />
            )}

            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={loading} className="flex-1 gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting…</> : <><Save className="w-4 h-4" />Submit Request</>}
              </Button>
              <Dialog.Close asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ─── Mini Calendar ──────────────────────────────────────────────────────── */
function MiniCalendar({ leaves }: { leaves: Leave[] }) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [jumped, setJumped] = useState(false)

  // Jump to month of most recent leave once data loads
  useEffect(() => {
    if (jumped || leaves.length === 0) return
    const latest = leaves.reduce((best, l) => {
      const d = new Date(l.startDate)
      return d > best ? d : best
    }, new Date(leaves[0].startDate))
    setYear(latest.getFullYear())
    setMonth(latest.getMonth())
    setJumped(true)
  }, [leaves, jumped])
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const getLeavesForDay = (d: number) => {
    const date = new Date(year, month, d)
    return leaves.filter(l => {
      const s = new Date(l.startDate); const e = new Date(l.endDate)
      s.setHours(0,0,0,0); e.setHours(23,59,59,999)
      return date >= s && date <= e
    })
  }

  const prev = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const next = () => { if (month === 11) { setYear(y => y + 1); setMonth(0)  } else setMonth(m => m + 1) }

  return (
    <div className="bg-white rounded-2xl border border-surface-border p-4">
      <div className="flex items-center justify-between mb-3">
        <button type="button" aria-label="Previous month" onClick={prev} className="p-1 rounded-lg hover:bg-surface transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <p className="text-xs font-bold text-gray-900">{MONTHS[month]} {year}</p>
        <button type="button" aria-label="Next month" onClick={next} className="p-1 rounded-lg hover:bg-surface transition-colors"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <p key={d} className="text-center text-[9px] font-bold text-surface-muted py-0.5">{d}</p>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
          const dl = getLeavesForDay(d)
          const isToday   = d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          const firstLeave = dl[0]
          // Color the whole cell bg based on dominant leave type
          const cellBg = firstLeave
            ? firstLeave.status === 'pending'  ? 'bg-yellow-200 border-yellow-300'
            : firstLeave.status === 'rejected' ? 'bg-red-100 border-red-200'
            : firstLeave.type === 'casual'     ? 'bg-blue-200 border-blue-300'
            : firstLeave.type === 'medical'    ? 'bg-red-200 border-red-300'
                                               : 'bg-green-200 border-green-300'
            : ''
          const textCol = firstLeave
            ? firstLeave.status === 'pending'  ? 'text-yellow-900'
            : firstLeave.status === 'rejected' ? 'text-red-900'
            : firstLeave.type === 'casual'     ? 'text-blue-900'
            : firstLeave.type === 'medical'    ? 'text-red-900'
                                               : 'text-green-900'
            : isToday ? 'text-white' : 'text-gray-700'
          return (
            <div key={d} className={`flex flex-col items-center justify-center h-7 rounded-md border transition-all
              ${isToday ? 'bg-brand-500 border-brand-500' : dl.length > 0 ? cellBg + ' border' : 'border-transparent'}`}>
              <span className={`text-[10px] font-semibold leading-none ${textCol}`}>{d}</span>
              {dl.length > 1 && (
                <span className={`text-[8px] font-bold leading-none mt-0.5 ${textCol} opacity-70`}>+{dl.length}</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 pt-3 border-t border-surface-border flex flex-wrap gap-x-3 gap-y-1">
        {[
          { color: 'bg-blue-400',   label: 'Casual' },
          { color: 'bg-red-400',    label: 'Medical' },
          { color: 'bg-green-400',  label: 'Earned' },
          { color: 'bg-yellow-400', label: 'Pending' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 text-[9px] text-surface-muted">
            <span className={`w-2 h-2 rounded-full ${color}`} />{label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function LMSPage() {
  const { user } = useUser()
  const toast    = useToast()
  const role      = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  const [leaves,    setLeaves]    = useState<Leave[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<Leave | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [bulkSel,   setBulkSel]   = useState<Set<string>>(new Set())
  const [bulking,   setBulking]   = useState(false)
  const [serverBalance, setServerBalance] = useState<Record<string, { entitlement: number; used: number; remaining: number }> | null>(null)

  const fetchLeaves = useCallback(async () => {
    setLoading(true)
    try {
      const [resLeaves, resBal] = await Promise.all([
        fetch('/api/lms'),
        fetch('/api/lms/balance'),
      ])
      const data = await resLeaves.json()
      setLeaves(Array.isArray(data) ? data : [])
      if (resBal.ok) {
        const bd = await resBal.json()
        setServerBalance(bd?.balance || null)
      }
    } catch { setLeaves([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchLeaves() }, [fetchLeaves])
  useAutoRefresh(fetchLeaves)

  const handleAction = async (id: string, status: 'approved' | 'rejected', note?: string) => {
    await fetch(`/api/lms/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, managerNote: note }),
    })
    toast(status === 'approved' ? 'Leave approved' : 'Leave rejected', status === 'approved' ? 'success' : 'error')
    fetchLeaves()
  }

  const bulkAction = async (status: 'approved' | 'rejected') => {
    setBulking(true)
    await Promise.all(Array.from(bulkSel).map(id =>
      fetch(`/api/lms/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    ))
    toast(`${bulkSel.size} leave${bulkSel.size > 1 ? 's' : ''} ${status}`, status === 'approved' ? 'success' : 'error')
    setBulkSel(new Set()); setBulking(false); fetchLeaves()
  }

  const openSheet = (leave: Leave) => { setSelected(leave); setSheetOpen(true) }

  const pending  = leaves.filter(l => l.status === 'pending')
  const approved = leaves.filter(l => l.status === 'approved')
  const rejected = leaves.filter(l => l.status === 'rejected')

  // Leave balance — prefer server-authoritative LeaveBalance; fall back to client compute
  const usedDays = (type: string) => {
    if (serverBalance && serverBalance[type]) return serverBalance[type].used
    return approved.filter(l => (l.type === 'medical' ? 'sick' : l.type) === type).reduce((a, l) => a + l.days, 0)
  }
  const maxFor = (type: string, fallback: number) => serverBalance?.[type]?.entitlement ?? fallback

  const toggleBulk = (id: string) => setBulkSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  function LeaveGrid({ items }: { items: Leave[] }) {
    if (loading) return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <div key={i} className="h-40 rounded-2xl bg-surface-border animate-pulse" />)}
      </div>
    )
    if (items.length === 0) return (
      <div className="col-span-full">
        <EmptyState
          icon={CalendarClock}
          title="No leave requests"
          description="Submit one when you need a day off, sick leave, or planned absence."
          action={{ label: 'Request Leave', icon: Plus, onClick: () => document.querySelector<HTMLButtonElement>('[data-new-leave]')?.click() }}
        />
      </div>
    )
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map(l => {
          const isPendingBulk = isManager && l.status === 'pending'
          return (
            <div key={l._id} className="relative">
              {isPendingBulk && (
                <div className="absolute top-3 left-3 z-10" onClick={e => { e.stopPropagation(); toggleBulk(l._id) }}>
                  <input type="checkbox" aria-label={`Select ${l.userName}`}
                    className="accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                    checked={bulkSel.has(l._id)} onChange={() => {}} />
                </div>
              )}
              <LeaveCard leave={l} isManager={isManager} onSelect={() => openSheet(l)} />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <Header title="Leave Management" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-6 w-full bg-surface-2">

        {/* Header row */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">Leave Requests</h2>
            <p className="text-sm text-surface-muted mt-0.5">
              {isManager ? `${pending.length} pending approval` : `${leaves.length} total requests`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isManager && bulkSel.size > 0 && (
              <div className="flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-xl px-3 py-1.5">
                <span className="text-xs font-semibold text-brand-700">{bulkSel.size} selected</span>
                <button type="button" onClick={() => bulkAction('approved')} disabled={bulking}
                  className="text-xs font-bold text-green-700 hover:text-green-800 px-2 py-0.5 rounded-lg bg-green-100 hover:bg-green-200 transition-colors">
                  {bulking ? '…' : 'Approve all'}
                </button>
                <button type="button" onClick={() => bulkAction('rejected')} disabled={bulking}
                  className="text-xs font-bold text-red-600 hover:text-red-700 px-2 py-0.5 rounded-lg bg-red-100 hover:bg-red-200 transition-colors">
                  {bulking ? '…' : 'Reject all'}
                </button>
              </div>
            )}
            <NewLeaveDialog onCreated={fetchLeaves} />
          </div>
        </div>

        {/* Main layout: left content + right sidebar */}
        <div className="flex gap-6 items-start">
          <div className="flex-1 min-w-0 space-y-4">

            {/* Leave balance (employee) — sourced from LeaveBalance model */}
            {!isManager && (
              <div className="grid grid-cols-3 gap-4">
                {LEAVE_COLORS.map(({ type, label, max: fallbackMax, barClass }) => {
                  const used    = usedDays(type)
                  const max     = maxFor(type, fallbackMax)
                  const pct     = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0
                  const remaining = Math.max(0, max - used)
                  return (
                    <div key={type} className="bg-white rounded-2xl border border-surface-border p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700">{label}</span>
                        <span className="text-[10px] text-surface-muted">{remaining}/{max} left</span>
                      </div>
                      <Progress value={pct} className="h-1.5 bg-gray-100" indicatorClassName={barClass} />
                      <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{used} <span className="text-xs font-normal text-surface-muted">used</span></p>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Manager stat row */}
            {isManager && (
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Pending',  count: pending.length,  color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
                  { label: 'Approved', count: approved.length, color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200'  },
                  { label: 'Rejected', count: rejected.length, color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200'    },
                ].map(({ label, count, color, bg, border }) => (
                  <div key={label} className={`${bg} border ${border} rounded-2xl p-4 text-center`}>
                    <p className={`text-3xl font-extrabold tabular-nums ${color}`}>{count}</p>
                    <p className="text-xs font-semibold text-gray-600 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs */}
            <TabsRoot defaultValue="all">
              <TabsList>
                <TabItem value="all">All <span className="text-surface-muted ml-1">({leaves.length})</span></TabItem>
                <TabItem value="pending"  badge={pending.length}>Pending</TabItem>
                <TabItem value="approved" badge={approved.length}>Approved</TabItem>
                <TabItem value="rejected">Rejected</TabItem>
              </TabsList>

              <TabsContent value="all"      className="mt-4"><LeaveGrid items={leaves} /></TabsContent>
              <TabsContent value="pending"  className="mt-4"><LeaveGrid items={pending} /></TabsContent>
              <TabsContent value="approved" className="mt-4"><LeaveGrid items={approved} /></TabsContent>
              <TabsContent value="rejected" className="mt-4"><LeaveGrid items={rejected} /></TabsContent>
            </TabsRoot>
          </div>

          {/* Sidebar — calendar + team summary */}
          <div className="hidden xl:flex flex-col gap-4 w-72 flex-shrink-0">
            <MiniCalendar leaves={leaves} />

            {isManager && pending.length > 0 && (
              <div className="bg-white rounded-2xl border border-surface-border p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-surface-muted flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Needs attention
                </p>
                <div className="space-y-1.5">
                  {pending.slice(0, 5).map(l => (
                    <button key={l._id} type="button" onClick={() => openSheet(l)}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-surface transition-colors text-left">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">{l.userName}</p>
                        <p className="text-[10px] text-surface-muted">{l.days}d {l.type}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="bg-white rounded-2xl border border-surface-border p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-surface-muted">Calendar legend</p>
              {[
                { dot: 'bg-yellow-400', label: 'Pending' },
                { dot: 'bg-green-500',  label: 'Approved' },
                { dot: 'bg-red-300',    label: 'Rejected' },
              ].map(({ dot, label }) => (
                <span key={label} className="flex items-center gap-2 text-xs text-surface-muted">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />{label}
                </span>
              ))}
            </div>
          </div>
        </div>

      </main>

      {/* Detail Sheet */}
      <LeaveDetailSheet
        leave={selected}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        isManager={isManager}
        onAction={handleAction}
      />
    </>
  )
}
