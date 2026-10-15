# Token & secret handling — what may appear in a URL (and what must not)

Rule: **no credential or one-time token in a URL path or query string.** URLs are written to access logs, proxies,
monitoring and `Referer` headers. Enforced by `tests/password_reset_token_hygiene.test.js`,
`tests/invitation_token_hygiene.test.js`, `tests/secret_exposure.test.js` and the whole-log scan
`tests/z_final_log_secret_scan.test.js` (run last, with `DD_SERVER_LOG=<dev server log>`).

| Secret | Where it travels | Notes |
|---|---|---|
| Password-reset token | e-mailed link `…/reset-password#token=…` (URL **fragment**, never sent to a server); then `POST /api/auth/password-reset/check` and `/confirm` **body** | `GET …/confirm?token=` removed (405) |
| Invitation token | e-mailed link `…/invite#token=…`; then `POST /api/auth/invitations/verify` and `/accept` **body** | `GET /api/auth/invitations/<token>` removed (405 stub that never reads the segment) |
| Cron secret (`CRON_SECRET`) | `Authorization: Bearer <secret>` header **only** | `?secret=` no longer accepted. Vercel Cron sends the header automatically; **external schedulers must be reconfigured to send it** (see `.env.local.example`) |
| Dev seed / migrate / reset-to-admin secret | `x-seed-secret` header **only** | `?secret=` no longer accepted |

## Legacy links already in inboxes
E-mails sent before this change contain `…/invite?token=…` or `…/reset-password?token=…`. They keep working: the
middleware answers such a request with a tiny static bridge page (no token in its HTML) that moves the token into the
fragment and navigates to the clean URL, and the page scrubs it from the address bar. The *first* request of a legacy
link was already sent by the browser and can appear in a server/proxy log once; those links expire (invitations 7 days,
reset links 1 hour), so the exposure ends by itself.

## Known remaining item (not in scope here)
`POST /api/billing/play/rtdn?token=<RTDN secret>`: Google Cloud Pub/Sub push subscriptions cannot send custom headers,
so the webhook secret is configured as a URL query by design (the route also accepts `x-rtdn-secret`). Prefer Pub/Sub
push authentication with an OIDC token, or redact `token=` in the hosting platform's access logs.
