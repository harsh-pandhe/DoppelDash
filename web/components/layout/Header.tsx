'use client'
import { UserButton, useUser } from '@clerk/nextjs'
import { Bell, X, CalendarClock, Receipt, Clock, Menu } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

interface NotifItem {
  _id: string; type: 'leave' | 'expense'
  title: string; sub: string; href: string
}

function useNotifications(isManager: boolean) {
  const [items,   setItems]   = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!isManager) return
    setLoading(true)
    try {
      const [leaves, expenses] = await Promise.all([
        fetch('/api/lms?status=pending').then(r => r.json()),
        fetch('/api/rms?status=pending_manager').then(r => r.json()),
      ])
      const notifs: NotifItem[] = []
      if (Array.isArray(leaves)) {
        leaves.slice(0, 5).forEach((l: Record<string, unknown>) => notifs.push({
          _id: `l-${l._id}`, type: 'leave',
          title: `${l.userName} · ${l.days}d ${l.type} leave`,
          sub:   String(l.reason || '').slice(0, 60),
          href:  '/lms',
        }))
      }
      if (Array.isArray(expenses)) {
        expenses.slice(0, 5).forEach((e: Record<string, unknown>) => notifs.push({
          _id: `e-${e._id}`, type: 'expense',
          title: `${e.userName} · ₹${Number(e.amount).toLocaleString('en-IN')}`,
          sub:   String(e.title || ''),
          href:  '/rms',
        }))
      }
      setItems(notifs)
    } catch { /* best-effort */ }
    finally { setLoading(false) }
  }, [isManager])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  return { items, loading, refresh }
}

export default function Header({ title }: { title?: string }) {
  const { user }   = useUser()
  const role       = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager  = role === 'manager' || role === 'boss'

  const [panelOpen, setPanelOpen] = useState(false)
  const { items, loading } = useNotifications(isManager)
  const panelRef = useRef<HTMLDivElement>(null)
  const unread   = items.length

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false)
    }
    if (panelOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [panelOpen])

  const toggleSidebar = () => window.dispatchEvent(new CustomEvent('toggle-sidebar'))

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-white/60 shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-5 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={toggleSidebar}
          className="md:hidden p-2 rounded-xl hover:bg-surface text-gray-500 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        {title && (
          <h1 className="text-base font-bold text-gray-900 tracking-tight">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notification bell */}
        {isManager && (
          <div className="relative" ref={panelRef}>
            <button
              type="button"
              aria-label={`Notifications${unread ? ` (${unread})` : ''}`}
              onClick={() => setPanelOpen(o => !o)}
              className={`relative p-2 rounded-xl transition-colors ${panelOpen ? 'bg-brand-50 text-brand-500' : 'hover:bg-slate-100 text-gray-500'}`}
            >
              <Bell className="w-4.5 h-4.5 w-[18px] h-[18px]" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 rounded-full bg-accent-500 text-white text-[9px] font-bold flex items-center justify-center leading-none px-0.5">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {panelOpen && (
              <div className="absolute right-0 top-full mt-2 w-84 w-[340px] glass-card rounded-2xl z-50 overflow-hidden animate-slide-down">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/40">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Pending Approvals</p>
                    {unread > 0 && (
                      <p className="text-[10px] text-surface-muted">{unread} item{unread > 1 ? 's' : ''} need attention</p>
                    )}
                  </div>
                  <button type="button" aria-label="Close" onClick={() => setPanelOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-surface-muted transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {loading ? (
                  <div className="px-4 py-5 space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-12 rounded-xl bg-slate-100/80 animate-pulse" />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-gray-700">All caught up!</p>
                    <p className="text-xs text-surface-muted mt-0.5">No pending approvals.</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100/60 scrollbar-thin">
                    {items.map(item => {
                      const Icon = item.type === 'leave' ? CalendarClock : Receipt
                      return (
                        <Link key={item._id} href={item.href} onClick={() => setPanelOpen(false)}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5
                            ${item.type === 'leave' ? 'bg-purple-100' : 'bg-orange-100'}`}>
                            <Icon className={`w-4 h-4 ${item.type === 'leave' ? 'text-purple-500' : 'text-orange-500'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-900 leading-snug">{item.title}</p>
                            <p className="text-[11px] text-surface-muted mt-0.5 truncate">{item.sub}</p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}

                {items.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-slate-100/60 grid grid-cols-2 gap-2">
                    <Link href="/lms" onClick={() => setPanelOpen(false)}
                      className="text-center text-xs font-semibold text-brand-500 hover:text-brand-700 py-1 rounded-lg hover:bg-brand-50 transition-colors">
                      View Leaves
                    </Link>
                    <Link href="/rms" onClick={() => setPanelOpen(false)}
                      className="text-center text-xs font-semibold text-brand-500 hover:text-brand-700 py-1 rounded-lg hover:bg-brand-50 transition-colors">
                      View Expenses
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* User info + button */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:block text-right">
            <p className="text-xs font-semibold text-gray-900 leading-tight">{user?.fullName || user?.firstName}</p>
            <p className="text-[10px] text-surface-muted capitalize">{role}</p>
          </div>
          <UserButton />
        </div>
      </div>
    </header>
  )
}
