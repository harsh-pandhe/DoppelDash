'use client'

import React, { useState } from 'react'
import { Bell, Building2, CalendarDays, FileText, LayoutDashboard, Palette, Plane, Plus, Receipt, Settings, Share2, Trash2, Users } from 'lucide-react'
import tokens from '@/design/tokens.json'
import { BRANDS, TYPE_SCALE } from '@/lib/ds/tokens'
import type { BrandId } from '@/lib/ds/tokens'
import { DEFAULT_BRAND_FOR_WEB } from '@/lib/ds/brand'
import {
  AppShell, Avatar, Banner, Button, Card, Checkbox, Chip, ConfirmDialog, CountBadge, DataTable, DateField, Dialog, EmptyState, ErrorState,
  Expandable, FilterBar, ForbiddenState, FormActions, FormSection, Icon, IconButton, Illustration, List, ListRow, MetricCard, OfflineBanner,
  PageHeader, PasswordField, Presence, Reveal, SearchField, Segmented, Select, Sheet, SkeletonCard, SkeletonText, StatusBadge,
  SuccessMark, Switch, Tabs, TextArea, TextField, TimeField, ToastProvider, Tooltip, useToast, DsProvider,
} from '@/components/ds'
import type { Art, Column, NavGroup, ThemePreference } from '@/components/ds'

const NAV: NavGroup[] = [
  { id: 'foundations', label: 'Foundations', items: [
    { id: 'brand', label: 'Brand', href: '#brand', icon: Building2, primary: true },
    { id: 'color', label: 'Color', href: '#color', icon: Palette, primary: true },
    { id: 'type', label: 'Typography', href: '#type', icon: FileText },
    { id: 'shape', label: 'Shape & space', href: '#shape', icon: LayoutDashboard },
  ] },
  { id: 'components', label: 'Components', items: [
    { id: 'buttons', label: 'Buttons', href: '#buttons', icon: Plus, primary: true },
    { id: 'fields', label: 'Fields', href: '#fields', icon: Receipt, primary: true },
    { id: 'selection', label: 'Chips & tabs', href: '#selection', icon: CalendarDays },
    { id: 'cards', label: 'Cards & lists', href: '#cards', icon: Users },
    { id: 'table', label: 'Data table', href: '#table', icon: Receipt },
    { id: 'overlays', label: 'Overlays', href: '#overlays', icon: Bell, badge: 3 },
    { id: 'states', label: 'States', href: '#states', icon: Settings },
    { id: 'motion', label: 'Motion', href: '#motion', icon: Plane },
    { id: 'art', label: 'Illustrations', href: '#art', icon: Palette },
  ] },
]

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mb-12 scroll-mt-24">
      <h2 id={`${id}-h`} className="text-ds-headline-small text-ds-on-surface">{title}</h2>
      {note && <p className="mt-1 max-w-prose text-ds-body-medium text-ds-on-surface-variant">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Swatch({ name, bg, fg }: { name: string; bg: string; fg: string }) {
  return <div className="flex h-16 w-28 items-end rounded-ds-md border border-ds-outline-variant p-2" style={{ backgroundColor: `rgb(var(--ds-${bg}))`, color: `rgb(var(--ds-${fg}))` }}><span className="break-words text-ds-label-small leading-tight">{name}</span></div>
}

interface Row { id: string; name: string; dept: string; amount: number; status: string }
const ROWS: Row[] = [
  { id: '1', name: 'Asha Rao', dept: 'Engineering', amount: 12500, status: 'pending_manager' },
  { id: '2', name: 'Vikram Singh', dept: 'Operations', amount: 48250, status: 'approved' },
  { id: '3', name: 'Meera Iyer', dept: 'Sales', amount: 3200, status: 'rejected' },
]
const rupees = (n: number) => '₹' + n.toLocaleString('en-IN')

function Controls({ brand, onBrand, theme, onTheme, motion, onMotion }: { brand: BrandId; onBrand: (b: BrandId) => void; theme: ThemePreference; onTheme: (t: ThemePreference) => void; motion: boolean; onMotion: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented ariaLabel="Brand layer" value={brand} onChange={onBrand} options={{ doppelmayr: 'Doppelmayr', doppeldash: 'DoppelDash' }} />
      <Segmented ariaLabel="Theme" value={theme} onChange={onTheme} options={{ light: 'Light', dark: 'Dark', system: 'System' }} />
      <Switch label="Reduce motion" checked={motion} onCheckedChange={onMotion} className="min-h-10" />
    </div>
  )
}

function Body({ brand, controls }: { brand: BrandId; controls: React.ReactNode }) {
  const { toast } = useToast()
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [filters, setFilters] = useState<string[]>([])
  const [view, setView] = useState<'list' | 'grid' | 'calendar'>('list')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | undefined>()
  const [asc, setAsc] = useState(true)
  const [loading, setLoading] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [presence, setPresence] = useState(true)
  const [flip, setFlip] = useState(0)
  const [sw, setSw] = useState(true)
  const b = BRANDS[brand]

  let rows = [...ROWS]
  if (sortKey === 'amount') rows.sort((x, y) => (asc ? x.amount - y.amount : y.amount - x.amount))
  if (sortKey === 'name') rows.sort((x, y) => (asc ? x.name.localeCompare(y.name) : y.name.localeCompare(x.name)))
  if (empty) rows = []

  const cols: Column<Row>[] = [
    { key: 'name', header: 'Employee', weight: 3, sortable: true, cell: r => <span className="flex items-center gap-3"><Avatar name={r.name} size={32} />{r.name}</span> },
    { key: 'dept', header: 'Department', weight: 2, cell: r => r.dept },
    { key: 'amount', header: 'Amount', weight: 2, numeric: true, sortable: true, cell: r => rupees(r.amount) },
    { key: 'status', header: 'Status', weight: 2, cell: r => <StatusBadge status={r.status} label={r.status.replace('_', ' ')} /> },
  ]
  const colorRoles: [string, string, string][] = [
    ['primary', 'primary', 'on-primary'], ['primaryContainer', 'primary-container', 'on-primary-container'], ['secondary', 'secondary', 'on-secondary'], ['secondaryContainer', 'secondary-container', 'on-secondary-container'],
    ['tertiary', 'tertiary', 'on-tertiary'], ['tertiaryContainer', 'tertiary-container', 'on-tertiary-container'], ['error', 'error', 'on-error'], ['errorContainer', 'error-container', 'on-error-container'],
    ['success', 'success', 'on-success'], ['successContainer', 'success-container', 'on-success-container'], ['warning', 'warning', 'on-warning'], ['warningContainer', 'warning-container', 'on-warning-container'],
    ['info', 'info', 'on-info'], ['infoContainer', 'info-container', 'on-info-container'],
  ]
  const surfaces: [string, string][] = [['surface (page)', 'surface'], ['containerLowest', 'surface-container-lowest'], ['containerLow', 'surface-container-low'], ['container', 'surface-container'], ['containerHigh', 'surface-container-high'], ['containerHighest', 'surface-container-highest'], ['inverseSurface', 'inverse-surface']]
  const arts: Art[] = ['welcomeWork', 'welcomeApprove', 'welcomeConnect', 'empty', 'search', 'inbox', 'calendar', 'receipt', 'contacts', 'travel', 'announce', 'offline', 'error', 'success', 'lock', 'team', 'setup', 'notFound', 'forbidden']

  return (
    <>
      <div className="mb-6 md:hidden">{controls}</div>
      <PageHeader title="Design system" description={`Living reference — ${b.name} brand layer, ${b.tone} tone. Every foundation and component below is the same code the product uses.`} breadcrumbs={[{ label: 'Internal', href: '#' }, { label: 'Design system' }]} actions={<Button variant="outlined" icon={Share2} onClick={() => toast({ type: 'info', message: 'Link copied (demo)' })}>Share</Button>} />
      <OfflineBanner className="mb-6" />

      <Section id="brand" title="Brand layer" note="One component library, two brand layers. The brand is chosen per client build — never from an organisation id.">
        <Card className="flex flex-col gap-3">
          <Illustration art="setup" size={72} />
          <div className="text-ds-headline-small text-ds-on-surface">{b.name}</div>
          <div className="text-ds-body-large text-ds-on-surface-variant">{b.tagline}</div>
          <div className="text-ds-label-medium text-ds-on-surface-variant">tone: {b.tone} · client: {b.client} · seed {b.seed}</div>
        </Card>
      </Section>

      <Section id="color" title="Color" note="Material 3 roles generated per brand; semantic roles shared. No hex in feature code — only roles.">
        <div className="flex flex-wrap gap-2">{colorRoles.map(([n, bg, fg]) => <Swatch key={n} name={n} bg={bg} fg={fg} />)}</div>
        <h3 className="mb-2 mt-6 text-ds-title-small">Surfaces</h3>
        <div className="flex flex-wrap gap-2">{surfaces.map(([n, v]) => <Swatch key={n} name={n} bg={v} fg={v.includes('inverse') ? 'on-inverse-surface' : 'on-surface'} />)}</div>
        <h3 className="mb-2 mt-6 text-ds-title-small">Data visualisation</h3>
        <div className="flex gap-1">{[1, 2, 3, 4, 5, 6, 7, 8].map(i => <div key={i} className="h-6 flex-1 rounded-ds-sm" style={{ backgroundColor: `rgb(var(--ds-chart-${i}))` }} />)}</div>
      </Section>

      <Section id="type" title="Typography" note="Inter Tight for display/headline/large titles and numerics; Inter for text. Minimum 11px; numbers use tabular figures.">
        <div className="space-y-2">
          {(Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[]).map(k => {
            const v = TYPE_SCALE[k]
            const tabular = 'tabular' in v && (v as { tabular?: boolean }).tabular
            return <div key={k} className={tabular ? 'ds-tabular' : undefined} style={{ fontSize: v.size, lineHeight: `${v.line}px`, fontWeight: v.weight, letterSpacing: v.track, fontFamily: v.family === 'display' ? 'var(--ds-font-display)' : 'var(--ds-font-sans)' }}>{k} · {v.size}/{v.line} — {tabular ? '₹12,34,567' : v.size >= 28 ? 'Quarterly review' : 'The quick brown fox jumps over the lazy dog'}</div>
          })}
        </div>
      </Section>

      <Section id="shape" title="Spacing, shape & elevation" note="4px spacing scale. Surfaces are flat and tonal; elevation is only for floating layers (menus, dialogs, sheets, toasts).">
        <div className="flex flex-wrap items-end gap-4">{(['1', '2', '3', '4', '6', '8', '12'] as const).map(k => <div key={k} className="text-center"><div className="bg-ds-primary" style={{ width: (tokens.core.space as Record<string, number>)[k], height: (tokens.core.space as Record<string, number>)[k] }} /><div className="mt-1 text-ds-label-small">{(tokens.core.space as Record<string, number>)[k]}</div></div>)}</div>
        <div className="mt-6 flex flex-wrap gap-4">{(['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const).map(k => <div key={k} className="text-center"><div className="h-12 w-16 bg-ds-primary-container" style={{ borderRadius: `var(--ds-radius-${k})` }} /><div className="mt-1 text-ds-label-small">{k} {(tokens.core.radius as Record<string, number>)[k]}</div></div>)}</div>
        <div className="mt-6 flex flex-wrap gap-4">{[1, 2, 3].map(n => <div key={n} className="flex h-20 w-28 items-center justify-center rounded-ds-md bg-ds-surface-container-high text-ds-label-medium" style={{ boxShadow: `var(--ds-elev-${n})` }}>elevation {n}</div>)}</div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Filled</Button><Button variant="tonal">Tonal</Button><Button variant="outlined">Outlined</Button><Button variant="text">Text</Button>
          <Button variant="danger" icon={Trash2}>Delete</Button><Button disabled>Disabled</Button><Button loading>Saving</Button>
          <Button size="sm">Small</Button><Button size="lg">Large</Button>
          <IconButton icon={Bell} label="Notifications" /><IconButton icon={Share2} label="Share" variant="tonal" />
          <Tooltip label="Tooltip on hover or focus"><Button variant="text">Hover me</Button></Tooltip>
        </div>
      </Section>

      <Section id="fields" title="Fields & forms" note="Label always visible; helper/error reserve their own line, so an error never shifts the layout. Errors are announced.">
        <Card className="max-w-xl">
          <FormSection title="Employee details" description="One rhythm for every form.">
            <TextField label="Full name" helper="As on your ID" required />
            <TextField label="Work email" type="email" error="Enter a valid e-mail address" defaultValue="asha@" />
            <PasswordField label="Password" helper="8–128 characters" />
            <Select label="Department" placeholder="Choose…" options={[{ value: 'eng', label: 'Engineering' }, { value: 'ops', label: 'Operations' }, { value: 'sales', label: 'Sales' }]} defaultValue="eng" />
            <div className="grid gap-4 sm:grid-cols-2"><DateField label="Start date" /><TimeField label="Reporting time" /></div>
            <TextArea label="Notes" rows={3} />
            <SearchField value={search} onValueChange={setSearch} placeholder="Search people, contacts…" />
            <Checkbox label="Send me approval notifications" description="Email and in-app" defaultChecked />
            <Switch label="Weekly summary" checked={sw} onCheckedChange={setSw} />
          </FormSection>
          <FormActions className="mt-6"><Button variant="text">Cancel</Button><Button onClick={() => toast({ type: 'success', message: 'Changes saved' })}>Save changes</Button></FormActions>
        </Card>
      </Section>

      <Section id="selection" title="Chips, filters, segmented, tabs & badges">
        <div className="space-y-5">
          <FilterBar multi allLabel="All" ariaLabel="Claim status" options={{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected', paid: 'Paid' }} selected={filters} onChange={setFilters} />
          <Segmented ariaLabel="View" value={view} onChange={setView} options={{ list: 'List', grid: 'Grid', calendar: 'Calendar' }} />
          <Tabs ariaLabel="Sections" tabs={[{ value: 'o', label: 'Overview', content: <p className="text-ds-body-medium">Overview content</p> }, { value: 'a', label: 'Activity', content: <p className="text-ds-body-medium">Activity content</p> }, { value: 'f', label: 'Files', content: <p className="text-ds-body-medium">Files content</p> }]} />
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status="pending_manager" label="Awaiting manager" /><StatusBadge status="approved" label="Approved" /><StatusBadge status="rejected" label="Rejected" /><StatusBadge status="returned" label="Returned" /><StatusBadge status="draft" label="Draft" /><CountBadge count={7} /><Chip label="Static chip" /></div>
        </div>
      </Section>

      <Section id="cards" title="Cards, metrics, lists & avatars">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Pending approvals" value="12" caption="3 urgent" icon={Bell} emphasis />
          <MetricCard label="Reimbursements" value={rupees(48250)} caption="This month" icon={Receipt} tone="success" />
          <MetricCard label="On leave today" value="4" caption="of 38 members" icon={Users} tone="info" />
        </div>
        <Card padded={false} className="mt-4">
          <List ariaLabel="Recent requests">
            <ListRow leading={<Avatar name="Asha Rao" />} title="Asha Rao" subtitle="Casual leave · 2 days" trailing={<StatusBadge status="pending_manager" label="Pending" />} onClick={() => {}} />
            <ListRow leading={<Avatar name="Vikram Singh" />} title="Vikram Singh" subtitle="Travel · Pune → Mumbai" trailing={<StatusBadge status="approved" label="Approved" />} onClick={() => {}} />
          </List>
        </Card>
        <div className="mt-4 flex gap-2">{['Asha Rao', 'Vikram Singh', 'Meera Iyer', 'Dev Patel'].map(n => <Avatar key={n} name={n} size={44} />)}</div>
      </Section>

      <Section id="table" title="Data table" note="md+: a real table with sortable columns and keyboard-activatable rows. Below md: one compact card-like row per record.">
        <div className="mb-3 flex gap-2"><Chip label="Loading" selected={loading} onSelectedChange={setLoading} /><Chip label="Empty" selected={empty} onSelectedChange={setEmpty} /></div>
        <Card padded={false}>
          <DataTable
            caption="Expense claims" rows={rows} columns={cols} rowKey={r => r.id} loading={loading} sortKey={sortKey} sortAsc={asc}
            onSort={(k, a) => { setSortKey(k); setAsc(a) }} onRowClick={() => toast({ type: 'info', message: 'Row opened (demo)' })} rowLabel={r => `${r.name}, ${r.dept}, ${rupees(r.amount)}`}
            empty={<EmptyState art="receipt" compact title="No claims yet" message="Claims you submit will appear here." />}
            renderCompact={r => <ListRow leading={<Avatar name={r.name} />} title={r.name} subtitle={`${r.dept} · ${rupees(r.amount)}`} trailing={<StatusBadge status={r.status} label={r.status.replace('_', ' ')} />} />}
          />
        </Card>
      </Section>

      <Section id="overlays" title="Dialogs, sheets, snackbars">
        <div className="flex flex-wrap gap-3">
          <Button variant="outlined" onClick={() => setDialog(true)}>Dialog</Button>
          <Button variant="outlined" onClick={() => setConfirm(true)}>Destructive confirm</Button>
          <Button variant="outlined" onClick={() => setSheet(true)}>Sheet</Button>
          <Button variant="outlined" onClick={() => toast({ type: 'success', message: 'Claim submitted' })}>Success toast</Button>
          <Button variant="outlined" onClick={() => toast({ type: 'error', message: 'Couldn’t save. Try again.', actionLabel: 'Retry' })}>Error toast</Button>
        </div>
        <Dialog open={dialog} onOpenChange={setDialog} title="Submit claim?" description="Your manager will be notified." footer={<><Button variant="text" onClick={() => setDialog(false)}>Cancel</Button><Button onClick={() => setDialog(false)}>Submit</Button></>} />
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete contact?" message="This can’t be undone." confirmLabel="Delete" destructive onConfirm={() => new Promise(r => setTimeout(r, 700))} />
        <Sheet open={sheet} onOpenChange={setSheet} title="Filter claims" description="Side sheet on wide screens, bottom sheet on narrow ones." footer={<Button onClick={() => setSheet(false)}>Apply</Button>}><FilterBar ariaLabel="Status" options={{ a: 'Pending', b: 'Approved' }} selected={[]} onChange={() => {}} /></Sheet>
      </Section>

      <Section id="states" title="Loading, empty, error & access states">
        <div className="grid gap-4 md:grid-cols-2">
          <Card><SkeletonText lines={3} /></Card>
          <SkeletonCard />
          <Banner role="warning" className="md:col-span-2">Some data may be out of date.</Banner>
          <Banner role="error" className="md:col-span-2" onDismiss={() => {}}>We couldn’t reach the server.</Banner>
          <Card><EmptyState compact art="empty" title="Nothing here yet" message="When something needs your attention it will show up here." action={<Button icon={Plus}>Create</Button>} /></Card>
          <Card><ErrorState compact onRetry={async () => { await new Promise(r => setTimeout(r, 700)) }} /></Card>
          <Card><ForbiddenState compact /></Card>
        </div>
      </Section>

      <Section id="motion" title="Motion" note="Fade + small movement, 140–320ms, standard/emphasized easing. Collapses to a short fade under reduced motion.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="tonal" onClick={() => setPresence(p => !p)}>{presence ? 'Hide' : 'Show'} (presence)</Button>
          <Button variant="tonal" onClick={() => setFlip(f => f + 1)}>Replay reveal</Button>
          <SuccessMark />
        </div>
        <div className="mt-4 space-y-3">
          <Presence show={presence}><Banner role="info">This banner animates in and out of the layout.</Banner></Presence>
          <Reveal key={flip}><Card>Reveal: fade + 8px rise on first appearance</Card></Reveal>
          <Expandable title="Expandable section" subtitle="Chevron rotates, body animates"><p className="text-ds-body-medium text-ds-on-surface-variant">Details revealed here.</p></Expandable>
        </div>
      </Section>

      <Section id="art" title="Illustrations & icons" note="Vector, geometric, token-coloured. One restrained illustration per empty/error state; icons share a 1.75 stroke and a 16/20/24/32/48 size scale.">
        <div className="flex flex-wrap gap-4">{arts.map(a => <div key={a} className="text-center"><Illustration art={a} size={72} /><div className="text-ds-label-small">{a}</div></div>)}</div>
        <div className="mt-6 flex flex-wrap items-end gap-6">{(['xs', 'sm', 'md', 'lg', 'xl'] as const).map(s => <div key={s} className="text-center"><Icon icon={Plane} size={s} /><div className="text-ds-label-small">{s}</div></div>)}</div>
      </Section>
    </>
  )
}

export default function Showcase({ initialBrand, initialTheme, initialReduced }: { initialBrand?: BrandId; initialTheme?: ThemePreference; initialReduced?: boolean }) {
  const [brand, setBrand] = useState<BrandId>(initialBrand ?? DEFAULT_BRAND_FOR_WEB)
  const [theme, setTheme] = useState<ThemePreference>(initialTheme ?? 'light')
  const [reduced, setReduced] = useState(Boolean(initialReduced))
  const controls = <Controls brand={brand} onBrand={setBrand} theme={theme} onTheme={setTheme} motion={reduced} onMotion={setReduced} />
  return (
    <DsProvider brand={brand} theme={theme} motion={reduced ? 'reduced' : 'auto'}>
      <ToastProvider>
        <AppShell groups={NAV} activeId="brand" topBar={<><span className="hidden md:block">{controls}</span><span className="text-ds-title-medium md:hidden">Design system</span></>}>
          <Body brand={brand} controls={controls} />
        </AppShell>
      </ToastProvider>
    </DsProvider>
  )
}
