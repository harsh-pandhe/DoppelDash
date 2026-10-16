# Phase 6 — Release closure and controlled staging preparation (2026-10-16)

Append-only. Evidence labels: AUTO (local automated, fake providers), DISPOSABLE (throw-away MongoDB), LIVE-STAGING / PROD (none performed). No production access, deploy, migration, provisioning, deletion or legacy inventory was performed. PR #1 untouched; `main` and `integration/phase0-recovery` untouched.

## 6A Baseline
Start: Web `292f216` (code `d8722e1`, CI 38826510693: 76 files / 967 tests, 966 pass, 1 skip = T8). Flutter `6d8bb3f` (594 pass / 20 live-skipped), unchanged this phase. Final Web CI URL and SHA are recorded in the closure checklist row once dispatched.
Local full run on the final tree (AUTO, T8 ran because the mobile checkout was present): **79 files / 985 tests, 985 pass, 0 fail, 0 skip**. In CI without the deploy key expect 984 pass + 1 skip (T8); baseline.json = 79 / 985 / 1 allowed skip.
Repeat runs (5x each, all green): cron_idempotency, db_outage_matrix, mail_smtp_policy, employee_record_security, release_scripts, dependency_hardening.

### Enabling T8 (owner action; not done here)
1. `ssh-keygen -t ed25519 -f dd_mobile_ci -N ""` (local, never commit).
2. Mobile repo -> Settings -> Deploy keys -> add `dd_mobile_ci.pub`, read-only.
3. Web repo -> Settings -> Secrets -> Actions -> `MOBILE_REPO_DEPLOY_KEY` = private key; delete the local key files.
4. Re-run `web-ci`; confirm T8 passes (0 skips). Note the workflow checks out mobile ref `integration/phase0-recovery`; change it to the branch holding `tool/design/tokens.json` if that differs. Only after a green run remove the `allowedSkips` entry in `scripts/ci/baseline.json`.
Branch protection / rulesets: not changed (see RELEASE_OPERATIONS §1 for required checks).

## 6B Dependency remediation (AUTO)
Before: 48 advisories (1 critical, 13 high, 33 moderate, 1 low). After: **4** (1 low, 1 moderate, 2 high).
Changes: nodemailer 8 -> 10.1.1, mailparser/imapflow bumped, tiptap family 3.32.0, Next 14.2.35 -> 15.5.28 (React 18 retained; async `params` migration on 35 handlers + 3 pages; config `headers()` split so private-file CSP is not overridden), mongoose pinned 9.7.2 (lowest fixed; 9.11 produced 31 typing errors), transitive fixes via `npm audit fix`. Verified: tsc 0 errors, lint 0 errors, `next build` OK, full suite green.
Unresolved:
| Package | Sev | Reachability | Decision |
|---|---|---|---|
| `next` / `postcss` (bundled) | moderate / high | postcss stringify/sourcemap advisories require attacker-controlled CSS at build/runtime; app compiles only its own CSS | fix = Next 16 (major). OWNER DECISION: schedule a Next 16 pass |
| `xlsx` 0.18.5 | high | write/export only, no untrusted spreadsheet parsing | no npm fix; OWNER: replace with `exceljs` or vendor build |
| `@simplewebauthn/server` | low | needs major 14 | OWNER: schedule with passkey regression |
Bug found by the stricter types and fixed: invitation of an employee type `contractor` (offered by the invite dialog) failed on acceptance (Employee enum is `contract`). Regression: employee_record_security E8.

## 6C Runtime / reliability (AUTO + DISPOSABLE)
- DB outage: `lib/http/dbGuard.ts` wraps 91 route files; connectivity errors -> 503 `service_unavailable` + `Retry-After`, no stale privilege, no 500 leakage. tests/db_outage_matrix (with negative control). Not wrapped: routes without DB access.
- Scheduled jobs: `lib/cron/claim.ts` lease claims (atomic conditional `$inc`), overlap blocked, expired-lease recovery, daily attempt cap. 9 tests. Scheduler stays BLOCKED (SCHEDULED_JOBS.md).
- SMTP: `resolvePublicSmtpTarget` resolves once, pins IP, sets TLS servername -> DNS rebinding closed; errors don't leak credentials/internal addresses (mail_smtp_policy S7).
- Employee privacy: admin user-detail response no longer includes the bank blob (E7); allowlist updates reject dotted paths/operators (existing).
- Outlook webhook fail-closed and `IMAP_OWNER_ORG_ID`-unset behaviour: covered by Phase 5 tests, unchanged and still green.

## 6D Provider staging
Netlify provenance, SMTP, Cloudinary, Gemini/OCR, Google Play/RTDN, scheduled jobs: **NOT RUN / BLOCKED** — no authorised staging access. Fakes prove nothing about live integration. Owner actions per PROVIDER_VERIFICATION_RUNBOOKS.md.

## 6E Legacy medical migration
Read-only inventory validated on synthetic fixtures only (AUTO). NOT RUN on any real database; requires approval vars + verified Atlas backup + restore rehearsal. Rollback and post-migration access checks per LEGACY_MEDICAL_MIGRATION.md.

## 6F Retention (no owner decision guessed)
| ID | Status | Recommendation (not applied) |
|---|---|---|
| D-02 account/org deletion | OPEN — owner approval required | follow ACCOUNT_DELETION_POLICY.md; no destructive change implemented |
| D-03 financial claims | OPEN — owner approval required | P8 test is characterisation only. Recommend no hard-delete of paid/pending_admin claims; audited void/correction; retention period set by finance/legal (commonly 7+ years); disband and deletion must follow the same rule |
| Doppelmayr lifetime entitlement | NOT PROVISIONED | use `scripts/provision-doppelmayr-entitlement.js` dry-run first, approval-gated; never set dev seed flags in production |

## 6G Release candidate / rollback
Tooling: `scripts/check-release-env.js` (names only), `scripts/smoke-release.js` (read-only), `/api/health` provenance (`DD_BUILD_SHA`), preflight-indexes, backup/restore rehearsal. Staging smoke and isolated-staging migration: NOT RUN (isolation not proven).
Smoke checklist (staging, synthetic data): login+OTP, `/api/auth/me`, entitlements, role permissions (employee/manager/admin), mail test send, receipt upload, expense submit->approve, travel, leave (+medical doc), monitoring/health SHA.
Rollback procedure: decide on any failed smoke or P0 regression; approver = owner; record the deployment SHA being rolled back to and confirm data compatibility (this release adds no schema migration; cron lease fields are additive, ignored by older code); redeploy previous SHA, rerun smoke, record outcome.

## 6H Remaining launch blockers (priority)
1. P0: scheduled-job scheduler BLOCKED (owner decision) and no live-provider verification.
2. P0: D-02/D-03 owner decisions; Doppelmayr entitlement provisioning.
3. Legacy medical-document inventory/migration not executed.
4. Next 16 / xlsx / simplewebauthn advisories.
5. T8 deploy key; staging smoke; backup restore on real Atlas.
