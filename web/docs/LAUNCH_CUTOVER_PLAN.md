# Launch configuration inventory and cutover plan (read-only review, 2026-10-20)

**Status: NO-GO as of this review.** Nothing in production was changed. Evidence labels: LIVE-PROD-READONLY (names, scopes and settings read in the dashboards; no secret values read) · LIVE-STAGING · AUTO. Production = Netlify site `doppeldash-crm` (`doppeldash-crm.netlify.app`, no custom domain). Staging = `doppeldash-staging`.

## 1. What production is today
- Production branch is **`main`** (older code). `GET /api/health` on production answers `{"error":"Unauthorized"}`: that route (deployment provenance, `context`) does not exist there, so production's deployed commit and context cannot be proven from outside.
- `phase-1j-work` (this branch) is ~69 commits ahead of `main` (security hardening, Next 16/React 19, scheduled jobs, private receipts, DB-outage handling, etc.). **Launch = deploying this branch to production**, which needs a merge approval that has not been given.
- Netlify build settings: base `web/`, `npm run build`, publish `web/.next`, Node 22. Deploy logs are **public**. "All deployment methods can deploy to production" (CLI/API/Git). Deploy Previews are enabled for any PR against `main`; Branch deploys: production branch only. Netlify Drawer enabled on Deploy Previews; HUD disabled on production.
- Production database: Atlas project `6a2721c8…`, `Cluster0`, **FREE tier, AWS Mumbai, "Backups Inactive", monitoring paused**. No backup, no point-in-time recovery.
- Atlas (separate project) hosts the staging cluster used for acceptance.

## 2. Variable inventory (names and scopes only)
| Variable | Staging (`doppeldash-staging`) | Production (`doppeldash-crm`) | Required action before launch |
|---|---|---|---|
| `DD_DEPLOY_CONTEXT` | `staging` (all scopes) | **MISSING** | Add `production`, scoped to the **Production context only**, BEFORE deploying this code. Without it this code refuses all database access (by design). |
| `MONGODB_URI` | staging cluster | present (1 context) | Must point to the production cluster; **rotate** (see §4). Never reuse the staging string. |
| `JWT_SECRET`, `ENCRYPTION_SECRET` | present, distinct | present | Keep; production values must be distinct from staging. Rotating `ENCRYPTION_SECRET` would orphan stored mailbox/bank encryption: do not rotate without a re-encrypt plan. |
| `CRON_SECRET`, `CRON_TARGET_URL` | present | `CRON_SECRET` present; `CRON_TARGET_URL` **MISSING** | Add `CRON_TARGET_URL` (production origin) to enable the scheduled functions in production (only after staging scheduler evidence for birthday/onboarding). |
| `NEXT_PUBLIC_APP_URL` | staging origin | present | Verify exact value (no trailing slash is now tolerated by the code). |
| `TRUSTED_CLIENT_IP_HEADER` | `x-nf-client-connection-ip` | **MISSING** | Add (rate limiting otherwise uses a shared conservative bucket). |
| `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | present (Gmail app password) | present | Replace the personal-style Gmail sender with a domain sender with SPF/DKIM/DMARC before public launch (Spam placement observed). |
| `CLOUDINARY_CLOUD_NAME` | **= production cloud (isolation FAILED)** | cloud name via `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Give staging its own cloud. |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | present (production cloud's keys) | **MISSING** | Production needs them for signed/private uploads (receipts, medical documents). Add after the legacy-asset plan (§5). |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | absent | **PRESENT, all contexts** | Unsigned legacy preset: must be retired (forbidden by the release checker). Remove only after the old Android/Web clients no longer depend on it. |
| `ALLOW_DEV_SEED`, `DEV_SEED_SECRET` | absent | **PRESENT (all contexts)** | **Delete.** Destructive dev routes must not have their enabling variables on a released site (value of `ALLOW_DEV_SEED` was not read). |
| `SETUP_SECRET` | absent | present | Delete once the first admin exists (route is disabled after that, but the secret should not live on). |
| `REVIEWER_STATIC_OTP` | absent | present (all contexts) | See §6 risk R-7. Remove after Play review; scope to Production only. |
| `OLLAMA_URL`, `OLLAMA_MODEL` | absent | present | Forbidden unless a self-hosted model endpoint is a conscious decision; remove otherwise. |
| `GEMINI_API_KEY` | present (staging key; one failed live call, now fixed to `gemini-flash-latest`) | present | Confirm it is a key that can use current models; do not share keys across environments. |
| `IMAP_HOST/PORT/SECURE/USER/PASS` | absent | present | **`IMAP_OWNER_ORG_ID` MISSING**: the shared mailbox fails closed without it. Set it deliberately and back-fill legacy rows (`PROVIDER_VERIFICATION_RUNBOOKS` §3) or remove the IMAP variables. |
| Google Play (`GOOGLE_PLAY_*`) | absent (RTDN fails closed, 503) | absent | Required for billing/RTDN; verify on staging with licence testers first. |

Values scoped "same value in all deploy contexts" for `ALLOW_DEV_SEED`, `DEV_SEED_SECRET`, `REVIEWER_STATIC_OTP` and the public Cloudinary variables are visible to Deploy Preview builds. `netlify.toml` on this branch cancels preview and branch-deploy builds; production's `main` does not have that guard.

## 3. Cutover sequence (production), each step with its check and rollback
1. **Owner decisions first:** merge approval for `phase-1j-work`→`main`; D-02/D-03 retention; Atlas plan upgrade (backups); sender domain.
2. **Database readiness (before any code deploy):** upgrade the production cluster to a tier with continuous backup; enable PITR; run an authorised **restore rehearsal into an isolated cluster** (`ATLAS_RESTORE_PLAN.md`, `scripts/compare-databases.js`); run `scripts/preflight-indexes.js` read-only. Rollback: none needed (no app change yet).
3. **Rotate secrets that are exposed or reused:** production DB user password (new user, switch, then retire the old one); `JWT_SECRET` rotation signs everyone out (schedule); keep `ENCRYPTION_SECRET`. Check: connectivity with the new string on a preview/staging copy, then production. Rollback: keep the old DB user until the new one is verified.
4. **Environment changes (one coordinated change window):** add `DD_DEPLOY_CONTEXT=production` (Production context only), `TRUSTED_CLIENT_IP_HEADER`, `CLOUDINARY_API_KEY/SECRET`, `CRON_TARGET_URL`, `IMAP_OWNER_ORG_ID` (or drop IMAP); delete `ALLOW_DEV_SEED`, `DEV_SEED_SECRET`, `SETUP_SECRET`, `OLLAMA_*`; scope `REVIEWER_STATIC_OTP` to Production only. Check: `node web/scripts/check-release-env.js --context=production` in the production environment must PASS. Rollback: Netlify keeps variable history; redeploy the previous deploy.
5. **Legacy receipts/medical documents:** run the read-only inventory on the **restored copy**, review, and only then plan the migration (separate approval). Until then new uploads are private (signed) while old public URLs remain a documented exposure.
6. **Deploy:** merge approval → production deploy of the exact tested SHA. Check: `/api/health` shows `status ok`, `context production`, the expected commit; `node web/scripts/smoke-release.js --url=<prod> --expect-commit=<sha> --production` all PASS; sign-in + OTP, entitlement gating, one expense with receipt, one leave with document (synthetic tenant) before opening to users. Rollback decision procedure: `RELEASE_CANDIDATE_RUNBOOK.md` §D (instant Netlify rollback to the previous deploy; this release adds no destructive migration).
7. **Scheduler:** enable only after staging shows real birthday/onboarding executions; first production run on a synthetic tenant.
8. **Public enablement** only after 1–7 are recorded PASS.

## 4. Credential rotation status
- Staging Atlas database password was exposed in a terminal transcript on 2026-10-16: **rotation NOT confirmed** (a credential change the review agent does not perform). Must be completed and verified before any public traffic.
- Production credentials were not touched in this review.

## 5. Production Cloudinary
Not reviewed in the console (no signed-in Cloudinary session in the browser; credentials are not entered by the agent). Known from code and variables: production uses the unsigned preset variable and lacks API key/secret variables, i.e. it still runs the legacy public-upload design; the private-receipt design exists only in this branch.

## 6. Risk register (read-only findings)
| ID | Finding | Severity | State |
|---|---|---|---|
| R-1 | Production DB is a free-tier cluster with no backups/PITR | **Critical** | Blocked: owner decision (paid tier) |
| R-2 | `DD_DEPLOY_CONTEXT` missing in production: this code would lose database access | **Critical** (cutover) | Planned §3.4 |
| R-3 | `ALLOW_DEV_SEED` + `DEV_SEED_SECRET` + `SETUP_SECRET` exist on the production site | High | To delete |
| R-4 | Unsigned Cloudinary preset still configured; legacy public receipts/medical documents | High | Plan §5; owner approval |
| R-5 | Staging Cloudinary configured with the production cloud | High | Staging to be given its own cloud |
| R-6 | Exposed staging DB password not rotated | High | Owner/credential step |
| R-7 | Static Play-reviewer OTP stored in all deploy contexts and the code is documented in a committed doc in a **public** repository; the reviewer account email is hard-coded; path is gated by a DB flag + exact email + env code and fails closed | Medium | Accept only for an isolated synthetic reviewer tenant; remove after Play review |
| R-8 | Deploy logs public; any deployment method may deploy to production; previews enabled for PRs against `main` | Medium | Tighten settings (owner) |
| R-9 | No production provenance endpoint (old build) | Medium | Resolved by deploying this branch |
| R-10 | Sender is a Gmail account; reset mail lands in Spam (auth passes) | Medium | Domain sender recommended |
| R-11 | React hydration error #418 from a Netlify-injected HTML comment in `<head>` (also on production's older build); page works | Low | Platform limitation, documented |
| R-12 | Public repository: review committed docs for operational details before launch | Low | Owner review |
