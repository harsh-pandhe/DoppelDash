'use client'
import { useState, useEffect, useCallback } from 'react'
import { Megaphone, Pin, PinOff, Trash2, Plus, AlertTriangle, Info, Loader2 } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { useUser } from '@clerk/nextjs'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ListSkeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'

interface Announcement {
  _id: string; authorName: string; title: string; body: string
  pinned: boolean; priority: 'normal' | 'important' | 'urgent'; createdAt: string
}

const PRIORITY_STYLES = {
  normal:    { bar: 'bg-brand-400',  badge: 'bg-brand-50  text-brand-700',  icon: Info,          label: 'Normal'    },
  important: { bar: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700', icon: AlertTriangle, label: 'Important' },
  urgent:    { bar: 'bg-red-500',    badge: 'bg-red-50    text-red-700',    icon: AlertTriangle, label: 'Urgent'    },
}

function PostDialog({ onPost }: { onPost: () => void }) {
  const [open,  setOpen]  = useState(false)
  const [form,  setForm]  = useState({ title: '', body: '', priority: 'normal', pinned: false })
  const [saving,setSaving]= useState(false)
  const toast = useToast()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast('Announcement posted')
      setForm({ title: '', body: '', priority: 'normal', pinned: false })
      setOpen(false)
      onPost()
    } catch {
      toast('Failed to post announcement', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button className="gap-2"><Plus className="w-4 h-4" /> Post Announcement</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-4">New Announcement</Dialog.Title>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Title *</label>
              <input
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Announcement title…" required
                className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Message *</label>
              <textarea
                value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={4} placeholder="Write your announcement…" required
                className="w-full px-3 py-2 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
              />
            </div>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-1.5 flex-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500">
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
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                Post
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
  const role     = (user?.unsafeMetadata?.role as string) || 'employee'
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

  const togglePin = async (id: string, pinned: boolean) => {
    await fetch(`/api/announcements/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !pinned }),
    })
    setItems(prev => prev.map(i => i._id === id ? { ...i, pinned: !pinned } : i)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned)))
    toast(pinned ? 'Unpinned' : 'Pinned to top', 'info')
  }

  const deleteItem = async (id: string) => {
    await fetch(`/api/announcements/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i._id !== id))
    toast('Announcement deleted', 'info')
  }

  return (
    <>
      <Header title="Announcements" />
      <main className="flex-1 p-6 space-y-5">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-surface-muted">
            Company notices and updates from management.
          </p>
          {canPost && <PostDialog onPost={fetchItems} />}
        </div>

        {/* List */}
        {loading ? (
          <ListSkeleton rows={4} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="w-20 h-20 rounded-3xl bg-brand-50 flex items-center justify-center mb-5">
              <Megaphone className="w-10 h-10 text-brand-300" />
            </div>
            <p className="font-bold text-gray-900 text-lg mb-1">No announcements yet</p>
            <p className="text-sm text-surface-muted mb-5 max-w-xs">
              {canPost ? 'Post your first announcement to keep the team informed.' : 'Check back later for company updates.'}
            </p>
            {canPost && <PostDialog onPost={fetchItems} />}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const p = PRIORITY_STYLES[item.priority]
              const PIcon = p.icon
              return (
                <Card key={item._id} className={`overflow-hidden transition-shadow hover:shadow-md ${item.pinned ? 'ring-1 ring-brand-200' : ''}`}>
                  <div className="flex">
                    {/* Priority bar */}
                    <div className={`w-1 flex-shrink-0 ${p.bar}`} />
                    <CardContent className="p-4 flex-1">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {item.pinned && (
                              <span className="flex items-center gap-1 text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                                <Pin className="w-2.5 h-2.5" /> Pinned
                              </span>
                            )}
                            {item.priority !== 'normal' && (
                              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${p.badge}`}>
                                <PIcon className="w-2.5 h-2.5" />{p.label}
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-gray-900 text-sm mb-1">{item.title}</h3>
                          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{item.body}</p>
                          <p className="text-[11px] text-surface-muted mt-2">
                            Posted by <strong>{item.authorName}</strong> · {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        {canPost && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button type="button" aria-label={item.pinned ? 'Unpin' : 'Pin'}
                              onClick={() => togglePin(item._id, item.pinned)}
                              className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-muted hover:text-brand-600 transition-colors">
                              {item.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" aria-label="Delete announcement"
                              onClick={() => deleteItem(item._id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-surface-muted hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
