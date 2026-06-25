'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ScanLine, Trash2, UserPlus, ExternalLink, Loader2, ChevronLeft, Sparkles } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { CardSkeleton } from '@/components/ui/skeleton'
import ScanCardDialog from '@/components/ScanCardDialog'
import { timeAgo } from '@/lib/timeAgo'

interface ScannedCard {
  _id: string
  imageData: string
  ocrSource: 'gemini' | 'ollama' | 'fallback'
  parsedFields: Record<string, string>
  contactId?: string
  createdAt: string
}

export default function ScannedCardsPage() {
  const router = useRouter()
  const toast = useToast()
  const [cards, setCards] = useState<ScannedCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchCards = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const res = await fetch('/api/crm/scanned-cards', { signal })
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json()
      if (signal?.aborted) return
      setCards(Array.isArray(data) ? data : [])
      setError(false)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setCards([]); setError(true)
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    fetchCards(ac.signal)
    return () => ac.abort()
  }, [fetchCards])

  const importToCrm = async (card: ScannedCard) => {
    setBusy(card._id)
    try {
      const f = card.parsedFields || {}
      if (!f.name) { toast('No name on this card — open it to add one', 'error'); setBusy(null); return }
      const res = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const created = res.ok ? await res.json().catch(() => null) : null
      if (created?._id) {
        await fetch(`/api/crm/scanned-cards/${card._id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: created._id }),
        })
        toast('Imported to Contacts', 'success')
        router.push(`/crm/${created._id}`)
      } else {
        toast('Import failed', 'error')
      }
    } catch { toast('Import failed', 'error') }
    finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    setBusy(id)
    try {
      await fetch(`/api/crm/scanned-cards/${id}`, { method: 'DELETE' })
      setCards(cs => cs.filter(c => c._id !== id))
      toast('Card deleted', 'info')
    } catch { toast('Delete failed', 'error') }
    finally { setBusy(null) }
  }

  return (
    <>
      <Header title="Scanned Cards" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-6 w-full bg-surface-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Contacts
          </Link>
          <ScanCardDialog trigger={<Button className="gap-2"><ScanLine className="w-4 h-4" /> Scan New Card</Button>} />
        </div>

        <div>
          <h2 className="text-lg font-extrabold text-ink">Card Gallery</h2>
          <p className="text-sm text-surface-muted mt-0.5">Every business card you scan is stored here for reference. Import any card into Contacts.</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : error && cards.length === 0 ? (
          <ErrorState onRetry={() => fetchCards()} />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={ScanLine}
            title="No scanned cards yet"
            description="Scan a business card — the AI extracts the details and the image is saved here for reference."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map(card => {
              const f = card.parsedFields || {}
              return (
                <div key={card._id} className="bg-surface-1 rounded-2xl border border-surface-border overflow-hidden flex flex-col">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.imageData} alt={f.name || 'Scanned card'} className="w-full h-40 object-contain bg-surface border-b border-surface-border" />
                  <div className="p-4 space-y-2 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-ink text-sm truncate">{f.name || 'Unnamed card'}</p>
                        {f.designation && <p className="text-xs text-surface-muted truncate">{f.designation}</p>}
                      </div>
                      {card.contactId && (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Imported</span>
                      )}
                    </div>
                    {f.company && <p className="text-xs text-ink-muted truncate">{f.company}</p>}
                    {f.email && <p className="text-xs text-ink-muted truncate">{f.email}</p>}
                    {f.phone && <p className="text-xs text-ink-muted truncate">{f.phone}</p>}
                    <div className="flex items-center gap-1.5 text-[10px] text-surface-muted mt-auto pt-2">
                      {(card.ocrSource === 'gemini' || card.ocrSource === 'ollama') && <Sparkles className="w-3 h-3 text-brand-400" />}
                      <span>{timeAgo(card.createdAt)}</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      {card.contactId ? (
                        <Link href={`/crm/${card.contactId}`} className="flex-1">
                          <Button size="sm" variant="outline" className="w-full gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> View contact</Button>
                        </Link>
                      ) : (
                        <Button size="sm" className="flex-1 gap-1.5" disabled={busy === card._id} onClick={() => importToCrm(card)}>
                          {busy === card._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Import
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 px-2.5" disabled={busy === card._id} onClick={() => remove(card._id)} aria-label="Delete card">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
