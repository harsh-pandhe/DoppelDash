'use client'

import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { IconButton } from './button'
import { Icon } from './icon'
import { CountBadge } from './selection'
import { Skeleton } from './states'
import { Sheet } from './overlay'
import { useDsOptional } from './provider'

export interface NavItem { id: string; label: string; href: string; icon: LucideIcon; badge?: number; /** Shown in the bottom bar on narrow screens (max 4). */ primary?: boolean }
export interface NavGroup { id: string; label?: string; items: NavItem[] }
export type LinkComponent = React.ElementType<{ href: string; className?: string; children?: React.ReactNode; 'aria-current'?: 'page' | undefined; onClick?: () => void; title?: string }>

/** Brand mark + name from the active brand layer (never from an organisation id). */
export function BrandLogo({ size = 28, showName = true, className }: { size?: number; showName?: boolean; className?: string }) {
  const brand = useDsOptional()?.brand
  const name = brand?.name ?? 'DoppelDash'
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      {brand?.logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoSrc} alt={showName ? '' : name} height={size} style={{ height: size, width: 'auto' }} className="ds-brand-logo" />
      ) : (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-ds-md bg-ds-primary font-bold text-ds-on-primary" style={{ width: size, height: size, fontSize: size * 0.5 }}>{name.charAt(0)}</span>
      )}
      {showName && !brand?.logoSrc && <span className="truncate text-ds-title-large font-extrabold tracking-tight text-ds-on-surface">{name}</span>}
      {showName && brand?.logoSrc && <span className="ds-sr-only">{name}</span>}
    </span>
  )
}

function NavLink({ item, active, collapsed, Link, onNavigate }: { item: NavItem; active: boolean; collapsed?: boolean; Link: LinkComponent; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={cn('relative flex min-h-12 items-center gap-3 rounded-ds-full px-4 text-ds-label-large transition-colors duration-ds-fast ease-ds-standard', collapsed && 'justify-center px-0', active ? 'bg-ds-secondary-container text-ds-on-secondary-container' : 'text-ds-on-surface-variant hover:bg-ds-on-surface/[.08] hover:text-ds-on-surface')}
    >
      <Icon icon={item.icon} size="md" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {item.badge ? <CountBadge count={item.badge} className={cn(collapsed && 'absolute right-2 top-1.5')} /> : null}
      {collapsed && <span className="ds-sr-only">{item.label}</span>}
    </Link>
  )
}

function NavList({ groups, activeId, collapsed, Link, onNavigate }: { groups: NavGroup[]; activeId: string; collapsed?: boolean; Link: LinkComponent; onNavigate?: () => void }) {
  return (
    <>
      {groups.map(g => (
        <div key={g.id} role="group" aria-label={g.label} className="space-y-1">
          {g.label && !collapsed && <div className="px-4 pb-1 pt-4 text-ds-label-medium font-semibold uppercase tracking-wide text-ds-on-surface-variant/80">{g.label}</div>}
          {g.items.map(i => <NavLink key={i.id} item={i} active={i.id === activeId} collapsed={collapsed} Link={Link} onNavigate={onNavigate} />)}
        </div>
      ))}
    </>
  )
}

const DefaultLink: LinkComponent = ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>

/**
 * Responsive application shell. ONE navigation model per window class:
 *   ≥1024px  sidebar (264px, collapsible to an 80px rail)
 *   768–1023 rail (icons + tooltips)
 *   <768     bottom bar (≤4 primary destinations) + "More" sheet with every destination
 * While the user's role is not yet known pass `loading` — the shell renders a neutral skeleton instead of
 * guessing a role (permissions always come from the server).
 */
export function AppShell({ groups, activeId, children, topBar, user, loading, Link = DefaultLink, footerNav }: { groups: NavGroup[]; activeId: string; children: React.ReactNode; topBar?: React.ReactNode; user?: React.ReactNode; loading?: boolean; Link?: LinkComponent; footerNav?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [more, setMore] = useState(false)
  const all = groups.flatMap(g => g.items)
  const bottom = all.filter(i => i.primary).slice(0, 4)

  const skeletonNav = (
    <div role="status" aria-label="Loading navigation" className="space-y-3 px-3 py-4">
      {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full rounded-ds-full" />)}
    </div>
  )

  return (
    <div className="flex min-h-screen bg-ds-page text-ds-on-surface">
      <a href="#ds-main" className="ds-sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-ds-md focus:bg-ds-primary focus:px-4 focus:py-2 focus:text-ds-on-primary">Skip to content</a>

      {/* sidebar (lg) / rail (md) */}
      <aside aria-label="Primary" className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-ds-outline-variant/70 bg-ds-card md:flex', collapsed ? 'md:w-20' : 'md:w-20 lg:w-[264px]')}>
        <div className={cn('flex h-16 items-center px-4', collapsed || 'lg:px-5', 'justify-center lg:justify-start', collapsed && 'lg:justify-center')}>
          <span className="hidden lg:inline">{collapsed ? <BrandLogo showName={false} /> : <BrandLogo />}</span>
          <span className="lg:hidden"><BrandLogo showName={false} /></span>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-3">
          {loading ? skeletonNav : (
            <>
              <div className="hidden lg:block"><NavList groups={groups} activeId={activeId} collapsed={collapsed} Link={Link} /></div>
              <div className="lg:hidden"><NavList groups={groups} activeId={activeId} collapsed Link={Link} /></div>
            </>
          )}
        </nav>
        <div className="hidden border-t border-ds-outline-variant/70 p-2 lg:block">
          <IconButton icon={collapsed ? ChevronRight : ChevronLeft} label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(c => !c)} />
          {footerNav}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ds-outline-variant/70 bg-ds-page/95 px-4 backdrop-blur-none md:px-6">
          <span className="md:hidden"><BrandLogo showName={false} /></span>
          <div className="min-w-0 flex-1">{topBar}</div>
          {user}
        </header>
        <main id="ds-main" tabIndex={-1} className="mx-auto w-full max-w-ds-content flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-10 lg:px-8">{children}</main>
      </div>

      {/* bottom bar (<md) */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-ds-outline-variant/70 bg-ds-card md:hidden">
        {loading ? <div className="flex flex-1 items-center justify-around px-6">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-8 rounded-ds-full" />)}</div> : (
          <>
            {bottom.map(i => {
              const on = i.id === activeId
              return (
                <Link key={i.id} href={i.href} aria-current={on ? 'page' : undefined} className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-ds-label-medium">
                  <span className={cn('inline-flex h-8 w-14 items-center justify-center rounded-ds-full transition-colors duration-ds-fast', on ? 'bg-ds-secondary-container text-ds-on-secondary-container' : 'text-ds-on-surface-variant')}><Icon icon={i.icon} size="md" /></span>
                  <span className={on ? 'text-ds-on-surface' : 'text-ds-on-surface-variant'}>{i.label}</span>
                  {i.badge ? <CountBadge count={i.badge} className="absolute right-[26%] top-1" /> : null}
                </Link>
              )
            })}
            <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-ds-label-medium text-ds-on-surface-variant">
              <span className="inline-flex h-8 w-14 items-center justify-center"><Icon icon={MoreHorizontal} size="md" /></span>More
            </button>
          </>
        )}
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="All destinations">
        <nav aria-label="All destinations" className="space-y-1"><NavList groups={groups} activeId={activeId} Link={Link} onNavigate={() => setMore(false)} /></nav>
      </Sheet>
    </div>
  )
}

/** Page title block: breadcrumbs, title, description, and a right-aligned actions slot that wraps on narrow screens. */
export function PageHeader({ title, description, breadcrumbs, actions, className }: { title: string; description?: string; breadcrumbs?: { label: string; href?: string }[]; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1">
            <ol className="flex flex-wrap items-center gap-1 text-ds-body-small text-ds-on-surface-variant">
              {breadcrumbs.map((b, i) => (
                <li key={b.label} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>/</span>}
                  {b.href && i < breadcrumbs.length - 1 ? <a href={b.href} className="rounded-ds-xs hover:text-ds-on-surface hover:underline">{b.label}</a> : <span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>{b.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-ds-headline-medium text-ds-on-surface">{title}</h1>
        {description && <p className="mt-1 text-ds-body-medium text-ds-on-surface-variant">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

