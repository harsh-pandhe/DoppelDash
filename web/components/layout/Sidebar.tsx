'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, CalendarClock, Receipt,
  Settings, ChevronRight, X, Megaphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard, roles: ['employee','manager','boss'] },
  { href: '/crm',            label: 'CRM',            icon: Users,           roles: ['employee','manager','boss'] },
  { href: '/lms',            label: 'Leave',          icon: CalendarClock,   roles: ['employee','manager','boss'] },
  { href: '/rms',            label: 'Reimbursements', icon: Receipt,         roles: ['employee','manager','boss'] },
  { href: '/announcements',  label: 'Announcements',  icon: Megaphone,       roles: ['employee','manager','boss'] },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { user }  = useUser()
  const role      = (user?.unsafeMetadata?.role as string) || 'employee'
  const [open, setOpen] = useState(false)

  // Listen for hamburger toggle from Header
  useEffect(() => {
    const handler = () => setOpen(o => !o)
    window.addEventListener('toggle-sidebar', handler)
    return () => window.removeEventListener('toggle-sidebar', handler)
  }, [])

  // Close on route change
  useEffect(() => { setOpen(false) }, [pathname])

  const navContent = (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
            <span className="font-black text-sm">D</span>
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">DoppelDash</p>
            <p className="text-[10px] text-white/50 leading-tight">Doppelmayr India</p>
          </div>
        </div>
        {/* Close button — mobile only */}
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setOpen(false)}
          className="md:hidden p-1.5 rounded-lg hover:bg-white/10 text-white/60"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
        <p className="text-[10px] font-semibold tracking-widest text-white/40 uppercase px-2 mb-3">Menu</p>
        {NAV.filter(n => n.roles.includes(role)).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group',
                active
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-white/65 hover:bg-white/10 hover:text-white'
              )}
            >
              <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-white' : 'text-white/50 group-hover:text-white/80')} />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="w-3 h-3 text-white/50" />}
            </Link>
          )
        })}
      </nav>

      {/* Role badge + settings */}
      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        <Link href="/settings" className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
          pathname === '/settings' ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'
        )}>
          <Settings className="w-4 h-4 text-white/50" />
          Settings
        </Link>
        <div className="px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Role: </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-accent-400">{role}</span>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 h-screen bg-brand-700 text-white flex-shrink-0">
        {navContent}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer */}
      <aside className={cn(
        'fixed top-0 left-0 z-50 flex flex-col w-64 h-full bg-brand-700 text-white transition-transform duration-300 md:hidden',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {navContent}
      </aside>
    </>
  )
}
