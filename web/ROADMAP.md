# DoppelDash — Master Roadmap (2026-06-18)

Single source of truth. All prior phase plans deleted.

## Status
- ✅ Phases 1–8 shipped
- ✅ Phase 9 (UI/UX overhaul) — commit 97ddf10
- ✅ Phase 10A (boss→admin) + 10B (mail access) — commit d2f45ca
- ✅ Phase 11 complete: 11A (LMS month filter), 11B (earned cap), 11C (scan-card OCR+gallery), 11D (campaign sidebar), 11E (travel chain), 11F (reimbursement chain), 11G (mass mail — existing composer)
- ✅ Phase 12 complete: 12A (users role/dept filter), 12B (report date presets), 12C (branded exports via lib/export.ts)
- ✅ Phase 13 (audit hardening — pagination + full color map)
- 🎉 **All roadmap phases 8–13 shipped.** Remaining items are backlog only (dark mode, IMAP inbox, more chart types).
- ⚠️ **Prod DB migration required** after deploying 10A/11E/11F (see bottom).

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

## Phase 9 — Global UI/UX Overhaul ✅ DONE (2026-06-16)

Shipped: reusable `components/ui/modal.tsx` (Modal/Header/Body/Footer), `components/ui/error-state.tsx`, and `PageSkeleton`/`TableSkeleton` in `components/ui/skeleton.tsx`.
- **9A done:** all 10 raw Radix dialogs migrated to `Modal` (RMS×3, CRM×2, Announcements×2, Analytics×2, Reports×1). Destructive confirms (Confirm Payment, Reject Expense, Delete Contact) use `dismissible={false}`.
- **9B done:** CRM table→card fallback below `md`; RMS line-items stack on mobile (`sm:contents` grid restore); Reports tables wrapped in `overflow-x-auto -mx-4 px-4` + `min-w-[640px]`. No h-scroll at 375px.
- **9C done:** 20 route-segment `loading.tsx` files; `ErrorState` (inline + retry) wired into 9 pages. Segment `error.tsx` already existed.
- Carryover (low risk): mail page has no initial-load skeleton (streaming UI); profile uses object-not-array error guard. Empty states already used `EmptyState` pre-9.

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

### 10A Rename boss → admin (everywhere) ✅ DONE (2026-06-16, commit d2f45ca)
- [x] `UserRole` type + Mongo enum `'boss'`→`'admin'`
- [x] All role comparisons swept (api + pages)
- [x] `Sidebar.tsx` `ROLE_COLOR`; settings/users/directory labels → Admin; `BossDashboard`→`AdminDashboard`
- [x] Seed writes `role:'admin'`
- [x] UI "Boss" → "Admin" everywhere
- NOTE: `pending_boss`/`bossNote`/`boss_only` left then; status enums renamed in 11E/11F.

### 10B Mail Access Control ✅ DONE (2026-06-16, commit d2f45ca)
- [x] Mass mail: `admin` + `manager` by default
- [x] Admin grants per-employee access (toggle in Users panel, audited)
- [x] `mailAccess: boolean` on User model (default false)
- [x] Sidebar hides Mail unless `role !== 'employee' || user.mailAccess`; server guards on `/api/crm/campaign` + `/mail`

---

## Phase 11 — Feature Fixes

### 11A LMS: Month-Filtered Cards ✅ DONE (2026-06-16)
- `<input type=month>` selector (default current month) → `?from=&to=` on `/api/lms`; "All" clears filter.

### 11B LMS: Earned Leave Cap ✅ DONE (2026-06-16)
- Max 4 earned/application: frontend disables submit + inline warn; API POST 400.

### 11C Scan Card: Image Upload + OCR + Storage ✅ DONE (2026-06-18)
- Upload-only (camera overlay removed from `ScanCardDialog`); JPG/PNG.
- OCR: existing serverside Gemini-vision (Ollama fallback) in `/api/crm/ocr` — already "serverside, no binary", kept instead of OCR.space.
- Image storage: compressed **base64 data-URI** in the `ScannedCard` doc — works on Netlify (the `/api/upload` local-FS path is broken there, and no Cloudinary creds yet). Card is saved immediately on upload, OCR result patched in after (fast UX, no waiting on slow OCR).
- `ScannedCard` model: `{ uploadedBy, uploadedByName, imageData, ocrSource, parsedFields, contactId?, createdAt }`.
- API: `GET/POST /api/crm/scanned-cards`, `PATCH/DELETE /api/crm/scanned-cards/[id]`.
- Gallery `/crm/scanned`: thumbnails + parsed fields, Import-to-CRM (links `contactId`), delete, "Imported" badge; linked from CRM header ("Cards" button).
- Verified live (Playwright): upload→store→OCR→form→gallery→import→delete, 0 console errors.

### 11D Campaign: Own Sidebar Section ✅ DONE (2026-06-20)
- Campaign promoted to a top-level **Communications** sidebar item (`Megaphone` icon) → `/crm/campaigns` (route kept; not physically moved to avoid breaking links).
- Gated like other mail items: `roles:['employee','manager','admin']` + `requiresMailAccess` → managers/admins always, employees only if granted (10B).
- Page now has a client-side mailAccess guard (EmptyState "Mail access not granted") matching `/mail`; send API `/api/crm/campaign` already 10B-gated.
- Already a mass-email composer only (no scan card).

### 11E Travel: Manager → Admin Approval Flow ✅ DONE (2026-06-18)
- Status chain (impl naming): `pending_manager` → `pending_admin` → `approved` / `rejected`; manager can return to employee. Server state machine in `api/travel/[id]/route.ts` (`VALID_TRANSITIONS`), admin-only final approval guard.
- Manager forwards to admin or rejects; admin approves/rejects `pending_admin`.
- Every transition audited (actor + timestamp via `writeAudit`, `travel.<status>`).
- Print button visible to all roles on travel detail page (`window.print()`).

### 11F Reimbursements: Approval Flow ✅ DONE (already built + completed in 10A/11F rename)
- Table mode log dialog (`max-w-2xl`) with line items + per-item review.
- Flow: `Employee submits` → `Manager approve(→pending_admin)/reject/return` → employee revises (`returned`→`pending_manager`) → `Admin marks paid`. Server-enforced in `api/rms/[id]/route.ts` (employees can only edit `returned`).
- Every transition audited with actor + timestamp; status-change emails.
- Note: status values renamed `pending_boss`→`pending_admin`, `bossNote`→`adminNote` in 11E/11F sweep.

### 11G Mass Mail Tool ✅ DONE (covered by existing `/mail` composer + 11D campaign)
- `/mail` composer already does: recipient picker (CRM+Directory+tags), To/Cc/Bcc (click-to-cycle), server SMTP send, copy-rich-HTML clipboard, mailto/Outlook draft. `/api/crm/campaign` does the tag-segmented blast. 11D promoted Campaign to its own sidebar item.
- Spec extras NOT built (low value, skipped): per-field subject copy button, Gmail compose URL mode.
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

### 12A Users Panel ✅ DONE (2026-06-23)
- Cards already show avatar, name, role badge, department + inline controls (role dropdown, mailAccess toggle [10B], ban/unban, reporting-manager picker).
- Added **role filter chips** (all/employee/manager/admin) + **department dropdown** + clear + count. Search already existed.
- Slide-out Sheet NOT added — inline expand-in-place already gives the full profile + all controls; a Sheet would be churn for no functional gain.

### 12B Analytics & Reports
- Additional chart types (bar, area, pie for leave types)
- Date range presets: This Month, Last Quarter, YTD, Custom
- Export all: branded PDF/Excel with Doppelmayr logo header + proper column formatting

### 12B Analytics & Reports ✅ DONE (date presets already shipped)
- Reports `DATE_PRESETS` = Today / Last 7 days / This month / Last 3 months / This year + custom range — covers the spec.
- Additional chart types deferred to backlog (existing donut/bar tiles sufficient).

### 12C Exports — Branded Everywhere ✅ DONE (2026-06-23)
- New shared `lib/export.ts`: `brandedPDF` (DOPPELMAYR wordmark header, blue `#0057A8` table heads, alt-row shading, "Confidential — Doppelmayr India" footer + page numbers), `brandedXLSX` (title/date block + auto column widths), `brandedCSV` (title/date preamble + footer), `fmtDate` = `DD-MMM-YYYY`.
- Retrofitted: Reports (PDF + 3× XLSX + 3× CSV), RMS, Contacts, Audit. (Logo = text wordmark — avoids bundling a base64 PNG; `/api/upload` is Netlify-broken anyway.)
- NOT retrofitted (low value): analytics tile CSVs, travel detail `window.print` (different mechanism).

---

## Phase 13 — Audit Log Hardening ✅ DONE (2026-06-23)
- [x] Null guard on `performedByName` (Phase 8A, shipped earlier)
- [x] Travel + reimburse approval events audited — `api/travel/[id]` + `api/rms/[id]` `writeAudit` on every transition
- [x] `boss` audit refs → `admin` (10A sweep; performedByName fallbacks now 'Admin')
- [x] Pagination — API returns `{logs,total,hasMore}` w/ `skip`/`limit` (PAGE_SIZE 50); "Load more" button on page
- [x] Action color map expanded — all `travel.*`, `expense.returned_*/pending_manager/resubmitted/withdrawn/deleted`, `user.mail_access_changed/permissions/privileges/reporting_manager`; `travel` added to type filter (maps to `travel_request` targetType in API)

---

## Deferred / Backlog
- Dark mode
- IMAP inbox
- CSV bulk import for contacts
- Role-aware global search
- WelcomeTour: seen-state already in DB (shipped Phase 7, keep)

---

## ⚠️ Prod DB Migration (run once after deploying 10A / 11E / 11F)
Local DB already migrated. Prod still has old role/status values — the renamed Mongo
enums will reject them. Run in the prod Mongo shell (or via a seed-gated script):
```js
// 10A — roles + mail access
db.users.updateMany({ role: 'boss' }, { $set: { role: 'admin' } })
db.users.updateMany({ mailAccess: { $exists: false } }, { $set: { mailAccess: false } })
db.users.updateMany({ role: { $in: ['admin','manager'] } }, { $set: { mailAccess: true } })
// 11E/11F — status + note field renames
db.expenses.updateMany({ status: 'pending_boss' }, { $set: { status: 'pending_admin' } })
db.travelrequests.updateMany({ status: 'pending_boss' }, { $set: { status: 'pending_admin' } })
db.expenses.updateMany({ bossNote: { $exists: true } }, { $rename: { bossNote: 'adminNote' } })
db.travelrequests.updateMany({ bossNote: { $exists: true } }, { $rename: { bossNote: 'adminNote' } })
```
Without the role step, the admin account loses admin access on prod.

## Hard Constraints (never re-litigate)
- Deploy: `git push origin main` only — Netlify auto-build. CLI deploy breaks SSR.
- File uploads: Cloudinary only — `/api/upload` local FS is broken on Netlify
- `mailto:` = plaintext, ~1900 char cap, one window at a time
- Rich email = server SMTP (`harshpandhehome@gmail.com`) or copy-rich-HTML + paste
- Vercel: blocked by Citrix — not used
- OCR: use OCR.space API (serverside), not local Tesseract binary
