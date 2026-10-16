# Phase 8 — Final remediation and staging readiness (2026-10-16)

Append-only. Labels: AUTO (local, fake providers), DISPOSABLE (throw-away local MongoDB). No LIVE-STAGING or PROD evidence exists. Started from Web `611520b` (CI 38928742892) and Flutter `6d8bb3f` (unchanged; only untracked `docs/design/screenshots/` preserved). PR #1 draft/open/unmerged; `main` and `integration/phase0-recovery` untouched; nothing deployed.

## 1 xlsx — retained, mitigated, NOT fixed
- Installed 0.18.5 = npm `latest` (no newer release); audit: 1 high, `fixAvailable:false`. Advisories: prototype pollution and ReDoS **when parsing** untrusted workbooks.
- Reachability: imported only in `lib/export.ts`, dynamic client-side import, `utils`+`writeFile` only; no parse call anywhere in `app`/`lib`; no spreadsheet MIME accepted by any API (guard test V4).
- Output hardening added (`lib/xlsxSheet.ts`): every string forced to a plain string cell, formula/link fields stripped, non-finite numbers emptied. Tests `xlsx_export_hardening` X1/X2 write hostile payloads (`=HYPERLINK(...)`, `=cmd|...`, `+SUM`, `@SUM`, tab/CR-prefixed, `__proto__`) and assert no `.f`/`.l` and no `<f>` element, text preserved verbatim.
- Replacement evaluated and **rejected for now**: `exceljs@4.4.0` installed on a scratch lockfile (reverted): it adds 3 new advisories (uuid <11.1.1 moderate, brace-expansion high, exceljs itself moderate) with no clean fix, 23 MB vs 7 MB. Net audit would worsen (4 vs 1).
- Residual risk: advisory stays open until a patched SheetJS (vendor CDN build) or a clean exceljs release; risk is contained by write-only use + guards. Migration plan: when exceljs (or SheetJS vendor build) audits clean, port `brandedXLSX` only (single sheet, column widths), reuse X1/X2 as acceptance tests.

## 2 Next.js 16 `proxy`
- Next 16 docs (bundled in `node_modules/next/dist/docs`): `middleware` is **deprecated, renamed `proxy`**, functionality identical; difference: `proxy` runs on the **Node.js runtime** (no edge `runtime` config). Rename was optional in 16.4.2 but the deprecation notice was in every dev log.
- Done: `middleware.ts` -> `proxy.ts`, export `proxy`; code (auth, cookie, redirects, bridge, matcher) byte-for-byte unchanged otherwise. `verifyToken` (jose) works on Node. Test path references updated (auth_foundation, web_access_boundary).
- New `proxy_behaviour` P1–P5: file convention; public pages 200; protected + nested pages redirect with `redirect=`; API 401 JSON; garbage bearer/cookie; `.json` suffix does not bypass; legacy token bridge (no-store, token absent from body); Lifetime member renders `/dashboard`,`/lms`,`/travel` twice (refresh) while Free and Premium-without-web are redirected to `/web-access-restricted` on `/dashboard`,`/lms`,`/rms`,`/travel`; explanation page reachable.

## 3 CI
- Token parity: `web/design/tokens.json` == Flutter `tool/design/tokens.json` byte-identical on `origin/integration/phase0-recovery` (the ref the workflow checks out) and the local branch (re-verified this phase).
- `MOBILE_REPO_DEPLOY_KEY` still unset (Actions secrets empty): skip rule unchanged, T8 still a documented skip. Owner command block: `web/docs/CI.md` (no key is ever printed).
- Trigger change: `web-ci` now also runs on pushes to `phase-*` branches (was only `integration/**`); PRs unchanged. No branch protection or repo setting changed. Lint step now `npm run lint` (set in Phase 7).

## 4 Route / security coverage (behaviour, not name matches)
Independent source count: 93 route files, 153 exported methods. Beyond counting, this phase examined the families' tests for denial / wrong-tenant / invalid-body / concurrency / outage evidence:
| Family | Evidence found | Gap found -> action |
|---|---|---|
| Employee data | E7 bank/personal filtering, allowlist & dotted-path tests, cross-org peer, 401/403 | none new |
| Login/session | auth_foundation, passkey/TOTP (34), refresh/replay, outage O2 | none new |
| Invitation | token hygiene, GET/HEAD removed, contractor accept (E8) | **no concurrent-accept test -> E9** (3 simultaneous accepts: exactly 1 account/employee; losers 4xx) PASS, 3x |
| Billing/RTDN | auth, replay, tenant tests (AUTO fakes) | live Pub/Sub OIDC + Play staging **still open** |
| Private uploads | 44 files incl. tenant, size/MIME, tamper | none new |
| Shared mail | policy/SMTP/IMAP owner binding, but outage coverage absent | **O7 added** (invitation, mail-config, email-config, drafts fail closed 503) |
| Scheduled jobs | 9 lease tests + idempotency | scheduler itself not configured |
| Account deletion | account_deletion*, integrity | D-02 policy unapproved |
| DB outage completeness | O2 sampled routes only | **O6 static test**: every exported handler wrapped by `dbGuard` except 8 handlers proven DB-free (health, removed invitation GET/HEAD, receipts-cleanup 405 stubs) |
Keyword counts per family were used only to find thin areas; they are not proof.

## 5 DB outage / scheduled jobs
Fail-closed contract unchanged (503 `service_unavailable`, `Retry-After: 5`, no host/driver/stack in body, no stale grant since nothing is cached). Suite now 7 tests (O1–O7). Cron lease/overlap/stale/attempt-cap suite (9 tests) re-run repeatedly (see section 9). **Scheduled jobs are not operational**: no scheduler configured anywhere.

## 6 Provider matrix  (environment: this workstation, 2026-10-16T18:13:33Z; credentials checked by variable name — none of MONGODB_URI / CLOUDINARY_* / SMTP_* / GEMINI_* / NETLIFY_* / GOOGLE_PLAY_* present)
| Row | Status | Evidence | Next action (owner) |
|---|---|---|---|
| Netlify provenance, env separation, previews | NOT RUN | AUTO: `/api/health` exposes only commit/context/status (O1) | Preview deploy with staging env; `node scripts/smoke-release.js <url>`; confirm `DD_BUILD_SHA`; confirm previews have no prod secrets |
| SMTP send/safe failure | NOT RUN | AUTO policy + pinning (S7) | Test mailbox + staging SMTP creds; runbook PROVIDER_VERIFICATION_RUNBOOKS |
| IMAP ownership/tenant scoping | NOT RUN | AUTO owner binding tests | Set `IMAP_OWNER_ORG_ID` in staging; backfill legacy rows; test mailbox |
| Cloudinary private upload/PDF/MIME/tenant/delete | NOT RUN | AUTO fakes; `scripts/verify-cloudinary-staging.js` ready | Isolated staging cloud creds; run script |
| Gemini/OCR timeout/quota/malformed | NOT RUN | AUTO fakes; `scripts/verify-gemini-ocr.js` ready | Staging key; synthetic receipts |
| Google Play purchase/restore/expiry/cancel/grace + RTDN | NOT RUN | AUTO simulated fixtures only (not a purchase) | Licence-tester account, Pub/Sub OIDC push endpoint on staging |
| Scheduler real execution/overlap/failure/retry | BLOCKED | AUTO leases only | Choose scheduler target; configure staging only; exercise |
| Atlas backup + PITR restore (non-prod) | NOT RUN | DISPOSABLE logical rehearsal PASS in Phase 7 (counts+hashes) | Restore Atlas snapshot/PITR into an isolated cluster; run `backup-restore-rehearsal`-style verification + `preflight-indexes` |

## 7 Retention approvals (nothing implemented)
One approval table: `docs/RETENTION_DECISIONS.md` (§Compact approval, 8 rows). Summary of recommendations awaiting owner Approve/Amend/Reject:
| Topic | Recommendation |
|---|---|
| Paid / pending-admin claims | no ordinary hard-delete (409); audited admin `void` with reason, original amount + receipt preserved; owner-only drafts/returned remain deletable |
| Receipt & claim retention | claims/receipts 8 y from payment (confirm with accountant), leave 3 y, other 2 y, audit 8 y |
| Account deletion | pseudonymise member on retained records; e-mail removed from audit metadata; 14-day soft-delete then purge job |
| Backups | state retention (e.g. 30 d) on /privacy and /delete-account; purged data persists until expiry |
| Org disband / sole owner | disband deactivates tenant and may not purge paid claims/receipts before retention; owner leaving with members -> ownership transfer first |
Current behaviour unchanged (documented in ACCOUNT_DELETION_POLICY.md).

## 8 Migration / provisioning
- Legacy medical inventory: synthetic fixtures re-run in the full suite (I1–I4: duplicates, missing manifest, orphan rows, already-private, cross-tenant, unsupported ext, read-only snapshot, report free of URLs/names/content). NOT RUN on real data; needs verified Atlas backup/restore + owner approval.
- Doppelmayr entitlement: dry-run first, apply needs 4 explicit flags, never creates org, idempotent, audited; NOT applied anywhere shared.

## 9 Verification
Local (AUTO): tsc 0 errors; lint 0 errors (94 pre-existing advisory warnings); `next build` OK (route table lists "Proxy (Middleware)"); full suite **81 files / 997 tests, 997 pass, 0 fail, 0 skip** (T8 ran locally because the mobile checkout is present); 5x repeats green: cron_idempotency, employee_record_security (incl. concurrent invitation accept), proxy_behaviour, xlsx_export_hardening. baseline.json = 81 / 997 / 1 allowed skip. CI result: see the closure checklist row and the final report (recorded against the exact pushed SHA).
New build notice: **React 18 is deprecated in Next 16 and will be removed in Next 17** — plan a React 19 upgrade before Next 17 (not a current blocker).

## 10 Remaining launch blockers (priority)
1. P0: live provider verification (SMTP/IMAP, Cloudinary, Gemini, Play/RTDN, Netlify provenance) — all NOT RUN; scheduler BLOCKED.
2. P0: D-02/D-03 owner decisions; Doppelmayr entitlement provisioning not applied.
3. P0: Atlas backup/PITR restore in non-prod and legacy medical inventory/migration on real data.
4. P1: T8 deploy key; branch protection/rulesets (web public repo ready; mobile plan limited).
5. P1: xlsx advisory open (contained); React 19 before Next 17.
