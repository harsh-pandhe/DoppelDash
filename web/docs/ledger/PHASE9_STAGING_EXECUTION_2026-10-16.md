# Phase 9 — Owner actions and staging execution (started 2026-10-16/17)

Append-only. Evidence labels: AUTO · DISPOSABLE · BROWSER (local seeded build in the built-in browser) · no LIVE-STAGING · no PROD. Start: Web `c979920` (CI 38947065085: 81 files / 997 tests, 996 pass, 1 T8 skip), Flutter `6d8bb3f` (unchanged, untracked `docs/design/screenshots/` preserved). PR #1 draft/open; `main` and `integration/phase0-recovery` untouched; nothing deployed; no real data touched.

## Local defects fixed (with regression proof)
1. **Cron responses leaked personal data into scheduler logs**: `/api/cron/birthday` returned contact names and `/api/cron/announcements` returned urgent-announcement titles in the body (a scheduler such as GitHub Actions or an external cron service stores these). Now `{ sent }` only. Regression: `cron_idempotency` J2/J3 (response keys are only `sent` and the fixed empty-run `message`; exactly-once now proven by summing `sent` across 6 overlapping runs with other due items isolated). 5x repeat green.
2. **Missing doc target**: `scripts/smoke-release.js` and earlier docs cite `docs/RELEASE_CANDIDATE_RUNBOOK.md`, which did not exist. Created (operator matrix, smoke checklist, scheduler design, rollback procedure).
3. **Scheduler had no executable staging tool**: added `scripts/trigger-cron.js` (negative-control wrong secret, header-only secret, https/loopback only, host confirmation, production-host refusal, counts only, `receipts-cleanup` excluded). Regression: `release_scripts` R4 against a local fixture server (8 refusal cases make zero requests; success run prints counts only, never the secret or a body, secret never in a URL).

## A proxy (Next 16)
`proxy.ts` is the renamed middleware with unchanged logic; Node runtime. `proxy_behaviour` P1–P5 run against the real dev server (HTTP): public pages, redirects with `redirect=`, API 401 JSON, invalid cookie/bearer, `.json` suffix, legacy token bridge, and Web gating (Free and Premium-without-web redirected to `/web-access-restricted` on `/dashboard`,`/lms`,`/rms`,`/travel`, Lifetime allowed, repeated requests identical). Gating is by persisted `webEnabled`/entitlement fields (web_access_boundary W3–W5 incl. "plan alone never grants web"; no org-name checks, guarded by a source scan). Full auth/session/route suites pass.

## B xlsx (unchanged position, reconfirmed)
Audit from the current lockfile: 1 advisory (`xlsx` 0.18.5, high, `fixAvailable: false`, `latest` = 0.18.5). Reachability: only `lib/export.ts` (write path); guards V4 + `xlsx_export_hardening` X1/X2 (hostile cell text stays inert text; no `<f>`/links in the produced file). `exceljs` rejected again (adds 3 advisories). **Advisory remains OPEN**; residual risk = parsing an untrusted workbook, which the app never does.

## C React 19 upgrade — DONE (bounded, tested)
Before: Next 16.4.2 + React 18.3.1 (deprecated warning). Compatibility checked first: 110 lockfile peer ranges examined; the only ones not naming 19 are `>=16.8` ranges (dnd-kit, floating-ui) which allow it. Upgrade: `react`/`react-dom` 19.3.1, `@types/react(-dom)` 19.3.x. Results: tsc 0 errors, lint 0 errors, `next build` OK and the React-18 deprecation warning is gone, audit unchanged (1, xlsx), full backend suite green, `dependency_hardening` V6 (single React copy, same major). **BROWSER evidence (local seeded build, admin session of a lifetime-entitled org): sign-in, /dashboard (Radix tour dialog opens/closes), /crm, /rms, /analytics (charts), /mail (editor), /admin/users, /lms render with zero console errors.** Passkey: SimpleWebAuthn 14.0.3 server/browser unchanged and covered by passkey_totp_security (34) + web_auth_pages (14) in the full run. Not covered: real-device WebAuthn ceremony, drag-and-drop interactions (dnd-kit) by hand, and every page — manual pass on staging is listed in the runbook. Versions now: next 16.4.2, react/react-dom 19.3.1, @simplewebauthn/server 14.0.3, browser 14.0.0, eslint 9.39.5.

## D concurrency / outage
Re-run this phase: invitation concurrent accept (E9), cron leases/overlap/stale/attempt cap (J1–J8), employee data (E7–E9), proxy (P1–P5), xlsx (X1–X2), DB outage O1–O7 (every exported handler wrapped except 8 DB-free ones; invitation, mail-config, email-config, drafts, auth, entitlements, employee data all 503 + `Retry-After`, no internals). See the verification section for counts.

## E CI
T8 exception unchanged (`MOBILE_REPO_DEPLOY_KEY` unset; token files identical on the checked-out ref). `web-ci` runs on pushes to `integration/**` and `phase-*` and on PRs to `integration/**`/`main`. Limitation (accurate): there is **no branch protection or ruleset** on any branch, so a failing run does not block pushes or merges; the Web repo is public (rulesets available), the mobile repo is private on a plan that rejects the rulesets API. Pushes to `phase-*` run with repository secrets (the deploy key, once set); only owners can push. Flutter source unchanged → no Flutter CI.

## 3 Owner approval sheet → `docs/OWNER_APPROVAL_SHEET.md` (8 distinct decisions with recommendation, risk of delay, implementation consequence; provisioning and real-data gates). No decision recorded; semantics unchanged.

## 4–5 Provider and scheduler matrix → `docs/RELEASE_CANDIDATE_RUNBOOK.md` §A/§B. Scripts exercised locally (AUTO, not LIVE): `check-release-env` with an empty environment -> 15 required FAIL, no values printed; `smoke-release` refuses without URL and fails closed on a dead target; `verify-cloudinary-staging` and `verify-gemini-ocr` refuse with exit 2 and "nothing contacted"; `trigger-cron` fixture test PASS. All seven provider rows: NOT RUN (no staging credentials, site, Play app or Atlas access on this machine).

## 6 Real-data gates: Atlas restore NOT RUN (the Phase 7 local rehearsal is DISPOSABLE only); legacy medical inventory validated on synthetic fixtures only (I1–I4 in the suite), NOT RUN on real data and blocked on a successful Atlas restore + owner approval; Doppelmayr provisioning dry-run/apply flags unchanged and not applied.

## 7 Release gates: see `RELEASE_CANDIDATE_RUNBOOK.md` §C (every LIVE-STAGING cell NOT RUN/BLOCKED).
