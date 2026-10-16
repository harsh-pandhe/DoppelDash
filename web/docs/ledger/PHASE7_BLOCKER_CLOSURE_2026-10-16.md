# Phase 7 — Final blocker closure (2026-10-16)

Append-only. Evidence labels: AUTO (local automated, fake providers), DISPOSABLE (throw-away local MongoDB), none LIVE-STAGING / PROD. No production access, deployment, migration, provisioning or deletion. PR #1 verified open + draft + unmerged. `main`/`integration/phase0-recovery` untouched.

## 1 Verified start state
Web `phase-1j-work` = origin = `97f63a7` clean tree; CI 38833672092 success (79 files / 985 tests, 984 pass, 1 skip = T8). Flutter `6d8bb3f` = origin; only untracked `docs/design/screenshots/` (preserved). Phase 6 docs were current except `docs/CI.md` (stale Flutter counts 442/13, now 594/20 — fixed).

## 2 Dependency advisories (AUTO)
Before Phase 7: 4 (next moderate, postcss high, xlsx high, @simplewebauthn/server low). After: **1 (xlsx, high, no patched release on npm)**.
| Package | Advisory / range | Reachable? | Action |
|---|---|---|---|
| next 15.5.28 -> **16.4.2**, postcss (bundled) | `next` 9.3.4-canary.0 – 16.3.0-preview.10 + PostCSS stringify/sourcemap (<=8.5.22) | build-time CSS only | Upgraded. Next 16 accepts React 18 (peer `^18.2 \|\| ^19`), Node 22 OK. Breaking changes handled: `next lint` removed -> `eslint .` flat config (`eslint.config.mjs`, ESLint 9; CI step now `npm run lint`); Turbopack default (dev + build compile); `middleware.ts` still works (deprecation notice, rename to `proxy` is a tracked follow-up); async params already done in Phase 6. The six React-Compiler advisory rules shipped by eslint-plugin-react-hooks 7 are set to `warn` (94 pre-existing warnings, 0 errors) — they are optimisation hints, no security rule weakened. |
| @simplewebauthn/server 10.0.1 -> **14.0.3** (+browser 14) | low, <=13.3.1 | passkey login/register | Upgraded. API migration: types now from the server package; `registrationInfo.credential.{id,publicKey,counter}`; `verifyAuthenticationResponse({credential})`. Verified by the synthetic-authenticator suites (passkey_totp_security 34/34, web_auth_pages 14/14). |
| xlsx 0.18.5 | prototype pollution + ReDoS on **parsing** untrusted workbooks (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) | **No**: write-only. Imported only in `lib/export.ts` (`utils`, `writeFile`, dynamic client-side import); no read/parse call, no spreadsheet MIME accepted anywhere in `app/api`/`lib` | Not patched (no fix exists). Residual risk documented; regression control `dependency_hardening` V4 fails if xlsx spreads beyond `lib/export.ts`, a read path appears or a spreadsheet MIME is accepted. Owner option: replace with `exceljs`. |
Not a fix: audit score changes alone; nothing suppressed, no `--force`, `npm ci --legacy-peer-deps` (existing CI install) verified against the lockfile.

## 3 CI integrity / T8
- `web/design/tokens.json` is byte-identical to the Flutter `tool/design/tokens.json` on both `phase-1j-work` and `origin/integration/phase0-recovery` (the ref the workflow checks out). Locally T8 runs and passes (985/985).
- Secret `MOBILE_REPO_DEPLOY_KEY` is **not configured** (Actions secrets list empty) -> T8 skip stays the only allowed skip; unchanged skip rule, never marked passed.
- Owner checklist (no key ever pasted in chat), `docs/CI.md` commands: create ed25519 key outside any repo; add `.pub` as a **read-only** deploy key on `DoppelDash-mobile`; `gh secret set MOBILE_REPO_DEPLOY_KEY -R harsh-pandhe/DoppelDash < key`; shred; re-run `web-ci` and expect 985/985 with 0 skips; then delete the `allowedSkips` entry.
- Branch protection: see RELEASE_OPERATIONS §1 (Phase 7 re-measurement + recommended ruleset). Nothing changed.

## 4 Security closure re-verification (independent of the matrix heuristic)
Counted exported HTTP methods straight from source: 93 `route.ts` files, **153 methods** = matrix totals. Verified tests exist for: employee bank/personal filtering (E7), self-service allowlist + dotted-path rejection, malformed JSON 400 without mutation (Phase 5), SMTP policy + DNS pinning (S7), `IMAP_OWNER_ORG_ID` binding, atomic cron claims/leases (9 tests), awaited audit writes, invitation GET/HEAD removed (G1), tour-seen, Outlook webhook, public health, RTDN auth, DB-outage matrix. No new gap demonstrated this phase; no extra code changed for it. Concurrency suites re-run in the final full run (below).

## 5 Provider staging matrix — environment: this workstation; credentials by name: none of `MONGODB_URI`, `CLOUDINARY_*`, `SMTP_*`, `GEMINI_*`, `NETLIFY_*` present in the shell
| Provider | Status | Evidence | Next action |
|---|---|---|---|
| Netlify provenance / previews | NOT RUN | `/api/health` provenance and env-isolation covered AUTO only | Owner: deploy `phase-1j-work` to a preview with staging env, run `scripts/smoke-release.js`, confirm `DD_BUILD_SHA` |
| SMTP / IMAP | NOT RUN | policy tests AUTO | Provide a designated test mailbox + staging creds; run PROVIDER_VERIFICATION_RUNBOOKS §SMTP; set `IMAP_OWNER_ORG_ID`, backfill legacy rows |
| Cloudinary | NOT RUN | `scripts/verify-cloudinary-staging.js` exists, fake-verified | Isolated staging cloud creds; run script (signed upload, MIME/size, private fetch, wrong-tenant, tamper, delete) |
| Gemini / OCR | NOT RUN | `scripts/verify-gemini-ocr.js` exists, fake-verified | Staging key; synthetic receipts only |
| Google Play / RTDN | NOT RUN | AUTO fixture only (not a real purchase) | Licence-tester account, Pub/Sub OIDC push, run test cases in PLAY_RTDN_SETUP.md |
| Scheduled jobs | BLOCKED | lease code AUTO; no scheduler | Owner chooses target (Netlify scheduled functions or external cron calling `/api/cron/*` with `CRON_SECRET`); configure staging only, then exercise run, overlap, failure, retry |

## 6 Migration and retention
- Legacy medical inventory: DISPOSABLE/AUTO validated on synthetic data (I1–I4: duplicates grouped by fingerprint, missing manifest rows, orphan rows, already-private refs, cross-tenant refs, unsupported extensions; read-only snapshot unchanged; output contains no URL/file name/content; 0600 report; refuses non-test DB without the approval gate). NOT RUN on any real data. Gate: verified Atlas backup + restore rehearsal first, then owner approval var.
- Restore rehearsal: **DISPOSABLE PASS** — local mongod on loopback, synthetic database (2 collections, 4 documents): backup -> restore -> counts + content hashes verified, `problems: []`. Not an Atlas snapshot/PITR rehearsal (owner action).
- Index pre-flight on a fresh empty DB lists all indexes as missing (expected before first app start); must be run against staging Atlas.
- D-02 / D-03: approval table already prepared in `docs/RETENTION_DECISIONS.md` (8 decisions, recommended defaults incl. no ordinary hard-delete of paid/pending_admin claims and an audited void/correction record). **No owner decision recorded; nothing implemented.**
- Doppelmayr provisioning: verified by reading the script + tests — dry-run default, `--apply` needs `--confirm-db`, `--confirm-org`, `--actor`, `--reason`, never creates an org, idempotent (no second audit entry), audit written. Runbook: `docs/DOPPELMAYR_ENTITLEMENT_PROVISIONING.md`. Operator sequence: reviewed dry run attached to ticket -> verify the printed org id/db name with the owner -> explicit written apply approval -> apply -> re-run dry run ("Already provisioned"). NOT run anywhere shared.

## 7 Release candidate
Release smoke matrix (staging, synthetic data; each row PASS/FAIL recorded by operator): login+OTP; session revocation (logout, password change, ban); Free / Premium / Lifetime gating via `/api/billing/entitlements`; CRM; expenses incl. receipt permissions (owner/manager/admin, wrong tenant 404); leave + medical document (private delivery, PDF headers); travel; invitation acceptance (incl. contractor); mail send; billing/RTDN; scheduled tasks; `/api/health` SHA. Rollback: redeploy previous SHA (no schema migration in this release; cron lease fields additive), re-run smoke; approver = owner. Rollback NOT exercised (no staging). Env contract: `scripts/check-release-env.js` (names only).

## 8 Remaining launch blockers
1. P0: live provider verification not done (all NOT RUN) and scheduler not configured.
2. P0: D-02/D-03 owner decisions; Doppelmayr entitlement not provisioned.
3. P0: Atlas backup/PITR restore + legacy medical inventory/migration not executed on real data.
4. P1: T8 deploy key; branch protection (web: apply ruleset; mobile: plan limitation).
5. P1: xlsx residual (write-only) — optional replacement; `middleware`→`proxy` rename follow-up.
