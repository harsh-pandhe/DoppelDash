/**
 * Design-system component BEHAVIOUR tests (jsdom + Testing Library): semantics, keyboard, states, tokens → DOM.
 * No screenshots: these assert what users and assistive tech experience.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { load, rtl, userEvent, React, setOsReducedMotion } = require('./helpers/domKit')
const { render, screen, within, cleanup, waitFor, act } = rtl
const ds = load('components/ds/index.ts')
const { cn } = load('lib/ds/cn.ts')
const h = React.createElement
const wrap = (el, brand = 'doppelmayr', props = {}) => h(ds.DsProvider, { brand, ...props }, h(ds.ToastProvider, null, el))

test.afterEach(() => cleanup())

/* ───────────── tokens → DOM ───────────── */
test('C1. DsProvider applies brand, resolved theme and motion as data attributes; theme follows the prop', () => {
  const { container, rerender } = render(h(ds.DsProvider, { brand: 'doppelmayr', theme: 'dark', motion: 'reduced' }, h('p', null, 'x')))
  const root = container.querySelector('.ds-root')
  assert.equal(root.getAttribute('data-ds-brand'), 'doppelmayr'); assert.equal(root.getAttribute('data-ds-theme'), 'dark'); assert.equal(root.getAttribute('data-ds-motion'), 'reduced')
  rerender(h(ds.DsProvider, { brand: 'doppeldash', theme: 'light' }, h('p', null, 'x')))
  const r2 = container.querySelector('.ds-root')
  assert.equal(r2.getAttribute('data-ds-brand'), 'doppeldash'); assert.equal(r2.getAttribute('data-ds-theme'), 'light')
})

test('C2. OS "reduce motion" switches the provider to reduced motion', async () => {
  setOsReducedMotion(true)
  const { container } = render(h(ds.DsProvider, { brand: 'doppelmayr' }, h('p', null, 'x')))
  await waitFor(() => assert.equal(container.querySelector('.ds-root').getAttribute('data-ds-motion'), 'reduced'))
  setOsReducedMotion(false)
})

test('C3. cn keeps ds type-scale and ds colour utilities together (tailwind-merge is taught the scale)', () => {
  assert.equal(cn('text-ds-body-medium', 'text-ds-on-surface'), 'text-ds-body-medium text-ds-on-surface')
  assert.equal(cn('px-2', 'px-4'), 'px-4')
})

test('C4. BrandLogo shows the brand layer name (no organisation lookup); Doppelmayr uses its logo asset, other brands an initial mark', () => {
  const a = render(wrap(h(ds.BrandLogo, null), 'doppelmayr'))
  const img = a.container.querySelector('img'); assert.ok(img); assert.match(img.getAttribute('src'), /doppelmayr-logo\.svg$/)
  assert.match(a.container.textContent, /Doppelmayr India/)
  cleanup()
  const b = render(wrap(h(ds.BrandLogo, null), 'doppeldash'))
  assert.equal(b.container.querySelector('img'), null); assert.match(b.container.textContent, /DoppelDash/)
})

/* ───────────── buttons ───────────── */
test('C5. Button: loading disables, sets aria-busy and swallows clicks; disabled never fires', async () => {
  let n = 0
  render(h(ds.Button, { loading: true, onClick: () => n++ }, 'Save'))
  const btn = screen.getByRole('button')
  assert.equal(btn.disabled, true); assert.equal(btn.getAttribute('aria-busy'), 'true')
  await userEvent.click(btn); assert.equal(n, 0)
  cleanup()
  render(h(ds.Button, { onClick: () => n++ }, 'Go'))
  await userEvent.click(screen.getByRole('button', { name: 'Go' })); assert.equal(n, 1)
})

test('C6. IconButton always has an accessible name', () => {
  render(h(ds.IconButton, { icon: load('node_modules/lucide-react').Bell, label: 'Notifications' }))
  const b = screen.getByRole('button', { name: 'Notifications' })
  assert.equal(b.getAttribute('title'), 'Notifications')
})

/* ───────────── fields ───────────── */
test('C7. TextField: label is associated, error is announced and wired via aria-invalid + aria-describedby', () => {
  render(h(ds.TextField, { label: 'Work email', error: 'Enter a valid e-mail', helper: 'ignored when error shows', required: true }))
  const input = screen.getByLabelText(/Work email/)
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  const alert = screen.getByRole('alert'); assert.equal(alert.textContent, 'Enter a valid e-mail')
  assert.equal(input.getAttribute('aria-describedby'), alert.parentElement.id)
  assert.equal(screen.queryByText('ignored when error shows'), null)
  assert.ok(screen.getByText('(required)'))
})

test('C8. TextField helper shows when there is no error and is linked to the control', () => {
  render(h(ds.TextField, { label: 'Name', helper: 'As on your ID' }))
  const input = screen.getByLabelText('Name')
  assert.equal(input.getAttribute('aria-invalid'), null)
  assert.equal(document.getElementById(input.getAttribute('aria-describedby')).textContent, 'As on your ID')
})

test('C9. PasswordField toggles visibility with an accessible, stateful button', async () => {
  render(h(ds.PasswordField, { label: 'Password' }))
  const input = screen.getByLabelText('Password'); assert.equal(input.type, 'password')
  const toggle = screen.getByRole('button', { name: 'Show password' })
  await userEvent.click(toggle)
  assert.equal(input.type, 'text'); assert.equal(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed'), 'true')
})

test('C10. Select renders options and reports changes; SearchField clears', async () => {
  let v = ''
  render(h(ds.Select, { label: 'Department', placeholder: 'Choose…', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], onChange: e => { v = e.target.value } }))
  await userEvent.selectOptions(screen.getByLabelText('Department'), 'b'); assert.equal(v, 'b')
  cleanup()
  const Probe = () => { const [q, setQ] = React.useState('abc'); return h(ds.SearchField, { value: q, onValueChange: setQ }) }
  render(h(Probe))
  assert.equal(screen.getByRole('searchbox', { name: 'Search' }).value, 'abc')
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  assert.equal(screen.getByRole('searchbox').value, ''); assert.equal(screen.queryByRole('button', { name: 'Clear search' }), null)
})

test('C11. Switch exposes role=switch/aria-checked and toggles; Checkbox is labelled', async () => {
  const Probe = () => { const [on, setOn] = React.useState(false); return h(ds.Switch, { label: 'Weekly summary', checked: on, onCheckedChange: setOn }) }
  render(h(Probe))
  const sw = screen.getByRole('switch', { name: 'Weekly summary' }); assert.equal(sw.getAttribute('aria-checked'), 'false')
  await userEvent.click(sw); assert.equal(sw.getAttribute('aria-checked'), 'true')
  cleanup()
  render(h(ds.Checkbox, { label: 'Notify me', description: 'Email and in-app' }))
  assert.ok(screen.getByRole('checkbox', { name: /Notify me/ }))
})

/* ───────────── selection ───────────── */
test('C12. Chip uses aria-pressed and a check mark (selection is not colour-only)', async () => {
  const Probe = () => { const [on, setOn] = React.useState(false); return h(ds.Chip, { label: 'Pending', selected: on, onSelectedChange: setOn }) }
  const { container } = render(h(Probe))
  const chip = screen.getByRole('button', { name: /Pending/ }); assert.equal(chip.getAttribute('aria-pressed'), 'false')
  await userEvent.click(chip)
  assert.equal(chip.getAttribute('aria-pressed'), 'true'); assert.ok(container.querySelector('svg'), 'check icon shown')
})

test('C13. FilterBar: single-select replaces, multi accumulates, "All" clears', async () => {
  const Probe = ({ multi }) => { const [sel, setSel] = React.useState([]); return h('div', null, h(ds.FilterBar, { multi, allLabel: 'All', options: { a: 'Alpha', b: 'Beta' }, selected: sel, onChange: setSel }), h('output', null, sel.join(','))) }
  render(h(Probe, { multi: false }))
  await userEvent.click(screen.getByRole('button', { name: 'Alpha' })); await userEvent.click(screen.getByRole('button', { name: 'Beta' }))
  assert.equal(document.querySelector('output').textContent, 'b')
  await userEvent.click(screen.getByRole('button', { name: /All/ })); assert.equal(document.querySelector('output').textContent, '')
  cleanup()
  render(h(Probe, { multi: true }))
  await userEvent.click(screen.getByRole('button', { name: 'Alpha' })); await userEvent.click(screen.getByRole('button', { name: 'Beta' }))
  assert.equal(document.querySelector('output').textContent, 'a,b')
})

test('C14. Segmented is a radiogroup with roving tabindex and arrow-key navigation', async () => {
  const Probe = () => { const [v, setV] = React.useState('list'); return h(ds.Segmented, { ariaLabel: 'View', value: v, onChange: setV, options: { list: 'List', grid: 'Grid', cal: 'Calendar' } }) }
  render(h(Probe))
  const group = screen.getByRole('radiogroup', { name: 'View' })
  const radios = within(group).getAllByRole('radio')
  assert.deepEqual(radios.map(r => r.getAttribute('aria-checked')), ['true', 'false', 'false'])
  assert.deepEqual(radios.map(r => r.tabIndex), [0, -1, -1])
  radios[0].focus()
  await userEvent.keyboard('{ArrowRight}')
  assert.equal(screen.getByRole('radio', { name: /Grid/ }).getAttribute('aria-checked'), 'true')
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
  assert.equal(screen.getByRole('radio', { name: /Calendar/ }).getAttribute('aria-checked'), 'true', 'wraps around')
})

test('C15. Tabs: tablist/tab/tabpanel semantics and keyboard selection', async () => {
  render(h(ds.Tabs, { ariaLabel: 'Sections', tabs: [{ value: 'o', label: 'Overview', content: 'overview-body' }, { value: 'a', label: 'Activity', content: 'activity-body' }] }))
  assert.ok(screen.getByRole('tablist', { name: 'Sections' }))
  assert.equal(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected'), 'true')
  assert.ok(screen.getByText('overview-body'))
  screen.getByRole('tab', { name: 'Overview' }).focus()
  await userEvent.keyboard('{ArrowRight}')
  await userEvent.keyboard('{Enter}')
  assert.equal(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected'), 'true')
  assert.ok(screen.getByText('activity-body'))
})

test('C16. StatusBadge maps domain status → semantic role through the SHARED table; unknown → neutral; label is announced', () => {
  const { container } = render(h('div', null,
    h(ds.StatusBadge, { status: 'pending_manager', label: 'Pending' }), h(ds.StatusBadge, { status: 'approved', label: 'Approved' }),
    h(ds.StatusBadge, { status: 'rejected', label: 'Rejected' }), h(ds.StatusBadge, { status: 'who_knows', label: 'Other' })))
  assert.deepEqual([...container.querySelectorAll('[data-role]')].map(e => e.getAttribute('data-role')), ['warning', 'success', 'error', 'neutral'])
  assert.ok(screen.getAllByText('Status:').length === 4)
  render(h(ds.CountBadge, { count: 120 })); assert.ok(screen.getByLabelText('120 pending')); assert.equal(screen.getByLabelText('120 pending').textContent, '99+')
  assert.equal(render(h(ds.CountBadge, { count: 0 })).container.innerHTML, '')
})

/* ───────────── data ───────────── */
const ROWS = [{ id: '1', name: 'Asha', amt: 5 }, { id: '2', name: 'Vik', amt: 9 }]
const cols = [{ key: 'name', header: 'Name', sortable: true, cell: r => r.name }, { key: 'amt', header: 'Amount', numeric: true, sortable: true, cell: r => '₹' + r.amt }]
const table = (extra = {}) => h(ds.DataTable, { caption: 'Claims', columns: cols, rows: ROWS, rowKey: r => r.id, renderCompact: r => h('div', null, 'compact-' + r.name), ...extra })

test('C17. DataTable: caption, sortable headers with aria-sort, sort callback toggles direction', async () => {
  const calls = []
  const Probe = () => { const [k, setK] = React.useState('name'); const [a, setA] = React.useState(true); return table({ sortKey: k, sortAsc: a, onSort: (key, asc) => { calls.push([key, asc]); setK(key); setA(asc) } }) }
  render(h(Probe))
  assert.ok(screen.getByText('Claims', { selector: 'caption' }))
  const nameTh = screen.getByRole('columnheader', { name: /Name/ }); assert.equal(nameTh.getAttribute('aria-sort'), 'ascending')
  assert.equal(screen.getByRole('columnheader', { name: /Amount/ }).getAttribute('aria-sort'), 'none')
  await userEvent.click(within(nameTh).getByRole('button')); assert.deepEqual(calls.at(-1), ['name', false])
  assert.equal(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort'), 'descending')
  await userEvent.click(within(screen.getByRole('columnheader', { name: /Amount/ })).getByRole('button')); assert.deepEqual(calls.at(-1), ['amt', true])
})

test('C18. DataTable rows are keyboard-activatable; compact cards are rendered for narrow screens; loading and empty states', async () => {
  let opened = null
  const { container } = render(table({ onRowClick: r => { opened = r.id }, rowLabel: r => `row ${r.name}` }))
  const row = screen.getAllByRole('row', { name: 'row Asha' })[0]
  row.focus(); await userEvent.keyboard('{Enter}'); assert.equal(opened, '1')
  assert.ok(container.querySelector('[role="list"]').textContent.includes('compact-Asha'))
  cleanup()
  render(table({ loading: true })); assert.ok(screen.getByRole('status', { name: /Loading Claims/ }))
  cleanup()
  render(table({ rows: [], empty: h('p', null, 'nothing here') })); assert.ok(screen.getByText('nothing here'))
})

/* ───────────── overlays ───────────── */
test('C19. Dialog: role=dialog labelled by its title, described, closes on Escape', async () => {
  const closes = []
  render(wrap(h(ds.Dialog, { open: true, onOpenChange: o => closes.push(o), title: 'Submit claim?', description: 'Your manager will be notified.' })))
  const d = screen.getByRole('dialog', { name: 'Submit claim?' }); assert.match(d.textContent, /manager will be notified/)
  await userEvent.keyboard('{Escape}'); assert.deepEqual(closes, [false])
})

test('C20. ConfirmDialog (async): confirm shows loading, blocks double submit, then closes; destructive styling', async () => {
  let resolve; let calls = 0
  const Probe = () => { const [open, setOpen] = React.useState(true); return h(ds.ConfirmDialog, { open, onOpenChange: setOpen, title: 'Delete contact?', message: 'Cannot be undone.', confirmLabel: 'Delete', destructive: true, onConfirm: () => { calls++; return new Promise(r => { resolve = r }) } }) }
  render(wrap(h(Probe)))
  const confirm = screen.getByRole('button', { name: 'Delete' })
  assert.match(confirm.className, /bg-ds-error/)
  await userEvent.click(confirm)
  await waitFor(() => assert.equal(screen.getByRole('button', { name: /Delete/ }).getAttribute('aria-busy'), 'true'))
  await userEvent.click(screen.getByRole('button', { name: /Delete/ })); assert.equal(calls, 1, 'no double submit')
  await act(async () => { resolve() })
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
})

test('C21. Sheet exposes a labelled dialog with a named close button', async () => {
  const closes = []
  render(wrap(h(ds.Sheet, { open: true, onOpenChange: o => closes.push(o), title: 'Filter claims' }, h('p', null, 'body'))))
  assert.ok(screen.getByRole('dialog', { name: 'Filter claims' }))
  await userEvent.click(screen.getByRole('button', { name: 'Close' })); assert.deepEqual(closes, [false])
})

test('C22. Toasts: success → polite status, error → assertive alert (with action)', async () => {
  const Probe = () => { const { toast } = ds.useToast(); return h('div', null, h('button', { onClick: () => toast({ type: 'success', message: 'Saved' }) }, 's'), h('button', { onClick: () => toast({ type: 'error', message: 'Failed', actionLabel: 'Retry' }) }, 'e')) }
  render(wrap(h(Probe)))
  await userEvent.click(screen.getByRole('button', { name: 's' })); await userEvent.click(screen.getByRole('button', { name: 'e' }))
  assert.equal(screen.getByText('Saved').closest('[role]').getAttribute('role'), 'status')
  assert.equal(screen.getByText('Failed').closest('[role]').getAttribute('role'), 'alert')
  assert.ok(screen.getByRole('button', { name: 'Retry' }))
})

/* ───────────── states ───────────── */
test('C23. EmptyState / ErrorState / ForbiddenState / Banner semantics; ErrorState retry is single-flight', async () => {
  let n = 0; let done
  render(h(ds.ErrorState, { onRetry: () => { n++; return new Promise(r => { done = r }) } }))
  assert.ok(screen.getByRole('heading', { name: 'Couldn’t load this' }))
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await userEvent.click(screen.getByRole('button', { name: /Try again/ })); assert.equal(n, 1)
  await act(async () => { done() })
  cleanup()
  render(h(ds.ForbiddenState, null)); assert.ok(screen.getByRole('heading', { name: 'You don’t have access' }))
  cleanup()
  render(h('div', null, h(ds.Banner, { role: 'error' }, 'bad'), h(ds.Banner, { role: 'info' }, 'fyi')))
  assert.ok(screen.getByRole('alert')); assert.equal(screen.getByText('fyi').closest('[role]').getAttribute('role'), 'status')
})

test('C24. Skeletons announce a single "Loading" status', () => {
  render(h(ds.SkeletonText, { lines: 4 })); assert.equal(screen.getAllByRole('status').length, 1)
})

/* ───────────── motion ───────────── */
test('C25. Expandable: aria-expanded/aria-controls and body only rendered when open', async () => {
  render(h(ds.Expandable, { title: 'More' }, 'secret-body'))
  const btn = screen.getByRole('button', { name: /More/ }); assert.equal(btn.getAttribute('aria-expanded'), 'false'); assert.equal(screen.queryByText('secret-body'), null)
  await userEvent.click(btn); assert.equal(btn.getAttribute('aria-expanded'), 'true'); assert.ok(screen.getByText('secret-body'))
  assert.equal(document.getElementById(btn.getAttribute('aria-controls')).getAttribute('role'), 'region')
})

test('C26. Reveal staggers siblings (capped), Presence mounts content when shown, SuccessMark is announced', () => {
  const { container } = render(h('div', null, h(ds.Reveal, { index: 2 }, 'a'), h(ds.Reveal, { index: 99 }, 'b')))
  const [a, b] = container.querySelectorAll('.ds-anim-rise')
  assert.equal(a.style.animationDelay, '80ms'); assert.equal(b.style.animationDelay, '240ms', 'capped at 6 × 40ms')
  cleanup()
  render(h(ds.Presence, { show: true }, 'visible-body')); assert.ok(screen.getByText('visible-body'))
  assert.equal(render(h(ds.Presence, { show: false }, 'x')).container.innerHTML, '')
  cleanup()
  render(h(ds.SuccessMark, null)); assert.ok(screen.getByRole('img', { name: 'Success' }))
})

/* ───────────── shell ───────────── */
const lucide = load('node_modules/lucide-react')
const GROUPS = [{ id: 'g', label: 'Work', items: [
  { id: 'home', label: 'Dashboard', href: '/dashboard', icon: lucide.LayoutDashboard, primary: true },
  { id: 'leave', label: 'Leave', href: '/lms', icon: lucide.CalendarDays, primary: true, badge: 3 },
  { id: 'exp', label: 'Expenses', href: '/rms', icon: lucide.Receipt, primary: true },
  { id: 'trip', label: 'Travel', href: '/travel', icon: lucide.Plane, primary: true },
  { id: 'admin', label: 'Admin', href: '/admin', icon: lucide.Settings },
] }]

test('C27. AppShell: skip link, landmarks, aria-current on the active destination, badge announced', () => {
  const { container } = render(wrap(h(ds.AppShell, { groups: GROUPS, activeId: 'leave' }, h('p', null, 'content'))))
  assert.ok(screen.getByRole('link', { name: 'Skip to content' }))
  assert.ok(screen.getAllByRole('navigation').length >= 2)
  const current = [...container.querySelectorAll('[aria-current="page"]')]
  assert.ok(current.length >= 1 && current.every(a => a.getAttribute('href') === '/lms'))
  assert.ok(screen.getAllByLabelText('3 pending').length >= 1)
  assert.equal(container.querySelector('main#ds-main').textContent, 'content')
})

test('C28. AppShell never guesses a role: while loading it renders skeleton navigation and NO destination links', () => {
  const { container } = render(wrap(h(ds.AppShell, { groups: GROUPS, activeId: 'home', loading: true }, 'x')))
  assert.equal(container.querySelectorAll('a[href="/dashboard"]').length, 0)
  assert.equal(container.querySelectorAll('a[href="/admin"]').length, 0)
  assert.ok(screen.getAllByRole('status', { name: /Loading navigation/ }).length >= 1)
})

test('C29. Narrow navigation: bottom bar shows ≤4 primary destinations; "More" opens a sheet with EVERY destination', async () => {
  render(wrap(h(ds.AppShell, { groups: GROUPS, activeId: 'home' }, 'x')))
  const bottom = screen.getAllByRole('navigation', { name: 'Primary' }).find(n => within(n).queryByRole('button', { name: /More/ }))
  assert.ok(bottom)
  assert.equal(within(bottom).getAllByRole('link').length, 4)
  await userEvent.click(within(bottom).getByRole('button', { name: /More/ }))
  const sheet = screen.getByRole('dialog', { name: 'All destinations' })
  assert.ok(within(sheet).getByRole('link', { name: /Admin/ }), 'secondary destination reachable')
})

test('C30. PageHeader: h1, breadcrumb landmark with aria-current on the last crumb, actions slot', () => {
  render(h(ds.PageHeader, { title: 'Expenses', description: 'Your claims', breadcrumbs: [{ label: 'Home', href: '/' }, { label: 'Expenses' }], actions: h('button', null, 'New') }))
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Expenses' }))
  assert.equal(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Expenses').getAttribute('aria-current'), 'page')
  assert.ok(screen.getByRole('button', { name: 'New' }))
})

test('C31. Avatar is deterministic (same name → same tint/initials) and Metric/List components render their content', () => {
  const a = render(h(ds.Avatar, { name: 'Asha Rao' })); const b = render(h(ds.Avatar, { name: 'Asha Rao' }))
  assert.equal(a.container.innerHTML, b.container.innerHTML); assert.equal(ds.initialsOf('  vikram   singh '), 'VS'); assert.equal(ds.initialsOf(''), '?')
  cleanup()
  render(h('div', null, h(ds.MetricCard, { label: 'Pending', value: '12', caption: '3 urgent', href: '/x' }), h(ds.List, { ariaLabel: 'Recent' }, h(ds.ListRow, { title: 'One', subtitle: 'sub' }))))
  assert.equal(screen.getByText('12').className.includes('ds-tabular'), true)
  assert.ok(screen.getByRole('list', { name: 'Recent' })); assert.ok(screen.getByRole('link', { name: /Pending/ }))
})

test('C32. Overlays portal INTO the provider root, so dialogs/sheets keep the brand + theme tokens', async () => {
  render(h(ds.DsProvider, { brand: 'doppelmayr', theme: 'dark' }, h(ds.Dialog, { open: true, onOpenChange: () => {}, title: 'Inside the tokens' })))
  const dlg = await waitFor(() => screen.getByRole('dialog', { name: 'Inside the tokens' }))
  const root = dlg.closest('[data-ds-brand]')
  assert.ok(root, 'dialog must be a descendant of the element carrying data-ds-brand')
  assert.equal(root.getAttribute('data-ds-theme'), 'dark')
})
