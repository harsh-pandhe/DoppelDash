'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, IndianRupee, ScanLine, Sparkles, AlertCircle, RotateCcw, Upload, MapPin, Calendar } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import FileUploader from '@/components/ui/file-uploader'

function compressImage(file: File, maxKB = 600): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const MAX = 1400
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width  = Math.round(width  * ratio)
        height = Math.round(height * ratio)
      }
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      let quality = 0.92
      const tryCompress = () => {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        if ((dataUrl.length * 3) / 4 <= maxKB * 1024 || quality <= 0.4) {
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
        } else { quality -= 0.1; tryCompress() }
      }
      tryCompress()
    }
    img.onerror = reject; img.src = url
  })
}

const EMPTY_FORM = { title: '', reason: '', amount: '', travelFrom: '', travelTo: '', startDate: '', endDate: '' }

export default function NewExpensePage() {
  const router = useRouter()
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [receipts,     setReceipts]     = useState<string[]>([])
  const [receiptPreviews, setReceiptPreviews] = useState<string[]>([])
  const [scanning,     setScanning]     = useState(false)
  const [ocrSource,    setOcrSource]    = useState<'gemma' | 'fallback' | null>(null)
  const [ocrFields,    setOcrFields]    = useState<Set<string>>(new Set())
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleReceiptChange = useCallback((urls: string[]) => {
    setReceipts(urls)
  }, [])

  const handleFilePicked = useCallback(async (files: File[]) => {
    // Show local previews immediately
    setReceiptPreviews(prev => [
      ...prev,
      ...files.filter(f => f.type.startsWith('image/')).map(f => URL.createObjectURL(f)),
    ])

    // OCR the first image if form not yet filled
    const firstImage = files.find(f => f.type.startsWith('image/'))
    if (!firstImage || form.title || form.amount) return

    setScanning(true)
    try {
      const { base64 } = await compressImage(firstImage)
      const res = await fetch('/api/rms/ocr', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      })
      if (!res.ok) throw new Error('OCR failed')
      const data = await res.json()
      const p    = data.parsed as Record<string, string | number | null>
      const filled = new Set<string>()
      setForm(f => {
        const next = { ...f }
        if (p.title       && !f.title)     { next.title     = String(p.title);                filled.add('title')     }
        if (p.description && !f.reason)    { next.reason    = String(p.description);          filled.add('reason')    }
        if (p.amount      && !f.amount)    { next.amount    = String(p.amount);               filled.add('amount')    }
        if (p.date        && !f.startDate) { next.startDate = String(p.date).slice(0, 10);    filled.add('startDate') }
        return next
      })
      setOcrFields(filled)
      setOcrSource(data.source)
    } catch {
      setOcrSource('fallback')
    } finally {
      setScanning(false)
    }
  }, [form.title, form.amount])

  const resetOcr = () => {
    setForm(EMPTY_FORM)
    setReceipts([])
    setReceiptPreviews([])
    setOcrSource(null)
    setOcrFields(new Set())
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.reason || !form.amount || !form.startDate) { setError('Fill all required fields.'); return }
    if (isNaN(Number(form.amount)) || Number(form.amount) <= 0)          { setError('Amount must be a positive number.'); return }
    if (receipts.length === 0) { setError('Upload at least one receipt or bill.'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/rms', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, amount: Number(form.amount), receipts }),
      })
      if (!res.ok) throw new Error()
      router.push('/rms')
    } catch {
      setError('Failed to submit expense request.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Header title="Log Expense" />
      <main className="flex-1 p-6 max-w-xl animate-fade-in">
        <Link href="/rms" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Reimbursements
        </Link>

        <div className="space-y-4">
          {/* Step 1 — Upload bills */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-brand-500" /> Bills &amp; Receipts
              </CardTitle>
              <p className="text-xs text-surface-muted mt-0.5">Upload your receipt — AI will auto-fill the form below.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <FileUploader
                label=""
                hint="JPG, PNG, PDF · Max 5 files · First image auto-filled by AI"
                maxFiles={5}
                onChange={handleReceiptChange}
                onFilePicked={handleFilePicked}
                disabled={submitting}
              />

              {/* Receipt image previews */}
              {receiptPreviews.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {receiptPreviews.map((src, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={i} src={src} alt={`Receipt ${i + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border border-surface-border shadow-sm" />
                  ))}
                </div>
              )}

              {/* OCR status */}
              {scanning && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-brand-50 border border-brand-100">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-brand-700">AI is reading your receipt…</p>
                </div>
              )}
              {ocrSource === 'gemma' && !scanning && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <Sparkles className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <p className="text-xs font-semibold text-emerald-700">AI extracted details — review and edit below</p>
                </div>
              )}
              {ocrSource === 'fallback' && !scanning && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <p className="text-xs font-semibold text-amber-700">AI unavailable — fill in details manually</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2 — Form */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Expense Details</CardTitle>
                {ocrSource && (
                  <button type="button" onClick={resetOcr}
                    className="flex items-center gap-1 text-xs text-surface-muted hover:text-gray-700 transition-colors">
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
              <form onSubmit={handleSubmit} className="space-y-4">

                <div className="space-y-1.5">
                  <Label htmlFor="title">Expense Title *</Label>
                  <Input id="title" name="title" value={form.title} onChange={handleChange}
                    placeholder="Site visit to Mumbai"
                    className={ocrFields.has('title') ? 'border-emerald-300 bg-emerald-50/40' : ''} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reason">Purpose / Reason *</Label>
                  <textarea id="reason" name="reason" value={form.reason} onChange={handleChange} rows={2}
                    placeholder="Explain why this expense was incurred…"
                    className={`flex w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none transition-colors
                      ${ocrFields.has('reason') ? 'border-emerald-300 bg-emerald-50/40' : 'border-surface-border bg-white'}`} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="amount">Total Amount (₹) *</Label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                    <Input id="amount" name="amount" type="number" min="1" value={form.amount} onChange={handleChange}
                      className={`pl-9 ${ocrFields.has('amount') ? 'border-emerald-300 bg-emerald-50/40' : ''}`}
                      placeholder="5000" />
                  </div>
                </div>

                {/* Travel section */}
                <div className="rounded-xl border border-surface-border bg-surface/50 p-3 space-y-3">
                  <p className="text-xs font-semibold text-surface-muted flex items-center gap-1.5 uppercase tracking-wide">
                    <MapPin className="w-3 h-3" /> Travel Details (optional)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="travelFrom" className="text-xs">From</Label>
                      <Input id="travelFrom" name="travelFrom" value={form.travelFrom} onChange={handleChange} placeholder="Pune" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="travelTo" className="text-xs">To</Label>
                      <Input id="travelTo" name="travelTo" value={form.travelTo} onChange={handleChange} placeholder="Mumbai" />
                    </div>
                  </div>
                </div>

                {/* Dates section */}
                <div className="rounded-xl border border-surface-border bg-surface/50 p-3 space-y-3">
                  <p className="text-xs font-semibold text-surface-muted flex items-center gap-1.5 uppercase tracking-wide">
                    <Calendar className="w-3 h-3" /> Dates
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="startDate" className="text-xs">Start Date *</Label>
                      <Input id="startDate" name="startDate" type="date" value={form.startDate} onChange={handleChange}
                        className={ocrFields.has('startDate') ? 'border-emerald-300 bg-emerald-50/40' : ''} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="endDate" className="text-xs">End Date</Label>
                      <Input id="endDate" name="endDate" type="date" value={form.endDate} onChange={handleChange} min={form.startDate} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <Button type="submit" disabled={submitting || scanning} className="gap-2 flex-1">
                    {submitting
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                      : <><Save className="w-4 h-4" /> Submit Request</>}
                  </Button>
                  <Link href="/rms"><Button type="button" variant="outline">Cancel</Button></Link>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
