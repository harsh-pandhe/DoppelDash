# DoppelDash completion programme — Phase 0 source audit

Audit date: 2026-10-12. Read-only: no commit, reset, stash, clean, push, deploy, network call to GitHub/hosting, credential use or secret printing. "Remote HEAD" below is the **last locally fetched** `origin/main`; a live `git ls-remote` was deliberately not run. Evidence classes used: **[code]** read in source · **[fake]** passed against local fake providers / standalone MongoDB · **[device]** physical Android · **[live]** real provider · **[prod]** deployed production. Nothing in this audit is [device], [live] or [prod] evidence, because none was collected.

## 1. Executive summary
* **The backend work of the last programme (Travel Slices 1–5, private receipt storage, OCR, cleanup, entitlements/web-access boundary, auth hardening, design system, ~50 test files) exists only as uncommitted changes in one git worktree** (`.claude/worktrees/nostalgic-cray-fe329d`, branch `claude/vigilant-panini-a41107`, 156 modified + 76 untracked paths, +3 197/−1 455 lines vs `main`). `main`/`origin/main` (d6c89b3) contains none of it. A single `git worktree prune`, `git clean`, or deleting that directory would destroy it. **This is the #1 risk.**
* The Flutter repo is in the same state: branch `v1-completion-uiux-quality-deploy` has 72 modified, 2 deleted, 62 untracked paths on top of its last commit; no upstream is configured, so **it has never been pushed on this branch**.
* What is genuinely verified [fake]: backend 681/681 tests (50 files, fresh DB, incl. production-mode suites and a log secret scan) and Flutter 442 pass / 13 skipped / 0 fail, `tsc`, lint, `next build`, `flutter analyze` clean — all at the working-tree state above, none of it reproducible from a fresh checkout of any remote (see §2.4).
* What is **not** done or not proven: real Cloudinary private storage (live), real Google Play verification/RTDN (live), real SMTP/IMAP delivery (live), any physical-device run, Play App Links, a persisted Doppelmayr lifetime-Premium/web entitlement **provisioning path** (none exists in the repo), account deletion completeness, CI of any kind, deployed-commit identity.
* Android feature coverage is broad (≈17 feature modules, 18 repositories) but is mostly "implemented but unverified": widget/view-model/mocked-Dio tests exist; no end-to-end run against a live backend (13 integration tests are skipped by design).

## 2. Source-of-truth findings (Task A)

### 2.1 Repositories
| | Web/back-end (`DoppelDash`) | Flutter (`DoppelDash-mobile`) |
|---|---|---|
| Canonical checkout | `/home/harsh-pandhe/GitHub/DoppelDash` (branch `main`, HEAD d6c89b3, upstream `origin/main` = same SHA, in sync as of the last local fetch) | `/home/harsh-pandhe/GitHub/DoppelDash-mobile` (branch `v1-completion-uiux-quality-deploy`, HEAD 970154e, **no upstream**, other local branch `master`) |
| Where the recent work lives | worktree `.claude/worktrees/nostalgic-cray-fe329d` (branch `claude/vigilant-panini-a41107` at d6c89b3 — same commit as main — **no upstream**) | working tree of the same checkout (not committed) |
| Staged changes | none | none |
| Working tree | main checkout: 2 modified docs (`PLAY_STORE_ASSETS.md`, `PLAY_UPLOAD_CHECKLIST.md`) — unrelated to the worktree's copy, to be reconciled; worktree: 156 M + 76 ?? | 72 M, 2 D, 62 ?? |
| Recent commits | d6c89b3 reviewer OTP docs · 40face4 reviewer OTP fail-closed · b59e0a0 reviewer auth/dev-endpoint audit/provisioning · c581c6e store pages, canonical Netlify URLs, multi-tenant isolation | 970154e "complete public launch readiness, multi-tenant org CRM signup, full feature parity, Play Store compliance" · 7968f6b UI/UX audit · … |
| Other worktrees | 4 more under `.claude/worktrees/` (cranky-golick, thirsty-herschel, upbeat-wiles at older detached SHAs 56eb3d1/e5b1eca) and local branches `claude/gracious-spence-*`, `claude/thirsty-herschel-*`, `claude/upbeat-wiles-*` — **not inspected for unique work; must be before any cleanup** | — |

### 2.2 Where the delivered work is (all in the worktree, uncommitted)
* **Travel Slices 1–5:** `web/lib/travel/{validation,http,attachments,present,pagination,conversion,failpoints}.ts`; `web/app/api/travel/route.ts`, `[id]/route.ts`, `[id]/expense/route.ts`, `[id]/itinerary/[file]/route.ts`; models `TravelRequest.ts` (revision, conversion state, 3 pagination indexes), `Expense.ts` (`travelConversionOf` + unique index), `AuditLog.ts` (`dedupeKey` + unique index), `ReceiptUpload.ts` (purpose/user/claimedBy/transferredTo); Web client edits in `app/(app)/travel/**`, `dashboard/_components/{ApprovalsQueue,AdminDashboard}.tsx`; tests `travel_vertical` (28), `travel_attachments` (21), `travel_patch` (24), `travel_conversion` (21), `travel_api` (14); doc `docs/TRAVEL_VERTICAL_AUDIT.md`.
* **Private receipt storage / OCR / cleanup / staging verification:** `web/lib/uploads/*`, `web/lib/ocr/*`, `web/app/api/{uploads/sign,rms/ocr,rms/[id]/receipt,cron/receipts-cleanup}`, `web/scripts/{verify-cloudinary-staging,verify-gemini-ocr}.js`, `docs/RECEIPT_STORAGE_AND_OCR.md`, tests `receipt_*`, `upload_*`, `staging_harness`, `gemini_ocr_check`, `ocr_config`, `secret_exposure`, `z_final_log_secret_scan`.
* **Auth/entitlements/web boundary:** `lib/auth/{webAccess,devShortcuts,limits,passwordPolicy,safeRedirect}.ts`, `lib/entitlements/usage.ts`, tests `auth_foundation`, `auth_me_contract`, `web_access_boundary`, `web_android_shared_data`, token-hygiene tests.
* **Design system / CRM / mail / expenses libs:** `components/ds`, `lib/ds`, `app/design*`, `lib/crm`, `lib/mail`, `lib/expenses`, `models/{OrgMailConfig,UsageCounter}.ts`; tests `ds_*`, `crm_vertical`, `expenses_vertical`, `mail_architecture`, `dashboard_tenant_isolation`.
* **Flutter (uncommitted):** Travel (`lib/ui/features/travel/**`, `travel_repository.dart` with revision + paginated list, `travel.dart`), expense receipts (`receipt_attachments_controller.dart`, `receipt_image.dart`, `receipt_scan.dart`), billing/plan (`entitlement_repository`, `subscription_repository`, `subscription_product`, `entitlements.dart`), onboarding/org setup, auth (invite accept, reset, forgot), design system (`lib/ui/core/design`, `components`), routing, `test/**` (android, core, security, integration, ui). CRM/Expenses/Mail/Leave/Admin views exist in the last commit and are modified.

### 2.3 Root `client/` and `server/`
Legacy. `client/` is a Vite app and `server/` an Express project, last touched 2026-06-11 (`fe70a1b`) and 2026-04-21 (`ceedec5`); the Dockerfile builds only `web/`; Netlify builds `npm run build --prefix web` (root `package.json`). Neither is referenced by the build or deploy. They still contain `dist/` output. **Not deleted** — recommend archiving after the owner confirms (decision D7).

### 2.4 Reproducibility and CI
* **No GitHub Actions workflow exists in either repo** (`.github/` absent). No `test` script in `web/package.json`; the backend suite needs a running dev server, a throwaway MongoDB, a fake-provider process, fake SMTP and a ~14-variable environment. The runner I used lives only in an ephemeral scratchpad. **A fresh checkout of `main` has 21 test files and none of the Slice 1–5 code; the tests are not reproducible from any remote today.**
* Flutter: `flutter analyze` and `flutter test` run without a backend (442 pass / 13 skipped); `key.properties` and `upload-keystore.jks` exist locally and are git-ignored (good); a release build needs them.
* Deploy target: Netlify (`@netlify/plugin-nextjs`, Node 22; Dockerfile uses Node 20 — **mismatch**). Deployed commit/URL: **unknown — not determinable without credentials** (decision D6).

## 3. Security, correctness and deployment gaps (Task C)
Severity: P0 = blocks any public release; P1 = blocks Play launch/paid plans; P2 = before scale.

| ID | Finding | Evidence | Sev |
|---|---|---|---|
| S1 | **Work exists only uncommitted in a worktree** (both repos) | §2 | P0 |
| S2 | **RTDN endpoint fails open**: authentication is checked only `if (PLAY_CONFIG.rtdnSecret)` — with the variable unset anyone can POST notifications; the secret is also accepted in the **query string** (leaks to logs/proxies); no Pub/Sub OIDC JWT verification | `app/api/billing/play/rtdn/route.ts` | [code] P0 |
| S3 | RTDN handling of state: payload is looked up by token and status set locally (`active`/`canceled`…); it does not appear to re-verify with the Play Developer API before changing entitlement (confirm in Phase 1) | same | [code] P1 |
| S4 | Play verification real path exists but has **never run live**; mock purchase-token prefixes are gated to non-production, but gating relies on `NODE_ENV` only | `lib/billing/googlePlayService.ts` | [code]/[fake] P1 |
| S5 | **No provisioning path for Doppelmayr's persisted lifetime Premium + web/Android entitlement.** `provision-doppelmayr-brand.js` deliberately never touches entitlement fields; no other script sets `lifetimeGrant`/`webEnabled` for it. Whether production holds those values is unknown | scripts, grep | P0 (product requirement) |
| S6 | **Account deletion is incomplete and reports success on partial failure**: every purge is `Promise.allSettled` and the response is always success. Org disband (sole owner) does not delete Leave, Expense, TravelRequest, ReceiptUpload (and stored private files), InboxMessage, AuditLog-by-policy, UserEmailConfig/OrgMailConfig, UsageCounter; a non-owner member's expenses/leaves/travel/contacts remain with their name. No legal-retention policy is encoded | `app/api/user/account/route.ts` | [code] P0 (Play + DPDP) |
| S7 | Dev/destructive endpoints (`/api/dev/seed`, `/migrate`, `/reset-to-admin`) ship in the production bundle; guarded by `NODE_ENV=production && ALLOW_DEV_SEED!=='true'` **and** `DEV_SEED_SECRET`. Acceptable only if `ALLOW_DEV_SEED` is guaranteed unset in production; recommend excluding from the production build | routes | [code] P1 |
| S8 | Crons: all four check a secret (`CRON_SECRET`); `receipts-cleanup` additionally needs `RECEIPT_CLEANUP_APPLY=1` to delete. No scheduler is configured in the repo, so abandoned-upload cleanup never runs in deployment | `app/api/cron/*` | [fake] P1 |
| S9 | Private receipt/itinerary storage: contract enforced and tested [fake] (manifest ownership, purpose, size/type, authenticated streaming, claims). **Real Cloudinary behaviour (upload preset, `authenticated` delivery, signed delivery, deletion) never verified live**; `verify-cloudinary-staging.js` exists but has not been run against a real staging account | docs | [live] P0 for receipts/travel docs |
| S10 | OCR: Gemini/Ollama chain tested against fakes only; real model accuracy and quota unverified | tests | [live] P1 |
| S11 | Email: sender configuration via `SMTP_*` + per-org `OrgMailConfig`/`UserEmailConfig` models and tests [fake]; **no live delivery evidence**, generated URLs depend on `NEXT_PUBLIC_APP_URL` (must be the canonical HTTPS host); inbox needs `IMAP_*` / per-user config | lib/mail | P1 |
| S12 | Tenant isolation: dedicated tests exist for dashboard, expenses, travel, CRM, shared-data and web-access [fake]; **no systematic proof for every endpoint** (e.g. reports, analytics share, notifications, search, support chat, holidays, admin) — a per-route isolation matrix test is missing | tests vs 80 routes | P1 |
| S13 | Travel: all paths verified [fake]. Open: document-edit permission undecided; client idempotency keys not sent by Web/Flutter; conversion after expense deletion returns `conversion_conflict`; new unique/pagination indexes not yet built in any shared environment (deploy ordering: indexes are created on first connect — run `syncIndexes`-equivalent in staging first; rollback = drop the three pagination indexes, unique `expenses.travelConversionOf` and `auditlogs.dedupeKey` are additive and can stay) | docs/TRAVEL_VERTICAL_AUDIT.md | P1 |
| S14 | Android manifest has **no App Links intent-filter** and the web app serves no `/.well-known/assetlinks.json`; password-reset/invite links cannot open the app | `AndroidManifest.xml`, `web/public` | P1 |
| S15 | Play: applicationId `com.doppeldash.app`, targetSdk 36, compileSdk 37, version `1.0.1+2`; release signing configured via ignored `key.properties`; account-deletion UI present (3 files) and web `/delete-account` page exists; **`SUPPORT_EMAIL` is compile-time (`String.fromEnvironment`) with a placeholder check** — real value must be passed at build; Data-safety/privacy text must match S6 behaviour | mobile | P1 |
| S16 | Public pages `/privacy`, `/terms`, `/support`, `/delete-account` exist; contact address comes from `NEXT_PUBLIC_SUPPORT_EMAIL` (unset ⇒ placeholder behaviour must be verified) | pages | P1 |
| S17 | Logging/secret scanning: automated scan of the dev-server log passes [fake]; no log aggregation, alerting, backup/restore runbook or uptime monitoring exist in the repo | — | P1/P2 |
| S18 | Node version mismatch Netlify 22 vs Dockerfile 20; Dockerfile uses `--legacy-peer-deps` | config | P2 |

## 4. Web ↔ Android parity matrix (Task B)
Classification: **IV** implemented and verified · **IU** implemented but unverified · **P** partial · **M** missing · **PS** intentionally platform-specific · **BC** blocked by configuration · **CS** conflicting source versions. "Verified" here = [fake] tests through the real HTTP routes; *no* row is [live], [device] or [prod] verified. Source versions: the Web rows describe the **worktree** (uncommitted); the same features on `main` are CS for anything touched in §2.2.

| Capability | Web | Android | API (role · tenant · entitlement) | Evidence |
|---|---|---|---|---|
| Sign-in password / OTP / passkey / TOTP | IV (worktree) | IU (`auth` 5 views; passkey+TOTP referenced) | `/auth/*` · public · — | auth_foundation [fake]; no device |
| Self-signup + organisation setup | P (register exists; creates Free, `webEnabled:false`) | IU (`org_setup_view`, onboarding) | `/auth/register`, `/auth/setup`, `/org/settings` | auth tests [fake] |
| Password reset / invitations | IV | IU (forgot/reset/invite screens) | `/auth/password-reset/*`, `/auth/invitations/*` | token-hygiene tests [fake]; **no App Links (S14)** |
| Session/security settings, change password | IU | IU | `/auth/change-password`, passkey/TOTP routes | partial tests |
| Account deletion | P (S6) | P (UI present) | `DELETE /user/account` · self | no completeness test |
| Dashboard / KPIs | IV (tenant isolation test) | IU (1 view) | server components + `/reports` | dashboard_tenant_isolation [fake] |
| Directory, employee profile | IU | IU (`directory`) | `/employees/*` | batch tests |
| Org settings, brand | IV (brand provisioning) | IU | `/org/settings`, `/admin/settings` · admin | provisioning test [fake] |
| CRM CRUD, timeline, reminders | IV (crm_vertical) | IU (5 views) | `/crm*` · role/ownership | [fake] |
| CRM sharing, QR/vCard | IU | IU (qr/vcard files) | `/crm/[id]/share`, `/contact/[token]` | partial |
| Business-card OCR / scanned gallery | IU (OCR fake only) | IU | `/crm/ocr`, `/crm/scanned-cards*` | [fake] |
| AI content generation | IU | **M** (no `crm/generate` caller) | `/crm/generate` | none |
| Contact import/export | IU | IU | export routes | partial |
| Campaigns | IU | IU (2 views) | `/crm/campaign` | batch tests |
| Leave: apply/review/balances/calendar/team/holidays | IU | IU (2 views; calendar/workload referenced) | `/lms*`, `/holidays` | batch tests |
| Notifications | IU | IU | `/notifications` | — |
| Announcements (+scheduled, broadcast) | IU | IU (2 views) | `/announcements*`, cron | — |
| Expenses lifecycle, line items, approvals, payment | IV (expenses_vertical) | IU (expense view + controller) | `/rms*` | [fake] |
| Receipt private storage + authorised streaming | IV [fake] / **BC [live]** | IU | `/uploads/sign`, `/rms/[id]/receipt/[file]` | receipt_* [fake] |
| Receipt OCR | IV [fake] / BC [live] | IU | `/rms/ocr` | [fake] |
| Expense print/PDF export | IU (`/print/expense/[id]`) | IU (pdf refs) | — | none |
| Travel create/list/detail/review/cancel/revision/pagination/conversion | IV [fake] | IU (list, detail, create sheet, review, paginated, revision) | `/travel*` | 5 suites [fake] |
| Travel documents: upload at create | IV [fake] | **P** (repo/model support `itineraryDocs`; no document picker evidence) | `/travel*` | — |
| Travel documents: add/replace/remove on existing trip | **P** (API only; no Web UI) | **M** | `PATCH /travel/[id]` | API tests only; permission undecided |
| Inbox / IMAP sync / reply / compose / drafts | IU | IU (4 mail views) | `/inbox*`, `/mail/drafts*`, `/sync/email`, Outlook | mail_architecture [fake]; no live mailbox |
| Per-org mail config | IU | IU | `/org/mail-config`, `/user/email-config*` | [fake] |
| Analytics, drill, filters, comparison, software | IU | P (1 view) | `/analytics*` | — |
| Analytics sharing (shared dashboard link) | IU (`/shared/[token]`) | **M** (no caller) | `/analytics/share*` | — |
| Reports + exports | IU | **M/P** (no `reports` caller found) | `/reports` | — |
| Admin users/roles/invitations/balances | IU | IU (7 admin views) | `/admin/*` · admin | admin tests partial |
| Audit history | IU (paginated) | IU (`audit_repository`) | `/admin/audit` | — |
| Global search | IU | IU | `/search` | — |
| Support chat | IU | **M** | `/support/chat` | — |
| Free/Premium entitlements, quotas, limits | IV [fake] | IU (entitlement + subscription repos) | `/billing/entitlements`, `UsageCounter` | web_android_shared_data [fake] |
| Purchase / restore / lifecycle | n/a (PS) | IU (`in_app_purchase`, restore ×3 refs) | `/billing/play/verify`, `/rtdn` | mock tokens only; **BC [live]**; S2/S3 |
| Doppelmayr lifetime Premium + web & Android | **M provisioning (S5)**; boundary code IV | n/a | `Organization.lifetimeGrant/webEnabled` | persisted values in prod unknown |
| Web access denial for public orgs | IV (every authenticated request) | n/a | `lib/auth/webAccess.ts` | web_access_boundary [fake] |
| Design system / theming | Web locked (worktree adds `components/ds`) | IU (Material 3 design tokens, dark mode) | — | ds_* tests |
| App Links / deep links | n/a | **M** | — | S14 |

Android functionality with no Web counterpart is intentionally platform-specific (in-app purchase, biometrics/local_auth, camera capture, push-style notifications).

## 5. Release blockers
**P0**
1. Commit/branch/push the uncommitted work of both repos (S1) after the conflict review in §7.
2. RTDN fail-open + query-string secret (S2).
3. Doppelmayr entitlement provisioning script + verification (S5).
4. Account-deletion completeness, honest failure reporting, retention policy (S6).
5. Real-Cloudinary private-storage verification (S9) — required before receipts/travel documents are enabled for anyone.
**P1** S3, S4 live Play verification (licence-tester device), S7, S8 scheduler, S10, S11 live email, S12 isolation matrix, S13 index rollout, S14 App Links, S15/S16 store compliance values, S17 monitoring/backups, Android gaps (AI generation, shared dashboards, reports, support chat, travel document picker).
**P2** S18, legacy `client/`+`server/` retirement, Web document-editing UI (needs D1), client idempotency keys, bundle-size/perf audit.

## 6. Dependency-ordered plan
1. **Secure the source** (integration branches, commits, CI) — Phase 1.
2. P0 security: RTDN, deletion, Doppelmayr provisioning script (dry-run first), dev-route exclusion.
3. Live-provider gates in staging, one at a time: Cloudinary → Gemini → SMTP/IMAP → Play (licence-tester).
4. Backend parity gaps needed by Android (none require schema change except any new reports/export endpoints).
5. Flutter parity: travel documents, AI generation, shared dashboards/reports, support chat, App Links; each with view-model + widget tests and one live-backend integration run.
6. Whole-system verification: per-route tenant matrix, physical-device pass, load/index check on a restored staging copy.
7. Play launch: signing, Data-safety, deletion URL, closed testing, production rollout.

## 7. Smallest next slice
**"Secure the source."** Acceptance criteria: (a) both repos have an integration branch that contains every file of §2.2 in logically grouped commits, pushed to a remote branch (not `main`); (b) nothing was lost — `git diff` of integration branch vs the pre-commit working tree is empty and the 4 other worktrees/branches were inspected and either merged, recorded or explicitly abandoned; (c) the two docs modified in the main checkout are reconciled with the worktree's versions; (d) a `web/package.json` `test` script plus `scripts/test-env.example` (names only) and a GitHub Actions workflow run lint, `tsc`, build and the full backend suite (fake providers, service MongoDB) and Flutter analyze/test on every push; (e) CI is green with totals equal to 681 (backend) and 442 pass/13 skipped (Flutter) or a documented reason for any difference; (f) no assertion changed.

## 8. Owner decisions vs autonomous work
**Owner decisions:** D1 who may edit travel documents after submission (and whether Web/Android get editing UI); D2 data-retention policy for expenses/travel/audit on account/org deletion; D3 allow re-conversion of a trip after its expense is deleted; D4 Premium price/plan limits and subscription product ids; D5 which environment (Netlify site/URL) is the release target and whether a staging site exists; D6 permission to read the deploy dashboard/commit (not done here); D7 archive/remove legacy `client/`+`server/`; D8 support/legal contact details and the canonical production domain; D9 whether Android shows Web-only admin features or links out; D10 approval to create the integration branches/CI.
**Autonomous (team):** everything in §6 steps 1, 2 (except D2 policy), 4, 5, 6 and all test/CI work.

## 9. Configuration NAMES by release gate (no values)
* **Local/CI (fake providers):** `MONGODB_URI`, `TEST_URL`, `JWT_SECRET`, `ENCRYPTION_SECRET`, `CRON_SECRET`, `DEV_SEED_SECRET`, `ALLOW_DEV_SEED`, `RECEIPT_CLEANUP_APPLY`, `OCR_DEADLINE_MS`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_BASE`, `CLOUDINARY_DELIVERY_BASE`, `GEMINI_API_KEY`, `GEMINI_API_BASE`, `OLLAMA_URL`, `OLLAMA_MODEL`, `TRAVEL_FAILPOINTS`, `TRAVEL_CONVERSION_WAIT_MS`, `NEXT_DIST_DIR`, `FAKE_PROVIDERS_PORT`, `DD_SERVER_LOG`.
* **Staging gate:** `CLOUDINARY_URL` or the three Cloudinary names, `CLOUDINARY_UPLOAD_PRESET`, `CLOUDINARY_SIGNED_PRESET`, `CLOUDINARY_STAGING_CONFIRM`, `GEMINI_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, `IMAP_USER`, `IMAP_PASS`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_WEBHOOK_SECRET`.
* **Play/billing gate:** `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_PREMIUM_PRODUCT_ID`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (or `_EMAIL` + `_KEY`), `GOOGLE_PLAY_RTDN_SECRET` (must become mandatory), plus Pub/Sub push-auth audience/service-account (names to be defined in S2 fix).
* **Production gate:** `MONGODB_URI`, `JWT_SECRET`, `ENCRYPTION_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `REVIEWER_PASSWORD`, `REVIEWER_STATIC_OTP` (Play review only; remove afterwards), `SETUP_SECRET`, `REFRESH_REUSE_GRACE_MS`; and **must be absent**: `ALLOW_DEV_SEED`, `DEV_SEED_SECRET`, `TRAVEL_FAILPOINTS`, `TRAVEL_CONVERSION_WAIT_MS`.
* **Android build (compile-time/defines and signing):** `SUPPORT_EMAIL` (dart-define), API base URL define, `key.properties` entries (store/key alias/passwords — file ignored), `DD_E2E_URL` (integration tests only).

## 10. CI and integration proposal (Task E)
**Branches:** Web `integration/phase0-recovery` from `main` (d6c89b3); Flutter `integration/phase0-recovery` from 970154e. Never force-push; `main` untouched until CI is green and the owner approves (D10).
**Order of commits (Web):** 1 models + indexes · 2 auth/entitlements/web boundary · 3 uploads/receipts/OCR/cleanup · 4 mail/CRM/expenses libs · 5 Travel Slices 1–5 (+ tests) · 6 design system · 7 pages/clients edits · 8 tests helpers + docs. Each commit must build (`tsc`) — if an inter-dependency makes that impossible, merge groups 1–5 as one commit rather than editing code to fit.
**Before committing (safe, read-only):** copy the worktree directory to a backup path (`cp -a`) and record `git status --porcelain=v1 -z | sha256sum`.
**Reproducible commands (what CI should run; Web):**
```
cd web && npm ci --legacy-peer-deps && npx tsc --noEmit && npx next lint && NEXT_DIST_DIR=.next-ci npx next build
# service container: mongo:7 (standalone); then
node tests/helpers/fakeProviders.js & npx next dev -p 3100 & # env names per §9, throwaway DB name per run
for f in tests/*.test.js; do node $f; done   # z_final_log_secret_scan last
```
**Flutter:** `flutter pub get && flutter analyze && flutter test` (expected 442 pass, 13 skipped, 0 fail).
**Expected totals today:** backend 681 pass/0 fail/0 skip over 50 files; Flutter 442/13/0. Add a CI check that fails if the skipped count rises.
**Stop conditions:** integration was **not** attempted: it requires committing ~230 + ~136 paths and deciding D10 and the other-worktree question.

## 11. Single recommended next task
**Secure the source (§7)**: back up the worktree and Flutter working tree, inspect the four other worktrees/branches, then create the two integration branches with grouped commits, push them (not to `main`), and add the CI workflows — with no code or assertion changes.
