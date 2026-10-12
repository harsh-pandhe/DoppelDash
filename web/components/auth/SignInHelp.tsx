'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Button, Dialog, Icon } from '@/components/ds'
import { SUPPORT_CONFIG } from '@/lib/config/support'

type Msg = { role: 'user' | 'model'; text: string }

/** Sign-in help assistant (existing /api/support/chat feature) in a design-system dialog. Public endpoint, no session. */
export default function SignInHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [history, setHistory] = useState<Msg[]>([{ role: 'model', text: 'Hi — I can help with signing in, missing codes or access. What’s going on?' }])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [history, busy])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || busy) return
    const next: Msg[] = [...history, { role: 'user', text: query }]
    setHistory(next); setQuery(''); setBusy(true)
    try {
      const res = await fetch('/api/support/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next }) })
      const data = await res.json()
      setHistory([...next, { role: 'model', text: data.text || data.error || 'I couldn’t get a response. Please try again.' }])
    } catch {
      setHistory([...next, { role: 'model', text: `Network error. Try again${SUPPORT_CONFIG.isConfigured ? ` or contact ${SUPPORT_CONFIG.supportEmail}` : ''}.` }])
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Sign-in help" description="Ask about signing in, verification codes or access.">
      <div role="log" aria-live="polite" aria-label="Conversation" className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {history.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'ml-8 rounded-ds-md bg-ds-primary-container px-3 py-2 text-ds-body-medium text-ds-on-primary-container' : 'mr-8 rounded-ds-md bg-ds-surface-container-high px-3 py-2 text-ds-body-medium text-ds-on-surface'}>{m.text}</div>
        ))}
        {busy && <div role="status" className="mr-8 rounded-ds-md bg-ds-surface-container-high px-3 py-2 text-ds-body-medium text-ds-on-surface-variant">Typing…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <input aria-label="Your message" value={query} onChange={e => setQuery(e.target.value)} placeholder="Describe the problem" className="min-h-11 flex-1 rounded-ds-input border border-ds-outline-variant bg-ds-card px-3 text-ds-body-medium text-ds-on-surface" />
        <Button type="submit" disabled={busy || !query.trim()} aria-label="Send message"><Icon icon={Send} size="sm" /></Button>
      </form>
    </Dialog>
  )
}
