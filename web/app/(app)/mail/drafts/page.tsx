'use client'
// Communications — saved drafts list with version history + restore.
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { FileEdit, Trash2, History, Loader2, Mail, Pencil, RotateCcw, X, Users } from 'lucide-react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { timeAgo } from '@/lib/timeAgo'

interface DraftSummary {
  _id: string
  subject: string
  recipients: { name: string; email: string; field: string }[]
  updatedAt: string
  versionCount: number
}
interface DraftVersion { subject: string; bodyHtml: string; savedAt: string }

function VersionHistoryDialog({ draftId, onRestored }: { draftId: string; onRestored: () => void }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<DraftVersion[] | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (!open) return
    setVersions(null)
    fetch(`/api/mail/drafts/${draftId}`).then(r => r.json()).then(d => setVersions(d.versions || []))
  }, [open, draftId])

  const restore = async (v: DraftVersion, i: number) => {
    setRestoring(i)
    try {
      // PATCH snapshots the current content automatically, so nothing is lost on restore
      const res = await fetch(`/api/mail/drafts/${draftId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: v.subject, bodyHtml: v.bodyHtml }),
      })
      if (!res.ok) throw new Error()
      toast('Version restored', 'success')
      setOpen(false); onRestored()
    } catch { toast('Restore failed', 'error') }
    finally { setRestoring(null) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <History className="w-3.5 h-3.5" /> Versions
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
            <Dialog.Title className="text-base font-bold text-ink flex items-center gap-2">
              <History className="w-4 h-4 text-brand-500" /> Version history
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="p-1.5 rounded-lg text-surface-muted hover:bg-surface transition-colors">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {versions === null ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-surface-border animate-pulse" />)}</div>
            ) : versions.length === 0 ? (
              <p className="text-sm text-surface-muted text-center py-8">No previous versions yet — versions are snapshotted automatically each time you save changes.</p>
            ) : versions.map((v, i) => (
              <div key={i} className="rounded-xl border border-surface-border overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface border-b border-surface-border">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-ink truncate">{v.subject || '(no subject)'}</p>
                    <p className="text-[10px] text-surface-muted">{new Date(v.savedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {timeAgo(v.savedAt)}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 flex-shrink-0"
                    disabled={restoring !== null} onClick={() => restore(v, i)}>
                    {restoring === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Restore
                  </Button>
                </div>
                <div className="px-4 py-3 max-h-36 overflow-y-auto">
                  <div className="prose prose-sm max-w-none text-xs" dangerouslySetInnerHTML={{ __html: v.bodyHtml }} />
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function MailDraftsPage() {
  const router = useRouter()
  const toast = useToast()
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchDrafts = useCallback(() => {
    fetch('/api/mail/drafts').then(r => r.json()).then(d => setDrafts(Array.isArray(d) ? d : []))
      .catch(() => setDrafts([]))
  }, [])

  useEffect(() => { fetchDrafts() }, [fetchDrafts])

  const remove = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/mail/drafts/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Draft deleted', 'info')
      setDeleteId(null); fetchDrafts()
    } catch { toast('Delete failed', 'error') }
    finally { setDeleting(false) }
  }

  return (
    <>
      <Header title="Mail Drafts" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl space-y-5 w-full mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-ink flex items-center gap-2">
              <FileEdit className="w-5 h-5 text-brand-500" /> Drafts
            </h2>
            <p className="text-xs text-surface-muted mt-0.5">Saved drafts with automatic version history</p>
          </div>
          <Link href="/mail">
            <Button type="button" size="sm" className="gap-1.5"><Mail className="w-3.5 h-3.5" /> New mail</Button>
          </Link>
        </div>

        {drafts === null ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-surface-border animate-pulse" />)}</div>
        ) : drafts.length === 0 ? (
          <EmptyState
            icon={FileEdit}
            title="No drafts yet"
            description="Compose a mail and hit Save draft — every save keeps a version history you can restore."
            action={{ label: 'Compose mail', href: '/mail', icon: Mail }}
          />
        ) : (
          <div className="space-y-3">
            {drafts.map(d => (
              <div key={d._id} className="flex items-center gap-4 p-4 rounded-2xl bg-surface-1 border border-surface-border hover:border-brand-300 transition-colors flex-wrap">
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-brand-500" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-bold text-ink truncate">{d.subject || '(no subject)'}</p>
                  <p className="text-xs text-surface-muted flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {d.recipients?.length || 0} recipient{(d.recipients?.length || 0) !== 1 ? 's' : ''}</span>
                    <span>· edited {timeAgo(d.updatedAt)}</span>
                    {d.versionCount > 0 && <Badge variant="secondary" className="text-[9px]">{d.versionCount} version{d.versionCount !== 1 ? 's' : ''}</Badge>}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button type="button" size="sm" className="gap-1.5" onClick={() => router.push(`/mail?draft=${d._id}`)}>
                    <Pencil className="w-3.5 h-3.5" /> Open
                  </Button>
                  <VersionHistoryDialog draftId={d._id} onRestored={fetchDrafts} />
                  <Button type="button" size="sm" variant="outline"
                    className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => setDeleteId(d._id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete confirm */}
        <Dialog.Root open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null) }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
            <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
              <Dialog.Title className="text-base font-bold text-ink mb-1">Delete draft?</Dialog.Title>
              <Dialog.Description className="text-sm text-surface-muted mb-5">
                This deletes the draft and all its version history. This cannot be undone.
              </Dialog.Description>
              <div className="flex gap-3 justify-end">
                <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
                <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700 gap-1.5" onClick={remove} disabled={deleting}>
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </main>
    </>
  )
}
