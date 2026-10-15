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
  'from-brand-400 to-brand-600', 'from-indigo-400 to-indigo-600',
  'from-sky-400 to-blue-600',    'from-emerald-400 to-teal-600',
  'from-violet-400 to-purple-600','from-slate-400 to-slate-600',
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
        <p className="text-sm font-semibold text-ink truncate">{value}</p>
      </div>
      <button type="button" onClick={copy} title={copied ? 'Copied' : 'Copy'} aria-label="Copy"
        className="p-1 rounded-md text-surface-muted hover:text-brand-600 hover:bg-surface-1 transition-colors flex-shrink-0">
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
    try {
      const res = await fetch(`/api/crm/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderDate: date || null, reminderNote: note }),
      })
      if (!res.ok) throw new Error()
      toast('Reminder saved', 'success')
      onSaved()
    } catch { toast('Could not save the reminder', 'error') }
    setSaving(false)
  }

  const clear = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/crm/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderDate: null, reminderNote: '' }),
      })
      if (!res.ok) throw new Error()
      setDate(''); setNote('')
      toast('Reminder cleared')
      onSaved()
    } catch { toast('Could not clear the reminder', 'error') }
    setSaving(false)
  }

  const today0 = new Date(); today0.setHours(0,0,0,0)
  const daysUntil = date ? Math.round((new Date(date).getTime() - today0.getTime()) / 86400000) : null
  const friendly = daysUntil === null ? '' :
    daysUntil < 0  ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue` :
    daysUntil === 0 ? 'Today' :
    daysUntil === 1 ? 'Tomorrow' :
    daysUntil <= 7  ? `In ${daysUntil} days` :
                      new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  const hasSaved = !!reminderDate
  const isDirty  = (date !== (reminderDate?.split('T')[0] || '')) || (note !== (reminderNote || ''))

  return (
    <div className={`col-span-2 rounded-2xl border overflow-hidden ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-surface border-surface-border'}`}>
      {/* Header strip */}
      <div className={`flex items-center justify-between gap-2 px-4 py-2.5 border-b ${isOverdue ? 'border-red-200 bg-red-100/50' : 'border-surface-border bg-surface-1/60'}`}>
        <p className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${isOverdue ? 'text-red-600' : 'text-surface-muted'}`}>
          <Bell className="w-3.5 h-3.5" /> Follow-up reminder
        </p>
        {hasSaved && friendly && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
            ${isOverdue ? 'bg-red-200 text-red-800'
              : daysUntil !== null && daysUntil <= 1 ? 'bg-amber-100 text-amber-800'
              : 'bg-brand-100 text-brand-700'}`}>
            {friendly}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3">
          <div className="space-y-1">
            <label htmlFor={`rd-${contactId}`} className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Date</label>
            <input id={`rd-${contactId}`} type="date" value={date} onChange={e => setDate(e.target.value)}
              min={today0.toISOString().split('T')[0]}
              className="h-10 w-full sm:w-44 px-3 rounded-xl border border-surface-border bg-surface-1 text-sm focus:outline-none focus:border-brand-500" />
          </div>
          <div className="space-y-1 min-w-0">
            <label htmlFor={`rn-${contactId}`} className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Note</label>
            <input id={`rn-${contactId}`} type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Follow up on Q2 proposal"
              className="w-full h-10 px-3 rounded-xl border border-surface-border bg-surface-1 text-sm focus:outline-none focus:border-brand-500" />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end pt-1">
          {hasSaved && (
            <button type="button" onClick={clear} disabled={saving}
              className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
              Clear reminder
            </button>
          )}
          <Button type="button" size="sm" onClick={save}
            disabled={saving || !date || (!isDirty && hasSaved)}
            className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            {hasSaved ? (isDirty ? 'Update reminder' : 'Saved') : 'Set reminder'}
          </Button>
        </div>
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
      const res = await fetch(`/api/crm/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timelineEntry: { ...form, source: 'manual', date: new Date() } }),
      })
      if (!res.ok) throw new Error()
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
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-ink mb-4">Log Activity</Dialog.Title>
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
  const [subject,    setSubject]    = useState('')
  const [charCount,  setCharCount]  = useState(0)
  const [copied,     setCopied]     = useState(false)
  const [refineText, setRefineText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const toast = useToast()

  // Split a raw model output of "SUBJECT: x\n\n<body>" into { subject, body }.
  const splitSubject = (raw: string): { subject: string; body: string } => {
    const m = raw.match(/^\s*SUBJECT:\s*(.*?)(?:\n|$)([\s\S]*)$/i)
    if (m) return { subject: m[1].trim(), body: m[2].replace(/^\s+/, '') }
    return { subject: '', body: raw }
  }

  // refine: when set, rewrite currentDraft per instruction instead of fresh-gen
  const generate = async (refineInstruction?: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    if (!refineInstruction) { setMessage(''); setSubject(''); setCharCount(0) }
    try {
      const payload = refineInstruction
        ? { refineInstruction, currentDraft: message }
        : { contactId, messageType: type, context: context.trim() || undefined }
      const res = await fetch('/api/crm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(payload),
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
          try {
            const { token } = JSON.parse(data); acc += token
            const { subject: s, body: b } = splitSubject(acc)
            if (s) setSubject(s)
            setMessage(b); setCharCount(b.length)
          } catch { /* skip */ }
        }
      }
      setRefineText('')
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
      birthday: 'Birthday Greetings', 'follow-up': 'Follow-Up', 'meeting-request': 'Meeting Request', introduction: 'Introduction',
    }
    const subjectEnc = encodeURIComponent(subject.trim() || subjectMap[type] || 'Message')
    let body = encodeURIComponent(message)
    // mailto URLs cap ~2000 chars across browsers; trim body so Outlook draft opens with intact text instead of truncated/empty.
    const MAX = 1900
    const overhead = `mailto:${contactEmail}?subject=${subjectEnc}&body=`.length
    if (overhead + body.length > MAX) {
      body = encodeURIComponent(message.slice(0, MAX - overhead) ) // re-encode on trimmed plain text to avoid splitting an escape sequence
      navigator.clipboard?.writeText(message).catch(() => {})
      toast('Message too long for draft — full text copied to clipboard, paste into Outlook', 'info')
    }
    // location.href (not window.open) hands off to the OS mail handler without leaving a blank tab in Citrix browsers.
    window.location.href = `mailto:${contactEmail}?subject=${subjectEnc}&body=${body}`
  }

  const wrapSelection = (prefix: string, suffix: string) => {
    const ta = document.getElementById('gen-msg') as HTMLTextAreaElement
    if (!ta) return
    const s = ta.selectionStart; const e = ta.selectionEnd
    const newMsg = message.slice(0, s) + prefix + message.slice(s, e) + suffix + message.slice(e)
    setMessage(newMsg)
    setTimeout(() => { ta.selectionStart = s + prefix.length; ta.selectionEnd = e + prefix.length; ta.focus() }, 0)
  }

  const reset = () => { setMessage(''); setSubject(''); setContext(''); setRefineText(''); setCharCount(0); abortRef.current?.abort() }

  const REFINE_PRESETS = ['Shorter', 'More formal', 'Friendlier', 'Add a clear call-to-action']

  return (
    <Dialog.Root open={open} onOpenChange={o => { setOpen(o); if (!o) reset() }}>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50">
          <Sparkles className="w-3.5 h-3.5" /> AI Message
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-surface-1 border-b border-surface-border px-6 py-4 flex items-center justify-between z-10 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-400 to-violet-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-bold text-ink">AI Message Generator</Dialog.Title>
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
                      ${type === val ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-surface-border text-ink-muted hover:border-surface-border'}`}>
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
              <Button type="button" onClick={() => generate()} disabled={generating}
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
                {/* AI-generated subject (editable) */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Subject</label>
                  <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder={generating ? 'Generating…' : 'Subject line'}
                    className="w-full h-9 px-3 rounded-xl border border-purple-100 bg-purple-50/20 text-sm focus:outline-none focus:border-purple-200 text-ink" />
                </div>
                <div className="flex items-center gap-1 p-1.5 bg-surface rounded-xl border border-surface-border">
                  <button type="button" onClick={() => wrapSelection('**', '**')}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-ink-muted hover:bg-surface-1 hover:shadow-sm transition-all" title="Bold">B</button>
                  <button type="button" onClick={() => wrapSelection('_', '_')}
                    className="px-2.5 py-1 rounded-lg text-xs italic text-ink-muted hover:bg-surface-1 hover:shadow-sm transition-all" title="Italic">I</button>
                  <button type="button" onClick={() => wrapSelection('\n• ', '')}
                    className="px-2.5 py-1 rounded-lg text-xs text-ink-muted hover:bg-surface-1 hover:shadow-sm transition-all" title="Bullet">•</button>
                  <div className="w-px h-4 bg-surface-border mx-1" />
                  <button type="button" onClick={copy}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted hover:bg-surface-1 hover:shadow-sm transition-all">
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
                  className="w-full rounded-xl border border-purple-100 bg-purple-50/20 px-3.5 py-3 text-sm resize-none focus:outline-none focus:border-purple-200 leading-relaxed text-ink" />
                <p className="text-[10px] text-surface-muted text-right">{charCount} chars · Edit before sending</p>

                {/* Iterative refine — presets + free-text feedback */}
                {message && !generating && (
                  <div className="space-y-2 pt-2 border-t border-surface-border">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Refine</p>
                    <div className="flex flex-wrap gap-1.5">
                      {REFINE_PRESETS.map(p => (
                        <button key={p} type="button" onClick={() => generate(p.toLowerCase())}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors">
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input type="text" value={refineText} onChange={e => setRefineText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && refineText.trim()) generate(refineText.trim()) }}
                        placeholder="e.g. mention the Tirupati project, keep under 4 lines"
                        className="flex-1 h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-purple-300" />
                      <button type="button" disabled={!refineText.trim()} onClick={() => generate(refineText.trim())}
                        className="px-3 h-9 rounded-xl text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors">
                        Apply
                      </button>
                    </div>
                  </div>
                )}
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
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = token ? `${origin}/contact/${token}` : ''

  const fetchLink = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/crm/${contactId}/share`)
    const data = await res.json()
    setToken(data.token || null)
    setLoading(false)
  }, [contactId])

  useEffect(() => { if (open) fetchLink() }, [open, fetchLink])

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const regenerate = async () => {
    setLoading(true)
    const res = await fetch(`/api/crm/${contactId}/share`, { method: 'POST' })
    const data = await res.json()
    setToken(data.token || null)
    setLoading(false)
  }

  const revoke = async () => {
    setLoading(true)
    await fetch(`/api/crm/${contactId}/share`, { method: 'DELETE' })
    setToken(null)
    setLoading(false)
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
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-ink mb-1">Share Contact Card</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">
            Scan QR or copy link to share {contactName}&apos;s public contact page.
          </Dialog.Description>
          {loading || !shareUrl ? (
            <div className="flex justify-center items-center mb-4 p-4 bg-surface rounded-2xl border border-surface-border h-[192px]">
              <Loader2 className="w-5 h-5 animate-spin text-surface-muted" />
            </div>
          ) : (
            <div className="flex justify-center mb-4 p-4 bg-surface rounded-2xl border border-surface-border">
              <QRCodeSVG value={shareUrl} size={160} marginSize={4} />
            </div>
          )}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface border border-surface-border mb-4">
            <p className="text-xs text-ink-muted flex-1 truncate">{shareUrl || 'Generating link…'}</p>
            <button type="button" onClick={copy} disabled={!shareUrl} className="flex-shrink-0 text-brand-500 hover:text-brand-700 transition-colors disabled:opacity-40">
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-2 justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={regenerate} disabled={loading}>Regenerate</Button>
              <Button type="button" variant="outline" size="sm" onClick={revoke} disabled={loading || !token} className="gap-1.5 text-red-600 hover:text-red-700">
                <XCircle className="w-3.5 h-3.5" /> Revoke
              </Button>
            </div>
            <div className="flex gap-3">
              <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Close</Button></Dialog.Close>
              <a href={shareUrl || '#'} target="_blank" rel="noreferrer">
                <Button type="button" size="sm" disabled={!shareUrl} className="gap-1.5"><QrCode className="w-3.5 h-3.5" /> Open Page</Button>
              </a>
            </div>
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
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })   // a 404/403 body is an error, not a contact
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
      .catch(() => { setError('Failed to load contact. It may not exist, or you may not have access to it.'); setLoading(false) })
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
    try {
      const res = await fetch(`/api/crm/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Contact deleted', 'info')
      router.push('/crm')
    } catch {
      toast('Could not delete this contact. You may not have permission.', 'error')
      setDeleting(false)
    }
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

        {/* ── Profile hero (brand-blue banner; avatar keeps a per-name accent) ── */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex items-start gap-5 flex-wrap">
            <div className="flex-shrink-0">
              {contact?.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={contact.photo} alt={contact.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-white/30" />
              ) : (
                <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center border-2 border-white/25 shadow-lg`}>
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
                    <span key={tag} className="text-[11px] font-semibold bg-white/25 border border-white/20 text-white px-2.5 py-0.5 rounded-full">{tag}</span>
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
                <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                  <Dialog.Title className="text-base font-bold text-ink mb-1">Delete contact</Dialog.Title>
                  <Dialog.Description className="text-sm text-surface-muted mb-5">
                    Permanently delete <strong className="text-ink">{contact?.name}</strong>? This cannot be undone.
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
                <p className="text-sm text-ink-muted whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
            <ReminderCard contactId={contact._id} reminderDate={contact.reminderDate} reminderNote={contact.reminderNote} onSaved={fetchContact} />
          </div>
        )}

        {/* ── Edit form ─────────────────────────────────────── */}
        {editing && (
          <div className="bg-surface-1 rounded-2xl border border-surface-border p-5">
            <h3 className="font-bold text-ink mb-4">Edit Contact</h3>
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
                    className="flex h-10 w-full rounded-xl border border-surface-border bg-surface-1 px-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
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
                  className="flex w-full rounded-xl border border-surface-border bg-surface-1 px-3.5 py-2.5 text-sm placeholder:text-surface-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none" />
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
        <div className="bg-surface-1 rounded-2xl border border-surface-border overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-brand-500" />
              </div>
              <span className="font-bold text-sm text-ink">Activity Timeline</span>
            </div>
            <AddTimelineDialog contactId={id} onAdded={fetchContact} />
          </div>

          {!contact?.timeline?.length ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Camera className="w-8 h-8 text-brand-200 mb-2" />
              <p className="text-sm font-medium text-ink-muted">No activity logged yet</p>
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
                        <p className="text-sm font-semibold text-ink">{entry.title}</p>
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
