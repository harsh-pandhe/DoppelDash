'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, ScanLine, AlertCircle, CheckCircle2, Upload, RotateCcw, Sparkles, ImagePlus } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/components/ui/toast'

const FIELDS = [
  { id: 'name',        label: 'Full Name *',  placeholder: 'Praphulla Sharma' },
  { id: 'email',       label: 'Email',        placeholder: 'praphulla@company.com' },
  { id: 'phone',       label: 'Phone',        placeholder: '+91 98765 43210' },
  { id: 'company',     label: 'Company',      placeholder: 'Doppelmayr India Pvt Ltd' },
  { id: 'designation', label: 'Designation',  placeholder: 'Director, Operations' },
  { id: 'website',     label: 'Website',      placeholder: 'www.doppelmayr.com' },
  { id: 'linkedin',    label: 'LinkedIn',     placeholder: 'linkedin.com/in/username' },
  { id: 'address',     label: 'Address',      placeholder: 'Mumbai, Maharashtra' },
]

function compressImage(file: File, maxKB = 500): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const MAX = 1200
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      let quality = 0.9
      const tryCompress = () => {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const bytes   = (dataUrl.length * 3) / 4
        if (bytes <= maxKB * 1024 || quality <= 0.4) resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
        else { quality -= 0.1; tryCompress() }
      }
      tryCompress()
    }
    img.onerror = reject; img.src = url
  })
}

export default function ScanCardPage() {
  const router   = useRouter()
  const toast    = useToast()

  const [step,         setStep]         = useState<'pick' | 'preview' | 'form'>('pick')
  const [, setScanning] = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [imagePreview, setImagePreview] = useState('')
  const [ocrSource,    setOcrSource]    = useState<'gemma' | 'fallback' | null>(null)
  const [existingId,   setExistingId]   = useState<string | null>(null)
  const [dragging,     setDragging]     = useState(false)
  const [error,        setError]        = useState('')
  const [form, setForm] = useState<Record<string, string>>({
    name: '', email: '', phone: '', company: '', designation: '', website: '', linkedin: '', address: '',
  })

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file (JPG/PNG).'); return }
    setError('')
    const { base64, mimeType } = await compressImage(file)
    setImagePreview(`data:${mimeType};base64,${base64}`)
    runOCR(base64, mimeType)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
    e.target.value = ''
  }

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }

  const runOCR = async (base64: string, mimeType: string) => {
    setScanning(true); setStep('preview')
    try {
      const res  = await fetch('/api/crm/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mimeType }) })
      if (!res.ok) throw new Error()
      const data   = await res.json()
      const parsed = data.parsed as Record<string, string | null>
      const updated = { ...form }
      for (const key of Object.keys(updated)) { if (parsed[key]) updated[key] = parsed[key] as string }
      setForm(updated); setOcrSource(data.source); setExistingId(data.existingId || null); setStep('form')
    } catch { setError('AI extraction failed — fill in manually.'); setStep('form') }
    finally { setScanning(false) }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      if (existingId) {
        await fetch(`/api/crm/${existingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
        toast('Contact updated — duplicate merged', 'info'); router.push(`/crm/${existingId}`)
      } else {
        await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
        toast('Contact saved from scan', 'success'); router.push('/crm')
      }
    } catch { setError('Failed to save contact.') }
    finally { setSaving(false) }
  }

  const reset = () => {
    setStep('pick'); setImagePreview(''); setOcrSource(null); setExistingId(null); setError('')
    setForm({ name: '', email: '', phone: '', company: '', designation: '', website: '', linkedin: '', address: '' })
  }

  const STEPS = ['Upload', 'Processing', 'Review']
  const stepIdx = step === 'pick' ? 0 : step === 'preview' ? 1 : 2

  return (
    <>
      <Header title="Scan Business Card" />
      <main className="flex-1 p-5 max-w-xl mx-auto w-full space-y-5">

        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* Hero header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <ScanLine className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold">Scan Business Card</h2>
              <p className="text-brand-200 text-sm mt-0.5">Gemma AI extracts all contact details automatically.</p>
            </div>
          </div>

          {/* Step progress */}
          <div className="relative z-10 flex items-center gap-2 mt-5">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-all
                  ${i === stepIdx ? 'bg-white text-brand-700' : i < stepIdx ? 'bg-white/30 text-white' : 'bg-white/10 text-white/50'}`}>
                  {i < stepIdx ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[9px]">{i + 1}</span>}
                  {s}
                </div>
                {i < STEPS.length - 1 && <div className="w-4 h-px bg-white/20" />}
              </div>
            ))}
          </div>
        </div>

        {/* ── Step 1: Upload card ─────────────────── */}
        {step === 'pick' && (
          <div className="space-y-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <label
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`group flex flex-col items-center gap-4 p-10 rounded-2xl border-2 border-dashed transition-all text-center cursor-pointer
                ${dragging
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-surface-border bg-white hover:border-brand-400 hover:bg-brand-50/40'}`}>
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#003B73] to-[#0057A8] flex items-center justify-center group-hover:scale-105 transition-transform shadow-md shadow-[#0057A8]/25">
                <ImagePlus className="w-8 h-8 text-white" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-base">Drop a business card here</p>
                <p className="text-xs text-surface-muted mt-1">or click to pick from gallery · JPG / PNG / HEIC up to ~5 MB</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 px-3 py-1 rounded-full">
                <Upload className="w-3.5 h-3.5" /> Choose image
              </span>
              <input type="file" accept="image/*" className="hidden"
                aria-label="Upload business card image" onChange={handleFileUpload} />
            </label>

            {/* Feature hint */}
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-surface border border-surface-border">
              <Sparkles className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-900">Gemma AI</span> reads the card and auto-fills name, email, phone, company, and designation. Review the extracted values before saving.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 2: Processing ──────────────────── */}
        {step === 'preview' && (
          <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
            {imagePreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagePreview} alt="Card" className="w-full max-h-52 object-contain bg-surface border-b border-surface-border" />
            )}
            <div className="p-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-sm">Gemma AI is reading the card…</p>
                <p className="text-xs text-surface-muted mt-0.5">Extracting name, email, phone, company…</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Review form ─────────────────── */}
        {step === 'form' && (
          <div className="space-y-4">

            {/* Card thumbnail */}
            {imagePreview && (
              <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Card" className="w-full max-h-36 object-contain bg-surface" />
              </div>
            )}

            {/* OCR status */}
            {ocrSource === 'gemma' && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-emerald-700">Gemma AI extracted the details — review and confirm below</p>
              </div>
            )}
            {ocrSource === 'fallback' && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                <div className="w-8 h-8 rounded-xl bg-amber-400 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-amber-700">AI unavailable — please fill in the details manually</p>
              </div>
            )}
            {existingId && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
                <div className="w-8 h-8 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-blue-700">Matching contact found — saving will update that record</p>
              </div>
            )}
            {!existingId && ocrSource === 'gemma' && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-brand-50 border border-brand-200">
                <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-brand-700">No duplicate found — this will be a new contact</p>
              </div>
            )}

            {/* Form */}
            <div className="bg-white rounded-2xl border border-surface-border p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-4">Review Details</p>
              {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
              <form onSubmit={handleSave} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {FIELDS.map(f => (
                    <div key={f.id} className={`space-y-1.5 ${f.id === 'address' ? 'col-span-2' : ''}`}>
                      <Label htmlFor={f.id} className="text-xs">{f.label}</Label>
                      <Input
                        id={f.id} name={f.id}
                        value={form[f.id]} onChange={handleChange}
                        placeholder={f.placeholder}
                        className={form[f.id] ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-400' : ''}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={saving} className="gap-2 flex-1 bg-gradient-to-r from-brand-500 to-brand-600">
                    {saving
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : <><Save className="w-4 h-4" /> {existingId ? 'Update Contact' : 'Create Contact'}</>
                    }
                  </Button>
                  <Button type="button" variant="outline" onClick={reset} className="gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" /> Rescan
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

      </main>
    </>
  )
}
