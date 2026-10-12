# DoppelDash — Master Roadmap (2026-06-18)

Single source of truth. All prior phase plans deleted.

## Status
- ✅ Phases 1–8 shipped
- ✅ Phase 9 (UI/UX overhaul) — commit 97ddf10
- ✅ Phase 10A (boss→admin) + 10B (mail access) — commit d2f45ca
- ✅ Phase 11 complete: 11A (LMS month filter), 11B (earned cap), 11C (scan-card OCR+gallery), 11D (campaign sidebar), 11E (travel chain), 11F (reimbursement chain), 11G (mass mail — existing composer)
- ✅ Phase 12 complete: 12A (users role/dept filter), 12B (report date presets), 12C (branded exports via lib/export.ts)
- ✅ Phase 13 (audit hardening — pagination + full color map)
- 🎉 **All roadmap phases 8–13 + remaining large features shipped.** Dark mode ✅ + IMAP inbox ✅ done (2026-06-25). Only backlog left = extra chart types (donut/bar already sufficient).
- ⚠️ **Prod DB migration required** after deploying 10A/11E/11F (see bottom).
- ✅ **Full-app audit + fixes done (2026-07-03)** — static checks clean, code-level review across every module found 2 IDORs + 2 missing approval-state-machines + 10 more real bugs/hardening gaps; all fixed same-day (sonnet-5-high), re-verified tsc+lint+build clean after. See **Phase 14** below. One low-priority perf item deferred; two prod-verification checks flagged for next session.

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

Done (later phases):
- `loading.tsx` per route segment skeletons — shipped in Phase 9C (20 segments).

**Cache-Control: audited 2026-06-24 → intentionally NOT applied (WON'T DO).**
- Audit result: **41 of 44 GET routes are auth-scoped (per-user data)**. A blanket `s-maxage` shared-cache would leak one user's data to another via the CDN. The 3 public routes (`analytics/shared/[token]`, `crm/[id]/share`, `cron/*`) are token-gated or scheduled — negligible caching upside, real risk if mis-scoped.
- Conclusion: this is a correctness hazard, not an optimization. Leaving it off is the right call. Revisit only with explicit per-route `private`/`public` headers, never a blanket policy.
- Remaining minor: app-wide AbortController on client fetches (LMS + scanned + audit done; others poll harmlessly). Low priority.

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

## Phase 14 — Full-App Audit (2026-07-03) ✅ FIXES DONE (2026-07-03, same day, sonnet-5-high)

**Method:** installed deps fresh, ran `tsc --noEmit` + `next lint` + `next build` (all exit 0, clean — no type errors, no lint errors, only 7 pre-existing `<img>`/hook-dep warnings, build produces all routes). Then 5 parallel code-reading audits covering every module found the items below. All 🔴 and 🟠 items then fixed same-day in 5 parallel fix passes; re-ran `tsc` + `lint` + `next build` clean after — zero new errors/warnings, all routes (incl. renamed `/contact/[token]`) compile.

### 🔴 Security — all fixed

- [x] **14A CRM contact share link is guessable + never expires + can't be revoked** — FIXED: `models/Contact.ts` gained `shareToken`/`shareTokenExpiresAt` (random hex, 30-day TTL, regenerate/revoke). `api/crm/[id]/share/route.ts` rewritten (GET reuse-or-issue, POST regenerate, DELETE revoke). Public page moved `app/contact/[id]` → `app/contact/[token]/page.tsx`, looks up by token not `_id`. `ShareQRDialog` in `crm/[id]/page.tsx` now fetches the token live instead of embedding the raw ID.
- [x] **14B CRM contact PATCH/DELETE allow any viewer to edit/delete, not just the owner** — FIXED: `api/crm/[id]/route.ts` PATCH/DELETE now filter on `createdBy === userId` OR admin; GET keeps the original broader visibility filter.
- [x] **14C RMS has no approval state machine at all** — FIXED: `api/rms/[id]/route.ts` gained a `VALID_TRANSITIONS` map mirroring travel's (`pending_manager→[pending_admin,rejected,returned]`, `pending_admin→[paid,rejected,pending_manager]`, terminal `paid`/`rejected`/`returned`), admin-only gate on `paid`. Employee `returned`-only edit window untouched.
- [x] **14D LMS has no approval state machine at all** — FIXED: `api/lms/[id]/route.ts` now validates `pending → approved|rejected` only (409 on re-transition); existing withdraw-while-pending flow untouched.
- [x] **14E Earned-leave cap + balance never enforced server-side on approval** — FIXED: `api/lms/route.ts` POST now sums approved+pending days per capped type/year against entitlement before allowing submission; `api/lms/[id]/route.ts` PATCH re-checks on approval (409 if it would exceed balance). `lwp` stays uncapped, matching existing balance-route convention.
- [x] **14F Medical-leave doc requirement (>2 days) is client-only** — FIXED: `api/lms/route.ts` POST now replicates the client's `sick && days>2 && no medicalDocs` check server-side (400).
- [x] **14G CSV/formula injection in exports** — FIXED: `lib/export.ts` `esc()` and `analytics/tileExport.ts` `csvCell()` both prepend `'` to string cells starting with `=+-@`/tab/CR; numeric fields (all callers verified to pass real `number`, not strings) are untouched so legitimate negative amounts render correctly.
- [x] **14H Hardcoded JWT fallback secret** — FIXED: `lib/auth/jwt.ts` now mirrors `lib/encrypt.ts`'s `getKey()` pattern — throws if `JWT_SECRET` unset in production, dev-only fallback preserved.
- [x] **14I `/api/dev/migrate` missing the `ALLOW_DEV_SEED` double-gate** — FIXED: added the identical `ALLOW_DEV_SEED==='true'` + secret gate that `/api/dev/seed` already had.
- [x] **14J `lib/imap.ts` inbound-HTML sanitizer allows `style` on all tags** — FIXED: `'style'` dropped from the `'*'` wildcard attribute allowlist (extracted into shared `lib/sanitizeHtml.ts`).
- [x] **14K Announcement body sent as email HTML with no server-side sanitization** — FIXED: new shared `lib/sanitizeHtml.ts` (`sanitizeMailHtml`, same config as IMAP ingest) now runs on announcement `body` in both the create (`api/announcements/route.ts`) and edit (`api/announcements/[id]/route.ts`) handlers before persisting.
- [x] Minor/low batch — FIXED: scanned-card `imageData` server-side size cap (1.5MB) added; OTP resend no longer resets the attempt counter while a still-valid code exists (`lib/auth/otp.ts`); `api/admin/users/[userId]` PATCH now validates `role` against the real enum; dead `x-user-id`/`x-user-role`/`x-user-name` header injection deleted from `middleware.ts` (confirmed nothing read them).

### 🟠 Bugs — all fixed except one deferred

- [x] **14L `lib/imap.ts` — one malformed inbound email permanently stalls inbox sync.** FIXED: per-message parse+upsert wrapped in try/catch; a failed message now gets a minimal stub row logged with its UID so `sinceUid` advances past it instead of retrying forever.
- [x] **14M CRM reminders have no "already seen" flag or lower bound** — FIXED: `Contact.reminderDismissedAt` added, GET excludes dismissed reminders, new dismiss PATCH added on `api/crm/reminders/route.ts` (not yet wired to a UI button — the existing "Clear reminder" action already covers the common case by nulling `reminderDate` directly).
- [x] **14N Reports date presets computed in UTC, not local IST** — FIXED: `app/(app)/reports/page.tsx` now builds `YYYY-MM-DD` from local `getFullYear()/getMonth()/getDate()` via a `ymd()` helper across all 5 presets.
- [x] **CSV import + campaign send now batched** — FIXED (2026-07-03, opus): CSV import (`app/(app)/crm/page.tsx`) processes rows in batches of 15; campaign send (`api/crm/campaign/route.ts`) sends in batches of 20 with a 250ms pause between batches so a large tag segment no longer opens hundreds of simultaneous SMTP connections.

### 🧹 Data reset (2026-07-03)
- [x] **Wiped to just-admin + real reference data** — new secret-gated `api/dev/reset-to-admin/route.ts` (same `ALLOW_DEV_SEED`+secret gating as seed; refuses to run if no admin exists). Keeps `role:'admin'` user(s) + their Employee profile / LeaveBalance / passkeys / email config / outlook token, all PublicHolidays, all OrgSettings; wipes every non-admin user + all leaves/expenses/travel/contacts/scanned-cards/announcements/audit/inbox/campaign-logs/mail-drafts/sync-state.
- [x] **Local DB done** — `mongodb://localhost:27017/doppeldash` reset: 1 admin (`harshpandhehome@gmail.com`) + its profile/balance + 42 holidays remain; 10 fake users + 15 leaves + 12 expenses + 7 travel + 8 contacts + 5 announcements + 80 audit + 91 inbox all deleted.
- [ ] **Prod Atlas — user to run tomorrow:** deploy, then `POST /api/dev/reset-to-admin` with header `x-seed-secret: <DEV_SEED_SECRET>` (never in the URL) against the live app (needs `ALLOW_DEV_SEED=true` in Netlify env). Then add managers/employees by hand.

### ✅ Verified correct (called out by name so nobody re-litigates)

- Scan Card OCR pipeline (Gemini→Ollama fallback, rate-limited, no unhandled rejections) — matches ROADMAP 11C claim.
- Campaign send is server-side role/mailAccess gated, not just UI-hidden — matches 11D claim.
- `analytics/share` / `analytics/shared/[token]` — proper random token + expiry + owner-scoped revoke; use as the template for fixing 14A.
- Role-aware global search (`api/search`) — genuinely scoped inside the Mongo query server-side, not post-filtered client-side.
- MoM/YoY analytics comparison math — internally consistent, no off-by-one or leap-year bug.
- Branded exporters (`lib/export.ts`) handle empty datasets without crashing.
- Cron routes (`announcements`/`birthday`/`onboarding`) all fail closed on missing/wrong `CRON_SECRET`.
- IMAP credentials never reach the client bundle or logs; inbox route still has `runtime='nodejs'` + `maxDuration=60` (236d302 fix intact, no regression).
- `InboxMessage` upsert correctly uses its unique `{mailbox,uid}` index — no duplicate rows on repeat sync.
- Every LMS/RMS/Travel `[id]` route correctly scopes employee reads/writes to their own `userId` — **no IDOR found on the leave/expense/travel detail routes** (the IDOR issues are CRM-specific, see 14A/14B).
- `/api/dev/seed` double-gate (`ALLOW_DEV_SEED` + secret) intact and effective — prior hardening (4a29be1) holds.
- Audit log pagination clamps `limit`/`skip` server-side, matches client `PAGE_SIZE=50` — no DoS via huge `limit`.
- Every approve/reject/withdraw/delete transition across LMS/RMS/Travel writes an audit entry with actor+timestamp — no silent-skip found.

- [x] **UI error-surfacing gap (found while closing out this phase):** LMS `handleAction`/`bulkAction` and RMS `bulkAction` (`app/(app)/lms/page.tsx`, `app/(app)/rms/page.tsx`) never checked `res.ok` — a manager hitting the new 409 from 14C/14D would still see a false "approved" success toast. FIXED: all three now check response status and show a per-item failure count on error.

**Remaining for next session (needs a schema/data-migration decision, holding for opus review):** existing CRM contacts created before 14A has no `shareToken` yet — first share-link request per contact will silently issue one on demand (handled in the GET path), so no manual migration is strictly required, but worth a prod sanity-check after deploy that old shared links (bookmarked `/contact/<raw-_id>` URLs) now correctly 404 instead of silently still working — confirm nothing depends on the old URL shape still resolving.

---

## Deferred / Backlog
- ✅ Role-aware global search — DONE (2026-06-24, c0f2f4a): managers/admins search org-wide, employees own-only.
- ✅ Area-trend analytics charts — DONE (c0f2f4a): new `AreaChart`, monthly leave/expense tiles.
- ✅ CSV bulk import for contacts — already shipped (CSV Import dialog on `/crm`).
- ⏭️ Users slide-out Sheet (12A extra) — SKIPPED on purpose: inline `UserCard` already exposes every control; a Sheet is churn with no functional gain.
- ✅ **Dark mode — DONE (2026-06-25):** token-based theme. CSS vars (`:root`/`.dark`) drive `surface-*`/`ink`/`ink-muted` tokens; tailwind `darkMode:'class'`. Codemod swept literal `bg-white`/`text-gray-*`/`bg-gray-*`/`text-dm-graphite` across ~75 files. `ThemeToggle` in Header (localStorage + `prefers-color-scheme`), no-flash pre-paint script in `layout.tsx`. Chart tooltips var-driven; `@media print` forces light. Verified 20 pages × both themes, 0 console errors.
- ✅ **IMAP inbox — DONE (2026-06-25):** poll-on-demand (serverless-safe, no persistent listener). `models/InboxMessage.ts` (unique `mailbox+uid`, idempotent), `lib/imap.ts` `syncInbox()` (imapflow + mailparser; HTML sanitized on ingest via sanitize-html; first-sync bounded to newest 40 UIDs to avoid socket timeout on huge mailboxes). `/api/inbox` (list + `?sync=1`) + `/api/inbox/[id]` (detail + read toggle), gated to mailAccess. `/inbox` UI (list/detail, read-state, Reply→compose) + sidebar nav. Verified live against Gmail. Note: `IMAP_PASS` must be a Gmail **app password** (same value as `SMTP_PASS` works); spaces stripped automatically.
- ✅ **Sign-in 3D scene (2026-06-25):** full-screen procedural Three.js night cable-car scene (`components/CableCarScene.tsx`) — 8-tower ring, 6 gondolas on a continuous loop, parallax mountains, moon, stars. Fixed camera, `pointer-events-none`, lazy-loaded (three.js out of initial bundle). Sign-in logo = DoppelDash `/icon-192.png`.
- WelcomeTour: seen-state already in DB (shipped Phase 7, keep).

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
