# Release operations — branch protection, provenance, dependencies, backup/restore, rollback, failure modes (Phase 5G)

Evidence classes used below: **FAKE/DISPOSABLE-VERIFIED** (automated tests on throwaway databases with fake providers) · **DOCUMENTED** (procedure written, not exercised) · **BLOCKED** (needs owner access). Nothing here is production evidence.

## 1. GitHub branch protection (measured 2026-10-16)
| Repo | `main` | `integration/phase0-recovery` | `phase-1j-work` | Rulesets API |
|---|---|---|---|---|
| `harsh-pandhe/DoppelDash` | `protected: false` | `protected: false` | `protected: false` | HTTP 403 "Upgrade to GitHub Pro or make this repository public" (private repo on a plan without rulesets) |
| `harsh-pandhe/DoppelDash-mobile` | not protected | — | not protected | same 403 |
PR #1 is open + **draft** + mergeable; not merged.
**Recommended configuration** (apply with an owner token once the plan allows; nothing was changed here): `main` — require a pull request, ≥1 approving review (dismiss stale), require status checks **`web`** (workflow `web-ci`, job `web`) and, in the mobile repo, **`flutter`** (`flutter-ci`), require branches up to date, block force-push and deletion, include administrators; the same protection pattern for `integration/**`. Command shape: `gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input protection.json` with `required_status_checks.contexts: ["web"]`, `required_pull_request_reviews.required_approving_review_count: 1`, `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false`. Note: both workflows currently run on `push` to `integration/**` and on `workflow_dispatch` — `phase-1j-work` does not match, so it was validated by manual dispatch; do **not** widen the filters just to trigger it. Until protection is possible, enforce by process (no direct pushes to `main`).

## 2. Deployment provenance
`GET /api/health` → `{status, commit, context}` (public, no DB, no secrets). `commit` is embedded at build time from `COMMIT_REF` (Netlify) / `GITHUB_SHA` / `DD_BUILD_SHA` (`next.config.mjs`). Release smoke test: the SHA returned by the production hostname must equal the reviewed commit **and** the Netlify deploy's commit; record deploy id + SHA. Test: `tests/route_gap_closure.test.js` G5. **BLOCKED:** which SHA production is serving today is unknown (no Netlify access).

## 3. Dependency / secret scan (2026-10-16, `npm audit --omit=dev`, web)
48 advisories: 1 critical, 13 high, 33 moderate, 1 low. **No dependency change was made** (upgrades need owner approval and a regression pass).
| Package | Installed → fix | Severity | Exposure in this app | Proposed action |
|---|---|---|---|---|
| `next` | 14.2.35 → 16.4.2 (major) | critical (DoS in Server Components / Image Optimizer, request smuggling in rewrites, CSP-nonce XSS, …) | App Router + Netlify runtime; no `rewrites` and no nonce CSP in use; image optimizer limited to 3 hosts | plan a Next 15/16 upgrade branch; interim: keep `images.remotePatterns` minimal, rate-limit at the edge |
| `nodemailer` | ^8.0.7 → 10.1.1 | high (raw-option file read/SSRF, address-list DoS, **process-global DNS cache reuses TLS `servername` across transports — cross-tenant SMTP credential disclosure**, header injection) | multi-tenant SMTP (org + per-user mailboxes) — the cross-transport issue matters; the app never passes user `raw`/`list` options | **upgrade to ≥10.1.1 first** (small API surface), then run the mail test suites |
| `xlsx` (SheetJS) | 0.18.5, **no fix on npm** | high (prototype pollution, ReDoS) | used only if untrusted spreadsheets are parsed — confirm usage; exports only are low risk | replace with the vendor CDN build or `exceljs`; or remove |
| `imapflow`, `mailparser` | direct, fixes available | high | parse mail from tenant IMAP mailboxes (untrusted content) | upgrade with the nodemailer pass |
| `@tiptap/core` family, `prosemirror-view`, `linkify-it`, `html-to-text`, `postcss`, `nanoid`, `ip-address`, `source-map-js`, `deepmerge-ts` | transitive | high (mostly ReDoS / DoS) | editor and HTML-to-text on user content | `npm audit fix` where non-breaking, else with the Next upgrade |
Secret scan: pattern scan of all tracked files (AWS/Slack/GitHub/Google/Stripe keys, private keys, Atlas URIs with credentials) found only **fake credentials inside test fixtures** (`tests/preview_safety.test.js`, `tests/staging_harness.test.js`); CI `z_final_log_secret_scan` scans the server log. No secret in the staged diff.

## 4. Index pre-flight (read-only) — `web/scripts/preflight-indexes.js`
For every model: declared-but-missing indexes, and for every UNIQUE index the existing duplicate groups that would make a build fail with E11000 (counts only). Exit 0 clean / 2 blocking duplicates. Run it **before** any deploy that adds a unique index, against a restored copy first, then production (owner-approved: `PREFLIGHT_APPROVAL="<approver>:<ticket>" … --confirm-db=<name>`). Result on the disposable test DB: all models covered, 0 blocking duplicates (`tests/release_ops_scripts.test.js` R2). Production result: **NOT RUN** (no access).

## 5. Backup / restore rehearsal
* Logical rehearsal (disposable only): `node web/scripts/backup-restore-rehearsal.js` — dumps every collection + index specs (EJSON), restores into `<db>_restored`, verifies counts + content hashes + index counts, drops the copy. **VERIFIED on the disposable database** (`tests/release_ops_scripts.test.js` R3; refuses non-loopback/non-test URIs, R4).
* Production backups: **DOCUMENTED, NOT PROVEN.** Owner must (a) confirm Atlas backup tier/retention and enable continuous backup if affordable, (b) restore the latest snapshot into a **new cluster/database**, (c) run `preflight-indexes.js` and a smoke test (`/api/health`, sign-in as a synthetic user) against it, (d) record RPO/RTO. A rollback plan is not "proven" until (b)–(d) are done.

## 6. Rollback
Application: Netlify → Deploys → publish the previous successful deploy (atomic); verify with `/api/health` that `commit` changed back. Database: additive changes only (new optional fields: `birthdayGreetingYear`; no destructive migration shipped); a deploy that adds a unique index must pass §4 first. Provider: cron jobs are claim-based — rolling back code leaves claims valid. **DOCUMENTED, not exercised on Netlify.**

## 7. Failure-mode matrix (what is evidenced)
| Failure | Expected behaviour | Evidence |
|---|---|---|
| Malformed / hostile request bodies | 4xx, nothing mutated, no internals | `tests/malformed_input_sweep.test.js` (41 routes × 4 shapes; 40+ routes returned 500 before) |
| Duplicate / replayed submissions | one effect | expenses/travel idempotency tests; cron claims (`cron_idempotency` J2–J4); RTDN dedupe (`billing_rtdn`) |
| Interrupted upload / abandoned file | cleanup-safe, never deletes referenced files | `receipt_cleanup*`, `leave_medical_docs` C1–C10 |
| Partial deletion | truthful status, retryable | `account_deletion*`, leave-document deletion C5–C10 |
| Provider timeout / error (storage, OCR, SMTP) | calm error, no leak, no false success | `receipt_ocr_vertical`, `leave_medical_docs` D3/C4, mail tests |
| Expired / revoked session | 401 → refresh → sign-in screen | auth tests; phone: Phase 4C F2 (DEVICE-VERIFIED, QA build) |
| Database unavailable | generic 500 from routes; `/api/health` still answers; rate-limit/chat paths fail closed | support-chat tests only — **no systematic DB-outage test for every route (gap)** |
| Overlapping scheduled runs | exactly-once | `cron_idempotency` |
| SSRF via user-supplied SMTP host | refused | `mail_smtp_policy` |

## 8. API ↔ Web ↔ Android permission reconciliation
Expense review stages: `lib/expenses/reviewPolicy.ts` (Web) = server (`tests/expense_approval_policy.test.js` P5) = Android (`test/domain/expense_rules_test.dart`). Employee records: Web/Android only call `/api/employees/me` and `/directory`; the previously open `/api/employees/[id]` is now owner/manager/admin only (`tests/employee_record_security.test.js`). Leave documents: authenticated proxy on every read; Android shows documents to owner/reviewers only (Phase 1J). No client-side check is relied on; every rule above is asserted against the real route.
