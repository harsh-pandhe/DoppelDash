'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@/lib/useUser'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, CalendarClock, Receipt,
  Settings, ChevronRight, ChevronDown, X, Megaphone, ScanLine,
  BarChart2, Shield, ClipboardList, TrendingUp, Plane,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard, roles: ['employee','manager','boss'] },
      { href: '/announcements', label: 'Announcements', icon: Megaphone,       roles: ['employee','manager','boss'] },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/crm',            label: 'Contacts',   icon: Users,      roles: ['employee','manager','boss'] },
      { href: '/crm/directory',  label: 'Directory',  icon: Users,      roles: ['employee','manager','boss'] },
      { href: '/crm/scan', label: 'Scan Card',        icon: ScanLine,      roles: ['employee','manager','boss'] },
      { href: '/lms',      label: 'Leave',            icon: CalendarClock, roles: ['employee','manager','boss'] },
      { href: '/lms/team',     label: 'Team Calendar',  icon: CalendarClock, roles: ['manager','boss'] },
      { href: '/lms/holidays', label: 'Holidays',       icon: CalendarClock, roles: ['employee','manager','boss'] },
      { href: '/rms',      label: 'Reimbursements',   icon: Receipt,       roles: ['employee','manager','boss'] },
      { href: '/travel',   label: 'Travel Requests',  icon: Plane,         roles: ['employee','manager','boss'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', icon: TrendingUp, roles: ['manager','boss'] },
      { href: '/reports',   label: 'Reports',   icon: BarChart2,  roles: ['manager','boss'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/admin/users', label: 'Users',     icon: Shield,       roles: ['boss'] },
      { href: '/admin/audit', label: 'Audit Log', icon: ClipboardList, roles: ['boss'] },
    ],
  },
]

const ROLE_COLOR: Record<string, string> = {
  boss:     'bg-accent-500/20 text-accent-300 border border-accent-400/30',
  manager:  'bg-brand-400/20 text-brand-100 border border-brand-300/30',
  employee: 'bg-white/10 text-white/60 border border-white/15',
}

export default function Sidebar() {
  const pathname = usePathname()
  const { user }  = useUser()
  const role      = (user?.unsafeMetadata?.role as string) || 'employee'
  const [open, setOpen] = useState(false)
  // Insights + Admin collapsed by default for managers/employees, expanded for boss
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => ({
    Insights: role !== 'boss',
    Admin:    role !== 'boss',
  }))

  useEffect(() => {
    const handler = () => setOpen(o => !o)
    window.addEventListener('toggle-sidebar', handler)
    return () => window.removeEventListener('toggle-sidebar', handler)
  }, [])

  useEffect(() => { setOpen(false) }, [pathname])

  const navContent = (
    <>
      {/* Logo */}
      <div className="px-5 pt-5 pb-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center flex-shrink-0 shadow-inner">
            <span className="font-black text-base leading-none text-white">D</span>
          </div>
          <div>
            <p className="font-extrabold text-sm leading-tight text-white tracking-tight">DoppelDash</p>
            <p className="text-[10px] text-white/45 leading-tight font-medium">Doppelmayr India</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setOpen(false)}
          className="md:hidden p-1.5 rounded-lg hover:bg-white/10 text-white/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-thin space-y-3">
        {SECTIONS.map(section => {
          const visible = section.items.filter(i => i.roles.includes(role))
          if (visible.length === 0) return null
          // Workspace + People always open. Insights/Admin collapsible.
          const isCollapsible = section.label !== 'Workspace' && section.label !== 'People'
          const isOpen = !isCollapsible || (collapsedSections[section.label] ?? false) === false
          const hasActive = visible.some(i => pathname === i.href || (i.href !== '/dashboard' && pathname.startsWith(i.href)))
          // Force-open if a child is active
          const showItems = isOpen || hasActive

          return (
            <div key={section.label}>
              <button
                type="button"
                onClick={() => isCollapsible && setCollapsedSections(s => ({ ...s, [section.label]: showItems }))}
                className="flex items-center justify-between w-full text-[9px] font-bold tracking-[0.12em] text-white/35 uppercase px-2 mb-1.5 hover:text-white/60 transition-colors"
                aria-expanded={showItems ? 'true' : 'false'}
              >
                <span>{section.label}</span>
                {isCollapsible && (
                  <ChevronDown className={`w-3 h-3 transition-transform ${showItems ? '' : '-rotate-90'}`} />
                )}
              </button>
              {showItems && (
                <div className="space-y-0.5">
                  {visible.map(({ href, label, icon: Icon }) => {
                    const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
                    return (
                      <Link
                        key={href}
                        href={href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group',
                          active
                            ? 'bg-white/18 text-white shadow-sm shadow-black/10'
                            : 'text-white/60 hover:bg-white/10 hover:text-white'
                        )}
                      >
                        <Icon className={cn(
                          'w-4 h-4 flex-shrink-0 transition-colors',
                          active ? 'text-white' : 'text-white/45 group-hover:text-white/75'
                        )} />
                        <span className="flex-1 truncate">{label}</span>
                        {active && <ChevronRight className="w-3 h-3 text-white/40 flex-shrink-0" />}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Bottom: settings + role */}
      <div className="px-3 pb-4 pt-3 border-t border-white/10 flex-shrink-0 space-y-1">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
            pathname.startsWith('/settings') ? 'bg-white/18 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
          )}
        >
          <Settings className="w-4 h-4 text-white/45" />
          Settings
        </Link>
        <div className="px-3 pt-2 flex items-center gap-2">
          <div className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest', ROLE_COLOR[role] || ROLE_COLOR.employee)}>
            {role}
          </div>
          <span className="text-[11px] text-white/40 truncate">
            {user?.firstName || user?.fullName || ''}
          </span>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 h-screen bg-gradient-to-b from-brand-800 to-brand-700 text-white flex-shrink-0 shadow-xl">
        {navContent}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer */}
      <aside className={cn(
        'fixed top-0 left-0 z-50 flex flex-col w-64 h-full bg-gradient-to-b from-brand-800 to-brand-700 text-white transition-transform duration-300 ease-in-out md:hidden shadow-2xl',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {navContent}
      </aside>
    </>
  )
}
