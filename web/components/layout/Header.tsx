'use client'
import { UserButton, useUser } from '@clerk/nextjs'
import { Bell, X, CalendarClock, Receipt, Clock } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface NotifItem {
  _id: string; type: 'leave' | 'expense'
  title: string; sub: string; href: string
}

function useNotifications(isManager: boolean) {
  const [items,  setItems]  = useState<NotifItem[]>([])
  const [loading,setLoading]= useState(false)

  useEffect(() => {
    if (!isManager) return
    setLoading(true)
    Promise.all([
      fetch('/api/lms?status=pending').then(r => r.json()),
      fetch('/api/rms?status=pending_manager').then(r => r.json()),
    ]).then(([leaves, expenses]) => {
      const notifs: NotifItem[] = []
      if (Array.isArray(leaves)) {
        leaves.slice(0, 5).forEach((l: Record<string, unknown>) => notifs.push({
          _id: `l-${l._id}`, type: 'leave',
          title: `${l.userName} requested ${l.days} day leave`,
          sub:   String(l.reason || '').slice(0, 60),
          href:  '/lms',
        }))
      }
      if (Array.isArray(expenses)) {
        expenses.slice(0, 5).forEach((e: Record<string, unknown>) => notifs.push({
          _id: `e-${e._id}`, type: 'expense',
          title: `${e.userName} logged ₹${Number(e.amount).toLocaleString('en-IN')} expense`,
          sub:   String(e.title || ''),
          href:  '/rms',
        }))
      }
      setItems(notifs)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [isManager])

  return { items, loading }
}

export default function Header({ title }: { title?: string }) {
  const { user } = useUser()
  const role      = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  const [panelOpen, setPanelOpen] = useState(false)
  const { items, loading } = useNotifications(isManager)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false)
    }
    if (panelOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [panelOpen])

  const unread = items.length

  const toggleSidebar = () => window.dispatchEvent(new CustomEvent('toggle-sidebar'))

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-surface-border px-5 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={toggleSidebar}
          className="md:hidden p-1.5 rounded-lg hover:bg-surface text-gray-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {title && <h1 className="text-base font-bold text-gray-900">{title}</h1>}
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Bell */}
        <div className="relative" ref={panelRef}>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setPanelOpen(o => !o)}
            className="relative p-2 rounded-xl hover:bg-surface text-gray-500 transition-colors"
          >
            <Bell className="w-4 h-4" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {/* Notification panel */}
          {panelOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl border border-surface-border shadow-xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
                <p className="text-sm font-bold text-gray-900">Notifications</p>
                <button type="button" aria-label="Close" onClick={() => setPanelOpen(false)} className="p-1 rounded-lg hover:bg-surface text-surface-muted">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {!isManager ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="w-8 h-8 text-surface-border mx-auto mb-2" />
                  <p className="text-sm text-surface-muted">No notifications right now.</p>
                </div>
              ) : loading ? (
                <div className="px-4 py-6 space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-surface-border animate-pulse" />)}
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Clock className="w-8 h-8 text-surface-border mx-auto mb-2" />
                  <p className="text-sm text-surface-muted">All caught up!</p>
                  <p className="text-xs text-surface-muted mt-0.5">No pending approvals.</p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-surface-border">
                  {items.map(item => {
                    const Icon = item.type === 'leave' ? CalendarClock : Receipt
                    return (
                      <Link key={item._id} href={item.href} onClick={() => setPanelOpen(false)}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-surface transition-colors">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                          ${item.type === 'leave' ? 'bg-purple-50' : 'bg-orange-50'}`}>
                          <Icon className={`w-4 h-4 ${item.type === 'leave' ? 'text-purple-500' : 'text-orange-500'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-900 leading-tight">{item.title}</p>
                          <p className="text-xs text-surface-muted mt-0.5 truncate">{item.sub}</p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}

              {isManager && items.length > 0 && (
                <div className="px-4 py-2.5 border-t border-surface-border flex gap-3">
                  <Link href="/lms" onClick={() => setPanelOpen(false)}
                    className="flex-1 text-center text-xs font-semibold text-brand-500 hover:text-brand-700 py-1">
                    View Leaves
                  </Link>
                  <Link href="/rms" onClick={() => setPanelOpen(false)}
                    className="flex-1 text-center text-xs font-semibold text-brand-500 hover:text-brand-700 py-1">
                    View Expenses
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:block text-right">
            <p className="text-xs font-semibold text-gray-900 leading-tight">{user?.fullName}</p>
            <p className="text-[10px] text-surface-muted capitalize">{role}</p>
          </div>
          <UserButton />
        </div>
      </div>
    </header>
  )
}
