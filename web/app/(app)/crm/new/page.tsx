'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, Users } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const FIELD_GROUPS = [
  {
    title: 'Basic Info',
    fields: [
      { id: 'name',        label: 'Full Name',    required: true,  type: 'text',  placeholder: 'John Doe',             span: 1 },
      { id: 'designation', label: 'Designation',  required: false, type: 'text',  placeholder: 'Director, Operations', span: 1 },
      { id: 'company',     label: 'Company',      required: false, type: 'text',  placeholder: 'Acme Corp',            span: 2 },
    ],
  },
  {
    title: 'Contact Details',
    fields: [
      { id: 'email', label: 'Email', required: false, type: 'email', placeholder: 'john@company.com',  span: 1 },
      { id: 'phone', label: 'Phone', required: false, type: 'text',  placeholder: '+91 98765 43210',   span: 1 },
    ],
  },
  {
    title: 'Tags & Notes',
    fields: [
      { id: 'tags', label: 'Tags (comma separated)', required: false, type: 'text', placeholder: 'client, vip, ropeway-project', span: 2 },
    ],
  },
]

export default function NewContactPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', gender: '', notes: '', tags: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setLoading(true); setError('')
    try {
      const payload = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) }
      const res = await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error()
      router.push('/crm')
    } catch {
      setError('Failed to save contact. Please try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <Header title="Add Contact" />
      <main className="flex-1 p-5 max-w-2xl w-full mx-auto">

        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* Page header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white mb-5">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold">New Stakeholder Contact</h2>
              <p className="text-brand-200 text-sm mt-0.5">Add a contact to your CRM database.</p>
            </div>
          </div>
        </div>

        {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

        <form onSubmit={handleSubmit} className="space-y-5">

          {FIELD_GROUPS.map(group => (
            <div key={group.title} className="bg-white rounded-2xl border border-surface-border p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-4">{group.title}</p>
              <div className="grid grid-cols-2 gap-4">
                {group.fields.map(f => (
                  <div key={f.id} className={`space-y-1.5 ${f.span === 2 ? 'col-span-2' : 'col-span-1'}`}>
                    <Label htmlFor={f.id}>{f.label}{f.required && ' *'}</Label>
                    <Input
                      id={f.id} name={f.id} type={f.type}
                      value={(form as Record<string, string>)[f.id]}
                      onChange={handleChange}
                      placeholder={f.placeholder}
                      required={f.required}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Gender select */}
          <div className="bg-white rounded-2xl border border-surface-border p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-4">Additional</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="gender">Gender</Label>
                <select id="gender" name="gender" aria-label="Gender" value={form.gender} onChange={handleChange}
                  className="flex h-10 w-full rounded-xl border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes" name="notes" value={form.notes} onChange={handleChange}
                  rows={3} placeholder="Any additional notes…"
                  className="flex w-full rounded-xl border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={loading} className="gap-2 bg-gradient-to-r from-brand-500 to-brand-600">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><Save className="w-4 h-4" />Save Contact</>}
            </Button>
            <Link href="/crm"><Button type="button" variant="outline">Cancel</Button></Link>
          </div>

        </form>
      </main>
    </>
  )
}
