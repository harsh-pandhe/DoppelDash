# Phase 12 — Doppelmayr Web end-to-end acceptance (started 2026-10-17)

Append-only. Labels: AUTO · DISPOSABLE · BROWSER (built-in browser) · LIVE-STAGING. No production contact; no Free-account or mobile testing; PR #1 draft/open; `main` and `integration/phase0-recovery` untouched. Authorised identities: Admin `harshpandhehome@…`, Manager `harshpandhepcs@…`, Employee `harshpandhe832005@…`. **No e-mail was sent by this agent in this phase** and no other recipient was contacted.

## Phase 0 — release state (LIVE-STAGING + git)
- The remote head had advanced to `621dea3872bae6a2f3f78b1ff97490897275e38d` (two docs-only commits by the owner after `61ba17b`). My clean tree was fast-forwarded; nothing was overwritten. CI run 39019608844 on that head was still in progress when the phase work started (a run for `df8023e` had been cancelled by the newer push). CI for this phase's own commit is recorded in the closure checklist.
- `/api/health`: `status ok`, `context staging`, commit = `621dea3…` = branch head. `smoke-release.js --expect-commit=<full sha>`: 3 consecutive runs, 25/25 PASS. An earlier run that expected the stale local SHA correctly failed 1 check (the provenance check works).

## Phase 1 — Doppelmayr workspace + Admin: BLOCKED (owner shell needed); fix delivered
- **Finding:** there is no supported path that creates `org_doppelmayr` and a first Admin on a fresh staging database. The entitlement and brand scripts never create an organisation, `/api/auth/setup` needs an existing one, `/api/auth/register` makes ordinary Free (mobile-only) tenants, and the dev seed is correctly disabled on hosted environments. See `docs/STAGING_WORKSPACE_BOOTSTRAP.md`.
- **State of the staging database could not be inspected:** the staging `MONGODB_URI` is not in this shell (checked by name) and was not requested.
- **Fix:** `scripts/bootstrap-staging-workspace.js`.
  - Dry-run default; refuses any database whose name lacks "staging", production-looking URIs or contexts, a missing typed `--confirm-db`, and a missing actor or reason.
  - Never takes over an existing account.
  - Creates the workspace with lifetime Premium + Web/Android, brand settings, an Admin (random one-time password printed once to the operator's terminal, stored only as a hash, change forced at first sign-in), an employee record, a leave balance and audit entries. Idempotent.
  - Regression: `bootstrap_staging_workspace` B1–B4 on disposable database `dd_boot_staging_test`, 3 consecutive runs green.
- "Admin belongs to the Doppelmayr workspace with correct entitlement" on staging: **NOT RUN** (needs the owner's one-time bootstrap and a sign-in with the e-mailed OTP). AUTO evidence only: B3 asserts org fields, admin role/org, employee and audit; `web_access_boundary` and `proxy_behaviour` P5 cover server-side Web gating.

## Phases 2–7 (invitations, role matrix, e-mail, Cloudinary, Gemini, scheduler): BLOCKED / NOT RUN
All depend on a signed-in Admin session (password and OTP are entered by the owner) and on staging secrets (`MONGODB_URI`, `STAGING_CRON_SECRET`, the Cloudinary confirmations, `GEMINI_OCR_APPROVED`), none of which exist in this shell. No provider call, upload, cron invocation or e-mail was made, and there were **0 live Gemini calls**. The automated suites for each area stay green in CI (invitations incl. contractor and the concurrent-accept race, role/tenant boundaries, CRM, expenses and receipts, leave and medical documents, travel, mail policy, Cloudinary fakes, OCR timeout/429/malformed, RTDN auth/replay).

## New LIVE-STAGING browser findings (BROWSER evidence, unauthenticated `/sign-in`)
1. **React hydration error #418 in the console on `/sign-in`.** The page still renders and works (React falls back to client rendering). It does not reproduce on a local production build.
   - **Root cause, isolated from the served HTML:** the Netlify platform injects (a) an HTML comment into `<head>` and (b) `<script async src="/.netlify/scripts/hud?variant=public">` **after the closing html tag**. Browsers move that script into `<body>`, adding a node the server-rendered React tree does not contain. The local build has neither (13 scripts locally, 14 on staging, same page). It is not caused by application code.
2. **A "Powered by Netlify" badge is overlaid on the sign-in page** (bottom right). At 375×812 it covers the lower edge of the password field and its visibility toggle. There is no horizontal overflow (scrollWidth = innerWidth = 375).
- **Owner action (provider setting; not changed by me):** Netlify → Site configuration → Collaboration tools / Netlify Drawer, and Snippet injection. Disable them for the staging site, check the production site for the same injection, redeploy, and re-check the console. If it cannot be disabled on this plan, record it as an accepted platform artifact. A code-level workaround would be speculative.

## Status
| Gate | Status |
|---|---|
| Release state, health, smoke | PASS (LIVE-STAGING, 25/25 x3) |
| Workspace + Admin on staging | BLOCKED — owner runs the bootstrap in their own shell |
| Invitations, OTP, role matrix, modules (browser) | BLOCKED — needs signed-in sessions |
| SMTP, Cloudinary, Gemini (0 calls), IMAP/Outlook, RTDN, scheduler execution | BLOCKED / NOT RUN — secrets and approvals not in this shell |
| Console errors on sign-in | FAIL — platform-injected script causes #418; owner setting |
| Narrow-viewport sign-in | PASS (no overflow; badge overlap noted) |

## CI flake found and fixed (AUTO)
CI run 39021534732 on `001f10a` failed 1 test (`release_ops_scripts` R3: `authreplayclaims: count 3 != 6`) although the same tree passed 1007/1007 locally. Cause (from the CI log artifact): R3 ran the backup→restore rehearsal on the **shared CI database while the dev server was still writing background auth-replay claims**, so counts changed between dump and verification. This was a pre-existing race in the test, not in the product or the rehearsal script. Fix: R3 now rehearses on a quiet dedicated database (`dd_rehearsal_src_test`) seeded with synthetic data and asserts exact counts (5 collections / 58 documents); 5 consecutive local runs green. Final CI for the fixed commit is recorded in the closure checklist.

## Execution pass 2 (2026-10-17, authenticated Chrome session to Netlify; LIVE-STAGING / BROWSER)
Release re-verified first: branch head = origin = staging deployed SHA `a23a1f08e3806071708cee0a1374a9a20213c4e2`, CI green on it (run 39022735935), smoke 25/25, PR #1 draft/open, tree clean.

**Netlify (staging project `doppeldash-staging` only; production not modified):**
- *Powered by Netlify badge:* was shown; **disabled** in Project → General (setting now reads "The badge is not shown on this project"). Verified live: the badge and `/.netlify/scripts/hud` script are gone from the served HTML and the DOM (13 scripts, same as a local build); sign-in at desktop width has no overlay or overflow. PASS (LIVE-STAGING).
- *Hydration error #418:* **still present** after the badge/script were removed. Controlled experiment (BROWSER): the same production build served locally is clean (no console errors); serving it through a proxy that adds only the Netlify HTML comment (`<!-- This site is hosted on Netlify … -->` inserted after the charset meta in `<head>`) reproduces #418 exactly. The comment is injected by the platform on every Netlify site (the older production site's HTML contains it too), has no setting in the UI, and is not application code. **Classified: platform limitation** (page renders and works; React falls back to client rendering). No speculative workaround applied. FAIL as a console-clean gate, documented as a platform artifact.
- *Environment variables (names, scopes only):* all 18 expected variables present; secrets scoped Builds+Functions+Runtime; SMTP_* / URLs / `DD_DEPLOY_CONTEXT` all scopes. Absent as intended: `ALLOW_DEV_SEED`, `DEV_SEED_SECRET`, unsigned-upload and SMTP-policy overrides, upload presets. PASS. Secret values are not readable (Netlify hides them) and were not revealed.
- *SMTP sender discovered from the non-secret `SMTP_FROM` variable:* `DoppelDash Staging <supportdoppeldash@gmail.com>` (the SupportDash sender). No credential revealed. No mail has been sent in this phase.

**Scheduler (three distinct results):**
1. Registration: PASS — three Scheduled functions on the published deploy; cron-announcements `*/5 * * * *`, cron-birthday next Oct 18 12:30 IST (07:00 UTC), cron-onboarding next Oct 18 14:30 IST (09:00 UTC).
2. Manual invocation (`trigger-cron.js`): BLOCKED — `STAGING_CRON_SECRET` not in this shell (secret locked in Netlify).
3. **Actual scheduled execution: PASS (LIVE-STAGING).** Netlify function log for cron-announcements shows two consecutive scheduler runs: `03:45:29 PM [cron:announcements] status=200 sent=0` (1709 ms) and `03:50:24 PM … status=200 sent=0` (2537 ms) — five-minute cadence, counts-only output, no secret or data in the log. This also proves the staging `CRON_SECRET`/`CRON_TARGET_URL` match the app and the cron path reached the database. cron-birthday and cron-onboarding have not run yet (first scheduled runs are tomorrow). No mail was produced (`sent=0`).

**Still blocked (irreducible):**
- Staging `MONGODB_URI` (secret-locked; the local `web/.env.local` is a legacy file pointing at `localhost` with Clerk/Resend keys — not staging, not used) -> workspace/Admin bootstrap, and the Atlas isolation check by cluster identity.
- Password entry and OTP entry for the Admin/Manager/Employee (typed by the owner; not by this agent).
- Staging provider secrets for the Cloudinary verifier (it runs locally against a throwaway local app/database) and the single Gemini call (key + `GEMINI_OCR_APPROVED=1` + `GEMINI_STAGING_CONFIRM=1`): a private template `~/.doppeldash-staging.env` (mode 600, outside the repo, empty values) was created for the owner to fill; nothing from it has been read.

## Execution pass 3 (2026-10-17, owner supplied the private staging secret file; LIVE-STAGING)
Secrets were loaded literally by a redacting wrapper kept outside the repository; no secret, OTP or one-time password is recorded here.

**Incident (disclosed):** while first loading the private file with a shell `source`, an unquoted `&` in the Atlas connection string made the shell echo a job-status line that contained the staging database user's password into the session transcript (not written to any file, log or commit). Owner advised to rotate that Atlas database user's password. The loader was replaced by one that never uses shell parsing and redacts every loaded value.

**Staging database identity and isolation (PASS):** host `cluster0.fdnvysk…` is the cluster shown by the owner in Atlas project `doppeldash-staging` (a different project id from the production project); database `doppeldash_staging`; the connecting user sees only `doppeldash_staging`, `admin`, `local`; before bootstrap all 25 collections held 0 documents.

**Workspace + Admin on staging (PASS, database-level evidence):** bootstrap dry-run then apply, then an idempotent re-run (no change). Stored state read back: `org_doppelmayr` "Doppelmayr India", plan `premium`, `entitlementSource lifetime_grant`, `lifetimeGrant true`, `webEnabled true`, `androidEnabled true`; owner of the org = the Admin user; `harshpandhehome@gmail.com` is an active `admin` of that org (`mustChangePassword true`); brand settings present; audit entries `staging.workspace_created`, `organization.entitlement_provisioned`, `staging.admin_bootstrapped`; 1 org, 1 user, 1 employee. The generated one-time password was redacted and discarded (nobody knows it); the owner sets a password through the reset e-mail instead. Browser sign-in of the Admin and the server-side entitlement read after login: NOT RUN (the owner types the new password and the OTP).

**E-mail (SMTP) (PASS for send, FINDING for placement):** requested the Admin password reset through the live site (generic 200). The SupportDash sender mailbox shows the sent copies; the Admin's Gmail received both messages ("Reset your Doppelmayr India password", sender `Doppelmayr India <supportdoppeldash@gmail.com>`), branded, link `…/reset-password#token=…` with the token in the fragment, one-hour single-use wording. **Both landed in Spam**: Gmail's stated reason "similar to messages that were identified as spam in the past" (SPF/DKIM header inspection not performed). Two requests were made (one accidental duplicate by the test command); no other recipient was contacted. Invitation and OTP e-mails: NOT RUN (need the signed-in Admin).

**Scheduler manual invocation (PASS, LIVE-STAGING):** `trigger-cron.js --repeat=2 --parallel` against the staging site: wrong secret -> 401 for all three jobs; valid secret -> 200 `sent=0` for all three jobs in two parallel rounds; counts-only output; secret never printed. Together with the two real scheduled executions of pass 2 the scheduler gate is PASS for cron-announcements; cron-birthday and cron-onboarding await their first scheduled runs (Oct 18).

**Cloudinary: BLOCKED — isolation FAILED (provider configuration defect).** The cloud name in the owner's staging file equals the production site's `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` (read-only, non-secret), and the **staging Netlify site's `CLOUDINARY_CLOUD_NAME` is the same production cloud**. Staging receipts and leave documents would therefore be stored in the production Cloudinary account. No Cloudinary call, upload or deletion was made. Owner action: create a separate Cloudinary cloud for staging and replace `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` on the staging site (and in the private file), then the verifier can run.

**Gemini OCR: one live call made (owner-authorised cap reached) -> FAIL, defect found and fixed.** `verify-gemini-ocr.js`: 1 provider request, HTTP 404. Free diagnostics (model metadata and `countTokens`, no generation) showed Google's message: the hard-coded `gemini-2.5-flash` "is no longer available to new users" (a newly created key cannot use it), while `gemini-flash-latest`, `gemini-3.5-flash` and `gemini-3.1-flash-lite` accept image requests for the same key. **Fix:** `lib/gemini.ts` `geminiModel()` defaults to the alias `gemini-flash-latest`, overridable with a name-validated `GEMINI_MODEL`; the support chat uses the same function. Regression `gemini_ocr_check` G-model (default, override, hostile values, no versioned model name in application code); ocr/support suites green locally. A second live call to confirm extraction needs the owner's additional approval (the cap was one).

**Environment variable check (names/scopes) and platform findings:** see pass 2 (unchanged).
**Open:** owner password reset + OTP sign-in; invitations/role matrix/modules in the browser; Cloudinary isolation; second Gemini call; Atlas password rotation.

## Execution pass 4 (2026-10-17, Admin session in Chrome; LIVE-STAGING + BROWSER)
**Release state:** staging serves `e12378d62f2aa73479a70d8500f33e3f28aaa3b4` (`/api/health` status ok, context staging); CI run 39032828474 on that SHA: success, 83 files / 1010 tests, 1009 pass, 0 fail, 1 skip (T8); smoke 25/25. The reset/invitation link fix is therefore deployed and verified.

**Admin authentication (PASS, BROWSER + API):** the owner set the Admin password on the recovered reset page and signed in with the e-mailed OTP (typed by the owner). Authenticated `/api/auth/me`: role `admin`, `org_doppelmayr`; `/api/billing/entitlements`: premium / `lifetime_grant` / webEnabled true. Executive dashboard renders; bootstrap audit entries visible. Forced-password-change flow and logout/re-login: NOT RUN (owner-driven; the owner's reset replaced the one-time password).

**Link fix on live e-mail (PASS):** the Employee invitation received in the Employee mailbox has host = staging, path `/invite` (single slash). Before the fix the reset link path was `//reset-password`. Manager invitation delivered to the Manager mailbox Inbox (not Spam). Reset e-mail authentication results (headers read): SPF PASS, DKIM PASS (gmail.com), DMARC PASS — the earlier Spam placement is Gmail's reputation heuristic, not an authentication failure.

**Invitations (PASS for send, NOT RUN for acceptance):** Admin UI "Invite Member": Manager (`harshpandhepcs@…`, role manager) and Employee (`harshpandhe832005@…`, role employee, type **contractor**) -> "Invitation Email Delivered"; Invitations tab lists both Pending with correct roles; audit shows two `invitation_created`. Acceptance, password setup and OTP for these two accounts require the invitees' own typed credentials and were **not performed by the agent** (BLOCKED on the owner).

**Admin module sweep (PASS, LIVE-STAGING API through the Admin session):** 20 endpoints 200 with expected shapes (auth/me, employees me/directory, admin users/invitations/audit/settings, org settings, crm, lms, rms, travel, announcements, notifications, holidays (21 seeded), analytics, entitlements, org mail-config, user email-config, mail drafts).
- **CRM (PASS):** created `ZZ-TEST Contact Alpha` via UI; visible as a card (visibility "Only me"/private); persists after reload; missing required field -> 400; malformed JSON -> 400. Edit/delete and Manager/Employee privacy checks: NOT RUN (other roles inactive). Contact kept for the cross-role check.
- **Expenses (BLOCKED):** the Log Expense form validates (submit with no dates -> "Fill title, reason, and start date.", 0 expenses created) and then requires at least one receipt; receipts upload to Cloudinary, which on staging is the **production** cloud. No upload was attempted; no expense created.
- **Leave (PASS with findings):** UI request (Casual, 2–3 Nov, synthetic reason) -> toast "Leave request submitted"; API holds 1 pending leave (2 days); visible after "show all months"; calendar highlights the dates. **Finding (UX, not fixed):** the list stays filtered to the current month, so the new leave looks absent right after submitting. **Defect 1 (fixed):** leave submission wrote no audit entry. **Defect 2 (fixed):** a leave POST with a missing/invalid date, non-numeric or absurd `days`, or no reason returned a bare **500**.
- **Travel (PASS):** UI request (Pune->Mumbai, 1 leg) -> redirected to the list; API: 1 request `pending_manager`. Review/approval needs the Manager: NOT RUN.
- **Audit trail (PASS with the fixed gap):** entries for `travel.submitted`, `contact_created`, 2x `invitation_created`, and the three bootstrap events; no token/password material in the returned logs; `leave.submitted` was missing (Defect 1).

**Defects fixed (regression tests):**
1. `POST /api/lms` now writes an awaited `leave.submitted` audit entry (non-sensitive metadata only: type, days, dates, document count; no reason text or document references) — `leave_submission_audit` L-audit: exactly one entry, correct tenant, visible to that tenant's admin only, absent for a rejected submission.
2. `POST /api/lms` validates dates/days/reason and answers 400 with the field names (was a 500 from an Invalid Date reaching the balance aggregation) — L-audit covers 7 malformed bodies (none, bad start/end date, non-numeric/negative/absurd days, no reason).

**Not done (precise blockers):** Manager and Employee activation + role matrix (typed passwords/OTPs); Atlas credential rotation (a credential-entry/security change the agent does not perform; the exposed password remains **unrotated** as far as this record knows); separate Cloudinary staging cloud (account creation); second live Gemini call (needs renewed approval).
