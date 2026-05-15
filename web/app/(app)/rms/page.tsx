'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Receipt, IndianRupee, CheckCircle2, XCircle, Clock, CreditCard, Download, Filter, Loader2, History, LayoutList, Table2, ScanLine, Sparkles, AlertCircle, RotateCcw, MapPin, Calendar, Save, FileText, Trash2 } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import { timeAgo } from '@/lib/timeAgo'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { useUser } from '@/lib/useUser'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import FileUploader from '@/components/ui/file-uploader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { useUrlState } from '@/lib/useUrlState'
import { useAutoRefresh } from '@/lib/useAutoRefresh'

interface ExpenseLineItem {
  _id?: string; description: string; amount: number; date: string
  receiptUrl?: string; category?: string; status: 'pending' | 'approved' | 'rejected'; reviewNote?: string
}

interface Expense {
  _id: string; userId: string; userName: string; title: string; reason: string
  amount: number; startDate: string; status: string; managerNote?: string; bossNote?: string
  receipts?: string[]; createdAt?: string
  travelFrom?: string; travelTo?: string; endDate?: string
  lineItems?: ExpenseLineItem[]; hasLineItems?: boolean
  paymentMethod?: string; paymentNote?: string
}

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'default' | 'success' | 'destructive' | 'secondary'; icon: React.ElementType; pipeline: number }> = {
  pending_manager: { label: 'Manager Review', variant: 'warning',     icon: Clock,        pipeline: 1 },
  pending_boss:    { label: 'Pending Payout',  variant: 'default',    icon: CreditCard,   pipeline: 2 },
  paid:            { label: 'Paid',            variant: 'success',    icon: CheckCircle2, pipeline: 3 },
  rejected:        { label: 'Rejected',        variant: 'destructive',icon: XCircle,      pipeline: 0 },
  returned:        { label: 'Needs Revision',  variant: 'secondary',  icon: RotateCcw,    pipeline: 0 },
}

/* ─── Compress image for OCR ──────────────────────────────────────────────── */
function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const MAX = 1400
      if (width > MAX || height > MAX) {
        const r = Math.min(MAX / width, MAX / height)
        width = Math.round(width * r); height = Math.round(height * r)
      }
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      let quality = 0.92
      const tryCompress = () => {
        const d = canvas.toDataURL('image/jpeg', quality)
        if ((d.length * 3) / 4 <= 600 * 1024 || quality <= 0.4) resolve({ base64: d.split(',')[1], mimeType: 'image/jpeg' })
        else { quality -= 0.1; tryCompress() }
      }
      tryCompress()
    }
    img.onerror = reject; img.src = url
  })
}

const EMPTY_FORM = { title: '', reason: '', amount: '', travelFrom: '', travelTo: '', startDate: '', endDate: '' }
const EMPTY_LINE = (): ExpenseLineItem => ({ description:'', amount:0, date:'', receiptUrl:'', category:'misc', status:'pending' })

const LINE_CATEGORIES = ['food','taxi','hotel','flight','fuel','misc','other']

/* ─── New Expense Dialog ───────────────────────────────────────────────────── */
function NewExpenseDialog({
  onCreated,
  editExpense,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  onCreated: () => void
  editExpense?: Expense | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'simple' | 'table'>('simple')
  const [form, setForm] = useState(EMPTY_FORM)
  const [receipts, setReceipts] = useState<string[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [ocrSrc, setOcrSrc] = useState<'gemma' | 'fallback' | null>(null)
  const [ocrFlds, setOcrFlds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([EMPTY_LINE()])
  const [lineUploading, setLineUploading] = useState<number | null>(null)
  const [priv, setPriv] = useState<{ food:{tier:string;dailyLimit:number}; taxi:{tier:string;perKmLimit:number}; flight:{tier:string;enabled:boolean}; hotel:{tier:string;perNightLimit:number} } | null>(null)
  const toast = useToast()

  const controlled = openProp !== undefined
  const currentOpen = controlled ? openProp : open
  const setCurrentOpen = (value: boolean) => {
    if (!controlled) setOpen(value)
    onOpenChange?.(value)
  }

  useEffect(() => {
    if (!currentOpen) return
    fetch('/api/employees/me').then(r => r.json()).then(d => { if (d?.privileges) setPriv(d.privileges) }).catch(() => {})
  }, [currentOpen])

  useEffect(() => {
    if (!currentOpen) return
    if (!editExpense) return
    setMode(editExpense.hasLineItems ? 'table' : 'simple')
    setForm({
      title: editExpense.title || '',
      reason: editExpense.reason || '',
      amount: editExpense.hasLineItems ? '' : String(editExpense.amount || ''),
      travelFrom: editExpense.travelFrom || '',
      travelTo: editExpense.travelTo || '',
      startDate: editExpense.startDate ? new Date(editExpense.startDate).toISOString().slice(0, 10) : '',
      endDate: editExpense.endDate ? new Date(editExpense.endDate).toISOString().slice(0, 10) : '',
    })
    setReceipts(editExpense.receipts || [])
    const isReturned = editExpense.status === 'returned'
    setLineItems(editExpense.lineItems && editExpense.lineItems.length > 0
      ? editExpense.lineItems.map(l => ({
          ...l,
          status: isReturned ? 'pending' : l.status,
          date: l.date ? new Date(l.date).toISOString().slice(0, 10) : '',
        }))
      : [EMPTY_LINE()])
  }, [currentOpen, editExpense])

  const lineTotal = lineItems.reduce((s, l) => s + (l.amount || 0), 0)

  const resetAll = () => {
    setForm(EMPTY_FORM); setReceipts([]); setPreviews([]); setOcrSrc(null); setOcrFlds(new Set()); setError('')
    setLineItems([EMPTY_LINE()]); setMode('simple')
  }

  useEffect(() => {
    if (!currentOpen) return
    return () => {
      previews.forEach(url => URL.revokeObjectURL(url))
    }
  }, [previews, currentOpen])

  useEffect(() => {
    if (!currentOpen) return
    return () => {
      if (!controlled) resetAll()
    }
  }, [currentOpen, controlled])

  const updateLine = (i: number, field: keyof ExpenseLineItem, val: string | number) =>
    setLineItems(prev => prev.map((l, j) => j === i ? { ...l, [field]: val } : l))

  const uploadLineReceipt = async (i: number, file: File) => {
    setLineUploading(i)
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const d = await res.json()
    if (d.url) updateLine(i, 'receiptUrl', d.url)
    setLineUploading(null)
  }

  const handleFilePicked = useCallback(async (files: File[]) => {
    setPreviews(p => [...p, ...files.filter(f => f.type.startsWith('image/')).map(f => URL.createObjectURL(f))])
    const first = files.find(f => f.type.startsWith('image/'))
    if (!first || form.title || form.amount) return
    setScanning(true)
    try {
      const { base64 } = await compressImage(first)
      const res = await fetch('/api/rms/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const p = data.parsed as Record<string, string | number | null>
      const filled = new Set<string>()
      setForm(f => {
        const n = { ...f }
        if (p.title       && !f.title)     { n.title     = String(p.title);             filled.add('title')     }
        if (p.description && !f.reason)    { n.reason    = String(p.description);       filled.add('reason')    }
        if (p.amount      && !f.amount)    { n.amount    = String(p.amount);            filled.add('amount')    }
        if (p.date        && !f.startDate) { n.startDate = String(p.date).slice(0, 10); filled.add('startDate') }
        return n
      })
      setOcrFlds(filled); setOcrSrc(data.source)
    } catch { setOcrSrc('fallback') }
    finally { setScanning(false) }
  }, [form.title, form.amount])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.reason || !form.startDate) { setError('Fill title, reason, and start date.'); return }
    if (mode === 'simple') {
      if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) { setError('Amount must be positive.'); return }
      if (receipts.length === 0) { setError('Upload at least one receipt.'); return }
    } else {
      const validLines = lineItems.filter(l => l.description && l.amount > 0)
      if (validLines.length === 0) { setError('Add at least one line item.'); return }
      if (validLines.some(l => !l.date)) { setError('Fill a date for every line item.'); return }
    }
    setSaving(true); setError('')
    const isEdit = !!editExpense
    try {
      const validLines = lineItems.filter(l => l.description && l.amount > 0 && l.date)
      const resetLines = editExpense?.status === 'returned'
        ? validLines.map(l => ({ ...l, status: 'pending' as const }))
        : validLines
      const total = mode === 'table' ? lineTotal : Number(form.amount)
      const res = await fetch(isEdit ? `/api/rms/${editExpense?._id}` : '/api/rms', {
        method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          amount: total,
          receipts,
          ...(mode === 'table' ? { lineItems: resetLines, hasLineItems: true } : {}),
          ...(isEdit ? { status: 'pending_manager' } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      toast(isEdit ? 'Expense revised and resubmitted' : 'Expense submitted', 'success')
      setCurrentOpen(false)
      resetAll()
      onCreated()
    } catch { setError(isEdit ? 'Failed to resubmit.' : 'Failed to submit.') }
    finally { setSaving(false) }
  }

  const hl = (field: string) => ocrFlds.has(field) ? 'border-emerald-300 bg-emerald-50/40' : ''

  return (
    <Dialog.Root open={currentOpen} onOpenChange={setCurrentOpen}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-surface-border px-6 py-4 flex items-center justify-between z-10">
            <div>
              <Dialog.Title className="text-base font-bold text-gray-900">{editExpense ? 'Revise Expense' : 'Log Expense'}</Dialog.Title>
              <Dialog.Description className="text-xs text-surface-muted mt-0.5">Upload receipt — AI auto-fills the form.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="p-1.5 rounded-lg text-surface-muted hover:bg-surface transition-colors">
                <XCircle className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-6 space-y-5">
            {/* Privilege banner */}
            {priv && (
              <div className="px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px]">
                <p className="font-bold text-indigo-700 mb-1">Your reimbursement privileges</p>
                <div className="grid grid-cols-2 gap-1 text-indigo-600">
                  {priv.food.tier   !== 'none' && <span>Food: ₹{priv.food.dailyLimit}/day</span>}
                  {priv.taxi.tier   !== 'none' && <span>Taxi: ₹{priv.taxi.perKmLimit}/km ({priv.taxi.tier})</span>}
                  {priv.hotel.tier  !== 'none' && <span>Hotel: ₹{priv.hotel.perNightLimit}/night</span>}
                  {priv.flight.enabled         && <span>Flight: {priv.flight.tier}</span>}
                  {[priv.food.tier, priv.taxi.tier, priv.hotel.tier].every(t => t === 'none') && !priv.flight.enabled && (
                    <span className="text-amber-600">No travel privileges set — ask your manager</span>
                  )}
                </div>
              </div>
            )}

            {/* Mode toggle */}
            <div className="flex rounded-xl border border-surface-border overflow-hidden">
              {(['simple','table'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`flex-1 py-2 text-xs font-bold capitalize transition-all
                    ${mode === m ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-surface'}`}>
                  {m === 'simple' ? 'Simple' : 'Table (Line Items)'}
                </button>
              ))}
            </div>

            {/* Receipt upload */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-surface-muted flex items-center gap-1.5">
                  <ScanLine className="w-3.5 h-3.5" /> Bills & Receipts
                </p>
                {ocrSrc && <button type="button" onClick={resetAll} className="flex items-center gap-1 text-xs text-surface-muted hover:text-gray-700 transition-colors"><RotateCcw className="w-3 h-3" /> Reset</button>}
              </div>
              <FileUploader value={receipts} label="" hint="JPG, PNG, PDF · Max 5 · First image auto-filled by AI" maxFiles={5} onChange={setReceipts} onFilePicked={handleFilePicked} disabled={saving} />
              {previews.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {previews.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt={`Receipt ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-surface-border" />
                  ))}
                </div>
              )}
              {scanning && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-50 border border-brand-100 text-xs font-semibold text-brand-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> AI reading receipt…
                </div>
              )}
              {ocrSrc === 'gemma' && !scanning && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700">
                  <Sparkles className="w-3.5 h-3.5 flex-shrink-0" /> AI extracted details — review below
                </div>
              )}
              {ocrSrc === 'fallback' && !scanning && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> AI unavailable — fill manually
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="exp-title">Expense Title *</Label>
                <Input id="exp-title" name="title" value={form.title} placeholder="Site visit to Mumbai"
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={hl('title')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-reason">Purpose / Reason *</Label>
                <textarea id="exp-reason" value={form.reason} rows={2}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Explain why this expense was incurred…"
                  className={`flex w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none transition-colors ${hl('reason') || 'border-surface-border bg-white'}`} />
              </div>
              {mode === 'simple' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="exp-amount">Total Amount (₹) *</Label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                    <Input id="exp-amount" type="number" min="1" value={form.amount} placeholder="5000"
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={`pl-9 ${hl('amount')}`} />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Line Items *</Label>
                    <button type="button" onClick={() => setLineItems(l => [...l, EMPTY_LINE()])}
                      className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                      <Plus className="w-3.5 h-3.5" /> Add row
                    </button>
                  </div>
                  <div className="rounded-xl border border-surface-border overflow-hidden">
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] text-[10px] font-bold uppercase tracking-wide text-surface-muted bg-surface px-3 py-2 gap-2">
                      <span>Description</span><span>Category</span><span>Date</span><span>Amount</span><span>Receipt</span>
                    </div>
                    {lineItems.map((l, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 p-2 border-t border-surface-border items-center">
                        <Input value={l.description} onChange={e => updateLine(i,'description',e.target.value)} placeholder="e.g. Lunch" className="text-xs h-8" aria-label={`Line ${i+1} description`} />
                        <select aria-label={`Line ${i+1} category`} title={`Line ${i+1} category`} value={l.category} onChange={e => updateLine(i,'category',e.target.value)}
                          className="h-8 px-2 rounded-lg border border-surface-border text-xs focus:outline-none focus:border-brand-500 capitalize">
                          {LINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input type="date" aria-label={`Line ${i+1} date`} title={`Line ${i+1} date`} value={l.date} onChange={e => updateLine(i,'date',e.target.value)}
                          className="h-8 px-2 rounded-lg border border-surface-border text-xs focus:outline-none focus:border-brand-500" />
                        <div className="relative">
                          <IndianRupee className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-muted pointer-events-none" />
                          <Input type="number" min="0" value={l.amount || ''} onChange={e => updateLine(i,'amount',Number(e.target.value))} className="pl-5 text-xs h-8" aria-label={`Line ${i+1} amount`} />
                        </div>
                        <div className="flex items-center gap-1">
                          {l.receiptUrl ? (
                            <a href={l.receiptUrl} target="_blank" rel="noreferrer"
                              className="text-[9px] px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700">✓</a>
                          ) : (
                            <label className="cursor-pointer text-[9px] px-1.5 py-0.5 rounded bg-surface border border-surface-border text-surface-muted hover:border-brand-400 hover:text-brand-600 whitespace-nowrap">
                              {lineUploading === i ? '…' : '+ img'}
                              <input type="file" accept="image/*,application/pdf" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) uploadLineReceipt(i, f) }} />
                            </label>
                          )}
                          {lineItems.length > 1 && (
                            <button type="button" title="Remove row" aria-label="Remove row" onClick={() => setLineItems(ls => ls.filter((_,j) => j !== i))}
                              className="text-red-400 hover:text-red-600">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-end px-3 py-2 bg-surface border-t border-surface-border">
                      <span className="text-sm font-extrabold text-gray-900">Total: ₹{lineTotal.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>
              )}
              {/* Travel */}
              <div className="rounded-xl border border-surface-border bg-surface/50 p-3 space-y-3">
                <p className="text-[10px] font-semibold text-surface-muted flex items-center gap-1.5 uppercase tracking-wide"><MapPin className="w-3 h-3" /> Travel (optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label htmlFor="exp-from" className="text-xs">From</Label><Input id="exp-from" value={form.travelFrom} placeholder="Pune" onChange={e => setForm(f => ({ ...f, travelFrom: e.target.value }))} /></div>
                  <div className="space-y-1"><Label htmlFor="exp-to" className="text-xs">To</Label><Input id="exp-to" value={form.travelTo} placeholder="Mumbai" onChange={e => setForm(f => ({ ...f, travelTo: e.target.value }))} /></div>
                </div>
              </div>
              {/* Dates */}
              <div className="rounded-xl border border-surface-border bg-surface/50 p-3 space-y-3">
                <p className="text-[10px] font-semibold text-surface-muted flex items-center gap-1.5 uppercase tracking-wide"><Calendar className="w-3 h-3" /> Dates</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label htmlFor="exp-start" className="text-xs">Start *</Label><Input id="exp-start" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className={hl('startDate')} /></div>
                  <div className="space-y-1"><Label htmlFor="exp-end" className="text-xs">End</Label><Input id="exp-end" type="date" value={form.endDate} min={form.startDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={saving || scanning} className="flex-1 gap-2">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting…</> : <><Save className="w-4 h-4" />Submit Request</>}
                </Button>
                <Dialog.Close asChild><Button type="button" variant="outline">Cancel</Button></Dialog.Close>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ─── Expense Detail Sheet ─────────────────────────────────────────────────── */
function ExpenseDetailSheet({ expense, open, onClose, isManager, isBoss, onRevise, onAction }: {
  expense: Expense | null; open: boolean; onClose: () => void
  isManager: boolean; isBoss: boolean
  onRevise?: (expense: Expense) => void
  onAction: (id: string, status: string, note?: string, proof?: string) => void
}) {
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [acting,     setActing]     = useState(false)
  const [itemActing, setItemActing] = useState<number | null>(null)
  const [lineItems, setLineItems]   = useState<ExpenseLineItem[]>(expense?.lineItems || [])

  useEffect(() => { if (!open) { setShowReject(false); setRejectNote('') } }, [open])
  useEffect(() => { if (!open) return; setLineItems(expense?.lineItems || []) }, [open, expense?.lineItems])
  if (!expense) return null

  const s = STATUS_MAP[expense.status] || STATUS_MAP.rejected
  const SIcon = s.icon

  const STEPS = ['Submitted', 'Manager OK', 'Paid']
  const step  = s.pipeline

  const act = async (status: string, note?: string, proof?: string) => {
    setActing(true); await onAction(expense._id, status, note, proof); setActing(false); onClose()
  }

  const updateItemStatus = async (index: number, status: 'approved' | 'rejected') => {
    setItemActing(index)
    const res = await fetch(`/api/rms/${expense._id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [`lineItems.${index}.status`]: status }),
    })
    if (res.ok) {
      const updated = await res.json()
      setLineItems(updated.lineItems || lineItems.map((item, idx) => idx === index ? { ...item, status } : item))
    }
    setItemActing(null)
  }

  return (
    <Sheet open={open} onOpenChange={onClose} side="right">
      <SheetHeader title={expense.title} description={`₹${expense.amount.toLocaleString('en-IN')} · ${expense.userName}`} onClose={onClose} />
      <SheetBody>
        {/* Status */}
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ring-1 ${
          expense.status === 'paid' ? 'ring-green-200 bg-green-50' :
          expense.status === 'rejected' ? 'ring-red-200 bg-red-50' :
          'ring-yellow-200 bg-yellow-50'
        }`}>
          <SIcon className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-bold">{s.label}</span>
        </div>

        {/* Pipeline */}
        <div className="flex items-center gap-2">
          {STEPS.map((step_label, i) => {
            const done = step > i || expense.status === 'paid'
            return (
              <div key={step_label} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1 gap-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all
                    ${done ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-surface-border text-surface-muted'}`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <p className={`text-[10px] font-semibold text-center ${done ? 'text-gray-800' : 'text-surface-muted'}`}>{step_label}</p>
                </div>
                {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded ${step > i ? 'bg-brand-400' : 'bg-surface-border'}`} />}
              </div>
            )
          })}
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-surface border border-surface-border">
            <p className="text-[10px] font-bold uppercase tracking-wide text-surface-muted mb-0.5">Amount</p>
            <p className="text-lg font-extrabold text-gray-900">₹{expense.amount.toLocaleString('en-IN')}</p>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-surface-border">
            <p className="text-[10px] font-bold uppercase tracking-wide text-surface-muted mb-0.5">Date</p>
            <p className="text-sm font-semibold text-gray-900">{new Date(expense.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-surface-border">
          <p className="text-[10px] font-bold uppercase tracking-wide text-surface-muted mb-0.5">Reason</p>
          <p className="text-sm text-gray-900">{expense.reason}</p>
        </div>

        {/* Receipts */}
        {expense.receipts && expense.receipts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-surface-muted">Receipts</p>
            <div className="grid grid-cols-2 gap-2">
              {expense.receipts.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 p-3 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors text-xs font-semibold text-orange-700">
                  <FileText className="w-4 h-4 flex-shrink-0" /> Receipt {i + 1}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Line items table */}
        {expense.hasLineItems && expense.lineItems && expense.lineItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-surface-muted">Line Items</p>
            <div className="rounded-xl border border-surface-border overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] text-[9px] font-bold uppercase tracking-wide text-surface-muted bg-surface px-3 py-2 gap-2">
                <span>Description</span><span>Category</span><span>Date</span><span>Amount</span><span>Status</span>
              </div>
              {lineItems.map((l, i) => {
                const itemStatus = l.status || 'pending'
                return (
                  <div key={l._id || i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 px-3 py-2.5 border-t border-surface-border items-center">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{l.description}</p>
                      {l.receiptUrl && <a href={l.receiptUrl} target="_blank" rel="noreferrer" className="text-[9px] text-brand-600 hover:underline">Receipt</a>}
                    </div>
                    <span className="text-[10px] text-gray-600 capitalize">{l.category||'—'}</span>
                    <span className="text-[10px] text-gray-600">{l.date ? new Date(l.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '—'}</span>
                    <span className="text-xs font-bold text-gray-900">₹{l.amount.toLocaleString('en-IN')}</span>
                    <div className="flex items-center gap-1">
                      {itemStatus === 'approved' && <span className="text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0 rounded-full">OK</span>}
                      {itemStatus === 'rejected' && <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0 rounded-full">Rej</span>}
                      {itemStatus === 'pending' && <span className="text-[9px] text-surface-muted">Pending</span>}
                      {isManager && (
                        <div className="flex gap-0.5">
                          <button type="button" title="Approve item" aria-label="Approve item"
                            onClick={() => updateItemStatus(i, 'approved')}
                            disabled={itemActing === i || itemStatus === 'approved'}
                            className="p-0.5 rounded hover:bg-green-50 text-surface-muted hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-40">
                            {itemActing === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          </button>
                          <button type="button" title="Reject item" aria-label="Reject item"
                            onClick={() => updateItemStatus(i, 'rejected')}
                            disabled={itemActing === i || itemStatus === 'rejected'}
                            className="p-0.5 rounded hover:bg-red-50 text-surface-muted hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40">
                            {itemActing === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="flex justify-end px-3 py-2 bg-surface border-t border-surface-border">
                <span className="text-sm font-extrabold text-gray-900">
                  Total: ₹{expense.lineItems.reduce((s,l)=>s+(l.status!=='rejected'?l.amount:0),0).toLocaleString('en-IN')}
                  {expense.lineItems.some(l=>l.status==='rejected') && (
                    <span className="text-xs text-red-500 font-normal ml-2">
                      (₹{expense.lineItems.filter(l=>l.status==='rejected').reduce((s,l)=>s+l.amount,0).toLocaleString('en-IN')} rejected)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {(expense.managerNote || expense.bossNote) && (
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700">
            <span className="font-bold">Note: </span>{expense.managerNote || expense.bossNote}
          </div>
        )}


        {expense.status === 'returned' && !isManager && onRevise && (
          <div className="pt-4">
            <Button type="button" className="w-full gap-2" onClick={() => onRevise(expense)} disabled={acting}>
              <RotateCcw className="w-4 h-4" /> Revise Expense
            </Button>
          </div>
        )}

        {expense.createdAt && <p className="text-xs text-surface-muted">Submitted {timeAgo(expense.createdAt)}</p>}

        {/* Inline reject */}
        {showReject && (
          <div className="space-y-3 p-4 bg-red-50 rounded-xl border border-red-200">
            <p className="text-sm font-semibold text-red-800">Reason for rejection</p>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
              placeholder="Note for employee (optional)…"
              className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:border-red-400" />
            <div className="flex gap-2">
              <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700 gap-1.5"
                onClick={() => act('rejected', rejectNote)} disabled={acting}>
                {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Confirm Reject
              </Button>
              <button type="button" onClick={() => setShowReject(false)} className="text-xs text-surface-muted hover:text-gray-700">Cancel</button>
            </div>
          </div>
        )}
      </SheetBody>

      {isManager && !showReject && (
        (isManager && !isBoss && expense.status === 'pending_manager') ||
        (isBoss && expense.status === 'pending_boss')
      ) ? (
        <SheetFooter>
          <div className="space-y-2">
            <div className="flex gap-2">
              {isBoss ? (
                <div className="flex-1">
                  <PaymentProofDialog onConfirm={(proof, method, note) => act('paid', note, proof)} />
                </div>
              ) : (
                <Button className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700"
                  onClick={() => act('pending_boss')} disabled={acting}>
                  {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                </Button>
              )}
              <Button variant="outline" className="flex-1 gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowReject(true)}>
                <XCircle className="w-3.5 h-3.5" /> Reject
              </Button>
            </div>
            {/* Send-back row */}
            {isBoss && expense.status === 'pending_boss' && (
              <Button variant="outline" className="w-full gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
                onClick={() => act('pending_manager', 'Sent back for manager review')} disabled={acting}>
                <RotateCcw className="w-3.5 h-3.5" /> Send Back to Manager
              </Button>
            )}
            {!isBoss && expense.status === 'pending_manager' && (
              <Button variant="outline" className="w-full gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50"
                onClick={() => act('returned', 'Please revise and resubmit')} disabled={acting}>
                <RotateCcw className="w-3.5 h-3.5" /> Return to Employee
              </Button>
            )}
          </div>
        </SheetFooter>
      ) : null}
    </Sheet>
  )
}

const PAYMENT_METHODS = [
  { value: 'cash',             label: 'Cash' },
  { value: 'card',             label: 'Debit / Credit Card' },
  { value: 'upi',              label: 'UPI / NEFT / IMPS' },
  { value: 'bank_transfer',    label: 'Bank Transfer' },
  { value: 'advance_adjusted', label: 'Adjusted from Advance' },
  { value: 'na',               label: 'N/A' },
]

function PaymentProofDialog({ onConfirm }: { onConfirm: (proofUrl: string, method: string, note: string) => void }) {
  const [open,    setOpen]    = useState(false)
  const [proof,   setProof]   = useState<string[]>([])
  const [method,  setMethod]  = useState('bank_transfer')
  const [note,    setNote]    = useState('')
  const [saving,  setSaving]  = useState(false)

  const confirm = () => {
    setSaving(true)
    onConfirm(proof[0] || '', method, note)
    setProof([]); setNote(''); setOpen(false); setSaving(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700">Mark Paid</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
          <Dialog.Title className="text-base font-bold text-gray-900">Confirm Payment</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted -mt-2">Record how payment was made.</Dialog.Description>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-surface-muted" htmlFor="pay-method">Payment Method</label>
            <select id="pay-method" aria-label="Payment method" title="Payment method" value={method} onChange={e => setMethod(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-surface-muted" htmlFor="pay-note">Reference / Note <span className="font-normal normal-case">(optional)</span></label>
            <input id="pay-note" value={note} onChange={e => setNote(e.target.value)} placeholder="UTR number, transaction ID…"
              className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
          </div>

          {method !== 'cash' && method !== 'na' && (
            <FileUploader
              label="Payment Proof (optional)"
              hint="Bank screenshot or receipt"
              maxFiles={1}
              onChange={setProof}
            />
          )}

          <div className="flex gap-3 justify-end pt-1">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700 gap-2" onClick={confirm} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
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
  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'
  const isBoss    = role === 'boss'

  const [expenses,     setExpenses]     = useState<Expense[]>([])
  const [filter,       setFilter]       = useUrlState('status', 'all')
  const [loading,      setLoading]      = useState(true)
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [showFilters,  setShowFilters]  = useState(false)
  const [viewMode,     setViewMode]     = useState<'card' | 'table'>('card')
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [bulking,      setBulking]      = useState(false)
  const [sheetExp,     setSheetExp]     = useState<Expense | null>(null)
  const [sheetOpen,    setSheetOpen]    = useState(false)
  const [editExpense,  setEditExpense]  = useState<Expense | null>(null)

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
  useAutoRefresh(fetchExpenses)

  const handleAction = async (id: string, status: string, note?: string, paymentProof?: string, paymentMethod?: string) => {
    const body: Record<string, string> = { status }
    if (note) body[isManager && !isBoss ? 'managerNote' : 'bossNote'] = note
    if (status === 'paid') {
      body.paidBy = user?.id || ''
      if (paymentProof)  body.paymentProof  = paymentProof
      if (paymentMethod) body.paymentMethod = paymentMethod
    }

    try {
      const res = await fetch(`/api/rms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        toast(`Action failed: ${text || 'Unable to update status'}`, 'error')
        return
      }
      const labels: Record<string, string> = {
        pending_boss:    'Expense approved — sent to boss',
        pending_manager: 'Sent back to manager for review',
        returned:        'Returned to employee for revision',
        paid:            'Marked as paid',
        rejected:        'Expense rejected',
      }
      toast(labels[status] || 'Updated', ['rejected','returned','pending_manager'].includes(status) ? 'info' : 'success')
      await fetchExpenses()
    } catch {
      toast('Action failed — please try again', 'error')
    }
  }

  const totalPending = expenses.filter(e => e.status === 'pending_manager' || e.status === 'pending_boss')
    .reduce((s, e) => s + e.amount, 0)

  const bulkPendingExpenses = expenses.filter(e =>
    (isManager && !isBoss && e.status === 'pending_manager') ||
    (isBoss && e.status === 'pending_boss')
  )
  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleSelectAll = () => {
    if (selected.size === bulkPendingExpenses.length) setSelected(new Set())
    else setSelected(new Set(bulkPendingExpenses.map(e => e._id)))
  }
  const bulkAction = async (status: string) => {
    if (!selected.size) return
    setBulking(true)
    await Promise.all(Array.from(selected).map(id =>
      fetch(`/api/rms/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    ))
    toast(`${selected.size} expense${selected.size > 1 ? 's' : ''} ${status === 'rejected' ? 'rejected' : 'approved'}`, status === 'rejected' ? 'error' : 'success')
    setSelected(new Set())
    setBulking(false)
    fetchExpenses()
  }

  const handleRevise = (expense: Expense) => {
    setEditExpense(expense)
    setSheetOpen(false)
  }

  return (
    <>
      <Header title="Reimbursements" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

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
            {['all', 'pending_manager', 'pending_boss', 'paid', 'rejected', 'returned'].map(s => (
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
            <NewExpenseDialog onCreated={fetchExpenses} trigger={<Button className="gap-2" data-new-expense><Plus className="w-4 h-4" /> Log Expense</Button>} />
            <NewExpenseDialog
              onCreated={() => { setEditExpense(null); fetchExpenses() }}
              editExpense={editExpense}
              open={Boolean(editExpense)}
              onOpenChange={open => { if (!open) setEditExpense(null) }}
            />
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

        {/* Bulk action bar */}
        {isManager && bulkPendingExpenses.length > 0 && (
          <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-xl flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-orange-700">
              <input type="checkbox" aria-label="Select all pending expenses"
                checked={selected.size === bulkPendingExpenses.length && bulkPendingExpenses.length > 0}
                onChange={toggleSelectAll}
                className="accent-orange-500 w-3.5 h-3.5"
              />
              Select all actionable ({bulkPendingExpenses.length})
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-xs text-orange-600">{selected.size} selected</span>
                <Button type="button" size="sm" disabled={bulking}
                  onClick={() => bulkAction(isBoss ? 'paid' : 'pending_boss')}
                  className="gap-1.5 bg-green-600 hover:bg-green-700 text-white">
                  {bulking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Approve Selected
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={bulking}
                  onClick={() => bulkAction('rejected')}
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
                  {bulking ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                  Reject Selected
                </Button>
              </>
            )}
          </div>
        )}

        {/* List */}
        {loading ? (
          <ListSkeleton rows={4} />
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expense requests"
            description="Log a travel expense, client lunch, or any reimbursable spend. Upload receipts and we'll OCR the details."
            action={{ label: 'Log Expense', onClick: () => document.querySelector<HTMLButtonElement>('[data-new-expense]')?.click(), icon: Plus }}
          />
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
                                <Button type="button" size="sm" variant="outline" className="text-orange-600 border-orange-200 hover:bg-orange-50 gap-1" onClick={() => handleAction(exp._id, 'returned', 'Please revise and resubmit')}><RotateCcw className="w-3 h-3" />Return</Button>
                                <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                              </>
                            )}
                            {isBoss && exp.status === 'pending_boss' && (
                              <>
                                <PaymentProofDialog onConfirm={(proof, method, note) => handleAction(exp._id, 'paid', note, proof, method)} />
                                <Button type="button" size="sm" variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50 gap-1" onClick={() => handleAction(exp._id, 'pending_manager', 'Sent back for manager review')}><RotateCcw className="w-3 h-3" />Send Back</Button>
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
                <div key={exp._id} className="block">
                <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setSheetExp(exp); setSheetOpen(true) }}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {isManager && bulkPendingExpenses.some(e => e._id === exp._id) && (
                        <div className="flex-shrink-0 pt-1" onClick={e2 => { e2.stopPropagation(); toggleSelect(exp._id) }}>
                          <input type="checkbox" aria-label={`Select expense ${exp.title}`}
                            className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                            checked={selected.has(exp._id)} onChange={() => {}} />
                        </div>
                      )}
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

                      {/* Actions — stop propagation so card click doesn't open sheet */}
                      <div className="flex flex-col gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        {isManager && !isBoss && exp.status === 'pending_manager' && (
                          <>
                            <Button type="button" size="sm" onClick={() => handleAction(exp._id, 'pending_boss')}>Approve</Button>
                            <Button type="button" size="sm" variant="outline" className="text-orange-600 border-orange-200 hover:bg-orange-50 gap-1 text-[11px]"
                              onClick={() => handleAction(exp._id, 'returned', 'Please revise and resubmit')}>
                              <RotateCcw className="w-3 h-3" />Return
                            </Button>
                            <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                          </>
                        )}
                        {isBoss && exp.status === 'pending_boss' && (
                          <>
                            <PaymentProofDialog onConfirm={(proof, method, note) => handleAction(exp._id, 'paid', note, proof, method)} />
                            <Button type="button" size="sm" variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50 gap-1 text-[11px]"
                              onClick={() => handleAction(exp._id, 'pending_manager', 'Sent back for manager review')}>
                              <RotateCcw className="w-3 h-3" />Send Back
                            </Button>
                            <RejectDialog onConfirm={n => handleAction(exp._id, 'rejected', n)} />
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <ExpenseDetailSheet
        expense={sheetExp}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        isManager={isManager}
        isBoss={isBoss}
        onRevise={handleRevise}
        onAction={async (id, status, note, proof) => { await handleAction(id, status, note, proof) }}
      />
    </>
  )
}
