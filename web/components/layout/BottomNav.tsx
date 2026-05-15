'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, CalendarClock, Receipt, Megaphone, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/dashboard',     label: 'Home',     icon: LayoutDashboard },
  { href: '/crm',           label: 'Contacts', icon: Users },
  { href: '/crm/scan',      label: 'Scan',     icon: ScanLine },
  { href: '/lms',           label: 'Leave',    icon: CalendarClock },
  { href: '/rms',           label: 'Expense',  icon: Receipt },
  { href: '/announcements', label: 'News',     icon: Megaphone },
]

export default function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-surface-border shadow-[0_-2px_8px_rgba(0,0,0,0.04)] grid grid-cols-6 pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary navigation">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 transition-colors min-h-[56px]',
              active ? 'text-brand-600' : 'text-surface-muted hover:text-gray-700 active:bg-surface'
            )}
          >
            <Icon className={cn('w-5 h-5', active && 'stroke-[2.5]')} />
            <span className={cn('text-[10px] font-semibold leading-none', active && 'font-bold')}>{label}</span>
            {active && <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-brand-500" />}
          </Link>
        )
      })}
    </nav>
  )
}
