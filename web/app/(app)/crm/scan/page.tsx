'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, ScanLine, AlertCircle, CheckCircle2, Camera, Upload, RotateCcw, Sparkles } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/components/ui/toast'

const FIELDS = [
  { id: 'name',        label: 'Full Name *',    placeholder: 'Praphulla Sharma' },
  { id: 'email',       label: 'Email',          placeholder: 'praphulla@company.com' },
  { id: 'phone',       label: 'Phone',          placeholder: '+91 98765 43210' },
  { id: 'company',     label: 'Company',        placeholder: 'Doppelmayr India Pvt Ltd' },
  { id: 'designation', label: 'Designation',    placeholder: 'Director, Operations' },
  { id: 'website',     label: 'Website',        placeholder: 'www.doppelmayr.com' },
  { id: 'linkedin',    label: 'LinkedIn',       placeholder: 'linkedin.com/in/username' },
  { id: 'address',     label: 'Address',        placeholder: 'Mumbai, Maharashtra' },
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
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      let quality = 0.9
      const tryCompress = () => {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const bytes   = (dataUrl.length * 3) / 4
        if (bytes <= maxKB * 1024 || quality <= 0.4) {
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
        } else {
          quality -= 0.1
          tryCompress()
        }
      }
      tryCompress()
    }
    img.onerror = reject
    img.src = url
  })
}

export default function ScanCardPage() {
  const router  = useRouter()
  const toast   = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step,       setStep]       = useState<'pick' | 'preview' | 'form'>('pick')
  const [scanning,   setScanning]   = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [imagePreview, setImagePreview] = useState('')
  const [ocrSource,  setOcrSource]  = useState<'gemma' | 'fallback' | null>(null)
  const [existingId, setExistingId] = useState<string | null>(null)
  const [cameraOn,   setCameraOn]   = useState(false)
  const [error,      setError]      = useState('')
  const [form, setForm] = useState<Record<string, string>>({
    name: '', email: '', phone: '', company: '', designation: '', website: '', linkedin: '', address: '',
  })

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraOn(true)
      setError('')
    } catch {
      setError('Camera permission denied. Use "Upload Image" instead.')
    }
  }

  const captureFromCamera = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    stopCamera()
    setImagePreview(dataUrl)
    const base64 = dataUrl.split(',')[1]
    runOCR(base64, 'image/jpeg')
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
    setScanning(true)
    setStep('preview')
    try {
      const res  = await fetch('/api/crm/ocr', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mimeType }),
      })
      if (!res.ok) throw new Error('OCR failed')
      const data = await res.json()

      // Merge parsed fields, filter nulls
      const parsed = data.parsed as Record<string, string | null>
      const updated = { ...form }
      for (const key of Object.keys(updated)) {
        if (parsed[key]) updated[key] = parsed[key] as string
      }
      setForm(updated)
      setOcrSource(data.source)
      setExistingId(data.existingId || null)
      setStep('form')
    } catch {
      setError('AI extraction failed — fill in manually.')
      setStep('form')
    } finally {
      setScanning(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      if (existingId) {
        await fetch(`/api/crm/${existingId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(form),
        })
        toast('Contact updated — duplicate merged', 'info')
        router.push(`/crm/${existingId}`)
      } else {
        await fetch('/api/crm', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(form),
        })
        toast('Contact saved from scan', 'success')
        router.push('/crm')
      }
    } catch {
      setError('Failed to save contact.')
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    stopCamera()
    setStep('pick')
    setImagePreview('')
    setOcrSource(null)
    setExistingId(null)
    setError('')
    setForm({ name: '', email: '', phone: '', company: '', designation: '', website: '', linkedin: '', address: '' })
  }

  return (
    <>
      <Header title="Scan Business Card" />
      <main className="flex-1 p-6 max-w-xl animate-fade-in">
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* Step 1 — Pick method */}
        {step === 'pick' && (
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center gap-5 text-center">
                <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center">
                  <ScanLine className="w-8 h-8 text-brand-500" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-lg">Scan Business Card</p>
                  <p className="text-sm text-surface-muted mt-1 max-w-xs">
                    Gemma AI reads the card and extracts all contact details automatically.
                  </p>
                </div>

                {error && (
                  <Alert variant="destructive" className="w-full text-left">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-3 w-full">
                  <Button type="button" className="flex-1 gap-2" onClick={startCamera}>
                    <Camera className="w-4 h-4" /> Use Camera
                  </Button>
                  <label className="flex-1">
                    <div className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-surface-border bg-white text-sm font-semibold text-gray-700 hover:bg-slate-50 cursor-pointer transition-colors">
                      <Upload className="w-4 h-4" /> Upload Image
                    </div>
                    <input type="file" accept="image/*" className="hidden"
                      aria-label="Upload business card image" onChange={handleFileUpload} />
                  </label>
                </div>

                {/* Camera viewfinder */}
                {cameraOn && (
                  <div className="w-full space-y-3">
                    <div className="relative rounded-xl overflow-hidden border-2 border-brand-400 bg-black">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-64 object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="border-2 border-white/60 rounded-lg w-4/5 h-3/5 flex items-center justify-center">
                          <p className="text-white/60 text-xs">Align card within frame</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" className="flex-1 gap-2 bg-brand-500" onClick={captureFromCamera}>
                        <Camera className="w-4 h-4" /> Capture
                      </Button>
                      <Button type="button" variant="outline" onClick={stopCamera}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2 — Processing */}
        {step === 'preview' && (
          <Card>
            <CardContent className="p-6 flex flex-col items-center gap-5 text-center">
              {imagePreview && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={imagePreview} alt="Card" className="w-full max-h-48 object-contain rounded-xl border border-surface-border" />
              )}
              <div className="flex items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
                <div className="text-left">
                  <p className="font-bold text-gray-900 text-sm">Gemma AI is reading the card…</p>
                  <p className="text-xs text-surface-muted">Extracting name, email, phone, company</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Review form */}
        {step === 'form' && (
          <div className="space-y-4">
            {/* Card preview */}
            {imagePreview && (
              <Card>
                <CardContent className="p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Card" className="w-full max-h-36 object-contain rounded-lg" />
                </CardContent>
              </Card>
            )}

            {/* Status badges */}
            {ocrSource === 'gemma' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200">
                <Sparkles className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-emerald-700">Gemma AI extracted the details — review and confirm</p>
              </div>
            )}
            {ocrSource === 'fallback' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-amber-700">AI unavailable — fill in manually</p>
              </div>
            )}
            {existingId && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200">
                <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-blue-700">Matching contact found — saving will update that record</p>
              </div>
            )}
            {!existingId && ocrSource === 'gemma' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-50 border border-brand-200">
                <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-brand-700">No duplicate found — this will be a new contact</p>
              </div>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Review Details</CardTitle></CardHeader>
              <CardContent>
                {error && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <form onSubmit={handleSave} className="space-y-3">
                  {FIELDS.map(f => (
                    <div key={f.id} className="space-y-1">
                      <Label htmlFor={f.id} className="text-xs">{f.label}</Label>
                      <Input
                        id={f.id} name={f.id}
                        value={form[f.id]} onChange={handleChange}
                        placeholder={f.placeholder}
                        className={form[f.id] ? 'border-emerald-300 bg-emerald-50/50' : ''}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-3 flex-wrap">
                    <Button type="submit" disabled={saving} className="gap-2 flex-1">
                      {saving
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                        : <><Save className="w-4 h-4" /> {existingId ? 'Update Contact' : 'Create Contact'}</>
                      }
                    </Button>
                    <Button type="button" variant="outline" onClick={reset} className="gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" /> Scan Again
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </>
  )
}
