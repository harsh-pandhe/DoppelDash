'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, Upload } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function NewLeavePage() {
  const router = useRouter()
  const [form, setForm] = useState({ type: 'casual', startDate: '', endDate: '', reason: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/lms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, days }),
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
                <select id="type" name="type" value={form.type} onChange={handleChange} className="flex h-10 w-full rounded-lg border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                  <option value="casual">Casual Leave</option>
                  <option value="medical">Medical Leave</option>
                  <option value="earned">Earned Leave</option>
                </select>
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

              {/* Medical doc upload (required if medical > 2 days) */}
              {needsMedicalDocs && (
                <div className="space-y-1.5 p-4 rounded-xl border-2 border-dashed border-red-300 bg-red-50">
                  <Label className="text-red-700">Medical Documents Required</Label>
                  <p className="text-xs text-red-500 mb-2">Medical leave &gt; 2 days requires supporting documents (prescription / hospital certificate).</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 bg-white text-sm font-medium text-red-700 hover:bg-red-50 transition-colors">
                      <Upload className="w-4 h-4" /> Upload Documents
                    </div>
                    <input type="file" multiple accept="image/*,.pdf" className="hidden" />
                  </label>
                  <p className="text-xs text-surface-muted">JPG, PNG, PDF accepted</p>
                </div>
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
