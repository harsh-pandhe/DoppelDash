'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, Save, Trash2, Mail, Phone,
  Building2, FileText, Calendar, User, Plus,
  MessageSquare, Sparkles, Copy, Check, Camera, QrCode, Share2, Bell, Send, XCircle,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  reminderDate?: string; reminderNote?: string
  timeline: TimelineEntry[]; createdAt?: string
}

const TIMELINE_META: Record<string, { icon: React.ElementType; gradient: string; dot: string }> = {
  email:   { icon: Mail,         gradient: 'from-blue-400 to-blue-600',   dot: 'bg-blue-500' },
  meeting: { icon: Calendar,     gradient: 'from-purple-400 to-violet-600', dot: 'bg-purple-500' },
  note:    { icon: FileText,     gradient: 'from-amber-400 to-orange-500', dot: 'bg-amber-500' },
  call:    { icon: Phone,        gradient: 'from-green-400 to-emerald-600', dot: 'bg-green-500' },
}

const AVATAR_GRADIENTS = [
  'from-brand-400 to-brand-600', 'from-purple-400 to-violet-600',
  'from-orange-400 to-red-500',  'from-emerald-400 to-green-600',
  'from-pink-400 to-rose-500',   'from-cyan-400 to-teal-600',
]
function avatarGradient(name: string | undefined) {
  const firstChar = (name || 'A').trim().charAt(0) || 'A'
  return AVATAR_GRADIENTS[firstChar.charCodeAt(0) % AVATAR_GRADIENTS.length]
}

function InfoTile({ icon: Icon, label, value, wide, href }: { icon: React.ElementType; label: string; value: string; wide?: boolean; href?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    await navigator.clipboard.writeText(value)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const inner = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2 flex items-center gap-1.5">
          <Icon className="w-3 h-3" /> {label}
        </p>
        <p className="text-sm font-semibold text-gray-900 truncate">{value}</p>
      </div>
      <button type="button" onClick={copy} title={copied ? 'Copied' : 'Copy'} aria-label="Copy"
        className="p-1 rounded-md text-surface-muted hover:text-brand-600 hover:bg-white transition-colors flex-shrink-0">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
  if (href) {
    return (
      <a href={href} className={`bg-surface rounded-2xl border border-surface-border p-4 hover:border-brand-400 hover:bg-brand-50/30 transition-colors block ${wide ? 'col-span-2' : ''}`}>
        {inner}
      </a>
    )
  }
  return (
    <div className={`bg-surface rounded-2xl border border-surface-border p-4 ${wide ? 'col-span-2' : ''}`}>
      {inner}
    </div>
  )
}

function ReminderCard({ contactId, reminderDate, reminderNote, onSaved }: {
  contactId: string; reminderDate?: string; reminderNote?: string; onSaved: () => void
}) {
  const toast = useToast()
  const [date, setDate] = useState(reminderDate ? reminderDate.split('T')[0] : '')
  const [note, setNote] = useState(reminderNote || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDate(reminderDate ? reminderDate.split('T')[0] : '')
    setNote(reminderNote || '')
  }, [reminderDate, reminderNote])

  const isOverdue = date && new Date(date) < new Date(new Date().toDateString())

  const save = async () => {
    setSaving(true)
    await fetch(`/api/crm/${contactId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderDate: date || null, reminderNote: note }),
    })
    toast('Reminder saved', 'success')
    setSaving(false); onSaved()
  }

  const clear = async () => {
    setSaving(true)
    await fetch(`/api/crm/${contactId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderDate: null, reminderNote: '' }),
    })
    setDate(''); setNote('')
    toast('Reminder cleared')
    setSaving(false); onSaved()
  }

  return (
    <div className={`col-span-2 rounded-2xl border p-4 space-y-3 ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-surface border-surface-border'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${isOverdue ? 'text-red-600' : 'text-surface-muted'}`}>
        <Bell className="w-3.5 h-3.5" /> Follow-up Reminder {isOverdue && '· OVERDUE'}
      </p>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <label htmlFor={`rd-${contactId}`} className="text-xs font-semibold text-surface-muted">Date</label>
          <input id={`rd-${contactId}`} type="date" value={date} onChange={e => setDate(e.target.value)}
            className="h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
        </div>
        <div className="flex-1 space-y-1 min-w-[160px]">
          <label htmlFor={`rn-${contactId}`} className="text-xs font-semibold text-surface-muted">Note</label>
          <input id={`rn-${contactId}`} type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="Follow up on proposal…"
            className="w-full h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
        </div>
        <Button type="button" size="sm" onClick={save} disabled={saving || !date} className="gap-1.5">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />} Set
        </Button>
        {reminderDate && (
          <button type="button" onClick={clear} disabled={saving} className="text-xs text-red-500 hover:underline">Clear</button>
        )}
      </div>
    </div>
  )
}

function AddTimelineDialog({ contactId, onAdded }: { contactId: string; onAdded: () => void }) {
  const [open, setOpen]   = useState(false)
  const [form, setForm]   = useState({ type: 'note', title: '', body: '' })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/crm/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timelineEntry: { ...form, source: 'manual', date: new Date() } }),
      })
      toast('Entry added')
      setForm({ type: 'note', title: '', body: '' })
      setOpen(false); onAdded()
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
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-4">Log Activity</Dialog.Title>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select aria-label="Activity type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
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
                className="w-full rounded-xl border border-surface-border px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
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

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  birthday: 'Birthday Greeting',
  'follow-up': 'Follow-Up Email',
  'meeting-request': 'Meeting Request',
  introduction: 'Introduction',
}

function GenerateMessageDialog({ contactId, contactEmail, contactName }: {
  contactId: string; contactEmail?: string; contactName: string
}) {
  const [open,       setOpen]       = useState(false)
  const [type,       setType]       = useState('follow-up')
  const [context,    setContext]    = useState('')
  const [generating, setGenerating] = useState(false)
  const [message,    setMessage]    = useState('')
  const [charCount,  setCharCount]  = useState(0)
  const [copied,     setCopied]     = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const toast = useToast()

  const generate = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true); setMessage(''); setCharCount(0)
    try {
      const res = await fetch('/api/crm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ contactId, messageType: type, context: context.trim() || undefined }),
        signal: controller.signal,
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break
          try { const { token } = JSON.parse(data); acc += token; setMessage(acc); setCharCount(acc.length) } catch { /* skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(e instanceof Error ? e.message : 'Generation failed', 'error')
    } finally { setGenerating(false) }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const sendEmail = () => {
    if (!contactEmail || !message) return
    const subjectMap: Record<string, string> = {
      birthday: 'Birthday Greetings', 'follow-up': 'Follow-Up', 'meeting-request': 'Meeting Request', introduction: 'Introduction — Doppelmayr India',
    }
    window.open(`mailto:${contactEmail}?subject=${encodeURIComponent(subjectMap[type] || 'Message')}&body=${encodeURIComponent(message)}`)
  }

  const wrapSelection = (prefix: string, suffix: string) => {
    const ta = document.getElementById('gen-msg') as HTMLTextAreaElement
    if (!ta) return
    const s = ta.selectionStart; const e = ta.selectionEnd
    const newMsg = message.slice(0, s) + prefix + message.slice(s, e) + suffix + message.slice(e)
    setMessage(newMsg)
    setTimeout(() => { ta.selectionStart = s + prefix.length; ta.selectionEnd = e + prefix.length; ta.focus() }, 0)
  }

  const reset = () => { setMessage(''); setContext(''); setCharCount(0); abortRef.current?.abort() }

  return (
    <Dialog.Root open={open} onOpenChange={o => { setOpen(o); if (!o) reset() }}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50">
          <Sparkles className="w-3.5 h-3.5" /> AI Message
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-surface-border px-6 py-4 flex items-center justify-between z-10 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-400 to-violet-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-bold text-gray-900">AI Message Generator</Dialog.Title>
                <Dialog.Description className="text-[11px] text-surface-muted">Writing for {contactName}</Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="p-1.5 rounded-lg text-surface-muted hover:bg-surface transition-colors">
                <XCircle className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-6 space-y-5">
            {/* Type selector */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Message Type</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(MESSAGE_TYPE_LABELS).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setType(val)}
                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition-all border-2
                      ${type === val ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-surface-border text-gray-600 hover:border-gray-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Context input */}
            <div className="space-y-1.5">
              <label htmlFor="gen-context" className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">
                What&apos;s the goal? <span className="font-normal normal-case text-surface-muted">(optional but recommended)</span>
              </label>
              <textarea id="gen-context" value={context} onChange={e => setContext(e.target.value)} rows={2}
                placeholder="e.g. Follow up on our ropeway feasibility discussion from last week. Ask for their decision timeline."
                className="w-full rounded-xl border border-surface-border px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-300/20" />
            </div>

            {/* Generate / Stop */}
            <div className="flex gap-2">
              <Button type="button" onClick={generate} disabled={generating}
                className="flex-1 gap-2 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 border-0 text-white">
                <Sparkles className="w-4 h-4" />
                {generating ? 'Writing…' : message ? 'Regenerate' : 'Generate Message'}
              </Button>
              {generating && (
                <Button type="button" variant="outline" onClick={() => { abortRef.current?.abort(); setGenerating(false) }}
                  className="gap-1.5 text-red-500 border-red-200 hover:bg-red-50">
                  Stop
                </Button>
              )}
            </div>

            {/* Streaming progress */}
            {generating && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-purple-50 rounded-xl border border-purple-100">
                <div className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-purple-700 font-medium">
                  AI is writing{charCount > 0 ? ` · ${charCount} chars` : '…'}
                </span>
              </div>
            )}

            {/* Output area */}
            {(message || generating) && (
              <div className="space-y-2">
                <div className="flex items-center gap-1 p-1.5 bg-surface rounded-xl border border-surface-border">
                  <button type="button" onClick={() => wrapSelection('**', '**')}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-gray-700 hover:bg-white hover:shadow-sm transition-all" title="Bold">B</button>
                  <button type="button" onClick={() => wrapSelection('_', '_')}
                    className="px-2.5 py-1 rounded-lg text-xs italic text-gray-700 hover:bg-white hover:shadow-sm transition-all" title="Italic">I</button>
                  <button type="button" onClick={() => wrapSelection('\n• ', '')}
                    className="px-2.5 py-1 rounded-lg text-xs text-gray-700 hover:bg-white hover:shadow-sm transition-all" title="Bullet">•</button>
                  <div className="w-px h-4 bg-surface-border mx-1" />
                  <button type="button" onClick={copy}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 hover:bg-white hover:shadow-sm transition-all">
                    {copied ? <><Check className="w-3 h-3 text-green-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </button>
                  {contactEmail && message && !generating && (
                    <button type="button" onClick={sendEmail}
                      className="flex items-center gap-1 px-2.5 py-1 ml-auto rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors">
                      <Send className="w-3 h-3" /> Send Email
                    </button>
                  )}
                </div>
                <textarea id="gen-msg" value={message} onChange={e => setMessage(e.target.value)} rows={9}
                  aria-label="Generated message"
                  className="w-full rounded-xl border border-purple-100 bg-purple-50/20 px-3.5 py-3 text-sm resize-none focus:outline-none focus:border-purple-200 leading-relaxed text-gray-800" />
                <p className="text-[10px] text-surface-muted text-right">{charCount} chars · Edit before sending</p>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ShareQRDialog({ contactId, contactName }: { contactId: string; contactName: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/contact/${contactId}` : `/contact/${contactId}`

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Share2 className="w-3.5 h-3.5" /> Share
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Share Contact Card</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">
            Scan QR or copy link to share {contactName}&apos;s public contact page.
          </Dialog.Description>
          <div className="flex justify-center mb-4 p-4 bg-surface rounded-2xl border border-surface-border">
            <QRCodeSVG value={shareUrl} size={160} includeMargin />
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface border border-surface-border mb-4">
            <p className="text-xs text-gray-600 flex-1 truncate">{shareUrl}</p>
            <button type="button" onClick={copy} className="flex-shrink-0 text-brand-500 hover:text-brand-700 transition-colors">
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-3 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Close</Button></Dialog.Close>
            <a href={shareUrl} target="_blank" rel="noreferrer">
              <Button type="button" size="sm" className="gap-1.5"><QrCode className="w-3.5 h-3.5" /> Open Page</Button>
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
  const [deleteOpen, setDeleteOpen] = useState(false)
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
      const payload = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), photo: photoUrls[0] || contact?.photo }
      const res = await fetch(`/api/crm/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setContact(updated); setEditing(false)
      toast('Contact updated')
    } catch { setError('Failed to save changes.') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    setDeleting(true)
    await fetch(`/api/crm/${id}`, { method: 'DELETE' })
    toast('Contact deleted', 'info')
    router.push('/crm')
  }

  if (loading) return (
    <>
      <Header title="Contact" />
      <main className="flex-1 p-5">
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-2xl bg-surface-border animate-pulse" />)}</div>
      </main>
    </>
  )

  if (error && !contact) return (
    <>
      <Header title="Contact" />
      <main className="flex-1 p-5">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-brand-600 mt-4"><ArrowLeft className="w-4 h-4" /> Back to CRM</Link>
      </main>
    </>
  )

  const initials = contact?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const grad = contact ? avatarGradient(contact.name) : 'from-brand-400 to-brand-600'

  return (
    <>
      <Header title="Contact" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl space-y-5 w-full mx-auto">

        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* ── Profile hero ──────────────────────────────────── */}
        <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${grad} p-6 text-white`}>
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex items-start gap-5 flex-wrap">
            <div className="flex-shrink-0">
              {contact?.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={contact.photo} alt={contact.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-white/30" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center border-2 border-white/20">
                  <span className="text-3xl font-extrabold">{initials}</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-extrabold tracking-tight">{contact?.name}</h2>
              {contact?.designation && <p className="text-white/70 text-sm mt-0.5">{contact.designation}</p>}
              {contact?.company && (
                <p className="text-white/70 text-sm mt-1 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> {contact.company}
                </p>
              )}
              {contact?.tags && contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {contact.tags.map(tag => (
                    <span key={tag} className="text-[11px] font-semibold bg-white/20 px-2.5 py-0.5 rounded-full">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="relative z-10 flex gap-2 mt-4 flex-wrap">
            <GenerateMessageDialog contactId={id} contactEmail={contact?.email} contactName={contact?.name || ''} />
            <ShareQRDialog contactId={id} contactName={contact?.name || ''} />
            <Button type="button" size="sm"
              className="bg-white/20 hover:bg-white/30 text-white border-white/20 border gap-1.5"
              onClick={() => setEditing(!editing)}>
              {editing ? 'Cancel Edit' : 'Edit Contact'}
            </Button>
            <Button type="button" size="sm"
              className="bg-red-500/80 hover:bg-red-500 text-white border-0"
              onClick={() => setDeleteOpen(true)} disabled={deleting}
              aria-label="Delete contact">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </Button>
            <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
                <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                  <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Delete contact</Dialog.Title>
                  <Dialog.Description className="text-sm text-surface-muted mb-5">
                    Permanently delete <strong className="text-gray-900">{contact?.name}</strong>? This cannot be undone.
                  </Dialog.Description>
                  <div className="flex gap-3 justify-end">
                    <Dialog.Close asChild>
                      <Button type="button" variant="outline" size="sm">Cancel</Button>
                    </Dialog.Close>
                    <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700" onClick={handleDelete} disabled={deleting}>
                      {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete
                    </Button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>

        {/* ── Info tiles ────────────────────────────────────── */}
        {!editing && contact && (
          <div className="grid grid-cols-2 gap-3">
            {contact.email && <InfoTile icon={Mail} label="Email" value={contact.email} href={`mailto:${contact.email}`} />}
            {contact.phone && <InfoTile icon={Phone} label="Phone" value={contact.phone} href={`tel:${contact.phone.replace(/\s+/g, '')}`} />}
            {contact.gender && <InfoTile icon={User} label="Gender" value={contact.gender} />}
            {contact.birthday && <InfoTile icon={Calendar} label="Birthday" value={new Date(contact.birthday).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} />}
            {contact.anniversary && <InfoTile icon={Calendar} label="Anniversary" value={new Date(contact.anniversary).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} />}
            {contact.createdAt && <InfoTile icon={Calendar} label="Added On" value={new Date(contact.createdAt).toLocaleDateString('en-IN')} />}
            {contact.notes && (
              <div className="col-span-2 bg-surface rounded-2xl border border-surface-border p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2 flex items-center gap-1.5">
                  <FileText className="w-3 h-3" /> Notes
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
            <ReminderCard contactId={contact._id} reminderDate={contact.reminderDate} reminderNote={contact.reminderNote} onSaved={fetchContact} />
          </div>
        )}

        {/* ── Edit form ─────────────────────────────────────── */}
        {editing && (
          <div className="bg-white rounded-2xl border border-surface-border p-5">
            <h3 className="font-bold text-gray-900 mb-4">Edit Contact</h3>
            {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { id: 'name',        label: 'Full Name *',  type: 'text',  placeholder: 'John Doe' },
                  { id: 'company',     label: 'Company',      type: 'text',  placeholder: 'Acme Corp' },
                  { id: 'email',       label: 'Email',        type: 'email', placeholder: 'john@company.com' },
                  { id: 'phone',       label: 'Phone',        type: 'text',  placeholder: '+91 98765 43210' },
                  { id: 'designation', label: 'Designation',  type: 'text',  placeholder: 'Director, Operations' },
                  { id: 'birthday',    label: 'Birthday',     type: 'date',  placeholder: '' },
                  { id: 'anniversary', label: 'Anniversary',  type: 'date',  placeholder: '' },
                ].map(f => (
                  <div key={f.id} className="space-y-1.5">
                    <Label htmlFor={f.id}>{f.label}</Label>
                    <Input id={f.id} name={f.id} type={f.type} value={(form as Record<string, string>)[f.id]} onChange={handleChange} placeholder={f.placeholder} />
                  </div>
                ))}
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
                <div className="space-y-1.5">
                  <Label htmlFor="caste">Caste <span className="text-[10px] text-surface-muted">(encrypted)</span></Label>
                  <Input id="caste" name="caste" value={form.caste} onChange={handleChange} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="religion">Religion <span className="text-[10px] text-surface-muted">(encrypted)</span></Label>
                  <Input id="religion" name="religion" value={form.religion} onChange={handleChange} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tags">Tags <span className="text-surface-muted font-normal">(comma separated)</span></Label>
                  <Input id="tags" name="tags" value={form.tags} onChange={handleChange} placeholder="client, vip" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea id="notes" name="notes" value={form.notes} onChange={handleChange} rows={3} placeholder="Additional notes…"
                  className="flex w-full rounded-xl border border-surface-border bg-white px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none" />
              </div>
              <FileUploader label="Profile Photo" hint="JPG or PNG · Max 1 file" maxFiles={1} onChange={setPhotoUrls} />
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={saving} className="gap-2">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><Save className="w-4 h-4" />Save Changes</>}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        )}

        {/* ── Activity Timeline ─────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-brand-500" />
              </div>
              <span className="font-bold text-sm text-gray-900">Activity Timeline</span>
            </div>
            <AddTimelineDialog contactId={id} onAdded={fetchContact} />
          </div>

          {!contact?.timeline?.length ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Camera className="w-8 h-8 text-brand-200 mb-2" />
              <p className="text-sm font-medium text-gray-700">No activity logged yet</p>
              <p className="text-xs text-surface-muted mt-0.5">Log a call, meeting, or note to track interactions.</p>
            </div>
          ) : (
            <div className="p-5 space-y-0">
              {contact.timeline.map((entry, i) => {
                const meta = TIMELINE_META[entry.type] || TIMELINE_META.note
                const Icon = meta.icon
                const isLast = i === contact.timeline.length - 1
                return (
                  <div key={entry._id} className="flex gap-4">
                    {/* Timeline connector */}
                    <div className="flex flex-col items-center">
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0`}>
                        <Icon className="w-4 h-4 text-white" />
                      </div>
                      {!isLast && <div className="w-0.5 bg-surface-border flex-1 mt-1 mb-1" />}
                    </div>
                    {/* Content */}
                    <div className={`flex-1 pb-4 ${isLast ? '' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-semibold text-gray-900">{entry.title}</p>
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
        </div>

      </main>
    </>
  )
}
