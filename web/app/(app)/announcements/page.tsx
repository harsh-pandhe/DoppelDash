'use client'
import { useState, useEffect, useCallback } from 'react'
import { Megaphone, Pin, PinOff, Trash2, Plus, AlertTriangle, Info, Loader2, Mail } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { useUser } from '@/lib/useUser'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { ListSkeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import RichTextEditor from '@/components/ui/rich-text-editor'
import { EmptyState } from '@/components/ui/empty-state'
import { useAutoRefresh } from '@/lib/useAutoRefresh'

interface Announcement {
  _id: string; authorName: string; title: string; body: string
  pinned: boolean; priority: 'normal' | 'important' | 'urgent'; createdAt: string
}

const PRIORITY_META = {
  normal:    { bar: 'from-brand-400 to-brand-500',    badge: 'bg-brand-50 text-brand-700 border-brand-200',    icon: Info,          label: 'Normal',    dot: 'bg-brand-400'  },
  important: { bar: 'from-yellow-400 to-amber-500',   badge: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: AlertTriangle, label: 'Important', dot: 'bg-yellow-400' },
  urgent:    { bar: 'from-red-500 to-rose-600',       badge: 'bg-red-50 text-red-700 border-red-200',          icon: AlertTriangle, label: 'Urgent',    dot: 'bg-red-500'    },
}

function PostDialog({ onPost }: { onPost: () => void }) {
  const [open,   setOpen]   = useState(false)
  const [form,   setForm]   = useState({ title: '', body: '', priority: 'normal', pinned: false })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const bodyText = form.body.replace(/<[^>]*>/g, '').trim()
    if (!form.title.trim() || !bodyText) return
    setSaving(true)
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast('Announcement posted')
      setForm({ title: '', body: '', priority: 'normal', pinned: false })
      setOpen(false); onPost()
    } catch { toast('Failed to post announcement', 'error') }
    finally { setSaving(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button data-post-announcement className="gap-2 bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2]">
          <Plus className="w-4 h-4" /> Post Announcement
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-4">New Announcement</Dialog.Title>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-surface-muted uppercase tracking-widest">Title *</label>
              <input
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Announcement title…" required
                className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-surface-muted uppercase tracking-widest">Message *</label>
              <RichTextEditor value={form.body} onChange={html => setForm(f => ({ ...f, body: html }))} placeholder="Write your announcement…" minHeight={120} />
            </div>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-1.5 flex-1 min-w-[120px]">
                <label className="text-xs font-bold text-surface-muted uppercase tracking-widest">Priority</label>
                <select
                  aria-label="Priority"
                  value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                  <option value="normal">Normal</option>
                  <option value="important">Important</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))}
                    className="w-4 h-4 rounded accent-brand-500" />
                  <span className="text-sm font-medium text-gray-700">Pin to top</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} Post
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function AnnouncementsPage() {
  const { user } = useUser()
  const toast    = useToast()
  const role     = user?.role || 'employee'
  const canPost  = role === 'manager' || role === 'boss'

  const [items,   setItems]   = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/announcements')
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])
  useAutoRefresh(fetchItems)

  const togglePin = async (id: string, pinned: boolean) => {
    await fetch(`/api/announcements/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !pinned }),
    })
    setItems(prev => prev.map(i => i._id === id ? { ...i, pinned: !i.pinned } : i)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned)))
    toast(pinned ? 'Unpinned' : 'Pinned to top', 'info')
  }

  const deleteItem = async (id: string) => {
    await fetch(`/api/announcements/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i._id !== id))
    toast('Announcement deleted', 'info')
  }

  const pinned   = items.filter(i => i.pinned)
  const unpinned = items.filter(i => !i.pinned)

  return (
    <>
      <Header title="Announcements" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#003B73] to-[#0057A8] flex items-center justify-center flex-shrink-0">
              <Megaphone className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Company Notices</p>
              <p className="text-xs text-surface-muted">Updates and announcements from management.</p>
            </div>
          </div>
          {canPost && <PostDialog onPost={fetchItems} />}
        </div>

        {loading ? (
          <ListSkeleton rows={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            size="lg"
            title="No announcements yet"
            description={canPost ? 'Post company updates, holidays, policy changes — pin urgent ones to the top.' : 'Check back later for company updates and team news.'}
            action={canPost ? { label: 'Post Announcement', onClick: () => document.querySelector<HTMLButtonElement>('[data-post-announcement]')?.click(), icon: Plus } : undefined}
          />
        ) : (
          <div className="space-y-4">

            {/* Pinned section */}
            {pinned.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted flex items-center gap-1.5">
                  <Pin className="w-3 h-3" /> Pinned
                </p>
                {pinned.map(item => <AnnouncementCard key={item._id} item={item} canPost={canPost} onPin={togglePin} onDelete={deleteItem} />)}
              </div>
            )}

            {/* Unpinned section */}
            {unpinned.length > 0 && (
              <div className="space-y-3">
                {pinned.length > 0 && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">All Announcements</p>
                )}
                {unpinned.map(item => <AnnouncementCard key={item._id} item={item} canPost={canPost} onPin={togglePin} onDelete={deleteItem} />)}
              </div>
            )}

          </div>
        )}
      </main>
    </>
  )
}

function BroadcastButton({ id }: { id: string }) {
  const toast   = useToast()
  const [open,  setOpen]  = useState(false)
  const [roles, setRoles] = useState(['employee','manager','boss'])
  const [sending, setSending] = useState(false)

  const toggle = (r: string) => setRoles(prev => prev.includes(r) ? prev.filter(x=>x!==r) : [...prev, r])

  const send = async () => {
    setSending(true)
    const res  = await fetch('/api/announcements/broadcast', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ announcementId: id, targetRoles: roles }),
    })
    const data = await res.json()
    if (res.ok) toast(`Email sent to ${data.sent} recipient${data.sent!==1?'s':''}`, 'success')
    else toast(data.error || 'Send failed', 'error')
    setSending(false); setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label="Send as email"
          className="p-1.5 rounded-lg hover:bg-blue-50 text-surface-muted hover:text-blue-600 transition-colors">
          <Mail className="w-3.5 h-3.5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
          <Dialog.Title className="text-base font-bold text-gray-900">Send as Email</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted">Choose who receives this announcement by email.</Dialog.Description>
          <div className="space-y-2">
            {([['employee', 'Employees'],['manager', 'Managers'],['boss', 'Boss']] as const).map(([r, label]) => (
              <label key={r} className="flex items-center gap-3 p-3 rounded-xl border border-surface-border cursor-pointer hover:bg-surface transition-colors">
                <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} className="accent-brand-500 w-4 h-4" />
                <span className="text-sm font-semibold text-gray-700">{label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <Button className="flex-1 gap-2" onClick={send} disabled={sending || roles.length===0}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Send Email
            </Button>
            <Dialog.Close asChild><Button variant="outline">Cancel</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AnnouncementCard({ item, canPost, onPin, onDelete }: {
  item: Announcement
  canPost: boolean
  onPin: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
}) {
  const p    = PRIORITY_META[item.priority]
  const PIcon = p.icon

  return (
    <div className={`group bg-white rounded-2xl border overflow-hidden hover:shadow-md transition-all ${item.pinned ? 'border-brand-200 shadow-sm' : 'border-surface-border'}`}>
      {/* Priority gradient top bar */}
      <div className={`h-1 bg-gradient-to-r ${p.bar}`} />

      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Priority icon */}
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.bar} flex items-center justify-center flex-shrink-0 mt-0.5`}>
            <PIcon className="w-5 h-5 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {item.pinned && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-brand-600 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full">
                  <Pin className="w-2.5 h-2.5" /> Pinned
                </span>
              )}
              {item.priority !== 'normal' && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${p.badge}`}>
                  {p.label}
                </span>
              )}
            </div>

            <h3 className="font-bold text-gray-900 text-sm mb-2">{item.title}</h3>
            <div className="prose prose-sm max-w-none text-gray-600 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: item.body }} />
            <p className="text-[11px] text-surface-muted mt-3">
              Posted by <strong>{item.authorName}</strong> ·{' '}
              {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>

          {/* Actions */}
          {canPost && (
            <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <BroadcastButton id={item._id} />
              <button type="button" aria-label={item.pinned ? 'Unpin' : 'Pin'}
                onClick={() => onPin(item._id, item.pinned)}
                className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-muted hover:text-brand-600 transition-colors">
                {item.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </button>
              <button type="button" aria-label="Delete announcement"
                onClick={() => onDelete(item._id)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-surface-muted hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
