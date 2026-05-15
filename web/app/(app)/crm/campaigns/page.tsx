'use client'
// Phase C + F: Segmented CRM campaigns + AI content suite
import { useState, useEffect } from 'react'
import { ArrowLeft, Send, Sparkles, Users, Loader2, CheckCircle2, Eye } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import RichTextEditor from '@/components/ui/rich-text-editor'

interface PreviewContact { _id: string; name: string; email: string; company?: string }

export default function CampaignsPage() {
  const toast = useToast()

  const [tag,       setTag]       = useState('')
  const [subject,   setSubject]   = useState('')
  const [body,      setBody]      = useState('')
  const [preview,   setPreview]   = useState<PreviewContact[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending,   setSending]   = useState(false)
  const [result,    setResult]    = useState<{ sent: number; failed: number } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [allTags,   setAllTags]   = useState<string[]>([])

  // Fetch available tags from existing contacts
  useEffect(() => {
    fetch('/api/crm')
      .then(r => r.json())
      .then((contacts: Array<{ tags?: string[] }>) => {
        const tags = Array.from(new Set(contacts.flatMap(c => c.tags || [])))
        setAllTags(tags)
      })
      .catch(() => {})
  }, [])

  const fetchPreview = async () => {
    setLoadingPreview(true)
    try {
      const params = tag ? `?tag=${encodeURIComponent(tag)}` : ''
      const res    = await fetch(`/api/crm/campaign${params}`)
      const data   = await res.json()
      setPreview(data.contacts || [])
    } catch { setPreview([]) }
    finally { setLoadingPreview(false) }
  }

  useEffect(() => {
    const t = setTimeout(fetchPreview, 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag])

  const generateAIDraft = async () => {
    if (!tag && preview.length === 0) { toast('Preview contacts first', 'error'); return }
    setAiLoading(true)
    try {
      const sampleContact = preview[0]
      const prompt = `Write a professional business email body for a bulk outreach campaign from Doppelmayr India.
Target audience: ${tag ? `contacts tagged "${tag}"` : 'all CRM contacts'}.
Sample recipient: ${sampleContact?.name || 'a stakeholder'} from ${sampleContact?.company || 'their company'}.
Keep it concise (3-4 sentences), professional, and relevant to urban ropeway/cable car infrastructure projects.
Use {{name}} and {{company}} placeholders for personalization.
Output only the email body text, no subject line, no greeting like "Dear", start directly.`

      const res = await fetch('/api/crm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (data.text) {
        setBody(data.text.trim())
        if (!subject) setSubject(`Doppelmayr India — ${tag ? tag.charAt(0).toUpperCase() + tag.slice(1) + ' Update' : 'Project Update'}`)
      } else {
        toast('AI draft failed — try again', 'error')
      }
    } catch { toast('AI draft failed', 'error') }
    finally { setAiLoading(false) }
  }

  const sendCampaign = async () => {
    const bodyText = body.replace(/<[^>]*>/g, '').trim()
    if (!subject.trim() || !bodyText) { toast('Subject and body required', 'error'); return }
    if (preview.length === 0) { toast('No contacts to send to', 'error'); return }
    setSending(true); setResult(null)
    try {
      const res = await fetch('/api/crm/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: tag || undefined, subject, bodyTemplate: body }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Send failed', 'error'); return }
      setResult({ sent: data.sent, failed: data.failed })
      toast(`Campaign sent to ${data.sent} contact(s)`, 'success')
    } catch { toast('Send failed', 'error') }
    finally { setSending(false) }
  }

  return (
    <>
      <Header title="Email Campaign" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-6xl space-y-5 w-full mx-auto">
        <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left — compose */}
          <div className="space-y-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Compose Campaign</CardTitle>
                <p className="text-xs text-surface-muted">Send a bulk email to contacts by tag. Use {'{{name}}'} and {'{{company}}'} for personalization.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tag filter */}
                <div className="space-y-1.5">
                  <Label>Target Segment (Tag)</Label>
                  <div className="flex gap-2 flex-wrap mb-2">
                    <button type="button" onClick={() => setTag('')}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${!tag ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                      All with email
                    </button>
                    {allTags.map(t => (
                      <button type="button" key={t} onClick={() => setTag(t === tag ? '' : t)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${tag === t ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-surface-muted flex items-center gap-1">
                    {loadingPreview ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                    {loadingPreview ? 'Loading…' : `${preview.length} contact${preview.length !== 1 ? 's' : ''} with email`}
                  </p>
                </div>

                {/* Subject */}
                <div className="space-y-1.5">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder="e.g. Doppelmayr India — Q2 Project Update" />
                </div>

                {/* Body */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="body">Email Body</Label>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50"
                      onClick={generateAIDraft} disabled={aiLoading}>
                      {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      AI Draft
                    </Button>
                  </div>
                  <RichTextEditor
                    value={body}
                    onChange={setBody}
                    placeholder="Dear {{name}}, Hope this message finds you well… Use {{name}} and {{company}} for personalization."
                    minHeight={180}
                  />
                  <p className="text-[10px] text-surface-muted">Placeholders: {'{{name}}'}, {'{{company}}'}</p>
                </div>

                {result && (
                  <Alert className="border-green-200 bg-green-50">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      Campaign sent — <strong>{result.sent}</strong> delivered
                      {result.failed > 0 ? `, ${result.failed} failed` : ''}
                    </AlertDescription>
                  </Alert>
                )}

                <Button type="button" className="w-full gap-2" onClick={sendCampaign}
                  disabled={sending || preview.length === 0 || !subject || !body.replace(/<[^>]*>/g, '').trim()}>
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</> : <><Send className="w-4 h-4" />Send to {preview.length} Contact{preview.length !== 1 ? 's' : ''}</>}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right — preview */}
          <div className="space-y-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="w-4 h-4 text-brand-500" /> Recipients Preview
                </CardTitle>
                <p className="text-xs text-surface-muted">Contacts that will receive this campaign.</p>
              </CardHeader>
              <CardContent>
                {loadingPreview ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-surface-border animate-pulse" />)}
                  </div>
                ) : preview.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-8 h-8 text-brand-200 mx-auto mb-2" />
                    <p className="text-sm text-surface-muted">No contacts with email found{tag ? ` for tag "${tag}"` : ''}.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {preview.map(c => (
                      <div key={c._id} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                        <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-brand-700 font-bold text-[10px]">
                            {c.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                          <p className="text-xs text-surface-muted truncate">{c.email}</p>
                        </div>
                        {c.company && <Badge variant="secondary" className="text-[10px] flex-shrink-0">{c.company.split(' ')[0]}</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Preview of email with personalization */}
            {body && preview.length > 0 && (
              <Card className="rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-gray-700">Email Preview (first recipient)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl bg-surface border border-surface-border p-4 text-sm text-gray-700">
                    <p className="text-xs font-bold text-surface-muted mb-2 uppercase tracking-wide">Subject: {subject || '(no subject)'}</p>
                    <hr className="border-surface-border mb-3" />
                    <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html:
                      body
                        .replace(/\{\{name\}\}/gi, preview[0]?.name || '{{name}}')
                        .replace(/\{\{company\}\}/gi, preview[0]?.company || '{{company}}')
                    }} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
