# DoppelDash — Master Roadmap (2026-06-13)

Single source of truth. All prior phase plans deleted.

---

## Terminology (apply everywhere, not negotiable)
- `boss` role → `admin` in DB, API guards, seed, sidebar, UI labels
- Central email sender: `harshpandhehome@gmail.com` (server SMTP) — no per-user email config

---

## Phase 8 — Critical Bugs (do first, in order)

### 8A Audit Page Crash ✅ DONE (2026-06-13)
- **Error:** `Cannot read properties of undefined (reading 'employeeName')`
- **Fix 1 (done):** `(app)/admin/audit/page.tsx:208` — guarded: `(log.performedByName || 'Unknown').split(...)`. `avatarGradient` already null-safe.
- **Fix 2 (deferred to 10A):** role check at `api/admin/audit/route.ts:9` still `'boss'`. NOT changed — whole codebase still uses `'boss'`; renaming one file breaks consistency. Global `boss→admin` is Phase 10A.

### 8B LMS ERR_NETWORK_CHANGED + Reload Loop ✅ DONE (2026-06-13)
- Root cause: polled `fetchLeaves` (via `useAutoRefresh`) had no AbortController → poll resolves on unmounted component after navigation → setState → loop. `useAutoRefresh` cleanup itself was already correct (clears interval + listeners).
- **Fix (done):** `(app)/lms/page.tsx` — `fetchLeaves(signal?)` now accepts AbortSignal, passes to both fetches, bails on `signal.aborted`, ignores `AbortError`. Mount effect creates `AbortController` + `return () => ac.abort()`.
- Remaining: RMS/Travel/other pages' mount-once `[]` fetches not yet abort-guarded (low risk, fast-resolving). Roll into 9C.

### 8C Sidebar Logo ✅ DONE (2026-06-13)
- **Fix (done):** `components/layout/Sidebar.tsx:88` — replaced `"D"` span with `<Image src="/icon-192.png" ...>` (no `logo.png` existed; used existing PWA icon). `object-cover` + `overflow-hidden` on wrapper.

### 8D App-Wide Performance ◑ PARTIAL (2026-06-13)
Root causes:
1. Every page mount = fresh DB fetch, no caching
2. No AbortController — stale fetches resolve after navigation
3. MongoDB: no indexes on hot query fields
4. No `loading.tsx` skeletons on route segments — blank flash on navigate-back

Done:
- **MongoDB indexes added:** `Leave(userId,startDate)` + `Leave(status)`, `Expense(userId,status)`, `TravelRequest(userId,status)`. `AuditLog(createdAt)` + `AuditLog(targetType,createdAt)` already existed. All models had `userId` single-field index already.

Deferred (carry to Phase 9C / next session):
- **Cache-Control NOT added.** Risk: 43 GET routes, most are auth-scoped per-user — blanket `s-maxage` shared-cache would leak one user's data to another via CDN. Needs per-route audit (public vs private) before applying. DO NOT blanket-apply.
- App-wide AbortController on all client fetches (only LMS done).
- `loading.tsx` per route segment skeletons.

---

## Phase 9 — Global UI/UX Overhaul

### 9A Dialog Boxes (all dialogs app-wide)
Current problem: dialogs are narrow, cramped, inconsistent padding, slow to open.
Standard to apply to every dialog:
- Width: `max-w-xl` minimum, `max-w-2xl` for forms with tables
- Consistent padding: `p-6` body, `pt-0` after title
- Form fields: `h-10` inputs, `rounded-xl` borders, proper `focus:ring`
- Submit button: always bottom-right, `min-w-[120px]`, loading spinner state
- Escape closes dialog; backdrop click closes (unless destructive confirm)
- No layout shift on open (use `dialog` or `Sheet` with fixed width)

### 9B Responsive Polish
- Mobile: all tables → card list fallback
- Bottom nav: already has Travel tab; audit all bottom-nav items match sidebar sections
- No horizontal scroll on any page at 375px width

### 9C Loading & Error States
- Every data fetch: show skeleton (not blank, not spinner-only)
- Every API error: show inline error message with retry button
- Empty states: illustration + action button (not just "No data")
- Form submission: button shows spinner + disabled during POST; success toast on complete

---

## Phase 10 — Role & Access

### 10A Rename boss → admin (everywhere)
- [ ] `web/lib/auth.ts` and any role comparison
- [ ] All `api/**/route.ts` files: `role !== 'boss'` → `role !== 'admin'`
- [ ] `Sidebar.tsx`: `roles: ['boss']` → `roles: ['admin']`; `ROLE_COLOR` key
- [ ] Seed script: `role: 'boss'` → `role: 'admin'`
- [ ] UI: "Boss" label → "Admin" in Users panel, audit log, profile, everywhere

### 10B Mail Access Control
- Compose/send mass mail: `admin` + `manager` by default
- Admin can grant access to specific employees (toggle in Users panel)
- Store `mailAccess: boolean` on User model (default false for employee)
- Sidebar: show Mail section only if `role !== 'employee' || user.mailAccess`

---

## Phase 11 — Feature Fixes

### 11A LMS: Month-Filtered Cards
- Calendar month selector on LMS page → filter cards to only show leaves in that month
- Wire `from`/`to` params: `from = first day of selected month`, `to = last day`
- Default: current month on load

### 11B LMS: Earned Leave Cap
- Max 4 earned leaves per single application
- Frontend: disable submit + show error if `type === 'earned' && days > 4`
- API POST: reject with 400 if cap exceeded

### 11C Scan Card: Image Upload + OCR + Storage
- UI: single file upload input (JPG/PNG), no camera overlay
- Server: upload image to Cloudinary → get URL
- OCR: call OCR.space API (`https://api.ocr.space/parse/url`) with Cloudinary URL — free tier, serverside, no binary
- Parse extracted text into fields (name, company, phone, email, designation)
- Store in `ScannedCard` model: `{ imageUrl, rawText, parsedFields, uploadedBy, createdAt }`
- UI: gallery of stored scanned cards for reference; click to view/edit parsed fields + import to CRM

### 11D Campaign: Own Sidebar Section
- Move Campaign out of CRM
- Add `{ href: '/campaign', label: 'Campaign', icon: Megaphone, roles: ['admin','manager'] }` as own section
- Campaign page = mass email composer only (not scan card)

### 11E Travel: Manager → Admin Approval Flow
- Status chain: `pending` → `manager_approved` → `admin_approved` / `rejected` / `returned`
- Manager sees pending requests → can approve (sends to admin) or reject
- Admin sees `manager_approved` requests → approves (final) or rejects
- Print button visible to all roles on travel detail page

### 11F Reimbursements: Redesigned Expense Log
Dialog redesign (`max-w-2xl`):
- Table: columns = Description | Amount | Receipt (upload) | Paid By
- "Paid By" = dropdown: `Company` / `Personal (me)`
- Add row button; delete row
- No AI-find field; just clean manual entry
- Approval flow: `Employee submits` → `Manager: approve / reject / request revision` → if rejected → Employee revises → `Manager re-approves` → `Admin: marks paid`
- Every state transition stored in DB with timestamp + actor

### 11G Mass Mail Tool
- Purpose: send Doppelmayr product emails to clients
- Roles: `admin`, `manager` (+ employees granted access via 10B)
- Send modes:
  1. **Direct Gmail** — server SMTP via `harshpandhehome@gmail.com`
  2. **Copy rich HTML** — clipboard, user pastes into any client
  3. **Open draft** — pre-fill To/CC/BCC + subject + body in mailto or Gmail compose URL
- Per-field copy buttons (subject, body, full HTML)
- Recipient picker: CRM contacts + Directory + manual entry + tags
- To / CC / BCC support

---

## Phase 12 — Admin Panel Improvements

### 12A Users Panel
- Card grid (not flat table): each card shows avatar, name, role badge, department
- Click card → slide-out Sheet with full profile
- Inline: role change dropdown, `mailAccess` toggle, ban/unban, reporting manager picker
- Search + filter by role/department

### 12B Analytics & Reports
- Additional chart types (bar, area, pie for leave types)
- Date range presets: This Month, Last Quarter, YTD, Custom
- Export all: branded PDF/Excel with Doppelmayr logo header + proper column formatting

### 12C Exports — Branded Everywhere
- All CSV / Excel / PDF exports across LMS, RMS, Travel, Contacts, Audit:
  - Header row: Doppelmayr logo + report title + generated date
  - Consistent column widths, number formatting, date format `DD-MMM-YYYY`
  - Footer: "Confidential — Doppelmayr India"

---

## Phase 13 — Audit Log Hardening
- Fix null guard on `performedByName` (Phase 8A)
- Add travel + reimburse approval events to audit
- Rename all `boss` audit references to `admin`
- Paginate results: infinite scroll or page buttons (currently just limit 500)
- Expand action color map to cover travel + reimburse new states

---

## Deferred / Backlog
- Dark mode
- IMAP inbox
- CSV bulk import for contacts
- Role-aware global search
- WelcomeTour: seen-state already in DB (shipped Phase 7, keep)

---

## Hard Constraints (never re-litigate)
- Deploy: `git push origin main` only — Netlify auto-build. CLI deploy breaks SSR.
- File uploads: Cloudinary only — `/api/upload` local FS is broken on Netlify
- `mailto:` = plaintext, ~1900 char cap, one window at a time
- Rich email = server SMTP (`harshpandhehome@gmail.com`) or copy-rich-HTML + paste
- Vercel: blocked by Citrix — not used
- OCR: use OCR.space API (serverside), not local Tesseract binary
