'use client'
import { useUser, clearUserCache } from '@/lib/useUser'
import { Bell, X, CalendarClock, Receipt, Clock, Menu, Search, Users, FileText, Megaphone, LogOut, User as UserIcon, CheckCheck, Cake, Sparkles } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface SearchResult {
  type: 'contact' | 'leave' | 'expense' | 'announcement'
  id: string; title: string; sub: string; href: string
}

const SEARCH_ICONS: Record<string, React.ElementType> = {
  contact: Users, leave: CalendarClock, expense: Receipt, announcement: Megaphone,
}
const SEARCH_COLORS: Record<string, string> = {
  contact: 'bg-blue-100 text-blue-500',
  leave: 'bg-purple-100 text-purple-500',
  expense: 'bg-orange-100 text-orange-500',
  announcement: 'bg-green-100 text-green-500',
}

function GlobalSearch() {
  const router = useRouter()
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [active,  setActive]  = useState(-1)
  const inputRef  = useRef<HTMLInputElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 10)
      }
      if (e.key === 'Escape') { setOpen(false); setQuery('') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('')
      }
    }
    if (open) document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results || [])
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query])

  const go = (href: string) => {
    router.push(href)
    setOpen(false); setQuery(''); setResults([])
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && active >= 0 && results[active]) go(results[active].href)
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger button — collapsed on mobile, expanded on md+ */}
      <button
        type="button"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 10) }}
        className="flex items-center gap-2 px-3 h-9 rounded-xl border border-surface-border bg-surface text-surface-muted text-sm hover:border-brand-400 transition-colors md:w-52"
        aria-label="Search"
      >
        <Search className="w-4 h-4 flex-shrink-0" />
        <span className="hidden md:block text-xs">Search… <kbd className="ml-1 text-[9px] font-mono bg-gray-100 px-1 py-0.5 rounded">⌘K</kbd></span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[360px] glass-card rounded-2xl z-50 shadow-xl overflow-hidden animate-slide-down">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/40">
            <Search className="w-4 h-4 text-surface-muted flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(-1) }}
              onKeyDown={onKey}
              placeholder="Search contacts, leaves, expenses…"
              className="flex-1 text-sm bg-transparent outline-none text-gray-900 placeholder:text-surface-muted"
              autoComplete="off"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setResults([]) }}>
                <X className="w-3.5 h-3.5 text-surface-muted hover:text-gray-700" />
              </button>
            )}
          </div>

          {query.length < 2 ? (
            <div className="px-4 py-5 text-center text-xs text-surface-muted">Type 2+ chars to search</div>
          ) : loading ? (
            <div className="px-4 py-5 space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-xl bg-slate-100 animate-pulse" />)}
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-5 text-center text-xs text-surface-muted">No results for &quot;{query}&quot;</div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100/60 scrollbar-thin">
              {results.map((r, i) => {
                const Icon = SEARCH_ICONS[r.type] || FileText
                return (
                  <button key={r.id} type="button" onClick={() => go(r.href)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                      ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50/80'}`}
                    onMouseEnter={() => setActive(i)}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${SEARCH_COLORS[r.type]}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{r.title}</p>
                      <p className="text-[10px] text-surface-muted truncate">{r.sub}</p>
                    </div>
                    <span className="text-[9px] font-bold uppercase text-surface-muted/60 flex-shrink-0">{r.type}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface NotifItem {
  id: string; kind: 'leave' | 'expense' | 'travel' | 'announcement' | 'reminder' | 'birthday' | 'anniversary'
  title: string; subtitle: string; href: string; ts: string; urgent?: boolean
}

const READ_AT_KEY = 'doppeldash-notifs-read-at'

function loadReadAt(): number {
  if (typeof window === 'undefined') return 0
  try { return Number(localStorage.getItem(READ_AT_KEY)) || 0 } catch { return 0 }
}
function saveReadAt(ts: number) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(READ_AT_KEY, String(ts)) } catch { /* quota */ }
}

function useNotifications() {
  const [items,    setItems]   = useState<NotifItem[]>([])
  const [loading,  setLoading] = useState(false)
  const [readAt,   setReadAt]  = useState<number>(0)

  // hydrate from localStorage once on mount (avoids SSR mismatch)
  useEffect(() => { setReadAt(loadReadAt()) }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/notifications')
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch { /* best-effort */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const markAllRead = useCallback(() => {
    const now = Date.now()
    saveReadAt(now)
    setReadAt(now)
  }, [])

  const unreadItems  = items.filter(i => new Date(i.ts).getTime() > readAt)
  const unreadCount  = unreadItems.length
  const urgentUnread = unreadItems.filter(i => i.urgent).length

  return { items, loading, refresh, readAt, markAllRead, unreadCount, urgentUnread }
}

export default function Header({ title }: { title?: string }) {
  const { user }   = useUser()
  const role       = user?.role || 'employee'
  const isManager  = role === 'manager' || role === 'boss'

  const [panelOpen, setPanelOpen] = useState(false)
  const { items, loading, readAt, markAllRead, unreadCount, urgentUnread } = useNotifications()
  const panelRef = useRef<HTMLDivElement>(null)
  const total = items.length

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
        <GlobalSearch />
        {/* Notification bell */}
        <div className="relative" ref={panelRef}>
            <button
              type="button"
              aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
              onClick={() => setPanelOpen(o => !o)}
              className={`relative p-2 rounded-xl transition-colors ${panelOpen ? 'bg-brand-50 text-brand-500' : 'hover:bg-slate-100 text-gray-500'}`}
            >
              <Bell className="w-[18px] h-[18px]" />
              {unreadCount > 0 && (
                <span className={`absolute top-1 right-1 min-w-[16px] h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center leading-none px-0.5 ${urgentUnread > 0 ? 'bg-red-500 animate-pulse' : 'bg-accent-500'}`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {panelOpen && (
              <div className="absolute right-0 top-full mt-2 w-[360px] glass-card rounded-2xl z-50 overflow-hidden animate-slide-down">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/40 gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">Notifications</p>
                    {total > 0 && (
                      <p className="text-[10px] text-surface-muted truncate">
                        {urgentUnread > 0 ? <span className="text-red-600 font-bold">{urgentUnread} urgent · </span> : null}
                        {unreadCount > 0
                          ? <>{unreadCount} unread · {total} total</>
                          : <>{total} item{total > 1 ? 's' : ''} · all read</>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {unreadCount > 0 && (
                      <button type="button" onClick={markAllRead}
                        aria-label="Mark all as read" title="Mark all as read"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-brand-700 hover:bg-brand-50 transition-colors">
                        <CheckCheck className="w-3.5 h-3.5" /> Mark read
                      </button>
                    )}
                    <button type="button" aria-label="Close" onClick={() => setPanelOpen(false)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-surface-muted transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {loading && items.length === 0 ? (
                  <div className="px-4 py-5 space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-12 rounded-xl bg-slate-100/80 animate-pulse" />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-gray-700">All caught up!</p>
                    <p className="text-xs text-surface-muted mt-0.5">{isManager ? 'No pending approvals or alerts.' : 'No new notifications.'}</p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto divide-y divide-slate-100/60 scrollbar-thin">
                    {items.map(item => {
                      const Icon = item.kind === 'leave' ? CalendarClock
                        : item.kind === 'expense' ? Receipt
                        : item.kind === 'travel' ? Receipt
                        : item.kind === 'announcement' ? Megaphone
                        : item.kind === 'birthday' ? Cake
                        : item.kind === 'anniversary' ? Sparkles
                        : Bell
                      const styles = item.kind === 'leave' ? { bg: 'bg-purple-100', text: 'text-purple-500' }
                        : item.kind === 'expense' ? { bg: 'bg-orange-100', text: 'text-orange-500' }
                        : item.kind === 'travel' ? { bg: 'bg-sky-100', text: 'text-sky-500' }
                        : item.kind === 'announcement' ? { bg: 'bg-rose-100', text: 'text-rose-500' }
                        : item.kind === 'birthday' ? { bg: 'bg-pink-100', text: 'text-pink-500' }
                        : item.kind === 'anniversary' ? { bg: 'bg-brand-100', text: 'text-brand-600' }
                        : { bg: 'bg-yellow-100', text: 'text-yellow-600' }
                      const isUnread = new Date(item.ts).getTime() > readAt
                      return (
                        <Link key={item.id} href={item.href} onClick={() => setPanelOpen(false)}
                          className={`relative flex items-start gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors
                            ${item.urgent && isUnread ? 'bg-red-50/40' : ''}
                            ${!isUnread ? 'opacity-60' : ''}`}>
                          {isUnread && (
                            <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand-500" aria-hidden />
                          )}
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${styles.bg}`}>
                            <Icon className={`w-4 h-4 ${styles.text}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-xs leading-snug truncate flex-1 ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>{item.title}</p>
                              {item.urgent && isUnread && <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 flex-shrink-0">!</span>}
                            </div>
                            <p className="text-[11px] text-surface-muted mt-0.5 line-clamp-1">{item.subtitle}</p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}

                {items.length > 0 && (
                  <div className="px-4 py-2 border-t border-slate-100/60 text-center">
                    <button type="button" onClick={() => setPanelOpen(false)}
                      className="text-[11px] font-semibold text-surface-muted hover:text-gray-700">
                      Close
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

        {/* User info + menu */}
        <UserMenu />
      </div>
    </header>
  )
}

function UserMenu() {
  const { user } = useUser()
  const router   = useRouter()
  const role     = user?.role || 'employee'
  const [open,   setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    clearUserCache()
    router.replace('/sign-in')
  }

  const initials = (user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="User menu"
        className="flex items-center gap-2.5 hover:bg-surface px-2 py-1 rounded-xl transition-colors">
        <div className="hidden sm:block text-right">
          <p className="text-xs font-semibold text-gray-900 leading-tight">{user?.fullName || user?.firstName}</p>
          <p className="text-[10px] text-surface-muted capitalize">{role}</p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
          {initials || <UserIcon className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 w-60 bg-white rounded-2xl shadow-xl border border-surface-border overflow-hidden">
          <div className="p-3 border-b border-surface-border">
            <p className="text-sm font-bold text-gray-900 truncate">{user?.fullName || '—'}</p>
            <p className="text-xs text-surface-muted truncate">{user?.email}</p>
          </div>
          <div className="p-1.5 space-y-0.5">
            <Link href="/profile" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-surface transition-colors">
              <UserIcon className="w-4 h-4 text-surface-muted" />My profile
            </Link>
            <Link href="/settings" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-surface transition-colors">
              <UserIcon className="w-4 h-4 text-surface-muted" />Settings
            </Link>
            <button type="button" onClick={logout}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors w-full text-left">
              <LogOut className="w-4 h-4" />Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
