'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, Save, Trash2, Mail, Phone,
  Building2, Tag, FileText, Calendar, User, Plus,
  MessageSquare, Sparkles, Copy, Check, Camera, QrCode, Share2,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import FileUploader from '@/components/ui/file-uploader'

interface TimelineEntry {
  _id: string; type: 'email' | 'meeting' | 'note' | 'call'; title: string
  body?: string; source: 'manual' | 'outlook'; date: string
}
interface Contact {
  _id: string; name: string; email?: string; phone?: string
  company?: string; designation?: string; gender?: string
  caste?: string; religion?: string
  notes?: string; tags?: string[]; birthday?: string
  anniversary?: string; photo?: string
  timeline: TimelineEntry[]; createdAt?: string
}

const TIMELINE_ICONS: Record<string, React.ElementType> = {
  email: Mail, meeting: Calendar, note: FileText, call: Phone,
}
const TIMELINE_COLORS: Record<string, string> = {
  email: 'bg-blue-50 text-blue-600', meeting: 'bg-purple-50 text-purple-600',
  note: 'bg-yellow-50 text-yellow-600', call: 'bg-green-50 text-green-600',
}

function AddTimelineDialog({ contactId, onAdded }: { contactId: string; onAdded: () => void }) {
  const [open,  setOpen]  = useState(false)
  const [form,  setForm]  = useState({ type: 'note', title: '', body: '' })
  const [saving,setSaving]= useState(false)
  const toast = useToast()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/crm/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timelineEntry: { ...form, source: 'manual', date: new Date() } }),
      })
      toast('Entry added')
      setForm({ type: 'note', title: '', body: '' })
      setOpen(false)
      onAdded()
    } catch { toast('Failed to add entry', 'error') }
    finally { setSaving(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Log Activity
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-4">Log Activity</Dialog.Title>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select aria-label="Activity type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Discussed Q3 project…" required />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={3} placeholder="Additional details…"
                className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function GenerateMessageDialog({ contactId }: { contactId: string }) {
  const [open,    setOpen]    = useState(false)
  const [type,    setType]    = useState('follow-up')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [copied,  setCopied]  = useState(false)
  const toast = useToast()

  const generate = async () => {
    setLoading(true); setMessage('')
    try {
      const res  = await fetch('/api/crm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, messageType: type }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage(data.message)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Generation failed', 'error')
    } finally { setLoading(false) }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog.Root open={open} onOpenChange={o => { setOpen(o); if (!o) setMessage('') }}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50">
          <Sparkles className="w-3.5 h-3.5" /> AI Message
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-4">Generate Message</Dialog.Title>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Message Type</Label>
              <select aria-label="Message type" value={type} onChange={e => setType(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                <option value="birthday">Birthday Greeting</option>
                <option value="follow-up">Follow-Up Email</option>
                <option value="meeting-request">Meeting Request</option>
                <option value="introduction">Introduction</option>
              </select>
            </div>
            <Button type="button" onClick={generate} disabled={loading} className="w-full gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate</>}
            </Button>
            {message && (
              <div className="relative">
                <textarea
                  value={message} onChange={e => setMessage(e.target.value)}
                  rows={6} aria-label="Generated message"
                  className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500"
                />
                <button type="button" onClick={copy}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-white border border-surface-border hover:bg-surface transition-colors"
                  aria-label="Copy message">
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-surface-muted" />}
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-4">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ShareQRDialog({ contactId, contactName }: { contactId: string; contactName: string }) {
  const [open,    setOpen]    = useState(false)
  const [copied,  setCopied]  = useState(false)
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/contact/${contactId}`
    : `/contact/${contactId}`

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Share2 className="w-3.5 h-3.5" /> Share
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Share Contact Card</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">
            Scan QR or copy link to share {contactName}&apos;s public contact page.
          </Dialog.Description>
          <div className="flex justify-center mb-4 p-4 bg-white rounded-xl border border-surface-border">
            <QRCodeSVG value={shareUrl} size={160} includeMargin />
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface border border-surface-border mb-4">
            <p className="text-xs text-gray-600 flex-1 truncate">{shareUrl}</p>
            <button type="button" onClick={copy}
              className="flex-shrink-0 text-brand-500 hover:text-brand-700 transition-colors">
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-3 justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">Close</Button>
            </Dialog.Close>
            <a href={shareUrl} target="_blank" rel="noreferrer">
              <Button type="button" size="sm" className="gap-1.5">
                <QrCode className="w-3.5 h-3.5" /> Open Page
              </Button>
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const toast  = useToast()

  const [contact,  setContact]  = useState<Contact | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', gender: '', caste: '', religion: '', notes: '', tags: '', birthday: '', anniversary: '' })
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error,    setError]    = useState('')
  const [editing,  setEditing]  = useState(false)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])

  const fetchContact = useCallback(() => {
    fetch(`/api/crm/${id}`)
      .then(r => r.json())
      .then(data => {
        setContact(data)
        setForm({
          name: data.name || '', email: data.email || '', phone: data.phone || '',
          company: data.company || '', designation: data.designation || '',
          gender: data.gender || '', caste: data.caste || '', religion: data.religion || '', notes: data.notes || '',
          tags: (data.tags || []).join(', '),
          birthday:    data.birthday    ? data.birthday.split('T')[0]    : '',
          anniversary: data.anniversary ? data.anniversary.split('T')[0] : '',
        })
        setLoading(false)
      })
      .catch(() => { setError('Failed to load contact.'); setLoading(false) })
  }, [id])

  useEffect(() => { fetchContact() }, [fetchContact])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        tags:  form.tags.split(',').map(t => t.trim()).filter(Boolean),
        photo: photoUrls[0] || contact?.photo,
      }
      const res = await fetch(`/api/crm/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setContact(updated); setEditing(false)
      toast('Contact updated')
    } catch { setError('Failed to save changes.') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${contact?.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/crm/${id}`, { method: 'DELETE' })
    toast('Contact deleted', 'info')
    router.push('/crm')
  }

  if (loading) return (
    <>
      <Header title="Contact" />
      <main className="flex-1 p-6">
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-surface-border animate-pulse" />)}</div>
      </main>
    </>
  )

  if (error && !contact) return (
    <>
      <Header title="Contact" />
      <main className="flex-1 p-6">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-brand-600 mt-4"><ArrowLeft className="w-4 h-4" /> Back to CRM</Link>
      </main>
    </>
  )

  const initials = contact?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <>
      <Header title="Contact Detail" />
      <main className="flex-1 p-6 max-w-3xl space-y-5">
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* Profile header */}
        <Card>
          <CardContent className="p-5 flex items-start gap-5">
            <div className="relative flex-shrink-0">
              {contact?.photo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={contact.photo} alt={contact.name} className="w-16 h-16 rounded-2xl object-cover border border-surface-border" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center">
                  <span className="text-brand-700 font-extrabold text-lg">{initials}</span>
                </div>
              )}
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
                {contact?.tags?.map(tag => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
              <GenerateMessageDialog contactId={id} />
              <ShareQRDialog contactId={id} contactName={contact?.name || ''} />
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel' : 'Edit'}
              </Button>
              <Button type="button" variant="outline" size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={handleDelete} disabled={deleting}>
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
              { icon: Calendar, label: 'Anniversary', value: contact.anniversary ? new Date(contact.anniversary).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined },
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
                    { id: 'name',        label: 'Full Name *',  type: 'text', placeholder: 'John Doe' },
                    { id: 'company',     label: 'Company',      type: 'text', placeholder: 'Acme Corp' },
                    { id: 'email',       label: 'Email',        type: 'email', placeholder: 'john@company.com' },
                    { id: 'phone',       label: 'Phone',        type: 'text', placeholder: '+91 98765 43210' },
                    { id: 'designation', label: 'Designation',  type: 'text', placeholder: 'Director, Operations' },
                    { id: 'birthday',    label: 'Birthday',     type: 'date', placeholder: '' },
                    { id: 'anniversary', label: 'Anniversary',  type: 'date', placeholder: '' },
                  ].map(f => (
                    <div key={f.id} className="space-y-1.5">
                      <Label htmlFor={f.id}>{f.label}</Label>
                      <Input id={f.id} name={f.id} type={f.type} value={(form as Record<string, string>)[f.id]} onChange={handleChange} placeholder={f.placeholder} />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label htmlFor="gender">Gender</Label>
                    <select id="gender" name="gender" aria-label="Gender" value={form.gender} onChange={handleChange}
                      className="flex h-10 w-full rounded-lg border border-surface-border bg-white px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                      <option value="">Prefer not to say</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="caste">Caste <span className="text-surface-muted font-normal text-[10px]">(encrypted)</span></Label>
                    <Input id="caste" name="caste" value={form.caste} onChange={handleChange} placeholder="" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="religion">Religion <span className="text-surface-muted font-normal text-[10px]">(encrypted)</span></Label>
                    <Input id="religion" name="religion" value={form.religion} onChange={handleChange} placeholder="" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tags">Tags <span className="text-surface-muted font-normal">(comma separated)</span></Label>
                    <Input id="tags" name="tags" value={form.tags} onChange={handleChange} placeholder="client, vip" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <textarea id="notes" name="notes" value={form.notes} onChange={handleChange}
                    rows={3} placeholder="Additional notes…"
                    className="flex w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                  />
                </div>
                <FileUploader
                  label="Profile Photo"
                  hint="JPG or PNG · Max 1 file"
                  maxFiles={1}
                  onChange={setPhotoUrls}
                />
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

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700">
              <MessageSquare className="w-4 h-4 inline mr-1.5 text-brand-500" />Activity Timeline
            </CardTitle>
            <AddTimelineDialog contactId={id} onAdded={fetchContact} />
          </CardHeader>
          <CardContent className="pt-0">
            {!contact?.timeline?.length ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Camera className="w-8 h-8 text-brand-200 mb-2" />
                <p className="text-sm text-surface-muted">No activity logged yet.</p>
                <p className="text-xs text-surface-muted mt-0.5">Log a call, meeting, or note using the button above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {contact.timeline.map(entry => {
                  const Icon = TIMELINE_ICONS[entry.type] || FileText
                  const color = TIMELINE_COLORS[entry.type] || 'bg-gray-50 text-gray-600'
                  return (
                    <div key={entry._id} className="flex gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0 pb-3 border-b border-surface-border last:border-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900 truncate">{entry.title}</p>
                          {entry.source === 'outlook' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Outlook</span>
                          )}
                        </div>
                        {entry.body && <p className="text-xs text-surface-muted mt-0.5 line-clamp-2">{entry.body}</p>}
                        <p className="text-[10px] text-surface-muted mt-1 capitalize">
                          {entry.type} · {new Date(entry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
