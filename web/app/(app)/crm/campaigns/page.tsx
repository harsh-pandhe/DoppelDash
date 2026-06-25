'use client'
// Email Campaign — segmented bulk outreach with AI drafting, live preview,
// test send, recipient management, Outlook handoff, and send history.
import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft, Send, Sparkles, Users, Loader2, CheckCircle2, Eye, AlertTriangle,
  Search, X, Mail, Wand2, Tag as TagIcon, Plus, History, FlaskConical, ClipboardCopy, Check,
} from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { useUser } from '@/lib/useUser'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import RichTextEditor from '@/components/ui/rich-text-editor'
import { timeAgo } from '@/lib/timeAgo'

interface PreviewContact { _id: string; name: string; email: string; company?: string; designation?: string }
interface CampaignHistory {
  _id: string; subject: string; tag?: string; recipientCount: number
  sent: number; failed: number; channel: string; createdAt: string
}

const SUBJECT_TEMPLATES = [
  'Doppelmayr India — {{topic}} Update',
  'Partnership opportunity with Doppelmayr India',
  'Invitation: {{topic}} briefing',
  'Following up — {{topic}}',
]
const BODY_TEMPLATES: { label: string; html: string }[] = [
  { label: 'Project intro', html: '<p>Dear {{name}},</p><p>I hope this message finds you well. I am reaching out from Doppelmayr India regarding upcoming urban ropeway and cable-car infrastructure opportunities that may be relevant to {{company}}.</p><p>Would you be open to a brief call next week to explore how we can collaborate?</p><p>Warm regards,</p>' },
  { label: 'Event invite', html: '<p>Dear {{name}},</p><p>We would be delighted to invite you and the {{company}} team to an exclusive briefing on next-generation ropeway transit solutions.</p><p>Please let me know if you would like to attend.</p><p>Best regards,</p>' },
  { label: 'Follow-up', html: '<p>Dear {{name}},</p><p>Following up on our earlier conversation — I wanted to check whether you had any questions about our proposal for {{company}}.</p><p>Happy to provide any further details.</p><p>Kind regards,</p>' },
]

export default function CampaignsPage() {
  const toast = useToast()
  const { user } = useUser()
  const role = user?.role || 'employee'
  const hasMailAccess = role === 'admin' || role === 'manager' || user?.mailAccess === true

  const [tag,       setTag]       = useState('')
  const [subject,   setSubject]   = useState('')
  const [body,      setBody]      = useState('')
  const [allContacts, setAllContacts] = useState<PreviewContact[]>([])
  const [excluded,  setExcluded]  = useState<Set<string>>(new Set())   // contact ids removed from this send
  const [search,    setSearch]    = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending,   setSending]   = useState(false)
  const [testing,   setTesting]   = useState(false)
  const [result,    setResult]    = useState<{ sent: number; failed: number } | null>(null)
  const [aiBody,    setAiBody]    = useState(false)
  const [aiSubj,    setAiSubj]    = useState(false)
  const [allTags,   setAllTags]   = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [history,   setHistory]   = useState<CampaignHistory[]>([])
  const [copied,    setCopied]    = useState(false)

  // active recipients = tag-filtered contacts minus excluded
  const recipients = allContacts.filter(c => !excluded.has(c._id))
  const visibleRecipients = search.trim()
    ? recipients.filter(c => `${c.name} ${c.email} ${c.company || ''}`.toLowerCase().includes(search.toLowerCase()))
    : recipients

  useEffect(() => {
    fetch('/api/crm').then(r => r.json()).then((cs: Array<{ tags?: string[] }>) => {
      setAllTags(Array.from(new Set(cs.flatMap(c => c.tags || []))))
    }).catch(() => {})
  }, [])

  const fetchPreview = useCallback(async () => {
    setLoadingPreview(true)
    try {
      const res  = await fetch(`/api/crm/campaign${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`)
      const data = await res.json()
      setAllContacts(data.contacts || [])
      setExcluded(new Set())
    } catch { setAllContacts([]) }
    finally { setLoadingPreview(false) }
  }, [tag])

  useEffect(() => { const t = setTimeout(fetchPreview, 250); return () => clearTimeout(t) }, [fetchPreview])

  const loadHistory = async () => {
    try { const r = await fetch('/api/crm/campaign?history=1'); const d = await r.json(); setHistory(d.history || []) }
    catch { /* */ }
  }
  useEffect(() => { if (showHistory) loadHistory() }, [showHistory])

  /* ── merge-field insert ── */
  const insertField = (field: string) => setBody(b => b + ` {{${field}}}`)

  /* ── AI ── */
  const aiDraftBody = async () => {
    setAiBody(true)
    try {
      const sample = recipients[0]
      const prompt = `Write a professional business email body for a bulk outreach campaign from Doppelmayr India (urban ropeway / cable-car infrastructure).
Target: ${tag ? `contacts tagged "${tag}"` : 'all CRM contacts'}. Sample recipient: ${sample?.name || 'a stakeholder'} from ${sample?.company || 'their company'}.
Concise (3-4 sentences), professional. Use {{name}} and {{company}} placeholders. Output only the body, no subject.`
      const res = await fetch('/api/crm/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })
      const data = await res.json()
      if (data.text) {
        setBody(`<p>${data.text.trim().replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`)
      } else toast('AI draft failed', 'error')
    } catch { toast('AI draft failed', 'error') } finally { setAiBody(false) }
  }
  const aiSubject = async () => {
    setAiSubj(true)
    try {
      const prompt = `Suggest ONE concise, professional email subject line (max 8 words) for a Doppelmayr India outreach campaign${tag ? ` to "${tag}" contacts` : ''} about urban ropeway infrastructure. Output only the subject line, no quotes.`
      const res = await fetch('/api/crm/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })
      const data = await res.json()
      if (data.text) setSubject(data.text.trim().replace(/^["']|["']$/g, '').split('\n')[0])
      else toast('AI subject failed', 'error')
    } catch { toast('AI subject failed', 'error') } finally { setAiSubj(false) }
  }

  const fillSubjectTemplate = (t: string) => setSubject(t.replace('{{topic}}', tag ? tag[0].toUpperCase() + tag.slice(1) : 'Project'))
  const bodyText = body.replace(/<[^>]*>/g, '').trim()
  const ready = recipients.length > 0 && !!subject.trim() && !!bodyText

  /* ── copy rich HTML ── */
  const copyHtml = async () => {
    const html = body.replace(/\{\{name\}\}/gi, 'there').replace(/\{\{company\}\}/gi, 'your team')
    try { await navigator.clipboard.writeText(html); setCopied(true); setTimeout(() => setCopied(false), 1500); toast('HTML copied', 'success') }
    catch { toast('Copy failed', 'error') }
  }

  /* ── test send to self ── */
  const sendTest = async () => {
    if (!subject.trim() || !bodyText) { toast('Subject and body required', 'error'); return }
    const to = user?.email
    if (!to) { toast('No email on your account', 'error'); return }
    setTesting(true)
    try {
      const res = await fetch('/api/crm/campaign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, bodyTemplate: body, isHtml: true, testEmail: to, sampleName: recipients[0]?.name || 'there', sampleCompany: recipients[0]?.company || 'your team' }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Test failed', 'error'); return }
      toast(`Test email sent to ${to}`, 'success')
    } catch { toast('Test send failed', 'error') } finally { setTesting(false) }
  }

  /* ── real send ── */
  const sendCampaign = async () => {
    if (!ready) { toast('Subject, body and at least one recipient required', 'error'); return }
    const typed = window.prompt(`You are about to send a REAL email to ${recipients.length} contact(s). This cannot be undone.\n\nType ${recipients.length} to confirm:`)
    if (typed === null) return
    if (typed.trim() !== String(recipients.length)) { toast('Confirmation did not match — cancelled', 'info'); return }
    setSending(true); setResult(null)
    try {
      const res = await fetch('/api/crm/campaign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject, bodyTemplate: body, isHtml: true,
          recipients: recipients.map(c => ({ name: c.name, email: c.email, company: c.company })),
          tag: tag || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Send failed', 'error'); return }
      setResult({ sent: data.sent, failed: data.failed })
      toast(`Campaign sent to ${data.sent} contact(s)`, 'success')
      if (showHistory) loadHistory()
    } catch { toast('Send failed', 'error') } finally { setSending(false) }
  }

  /* ── Outlook handoff ── */
  const plain = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
  const MAILTO_MAX = 1900
  const openInOutlook = (mode: 'bcc' | 'each') => {
    if (recipients.length === 0) { toast('No recipients', 'error'); return }
    if (!subject.trim()) { toast('Subject required', 'error'); return }
    const bp = plain(body)
    if (!bp) { toast('Body required', 'error'); return }
    if (mode === 'bcc') {
      const bcc = recipients.map(c => c.email).join(';')
      const generic = bp.replace(/\{\{name\}\}/gi, 'there').replace(/\{\{company\}\}/gi, 'your team')
      if (generic.length > MAILTO_MAX) { navigator.clipboard?.writeText(generic).catch(() => {}); toast('Body long — copied; paste into Outlook', 'info') }
      window.location.href = `mailto:?bcc=${bcc}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(generic.slice(0, MAILTO_MAX))}`
      return
    }
    if (recipients.length > 15 && !confirm(`Open ${recipients.length} separate Outlook drafts?`)) return
    recipients.forEach((c, i) => {
      const personal = bp.replace(/\{\{name\}\}/gi, c.name).replace(/\{\{company\}\}/gi, c.company || 'your team')
      setTimeout(() => { const a = document.createElement('a'); a.href = `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(personal.slice(0, MAILTO_MAX))}`; a.click() }, i * 600)
    })
    toast(`Opening ${recipients.length} Outlook draft(s)…`, 'success')
  }

  if (user && !hasMailAccess) {
    return (
      <>
        <Header title="Email Campaign" />
        <main className="flex-1 p-5 lg:p-8 flex items-center justify-center">
          <EmptyState icon={AlertTriangle} title="Mail access not granted"
            description="Email campaigns are available to managers and admins. Ask your administrator to grant you access."
            action={{ label: 'Back to Contacts', href: '/crm' }} />
        </main>
      </>
    )
  }

  return (
    <>
      <Header title="Email Campaign" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full max-w-6xl mx-auto">
        {/* top bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to CRM
          </Link>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setShowHistory(s => !s)}>
            <History className="w-4 h-4" /> {showHistory ? 'Hide history' : 'Campaign history'}
          </Button>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="bg-surface-1 rounded-2xl border border-surface-border p-5">
            <h3 className="text-sm font-bold text-ink mb-3 flex items-center gap-2"><History className="w-4 h-4 text-brand-500" /> Recent campaigns</h3>
            {history.length === 0 ? (
              <p className="text-sm text-surface-muted py-4 text-center">No campaigns sent yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h._id} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                    <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0"><Mail className="w-4 h-4 text-brand-600" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{h.subject}</p>
                      <p className="text-xs text-surface-muted">{timeAgo(h.createdAt)}{h.tag ? ` · tag: ${h.tag}` : ''} · via {h.channel}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-green-600">{h.sent} sent</p>
                      {h.failed > 0 && <p className="text-[10px] text-red-500">{h.failed} failed</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* ── Left (3/5): compose ── */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-surface-1 rounded-2xl border border-surface-border p-5 space-y-4">
              <div>
                <h2 className="text-base font-bold text-ink">Compose Campaign</h2>
                <p className="text-xs text-surface-muted mt-0.5">Bulk email by segment. Use merge fields for personalization.</p>
              </div>

              {/* Segment */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><TagIcon className="w-3.5 h-3.5" /> Target segment</Label>
                <div className="flex gap-1.5 flex-wrap">
                  <button type="button" onClick={() => setTag('')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${!tag ? 'bg-brand-500 text-white' : 'bg-surface-1 border border-surface-border text-ink-muted hover:border-brand-400'}`}>
                    All with email
                  </button>
                  {allTags.map(t => (
                    <button type="button" key={t} onClick={() => setTag(t === tag ? '' : t)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${tag === t ? 'bg-brand-500 text-white' : 'bg-surface-1 border border-surface-border text-ink-muted hover:border-brand-400'}`}>
                      {t}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-surface-muted flex items-center gap-1 pt-0.5">
                  {loadingPreview ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                  {loadingPreview ? 'Loading…' : `${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}${excluded.size ? ` (${excluded.size} removed)` : ''}`}
                </p>
              </div>

              {/* Subject */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="subject">Subject</Label>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50 h-7" onClick={aiSubject} disabled={aiSubj}>
                    {aiSubj ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} AI subject
                  </Button>
                </div>
                <Input id="subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Doppelmayr India — Q2 Project Update" />
                <div className="flex gap-1.5 flex-wrap">
                  {SUBJECT_TEMPLATES.map(t => (
                    <button type="button" key={t} onClick={() => fillSubjectTemplate(t)}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-surface border border-surface-border text-surface-muted hover:border-brand-300 hover:text-brand-600 transition-colors">
                      {t.replace('{{topic}}', '…')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label htmlFor="body">Email body</Label>
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={() => insertField('name')}><Plus className="w-3 h-3" />name</Button>
                    <Button type="button" variant="outline" size="sm" className="gap-1 h-7 text-[11px]" onClick={() => insertField('company')}><Plus className="w-3 h-3" />company</Button>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5 h-7 text-purple-600 border-purple-200 hover:bg-purple-50" onClick={aiDraftBody} disabled={aiBody}>
                      {aiBody ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI draft
                    </Button>
                  </div>
                </div>
                <RichTextEditor value={body} onChange={setBody} placeholder="Dear {{name}}, … Use {{name}} and {{company}} for personalization." minHeight={180} />
                {/* body templates */}
                <div className="flex gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10px] text-surface-muted self-center">Templates:</span>
                  {BODY_TEMPLATES.map(t => (
                    <button type="button" key={t.label} onClick={() => setBody(t.html)}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-surface border border-surface-border text-surface-muted hover:border-brand-300 hover:text-brand-600 transition-colors">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {result && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-800">Sent — <strong>{result.sent}</strong> delivered{result.failed > 0 ? `, ${result.failed} failed` : ''}.</p>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" className="gap-1.5" onClick={sendTest} disabled={testing || !subject.trim() || !bodyText} title="Send one copy to yourself">
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Send test to me
                  </Button>
                  <Button type="button" variant="outline" className="gap-1.5" onClick={copyHtml} disabled={!bodyText}>
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <ClipboardCopy className="w-4 h-4" />} Copy HTML
                  </Button>
                </div>
                <Button type="button" className="w-full gap-2" onClick={sendCampaign} disabled={sending || !ready}>
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</> : <><Send className="w-4 h-4" />Send to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</>}
                </Button>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-surface-border" /><span className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">or via Outlook</span><div className="flex-1 h-px bg-surface-border" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" className="gap-1.5" disabled={!ready} onClick={() => openInOutlook('bcc')}><Send className="w-3.5 h-3.5" /> One draft (BCC)</Button>
                  <Button type="button" variant="outline" className="gap-1.5" disabled={!ready} onClick={() => openInOutlook('each')}><Send className="w-3.5 h-3.5" /> Per-contact</Button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right (2/5): recipients + live preview ── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Recipients */}
            <div className="bg-surface-1 rounded-2xl border border-surface-border p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2"><Users className="w-4 h-4 text-brand-500" /> Recipients</h3>
                {excluded.size > 0 && <button type="button" onClick={() => setExcluded(new Set())} className="text-[11px] font-semibold text-brand-600 hover:underline">Reset ({excluded.size})</button>}
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-muted pointer-events-none" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipients…" className="w-full pl-8 pr-3 h-9 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
              </div>
              {loadingPreview ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-surface-border animate-pulse" />)}</div>
              ) : visibleRecipients.length === 0 ? (
                <div className="text-center py-8"><Users className="w-8 h-8 text-brand-200 mx-auto mb-2" /><p className="text-sm text-surface-muted">{recipients.length === 0 ? `No contacts${tag ? ` for "${tag}"` : ''}.` : 'No match.'}</p></div>
              ) : (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
                  {visibleRecipients.map(c => (
                    <div key={c._id} className="group flex items-center gap-3 p-2.5 rounded-xl bg-surface border border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0"><span className="text-brand-700 font-bold text-[10px]">{c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</span></div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-ink truncate">{c.name}</p><p className="text-xs text-surface-muted truncate">{c.email}</p></div>
                      <button type="button" onClick={() => setExcluded(s => new Set(s).add(c._id))} aria-label={`Remove ${c.name}`} className="p-1 rounded-lg text-surface-muted hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className="bg-surface-1 rounded-2xl border border-surface-border p-5">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2 mb-3"><Eye className="w-4 h-4 text-brand-500" /> Live preview <span className="text-[10px] font-normal text-surface-muted">(first recipient)</span></h3>
              <div className="rounded-xl bg-surface border border-surface-border p-4">
                <p className="text-[10px] font-bold text-surface-muted uppercase tracking-wide mb-1">To: {recipients[0]?.email || '—'}</p>
                <p className="text-sm font-bold text-ink mb-2">{subject ? subject.replace(/\{\{name\}\}/gi, recipients[0]?.name || '{{name}}').replace(/\{\{company\}\}/gi, recipients[0]?.company || '{{company}}') : <span className="text-surface-muted font-normal">(no subject)</span>}</p>
                <hr className="border-surface-border mb-3" />
                {bodyText ? (
                  <div className="prose prose-sm max-w-none text-ink-muted" dangerouslySetInnerHTML={{ __html: body.replace(/\{\{name\}\}/gi, recipients[0]?.name || '{{name}}').replace(/\{\{company\}\}/gi, recipients[0]?.company || '{{company}}') }} />
                ) : <p className="text-sm text-surface-muted">Your email body will appear here.</p>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
