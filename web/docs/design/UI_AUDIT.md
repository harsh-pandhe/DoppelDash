# DoppelDash UI/UX audit — complete inventory

_Phase-1 inventory. Generated from a static scan of every `.tsx` under `app/` + `components/` (117 files, 22,479 LOC) and every `*_view.dart` / `*_sheet.dart` under the Flutter app (44 files, 10,104 LOC), plus inspection of the running web app and the physical Android device. **Product split (locked):** Web = Doppelmayr India internal client; Android = public DoppelDash SaaS; shared backend. This audit therefore treats the two clients as ONE design language with TWO brand layers._

## 1. Product-wide findings

### Web (Doppelmayr India client)
1. **No design system, only a token sketch.** `tailwind.config.ts` defines `brand`, `dm-orange`, `accent`, `surface`, `status`; `globals.css` defines 8 CSS variables. Pages bypass them: **1518** hard-coded Tailwind palette classes (`bg-blue-100`, `text-orange-600`…) and **199** raw `#RRGGBB` literals across 117 files.
2. **Dark mode is half-built.** A toggle flips 8 CSS variables, but there are **0** `dark:` variants in the whole app, so pastel tiles and `bg-white` cards stay light on a dark page (seen in the running app).
3. **Legacy token names lie.** **124** usages of `orange-*` / `dm-orange-*` that are actually Doppelmayr blue (`#0057A8`). Dead Clerk (`.cl-*`) CSS remains in `globals.css`.
4. **Glass/gradient styling.** `.glass-card` (blur + translucent border + hover lift) is the default `Card`; **43** glass/backdrop-blur and **186** gradient usages. Low hierarchy, and not the restrained enterprise look the brief wants.
5. **Brand is correct but not a layer.** The Web client is *meant* to be Doppelmayr (name, logo, "Since 1893 · Wolfurt…" corporate copy, cable-car scene) — but the brand lives as **15** string literals and per-file asset imports, not as a replaceable brand layer. The design system must carry Doppelmayr as data (name, logo, colours, tagline) so shared components never hard-code it.
6. **Client-side default role.** `Sidebar` does `user?.role || 'employee'` and seeds its collapsed-section state from it before the user loads, so an admin's *Insights*/*Admin* groups start collapsed. Layout components must render a neutral skeleton until the server role is known.
7. **Type is too small and inconsistent.** **401** arbitrary `text-[Npx]` sizes (9–11px labels common); no semantic scale; numbers lack tabular figures.
8. **Shell issues.** Fixed 240px gradient sidebar with 14 flat items, no collapse; header has no org context / breadcrumbs / page-actions slot; narrow screens get a hamburger drawer *and* a 6-item bottom nav (two navigation models).
9. **State pages are thin.** No `not-found.tsx`, `global-error.tsx` or forbidden page (only `/web-access-restricted`); `EmptyState`/`ErrorState` use gradient tiles; only 27 `EmptyState` uses across 117 files; loading is mostly `Loader2` spinners (197) with few skeletons.
10. **Accessibility gaps.** 12 icon-only buttons without an accessible name, 8 clickable `div/span`, 177 `aria-`/`role` attributes across 418 buttons, 4 native `confirm/alert/prompt`, 1 `<img>` without alt, 32–36px toolbar targets, focus rings inconsistent.
11. **Monolith pages.** `rms/page.tsx` 1,239 LOC, `lms/page.tsx` 950, `crm/[id]` 898, `reports` 852, `mail` 837, `admin/users` 828 — each re-implements its own filters, tables, dialogs, cards and status chips.
12. **Motion is incidental.** 434 `animate-/transition` usages, no motion tokens, no page transitions, `prefers-reduced-motion` handled by a blanket CSS kill-switch.

### Android (DoppelDash public client)
1. **Token foundation exists (Material 3, generated) but legacy code bypasses it.** `ThemeData` is built from generated tokens with a `DdColors` extension, yet **244** legacy `Accent.*` colour references, **13** raw `Color(...)`, **55** inline `fontSize:` and **128** raw `SizedBox` gaps remain in screens that predate it.
2. **Loading = spinner.** **41** `CircularProgressIndicator` vs **8** skeletons; only 18 `EmptyState`/72 error-UI uses across 44 screens (many have none, see lists below).
3. **Navigation.** Phone `NavigationBar` + rail on wide windows exist in the shell, but **59** raw `Navigator.of(context)` calls are mixed with go_router; **24** bottom sheets and **18** dialogs are hand-rolled per screen.
4. **Accessibility.** **20** `IconButton`s without tooltips; only 30 `Semantics` annotations in 10,104 LOC; custom `InkWell`/gesture cards lack semantics; text-scale behaviour untested outside the redesigned screens.
5. **Forms.** **91** text fields and **41** dropdowns are built ad hoc per screen (validation, helper/error text, density all differ); only 6 date pickers share no common field.
6. **Responsive.** **25** of 44 screens have no responsive code at all.
7. **Role-blind surfaces.** Several screens still show the same content to every role although the server role is available.
8. **Motion.** Only 2 `flutter_animate` uses in screens; the new `Reveal`/`DdSwitcher` motion layer exists but old screens do not use it.

### Cross-platform
- Before this phase the two clients used different blues (Doppelmayr `#0057A8` vs sky `#0284C7`) and different dark palettes, and different words/colours for the same domain objects (status chips, money, dates, roles).
- The target is ONE token architecture (spacing, type, shape, motion, elevation, semantic colours, state layers, status→role map) with TWO brand layers (Doppelmayr web, DoppelDash Android) — never two design systems and never organisation-id based.

## 2. WEB inventory — every page, route, and mechanical flags

| Route | File | LOC | Access | loading/empty/error | Flags |
|---|---|---:|---|---|---|
| `/` | `app/page.tsx` | 9 | all | — / — / — | — |
| `/admin/audit` | `app/(app)/admin/audit/page.tsx` | 354 | admin | loading / — / — | 49 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 8 arbitrary `text-[Npx]` sizes (type scale bypassed); 15 gradient fills; 6 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/admin/users` | `app/(app)/admin/users/page.tsx` | 829 | admin | loading / — / — | 61 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 31 arbitrary `text-[Npx]` sizes (type scale bypassed); 14 gradient fills; 6 legacy `orange`/`dm-orange` token refs (actually blue); 829 LOC monolith — extract components; native confirm/alert/prompt |
| `/analytics` | `app/(app)/analytics/page.tsx` | 659 | mgr+admin | loading / — / error | 19 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 10 arbitrary `text-[Npx]` sizes (type scale bypassed); 3 icon-only button(s) without accessible name; 1 clickable div/span (not keyboard/semantic) |
| `/analytics/drill` | `app/(app)/analytics/drill/page.tsx` | 179 | mgr+admin | loading / — / — | 21 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 6 arbitrary `text-[Npx]` sizes (type scale bypassed); 3 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/announcements` | `app/(app)/announcements/page.tsx` | 406 | all | loading / empty / error | 19 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 7 arbitrary `text-[Npx]` sizes (type scale bypassed); 7 gradient fills |
| `/contact/[token]` | `app/contact/[token]/page.tsx` | 155 | public | — / — / — | 6 arbitrary `text-[Npx]` sizes (type scale bypassed); 6 gradient fills; 1 hard-coded 'Doppelmayr' string(s) |
| `/crm` | `app/(app)/crm/page.tsx` | 680 | all | loading / empty / error | 33 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 27 arbitrary `text-[Npx]` sizes (type scale bypassed); 13 gradient fills; 4 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/crm/[id]` | `app/(app)/crm/[id]/page.tsx` | 899 | all | loading / — / error | 81 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 17 arbitrary `text-[Npx]` sizes (type scale bypassed); glass/backdrop-blur surfaces; 20 gradient fills; 1 legacy `orange`/`dm-orange` token refs (actually blue); 899 LOC monolith — extract components; 1 icon-only button(s) without accessible name |
| `/crm/campaigns` | `app/(app)/crm/campaigns/page.tsx` | 8 | all | — / — / — | — |
| `/crm/directory` | `app/(app)/crm/directory/page.tsx` | 152 | all | loading / — / — | 12 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 6 arbitrary `text-[Npx]` sizes (type scale bypassed); 9 gradient fills; 1 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/crm/new` | `app/(app)/crm/new/page.tsx` | 144 | all | loading / — / error | 4 gradient fills; spinner-only loading (no skeleton) |
| `/crm/scanned` | `app/(app)/crm/scanned/page.tsx` | 164 | all | loading / empty / error | — |
| `/dashboard` | `app/(app)/dashboard/page.tsx` | 28 | all | — / — / — | — |
| `/delete-account` | `app/delete-account/page.tsx` | 140 | public | — / — / — | 45 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork) |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | 176 | public | loading / — / error | 33 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); spinner-only loading (no skeleton) |
| `/inbox` | `app/(app)/inbox/page.tsx` | 237 | all (employee needs mailAccess) | loading / empty / error | 6 arbitrary `text-[Npx]` sizes (type scale bypassed) |
| `/invite` | `app/invite/page.tsx` | 534 | public | loading / — / — | 97 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork) |
| `/lms` | `app/(app)/lms/page.tsx` | 951 | all | loading / empty / error | 104 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 19 arbitrary `text-[Npx]` sizes (type scale bypassed); 7 legacy `orange`/`dm-orange` token refs (actually blue); 951 LOC monolith — extract components; 1 icon-only button(s) without accessible name; 1 clickable div/span (not keyboard/semantic) |
| `/lms/[id]` | `app/(app)/lms/[id]/page.tsx` | 393 | all | loading / — / — | 59 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 6 arbitrary `text-[Npx]` sizes (type scale bypassed); 4 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/lms/holidays` | `app/(app)/lms/holidays/page.tsx` | 216 | all | loading / — / — | 11 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 6 arbitrary `text-[Npx]` sizes (type scale bypassed); 3 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/lms/new` | `app/(app)/lms/new/page.tsx` | 5 | all | — / — / — | — |
| `/lms/team` | `app/(app)/lms/team/page.tsx` | 486 | mgr+admin | loading / — / — | 37 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 22 arbitrary `text-[Npx]` sizes (type scale bypassed); 6 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/mail` | `app/(app)/mail/page.tsx` | 838 | all (employee needs mailAccess) | loading / empty / error | 44 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 19 arbitrary `text-[Npx]` sizes (type scale bypassed); glass/backdrop-blur surfaces; 5 gradient fills; 838 LOC monolith — extract components; 1 icon-only button(s) without accessible name; img without alt; 4 hard-coded 'Doppelmayr' string(s) |
| `/mail/drafts` | `app/(app)/mail/drafts/page.tsx` | 206 | all (employee needs mailAccess) | loading / empty / — | glass/backdrop-blur surfaces |
| `/onboarding` | `app/(app)/onboarding/page.tsx` | 405 | all | loading / — / — | 6 gradient fills; spinner-only loading (no skeleton) |
| `/print/expense/[id]` | `app/print/expense/[id]/page.tsx` | 336 | all | loading / — / error | spinner-only loading (no skeleton); 3 hard-coded 'Doppelmayr' string(s) |
| `/privacy` | `app/privacy/page.tsx` | 125 | public | — / — / — | 38 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork) |
| `/profile` | `app/(app)/profile/page.tsx` | 673 | all | loading / empty / error | 8 arbitrary `text-[Npx]` sizes (type scale bypassed) |
| `/reports` | `app/(app)/reports/page.tsx` | 853 | mgr+admin | loading / — / error | 26 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 20 arbitrary `text-[Npx]` sizes (type scale bypassed); 8 gradient fills; 1 legacy `orange`/`dm-orange` token refs (actually blue); 853 LOC monolith — extract components |
| `/reset-password` | `app/(auth)/reset-password/page.tsx` | 401 | public | loading / — / — | 80 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 9 gradient fills |
| `/rms` | `app/(app)/rms/page.tsx` | 1240 | all | loading / empty / error | 120 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 27 arbitrary `text-[Npx]` sizes (type scale bypassed); 32 legacy `orange`/`dm-orange` token refs (actually blue); 1240 LOC monolith — extract components; 1 icon-only button(s) without accessible name; 3 clickable div/span (not keyboard/semantic) |
| `/rms/[id]` | `app/(app)/rms/[id]/page.tsx` | 514 | all | loading / — / — | 39 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); glass/backdrop-blur surfaces; 1 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/rms/new` | `app/(app)/rms/new/page.tsx` | 5 | all | — / — / — | — |
| `/settings/[[...rest]]` | `app/(app)/settings/[[...rest]]/page.tsx` | 258 | all | loading / — / — | — |
| `/shared/[token]` | `app/shared/[token]/page.tsx` | 94 | public | loading / — / error | — |
| `/sign-in` | `app/(auth)/sign-in/page.tsx` | 562 | public | loading / — / error | 88 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 8 arbitrary `text-[Npx]` sizes (type scale bypassed); glass/backdrop-blur surfaces; 11 gradient fills; 2 clickable div/span (not keyboard/semantic) |
| `/support` | `app/support/page.tsx` | 126 | public | — / — / — | 50 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork) |
| `/terms` | `app/terms/page.tsx` | 92 | public | — / — / — | 31 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork) |
| `/travel` | `app/(app)/travel/page.tsx` | 287 | all | loading / empty / error | 43 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 8 gradient fills; 2 legacy `orange`/`dm-orange` token refs (actually blue) |
| `/travel/[id]` | `app/(app)/travel/[id]/page.tsx` | 322 | all | loading / — / — | 37 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork) |
| `/travel/new` | `app/(app)/travel/new/page.tsx` | 317 | all | loading / — / — | 14 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 9 arbitrary `text-[Npx]` sizes (type scale bypassed); spinner-only loading (no skeleton) |
| `/web-access-restricted` | `app/web-access-restricted/page.tsx` | 60 | public | — / — / — | 17 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 1 icon-only button(s) without accessible name |

### Special / state files

| File | Note |
|---|---|
| `app/(app)/admin/layout.tsx` | 10 LOC |
| `app/(app)/error.tsx` | 53 LOC |
| `app/(app)/layout.tsx` | 35 LOC |
| `app/(auth)/layout.tsx` | 4 LOC |
| `app/layout.tsx` | 39 LOC |
| (all `loading.tsx`) | 23 route-level loading files, 4 LOC each — generic skeleton, not page-shaped |
| **missing** `app/not-found.tsx` | 404 falls back to Next.js default (unbranded) |
| **missing** `app/global-error.tsx` | root-level crash has no branded fallback |
| **missing** forbidden/403 page | role-denied routes redirect or render nothing consistent |

## 3. WEB shared components

| Component | LOC | Flags |
|---|---:|---|
| `components/BrandPanel.tsx` | 93 | 6 arbitrary `text-[Npx]` sizes (type scale bypassed); 4 hard-coded 'Doppelmayr' string(s) |
| `components/CableCarScene.tsx` | 378 | — |
| `components/DashboardCharts.tsx` | 130 | — |
| `components/ErrorBoundary.tsx` | 42 | — |
| `components/OnboardingGuard.tsx` | 23 | — |
| `components/RouterAutoRefresh.tsx` | 43 | — |
| `components/ScanCardDialog.tsx` | 317 | 20 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 8 gradient fills; spinner-only loading (no skeleton); 1 hard-coded 'Doppelmayr' string(s) |
| `components/SecuritySettings.tsx` | 253 | spinner-only loading (no skeleton); 1 icon-only button(s) without accessible name; native confirm/alert/prompt |
| `components/ShortcutsPanel.tsx` | 100 | — |
| `components/SortableTileGrid.tsx` | 117 | — |
| `components/ThemeToggle.tsx` | 46 | — |
| `components/WelcomeTour.tsx` | 115 | glass/backdrop-blur surfaces |
| `components/layout/BottomNav.tsx` | 63 | — |
| `components/layout/Header.tsx` | 460 | 32 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); 12 arbitrary `text-[Npx]` sizes (type scale bypassed); glass/backdrop-blur surfaces; 4 legacy `orange`/`dm-orange` token refs (actually blue); 1 icon-only button(s) without accessible name |
| `components/layout/Sidebar.tsx` | 218 | 4 gradient fills; 1 clickable div/span (not keyboard/semantic); 1 hard-coded 'Doppelmayr' string(s) |
| `components/mail/MailEditor.tsx` | 464 | glass/backdrop-blur surfaces; 1 hard-coded 'Doppelmayr' string(s) |
| `components/ui/alert.tsx` | 34 | — |
| `components/ui/badge.tsx` | 29 | 2 legacy `orange`/`dm-orange` token refs (actually blue) |
| `components/ui/button.tsx` | 46 | — |
| `components/ui/card.tsx` | 47 | — |
| `components/ui/charts.tsx` | 155 | — |
| `components/ui/empty-state.tsx` | 71 | 6 gradient fills |
| `components/ui/error-state.tsx` | 38 | — |
| `components/ui/file-uploader.tsx` | 185 | 8 hard-coded palette classes, 0 `dark:` variants (dark-mode patchwork); spinner-only loading (no skeleton) |
| `components/ui/input.tsx` | 23 | — |
| `components/ui/label.tsx` | 19 | — |
| `components/ui/modal.tsx` | 145 | — |
| `components/ui/popover.tsx` | 34 | — |
| `components/ui/progress.tsx` | 26 | — |
| `components/ui/rich-text-editor.tsx` | 228 | 1 icon-only button(s) without accessible name |
| `components/ui/separator.tsx` | 25 | — |
| `components/ui/sheet.tsx` | 82 | — |
| `components/ui/skeleton.tsx` | 132 | — |
| `components/ui/sortable-th.tsx` | 33 | — |
| `components/ui/tabs.tsx` | 53 | — |
| `components/ui/toast.tsx` | 82 | — |
| `components/ui/toggle.tsx` | 29 | — |
| `components/ui/tooltip.tsx` | 54 | 4 gradient fills |

### Web page-by-page UX notes (from looking at the running UI)

| Screen | Observed problems |
|---|---|
| Sign in (`/sign-in`) | Full-bleed 3D cable-car scene (`CableCarScene`, 377 LOC three.js) + Doppelmayr marketing copy; card is a second-class element; stepper dots + glass card + "Smart IT Help" link; heavy for a login. Brand (Doppelmayr) is right; execution needs a calmer, faster enterprise sign-in built from the shared components. |
| Dashboard | Strong content (financial pulse, org health, approvals queue) but flat hierarchy: 4 equal hero tiles, many 9–10px mono labels, all-caps eyebrow labels everywhere, glass cards; admin/manager/employee are three bespoke components with no shared building blocks. |
| Contacts (`/crm`) | Toolbar of 6 equally weighted controls (view switcher, 4 text buttons) above a 3-col card grid; avatar colours random; tag chips tiny; no table density option for 1000+ contacts. |
| Contact detail | 898-LOC page; mixes header, timeline, AI generation and sharing without clear sections. |
| Reimbursements (`/rms`) | Pastel stat tiles break dark mode; filter chips + view toggles + Export + Log Expense all in one row that wraps on laptop; 1,239 LOC, 120 palette classes. |
| Leave (`/lms`) | Light pastel tiles on dark; right rail (calendar, workload heat-map, "needs attention") is dense and unlabeled at 9px. |
| Travel | Card list with inline action buttons whose colours (green/red/outline) differ from RMS equivalents. |
| Mail / Compose | Three-column compose with AI panel; rich editor toolbar tiny; "Body" area has no min-height affordance; looks like a different app. |
| Analytics / Reports | Charts via bespoke `charts.tsx`; flat axes; tiles repeat KPI pattern; no consistent period/segment control. |
| Admin → Users | Table is decent but uses its own row, chip, dialog and tab styles; invitations tab separate component. |
| Admin → Audit | 353 LOC list; plain table; filters bespoke. |
| Profile / Settings | Long forms with ad-hoc sectioning; `SecuritySettings` uses native `confirm`. |
| Onboarding | 5-step wizard, bespoke stepper; collects bank/medical data in a long form. |
| Invite / Reset | 500- and 376-LOC pages, each re-implements the auth card; 97/80 palette classes. |
| Narrow (390px) | Works structurally (hamburger + 6-item bottom nav) but doubles navigation affordances; KPI tiles in 2-col fine; pastel tiles still wrong in dark. |

## 4. ANDROID inventory — every screen/sheet

| Screen / sheet | File | LOC | empty/error/retry | spinner/skeleton | Notes |
|---|---|---:|---|---|---|
| admin · Admin Audit | `admin/views/admin_audit_view.dart` | 225 | E/Err/R | 1/0 | 3 inline fontSize; 1 IconButton(s) w/o tooltip; spinner-only loading |
| admin · Admin Holidays | `admin/views/admin_holidays_view.dart` | 249 | E/Err/R | 1/0 | 3 inline fontSize; 3 IconButton(s) w/o tooltip; spinner-only loading |
| admin · Admin Org | `admin/views/admin_org_view.dart` | 149 | –/–/– | 2/0 | no responsive handling; spinner-only loading |
| admin · Admin Users | `admin/views/admin_users_view.dart` | 222 | E/Err/R | 1/0 | 1 IconButton(s) w/o tooltip; no responsive handling; spinner-only loading |
| admin · Admin | `admin/views/admin_view.dart` | 113 | –/–/– | 0/0 | no responsive handling |
| admin · Create User (Sheet) | `admin/views/create_user_sheet.dart` | 136 | –/Err/– | 1/0 | spinner-only loading |
| admin · Edit User (Sheet) | `admin/views/edit_user_sheet.dart` | 142 | –/Err/– | 1/0 | spinner-only loading |
| analytics · Analytics | `analytics/views/analytics_view.dart` | 365 | –/–/– | 1/0 | 5 inline fontSize; 365 LOC; no responsive handling; spinner-only loading |
| announcements · Announcements | `announcements/views/announcements_view.dart` | 180 | E/Err/R | 1/0 | 2 dialog(s); no responsive handling; spinner-only loading |
| announcements · Create Announcement (Sheet) | `announcements/views/create_announcement_sheet.dart` | 116 | –/Err/– | 1/0 | spinner-only loading |
| auth · Forgot Password | `auth/views/forgot_password_view.dart` | 64 | –/–/– | 0/0 | no responsive handling |
| auth · Invite Accept | `auth/views/invite_accept_view.dart` | 143 | –/Err/– | 0/0 | 10 raw SizedBox gaps; no responsive handling |
| auth · Reset Password | `auth/views/reset_password_view.dart` | 104 | –/Err/– | 0/0 | no responsive handling |
| auth · Sign In | `auth/views/sign_in_view.dart` | 243 | –/Err/R | 0/0 | 12 raw SizedBox gaps; no responsive handling |
| auth · Sign Up | `auth/views/sign_up_view.dart` | 109 | –/Err/– | 0/0 | 8 raw SizedBox gaps; no responsive handling |
| campaigns · Campaigns | `campaigns/views/campaigns_view.dart` | 244 | E/Err/R | 1/0 | 4 inline fontSize; no responsive handling; spinner-only loading |
| campaigns · Create Campaign (Sheet) | `campaigns/views/create_campaign_sheet.dart` | 172 | –/Err/– | 1/0 | 3 Navigator.of; 2 dialog(s); spinner-only loading |
| contacts · Contact Detail | `contacts/views/contact_detail_view.dart` | 317 | –/–/– | 0/0 | 5 Navigator.of; 317 LOC; 4 dialog(s) |
| contacts · Contacts | `contacts/views/contacts_view.dart` | 391 | E/Err/R | 2/0 | 2 IconButton(s) w/o tooltip; 5 Navigator.of; 391 LOC; no responsive handling; spinner-only loading |
| contacts · Create Contact (Sheet) | `contacts/views/create_contact_sheet.dart` | 200 | –/Err/– | 1/0 | spinner-only loading |
| contacts · Scanned Cards | `contacts/views/scanned_cards_view.dart` | 350 | E/Err/R | 1/0 | 3 inline fontSize; 2 IconButton(s) w/o tooltip; 3 Navigator.of; 350 LOC; no responsive handling; spinner-only loading |
| contacts · Share Contact (Sheet) | `contacts/views/share_contact_sheet.dart` | 236 | –/–/– | 1/0 | 2 IconButton(s) w/o tooltip; spinner-only loading |
| dashboard · Dashboard | `dashboard/views/dashboard_view.dart` | 381 | E/Err/R | 0/8 | 19 raw SizedBox gaps; 381 LOC |
| directory · Employee Directory | `directory/views/employee_directory_view.dart` | 222 | E/–/– | 1/0 | 5 IconButton(s) w/o tooltip; no responsive handling; spinner-only loading |
| directory · Employee Picker (Sheet) | `directory/views/employee_picker_sheet.dart` | 111 | –/–/– | 1/0 | 1 IconButton(s) w/o tooltip; spinner-only loading |
| expense · Expense | `expense/views/expense_view.dart` | 327 | E/Err/R | 3/0 | 8 raw SizedBox gaps; 4 Navigator.of; 327 LOC; 2 dialog(s); spinner-only loading |
| leave · Leave Calendar | `leave/views/leave_calendar_view.dart` | 262 | –/–/– | 0/0 | 2 IconButton(s) w/o tooltip; no responsive handling |
| leave · Leave | `leave/views/leave_view.dart` | 384 | E/Err/R | 2/0 | 7 raw SizedBox gaps; 4 Navigator.of; 384 LOC; 2 dialog(s); spinner-only loading |
| mail · Email Config (Sheet) | `mail/views/email_config_sheet.dart` | 270 | –/Err/– | 2/0 | 1 IconButton(s) w/o tooltip; spinner-only loading |
| mail · Mail Detail | `mail/views/mail_detail_view.dart` | 164 | –/–/– | 1/0 | no responsive handling; spinner-only loading |
| mail · Mail Draft Detail | `mail/views/mail_draft_detail_view.dart` | 320 | –/–/– | 1/0 | 6 Navigator.of; 320 LOC; 2 dialog(s); spinner-only loading |
| mail · Mail | `mail/views/mail_view.dart` | 374 | E/Err/R | 2/0 | 4 inline fontSize; 374 LOC; no responsive handling; spinner-only loading |
| notifications · Notifications | `notifications/views/notifications_view.dart` | 239 | E/Err/R | 1/0 | 4 inline fontSize; no responsive handling; spinner-only loading |
| onboarding · Org Setup | `onboarding/views/org_setup_view.dart` | 68 | –/Err/– | 0/0 | no responsive handling |
| onboarding · Post Login Onboarding | `onboarding/views/post_login_onboarding_view.dart` | 161 | –/–/– | 0/0 | 13 raw SizedBox gaps; no responsive handling |
| onboarding · Profile Setup | `onboarding/views/profile_setup_view.dart` | 69 | –/Err/– | 0/0 | no responsive handling |
| onboarding · Welcome Carousel | `onboarding/views/welcome_carousel_view.dart` | 125 | –/–/– | 0/0 | no responsive handling |
| profile · Profile | `profile/views/profile_view.dart` | 270 | –/–/– | 1/0 | spinner-only loading |
| search · Global Search | `search/views/global_search_view.dart` | 180 | E/–/– | 1/0 | 1 IconButton(s) w/o tooltip; no responsive handling; spinner-only loading |
| settings · Settings | `settings/views/settings_view.dart` | 678 | –/Err/– | 3/0 | 11 inline fontSize; 5 Navigator.of; 678 LOC; 2 dialog(s); spinner-only loading |
| settings · Totp Setup (Sheet) | `settings/views/totp_setup_sheet.dart` | 293 | –/Err/– | 3/0 | 2 IconButton(s) w/o tooltip; 5 Navigator.of; 2 dialog(s); spinner-only loading |
| travel · Create Travel (Sheet) | `travel/views/create_travel_sheet.dart` | 289 | –/Err/– | 1/0 | 1 IconButton(s) w/o tooltip; spinner-only loading |
| travel · Travel Detail | `travel/views/travel_detail_view.dart` | 258 | –/Err/– | 0/0 | no responsive handling |
| travel · Travel | `travel/views/travel_view.dart` | 189 | E/Err/R | 1/0 | no responsive handling; spinner-only loading |

Shared Flutter widgets (11): `PrimaryButton`, `SecondaryButton`, `Avatar`, `BrandedRefreshIndicator`, `EmptyState`, `KpiCard`, `RoleGate`, `SectionCard`+`StatusChip`, `SectionHeader`, `SegmentedTabs`, `StatusPill`, `AnimatedListCard`. Missing: text field, dropdown, list row, skeleton, error state, offline banner, confirm dialog, sheet scaffold, page scaffold, adaptive shell.

### Android screens with additional visual findings (physical device)
| Screen | Observed |
|---|---|
| Welcome carousel | Generic mountain illustration, text-light; Skip + Next fine; no dark-mode check for the vector. |
| Sign in | Logo is a square dark tile (not a mark), form top-heavy with 3 secondary links below the CTA; password toggle works; error banner above title shifts the layout. |
| Sign up | 7 fields in one scroll; keyboard behaves; password rules not shown. |
| OTP | Auto-submit at 6 digits; error banner shifts the layout (fixed: field now clears). |
| Dashboard | Role-blind; leave tiles are 105-px fixed-width cards in a `Wrap` (ragged right edge); "Travel & Trips" card dominates. |
| Profile | Menu list good but 11 equal rows; Sign out below the fold. |
| Settings | 677 LOC single screen: profile form + security + delete account + plan, with ADMIN/Plan text block at the bottom. |

## 5. Findings by category → reusable component / token opportunities

| Category | Where it hurts (evidence above) | Foundation answer (Phase 1) |
|---|---|---|
| Visual inconsistency | 2 blues / 2 dark palettes before; 1,518 palette classes; random avatar colours; status chips coloured differently per page | One token set + brand layers; `status → semantic role` map shared by both clients; deterministic avatar tint |
| Component duplication | Per-page filters, tables, dialogs, chips (rms/lms/crm/admin); 24 sheets + 18 dialogs hand-rolled on Android | Shared `Field`, `Select`, `SearchField`, `FilterBar`, `Chip`, `Tabs`, `Segmented`, `DataTable`, `Dialog`/`ConfirmDialog`, `Sheet`, `Snackbar/Toast` |
| Spacing | raw SizedBox gaps, ad-hoc `p-5 lg:p-8 xl:px-12` | 4-px scale `space.*`, page gutters per window class, `max content` width |
| Typography | 9–11px labels, inline sizes, no numeric style | M3 type scale + tabular numeric styles, minimums (body ≥ 14, label ≥ 12) |
| Navigation | Web: drawer + bottom nav + fixed sidebar; Android: Navigator/go_router mix | `AppShell` (rail/sidebar/bar by window class), `TopBar` with title/actions/breadcrumb slots |
| Overly dense areas | Dashboard micro-labels, RMS/LMS toolbars, mail compose | Density tokens (compact/regular), section headers, toolbar overflow pattern |
| Overly empty areas | Android profile/settings lists, empty lists without guidance | `EmptyState` with action + illustration language (restrained, geometric) |
| Poor forms | 91 Android text fields / 41 dropdowns ad hoc; web long forms | `Field` family with label/helper/error/announce, grouped `FormSection`, consistent submit/loading |
| Weak empty / error states | 13+ Android screens without error UI; web has no 404/500/403 | `EmptyState`, `ErrorState` (retry), `ForbiddenState`, `OfflineBanner`, `Skeleton` set |
| Accessibility | unnamed icon buttons, clickable divs, tiny targets, untested text scale | Components own semantics, focus ring, 48dp/44px targets, error announcement, reduced motion |
| Responsive | 25/44 Android screens with no responsive code; web narrow = 2 nav models | Window classes (compact/medium/expanded/large/xlarge) with shared breakpoints; platform-appropriate shells |
| Motion | incidental `animate-*`; no page transitions | Motion tokens (durations, easings, distances), `Reveal`, `Switcher`, page transitions, reduced-motion collapse |

## 6. Screens not in the product today (gaps vs the brief)

- Web: org-setup page (public orgs are mobile-first, but `/api/auth/me` already reports `onboarding.orgSetupRequired`), billing/subscription page, global notifications page (popover only), forbidden/404/global-error, offline state.
- Android: manager/admin approval inbox (APIs exist), team calendar on phone-first layout, billing management beyond the Premium card, offline banner.
