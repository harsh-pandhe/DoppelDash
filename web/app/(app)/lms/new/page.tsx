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

export default function NewLeavePage() {
  const router = useRouter()
  const [form, setForm] = useState({ type: 'casual', startDate: '', endDate: '', reason: '' })
  const [medicalDocs, setMedicalDocs] = useState<string[]>([])
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

  const needsMedicalDocs = form.type === 'medical' && days > 2

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.startDate || !form.endDate || !form.reason.trim()) { setError('All fields are required.'); return }
    if (new Date(form.endDate) < new Date(form.startDate)) { setError('End date must be after start date.'); return }
    if (needsMedicalDocs && medicalDocs.length === 0) { setError('Medical documents are required for medical leave > 2 days.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/lms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, days, medicalDocs }),
      })
      if (!res.ok) throw new Error()
      router.push('/lms')
    } catch {
      setError('Failed to submit leave request.')
      setLoading(false)
    }
  }

  return (
    <>
      <Header title="Request Leave" />
      <main className="flex-1 p-6 max-w-xl">
        <Link href="/lms" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Leave Management
        </Link>
        <Card>
          <CardHeader><CardTitle>New Leave Request</CardTitle></CardHeader>
          <CardContent>
            {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="type">Leave Type</Label>
                <select id="type" name="type" aria-label="Leave type" value={form.type} onChange={handleChange} className="flex h-10 w-full rounded-lg border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                  <option value="casual">Casual Leave</option>
                  <option value="medical">Medical Leave</option>
                  <option value="earned">Earned Leave</option>
                </select>
                {LEAVE_MAX[form.type] !== undefined && (
                  <p className="text-xs text-surface-muted mt-1">
                    Balance: <strong className={LEAVE_MAX[form.type] - used[form.type] <= 2 ? 'text-red-600' : 'text-emerald-600'}>
                      {Math.max(0, LEAVE_MAX[form.type] - used[form.type])}
                    </strong> / {LEAVE_MAX[form.type]} days remaining
                  </p>
                )}
              </div>
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
                <p className="text-sm text-brand-600 font-semibold -mt-1">
                  Duration: <strong>{days}</strong> day{days > 1 ? 's' : ''}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason</Label>
                <textarea
                  id="reason" name="reason" value={form.reason} onChange={handleChange}
                  rows={3} placeholder="Brief reason for leave…"
                  className="flex w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                  required
                />
              </div>

              {needsMedicalDocs && (
                <FileUploader
                  label="Medical Documents Required"
                  hint="Prescription or hospital certificate · JPG, PNG, PDF · Max 5 files"
                  required
                  variant="danger"
                  onChange={setMedicalDocs}
                  disabled={loading}
                />
              )}

              <div className="flex gap-3 pt-2">
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
