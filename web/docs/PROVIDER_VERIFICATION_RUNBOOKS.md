# Provider verification runbooks (Phase 5D)

**Status of every provider: NOT RUN — no credentials/access are available in the engineering environment.** Fake-provider tests prove OUR enforcement only. Each runbook states the owner prerequisite, the exact steps and the pass criteria. Never print secrets; set them in the shell/secret store of the machine that runs the check.

| Provider | Matrix | Evidence today | Blocked on (owner) |
|---|---|---|---|
| Netlify deploy safety / provenance | **BLOCKED** | CODE-VERIFIED (`netlify.toml` cancels previews, `DD_DEPLOY_CONTEXT` fail-closed DB guard, `/api/health` provenance endpoint — tests) | Netlify login: site settings, env-var scopes, build logs |
| SMTP / mailbox | **NOT RUN** | FAKE-VERIFIED (fake SMTP capture; destination policy; no-leak logs) | SMTP credentials + a test mailbox you own |
| IMAP / Outlook | **NOT RUN** | FAKE-VERIFIED (state signing, webhook controls); Microsoft token exchange unverified | Microsoft app registration + test account |
| Cloudinary private storage | **NOT RUN** | FAKE-VERIFIED (fake provider, 27+21+… tests) | dedicated staging cloud + key/secret |
| Gemini OCR / chat | **NOT RUN** | FAKE-VERIFIED (error/timeout/quota paths) | staging key + approval of data-handling wording |
| Google Play Billing / RTDN | **NOT RUN** | FAKE-VERIFIED (OIDC verification with a fake JWKS, Play API fake) | Play Console, licence testers, Pub/Sub push subscription |
| Scheduled jobs | **NOT RUN** | FAKE-VERIFIED (`SCHEDULED_JOBS.md`) | choice + configuration of a scheduler, `CRON_SECRET` |

## 1. Netlify (owner, ~30 min)
1. `netlify login`; `netlify sites:list` → record the site id and the **production URL**; `netlify api getSite` → record `build_settings` (repo, branch, base dir, command) and `published_deploy`.
2. Environment variables, **names only**: `netlify env:list --context deploy-preview` must NOT contain any of `MONGODB_URI JWT_SECRET ENCRYPTION_SECRET CRON_SECRET SMTP_* IMAP_* CLOUDINARY_* GEMINI_API_KEY GOOGLE_PLAY_* DEV_SEED_SECRET ALLOW_DEV_SEED OUTLOOK_*`. Production context must have `DD_DEPLOY_CONTEXT=production`, `NEXT_PUBLIC_APP_URL=https://<canonical>`, `TRUSTED_CLIENT_IP_HEADER=x-nf-client-connection-ip` (confirm the header name for your plan), and **must not** have `ALLOW_DEV_SEED`.
3. Deploy previews: Site → Build & deploy → Deploy previews = *None* (matches `netlify.toml`).
4. Provenance: after a deploy, `curl -s https://<host>/api/health` → `{"status":"ok","commit":"<sha>","context":"production"}`; the SHA must equal the reviewed commit and the Netlify deploy's commit. Record deploy id, SHA and time. (`commit` is embedded at build time from `COMMIT_REF`/`GITHUB_SHA`.)
5. Smoke: `/sign-in` 200, `/api/auth/me` 401, `/api/dev/seed` POST without secret → 403 (production gate), `/web-access-restricted` 200, the legal pages 200.
Pass = every item recorded with evidence; PROD-VERIFIED only after an approved release.

## 2. SMTP / mailbox
Prereqs: `SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM` in **staging**; a mailbox you own; DNS: SPF/DKIM/DMARC for the sender domain (`dig TXT <domain>`, send to a mail-tester inbox and read the headers `spf=pass dkim=pass dmarc=pass`).
Steps: (a) request a password reset for a synthetic staging user → message arrives; link is `https://<staging>/reset-password#…` (token in the fragment), opens on a phone, works once, expires; (b) wrong SMTP password in staging → the request still returns the generic success (no account enumeration) and the failure is logged as a code only; (c) 6 reset requests in a minute → rate limited; (d) per-user mailbox ("connect my mailbox"): a private/loopback host is refused (`private_host`), a standard public host works with an app password.
Pass = receipts + headers + link behaviour + failure/rate-limit behaviour recorded.

## 3. IMAP / Outlook
Prereqs: IMAP test mailbox; for Outlook an Azure app (`OUTLOOK_CLIENT_ID/SECRET`, redirect `https://<staging>/api/auth/outlook/callback`, `OUTLOOK_WEBHOOK_SECRET`). Steps: start the flow signed in (state is signed and bound to your session — a callback with another user's/unsigned state must fail), complete consent, confirm the token row has `orgId`, send a mail to the connected mailbox and confirm the webhook (`clientState` verified) imports it only for the owning tenant; revoke the app grant and confirm refresh failure is handled. **Note:** the Outlook feature has no UI caller today; decide whether it ships.

## 4. Cloudinary private storage
Follow `RECEIPT_STORAGE_AND_OCR.md` §12 (`scripts/verify-cloudinary-staging.js`). Additionally for leave medical documents (purpose `leave_medical`): signed upload ticket → asset is `type=authenticated`; owner 200, reviewer 200, **peer employee 403**, other tenant 404, anonymous 401; PDF streams with `Content-Disposition: attachment` and `nosniff`; the public URL pattern returns 401/404; tampered ticket (changed `public_id`/`folder`) rejected by the provider; oversize/wrong-type rejected at attach; delete → provider confirms before the manifest row is removed. Pass = harness exit 0 plus the extra matrix recorded with redacted ids.

## 5. Gemini / OCR
Prereqs: staging `GEMINI_API_KEY`. Steps: `scripts/verify-gemini-ocr.js`; send a synthetic receipt; force timeout/429/500 (use an invalid key and a very large image) → user sees a calm retry message, quota counter not charged for provider failures, logs contain codes only. Confirm the consent/disclosure copy shown before upload matches `docs/SUPPORT_CHAT.md`/privacy text.

## 6. Google Play Billing / RTDN
Prereqs: Play Console app with the base plan, licence testers, a Pub/Sub topic + **push** subscription to `https://<staging>/api/billing/play/rtdn` with OIDC auth (audience = the exact URL, service account = `GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL`), `GOOGLE_PLAY_*` variables (`PLAY_RTDN_SETUP.md`). Scenarios (each: expected entitlement in `/api/auth/me` + Play API state): purchase → premium; restore on a second device; renewal; cancel → premium until period end; expiry → free; grace period (premium); account hold (free); refund/revoke (free); duplicate RTDN (one effect); replayed old RTDN; wrong-audience/invalid token (401); a lifetime-grant organisation is never downgraded by any event. Use `GET /api/billing/entitlements` and the Play Console "Order management". Pass = every scenario recorded. Never use a real card; licence testers only.

## 7. Scheduled jobs
`SCHEDULED_JOBS.md` verification runbook.
