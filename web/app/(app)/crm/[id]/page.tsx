'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, Save, Trash2, Mail, Phone,
  Building2, Tag, FileText, Calendar, User
} from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'

interface Contact {
  _id: string; name: string; email?: string; phone?: string
  company?: string; designation?: string; gender?: string
  notes?: string; tags?: string[]; birthday?: string; createdAt?: string
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()

  const [contact, setContact] = useState<Contact | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', gender: '', notes: '', tags: '', birthday: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    fetch(`/api/crm/${id}`)
      .then(r => r.json())
      .then(data => {
        setContact(data)
        setForm({
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          company: data.company || '',
          designation: data.designation || '',
          gender: data.gender || '',
          notes: data.notes || '',
          tags: (data.tags || []).join(', '),
          birthday: data.birthday ? data.birthday.split('T')[0] : '',
        })
        setLoading(false)
      })
      .catch(() => { setError('Failed to load contact.'); setLoading(false) })
  }, [id])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const payload = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) }
      const res = await fetch(`/api/crm/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setContact(updated)
      setEditing(false)
      toast('Contact updated successfully')
    } catch {
      setError('Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${contact?.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/crm/${id}`, { method: 'DELETE' })
    toast('Contact deleted', 'info')
    router.push('/crm')
  }

  if (loading) {
    return (
      <>
        <Header title="Contact" />
        <main className="flex-1 p-6">
          <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-surface-border animate-pulse" />)}</div>
        </main>
      </>
    )
  }

  if (error && !contact) {
    return (
      <>
        <Header title="Contact" />
        <main className="flex-1 p-6">
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-brand-600 mt-4"><ArrowLeft className="w-4 h-4" /> Back to CRM</Link>
        </main>
      </>
    )
  }

  const initials = contact?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <>
      <Header title="Contact Detail" />
      <main className="flex-1 p-6 max-w-3xl space-y-5">
        {/* Breadcrumb */}
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* Profile header */}
        <Card>
          <CardContent className="p-5 flex items-start gap-5">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0">
              <span className="text-brand-700 font-extrabold text-lg">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-extrabold text-gray-900 truncate">{contact?.name}</h2>
              {contact?.designation && <p className="text-sm text-surface-muted">{contact.designation}</p>}
              {contact?.company && (
                <p className="text-sm text-gray-600 flex items-center gap-1.5 mt-1">
                  <Building2 className="w-3.5 h-3.5 text-surface-muted" />{contact.company}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {contact?.tags?.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel' : 'Edit'}
              </Button>
              <Button
                variant="outline" size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Read view */}
        {!editing && contact && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Mail,     label: 'Email',       value: contact.email },
              { icon: Phone,    label: 'Phone',       value: contact.phone },
              { icon: Building2,label: 'Company',     value: contact.company },
              { icon: User,     label: 'Gender',      value: contact.gender },
              { icon: Calendar, label: 'Birthday',    value: contact.birthday ? new Date(contact.birthday).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined },
              { icon: Calendar, label: 'Added On',    value: contact.createdAt ? new Date(contact.createdAt).toLocaleDateString('en-IN') : undefined },
            ].filter(f => f.value).map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-white rounded-xl border border-surface-border p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-surface-muted mb-1">{label}</p>
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-surface-muted flex-shrink-0" />
                  <p className="text-sm font-medium text-gray-900">{value}</p>
                </div>
              </div>
            ))}
            {contact.notes && (
              <div className="sm:col-span-2 bg-white rounded-xl border border-surface-border p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-surface-muted mb-1 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Notes
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
            {contact.tags && contact.tags.length > 0 && (
              <div className="sm:col-span-2 bg-white rounded-xl border border-surface-border p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-surface-muted mb-2 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Tags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {contact.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <Card>
            <CardHeader><CardTitle>Edit Contact</CardTitle></CardHeader>
            <CardContent>
              {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { id: 'name',        label: 'Full Name *', type: 'text', placeholder: 'John Doe' },
                    { id: 'company',     label: 'Company',     type: 'text', placeholder: 'Acme Corp' },
                    { id: 'email',       label: 'Email',       type: 'email', placeholder: 'john@company.com' },
                    { id: 'phone',       label: 'Phone',       type: 'text', placeholder: '+91 98765 43210' },
                    { id: 'designation', label: 'Designation', type: 'text', placeholder: 'Director, Operations' },
                    { id: 'birthday',    label: 'Birthday',    type: 'date', placeholder: '' },
                  ].map(f => (
                    <div key={f.id} className="space-y-1.5">
                      <Label htmlFor={f.id}>{f.label}</Label>
                      <Input id={f.id} name={f.id} type={f.type} value={(form as Record<string, string>)[f.id]} onChange={handleChange} placeholder={f.placeholder} />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label htmlFor="gender">Gender</Label>
                    <select id="gender" name="gender" value={form.gender} onChange={handleChange}
                      className="flex h-10 w-full rounded-lg border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                      <option value="">Prefer not to say</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tags">Tags <span className="text-surface-muted font-normal">(comma separated)</span></Label>
                    <Input id="tags" name="tags" value={form.tags} onChange={handleChange} placeholder="client, vip" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes" name="notes" value={form.notes} onChange={handleChange}
                    rows={3} placeholder="Additional notes…"
                    className="flex w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={saving} className="gap-2">
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><Save className="w-4 h-4" />Save Changes</>}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  )
}
