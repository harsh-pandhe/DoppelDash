# Phase 11 — Web-first release verification (staging) — 2026-10-16T22:07:55Z

Append-only. Evidence labels: **AUTO** (local automated, fake providers) · **DISPOSABLE** (throw-away local DB) · **LIVE-STAGING** (real hosted staging site, read-only unless stated) · BROWSER · DEVICE · PROD. No physical-phone, emulator or Flutter testing; no production contact. Netlify labels the published deploy "Production" — that is the provider's label; the application context is `staging` (proven by `/api/health`).

## Source and deployment (LIVE-STAGING + git)
- Web `phase-1j-work` HEAD = origin = `90beb19e60265dc1085a3c5f57cd714bb749b93e`; working tree clean at start; PR #1 draft/open.
- `https://doppeldash-staging.netlify.app/api/health` -> `{"status":"ok","commit":"90beb19e6026…","context":"staging"}` (commit equals the branch head; re-read at end of testing, unchanged during it).
- CI on this SHA: run 38968530672 success — 81 files / 1003 tests, 1002 pass, 0 fail, 1 skip (T8; deploy key still absent; the pipeline is NOT zero-skip).

## Local verification on the exact tree (AUTO / DISPOSABLE; real exit codes)
| Command | Result |
|---|---|
| `npm ci --legacy-peer-deps --ignore-scripts` (clean copy, install integrity) | exit 0 |
| `npx tsc --noEmit` | exit 0, 0 errors |
| `npm run lint` | exit 0, 0 errors, 94 advisory warnings |
| `npx next build` | exit 0 |
| `node scripts/ci/run-backend-tests.js` (full suite, disposable MongoDB, fake providers, secret-log scan last) | exit 0 — **81 files / 1003 tests, 1003 pass, 0 fail, 0 skip** (T8 ran: mobile checkout present locally) |
Includes release_scripts, release_ops_scripts (compare-databases), route security, malformed-body, concurrency (invitation, cron leases), scheduler idempotency, storage, billing/RTDN, DB-outage (O1–O7), proxy and XLSX suites.

## Staging smoke (LIVE-STAGING, read-only) — `scripts/smoke-release.js --expect-commit=<full sha>`
Six runs over ~1 h: 4 x 25/25 PASS; 2 runs had exactly one failing check each, always `/api/dev/seed refuses an unauthenticated POST — status undefined` (an exception, no HTTP answer). Investigation: 17/17 curl POSTs to /api/dev/seed and /api/dev/migrate returned the correct 403 (~1 s each); a 40-request Node loop produced 39 correct answers and 1 `TypeError: ETIMEDOUT` (TCP-level timeout from this machine). Classified **transient network error, not an application defect** (the server never returned a wrong answer). Script improved: network exceptions are retried up to 3 times and reported ("N transient network retries"); HTTP statuses are never retried or masked; a dead target still fails (verified: 127.0.0.1:9 -> exit 1). Final run after the change: 25/25 PASS, exit 0.
Additional unauthenticated negative probes (LIVE-STAGING; none sends mail or writes): invitation verify/accept junk token -> 404 generic; verify-otp junk -> 401 "Session expired"; refresh junk -> 401; password-reset check -> 404, confirm weak password -> 400; login unknown user -> 401 generic (**proves the staging app reached its database**: before the env fix the same call returned a bare 500); passkey login unknown -> 404 generic; RTDN POST unauthenticated -> 503 `rtdn_not_configured` (fails closed: Play variables not configured on staging); shared-dashboard junk -> 404; CRM id without session -> 401; support chat empty -> 400; cron without/with wrong bearer -> 401 (x3). No response contained a stack, connection string, internal host or secret.

## Environment (names only; LIVE-STAGING runtime evidence)
`DD_DEPLOY_CONTEXT=staging` (health), build SHA embedded (health), database reachable (login 401 path). Cannot be proven from this machine, and are therefore **NOT RUN**: `check-release-env.js --context=staging` (needs the variables in the shell of the environment itself — a hosted Netlify environment cannot be inspected from here and fake exports are not allowed), isolation of `MONGODB_URI` to the staging database (Atlas project/database names are visible only to the owner), JWT/encryption/CRON secret lengths, SMTP/Cloudinary/Gemini presence at runtime. Owner action: run the checker where the variables exist (Netlify: `netlify env:list` names + scopes Builds/Functions/Runtime) or confirm in the dashboard.

## Scheduler — three distinct things
1. **Registration: PASS (owner-reported + dashboard screenshot).** Netlify Functions lists cron-announcements (next 3:05 AM local), cron-birthday and cron-onboarding as Scheduled on the published deploy of `phase-1j-work`; cadences `*/5 * * * *`, `0 7 * * *`, `0 9 * * *` (UTC) match the files (R5).
2. **Manual invocation: BLOCKED.** `STAGING_CRON_SECRET` is not in this shell (checked by name); the secret was never requested in chat. Unauthenticated behaviour verified live instead (401 without/with a wrong bearer). Operator command: `trigger-cron.js --repeat=2 --parallel` as documented.
3. **Actual scheduled execution: NOT RUN / no evidence.** Needs the Netlify function log (`[cron:announcements] status=200 sent=0`); no Netlify CLI/session available here. Scheduled jobs remain NON-OPERATIONAL in the release record.

## Functional journeys
- **Authenticated Web journeys on staging: BLOCKED.** They require creating staging accounts and signing in with passwords and an OTP delivered to a mailbox; account creation and password entry are not actions this agent performs, and no mailbox is readable here. Covered instead by AUTO/BROWSER suites (local): registration/OTP/login/logout/reset, invitations incl. replay + contractor + concurrent accepts, role boundaries, Free/Premium/Lifetime gating (proxy_behaviour P5, web_access_boundary), CRM, expenses + receipt permissions, leave + private medical docs, travel, audit, session revocation/refresh (all PASS in the 1003). Owner-run live path: sign in yourself in the Browser pane, then ask for the walkthrough.
- Not run: narrow-layout/back-forward checks on staging.

## Providers
| Gate | Status | Evidence / reason |
|---|---|---|
| SMTP send, OTP/reset/invite links, invalid-credential failure | NOT RUN (LIVE) | no mailbox access; AUTO policy/pinning/link tests PASS |
| Cloudinary private storage | NOT RUN (LIVE) | script refuses without `CLOUDINARY_STAGING_CONFIRM`/`PRODUCTION_CLOUDINARY_CLOUD_NAME`/staging URL+secret in this shell (verified exit 2, nothing contacted); AUTO fake suites PASS |
| Gemini/OCR | NOT RUN (LIVE) | `GEMINI_OCR_APPROVED=1` and key absent in this shell; no billable call made; AUTO timeout/429/malformed/empty/consent tests PASS |
| Google Play / RTDN | BLOCKED | staging fails closed (503 `rtdn_not_configured`); Play app, licence testers, Pub/Sub OIDC are owner actions; AUTO auth/replay/reconciliation tests PASS |
| IMAP / Outlook | NOT RUN | not configured on staging; AUTO ownership + webhook tests PASS |
| Atlas restore | NOT RUN | needs owner approval and isolated target (`ATLAS_RESTORE_PLAN.md`); compare-databases R6 AUTO PASS |
| Retention D-02/D-03 | OPEN | 8 decisions in `OWNER_APPROVAL_SHEET.md`; nothing implemented |

## Fix this phase
Smoke script: retries only network exceptions (3x), reports retries, never retries/masks HTTP statuses. No product defects found on the live site beyond the Phase-10/11 setup problems already fixed (build-time MONGODB_URI import, publish directory, env scope).

## Remaining owner actions (minimal, ordered)
1. In your own shell run the documented `trigger-cron.js` command with the staging secret and paste the output (counts only); and read the `cron-announcements` function log for a real scheduled `status=200` line.
2. Confirm in Netlify that SMTP/Cloudinary/Gemini variables have scopes Builds+Functions+Runtime (or run `check-release-env.js --context=staging` where they are set).
3. Create staging accounts yourself (admin + invited manager + employee) with plus-addressed staging mailbox; then the live auth/invitation/journey checks can proceed.
4. Provide the Cloudinary staging confirmations to run the storage script; `GEMINI_OCR_APPROVED=1` only if you approve one billable call.
5. T8 deploy key, branch rulesets, Atlas restore approval, D-02/D-03 answers (unchanged).
