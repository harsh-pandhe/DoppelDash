'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, Upload, IndianRupee } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function NewExpensePage() {
  const router = useRouter()
  const [form, setForm] = useState({ title: '', reason: '', amount: '', travelFrom: '', travelTo: '', startDate: '', endDate: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.reason || !form.amount || !form.startDate) { setError('Please fill in all required fields.'); return }
    if (isNaN(Number(form.amount)) || Number(form.amount) <= 0) { setError('Amount must be a positive number.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/rms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount), receipts: [] }),
      })
      if (!res.ok) throw new Error()
      router.push('/rms')
    } catch {
      setError('Failed to submit expense request.')
      setLoading(false)
    }
  }

  return (
    <>
      <Header title="Log Expense" />
      <main className="flex-1 p-6 max-w-xl">
        <Link href="/rms" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Reimbursements
        </Link>
        <Card>
          <CardHeader><CardTitle>New Travel / Expense Request</CardTitle></CardHeader>
          <CardContent>
            {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">Expense Title *</Label>
                <Input id="title" name="title" value={form.title} onChange={handleChange} placeholder="Site visit to Mumbai" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Purpose / Reason *</Label>
                <textarea id="reason" name="reason" value={form.reason} onChange={handleChange} rows={2}
                  placeholder="Explain why this expense was incurred…"
                  className="flex w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                  required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">Total Amount (₹) *</Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                  <Input id="amount" name="amount" type="number" min="1" value={form.amount} onChange={handleChange} className="pl-9" placeholder="5000" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="travelFrom">Travel From</Label>
                  <Input id="travelFrom" name="travelFrom" value={form.travelFrom} onChange={handleChange} placeholder="Pune" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="travelTo">Travel To</Label>
                  <Input id="travelTo" name="travelTo" value={form.travelTo} onChange={handleChange} placeholder="Mumbai" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="startDate">Start Date *</Label>
                  <Input id="startDate" name="startDate" type="date" value={form.startDate} onChange={handleChange} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input id="endDate" name="endDate" type="date" value={form.endDate} onChange={handleChange} min={form.startDate} />
                </div>
              </div>

              {/* Receipt upload */}
              <div className="space-y-1.5 p-4 rounded-xl border-2 border-dashed border-surface-border bg-surface">
                <Label>Bills / Receipts <span className="text-red-500">*</span></Label>
                <p className="text-xs text-surface-muted mb-2">Upload bills, receipts, or invoices for this expense.</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-border bg-white text-sm font-medium text-gray-700 hover:bg-surface transition-colors">
                    <Upload className="w-4 h-4 text-surface-muted" /> Upload Receipts
                  </div>
                  <input type="file" multiple accept="image/*,.pdf" className="hidden" />
                </label>
                <p className="text-xs text-surface-muted">JPG, PNG, PDF · Max 5 files</p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading} className="gap-2">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><Save className="w-4 h-4" /> Submit Request</>}
                </Button>
                <Link href="/rms"><Button type="button" variant="outline">Cancel</Button></Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
