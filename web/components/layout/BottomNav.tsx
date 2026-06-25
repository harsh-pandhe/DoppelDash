'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LayoutDashboard, Users, CalendarClock, Receipt, Plane, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/dashboard', label: 'Home',     icon: LayoutDashboard },
  { href: '/crm',       label: 'Contacts', icon: Users },
  { href: '/mail',      label: 'Mail',     icon: Mail },
  { href: '/lms',       label: 'Leave',    icon: CalendarClock },
  { href: '/rms',       label: 'Expense',  icon: Receipt },
  { href: '/travel',    label: 'Travel',   icon: Plane },
]

// Same key Header uses to mark notifications read
const READ_AT_KEY = 'doppeldash-notifs-read-at'

/** Lightweight unread poll so mobile users get a signal without opening the bell. */
function useUnreadDot(): boolean {
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res  = await fetch('/api/notifications')
        const data = await res.json()
        if (cancelled || !Array.isArray(data.items)) return
        let readAt = 0
        try { readAt = Number(localStorage.getItem(READ_AT_KEY)) || 0 } catch { /* ignore */ }
        setHasUnread(data.items.some((i: { ts: string }) => new Date(i.ts).getTime() > readAt))
      } catch { /* best-effort */ }
    }
    check()
    const id = setInterval(check, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return hasUnread
}

export default function BottomNav() {
  const pathname  = usePathname()
  const hasUnread = useUnreadDot()
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-surface-border shadow-[0_-2px_8px_rgba(0,0,0,0.04)] grid grid-cols-6 pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary navigation">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
        const showDot = hasUnread && href === '/dashboard' && !active
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-2 transition-colors min-h-[56px]',
              active ? 'text-brand-600' : 'text-surface-muted hover:text-ink-muted active:bg-surface'
            )}
          >
            <span className="relative">
              <Icon className={cn('w-5 h-5', active && 'stroke-[2.5]')} />
              {showDot && (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" aria-label="Unread notifications" />
              )}
            </span>
            <span className={cn('text-[10px] font-semibold leading-none', active && 'font-bold')}>{label}</span>
            {active && <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-brand-500" />}
          </Link>
        )
      })}
    </nav>
  )
}
