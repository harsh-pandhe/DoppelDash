'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import FileUploader from '@/components/ui/file-uploader'

const LEAVE_MAX: Record<string, number> = { casual: 12, medical: 6, earned: 15 }
const LEAVE_DESC: Record<string, string> = {
  casual:  'For personal errands, family events, or short personal time off.',
  medical: 'For illness or medical procedures. Attach a prescription or certificate if available.',
  earned:  'Accumulated paid leave. Plan in advance and get prior approval.',
}

export default function NewLeavePage() {
  const router = useRouter()
  const [form, setForm] = useState({ type: 'casual', startDate: '', endDate: '', reason: '' })
  const [docs, setDocs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [used, setUsed] = useState<Record<string, number>>({ casual: 0, medical: 0, earned: 0 })

  useEffect(() => {
    fetch('/api/lms')
      .then(r => r.json())
      .then((leaves: Array<{ type: string; status: string; days: number }>) => {
        if (!Array.isArray(leaves)) return
        const totals: Record<string, number> = { casual: 0, medical: 0, earned: 0 }
        leaves.forEach(l => { if (l.status === 'approved' && totals[l.type] !== undefined) totals[l.type] += l.days })
        setUsed(totals)
      })
      .catch(() => {})
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  const days = form.startDate && form.endDate
    ? Math.max(1, Math.ceil((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1)
    : 0

  const isMedical      = form.type === 'medical'
  const medicalRequired = isMedical && days > 2

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.startDate || !form.endDate || !form.reason.trim()) { setError('All fields are required.'); return }
    if (new Date(form.endDate) < new Date(form.startDate)) { setError('End date must be after start date.'); return }
    if (medicalRequired && docs.length === 0) { setError('Medical documents are required for medical leave > 2 days.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/lms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, days, medicalDocs: docs }),
      })
      if (!res.ok) throw new Error()
      router.push('/lms')
    } catch {
      setError('Failed to submit leave request.')
      setLoading(false)
    }
  }

  const balance = Math.max(0, (LEAVE_MAX[form.type] ?? 0) - (used[form.type] ?? 0))
  const balanceLow = balance <= 2

  return (
    <>
      <Header title="Request Leave" />
      <main className="flex-1 p-6 max-w-xl">
        <Link href="/lms" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Leave Management
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>New Leave Request</CardTitle>
            <p className="text-sm text-surface-muted">Fill in the details below. Supporting documents can be attached for any leave type.</p>
          </CardHeader>
          <CardContent>
            {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Leave type */}
              <div className="space-y-1.5">
                <Label htmlFor="type">Leave Type</Label>
                <select id="type" name="type" aria-label="Leave type" value={form.type} onChange={handleChange}
                  className="flex h-10 w-full rounded-lg border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                  <option value="casual">Casual Leave</option>
                  <option value="medical">Medical Leave</option>
                  <option value="earned">Earned Leave</option>
                </select>
                <p className="text-xs text-surface-muted">{LEAVE_DESC[form.type]}</p>
                {LEAVE_MAX[form.type] !== undefined && (
                  <p className="text-xs">
                    Balance:{' '}
                    <strong className={balanceLow ? 'text-red-600' : 'text-emerald-600'}>
                      {balance}
                    </strong>
                    {' '}/ {LEAVE_MAX[form.type]} days remaining
                    {balanceLow && balance > 0 && <span className="text-red-500 ml-1">— running low</span>}
                    {balance === 0 && <span className="text-red-600 ml-1 font-semibold">— balance exhausted</span>}
                  </p>
                )}
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input id="startDate" name="startDate" type="date" value={form.startDate} onChange={handleChange} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input id="endDate" name="endDate" type="date" value={form.endDate} onChange={handleChange} min={form.startDate} required />
                </div>
              </div>
              {days > 0 && (
                <p className="text-sm font-semibold text-brand-600 -mt-2">
                  Duration: <strong>{days}</strong> day{days > 1 ? 's' : ''}
                </p>
              )}

              {/* Reason */}
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason</Label>
                <textarea
                  id="reason" name="reason" value={form.reason} onChange={handleChange}
                  rows={3} placeholder="Brief reason for leave…"
                  className="flex w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                  required
                />
              </div>

              {/* Documents — medical required if >2 days, optional otherwise */}
              <FileUploader
                label={
                  medicalRequired
                    ? 'Medical Documents (Required)'
                    : isMedical
                      ? 'Medical Documents (Optional — recommended)'
                      : 'Supporting Documents (Optional)'
                }
                hint={
                  medicalRequired
                    ? 'Prescription or hospital certificate · JPG, PNG, PDF · Max 5 files'
                    : 'Attach any relevant documents · JPG, PNG, PDF · Max 5 files'
                }
                required={medicalRequired}
                variant={medicalRequired ? 'danger' : 'default'}
                onChange={setDocs}
                disabled={loading}
              />

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={loading} className="gap-2">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><Save className="w-4 h-4" /> Submit Request</>}
                </Button>
                <Link href="/lms"><Button type="button" variant="outline">Cancel</Button></Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
