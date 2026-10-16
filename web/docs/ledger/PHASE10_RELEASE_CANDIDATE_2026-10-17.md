# Phase 10 — Release candidate and operational closure (2026-10-17)

Append-only. Evidence labels: AUTO · DISPOSABLE · BROWSER · no LIVE-STAGING · no PROD. Start (re-verified): Web `9903a97` = origin, clean; CI 38952026609 success (81 files / 999 tests, 998 pass, 1 T8 skip); Flutter `6d8bb3f` = origin, only the untracked `docs/design/screenshots/` (preserved); PR #1 draft/open; no branch protected (`main`, `phase-1j-work`, `integration/phase0-recovery`); Actions secrets list empty. Staging credentials by name: **none** of MONGODB_URI / CLOUDINARY_* / SMTP_* / GEMINI_* / NETLIFY_* / STAGING_* / GOOGLE_PLAY_* / IMAP_* exist in this environment, so every live gate is BLOCKED/NOT RUN. Nothing deployed; `main` and `integration/phase0-recovery` untouched.

## Defects fixed
1. **XLSX export could crash or corrupt on real data** (found by feeding hostile/unusual values through the real writer): a cell over 32767 characters made `XLSX.write` **throw** ("Text length must not exceed 32767 characters"), failing the whole export (any long expense reason/travel purpose); XML-illegal control characters and lone surrogates would produce a malformed file. Fix in `lib/xlsxSheet.ts`: strip illegal control characters, replace lone surrogates, truncate to 32767 with an ellipsis, Dates -> ISO text, objects/null/undefined/NaN/Infinity -> empty. Regression: `xlsx_export_hardening` X3 writes the real file and re-reads it (also checks no formula element). 
2. **No Atlas-restore verification tool**: added `scripts/compare-databases.js` (read-only; counts, content hash, indexes per collection; approval variable; typed database-name confirmations; refuses identical source/restore; prints no content or URI). Regression: `release_ops_scripts` R6 (refusals, MATCH, tampered content, missing/extra collection, count + index drift, `--exclude`).
3. **Scheduler was documentation only**: chose Netlify Scheduled Functions and implemented `netlify/functions/cron-{birthday,announcements,onboarding}.mjs` + `netlify/lib/runCronJob.mjs` (fail closed, header-only secret, counts-only log). Regression: `release_scripts` R5 (7 unsafe configurations make zero requests, bearer header only, log has no secret/name, cadences `0 7 * * *`, `*/5 * * * *`, `0 9 * * *`). **This is AUTO evidence only; the scheduler is NOT operational** until a staging site executes it.

## xlsx
Audit from the current lockfile: 1 advisory — `xlsx` 0.18.5, high, `fixAvailable:false`, npm `latest` still 0.18.5. Only consumer: `lib/export.ts` -> `lib/xlsxSheet.ts` (write path); guards V4 (single importer, no read call, no spreadsheet MIME accepted) and X1–X3 on real written files. **Not fixed; contained.** Residual risk: parsing an untrusted workbook, which the app never does. Decision point: replace when a patched SheetJS build or an `exceljs` release with a clean audit exists (exceljs 4.4.0 adds 3 advisories — re-check each phase); acceptance tests = X1–X3.

## Framework / auth
Installed: Next 16.4.2, React/react-dom 19.3.1, @simplewebauthn/server 14.0.3 (+browser 14.0.0), ESLint 9.39.5. `proxy.ts` is exercised through the real Next dev server by `proxy_behaviour` P1–P5 (HTTP, cookies, redirects, Free/Premium-without-web denial, Lifetime allow) and the auth suites (passkey_totp_security, web_auth_pages, auth_foundation, refresh/replay); full results below. Concurrency/outage families re-run: invitation concurrent accept (E9), employee data (E7–E9), cron leases (J1–J8, 5x), DB outage O1–O7. No new gap found there, so no new tests were added for them.

## CI integrity
T8 skip unchanged (`MOBILE_REPO_DEPLOY_KEY` absent; token files identical on the workflow's ref). `phase-*` push trigger present (verified by run 38947065085/38952026609 starting on push). **Pipeline does not have zero skips: T8 is skipped in CI (998 pass + 1 skip).** No branch protection: failing CI does not block merges. Setup commands: `web/docs/CI.md`.

## Provider / scheduler / Atlas matrix (all verified against current script behaviour; none LIVE)
| Gate | Result | Evidence type / reason | Next action |
|---|---|---|---|
| 1 Netlify provenance + preview isolation | NOT RUN | AUTO only; no site access | run runbook §A row 1 on a staging site |
| 2 SMTP send/safe failure | NOT RUN | AUTO policy tests; no test mailbox | provide staging SMTP + mailbox |
| 3 IMAP ownership/tenant | NOT RUN | AUTO binding tests | test mailbox, `IMAP_OWNER_ORG_ID`, backfill |
| 4 Cloudinary private storage | NOT RUN | script refuses without creds (verified, exit 2); AUTO fakes | isolated staging cloud |
| 5 Gemini/OCR | NOT RUN | script refuses without key/approval (verified); AUTO fakes | staging key + `GEMINI_OCR_APPROVED=1` |
| 6 Google Play + RTDN | NOT RUN | AUTO fakes (not a purchase) | Play app, licence testers, Pub/Sub OIDC |
| 7 Scheduler execution/overlap/failure/retry | BLOCKED | functions + trigger tool AUTO-tested; no staging site | owner setup steps in SCHEDULED_JOBS.md |
| 8 Atlas snapshot/PITR restore | NOT RUN | tooling DISPOSABLE-tested (rehearsal script, compare-databases R6); no Atlas access | `ATLAS_RESTORE_PLAN.md` after owner approval |

## D-02 / D-03
Single 8-row table with current behaviour, recommendation, risk if delayed, code/data implications and the approval value needed: `docs/OWNER_APPROVAL_SHEET.md`. **No approval recorded; no semantics changed.** Baseline recommendation unchanged (no ordinary hard-delete of paid/pending-admin claims; audited void/correction keeping amount + receipt; accountant-confirmed retention; disband/deletion honour retained records; pseudonymise deleted identities while keeping audit integrity).

## Real-data gates
Atlas restore: NOT RUN (plan + tool ready). Legacy medical inventory: synthetic fixtures only (I1–I4: duplicates, missing, orphan, already-private, cross-tenant, unsupported ext, read-only, redacted); blocked on a PASSED Atlas restore + owner approval, then run on the restored copy. Migration: separate approval. Doppelmayr: dry-run checklist added to `DOPPELMAYR_ENTITLEMENT_PROVISIONING.md`; not applied.

## Release smoke / rollback
`docs/RELEASE_CANDIDATE_RUNBOOK.md` §C/§D (categories kept separate). Rollback: written only — NOT exercised.

## Remaining launch blockers
1. P0 live provider verification (all 7) and a running staging scheduler. 2. P0 D-02/D-03 approvals; Doppelmayr provisioning. 3. P0 Atlas restore rehearsal then legacy inventory. 4. P1 T8 key + branch rulesets. 5. P1 xlsx advisory open; rollback rehearsal.
