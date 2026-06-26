'use client'
// Communications module — rich email composer.
// AI generate/refine/partial-edit · recipients from CRM + Directory · drafts with versions ·
// send via local Outlook (BCC blast or click-through personalized queue), rich-HTML clipboard
// copy (paste into Outlook keeps formatting), or server SMTP.
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Mail, Loader2, Sparkles, Save, Send, Check, Users, X,
  ClipboardCopy, ListChecks, AlertTriangle, Tag, FileEdit,
} from 'lucide-react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import type { Editor } from '@tiptap/react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { useUser } from '@/lib/useUser'
import MailEditor, { DevicePreviewDialog } from '@/components/mail/MailEditor'

/* ── Types ─────────────────────────────────────────────────── */

type Field = 'to' | 'cc' | 'bcc'
interface Recipient {
  name: string; email: string; company?: string
  field: Field; source: 'contact' | 'directory' | 'manual'
}
interface PickerEntry { name: string; email: string; company?: string; tags?: string[]; source: 'contact' | 'directory' }

/* ── HTML <-> text helpers ─────────────────────────────────── */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Plaintext model output → simple paragraph HTML for the editor
const textToHtml = (text: string) =>
  text.trim().split(/\n{2,}/)
    .map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')

// Rich HTML → plaintext for mailto transport
const htmlToPlain = (html: string) => html
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n\n').replace(/<\/h[1-6]>/gi, '\n\n')
  .replace(/<li[^>]*>/gi, '• ').replace(/<\/li>/gi, '\n')
  .replace(/<hr[^>]*>/gi, '\n――――――――――\n')
  .replace(/<img[^>]*>/gi, '[image]')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n').trim()

const MAILTO_MAX = 1900

/* ── Recipient picker ──────────────────────────────────────── */

function RecipientPicker({ recipients, setRecipients }: {
  recipients: Recipient[]
  setRecipients: React.Dispatch<React.SetStateAction<Recipient[]>>
}) {
  const [entries, setEntries] = useState<PickerEntry[]>([])
  const [query, setQuery] = useState('')
  const [field, setField] = useState<Field>('to')
  const [open, setOpen] = useState(false)
  const [allTags, setAllTags] = useState<string[]>([])
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/crm').then(r => r.json()),
      fetch('/api/employees/directory').then(r => r.json()),
    ]).then(([crm, dir]) => {
      const list: PickerEntry[] = []
      if (crm.status === 'fulfilled' && Array.isArray(crm.value)) {
        for (const c of crm.value) if (c.email) list.push({ name: c.name, email: c.email, company: c.company, tags: c.tags, source: 'contact' })
        setAllTags(Array.from(new Set(crm.value.flatMap((c: { tags?: string[] }) => c.tags || []))))
      }
      if (dir.status === 'fulfilled' && Array.isArray(dir.value)) {
        for (const u of dir.value) if (u.email) list.push({ name: u.name, email: u.email, company: 'Doppelmayr India', source: 'directory' })
      }
      setEntries(list)
    })
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = new Set(recipients.map(r => r.email.toLowerCase()))
  const q = query.toLowerCase()
  const results = q
    ? entries.filter(e => !selected.has(e.email.toLowerCase()) &&
        (e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || (e.company || '').toLowerCase().includes(q)))
        .slice(0, 8)
    : []

  const add = (e: PickerEntry) => {
    setRecipients(rs => [...rs, { name: e.name, email: e.email, company: e.company, field, source: e.source }])
    setQuery(''); setOpen(false)
  }

  const addManual = () => {
    const email = query.trim()
    if (!email.includes('@') || selected.has(email.toLowerCase())) return
    setRecipients(rs => [...rs, { name: email.split('@')[0], email, field, source: 'manual' }])
    setQuery(''); setOpen(false)
  }

  const addTagSegment = (tag: string) => {
    const matching = entries.filter(e => e.source === 'contact' && e.tags?.includes(tag) && !selected.has(e.email.toLowerCase()))
    if (!matching.length) return
    setRecipients(rs => [...rs, ...matching.map(e => ({ name: e.name, email: e.email, company: e.company, field, source: e.source as 'contact' }))])
  }

  const remove = (email: string) => setRecipients(rs => rs.filter(r => r.email !== email))
  const cycle = (email: string) => setRecipients(rs => rs.map(r =>
    r.email === email ? { ...r, field: (r.field === 'to' ? 'cc' : r.field === 'cc' ? 'bcc' : 'to') as Field } : r))

  const FIELD_STYLE: Record<Field, string> = {
    to:  'bg-brand-50 text-brand-700 border-brand-200',
    cc:  'bg-amber-50 text-amber-700 border-amber-200',
    bcc: 'bg-purple-50 text-purple-700 border-purple-200',
  }

  return (
    <div className="space-y-3">
      {/* Add-to field selector + search */}
      <div className="flex gap-2">
        <div className="flex rounded-xl border border-surface-border overflow-hidden flex-shrink-0">
          {(['to', 'cc', 'bcc'] as Field[]).map(f => (
            <button key={f} type="button" onClick={() => setField(f)}
              className={`px-2.5 py-2 text-[11px] font-bold uppercase transition-all ${field === f ? 'bg-brand-500 text-white' : 'bg-surface-1 text-surface-muted hover:bg-surface'}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="relative flex-1" ref={boxRef}>
          <input type="text" value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (results.length) add(results[0]); else addManual() } }}
            placeholder="Search contacts & directory, or type an email…"
            className="w-full h-9 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          {open && query && (
            <div className="absolute z-20 mt-1 w-full bg-surface-1 rounded-xl border border-surface-border shadow-lg overflow-hidden">
              {results.map(e => (
                <button key={e.email} type="button" onClick={() => add(e)}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-brand-50 transition-colors">
                  <div className="w-7 h-7 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-brand-700 font-bold text-[9px]">
                      {e.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink truncate">{e.name}</p>
                    <p className="text-[10px] text-surface-muted truncate">{e.email}{e.company ? ` · ${e.company}` : ''}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${e.source === 'directory' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {e.source === 'directory' ? 'Staff' : 'CRM'}
                  </span>
                </button>
              ))}
              {query.includes('@') && !results.some(r => r.email.toLowerCase() === query.trim().toLowerCase()) && (
                <button type="button" onClick={addManual}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-brand-50 transition-colors border-t border-surface-border">
                  <Mail className="w-3.5 h-3.5 text-surface-muted" />
                  <span className="text-xs text-ink-muted">Add <strong>{query.trim()}</strong></span>
                </button>
              )}
              {!results.length && !query.includes('@') && (
                <p className="px-3 py-2.5 text-xs text-surface-muted">No matches — type a full email to add manually.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tag segments */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag className="w-3 h-3 text-surface-muted flex-shrink-0" />
          {allTags.map(t => (
            <button key={t} type="button" onClick={() => addTagSegment(t)}
              title={`Add all contacts tagged "${t}" to ${field.toUpperCase()}`}
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-1 border border-surface-border text-ink-muted hover:border-brand-400 hover:text-brand-700 transition-all">
              +{t}
            </button>
          ))}
        </div>
      )}

      {/* Selected chips, grouped by field */}
      {(['to', 'cc', 'bcc'] as Field[]).map(f => {
        const group = recipients.filter(r => r.field === f)
        if (!group.length) return null
        return (
          <div key={f} className="flex items-start gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-surface-muted w-7 pt-1.5 flex-shrink-0">{f}</span>
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {group.map(r => (
                <span key={r.email} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-semibold border ${FIELD_STYLE[f]} max-w-full`}>
                  <button type="button" onClick={() => cycle(r.email)} title={`${r.name} <${r.email}> — click to move to ${f === 'to' ? 'CC' : f === 'cc' ? 'BCC' : 'TO'}`}
                    className="truncate hover:underline">
                    {r.name}
                  </button>
                  <button type="button" onClick={() => remove(r.email)} aria-label={`Remove ${r.name}`}
                    className="p-0.5 rounded-full hover:bg-black/10 transition-colors flex-shrink-0">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )
      })}
      {recipients.length > 0 && (
        <p className="text-[10px] text-surface-muted">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''} · click a name to cycle To → Cc → Bcc</p>
      )}
    </div>
  )
}

/* ── Pre-send confirmation ─────────────────────────────────── */

function ConfirmSendDialog({ open, onOpenChange, title, recipients, onConfirm, confirmLabel, busy }: {
  open: boolean; onOpenChange: (o: boolean) => void
  title: string; recipients: Recipient[]; onConfirm: () => void; confirmLabel: string; busy?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-base font-bold text-ink mb-1 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> {title}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">
            Double-check every recipient before sending — this list is exactly who receives the mail.
          </Dialog.Description>
          <div className="space-y-1.5 mb-5 max-h-64 overflow-y-auto pr-1">
            {recipients.map(r => (
              <div key={r.email} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface border border-surface-border">
                <span className="text-[9px] font-bold uppercase w-7 text-surface-muted flex-shrink-0">{r.field}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink truncate">{r.name}</p>
                  <p className="text-[10px] text-surface-muted truncate">{r.email}</p>
                </div>
                {r.company && <Badge variant="secondary" className="text-[9px] flex-shrink-0">{r.company.split(' ')[0]}</Badge>}
              </div>
            ))}
          </div>
          <div className="flex gap-3 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
            <Button type="button" size="sm" onClick={onConfirm} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ── Click-through queue (personalized, one draft per click) ── */

function QueueSendDialog({ open, onOpenChange, recipients, subject, bodyPlain }: {
  open: boolean; onOpenChange: (o: boolean) => void
  recipients: Recipient[]; subject: string; bodyPlain: string
}) {
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => { if (open) setDone(new Set()) }, [open])

  const openDraft = (r: Recipient) => {
    const personal = bodyPlain
      .replace(/\{\{name\}\}/gi, r.name)
      .replace(/\{\{company\}\}/gi, r.company || 'your team')
    const subj = encodeURIComponent(subject)
    const body = encodeURIComponent(personal.slice(0, MAILTO_MAX))
    // Direct click → user gesture preserved → browser allows the mailto launch (loops get blocked)
    window.location.href = `mailto:${r.email}?subject=${subj}&body=${body}`
    setDone(d => new Set(d).add(r.email))
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[85vh] flex flex-col">
          <Dialog.Title className="text-base font-bold text-ink mb-1 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-brand-500" /> Personalized drafts — click through
          </Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">
            Browsers only allow one Outlook draft per click. Open each personalized draft, send it in Outlook, come back for the next.
            {' '}<strong>{done.size}/{recipients.length} opened.</strong>
          </Dialog.Description>
          <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
            {recipients.map(r => {
              const isDone = done.has(r.email)
              return (
                <div key={r.email} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${isDone ? 'bg-green-50 border-green-200' : 'bg-surface border-surface-border'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink truncate">{r.name}</p>
                    <p className="text-[10px] text-surface-muted truncate">{r.email}</p>
                  </div>
                  <Button type="button" size="sm" variant={isDone ? 'outline' : 'default'} className="gap-1.5 flex-shrink-0"
                    onClick={() => openDraft(r)}>
                    {isDone ? <><Check className="w-3 h-3 text-green-600" /> Re-open</> : <><Send className="w-3 h-3" /> Open draft</>}
                  </Button>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end pt-4">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Done</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ── Main compose page ─────────────────────────────────────── */

const AI_TYPES = ['Follow-up', 'Meeting request', 'Introduction', 'Announcement', 'Thank you']
const REFINE_PRESETS = ['Shorter', 'More formal', 'Friendlier', 'Add a clear call-to-action']

function MailComposeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { user } = useUser()
  const role = user?.role || 'employee'

  const [draftId, setDraftId]       = useState<string | null>(null)
  const [subject, setSubject]       = useState('')
  const [bodyHtml, setBodyHtml]     = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [savedAt, setSavedAt]       = useState<Date | null>(null)
  const [saving, setSaving]         = useState(false)
  const [draftError, setDraftError] = useState(false)

  // AI state
  const [aiType, setAiType]         = useState('Follow-up')
  const [aiContext, setAiContext]   = useState('')
  const [generating, setGenerating] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [withSignature, setWithSignature] = useState(true)
  const [designation, setDesignation] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Partial edit
  const [selText, setSelText]       = useState('')
  const [partialInstr, setPartialInstr] = useState('')
  const [partialBusy, setPartialBusy] = useState(false)

  // Send dialogs
  const [confirmMode, setConfirmMode] = useState<'outlook' | 'server' | null>(null)
  const [queueOpen, setQueueOpen]   = useState(false)
  const [serverBusy, setServerBusy] = useState(false)
  const [copied, setCopied]         = useState(false)

  const editorRef = useRef<Editor | null>(null)
  const onEditorReady = useCallback((e: Editor) => {
    editorRef.current = e
    e.on('selectionUpdate', () => {
      const { from, to } = e.state.selection
      setSelText(from === to ? '' : e.state.doc.textBetween(from, to, '\n'))
    })
  }, [])

  // Load draft from ?draft=
  const loadDraft = useCallback(async () => {
    const id = searchParams.get('draft')
    if (!id) return
    try {
      const res = await fetch(`/api/mail/drafts/${id}`)
      if (!res.ok) {
        // 404 → draft genuinely gone; surface a toast, no error pane
        if (res.status === 404) { toast('Draft not found', 'error'); setDraftError(false); return }
        throw new Error('fetch failed')
      }
      const d = await res.json()
      if (!d) { toast('Draft not found', 'error'); setDraftError(false); return }
      setDraftId(d._id); setSubject(d.subject || ''); setBodyHtml(d.bodyHtml || '')
      setRecipients(d.recipients || []); setSavedAt(new Date(d.updatedAt))
      setDraftError(false)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setDraftError(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => { loadDraft() }, [loadDraft])

  // Designation for the signature block
  useEffect(() => {
    fetch('/api/employees/me').then(r => r.ok ? r.json() : null)
      .then(emp => { if (emp?.designation) setDesignation(emp.designation) }).catch(() => {})
  }, [])

  const userName = user?.fullName || user?.firstName || ''
  const signatureHtml = `<p style="margin-top:18px">Best regards,</p><p><strong>${escapeHtml(userName)}</strong>${designation ? `<br>${escapeHtml(designation)}` : ''}<br>Doppelmayr India Pvt Ltd</p>`

  const bodyPlain = htmlToPlain(bodyHtml)
  const ready = recipients.length > 0 && !!subject.trim() && !!bodyPlain

  /* ── Drafts ── */
  const saveDraft = async () => {
    setSaving(true)
    try {
      const payload = { subject, bodyHtml, recipients }
      if (draftId) {
        const res = await fetch(`/api/mail/drafts/${draftId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error()
      } else {
        const res = await fetch('/api/mail/drafts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error()
        const d = await res.json()
        setDraftId(d._id)
        router.replace(`/mail?draft=${d._id}`)
      }
      setSavedAt(new Date())
      toast('Draft saved', 'success')
    } catch { toast('Failed to save draft', 'error') }
    finally { setSaving(false) }
  }

  /* ── AI generate / refine ── */
  const splitSubject = (raw: string): { subject: string; body: string } => {
    const m = raw.match(/^\s*SUBJECT:\s*(.*?)(?:\n|$)([\s\S]*)$/i)
    if (m) return { subject: m[1].trim(), body: m[2].replace(/^\s+/, '') }
    return { subject: '', body: raw }
  }

  const generate = async (refineInstruction?: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    try {
      const toNames = recipients.filter(r => r.field === 'to').map(r => r.name).slice(0, 3).join(', ')
      const multi = recipients.length > 1
      const payload = refineInstruction
        ? { refineInstruction, currentDraft: bodyPlain }
        : {
            prompt: `Write a professional business email from Doppelmayr India (urban ropeway and cable car infrastructure company).
Email type: ${aiType}.${aiContext.trim() ? ` Goal/context: ${aiContext.trim()}.` : ''}
${toNames ? `Recipient(s): ${toNames}.` : 'Recipients: business stakeholders.'}
${multi ? 'Use {{name}} and {{company}} placeholders so each recipient can be personalized.' : ''}
Keep it concise (4-6 sentences), professional, with a clear call to action. Do NOT include a signature block or sign-off name.
Begin your output with a single line "SUBJECT: <a concise email subject, max 8 words>" then a blank line, then the email body.`,
          }
      const res = await fetch('/api/crm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Generation failed') }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break
          try {
            const { token } = JSON.parse(data); acc += token
            const { subject: s, body: b } = splitSubject(acc)
            if (s) setSubject(s)
            setBodyHtml(textToHtml(b))
          } catch { /* partial chunk */ }
        }
      }
      // Final pass: append signature if enabled
      const { subject: s, body: b } = splitSubject(acc)
      if (s) setSubject(s)
      setBodyHtml(textToHtml(b) + (withSignature ? signatureHtml : ''))
      setRefineText('')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(e instanceof Error ? e.message : 'Generation failed', 'error')
    } finally { setGenerating(false) }
  }

  /* ── AI partial edit (rewrite selection only) ── */
  const rewriteSelection = async () => {
    const editor = editorRef.current
    if (!editor || !selText || !partialInstr.trim()) return
    setPartialBusy(true)
    try {
      const { from, to } = editor.state.selection
      const res = await fetch('/api/crm/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Rewrite ONLY the following excerpt from a business email to: ${partialInstr.trim()}.
Keep the same general meaning and a professional tone. Output ONLY the rewritten excerpt, nothing else — no quotes, no preamble.

Excerpt:
"""${selText}"""`,
        }),
      })
      const data = await res.json()
      const rewritten = (data.text || data.message || '').trim()
      if (!rewritten) throw new Error(data.error || 'Empty response')
      editor.chain().focus()
        .deleteRange({ from, to })
        .insertContentAt(from, escapeHtml(rewritten).replace(/\n/g, '<br>'))
        .run()
      setBodyHtml(editor.getHTML())
      setPartialInstr(''); setSelText('')
      toast('Selection rewritten', 'success')
    } catch (e) { toast(e instanceof Error ? e.message : 'Rewrite failed', 'error') }
    finally { setPartialBusy(false) }
  }

  /* ── Send: server SMTP ── */
  const sendServer = async () => {
    setServerBusy(true)
    try {
      const res = await fetch('/api/crm/campaign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          bodyTemplate: bodyHtml,
          isHtml: true,
          recipients: recipients.map(r => ({ name: r.name, email: r.email, company: r.company })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      toast(`Sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}${data.failed ? `, ${data.failed} failed` : ''}`, data.failed ? 'info' : 'success')
      setConfirmMode(null)
    } catch (e) { toast(e instanceof Error ? e.message : 'Send failed', 'error') }
    finally { setServerBusy(false) }
  }

  /* ── Copy rich HTML (paste into Outlook keeps formatting) ── */
  const copyRichHtml = async () => {
    const wrapped = `<div style="font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${bodyHtml}</div>`
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html':  new Blob([wrapped], { type: 'text/html' }),
          'text/plain': new Blob([bodyPlain], { type: 'text/plain' }),
        }),
      ])
      setCopied(true); setTimeout(() => setCopied(false), 2500)
      toast('Rich HTML copied — paste into an Outlook draft to keep formatting', 'success')
    } catch {
      // ClipboardItem unsupported → plaintext fallback
      await navigator.clipboard.writeText(bodyPlain).catch(() => {})
      toast('Rich copy unsupported here — plain text copied instead', 'info')
    }
  }

  const canServerSend = role === 'manager' || role === 'admin'
  // 10B: employees need granted mailAccess to use the mass-mail tool
  const hasMailAccess = role === 'admin' || role === 'manager' || user?.mailAccess === true

  if (user && !hasMailAccess) {
    return (
      <>
        <Header title="Compose Mail" />
        <main className="flex-1 p-5 lg:p-8 flex items-center justify-center">
          <EmptyState
            icon={AlertTriangle}
            title="Mail access not granted"
            description="The mass-mail tool is available to managers and admins. Ask your administrator to grant you access."
            action={{ label: 'Back to Dashboard', href: '/dashboard' }}
          />
        </main>
      </>
    )
  }

  return (
    <>
      <Header title="Compose Mail" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-7xl space-y-5 w-full mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-ink flex items-center gap-2">
              <Mail className="w-5 h-5 text-brand-500" /> Communications
            </h2>
            <p className="text-xs text-surface-muted mt-0.5">
              Compose rich emails · send via your local Outlook or server
              {savedAt && ` · saved ${savedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/mail/drafts">
              <Button type="button" variant="outline" size="sm" className="gap-1.5"><FileEdit className="w-3.5 h-3.5" /> Drafts</Button>
            </Link>
            <Button type="button" size="sm" onClick={saveDraft} disabled={saving || (!subject && !bodyPlain)} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save draft
            </Button>
          </div>
        </div>

        {draftError && !draftId && !subject && !bodyPlain ? (
          <ErrorState onRetry={() => loadDraft()} />
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
          {/* ── Left: compose ── */}
          <div className="space-y-4 min-w-0">
            <Card className="rounded-2xl">
              <CardContent className="pt-5 space-y-4">
                {/* Recipients */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Recipients</Label>
                  <RecipientPicker recipients={recipients} setRecipients={setRecipients} />
                </div>

                {/* Subject */}
                <div className="space-y-1.5">
                  <Label htmlFor="mail-subject">Subject</Label>
                  <Input id="mail-subject" value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder="e.g. Doppelmayr India — Ropeway Project Update" />
                </div>

                {/* Body */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label>Body</Label>
                    <div className="flex items-center gap-2">
                      <DevicePreviewDialog getHtml={() => bodyHtml} subject={subject} />
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!bodyPlain}
                        onClick={copyRichHtml} title="Copy formatted HTML — paste into an Outlook draft to keep styling">
                        {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                        Copy rich HTML
                      </Button>
                    </div>
                  </div>
                  <MailEditor value={bodyHtml} onChange={setBodyHtml} onEditorReady={onEditorReady}
                    placeholder="Write your email, or let AI draft it… Use {{name}} and {{company}} for personalization." minHeight={300} />
                  <p className="text-[10px] text-surface-muted">
                    Placeholders {'{{name}}'} / {'{{company}}'} fill per-recipient in queue &amp; server sends · {bodyPlain.length} chars plaintext
                  </p>
                </div>

                {/* Partial edit — appears when text is selected */}
                {selText && (
                  <div className="flex gap-1.5 items-center p-2.5 rounded-xl bg-purple-50 border border-purple-200">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
                    <input type="text" value={partialInstr} onChange={e => setPartialInstr(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && partialInstr.trim()) rewriteSelection() }}
                      placeholder={`Rewrite selection (${selText.length} chars) — e.g. "make this more direct"`}
                      className="flex-1 h-8 px-2.5 rounded-lg border border-purple-200 bg-surface-1 text-xs focus:outline-none focus:border-purple-400" />
                    <Button type="button" size="sm" disabled={partialBusy || !partialInstr.trim()} onClick={rewriteSelection}
                      className="gap-1 bg-purple-600 hover:bg-purple-700 flex-shrink-0">
                      {partialBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      Rewrite
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Right: AI + send ── */}
          <div className="space-y-4 min-w-0">
            {/* AI assist */}
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-400 to-violet-600 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  AI Assist
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {AI_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setAiType(t)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all
                        ${aiType === t ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-surface-border text-ink-muted hover:border-surface-border'}`}>
                      {t}
                    </button>
                  ))}
                </div>
                <textarea value={aiContext} onChange={e => setAiContext(e.target.value)} rows={2}
                  placeholder="Goal/context — e.g. follow up on the Varanasi ropeway proposal, ask for a decision timeline"
                  className="w-full rounded-xl border border-surface-border px-3 py-2 text-xs resize-none focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-300/20" />
                <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                  <input type="checkbox" checked={withSignature} onChange={e => setWithSignature(e.target.checked)}
                    className="rounded border-surface-border text-brand-500 focus:ring-brand-500/30" />
                  Append my signature ({userName || 'name'}{designation ? ` · ${designation}` : ''})
                </label>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => generate()} disabled={generating}
                    className="flex-1 gap-2 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 border-0 text-white">
                    <Sparkles className="w-4 h-4" />
                    {generating ? 'Writing…' : bodyPlain ? 'Regenerate' : 'Generate email'}
                  </Button>
                  {generating && (
                    <Button type="button" variant="outline" onClick={() => { abortRef.current?.abort(); setGenerating(false) }}
                      className="text-red-500 border-red-200 hover:bg-red-50">Stop</Button>
                  )}
                </div>

                {/* Refine */}
                {bodyPlain && !generating && (
                  <div className="space-y-2 pt-2 border-t border-surface-border">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Refine draft</p>
                    <div className="flex flex-wrap gap-1.5">
                      {REFINE_PRESETS.map(p => (
                        <button key={p} type="button" onClick={() => generate(p.toLowerCase())}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors">
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input type="text" value={refineText} onChange={e => setRefineText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && refineText.trim()) generate(refineText.trim()) }}
                        placeholder="e.g. mention the site visit, keep under 5 lines"
                        className="flex-1 h-8 px-2.5 rounded-xl border border-surface-border text-xs focus:outline-none focus:border-purple-300" />
                      <button type="button" disabled={!refineText.trim()} onClick={() => generate(refineText.trim())}
                        className="px-2.5 h-8 rounded-xl text-[11px] font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors">
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Send */}
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Send className="w-4 h-4 text-brand-500" /> Send</CardTitle>
                <p className="text-xs text-surface-muted">Sends rich HTML through the company server, personalized per recipient.</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Outlook send paths hidden — server send is the only channel for now. */}
                <Button type="button" className="w-full gap-2" disabled={!ready || !canServerSend}
                  onClick={() => setConfirmMode('server')} title="Send rich HTML through the server (per-recipient personalized)">
                  <Mail className="w-4 h-4" /> Send via server
                </Button>
                {!canServerSend && (
                  <p className="text-[11px] text-surface-muted text-center pt-1">
                    Server sending isn’t enabled for your account.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        )}

        {/* Dialogs */}
        <ConfirmSendDialog
          open={confirmMode !== null}
          onOpenChange={o => { if (!o) setConfirmMode(null) }}
          title="Send via server to these recipients?"
          recipients={recipients}
          confirmLabel="Send now"
          busy={serverBusy}
          onConfirm={sendServer}
        />
        <QueueSendDialog open={queueOpen} onOpenChange={setQueueOpen}
          recipients={recipients} subject={subject} bodyPlain={bodyPlain} />
      </main>
    </>
  )
}

export default function MailComposePage() {
  return (
    <Suspense fallback={
      <>
        <Header title="Compose Mail" />
        <main className="flex-1 p-5"><div className="h-40 rounded-2xl bg-surface-border animate-pulse" /></main>
      </>
    }>
      <MailComposeInner />
    </Suspense>
  )
}
