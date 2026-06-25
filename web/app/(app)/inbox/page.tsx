'use client'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { useUser } from '@/lib/useUser'
import { useToast } from '@/components/ui/toast'
import {
  AlertTriangle, Inbox as InboxIcon, RefreshCw, Mail, MailOpen,
  Paperclip, Loader2, Reply,
} from 'lucide-react'

interface InboxItem {
  _id: string
  fromName?: string
  fromAddress: string
  subject: string
  snippet: string
  date: string
  readByApp: boolean
  attachments: { filename: string; contentType: string; size: number }[]
}
interface InboxDetail extends InboxItem {
  text?: string
  html?: string
  toAddresses: string[]
}

function fmtDate(s: string): string {
  const d = new Date(s)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function InboxPage() {
  const { user } = useUser()
  const role = user?.role || 'employee'
  const hasMailAccess = role === 'admin' || role === 'manager' || user?.mailAccess === true
  const toast = useToast()

  const [items, setItems]       = useState<InboxItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [syncing, setSyncing]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [configured, setConfig] = useState(true)
  const [unread, setUnread]     = useState(0)
  const [selected, setSelected] = useState<InboxDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (sync = false) => {
    if (sync) setSyncing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox${sync ? '?sync=1' : ''}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to load inbox'); setConfig(data.configured ?? true); return }
      setItems(data.messages || [])
      setUnread(data.unread || 0)
      setConfig(data.configured ?? true)
      if (sync && data.sync) {
        toast(`Synced — ${data.sync.synced} new message${data.sync.synced !== 1 ? 's' : ''}`, 'success')
      }
    } catch {
      setError('Network error loading inbox')
    } finally {
      setLoading(false); setSyncing(false)
    }
  }, [toast])

  useEffect(() => { if (hasMailAccess) load(false) }, [hasMailAccess, load])

  const openMessage = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/inbox/${id}`)
      const data = await res.json()
      if (res.ok) {
        setSelected(data)
        setItems(prev => prev.map(i => i._id === id ? { ...i, readByApp: true } : i))
        setUnread(u => (items.find(i => i._id === id && !i.readByApp) ? Math.max(0, u - 1) : u))
      } else toast(data.error || 'Failed to open message', 'error')
    } catch { toast('Network error', 'error') }
    finally { setDetailLoading(false) }
  }

  if (user && !hasMailAccess) {
    return (
      <>
        <Header title="Inbox" />
        <main className="flex-1 p-5 lg:p-8 flex items-center justify-center">
          <EmptyState
            icon={AlertTriangle}
            title="Mail access not granted"
            description="The shared inbox is available to managers and admins. Ask your administrator to grant you access."
            action={{ label: 'Back to Dashboard', href: '/dashboard' }}
          />
        </main>
      </>
    )
  }

  return (
    <>
      <Header title="Inbox" />
      <main className="flex-1 p-5 lg:p-8 w-full mx-auto max-w-7xl">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-lg font-bold text-ink">Shared Inbox</h2>
            {unread > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">{unread} unread</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={syncing}
            className="flex items-center gap-2 px-3 h-9 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 transition-colors flex-shrink-0"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>

        {error ? (
          <ErrorState
            title={configured ? 'Inbox sync failed' : 'IMAP not configured'}
            description={configured ? error : 'Add IMAP_HOST, IMAP_USER, IMAP_PASS to the environment to enable the shared inbox.'}
            onRetry={configured ? () => load(false) : undefined}
          />
        ) : loading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-surface-3 animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="Inbox empty"
            description="No messages synced yet. Hit Sync to pull mail from the shared mailbox."
            action={{ label: 'Sync now', onClick: () => load(true), icon: RefreshCw }}
          />
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,360px)_1fr] gap-4">
            {/* List */}
            <div className="rounded-2xl border border-surface-border bg-surface-1 overflow-hidden divide-y divide-surface-border max-h-[70vh] overflow-y-auto scrollbar-thin">
              {items.map(m => (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => openMessage(m._id)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-surface-2
                    ${selected?._id === m._id ? 'bg-brand-50' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {m.readByApp
                      ? <MailOpen className="w-3.5 h-3.5 text-surface-muted flex-shrink-0" />
                      : <Mail className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" />}
                    <p className={`text-xs truncate flex-1 ${m.readByApp ? 'text-ink-muted' : 'font-bold text-ink'}`}>
                      {m.fromName || m.fromAddress}
                    </p>
                    <span className="text-[10px] text-surface-muted flex-shrink-0">{fmtDate(m.date)}</span>
                  </div>
                  <p className={`text-xs mt-1 truncate ${m.readByApp ? 'text-ink-muted' : 'font-semibold text-ink'}`}>{m.subject}</p>
                  <p className="text-[11px] text-surface-muted truncate mt-0.5">{m.snippet}</p>
                  {m.attachments.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-surface-muted mt-1">
                      <Paperclip className="w-3 h-3" />{m.attachments.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Detail */}
            <div className="rounded-2xl border border-surface-border bg-surface-1 p-5 min-h-[300px]">
              {detailLoading ? (
                <div className="flex items-center justify-center h-full text-surface-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : !selected ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-surface-muted py-16">
                  <InboxIcon className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">Select a message to read</p>
                </div>
              ) : (
                <article>
                  <h3 className="text-base font-bold text-ink">{selected.subject}</h3>
                  <div className="flex items-center justify-between gap-2 mt-2 mb-4 pb-4 border-b border-surface-border">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{selected.fromName || selected.fromAddress}</p>
                      <p className="text-xs text-surface-muted truncate">{selected.fromAddress}</p>
                      {selected.toAddresses?.length > 0 && (
                        <p className="text-[11px] text-surface-muted truncate">to {selected.toAddresses.join(', ')}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-surface-muted">{new Date(selected.date).toLocaleString('en-IN')}</span>
                      <a
                        href={`/mail?to=${encodeURIComponent(selected.fromAddress)}&subject=${encodeURIComponent('Re: ' + selected.subject)}`}
                        className="flex items-center gap-1 px-2.5 h-8 rounded-lg bg-surface-2 text-ink-muted text-xs font-semibold hover:bg-surface-3 transition-colors"
                      >
                        <Reply className="w-3.5 h-3.5" /> Reply
                      </a>
                    </div>
                  </div>

                  {selected.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {selected.attachments.map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg bg-surface-2 text-ink-muted">
                          <Paperclip className="w-3 h-3" /> {a.filename} <span className="text-surface-muted">({Math.ceil(a.size / 1024)} KB)</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {selected.html ? (
                    <div
                      className="prose prose-sm max-w-none text-ink"
                      // body sanitized server-side via sanitize-html in lib/imap.ts before storage
                      dangerouslySetInnerHTML={{ __html: selected.html }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{selected.text || '(no content)'}</pre>
                  )}
                </article>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}
