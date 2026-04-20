'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function NewContactPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', gender: '', notes: '', tags: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setLoading(true); setError('')
    try {
      const payload = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) }
      const res = await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('Failed to create contact')
      router.push('/crm')
    } catch {
      setError('Failed to save contact. Please try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <Header title="Add Contact" />
      <main className="flex-1 p-6 max-w-2xl">
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>
        <Card>
          <CardHeader><CardTitle>New Stakeholder Contact</CardTitle></CardHeader>
          <CardContent>
            {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input id="name" name="name" value={form.name} onChange={handleChange} placeholder="John Doe" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" name="company" value={form.company} onChange={handleChange} placeholder="Acme Corp" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="john@company.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" value={form.phone} onChange={handleChange} placeholder="+91 98765 43210" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="designation">Designation</Label>
                  <Input id="designation" name="designation" value={form.designation} onChange={handleChange} placeholder="Director, Operations" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gender">Gender</Label>
                  <select id="gender" name="gender" value={form.gender} onChange={handleChange} className="flex h-10 w-full rounded-lg border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tags">Tags <span className="text-surface-muted font-normal">(comma separated)</span></Label>
                <Input id="tags" name="tags" value={form.tags} onChange={handleChange} placeholder="client, vip, ropeway-project" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes" name="notes" value={form.notes} onChange={handleChange}
                  rows={3} placeholder="Any additional notes…"
                  className="flex w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading} className="gap-2">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Contact</>}
                </Button>
                <Link href="/crm"><Button type="button" variant="outline">Cancel</Button></Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
