'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, ScanLine, AlertCircle, CheckCircle2, Camera, Upload, RotateCcw, Sparkles, XCircle } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
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
        width = Math.round(width * ratio); height = Math.round(height * ratio)
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

const EMPTY_FORM = { name: '', email: '', phone: '', company: '', designation: '', address: '' }

export default function ScanCardDialog() {
  const router    = useRouter()
  const toast     = useToast()
  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [open,         setOpen]         = useState(false)
  const [step,         setStep]         = useState<'pick' | 'preview' | 'form'>('pick')
  const [, setScanning] = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [imagePreview, setImagePreview] = useState('')
  const [ocrSource,    setOcrSource]    = useState<'gemma' | 'fallback' | null>(null)
  const [existingId,   setExistingId]   = useState<string | null>(null)
  const [cameraOn,     setCameraOn]     = useState(false)
  const [error,        setError]        = useState('')
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null; setCameraOn(false)
  }, [])

  const reset = useCallback(() => {
    stopCamera(); setStep('pick'); setImagePreview(''); setOcrSource(null)
    setExistingId(null); setError(''); setForm(EMPTY_FORM)
  }, [stopCamera])

  const handleClose = (o: boolean) => {
    if (!o) { reset() }
    setOpen(o)
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraOn(true); setError('')
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Camera permission denied. Click the camera icon in the address bar and select "Allow".'
        : 'Camera unavailable. Use "Upload Image" instead.'
      setError(msg)
    }
  }

  const captureFromCamera = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    stopCamera(); setImagePreview(dataUrl)
    runOCR(dataUrl.split(',')[1], 'image/jpeg')
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    const { base64, mimeType } = await compressImage(file)
    setImagePreview(`data:${mimeType};base64,${base64}`)
    runOCR(base64, mimeType)
  }

  const runOCR = async (base64: string, mimeType: string) => {
    setScanning(true); setStep('preview')
    try {
      const res  = await fetch('/api/crm/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mimeType }) })
      if (!res.ok) throw new Error()
      const data   = await res.json()
      const parsed = data.parsed as Record<string, string | null>
      const updated: Record<string, string> = { ...EMPTY_FORM }
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
        toast('Contact updated — duplicate merged', 'info')
        setOpen(false); router.push(`/crm/${existingId}`)
      } else {
        await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
        toast('Contact saved from scan', 'success')
        setOpen(false); router.push('/crm')
      }
    } catch { setError('Failed to save contact.') }
    finally { setSaving(false) }
  }

  const STEPS = ['Upload', 'Processing', 'Review']
  const stepIdx = step === 'pick' ? 0 : step === 'preview' ? 1 : 2

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Trigger asChild>
        <button type="button"
          className="flex items-center gap-3 p-3 rounded-xl border border-surface-border hover:border-brand-200 hover:bg-brand-50 transition-all group w-full text-left">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
            <ScanLine className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-700 group-hover:text-brand-700 flex-1">Scan Business Card</span>
          <span className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">AI</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

          {/* Header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-5 rounded-t-2xl">
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
            <div className="relative z-10 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <ScanLine className="w-5 h-5 text-white" />
                </div>
                <div>
                  <Dialog.Title className="text-base font-extrabold text-white">Scan Business Card</Dialog.Title>
                  <Dialog.Description className="text-brand-200 text-xs mt-0.5">Gemma AI extracts contact details automatically.</Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <button type="button" aria-label="Close" className="p-1 text-white/60 hover:text-white transition-colors mt-0.5">
                  <XCircle className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Step progress */}
            <div className="relative z-10 flex items-center gap-2 mt-4">
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

          <div className="p-5 space-y-4">

            {/* Step 1: Pick */}
            {step === 'pick' && (
              <>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                {!cameraOn ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={startCamera}
                      className="group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-surface-border bg-white hover:border-brand-400 hover:bg-brand-50 transition-all text-center">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Camera className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-sm">Use Camera</p>
                        <p className="text-xs text-surface-muted">Live scan</p>
                      </div>
                    </button>
                    <label className="group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-surface-border bg-white hover:border-purple-400 hover:bg-purple-50 transition-all text-center cursor-pointer">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Upload className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-sm">Upload Image</p>
                        <p className="text-xs text-surface-muted">From gallery</p>
                      </div>
                      <input type="file" accept="image/*" className="hidden" aria-label="Upload business card image" onChange={handleFileUpload} />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-2xl overflow-hidden border-2 border-brand-400 bg-black">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-52 object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="border-2 border-white/60 rounded-xl w-4/5 h-3/5 flex items-center justify-center">
                          <p className="text-white/60 text-xs font-medium bg-black/30 px-2 py-1 rounded-lg">Align card within frame</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button type="button" className="flex-1 gap-2 bg-gradient-to-r from-brand-500 to-brand-600" onClick={captureFromCamera}>
                        <Camera className="w-4 h-4" /> Capture
                      </Button>
                      <Button type="button" variant="outline" onClick={stopCamera}>Cancel</Button>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface border border-surface-border">
                  <Sparkles className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-600"><span className="font-semibold text-gray-900">Gemma AI</span> reads the card and auto-fills all contact details. Review before saving.</p>
                </div>
              </>
            )}

            {/* Step 2: Processing */}
            {step === 'preview' && (
              <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
                {imagePreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagePreview} alt="Card" className="w-full max-h-40 object-contain bg-surface border-b border-surface-border" />
                )}
                <div className="p-5 flex items-center gap-4">
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

            {/* Step 3: Review form */}
            {step === 'form' && (
              <>
                {imagePreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagePreview} alt="Card" className="w-full max-h-28 object-contain bg-surface rounded-xl border border-surface-border" />
                )}
                {ocrSource === 'gemma' && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0"><Sparkles className="w-3.5 h-3.5 text-white" /></div>
                    <p className="text-xs font-semibold text-emerald-700">AI extracted details — review below</p>
                  </div>
                )}
                {ocrSource === 'fallback' && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <div className="w-7 h-7 rounded-lg bg-amber-400 flex items-center justify-center flex-shrink-0"><AlertCircle className="w-3.5 h-3.5 text-white" /></div>
                    <p className="text-xs font-semibold text-amber-700">AI unavailable — fill in manually</p>
                  </div>
                )}
                {existingId && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0"><AlertCircle className="w-3.5 h-3.5 text-white" /></div>
                    <p className="text-xs font-semibold text-blue-700">Duplicate found — will update existing contact</p>
                  </div>
                )}

                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

                <form onSubmit={handleSave} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {FIELDS.map(f => (
                      <div key={f.id} className={`space-y-1.5 ${f.id === 'address' ? 'col-span-2' : ''}`}>
                        <Label htmlFor={`scan-${f.id}`} className="text-xs">{f.label}</Label>
                        <Input id={`scan-${f.id}`} name={f.id} value={form[f.id]} onChange={handleChange}
                          placeholder={f.placeholder}
                          className={form[f.id] ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-400' : ''} />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-1">
                    <Button type="submit" disabled={saving} className="gap-2 flex-1 bg-gradient-to-r from-brand-500 to-brand-600">
                      {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> {existingId ? 'Update Contact' : 'Create Contact'}</>}
                    </Button>
                    <Button type="button" variant="outline" onClick={reset} className="gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" /> Rescan
                    </Button>
                  </div>
                </form>
              </>
            )}

          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
