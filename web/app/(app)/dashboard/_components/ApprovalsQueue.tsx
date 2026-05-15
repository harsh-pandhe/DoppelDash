'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarClock, Receipt, Plane, Check, X, Loader2, RotateCcw, ArrowRight,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'

export interface PendingItem {
  id:       string
  kind:     'leave' | 'expense' | 'travel'
  userName: string
  title:    string       // primary line (e.g. "Sick · 2 days" or "Mumbai client visit")
  subtitle: string       // reason / amount / route
  badge?:   string       // amount, days, etc.
  meta:     string       // submitted ago + extra
  href:     string       // detail link
}

interface Props {
  items: PendingItem[]
  isBoss: boolean
}

const KIND_META = {
  leave:   { icon: CalendarClock, label: 'Leave',   color: 'text-purple-600 bg-purple-50' },
  expense: { icon: Receipt,       label: 'Expense', color: 'text-orange-600 bg-orange-50' },
  travel:  { icon: Plane,         label: 'Travel',  color: 'text-sky-600 bg-sky-50' },
}

export default function ApprovalsQueue({ items, isBoss }: Props) {
  const router  = useRouter()
  const toast   = useToast()
  const [acting, setActing] = useState<string | null>(null)
  const [tab,    setTab]    = useState<'all' | 'leave' | 'expense' | 'travel'>('all')
  const [hidden, setHidden] = useState<Set<string>>(new Set())   // optimistic remove

  const visible = items.filter(i => !hidden.has(i.id) && (tab === 'all' || i.kind === tab))

  const counts = {
    all:     items.filter(i => !hidden.has(i.id)).length,
    leave:   items.filter(i => !hidden.has(i.id) && i.kind === 'leave').length,
    expense: items.filter(i => !hidden.has(i.id) && i.kind === 'expense').length,
    travel:  items.filter(i => !hidden.has(i.id) && i.kind === 'travel').length,
  }

  const act = async (item: PendingItem, action: 'approve' | 'reject' | 'return') => {
    setActing(item.id)
    try {
      let endpoint = ''
      let body: Record<string, unknown> = {}
      if (item.kind === 'leave') {
        endpoint = `/api/lms/${item.id}`
        body = { status: action === 'approve' ? 'approved' : 'rejected' }
      } else if (item.kind === 'expense') {
        endpoint = `/api/rms/${item.id}`
        if (action === 'approve') body = { status: isBoss ? 'paid' : 'pending_boss' }
        else if (action === 'return') body = { status: 'returned' }
        else                          body = { status: 'rejected' }
      } else if (item.kind === 'travel') {
        endpoint = `/api/travel/${item.id}`
        if (action === 'approve') body = { status: isBoss ? 'approved' : 'pending_boss' }
        else                       body = { status: 'rejected' }
      }
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) { toast('Failed — try opening the item', 'error'); return }
      setHidden(p => new Set(p).add(item.id))
      toast(
        action === 'approve' ? `${KIND_META[item.kind].label} approved` :
        action === 'return'  ? `${KIND_META[item.kind].label} returned` :
                                `${KIND_META[item.kind].label} rejected`,
        action === 'reject' ? 'error' : 'success'
      )
      router.refresh()
    } catch { toast('Network error', 'error') }
    finally { setActing(null) }
  }

  if (counts.all === 0) {
    return (
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-dm-graphite uppercase">Approvals queue</h2>
          <span className="text-[10px] font-mono text-surface-muted">0 PENDING</span>
        </div>
        <div className="px-5 py-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-status-success-bg flex items-center justify-center">
            <Check className="w-6 h-6 text-status-success" />
          </div>
          <p className="text-base font-bold text-dm-graphite">All caught up</p>
          <p className="text-xs text-surface-muted mt-1">No items waiting for your decision.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-dm-graphite uppercase">Approvals queue</h2>
          <p className="text-xs text-surface-muted mt-0.5">
            {counts.all} item{counts.all !== 1 ? 's' : ''} need your decision
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'leave', 'expense', 'travel'] as const).map(t => {
            const count = counts[t]
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded transition-colors ${
                  tab === t
                    ? 'bg-dm-graphite text-white'
                    : 'text-surface-muted hover:bg-surface-2'
                }`}
              >
                {t}{count > 0 && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-surface-border max-h-[600px] overflow-y-auto">
        {visible.map(item => {
          const meta = KIND_META[item.kind]
          const Icon = meta.icon
          const isBusy = acting === item.id

          return (
            <div key={item.id} className="px-5 py-3 hover:bg-surface-2/50 transition-colors group">
              <div className="flex items-start gap-3">
                {/* Kind icon */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                  <Icon className="w-4 h-4" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-surface-muted">{meta.label}</span>
                    <span className="text-[10px] font-bold text-dm-graphite-3">·</span>
                    <span className="text-xs font-bold text-dm-graphite truncate">{item.userName}</span>
                    {item.badge && (
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-surface-2 border border-surface-border text-dm-graphite-2 rounded">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-dm-graphite mt-0.5 truncate">{item.title}</p>
                  {item.subtitle && (
                    <p className="text-xs text-dm-graphite-3 mt-0.5 line-clamp-1">{item.subtitle}</p>
                  )}
                  <p className="text-[10px] font-mono text-surface-muted mt-1">{item.meta}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => act(item, 'approve')}
                    disabled={isBusy}
                    title={isBoss && item.kind === 'expense' ? 'Mark paid' : 'Approve'}
                    aria-label="Approve"
                    className="w-8 h-8 rounded-md bg-status-success hover:bg-status-success/90 text-white flex items-center justify-center disabled:opacity-50 transition-colors"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  {item.kind === 'expense' && (
                    <button
                      type="button"
                      onClick={() => act(item, 'return')}
                      disabled={isBusy}
                      title="Return for revision"
                      aria-label="Return"
                      className="w-8 h-8 rounded-md border border-surface-border hover:bg-status-warning-bg hover:border-status-warning text-status-warning flex items-center justify-center disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => act(item, 'reject')}
                    disabled={isBusy}
                    title="Reject"
                    aria-label="Reject"
                    className="w-8 h-8 rounded-md border border-surface-border hover:bg-status-danger-bg hover:border-status-danger text-status-danger flex items-center justify-center disabled:opacity-50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <Link
                    href={item.href}
                    className="w-8 h-8 rounded-md hover:bg-surface-2 text-surface-muted hover:text-dm-graphite flex items-center justify-center transition-colors"
                    title="Open"
                    aria-label="Open detail"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
        {visible.length === 0 && (
          <div className="px-5 py-8 text-center text-xs text-surface-muted">
            No {tab !== 'all' ? tab : 'pending'} items.
          </div>
        )}
      </div>
    </div>
  )
}
