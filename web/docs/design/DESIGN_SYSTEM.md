# DoppelDash Design System — developer reference

**Status:** Phase 1 foundation. This file is the source of truth for every later UI change on **Web (Doppelmayr India)** and **Android (DoppelDash)**.
Inventory/audit that motivated it: [`UI_AUDIT.md`](./UI_AUDIT.md). Visual evidence: [`screenshots/`](./screenshots).

> **Shared design language ≠ shared branding.** One token architecture and one component vocabulary; two brand layers.

| | Web | Android |
|---|---|---|
| Client | Doppelmayr India **internal** employee/CRM portal | **Public** DoppelDash SaaS |
| Brand layer | `doppelmayr` (enterprise tone) | `doppeldash` (SaaS tone) |
| Identity | Doppelmayr logo + corporate blue `#0057A8`; "Employee workspace" | DoppelDash mark, indigo-blue; "create/join your organization", Free/Premium |
| Must never show | create-org, Free trial, Premium acquisition, public SaaS marketing | — |
| Chosen by | the **client build** (`NEXT_PUBLIC_DS_BRAND`, default `doppelmayr`) | the **client build** (`DdBrands.defaultId`) |

The brand is **never** derived from an organisation id, slug, or route. Doppelmayr is a normal tenant on the shared backend.

---

## 1. Architecture

```
 DoppelDash-mobile/tool/design/              (authored here — the only place tokens are edited)
   core.json      shared foundations (space, radius, shape, type, elevation, motion, breakpoints, layout, state layers,
                  status→role, semantic colours, icon/focus/a11y/density)
   brands.json    brand layers: name, tagline, tone, client, seed, M3 variant, pinned colour overrides
   generate_palette_test.dart   Flutter's own Material 3 algorithm → palette.generated.json
   build_tokens.py              core + brands + palette → tokens.json   (+ canonical sha256 coreHash)
        │
        ├─ emit_dart.py ─────────────► lib/ui/core/design/tokens.g.dart      (Android: DdTokens, DdBrands, DdType)
        └─ sync_to_web.py ───────────► web/design/tokens.json                (copy)
                                          └─ scripts/design/emit.mjs ─► app/design/ds-tokens.css  (scoped CSS variables)
                                                                        lib/ds/tokens.ts           (typed constants)
                                          └─ design/tailwind-ds.ts ───► additive Tailwind utilities  ds-*
```

* **One token file.** `tokens.json` = `core` + `brands.{doppelmayr,doppeldash}`. Never fork `core` per client. `meta.coreHash` is a canonical-JSON SHA-256 computed identically in Python and JS; both clients test it, and the web test compares byte-for-byte with the Android copy when both repos are checked out.
* **Colours are generated, not guessed.** Material 3 role palettes per brand (tonal), with the brand primary *pinned* (`brands.json → overrides`) so the Doppelmayr light primary is exactly `#0057A8`. Semantic roles (success/warning/info + containers) and the status→role map are **shared**.
* **Workflow to change a token:** edit `core.json` / `brands.json` → `flutter test tool/design/generate_palette_test.dart` (only if seeds changed) → `python3 tool/design/build_tokens.py && python3 tool/design/emit_dart.py && python3 tool/design/sync_to_web.py <web>` → `node scripts/design/emit.mjs`. Tests fail if any generated file is stale.
* **Non-invasive on web.** Everything is scoped under `.ds-root` / `[data-ds-brand]` and Tailwind additions are `ds-*` only (tested), so un-migrated Doppelmayr pages are **not** restyled. Pages adopt the system by being wrapped in `<DsProvider>` and using `components/ds`.

## 2. Tokens (see `tokens.json`; values below are normative)

**Colour roles** (per brand, light + dark): `primary/on/container/on-container`, `secondary…`, `tertiary…`, `error…`, `surface`, `on-surface`, `on-surface-variant`, `surface-container-{lowest,low,"",high,highest}`, `surface-dim/bright`, `outline`, `outline-variant`, `inverse-surface/on/inverse-primary`, `scrim`; shared semantic `success|warning|info` (+`on-`, `-container`, `on-…-container`); `page`, `card`, `sunken` conveniences; 8-slot data-viz palette (slot 1 = brand primary). *Rule: feature code uses roles, never hex.* Contrast: text ≥ 4.5:1, UI strokes ≥ 3:1 for every brand × theme (tested).

**Typography** (Inter / Inter Tight / JetBrains Mono): `display-lg 48/56`, `headline-{lg 32, md 28, sm 24}`, `title-{lg 22, md 16, sm 14}`, `body-{lg 16, md 14, sm 12}`, `label-{lg 14, md 12, sm 11}`, numeric `metric-{lg 36, md 28, sm 20}` with **tabular figures**. Minimum 11px; no arbitrary `text-[Npx]`. Web: `text-ds-body-md`; Android: `DdType.bodyMedium` / `context.tt`.

**Spacing** 4px scale: `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80` (`--ds-space-N`, `DdTokens.space`). Page gutters 16 / 24 / 32 by window class; max content width 1200.

**Shape** radii `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 28 · full`; semantic: chip=sm, button/input/tile/menu=md, card=lg, dialog/sheet=xxl, badge/avatar=full.

**Surfaces & elevation** Cards and lists are **flat tonal surfaces** (container colours + hairline `outline-variant`). Elevation tokens `1–3` exist only for floating layers: menus 2, dialogs 3, sheets 1, toasts 3. No decorative shadows, no glass/blur.

**Density** control heights `sm 32 · md 40 · lg 48`; row heights 40 / 56 / 64. Touch/pointer targets ≥ 48 (touch) / 40 (pointer) — small visuals get an enlarged hit area.

**Motion** durations `instant 90 · fast 140 · base 220 · slow 320 · emphasized 450` ms; easings `standard`, `standard-decelerate/accelerate`, `emphasized`, `emphasized-decelerate/accelerate`; distances `enter 8`, `page 24`. See §5.

**Icons** one stroke weight (web `1.75`), size scale `xs16 · sm20 · md24 · lg32 · xl48`. See §6.

## 3. Themes
Light and dark are both generated per brand (not inverted). Web: `data-ds-theme="light|dark"` on `.ds-root` (`DsProvider theme="light|dark|system"`); Android: `DdTheme.light/dark(brand: …)`. Components never branch on theme; they read role variables. Brand artwork drawn for light backgrounds (the Doppelmayr logo) sits on a light plate in dark theme.

## 4. Components (same vocabulary on both platforms)

| Concept | Web (`@/components/ds`) | Android (`ui/core/components`) | Rules |
|---|---|---|---|
| Provider / brand | `DsProvider`, `useDs`, `BrandLogo` | `DdTheme(brand)`, `DdBrandTheme`, `context.brand`, `DdLogo` | brand from build, never org id |
| App shell | `AppShell` (sidebar ≥1024 / rail 768–1023 / bottom bar + "More" <768), `PageHeader` | `MainShell` (bar / rail / extended rail), `DdPage` | one nav model per window class; **skeleton nav until the server role is known** |
| Buttons | `Button` (filled/tonal/outlined/text/danger, sm/md/lg, loading), `IconButton` (label **required**) | `DdButton` (async double-submit safe), `DdIconButton` (tooltip required) | loading keeps width, disables, `aria-busy` |
| Text fields | `TextField`, `PasswordField`, `TextArea`, `Field` | `DdTextField` | label always visible; helper/error reserve their own line; error announced (`role=alert`) |
| Select / search | `Select` (native), `SearchField` | `DdSelect<T>`, `DdSearchField` | clear button named; search is a landmark |
| Date / time | `DateField`, `TimeField` | `DdDateField`, `DdTimeField` (+`formatDdDate`) | one date format |
| Toggles | `Checkbox`, `Switch` | themed `Switch`/checkbox | `role=switch` + checked state |
| Chips / filters | `Chip`, `FilterBar` | `DdChip`, `DdFilterBar` | selection = tone **and** check mark |
| Segmented / tabs | `Segmented` (radiogroup, roving focus), `Tabs` | `DdSegmented`, `DdTabs` | 2–4 exclusive views / sections |
| Badges | `StatusBadge`, `CountBadge` | `StatusBadge`, `CountBadge` | domain status → role via the **shared** map; label always present |
| Cards / metrics | `Card`, `MetricCard` | `DdCard`, `MetricCard` | flat tonal; tabular numbers |
| Lists / avatars | `List`, `ListRow`, `Avatar` | `ListRow`, `DdAvatar` | deterministic avatar tint |
| Table | `DataTable` (table ≥ md, compact rows < md) | `DdDataTable<T>` | sortable headers (`aria-sort`), keyboard rows, skeleton/empty |
| Dialogs | `Dialog`, `ConfirmDialog` | `showDdDialog`, `showDdConfirm` | focus trap/return, Esc; async confirm = loading, no double submit |
| Sheets | `Sheet` (bottom <md, side ≥md) | `showDdSheet` + `DdSheetScaffold` | |
| Feedback | `ToastProvider`/`useToast`, `Banner`, `OfflineBanner` | `showDdSnack`, `InlineBanner`, `OfflineBanner` | errors assertive, others polite |
| Loading | `Skeleton`, `SkeletonText`, `SkeletonCard` | `SkeletonBox/Row/List/Metric` | one "Loading" announcement; no spinner-only pages |
| Empty / error / denied | `EmptyState`, `ErrorState` (retry), `ForbiddenState` | `EmptyState`, `ErrorState`, `ForbiddenState` | explain what + what to do |
| Forms | `FormSection`, `FormActions` | `DdFormSection`, `DdFormActions` | one rhythm |
| Motion | `Reveal`, `Presence`, `Expandable`, `SuccessMark` | `Reveal`, `DdSwitcher`, `DdPresence`, `DdExpandable`, `DdSuccessMark` | §5 |

**Rule:** a page never invents its own filter bar, table, dialog, chip, status colour or empty state. Missing need → extend the component (and the showcase + tests), don't fork it.

## 5. Motion principles
Purposeful, short, calm. **Fade + small movement** (8px enter, 24px page), 140–320ms, `emphasized-decelerate` in / `accelerate` out. Use for: navigation & page transitions (shared-axis X), state changes (`Switcher`/cross-fade), dialogs (scale+fade), sheets (slide-up / side), loading (skeleton pulse), list insertion/removal (`Presence`), success/error feedback (`SuccessMark`, toasts), onboarding steps, dashboard first appearance (`Reveal`, stagger ≤ 6 × 40ms), expandable sections. **Never:** bounce, long (>450ms) transitions, scale > 4%, animation on every element, motion that blocks a workflow.
**Reduced motion** (OS setting, or `motion="reduced"` / `MediaQuery.disableAnimations`): durations collapse to 0, transforms and loops stop, only a ≤ 90ms fade survives. Components implement this themselves (tested) — pages need no special handling.

## 6. Icons & illustration
* Vector only. Web: Lucide through the `Icon` wrapper (stroke 1.75, fixed sizes, decorative by default). Android: Material Symbols (outlined/rounded) at token sizes. No emoji, no raster icons.
* Icon-only controls always carry a name (`IconButton label=`, `DdIconButton tooltip=`) — an unlabeled one cannot be written.
* Illustrations are a small geometric set (`welcomeWork … forbidden`, same subjects on both clients): soft tonal disc, one bold subject, one accent, **drawn from theme/brand roles** so they follow brand + dark mode. One per empty/error state, 104–148px; never full-page decoration, never stock art.

## 7. Responsive rules (window classes)
`compact <600 · medium 600–839 · expanded 840–1199 · large 1200–1599 · xlarge ≥1600` (shared tokens). Decide layout from the class, never a raw width.

| Class | Web | Android |
|---|---|---|
| compact | bottom bar (≤4 primary + More sheet), single column, tables → compact rows, sheets from the bottom | bottom `NavigationBar`, single column, full-width forms |
| medium | rail (icons + tooltips), 2-column where useful | navigation rail, 2-pane lists/details where it adds value |
| expanded/large | 264px sidebar (collapsible to rail), content max 1200, side sheets, real tables | extended rail, capped content width |
Do not merely shrink the desktop: each class has its own navigation, density and overlay behaviour. Forms keep ≥ 44–48px controls everywhere; text must reflow at 200% (tested on both clients).

## 8. Accessibility (owned by the components)
Semantic labels and roles; visible 2px primary **focus ring** (`:focus-visible`); keyboard operation (tabs/segmented arrow keys, table rows Enter/Space, dialogs trap + restore focus, skip-to-content link); targets ≥ 48 (touch) / 40 (pointer); error text announced (`role=alert`), non-errors polite; selection/state never colour-only; contrast AA (tested); text scale to 200% without clipping (tested on Android, reflow rules on web); reduced motion (§5). Landmarks: `nav[aria-label]`, `main#ds-main`, `header`, breadcrumbs `aria-current="page"`.

## 9. Showcase & evidence
* Web: `/design-system` (dev/preview; **404 in production** unless `DD_DESIGN_SHOWCASE=true`). Deep links: `?brand=doppelmayr|doppeldash&theme=light|dark&motion=reduced`.
* Android: `/dev/design` (debug builds, or `--dart-define=DD_SHOWCASE=true`); build with `--dart-define=DD_START_ROUTE=/dev/design` to open on it. Controls for brand, theme, text scale (100/130/200%), reduce motion.
* Screenshots: `docs/design/screenshots/` (web desktop/tablet/narrow × brand × theme).

## 10. Tests that guard the system
Web: `tests/ds_tokens.test.js` (hash, freshness, scoped CSS, AA contrast × brand × theme, pinned brand colour, additive Tailwind, Android parity) · `tests/ds_components.test.js` (31 behaviour tests: semantics, keyboard, states, shell, reduced motion). Android: `test/ui/core/design_system_test.dart` (tokens sync + contrast per brand + shell/theme) · `test/ui/core/components_phase1_test.dart` (components, brand layer, 200% text, showcase in both brands/themes).
