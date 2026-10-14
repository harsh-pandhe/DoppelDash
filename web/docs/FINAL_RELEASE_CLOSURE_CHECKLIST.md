<!-- SOURCE OF TRUTH. Converted from DoppelDash_Final_Release_Closure_Checklist_UPDATED_2026-10-14.docx; updated by the implementation programme. -->
<!-- Statuses used in the evidence ledger: TODO, IN PROGRESS, CODE-VERIFIED, FAKE-VERIFIED, DEVICE-VERIFIED, LIVE-STAGING, PROD-VERIFIED, BLOCKED. -->
> **Programme note.** Machine-generated route inventories live in [`ledger/ROUTE_LEDGER.md`](ledger/ROUTE_LEDGER.md) (regenerate with `node scripts/inventory/generate-ledger.js --mobile <path-to-DoppelDash-mobile>`). Per-slice evidence is recorded in section 16.

# Final Release
Closure Checklist

Web • Backend • Android • Free/Premium • Security • Real-world verification

Purpose. One working document to inventory every Web route/page and Android screen, link each one to its APIs, roles, plans, tests and evidence, and close the product without treating a passing mock test as proof of production readiness.

| Project fact | Current verified state (14 Oct 2026) | Closure implication |
|---|---|---|
| Web source | Private repo; integration/phase0-recovery @ e2b02fb. PR #1 draft/open; main @ d6c89b3 unchanged. | Do not merge before P0 fixes, staging evidence and review. |
| Flutter source | Private repo; integration/phase0-recovery @ 80d0897; pushed. | 13 live-backend tests remain skipped; keep separate from release/main. |
| Web CI | PR run 38582516272 succeeded: 680 passed / 0 failed / 1 skipped (T8), 681 total across 50 files. | T8 checkout skipped because MOBILE_REPO_DEPLOY_KEY is absent; 681/0 GitHub baseline not yet reproduced. |
| Flutter CI | Run 38579837106 succeeded; analyze clean, 442 passed / 13 skipped / 0 failed. | 13 skips require DD_E2E_URL and an isolated staging backend; never use production. |
| Current release decision | NOT READY for public launch. P0 security/data-integrity gates remain open; Netlify preview failed for e2b02fb. | Inspect failure and prove isolation; status alone does not prove production impact or secret exposure. |
| Netlify preview / repo controls | Netlify deploy preview failed (6acf9433dd7541ef9306cd77); isolation unverified. Listed GitHub branches report protected=false. | Inspect build log/context; verify rulesets and required checks. Disable or isolate preview until proven safe. |


## Live repository and CI checkpoint — rechecked 14 October 2026

Web source: draft PR #1 at full SHA e2b02fb223aacb88aeca9cf521c208654a1747d5; base main SHA d6c89b307d26ab7692a3ccfd7a31c09fe0c49be7. The PR remains open/draft and unmerged.

Web CI: PR run 38582516272 (success) — 50 files, 681 tests, 680 pass / 0 fail / 1 T8 skip. The workflow skipped the Flutter checkout because the read-only mobile-repo secret is absent. CI owner instructions

Flutter CI: run 38579837106 (success) — 80d0897b55dd43807b6c9c0218d22b11ee4b47fd; analyze clean, 442 pass / 13 skipped / 0 fail. The 13 skips require a disposable live backend via DD_E2E_URL.

Netlify: deploy preview failed; inspect this deployment. The status does not establish why the deploy failed or whether production credentials/data were reachable. Verify environment isolation before running staging/destructive tests.

Release ledger / backup: The requested web/docs/FINAL_RELEASE_CLOSURE_CHECKLIST.md was not found on the integration branch when checked; this refreshed DOCX/PDF are local deliverables, not yet committed. The byte-verified backup is on the same disk; no off-disk encrypted copy is evidenced.

Operating rule: mark an item DONE only when the named evidence exists and is linked. Use NOT APPLICABLE only with a short rationale. If a test passes against fakes, label it FAKE-VERIFIED, not LIVE-VERIFIED.


# 1. How to use this checklist

| Status | Meaning | Acceptable evidence |
|---|---|---|
| TODO | Not yet examined or implemented. | None yet; assign owner and due date. |
| IN PROGRESS | Changes or tests underway. | Branch/commit + active issue. |
| CODE-VERIFIED | Code path reviewed and basic automated tests pass. | File/route and test names. |
| FAKE-VERIFIED | Real route/client exercised using disposable DB and fake external providers. | CI run URL, suite, counts, test fixture. |
| DEVICE-VERIFIED | Real Android device, release-like build and recorded user journey. | Device/build, role, steps, result, log/screenshot with sensitive data removed. |
| LIVE-STAGING | Real provider/backend in isolated staging, no production data. | Provider, timestamp, test IDs, redacted logs, expected and actual result. |
| PROD-VERIFIED | Observed safely in production after approved rollout. | Deployed SHA, health metrics, synthetic check, rollback plan. |
| BLOCKED | Cannot close because a decision, credential or dependency is missing. | Exact blocker and decision owner. |


# 2. Fastest safe execution order

| Gate | Workstream | Definition of done | Blocking? |
|---|---|---|---|
| G0 | Source & environment safety | Both branches backed up; exact SHAs recorded; encrypted off-disk backup or verified equivalent before destructive changes; preview isolation proven; no production secret/user data in preview/CI; required checks/rules reviewed before merge. | Yes |
| G1 | P0 backend security / data integrity | RTDN fail closed; deletion reliable with agreed retention; Doppelmayr entitlement provisioned/audited; private storage verified. | Yes |
| G2 | Backend contracts & tenancy | All API routes inventoried; role/tenant/plan matrix tested; indexes applied to staging; rate limits and errors verified. | Yes |
| G3 | Web page closure | Every discovered Web route listed, tested in current supported browsers at Employee/Manager/Admin where applicable; existing visual design unchanged. | Yes |
| G4 | Android page closure | Every registered route/screen listed and checked on Samsung SM-S721B Android 16 using QA package; loading/error/offline/accessibility covered. | Yes |
| G5 | Feature parity + plan matrix | Every Web capability has a mobile equivalent or explicit approved platform exception; Free/Premium/Doppelmayr permissions proven. | Yes |
| G6 | Live integrations & E2E | Cloudinary, email/IMAP, OCR, Play Billing, crons run in staging; all 13 live-backend tests pass. | Yes for applicable feature |
| G7 | Release candidate | Privacy/support/delete pages, signing, Play track, data safety, monitoring, backups/restore and rollback all approved. | Yes |

Do not wait for T8 to finish coding. Fix critical security paths and page parity in parallel on the integration branches; keep CI evidence honest and rerun it at each closure gate.


# 3. P0 launch blockers — close before public launch

| ID | Required closure | Specific acceptance checks | Evidence / status |
|---|---|---|---|
| P0-01 | RTDN authentication fails closed | Unset auth config rejects all delivery; query-string secret removed; Pub/Sub push OIDC issuer/audience/service identity verified; invalid/expired/wrong-audience tokens rejected; replay/duplicate notifications idempotent; status re-fetched from Google Play Developer API before entitlement mutation; logs redact tokens. | FAKE-VERIFIED (code + local fake Pub/Sub OIDC + Play API in `tests/billing_rtdn.test.js` at `2439cbc`); live Pub/Sub staging test pending. |
| P0-02 | Account and organisation deletion | Define retention policy first; account deletion returns truthful status; partial failure is retryable and visible; data inventory covers users, org, CRM, leave, expenses/line items, travel, receipt manifests/files, inbox/mail config, usage, announcements, tokens/sessions, audit policy, exports/backups; idempotent repeated delete; sole-owner org disband case; preserve only legally required/auditable records under documented policy. | FAKE-VERIFIED (mechanics + data inventory in `tests/account_deletion.test.js` & `tests/account_deletion_integrity.test.js` at `e73f21a`/`e339931`); BLOCKED on owner retention-policy decision D-02 before live application. |
| P0-03 | Doppelmayr lifetime entitlement | Dry-run provisioning; exact persisted fields set: premium, lifetime_grant, lifetimeGrant true, webEnabled true, androidEnabled true according to actual schema; audit who/when/reason; rerun is safe; no org name/slug hard-coded runtime bypass; verify persisted production org via authorised read-only check. | FAKE-VERIFIED (audited dry-run/apply library + CLI in `tests/doppelmayr_entitlement_provisioning.test.js` at `cb8e341`); BLOCKED on owner executing dry-run/apply against real DB. |
| P0-04 | Private receipt/travel document storage | Use isolated Cloudinary staging account; test signed upload ticket, upload preset, authenticated/private asset URL, authorised same-org owner and manager/admin stream, unrelated employee 403, cross-tenant 404, tampered/deleted/missing asset, real size/MIME checks, PDF download, replacement and deletion; ensure no public `secure_url` leaks; reconcile upload/proxy maximum sizes. | FAKE-VERIFIED (in-process fakes in `tests/receipt_ocr_vertical.test.js` & `tests/travel_attachments.test.js`); BLOCKED on isolated Cloudinary staging run. |
| P0-05 | Safe deploy preview | Review Netlify deploy-preview context. Prove preview cannot access production Atlas, prod auth/encryption secrets, real email, Cloudinary, billing or destructive cron/dev routes. Use isolated DB and credentials or disable previews for untrusted branch until isolation is proven. | FAKE-VERIFIED (`lib/deployContext.ts` fail-closed guard + `netlify.toml` preview build cancellation in `tests/preview_safety.test.js` at `10ce1c2`); BLOCKED: owner review of Netlify deploy settings. |
| P0-06 | Branch and release provenance | Record exact Web and Flutter SHAs; confirm fresh clone contains all modules; PR remains unmerged until all gates green; verify actual deployment commit before any production claim. | IN PROGRESS — Web integration branch at `7f40c01` (push CI green 705/0/1), Flutter branch at `2a86939`; PR #1 open/draft, unmerged; main `d6c89b3` untouched. |


# 4. Backend/API closure matrix

Source snapshot found ~80 API routes according to Phase 0 audit. This matrix groups by capability; the implementation operator must export the literal `web/app/api/**/route.ts` inventory into the detailed route ledger and account for every route. No route may be silently omitted.

| ID | API group | Required test coverage | Principal / plans | Current state |
|---|---|---|---|---|
| API-01 | Auth/login/logout/refresh/OTP | Login, invalid credentials, OTP expiry/replay, logout revoke, refresh rotation/reuse, cookie + bearer, session expiration, password change revokes other sessions. | Unauthenticated / member | FAKE-VERIFIED foundation; device/live pending |
| API-02 | Register/org setup/invitations | Free org defaults, validation, invite expiry/one-use, role assigned server-side, no privilege self-assignment. | Public + invited user | Fake tests; E2E pending |
| API-03 | Password reset/passkey/TOTP | Generic non-enumerating responses; short-lived one-use tokens; safe redirects; MFA recovery/rate limits. | Self / public endpoints | Partial; verify route-by-route |
| API-04 | Auth context / web boundary | Persisted `webEnabled` only; public Free/Premium org denied Web; no plan/name/slug bypass. | All authenticated roles | Fake boundary suite; live smoke pending |
| API-05 | Organisation/user/settings/brand | Tenant-scoped reads/writes; only authorised admins alter roles/settings; safe logo/media; persisted entitlement resolver. | Employee/Manager/Admin | Fake / provision path pending |
| API-06 | Employee directory/profile | Cross-tenant not-found behaviour; permitted fields only; role changes and account status logged. | Roles by policy | Complete systematic matrix |
| API-07 | CRM CRUD/timeline/reminders | Validation, ownership/sharing, paging, search, create/update/delete, audit, cross-tenant denial. | Owner/manager/admin | Vertical fake suite; E2E pending |
| API-08 | CRM share/QR/vCard/scanned cards | Token expiry/revoke, public payload minimised, revoke kills access, import/export validation, OCR safe failures. | Authorised CRM user/public share token | Partial, add negative controls |
| API-09 | CRM AI generation | Provider timeout, quota, rate limit, unsafe/empty output, secret redaction, Free vs Premium enforcement. | Plan-aware | Must validate contract with mobile parity |
| API-10 | Campaigns/contact import-export | CSV/XLSX formula injection, MIME/size bounds, duplicate handling, preview/rollback, permissions and quota. | CRM permissions/plan | Partial |
| API-11 | Leave/holidays/calendar/team | Date/time zones, overlap, balance race, approve/reject role rules, self-approval prohibition, organisation holiday isolation. | Employee/Manager/Admin | Need complete matrix |
| API-12 | Announcements/notifications | Tenant filtering, role target correctness, scheduled cron idempotency, read state, pagination. | All roles per audience | Need systematic tests |
| API-13 | Expenses/receipts/OCR | Amounts/line-items, concurrency/idempotency, state transitions, receipt permissions, OCR quota/empty result/retry, payment evidence and export. | Employee/Manager/Admin | Expense fake suites; live storage/OCR pending |
| API-14 | Travel CRUD/review/conversion | Validation, role gates, revision 428/400/409 contract, cancellation, idempotent creation/conversion, attachments, paging/cursor scope, duplicate/concurrent request. | Employee/Manager/Admin | 681-suite fake verified; client idempotency/index rollout remain |
| API-15 | Inbox/SMTP/IMAP/Outlook | Per-user/org credentials encrypted, mailbox isolation, HTML sanitisation, draft/reply/send idempotency, webhook auth, OAuth refresh/revocation, no credential leakage. | Mailbox owner/admin by policy | Fake-only; live staging needed |
| API-16 | Analytics/shared dashboard | Tenant-safe aggregation, share-token expiry/revocation, read-only allowed fields, filters and export access. | Role + public share-token boundary | Partial; route matrix missing |
| API-17 | Reports/print/exports/search | Filters bind to tenant, large-result caps, CSV formula injection, PDF access checks, no cross-tenant search leakage. | Role-specific | Systematic coverage missing |
| API-18 | Admin/users/roles/audit | Least privilege, self-lockout guard, auditable privileged actions, pagination, redaction and immutable policy where required. | Admin only / owner constraints | Partial |
| API-19 | Support chat/public pages | Abuse/rate limits, safe data minimisation, no unintended public access to internal data; support contact is configured. | Public and authenticated routes by design | Needs live check |
| API-20 | Billing/entitlements/quota | Store token verification, acknowledge/restore, authoritative status refresh, subscription expiry/cancel/grace, duplicate RTDN, quota atomicity, platform access gates. | Free/Premium/Doppelmayr | RTDN P0; live Play pending |
| API-21 | Account deletion/disband | Inventory-driven delete/retain policy, transactional or retryable orchestration, truthful response, evidence that private assets are deleted, race/idempotency tests. | Self / sole owner | P0 |
| API-22 | Cron/dev/webhooks | Authentication is mandatory; wrong/no secret rejected; scheduler configured; idempotent; dev routes unavailable/disabled in prod; fail closed. | Service-only | P1/P0 depending route |
| API-23 | Uploads/media/config | Signed authorisation, tenant-bound object paths, no public URLs, size/type sniffing, metadata policy, orphan cleanup and no-store headers. | Owner/org permissions | Live Cloudinary pending |
| API-24 | Cross-cutting middleware/errors | No auth bypass via file suffix; same 404 for missing vs foreign records where required; correct 401/403/404/409/422; no secrets in logs. | Every route | Run enumeration & global secret scan |


### Backend global acceptance

☐ Generate machine-readable inventory of every Next.js API route, method, auth requirement, tenant source, role guard, plan/feature gate, rate limit and tests; every route has an owner and result.

☐ For every read/write, try no token, expired token, wrong role, same-org wrong owner, cross-org ID, malformed payload, oversized payload, duplicate request and concurrent requests where relevant.

☐ Verify tenant ID comes from trusted server session / persisted org membership, never from client payload alone.

☐ Check indexes in isolated staging with explain plans; schedule index builds; unique-index conflicts handled safely; record rollback instructions.

☐ Exercise rate limits, timeouts, provider unavailable, malformed provider response, empty result, retry, duplicate webhook, partial failure and idempotent replay.

☐ Run dependency audit, secret scan, log scan, SSRF/path traversal/file upload checks and production-mode configuration tests.

☐ Confirm error messages do not expose secrets, internal provider URLs, existence of foreign-tenant records or stack traces.

☐ Run backup-and-restore rehearsal against a sanitized staging backup before launch; document RPO/RTO and access controls.


# 5. Web frontend page-by-page closure

This table uses known routes and page groups visible in the current audit. Before closure, Claude must enumerate every actual route from the checked-out `web/app/**/page.tsx` and `route.ts`, reconcile with navigation links and this list, and append missing rows. Existing Web colours, layout, typography, mountain/cable-car imagery, spacing and hierarchy are locked; only correctness/accessibility/error copy/spacing fixes are allowed.

| ID | Page / screen group | Check end-to-end | API links | Role / plan | Closure evidence |
|---|---|---|---|---|---|
| W-01 | /sign-in | Login, OTP/MFA/passkey as implemented, password visibility, invalid/locked account, loading, expiry, redirect safety, logout/session expiry. | API-01/03 | All intended Web-eligible org roles | Smoke + auth security |
| W-02 | /sign-up | Public registration, create Free org, validation, duplicate email, server-assigned lowest privilege, no Web entitlement for public tenant. | API-02/04 | Free onboarding | Functional + entitlement check |
| W-03 | /forgot-password and reset route(s) | Generic response, email delivery, one-use/expiry, link opens and token is not logged or included in rendered page payload. | API-03/15 | Public | Live SMTP + browser link test |
| W-04 | /invite and acceptance | Expired/reused invite, correct org/role, malicious redirect, token removed from HTML/logs. | API-02/03 | Invitee | Browser journey |
| W-05 | /web-access-restricted | Public organisation gets clear restriction; no loops; sign-out and back button correct. | API-04 | Public Free/Premium | Access-boundary E2E |
| W-06 | /dashboard | Employee/Manager/Admin panels and data differ by role; KPI accuracy; empty/error/loading; refresh; mobile/tablet/desktop viewport. | API-05/06/11/12/14/17 | Doppelmayr; no public Web access | Real route + role screenshots |
| W-07 | Directory/profile | Search/filter/page, profile fields, role-sensitive actions, empty states and cross-tenant prevention. | API-06 | All authorised Web roles | E2E negative tenant tests |
| W-08 | CRM contacts/detail/timeline/share | CRUD, validation, assignment, reminders, timeline, QR/vCard, sharing and revoke, import/export and OCR states. | API-07/08/10 | As allowed by plan/role | End-to-end contacts lifecycle |
| W-09 | Campaigns | Create/edit/preview/send or schedule, audience count, consent rules, quota, provider failure and audit. | API-10/15 | Premium/free policy to be reconciled | Fake + live-safe staging send |
| W-10 | Leave pages/calendars/review queues | Apply/edit/cancel, balance, overlap, approve/reject, manager/admin queue, filters, timezone and calendar export if present. | API-11 | Employee/Manager/Admin | Role-based full workflow |
| W-11 | Expenses/claim detail/print | Draft/submit/revise/withdraw, line items, receipts, OCR, approval, paid/reimbursement state, PDF/print, duplicate-click. | API-13 | Employee/Manager/Admin | Full lifecycle + PDF check |
| W-12 | Travel list/detail/create/review | Create, legs/dates/totals, attached docs, revision conflict, approve/reject/cancel, conversion, paged deep list, empty/error states. | API-14 | Employee/Manager/Admin | Cross-client round-trip |
| W-13 | Inbox/compose/draft/detail/config | Connect/configure mailbox, sync, open/reply/compose/draft, attachments, auth failure, disconnect/revoke, no mailbox configured. | API-15 | Mailbox owner/admin | Live IMAP/SMTP/OAuth staging |
| W-14 | Analytics / shared dashboard | Filters, drilldown, comparisons, responsive charts, share creation/revoke/expiry, public share read-only boundary. | API-16/17 | Plan/role policy | Tenant and share token tests |
| W-15 | Reports/exports | Every report route, filters, empty/large export, formats, timezone/currency correctness, safe spreadsheet cells. | API-17 | Role/plan-specific | Download content validation |
| W-16 | Admin users/roles/invites/settings | Invite, deactivate, role changes, balances/config, protect last admin/sole owner, audit trail, privilege denial. | API-05/18 | Admin/owner | Admin-only tests |
| W-17 | Audit history/search/notifications | Pagination, dates, filters, notification read state, tenant-safe results and keyboard access. | API-12/17/18 | Role-specific | Cross-tenant negative tests |
| W-18 | Announcements/support chat | Create/schedule/broadcast permissions; public support page and chat safe failures, abuse limits, contact details. | API-12/19/22 | Role-specific | Public + authenticated flows |
| W-19 | Org/user settings/security | Profile, password/session, MFA/passkey if supported, theme, mail config, quotas, plan and account deletion confirmation. | API-01/03/05/15/20/21 | Role/tenant/plan matrix | Functional + data deletion test |
| W-20 | Billing / restricted Web access | Show appropriate plan info; no public tenant accesses Web even when Premium; only persisted entitlement fields control access. | API-04/20 | Public Free/Premium denied; Doppelmayr allowed | Negative + positive entitlement tests |
| W-21 | Privacy/terms/support/delete-account | HTTPS canonical URLs, real support address, truthful delete workflow, no placeholder, policy matches actual processing/retention. | API-19/21 | Public | Legal/content and browser check |
| W-22 | Not-found/error/accessibility | 404/500/retry, no leaked stack, keyboard-only, focus order, labels, contrast, zoom, reduced motion and screen-reader names. | API-24 | Every page | Manual browser audit |
| W-23 | Design/viewport regression | Capture existing approved UI at baseline viewport; compare screenshots; check 320/375/768/1024/1440 widths, dark mode only where supported. | n/a | Doppelmayr Web only | No visual redesign; attach redacted diffs |


### Web route discovery (must complete before calling page audit exhaustive)

☐ Run a script over `web/app/**/page.tsx` to list route groups/dynamic segments; capture exact paths with route-group folders removed.

☐ Run a separate inventory over `web/app/api/**/route.ts` and list supported HTTP methods per route.

☐ Compare all `href`, `router.push`, form action, sidebar and bottom-nav links to actual pages; identify dead links and orphaned pages.

☐ List each page with page owner, APIs called, roles, plan visibility, load/error/empty states, accessibility evidence and commit SHA.

☐ Perform visual baseline check against the approved Web version; do not redesign or replace established visuals.


# 6. Android screen-by-screen closure

Use a separate QA application ID such as `com.doppeldash.app.qa`; do not uninstall or overwrite the installed Play Store app. Current target is the connected Samsung SM-S721B, Android 16, 1080×2340. The router source enumerates initial auth/onboarding routes and a stateful shell with five primary branches; the app has additional direct routes listed below. The actual GoRouter list must be exported programmatically and compared to this checklist.

| ID | Screen group | Full user journey to test | API links | Role / plan | Closure evidence |
|---|---|---|---|---|---|
| A-01 | Splash/session restore/sign-in | Fresh install, valid saved session, invalid refresh, sign-out, app resumed/offline, rate/OTP/MFA paths supported by server, deep link token. | API-01/03 | Free/Premium/Doppelmayr identity | Device + auth tests |
| A-02 | Sign-up/org setup/profile/welcome | Create public Free organisation; field validation; skip/defer onboarding; no role/plan spoofing; resume after kill. | API-02/05 | Public Free/Premium flow | Device journey + persisted DB state |
| A-03 | Forgot/reset/invite acceptance | Open email link into app, expired/replayed link, token secure handling, app not installed fallback. | API-02/03/14 | Public/invitee | App Links + browser fallback |
| A-04 | Dashboard shell/KPIs | Correct role-specific widgets and navigation, no fake zeros on API error, pull-to-refresh, empty/offline/retry. | API-05/06/11/12/14/17 | Employee/Manager/Admin | Samsung role screenshots/logs |
| A-05 | Leave | Apply, dates, overlap, balances, withdraw, review as manager/admin, current-user identity and permission denial. | API-11 | Employee/Manager/Admin | Full lifecycle |
| A-06 | Expenses/receipts/OCR | Create, draft/submit/revise/withdraw, line items, camera/gallery/PDF picker, upload/progress/retry/replace, OCR correction, approval/payment/print/export. | API-13/23 | Employee/Manager/Admin; Free/Premium limits | Real storage + OCR + PDF checks |
| A-07 | Travel | Create legs/accommodation, choose/upload documents, paging, status/revision conflict, detail/edit policy, approve/reject/cancel/convert. | API-14/23 | Employee/Manager/Admin | Cross-client round-trip |
| A-08 | Contacts/CRM detail/timeline | CRUD, search, share/revoke, QR/vCard, OCR scanned cards, imports/exports and AI generation. | API-07/08/09/10 | Role + plan | Add missing AI API caller and tests |
| A-09 | Campaigns | Create/edit/audience, validation, plan quota, preview and sending/scheduling path if supported. | API-10/15 | Role + plan | Provider-safe staging check |
| A-10 | Analytics | Filters, drill-down, comparison charts, responsive layout, shared dashboard open/revoke/expiry. | API-16/17 | Role + plan | Implement shared-dashboard parity |
| A-11 | Reports/exports | All Web reports and supported file formats; large data; no spreadsheet formula injection; open/share/export affordances. | API-17 | Role + plan | Implement missing reports caller |
| A-12 | Mail/inbox/drafts/detail | Connect IMAP/SMTP/Outlook where configured; sync; compose/reply/draft/send; attach/open files; disconnect, provider outage. | API-15/23 | Per-user/per-org mail permissions | Live sandbox mailbox |
| A-13 | Directory/profile | Search employees, profile privacy, self-update, change password/session-ended redirect, logout. | API-01/06 | All roles per policy | Device + privacy checks |
| A-14 | Announcements/notifications/search | Correct target, schedule, unread/read, search, pagination, empty/offline/retry. | API-12/17 | Audience/role-specific | E2E |
| A-15 | Admin home/users/audit/org settings | Admin and owner checks enforced server-side, invite/deactivate/role, org and mail configuration, audit history, protect last admin. | API-05/18 | Admin/owner only | Negative tests as Employee/Manager |
| A-16 | Settings/entitlements/subscription | Persist settings; biometric opt-in; entitlement refresh; buy/restore/cancel/expiry; quota display; no false success. | API-01/20 | Free/Premium | Play licence tester + device |
| A-17 | Support chat | Support conversation, rate limits, send failure, no sensitive data exposure. | API-19 | Relevant roles | Implement missing screen/repository/API caller |
| A-18 | Account deletion | Clear confirmation and re-auth if required; correct owner/member choices; pending state, retries, signed-out terminal state. | API-21 | Member/sole owner | Delete+verify data inventory |
| A-19 | Deep links/app links | Invite/reset links route to correct screen; invalid token safe; assetlinks fingerprint matches release signing certificate. | API-03/02 | Public/invitee | Installed and not-installed tests |
| A-20 | Material 3/accessibility | Light/dark themes, 1.5x/2x text, TalkBack semantics, keyboard/external input if relevant, contrast, touch targets, reduced motion, no overflow. | n/a | All screens | Device evidence for each module |
| A-21 | Network/lifecycle/resilience | Airplane mode, timeout, 401 refresh, 403, 404, 409 revision conflict, 413, 429, 5xx, resume, process death, duplicate taps. | All APIs | All roles/plans | Device + integration suite |


### Android route discovery and launch package

☐ Enumerate every GoRouter route, nested shell route, dialog/sheet and menu destination from `lib/app.dart` and any route helpers; append routes absent above.

☐ For each route test first launch, repeat launch, deep link entry, back behavior, app resume and logout/session expiry.

☐ Install QA flavour side-by-side with public Play build; record package ID, versionCode/build number, SHA, device OS and API base URL.

☐ Build signed release AAB using release signing in the local secure environment; verify signing certificate, `applicationId`, target API, permissions and version. Never copy signing material into logs or repository.

☐ Check store listing assets, screenshots, name, privacy/data safety, ads/tracking statements, support address and deletion URL against actual shipped behavior.


# 7. Roles, tenant boundaries and product plans

| Scenario | Expected access | Required proof |
|---|---|---|
| Public Free organisation | Android access only; Free limits enforced server-side; Web login/session must not provide access. | Create org on clean test account; verify persisted fields, API 403/web restriction, feature quotas at boundary. |
| Public Premium organisation | Android Premium features only; Premium subscription is org-level and inherited by members; still no public Web access. | Purchase/test subscription, second org member sees same plan, expiry/cancel/grace and restore behavior. |
| Doppelmayr organisation | Lifetime Premium; Web and Android enabled; every member inherits persisted entitlement. | Read persisted fields from authorised environment; prove features work; no org-name/slug conditional bypass. |
| Employee | Own records + explicitly shared items only; cannot approve self, change roles, access another org, or use admin APIs. | Run all employee tests against same-org owner/foreign owner and cross-org IDs. |
| Manager | Only assigned/team/org capabilities defined by policy; review workflow; cannot become admin by changing payload. | Positive/negative API matrix for every manager endpoint and mobile page. |
| Admin | Tenant-scoped administration; sensitive owner-only actions remain protected; audit privileged mutations. | All admin pages/routes plus employee/manager denial controls. |
| Last admin / sole owner | Protected from accidental lockout; deletion/disband requires explicit impact confirmation and retention behavior. | Concurrent action, failed deletion retry, second admin transfer where applicable. |
| Unknown/legacy org state | Fail closed or explicit migration path; never grant Web/Premium based on display name, slug or email domain. | Malformed/missing fields tests; backfill dry-run and report. |


### Entitlement invariants

☐ Public Free: `plan=free`, `entitlementSource=none`, `lifetimeGrant=false`, `webEnabled=false`, `androidEnabled=true` (verify exact schema enum and defaults).

☐ Public Premium: `plan=premium`, `entitlementSource=subscription`, `lifetimeGrant=false`, `webEnabled=false`, `androidEnabled=true`.

☐ Doppelmayr: `plan=premium`, `entitlementSource=lifetime_grant`, `lifetimeGrant=true`, `webEnabled=true`, `androidEnabled=true`.

☐ Enforce server-side quotas/limits for every gated API, not just hidden buttons or disabled UI.

☐ Test all three org types × Employee/Manager/Admin where that role exists × web/android entry points, including deep links and direct API calls.

☐ Approve and document Premium pricing, plan limits, product identifiers, cancellation/refund behavior and how billing changes org-level entitlement.


# 8. Required cross-client acceptance scenarios

| ID | Acceptance journey | Feature |
|---|---|---|
| X-01 | Employee creates CRM contact on Android → same authorized Web account sees it; Web update → Android refresh sees it. | CRM |
| X-02 | Expense created on one client → edit/submit/approve/pay on the other with no duplicated line items/receipts or state regressions. | Expenses |
| X-03 | Travel request created on Android → Web review → Android sees final status/revision; convert exactly once to expense; expense appears consistently. | Travel |
| X-04 | Receipt uploaded via signed flow → authorised same-org reviewer streams it; another employee is denied; foreign tenant receives not-found; deleted asset no longer streams. | Private storage |
| X-05 | Role changed in Web → Android refresh/context reflects permission change without stale privilege; old access token does not retain removed rights longer than intended. | Auth/RBAC |
| X-06 | Premium activated/restored/expired → every org member sees same current entitlement; all clients enforce updated quota/access. | Billing |
| X-07 | Account deletion started from one client → user becomes signed out; second client cannot refresh; retention and deletion evidence match policy. | Deletion |
| X-08 | Mail/settings changed in one client → other client sees consistent config/status; secrets never returned to clients. | Mail/config |
| X-09 | Share link created/revoked in Web → Android can open permitted read-only view or shows an explicit unsupported message; revoked link stops working. | Analytics/CRM links |
| X-10 | Notification/announcement read in one client → read state is consistent in the other; tenant and audience target remain correct. | Messaging |


# 9. Live staging checks (not covered by fake-provider CI)

| Provider / service | Staging procedure | Pass evidence | Release rule |
|---|---|---|---|
| Cloudinary | Use isolated staging cloud/preset and synthetic files. Upload, authorised stream, wrong-tenant denial, replace, delete, metadata, size/MIME; inspect direct/public URL behavior. | Redacted run log + test asset IDs + verified privacy/access outcomes. | Receipts/travel docs stay disabled until pass. |
| Gemini / OCR | Use synthetic receipts/business cards with known ground truth. Compare vendor/date/currency/tax/total; empty result, timeout, quota, configured fallback, no OCR hallucination presented as verified fact. | Per-field accuracy table and documented fallback/limits. | Do not advertise accuracy beyond measured results. |
| SMTP | Use dedicated mailbox/alias and staging base URL; invite/reset/support send; verify HTTPS links and sender/SPF/DKIM/DMARC as applicable; bad password and rate limits. | Received messages and redacted headers/logs. | No public launch with placeholder support or broken links. |
| IMAP / Outlook | Dedicated sandbox mailbox; sync, paged inbox, compose/reply/draft, revocation, OAuth renewal; no cross-user message leakage. | Message IDs, sync results, revoked-credential negative test. | Mail feature gated until works or hidden by explicit product decision. |
| Google Play Billing + RTDN | License tester; purchase, verify via Play API, acknowledge, restore, renew/cancel/expire; signed Pub/Sub push; duplicate and out-of-order notifications. | Play order/test IDs, authoritative state, RTDN logs with tokens removed. | Paid tier stays closed until secure lifecycle passes. |
| Scheduled jobs | Configure actual scheduler for cleanup/announcements/birthday or other cron endpoints; no public unauthenticated invocation; verify idempotency. | Scheduler config + one successful safe run + negative auth test. | No claim of cleanup running without a scheduler. |
| MongoDB staging | Sanitised disposable/staging DB; apply/index verify; migrations/backfill dry-run; concurrency/explain; restore snapshot. | Index catalogue, explain summaries, restore report. | Do not test new indexes/migrations on production first. |


# 10. UI/UX, accessibility and resilience checklist for every page


### Every Web page

☐ Loading/skeleton, empty state, success, validation error, server error, timeout, offline/reconnect and retry all behave intentionally.

☐ No dead buttons, dead links, placeholder content, console exceptions or silent mutation failures; success toast only after server confirmation.

☐ Keyboard navigation, visible focus, meaningful labels, form error association, contrast, zoom, reduced motion and screen-reader text are acceptable.

☐ Responsive viewport suite 320/375/768/1024/1440px; no unintended horizontal overflow or clipped controls.

☐ Existing approved design visual diff checked: no Web redesign or accidental changes to typography, colours, cable-car/mountain artwork, spacing or hierarchy.

☐ Sensitive routes redirect appropriately; loading/refresh does not leak cached tenant-specific content after logout or organisation switch.


### Every Android screen

☐ Test Samsung SM-S721B Android 16, installed QA build; then at least one emulator/secondary density if available.

☐ Light/dark, default/1.5x/2x text, TalkBack, status/navigation bars, keyboard, rotation/window resize if supported, and long content all render without overflow.

☐ Loading/empty/error/retry/offline/401 refresh/403/404/409/413/429/5xx and duplicate tap states are understandable and recoverable.

☐ No fake success, stuck spinner, silent no-op, app crash or stale data after role/plan change. Sensitive state clears on logout/account deletion.

☐ Permission denial and permanent denial explained correctly; camera/gallery/system photo picker requested only when needed; no broad media permission unless approved and justified.

☐ Back button, tab state, app resume, process death, deep link and session expiry return the user to a safe route.

☐ No Web UI visual changes; Android keeps coherent Material 3 tokens, touch targets and consistent interaction patterns.


# 11. Release candidate and operations


### Web production readiness

☐ Confirm canonical production hostname, actual Netlify site, current deployed commit SHA and environment context; production vs deploy-preview variables reviewed. Current PR preview failure is tracked under P0-05; failure alone is not proof of a data/secret incident.

☐ Preview deployment either disabled for untrusted PRs or isolated from production database, email, secrets, uploads, billing and destructive routes. Current PR #1 Netlify deploy-preview check failed; inspect its build log and prove environment isolation before re-enabling/retrying.

☐ Production build and start tested using pinned Node version; align Netlify Node 22 with Dockerfile or document supported deployment path.

☐ All mandatory environment variables validated at startup; missing security secrets fail closed; no production dev seed/failpoint secrets; no placeholder URLs/emails.

☐ Cron scheduler configured for all required jobs; CRON_SECRET mandatory; runbooks note method/header and safe manual recovery.

☐ Monitoring/alerts for 5xx, auth errors, provider failures, RTDN failures, storage quota and cron failure; request ID and redacted structured logs.

☐ Backup retention and restoration proof recorded; rollback release and database schema compatibility checked.

☐ Public `/privacy`, `/terms`, `/support`, `/delete-account` URLs work over HTTPS; policies accurately describe processing, retention, subscriptions and account deletion.


### Android / Play readiness

☐ Release AAB built from exact reviewed SHA with production API base URL and non-placeholder SUPPORT_EMAIL compile-time define.

☐ Application ID confirmed as `com.doppeldash.app`; version/build number incremented beyond 1.0.1+2 as required by Play release; target/compile SDK satisfy current Play requirements at submission time.

☐ Release signing tested; signing keys never in git/CI logs; preserve secure backup of upload key and record who can access it.

☐ Play Billing package/product IDs match Play Console and server configuration; verify product query, purchase acknowledge, restore, cancellation and refunds.

☐ App Links domain association and release signing fingerprint verified, or documented safe browser fallback is accepted.

☐ Play Data safety, permission declarations, privacy policy, support contact, account deletion URL, screenshots/listing and reviewer access match live app behavior.

☐ Closed test cohort/process completed if required for the account; crash-free baseline and staged rollout/rollback plan approved.


# 12. Decisions needed to close remaining ambiguity

| Decision | Default recommendation | Decision owner / closure note |
|---|---|---|
| D-01 Travel documents after submission | Allow requester to add/remove documents only while pending_manager; managers/admins can review/download, but not mutate requester evidence unless explicitly allowed. Mirror the same policy in Web and Android. | Owner approval required; then implement both clients. |
| D-02 Retention on deletion/disband | Adopt a documented retention schedule; delete personal/auth data and private blobs when not legally required, pseudonymise retained transaction/audit records where appropriate, never falsely report complete deletion. Obtain appropriate legal review. | Owner/legal decision; required for P0-02. |
| D-03 Re-conversion after linked expense deletion | Default deny and return a documented conflict; use explicit admin repair if a legitimate correction is needed, rather than silently creating a second expense. | Owner confirmation. |
| D-04 Free/Premium plan and product IDs | Pick exact limits, Premium price, monthly product ID and cancellation/grace/refund rules; enforce the same server values everywhere. | Owner decision. |
| D-05 Canonical domains/staging | Name production/staging URLs and the deployment platform; never point PR previews at production services. | Owner decision/environment access. |
| D-06 Android for Web-only admin | Native screens for frequently used admin tasks; explicit secure Web link only for genuinely desktop-only tasks, without bypassing `webEnabled`. | Owner product decision. |
| D-07 Support/legal contact | Provide final support email and verify privacy/data controller and account deletion wording. Do not put secret passwords into this document. | Owner decision. |
| D-08 Public launch cohort/release strategy | Recommend internal/staging → closed Play testing → staged production rollout with rapid rollback. | Owner release decision. |


# 13. Final sign-off: do not close until every applicable box is checked


### Engineering sign-off

☐ Every Web page path and Android route is in the final route ledger; no orphan link, orphan screen or unaccounted API route remains. Current repository Markdown ledger is not yet committed; create and reconcile it before sign-off.

☐ Every route has security/tenant/role/plan tests; all P0 items have negative-control tests that fail when protections are removed.

☐ Web CI green with zero unexplained skips. Current PR run passed 680/681, with the one T8 skip documented because the private Flutter checkout secret is absent; remove the exception only after T8 actually passes in Actions.

☐ Flutter analysis/tests green; all 13 currently skipped live-backend integration tests run successfully against isolated staging, not production (current CI: 442 passed / 13 skipped / 0 failed).

☐ Cross-client flows X-01 through X-10 pass or have documented, owner-approved inapplicable exception.

☐ All missing Android capabilities are implemented and tested or have a written owner-approved exception. No silent parity gaps.

☐ Live-provider checklist passed for every enabled feature. Any disabled/unverified feature is gated, hidden and accurately disclosed.


### Product/operations sign-off

☐ P0-01 through P0-06 closed with evidence links and reviewed by another person.

☐ All D-01 through D-08 decisions recorded; legal/retention decisions reviewed as appropriate.

☐ Staging-to-production configuration, migrations/indexes, secret rotation, monitor/alert, backup restore, rollback and on-call ownership documented.

☐ Privacy/support/deletion and Play listing are truthful and match shipped app.

☐ Release candidate SHA and AAB hash recorded; production deploy SHA confirmed; smoke tests pass; staged rollout has an explicit rollback trigger.

☐ Owner signs: Web launch approved / Android launch approved / deferred features explicitly listed.

| Sign-off role | Name / signature | Decision / exceptions | Date |
|---|---|---|---|
| Engineering lead |  |  |  |
| Product owner |  |  |  |
| Security / operations reviewer |  |  |  |
| Release owner |  |  |  |


# 14. Evidence ledger (fill as work closes)

| ID / checklist ref | Branch + commit SHA | Test / run / device | Evidence link / artifact | Status | Reviewer + date |
|---|---|---|---|---|---|
| G0 / Web source | e2b02fb | PR #1 draft/open; 15 commits / 291 files; main=d6c89b3. | Open draft PR #1 | OPEN / NOT MERGED | Checked 14 Oct 2026 |
| G0 / Flutter source | 80d0897 | Integration branch pushed; full SHA on status page. | Open Flutter CI | RECOVERED | Checked 14 Oct 2026 |
| CI / Web | e2b02fb | 680 pass / 0 fail / 1 T8 skip; 681 total. | Open Web PR CI | SUCCESS WITH SKIP | Checked 14 Oct 2026 |
| CI / Flutter | 80d0897 | Analyze clean; 442 pass / 13 skipped / 0 fail. | Open Flutter CI | SUCCESS; E2E PENDING | Checked 14 Oct 2026 |
| P0-05 / Netlify preview | e2b02fb | Deploy preview failed; cause and environment isolation unknown. | Open failed Netlify deployment | BLOCKED / INVESTIGATE | Checked 14 Oct 2026 |
| CI / T8 | e2b02fb | Mobile checkout skipped; MOBILE_REPO_DEPLOY_KEY absent. | Open CI owner instructions | OWNER ACTION | Pending secret setup |
| G0 / Markdown ledger | e2b02fb | Requested Markdown source was not found remotely. | Integration branch contents check | TODO / NOT COMMITTED | Checked 14 Oct 2026 |
| G0 / backup | local only | Verified backup shares disk with originals; off-disk copy not evidenced. | Local backup report / directory | TODO / OFF-DISK | Before destructive work |


# 15. Instructions for Claude / implementation operator

• Use this refreshed document as the master closure checklist. As of 14 Oct 2026, `web/docs/FINAL_RELEASE_CLOSURE_CHECKLIST.md` was not present on the Web integration branch. Create a Markdown source-of-truth copy, commit it to the Web integration branch, and add a link/reference from the Flutter repository. This local DOCX/PDF has not been pushed to GitHub.

• First enumerate actual Web route files, all API route files/methods, Android GoRouter destinations, repository/provider dependencies and existing tests. Produce the detailed route ledger mechanically; do not infer a page does not exist because a guessed filename was wrong.

• For each item, record discovered path/screen, required role(s), org plan(s), dependencies, test commands, initial state, exact pass criteria, issue/commit, evidence URL and status. Preserve the source UI designs.

• Work in short slices on the integration branches. Do not wait for the optional T8 cross-repo token check to implement unrelated fixes. Keep T8 exception documented until actually resolved.

• Prioritise in this order: preview/secret isolation and P0 security; backend inventory/tenant matrix; missing Android parity; per-page UI closure; live staging providers; Samsung end-to-end; final release checks.

• Never connect destructive tests, billing tests, uploads, cleanup jobs or deletion scenarios to production data. Use synthetic data and disposable/staging services.

• Do not mark LIVE-STAGING/DEVICE-VERIFIED/PROD-VERIFIED based on unit tests, mocked Dio, fake provider, static code review or a build alone.

• If credentials/owner policy is required, record the exact secret name and secure owner action; continue independent work. Do not request the user to paste secrets in chat.

• At each checkpoint report closed IDs, open IDs, blockers, exact SHAs, test results and evidence. Do not say “everything is done” while an unexplained route or parity row remains.

# 16. Reconciliation with the repository (machine inventory, Slice 0 — 14 Oct 2026)

Counts from `scripts/inventory/generate-ledger.js` at Web `e2b02fb`+: **44 Web pages**, **91 API route files / 150 method handlers**, **33 Android route paths**, **4 cron endpoints**. The audit's "~80 routes" was low by 11. Rows below were *missing* from sections 5–6 and are now part of the programme (all start TODO).

| ID | Surface found in code | Where | Notes |
|---|---|---|---|
| W-24 | `/crm/directory`, `/crm/scanned`, `/crm/campaigns`, `/crm/new` | web pages | extend W-08/W-09 |
| W-25 | `/lms/holidays`, `/lms/team`, `/lms/new`, `/lms/[id]` | web pages | extend W-10; `/lms/new` not linked from any component (verify reachability) |
| W-26 | `/mail`, `/mail/drafts`, `/inbox`, `/inbox/[id]`-API | web pages | extend W-13 |
| W-27 | `/onboarding`, `/profile`, `/reports`, `/analytics/drill` | web pages | `/analytics/drill` and `/reports` extend W-14/W-15 |
| W-28 | `/contact/[token]`, `/shared/[token]` | public pages | public token boundary — W-14/W-08 |
| W-29 | `/print/expense/[id]` | web page | W-11 |
| W-30 | `/design-system`, `/design` | dev showcase | must be disabled in production (`DD_DESIGN_SHOWCASE`) — verify |
| W-31 | `/delete-account`, `/privacy`, `/terms`, `/support` | public pages | W-21 |
| A-22 | Android `/welcome`, `/onboarding-role`, `/onboarding/org-setup`, `/onboarding/profile` | GoRouter | extend A-02 |
| A-23 | Android `/contacts/scanned-cards`, `/campaigns`, `/directory`, `/search`, `/notifications`, `/announcements` | GoRouter | A-08/A-09/A-13/A-14 |
| A-24 | Android `/mail/compose`, `/mail/draft/:id`, `/mail/:id` | GoRouter | A-12 |
| A-25 | Android `/admin`, `/admin/users`, `/admin/audit`, `/admin/org` | GoRouter | A-15 |
| A-26 | Design showcase route (`kDdShowcasePath`) | GoRouter, flag-gated | must be off in release builds |

## 16.1 Findings from the first inventory pass
* **API routes with no test mentioning them (23):** analytics share/shared, outlook OAuth, passkey register/login/credentials, totp setup, tour-seen, holidays, inbox, lms calendar/workload, mail drafts, reports, support chat, sync/email, user email-config (+test), outlook webhook. → G2 matrix work.
* **API routes with no Android caller (35):** admin balances/invitations/settings, analytics drill/share/software, announcements/broadcast, crm/generate, lms calendar/workload, org/mail-config, reports, support/chat, passkey endpoints, outlook, rms receipt streaming path, travel itinerary streaming path (cron/dev/webhook routes excluded as intentionally server-only). → G5 parity work; the receipt/itinerary stream callers need verifying (mobile may build the URL from the presented path).
* **Public (no session/secret guard found) routes (16):** analytics shared/[token], auth/* (login, register, refresh, OTP, reset, invitations, passkey login, setup), support/chat, logout — expected for pre-auth endpoints; each needs its own rate-limit/abuse test (API-01..03, 19). `auth/setup` must be proven secret-gated (`SETUP_SECRET`).
* **Cron endpoints (4):** announcements, birthday, onboarding, receipts-cleanup — secret-guarded; **no scheduler is configured in the repository** (G6/P1).
* **Dev/destructive endpoints present in the production bundle:** `/api/dev/seed`, `/api/dev/migrate`, `/api/dev/reset-to-admin` (env-gated). Treat as P1 until excluded from production builds or proven disabled.

# 17. Programme evidence log (append-only)

| Date | Slice | Branch @ SHA | What changed | Verification (command → result) | Status |
|---|---|---|---|---|---|
| 2026-10-14 | S0 start | Web `e2b02fb` / Flutter `80d0897` | Revalidated: PR #1 open+draft+mergeable, `main` d6c89b3 unchanged; Web CI run 38582516272 success (680/0/1 T8); Flutter CI 38579837106 success (442/13 skipped/0); Netlify deploy-preview check **failed** (log not accessible without Netlify login) | `gh pr view`, `gh run list` | recorded |
| 2026-10-14 | S1 P0-05 | Web `10ce1c2` | netlify.toml cancels preview/branch-deploy builds; `lib/deployContext.ts` makes hosted DB access fail closed unless `DD_DEPLOY_CONTEXT=production|staging`; runbook `docs/PREVIEW_AND_ENVIRONMENT_SAFETY.md` | `node tests/preview_safety.test.js` → 5/5 | **FAKE-VERIFIED (code); BLOCKED: owner must inspect Netlify deploy `6acf9433…` + set DD_DEPLOY_CONTEXT=production before any production deploy** |
| 2026-10-14 | S2 P0-01 | Web `2439cbc` | RTDN: Pub/Sub OIDC auth fail-closed, query/header secrets removed, authoritative Play reconciliation, atomic duplicate guard, lifetime orgs protected | `tests/billing_rtdn.test.js` 9/9 (in-process route, fake OIDC + fake Play API incl. real SA-assertion signing); `tests/batch_m.test.js` 21/21; 5 negative controls fail as expected | **FAKE-VERIFIED; LIVE-STAGING pending** (Pub/Sub push + licence-tester) |
| 2026-10-14 | S3 P0-03 | Web `cb8e341` | Audited idempotent dry-run/apply provisioning script + library; no runtime bypass | `tests/doppelmayr_entitlement_provisioning.test.js` 6/6; 3 controls | **FAKE-VERIFIED; owner must run dry-run/apply on the real DB** |
| 2026-10-14 | S4 P0-02 | Web `e73f21a`/`e339931` | Deletion orchestration: truthful status, full tenant inventory, blobs first, user last, retryable | `tests/account_deletion.test.js` 6/6 + `tests/account_deletion_integrity.test.js` 5/5; 3 controls | **FAKE-VERIFIED (mechanics); BLOCKED on D-02 retention policy** |
| 2026-10-14 | S5 Task 1 (A6 fix) + Task 2 (G2 matrix) | Web `7f40c01` | Diagnosed PR CI regression in `tests/web_auth_pages.test.js` test A6: 100ms uncleaned `setTimeout` in `SignInPage` jerked focus back to Digit 1 during multi-digit typing, truncating OTP and blocking auto-submit. Fixed with active-element guard, timer cleanup, and `autoFocus={i === 0}`. Single-core stress test passed 50/50. Push CI run 38604390320 green with 705 pass / 0 fail / 1 skip (ds_tokens T8). Created machine-readable route & tenant security matrix (`docs/ledger/security_matrix.json`, `docs/ledger/SECURITY_MATRIX.md`, generator `scripts/inventory/generate-security-matrix.js`) accounting for all 91 route files and 150 method handlers. Evaluated first high-risk batch: 18 public handlers, 117 session handlers, 15 service handlers; identified 59 handlers with test coverage gaps (21 P1 high-risk). | `gh run view 38604390320` -> 705/0/1; `node scripts/inventory/generate-security-matrix.js` | **FAKE-VERIFIED (A6 fix + Matrix baseline)** |
