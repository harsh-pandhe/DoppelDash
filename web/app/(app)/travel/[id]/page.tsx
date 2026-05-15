'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, XCircle, ChevronLeft, MapPin, CalendarDays, IndianRupee, Loader2, RotateCcw } from 'lucide-react'
import { useUser } from '@/lib/useUser'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { timeAgo } from '@/lib/timeAgo'

interface TravelRequest {
  _id: string
  userId: string
  userName: string
  purpose: string
  destination: string
  departureDate: string
  returnDate: string
  estimatedTotal: number
  advanceRequested: number
  status: string
  managerNote?: string
  bossNote?: string
  createdAt: string
  approvedAt?: string
  rejectedAt?: string
}

const STATUS_CFG: Record<string, { label: string; ring: string; text: string; badge: 'default' | 'warning' | 'success' | 'destructive' }> = {
  pending_manager: { label: 'Manager Review', ring: 'ring-yellow-200 bg-yellow-50', text: 'text-yellow-700', badge: 'warning' },
  pending_boss:    { label: 'Boss Approval',  ring: 'ring-blue-200 bg-blue-50',   text: 'text-blue-700',   badge: 'default' },
  approved:        { label: 'Approved',       ring: 'ring-green-200 bg-green-50',  text: 'text-green-700',  badge: 'success' },
  rejected:        { label: 'Rejected',       ring: 'ring-red-200 bg-red-50',      text: 'text-red-700',    badge: 'destructive' },
  cancelled:       { label: 'Cancelled',      ring: 'ring-gray-200 bg-gray-50',    text: 'text-gray-500',   badge: 'default' },
}

export default function TravelRequestDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { user } = useUser()
  const toast = useToast()
  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'
  const isBoss = role === 'boss'

  const [request, setRequest] = useState<TravelRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [noteDialog, setNoteDialog] = useState<{ status: string; title: string; verb: string; tone: 'success' | 'danger' | 'warning' } | null>(null)
  const [note, setNote] = useState('')

  const fetchRequest = useCallback(async () => {
    const res = await fetch(`/api/travel/${id}`)
    if (!res.ok) {
      router.push('/travel')
      return
    }
    const data = await res.json()
    setRequest(data)
    setLoading(false)
  }, [id, router])

  useEffect(() => {
    fetchRequest()
  }, [fetchRequest])

  const act = async (status: string, noteValue?: string) => {
    if (!request) return
    setActing(true)
    const body: Record<string, string> = { status }
    if (noteValue?.trim()) {
      body[isBoss ? 'bossNote' : 'managerNote'] = noteValue.trim()
    }
    const res = await fetch(`/api/travel/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast(d.error || 'Action failed', 'error')
      setActing(false)
      return
    }
    setRequest(await res.json())
    const msg: Record<string, string> = {
      approved:        'Travel approved',
      rejected:        'Travel rejected',
      pending_boss:    'Forwarded to boss',
      pending_manager: 'Sent back to manager',
    }
    toast(msg[status] || 'Updated', ['rejected', 'pending_manager'].includes(status) ? 'info' : 'success')
    setActing(false)
    setNoteDialog(null); setNote('')
  }

  const openNoteDialog = (status: string, title: string, verb: string, tone: 'success' | 'danger' | 'warning') => {
    setNote(''); setNoteDialog({ status, title, verb, tone })
  }

  const cancel = async () => {
    if (!request) return
    setActing(true)
    const res = await fetch(`/api/travel/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast('Cancel failed', 'error')
      setActing(false)
      return
    }
    toast('Request cancelled', 'info')
    router.push('/travel')
  }

  if (loading) return (
    <>
      <Header title="Travel Request" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl w-full mx-auto space-y-4 bg-surface-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-surface-border animate-pulse" />)}
      </main>
    </>
  )

  if (!request) return null
  const status = STATUS_CFG[request.status] || STATUS_CFG.pending_manager
  const canManagerApprove = !isBoss && isManager && request.status === 'pending_manager'
  const canBossApprove = isBoss && request.status === 'pending_boss'
  const canCancel = request.userId === user?.id && request.status === 'pending_manager'

  return (
    <>
      <Header title="Travel Request" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl w-full mx-auto space-y-5 bg-surface-2">
        <Link href="/travel" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to Travel Requests
        </Link>

        <div className="rounded-3xl border border-surface-border bg-white p-6 space-y-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-gray-900">{request.purpose}</h1>
              <p className="text-sm text-slate-600">Requested by {request.userName} · {timeAgo(request.createdAt)}</p>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${status.ring} ${status.text}`}>
              <span className="h-2.5 w-2.5 rounded-full bg-current" /> {status.label}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-700">
            <div className="space-y-3 rounded-2xl border border-surface-border bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Destination</p>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="w-4 h-4 text-brand-500" /> {request.destination}
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-surface-border bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Dates</p>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="w-4 h-4 text-brand-500" />
                {new Date(request.departureDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
                —
                {new Date(request.returnDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="rounded-2xl border border-surface-border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Estimated total</p>
              <p className="mt-2 font-semibold text-gray-900 flex items-center gap-1"><IndianRupee className="w-4 h-4" />₹{request.estimatedTotal.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-2xl border border-surface-border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Advance requested</p>
              <p className="mt-2 font-semibold text-gray-900">₹{request.advanceRequested.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-2xl border border-surface-border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Submitted</p>
              <p className="mt-2 font-semibold text-gray-900">{new Date(request.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</p>
            </div>
          </div>

          {(request.managerNote || request.bossNote) && (
            <div className="rounded-2xl border border-surface-border bg-surface p-4 space-y-2">
              {request.managerNote && <div><p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Manager note</p><p className="mt-1 text-sm text-slate-700">{request.managerNote}</p></div>}
              {request.bossNote && <div><p className="text-xs uppercase tracking-[0.2em] text-surface-muted">Boss note</p><p className="mt-1 text-sm text-slate-700">{request.bossNote}</p></div>}
            </div>
          )}

          {(canManagerApprove || canBossApprove || canCancel) && (
            <div className="border-t border-surface-border pt-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-3">Actions</p>
              <div className="flex flex-wrap gap-2">
                {canManagerApprove && (
                  <>
                    <Button size="sm" className="gap-2 bg-[#0057A8] hover:bg-[#004d97]"
                      onClick={() => openNoteDialog('pending_boss', 'Forward to boss', 'Forward', 'success')} disabled={acting}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Forward to Boss
                    </Button>
                    <Button size="sm" className="gap-2 bg-green-600 hover:bg-green-700"
                      onClick={() => openNoteDialog('approved', 'Approve directly', 'Approve', 'success')} disabled={acting}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve directly
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => openNoteDialog('rejected', 'Reject request', 'Reject', 'danger')} disabled={acting}>
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </>
                )}
                {canBossApprove && (
                  <>
                    <Button size="sm" className="gap-2 bg-green-600 hover:bg-green-700"
                      onClick={() => openNoteDialog('approved', 'Final approval', 'Approve', 'success')} disabled={acting}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2 text-amber-600 border-amber-200 hover:bg-amber-50"
                      onClick={() => openNoteDialog('pending_manager', 'Send back to manager', 'Send back', 'warning')} disabled={acting}>
                      <RotateCcw className="w-3.5 h-3.5" /> Send back
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => openNoteDialog('rejected', 'Reject request', 'Reject', 'danger')} disabled={acting}>
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </>
                )}
                {canCancel && (
                  <Button size="sm" variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={cancel} disabled={acting}>
                    <XCircle className="w-3.5 h-3.5" /> Cancel request
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Note dialog */}
        <Dialog.Root open={!!noteDialog} onOpenChange={(o) => { if (!o) { setNoteDialog(null); setNote('') } }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
            <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
              <Dialog.Title className="text-base font-bold text-gray-900 mb-1">{noteDialog?.title || ''}</Dialog.Title>
              <Dialog.Description className="text-sm text-surface-muted mb-4">
                {noteDialog?.status === 'rejected'
                  ? 'Employee will be notified with your reason.'
                  : noteDialog?.status === 'pending_manager'
                  ? 'Manager will see your note when reviewing again.'
                  : 'Optional note for the audit trail.'}
              </Dialog.Description>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder={noteDialog?.status === 'rejected' ? 'Reason for rejection…' : 'Add a note (optional)…'}
                className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
              <div className="flex gap-3 mt-4 justify-end">
                <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
                <Button type="button" size="sm" disabled={acting}
                  className={
                    noteDialog?.tone === 'danger' ? 'bg-red-600 hover:bg-red-700 gap-1.5' :
                    noteDialog?.tone === 'warning' ? 'bg-amber-600 hover:bg-amber-700 gap-1.5' :
                    'bg-[#0057A8] hover:bg-[#004d97] gap-1.5'
                  }
                  onClick={() => noteDialog && act(noteDialog.status, note)}>
                  {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {noteDialog?.verb || 'Confirm'}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </main>
    </>
  )
}
