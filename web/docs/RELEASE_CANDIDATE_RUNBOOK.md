# Release-candidate runbook (staging-first)

Evidence categories are never mixed: **AUTO** (local automated, fake providers) · **DISPOSABLE** (throw-away local MongoDB) · **BROWSER** (local browser against a seeded local build) · **DEVICE** (physical Android) · **LIVE-STAGING** (real providers on an isolated staging site) · **PROD**. Only LIVE-STAGING/PROD evidence can close a provider or release gate.

## A. Operator matrix — exact staging test per provider (status as of 2026-10-17: nothing here has a LIVE-STAGING result)
| # | Provider / control | Prerequisites (variable NAMES only) | Exact staging test | Pass evidence | Status | Reason |
|---|---|---|---|---|---|---|
| 1 | Netlify provenance + preview isolation | staging site, `DD_DEPLOY_CONTEXT=staging`, `DD_BUILD_SHA` set by the build | `node web/scripts/check-release-env.js --context=staging` in the staging env; `node web/scripts/smoke-release.js --url=https://<staging> --expect-commit=<sha>`; `netlify env:list --context deploy-preview` contains none of the secret names (PROVIDER_VERIFICATION_RUNBOOKS §1); `netlify.toml` keeps previews/branch deploys cancelled until an isolated preview env exists | smoke all PASS incl. "running commit matches"; env list captured by name | NOT RUN | no staging site / Netlify access |
| 2a | SMTP send + safe failure | `SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM` (staging) | RUNBOOKS §2: reset mail for a synthetic user arrives, link has token in `#fragment`, single use; wrong SMTP password -> calm error, no secret/host in response or logs; SPF/DKIM/DMARC headers | receipts + headers + failure behaviour | NOT RUN | no staging SMTP / test mailbox |
| 2b | IMAP ownership + tenant isolation | `IMAP_HOST IMAP_USER IMAP_PASS IMAP_OWNER_ORG_ID` | org A (owner) reads shared mailbox; org B gets 403/empty; `IMAP_OWNER_ORG_ID` unset -> shared mailbox disabled (fail closed); legacy rows backfilled | per-org responses | NOT RUN | no test mailbox |
| 3 | Cloudinary private storage | `CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET PRODUCTION_CLOUDINARY_CLOUD_NAME CLOUDINARY_STAGING_CONFIRM STAGING_APP_URL STAGING_CRON_SECRET` (+ `STAGING_CLEANUP_APPLY=1` only for the delete step) | `node web/scripts/verify-cloudinary-staging.js` (refuses unless every preflight rule passes): signed upload ticket, asset `type=authenticated`, owner/reviewer 200, peer + other tenant 404, `%PDF` + `Content-Disposition`/`nosniff` headers, tampered/missing asset safe error, replacement and deletion | script prints all PASS, redacted | NOT RUN | no staging cloud; script refuses without credentials (verified locally: exit 2, nothing contacted) |
| 4 | Gemini / OCR | `GEMINI_API_KEY`, `GEMINI_OCR_APPROVED=1` (staging key) | `node web/scripts/verify-gemini-ocr.js` (one billable call, synthetic receipt); then force timeout/429/empty/malformed per RUNBOOKS §5; consent notice shown before first scan | PASS output + calm retry behaviour, no quota charge on provider failure | NOT RUN | no staging key; script refuses without approval flag (verified locally) |
| 5 | Google Play + RTDN | `GOOGLE_PLAY_PACKAGE_NAME GOOGLE_PLAY_PREMIUM_PRODUCT_ID GOOGLE_PLAY_RTDN_AUDIENCE GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL` + service account credentials | licence-tester purchase, restore, expiry, cancel, grace/hold through the Play console; Pub/Sub push with OIDC: valid -> 200; wrong audience/SA/unsigned -> 401; replay of the same message -> no second grant; reconciliation corrects a forged state | per-case table with timestamps | NOT RUN | no Play app / licence testers / Pub/Sub (AUTO fakes only: not a purchase) |
| 6 | Scheduler | `STAGING_APP_URL`, `STAGING_CRON_SECRET`, `DD_ALLOW_TARGET=<staging host>` | see section B | counts + statuses printed by `trigger-cron.js`; scheduler run history | NOT RUN | no staging site; no scheduler chosen |
| 7 | Atlas snapshot / PITR restore | owner-approved source, isolated target cluster, access list, change window | restore into the isolated cluster; compare per-collection counts + hashes; run `node web/scripts/preflight-indexes.js` against the restore with `PREFLIGHT_APPROVAL`; record duration | counts, hashes, indexes, duration | NOT RUN | needs owner approval + Atlas access. The synthetic local rehearsal (`scripts/backup-restore-rehearsal.js`, DISPOSABLE PASS) does NOT substitute |

## B. Scheduled jobs: design and staging invocation
Jobs (all authenticate with `Authorization: Bearer <CRON_SECRET>` only; fail closed if unset):
| Job | Route | Cadence | Idempotency |
|---|---|---|---|
| Birthday reminders | `GET /api/cron/birthday` | daily 07:00 UTC | per-contact lease + year marker |
| Urgent announcements | `GET /api/cron/announcements` | every 5 min | per-announcement lease + sent marker |
| Onboarding nudges | `GET /api/cron/onboarding` | daily 09:00 UTC | per-employee lease + weekly marker |
| Receipt cleanup | `POST /api/cron/receipts-cleanup` | **disabled** until Cloudinary staging sign-off | dry-run default |
**Recommended scheduler: Netlify Scheduled Functions** (the site is on Netlify; the secret stays in the site environment, no third party sees it, runs only on published production deploys so staging needs its own site). Alternative for staging rehearsal: run `trigger-cron.js` from an operator shell or a `workflow_dispatch` GitHub Action with the staging secret as an Actions secret (GitHub schedules only run on the default branch, ≥5 min granularity). Do **not** use a free external cron that logs response bodies. Retries: none or 1 (jobs are idempotent but a retry storm helps nobody). Alerting: any non-2xx or no run in 2x cadence -> notify the owner (Netlify function log alert / uptime monitor on a heartbeat).
**Run evidence (staging):**
```bash
STAGING_APP_URL=https://<staging-host> STAGING_CRON_SECRET=<staging secret> DD_ALLOW_TARGET=<staging-host> \
  node web/scripts/trigger-cron.js --repeat=2 --parallel
```
Expect: wrong-secret -> `401` for each job, then `200` with `sent=<n>` for each; the second run and the parallel overlap send 0 for already-claimed items (checked by mailbox receipts, one mail per item). Responses carry **counts only** (contact names/announcement titles were removed from cron responses in Phase 9 so scheduler logs hold no personal data). The script refuses non-https/non-loopback targets, any host in `PRODUCTION_HOSTS`, a missing `DD_ALLOW_TARGET` confirmation, and never echoes the secret or a response body. Never export the production `CRON_SECRET` in the shell used for it.

## C. Release smoke checklist (record PASS/FAIL/BLOCKED/NOT RUN per row, with category)
| Gate | AUTO evidence now | BROWSER (local seeded build) | LIVE-STAGING |
|---|---|---|---|
| Auth/OTP, logout, session revocation, refresh | auth_foundation, passkey_totp (34), refresh/replay suites PASS | sign-in page renders, no console errors | NOT RUN |
| Free / Premium / Lifetime Web gating | web_access_boundary, proxy_behaviour P5 PASS | admin on a lifetime org reaches /dashboard | NOT RUN |
| CRM, expenses + receipt permissions, leave + private medical docs, travel | suites PASS (fake Cloudinary) | /crm /rms /lms /travel(not opened) render without console errors | NOT RUN |
| Invitation acceptance incl. `contractor` + concurrent accepts | E8, E9 PASS | — | NOT RUN |
| Mail, OCR, billing, RTDN | fake providers PASS | /mail renders | NOT RUN (providers) |
| Scheduled jobs | cron_idempotency 9 PASS; `trigger-cron.js` fixture test PASS | — | BLOCKED (no scheduler) |
| `/api/health` deployed-SHA provenance | O1 + smoke script PASS locally | — | NOT RUN |
| Backup/restore, rollback | DISPOSABLE logical restore PASS | — | NOT RUN |
## D. Rollback decision procedure
Trigger: any failed smoke row on a security/auth/entitlement/data path, a rising 5xx rate, or a failed provenance match. Approver: the owner. Record: the SHA being rolled back to (previous green `/api/health` commit), data compatibility (this release adds only additive cron lease fields and no migration, so older code ignores them), the time, the reason. Action: redeploy the previous deploy in Netlify (instant rollback), re-run `smoke-release.js --expect-commit=<previous sha>`, record the outcome. A written plan is not evidence: rollback must be exercised once on staging before launch (NOT RUN).
