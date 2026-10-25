# API security matrix (Phase 12)

Generated inventory of every `app/api/**/route.ts` handler, produced by `node scripts/audit/route-matrix.js --md docs/API_SECURITY_MATRIX.md` (machine-readable copy: [`api-security-matrix.json`](api-security-matrix.json)). The columns are **static, regex-based signals** (is `getUser()`/a token check present, is there a role gate, is `orgId` used, is the body read through `readJsonObject`, is there an allowlist/validation helper, is there an error mapping, is there a `writeAudit` call, how many test files mention the route). They are a review aid and a drift detector, **not proof** — shared handlers (e.g. `/api/org/settings` → `lib/settings/orgSettingsHandler.ts`) and service-level audit calls (invitations) show up as `N` even though the behaviour is covered; the evidence for behaviour is the test files named below.

## Evidence (all AUTOMATED: real server, throwaway MongoDB, fake providers — none of it is a live-browser or role-session result)

| Suite | What it proves |
|---|---|
| `tests/api_fuzz_matrix.test.js` F1 | 37 mutating endpoint/method pairs x 18 hostile whole-body values (null, wrong types, 20,000-char strings, 2,000-element arrays, `$gt` operator objects, date garbage, injection strings) + 7 raw malformed bodies each: never a 5xx |
| F2 | the same endpoints x ~70 field names x 3 hostile values, one field at a time: never a 5xx |
| F3 | 25 id-routes x 7 malformed ids (and cross-tenant real ids as another org's Admin): 4xx only, cross-tenant is 403/404 |
| F4 | every listed write endpoint is 401/403 anonymously; Employee is 403 on the Admin-only writes |
| F5 | 13 public endpoints (login, OTP, refresh, reset, invitations, setup, passkey, support chat) x hostile bodies: never a 5xx |
| `tests/audit_events.test.js` AU1-AU8 | each new audit event: success writes exactly one event, rejected / forbidden / unknown-id requests write none and persist nothing, no secrets/PII values in metadata, tenant scoping, admin-only visibility |
| `tests/mail_draft_validation.test.js` MD1-MD2 | drafts: typed/sized validation, recipient clean-up, id handling, owner privacy, shared Mongoose-error mapping |
| existing feature suites | optimistic concurrency (travel 428/409), duplicate-submit idempotency (expenses), single-use invitation/reset races, leave/CRM/announcement/holiday/settings validation, role matrices per feature |

## Per-handler status

`PASS (auto)` = the route is exercised by the fuzz matrix and/or its feature suite and no 5xx / cross-tenant / partial-write failure remains. `BLOCKED (live role)` = Manager/Employee live-session acceptance is not possible yet (accounts not activated; the automated role tests still cover it). Routes not in the fuzz matrix are listed explicitly:

| Route | Why not fuzzed here | Covered by |
|---|---|---|
| `/api/dev/*` | refused on hosted platforms by `isDevAuthShortcutAllowed()`; local-only seeding helpers | release smoke (refused on staging) |
| `/api/cron/receipts-cleanup`, `/api/billing/play/rtdn`, `/api/webhooks/outlook` | secret/signature-authenticated machine endpoints | `receipt_cleanup*.test.js`, `billing_rtdn.test.js`, `outlook_oauth_state.test.js`, `cron_idempotency.test.js` |
| `/api/billing/play/verify`, `/api/crm/ocr`, `/api/crm/generate`, `/api/sync/email` | call paid / external providers (Google Play, Gemini, IMAP) | fake-provider suites (`receipt_ocr_vertical`, `gemini_ocr_check`, …); live NOT RUN by design |
| `/api/auth/register`, `/api/auth/totp/setup`, `/api/auth/passkey/*`, `/api/user/account` | create orgs/credentials or delete accounts: unsafe to spray | `auth_*`, `passkey_totp_*`, `account_deletion*.test.js` |
| `/api/admin/balances/:userId`, `/api/crm/campaign`, `/api/auth/tour-seen` | covered by feature suites; low-risk shapes | their feature suites (`leave_*`, `crm_*`, `auth_*`) |

## Handler table (generated)

| Route | Methods | Auth | Role gate | Tenant | readJsonObject | Allowlist | Validation | Error map | Audit | Test files | Fuzz matrix | Audit test |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/admin/audit` | GET | yes | **N** | Y | – | – | – | – | – | 7 | – | Y |
| `/api/admin/balances/:userId` | GET,PATCH | yes | Y | Y | Y | Y | **N** | Y | Y | 4 | – | – |
| `/api/admin/invitations/:id/resend` | POST | yes | Y | Y | **N** | **N** | **N** | Y | **N** | 11 | Y | – |
| `/api/admin/invitations/:id` | GET,DELETE | yes | Y | Y | **N** | **N** | **N** | Y | **N** | 11 | Y | – |
| `/api/admin/invitations` | GET,POST | yes | Y | Y | Y | **N** | **N** | Y | **N** | 11 | Y | – |
| `/api/admin/settings` | GET,POST,PATCH,PUT | NONE-FOUND | **N** | **N** | **N** | **N** | **N** | Y | **N** | 5 | Y | Y |
| `/api/admin/users/:userId` | GET,PATCH,DELETE | yes | Y | Y | Y | **N** | Y | Y | Y | 15 | Y | Y |
| `/api/admin/users` | GET,POST | yes | Y | Y | Y | **N** | Y | Y | Y | 15 | Y | Y |
| `/api/analytics/drill` | GET | yes | Y | Y | – | – | – | – | – | 1 | – | – |
| `/api/analytics` | GET | yes | **N** | Y | – | – | – | – | – | 8 | Y | Y |
| `/api/analytics/share/:token` | DELETE | yes | **N** | Y | **N** | **N** | Y | Y | Y | 4 | Y | Y |
| `/api/analytics/share` | GET,POST | yes | **N** | Y | **N** | **N** | Y | Y | Y | 4 | Y | Y |
| `/api/analytics/shared/:token` | GET | n/a | **N** | Y | – | – | – | – | – | 1 | – | – |
| `/api/analytics/software` | GET | yes | Y | Y | – | – | – | – | – | 2 | – | – |
| `/api/announcements/:id` | PATCH,DELETE | yes | Y | Y | Y | Y | Y | Y | Y | 11 | Y | Y |
| `/api/announcements/broadcast` | POST | yes | Y | Y | Y | **N** | Y | Y | Y | 3 | Y | – |
| `/api/announcements` | GET,POST | yes | Y | Y | Y | Y | Y | Y | Y | 11 | Y | Y |
| `/api/auth/change-password` | POST | yes | **N** | Y | Y | **N** | **N** | Y | Y | 8 | Y | Y |
| `/api/auth/invitations/:token` | GET | n/a | **N** | **N** | – | – | – | – | – | 9 | Y | – |
| `/api/auth/invitations/accept` | POST | NONE-FOUND | **N** | Y | Y | **N** | **N** | Y | **N** | 8 | Y | – |
| `/api/auth/invitations/verify` | POST | NONE-FOUND | **N** | **N** | Y | **N** | **N** | Y | **N** | 7 | Y | – |
| `/api/auth/login` | POST | NONE-FOUND | **N** | Y | Y | **N** | Y | Y | **N** | 17 | Y | – |
| `/api/auth/logout` | POST | NONE-FOUND | **N** | **N** | **N** | **N** | **N** | Y | **N** | 8 | Y | – |
| `/api/auth/me` | GET | yes | Y | Y | – | – | – | – | – | 19 | – | – |
| `/api/auth/outlook/callback` | GET | yes | **N** | Y | – | – | – | – | – | 1 | – | – |
| `/api/auth/outlook` | GET | yes | **N** | Y | – | – | – | – | – | 1 | – | – |
| `/api/auth/passkey/credentials` | GET,DELETE | yes | **N** | Y | **N** | **N** | Y | Y | Y | 1 | – | – |
| `/api/auth/passkey/login` | POST,PUT | NONE-FOUND | **N** | Y | **N** | **N** | Y | Y | Y | 3 | Y | – |
| `/api/auth/passkey/register` | POST,PUT | yes | **N** | Y | **N** | **N** | Y | Y | Y | 2 | – | – |
| `/api/auth/password-reset/check` | POST | NONE-FOUND | **N** | **N** | Y | **N** | Y | Y | **N** | 4 | Y | – |
| `/api/auth/password-reset/confirm` | POST | NONE-FOUND | **N** | Y | Y | **N** | Y | Y | Y | 7 | Y | Y |
| `/api/auth/password-reset/request` | POST | NONE-FOUND | **N** | Y | Y | **N** | **N** | Y | Y | 11 | Y | Y |
| `/api/auth/refresh` | POST | NONE-FOUND | **N** | Y | Y | **N** | Y | Y | **N** | 6 | Y | – |
| `/api/auth/register` | POST | NONE-FOUND | **N** | Y | Y | **N** | **N** | Y | Y | 18 | – | – |
| `/api/auth/send-otp` | POST | NONE-FOUND | **N** | Y | Y | **N** | Y | Y | **N** | 3 | Y | – |
| `/api/auth/setup` | POST | NONE-FOUND | **N** | Y | Y | **N** | Y | Y | **N** | 2 | Y | – |
| `/api/auth/totp/setup` | POST,PUT,DELETE | yes | **N** | Y | **N** | **N** | Y | Y | Y | 2 | – | – |
| `/api/auth/tour-seen` | POST | yes | **N** | **N** | **N** | **N** | **N** | Y | **N** | 1 | – | – |
| `/api/auth/verify-otp` | POST | NONE-FOUND | **N** | Y | **N** | **N** | Y | Y | Y | 15 | Y | – |
| `/api/billing/entitlements` | GET | yes | **N** | Y | – | – | – | – | – | 8 | – | – |
| `/api/billing/play/rtdn` | POST | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 4 | – | – |
| `/api/billing/play/verify` | POST | yes | **N** | Y | Y | **N** | **N** | Y | Y | 3 | – | – |
| `/api/crm/:id` | GET,PATCH,DELETE | yes | Y | Y | Y | Y | Y | Y | Y | 21 | Y | Y |
| `/api/crm/:id/share` | GET,POST,DELETE | yes | **N** | Y | **N** | **N** | Y | Y | Y | 21 | Y | Y |
| `/api/crm/campaign` | GET,POST | yes | Y | Y | Y | **N** | Y | Y | **N** | 4 | – | – |
| `/api/crm/generate` | POST | yes | Y | Y | Y | **N** | Y | Y | **N** | 5 | – | – |
| `/api/crm/ocr` | POST | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 4 | – | – |
| `/api/crm/reminders` | GET,PATCH | yes | **N** | Y | Y | **N** | Y | Y | **N** | 2 | Y | – |
| `/api/crm` | GET,POST | yes | **N** | Y | Y | Y | Y | Y | Y | 21 | Y | Y |
| `/api/crm/scanned-cards/:id` | PATCH,DELETE | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 6 | Y | – |
| `/api/crm/scanned-cards` | GET,POST | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 6 | Y | – |
| `/api/cron/announcements` | GET | yes | **N** | Y | – | – | – | – | – | 3 | – | – |
| `/api/cron/birthday` | GET | yes | **N** | Y | – | – | – | – | – | 4 | – | – |
| `/api/cron/onboarding` | GET | yes | **N** | Y | – | – | – | – | – | 2 | – | – |
| `/api/cron/receipts-cleanup` | GET,PUT,PATCH,DELETE,POST | yes | **N** | **N** | **N** | **N** | Y | Y | **N** | 3 | – | – |
| `/api/dev/migrate` | POST | NONE-FOUND | Y | Y | **N** | **N** | **N** | Y | **N** | 4 | – | – |
| `/api/dev/reset-to-admin` | POST | NONE-FOUND | **N** | **N** | **N** | **N** | **N** | Y | **N** | 1 | – | – |
| `/api/dev/seed` | POST | NONE-FOUND | **N** | Y | **N** | **N** | **N** | Y | **N** | 5 | – | – |
| `/api/employees/:id` | GET,PATCH | yes | Y | Y | **N** | **N** | Y | Y | Y | 11 | Y | Y |
| `/api/employees/directory` | GET | yes | **N** | Y | – | – | – | – | – | 3 | – | – |
| `/api/employees/me` | GET,PATCH | yes | Y | Y | **N** | **N** | Y | Y | Y | 10 | Y | Y |
| `/api/health` | GET | n/a | **N** | **N** | – | – | – | – | – | 4 | – | – |
| `/api/holidays` | GET,POST,DELETE | yes | Y | Y | Y | **N** | Y | Y | Y | 7 | Y | Y |
| `/api/inbox/:id` | GET,PATCH | yes | Y | Y | Y | **N** | **N** | Y | **N** | 3 | Y | – |
| `/api/inbox` | GET | yes | Y | Y | – | – | – | – | – | 3 | Y | – |
| `/api/lms/:id/document/:file` | GET | yes | Y | Y | – | – | – | – | – | 15 | Y | – |
| `/api/lms/:id` | GET,PATCH,DELETE | yes | Y | Y | **N** | Y | Y | Y | Y | 15 | Y | – |
| `/api/lms/balance` | GET | yes | **N** | Y | – | – | – | – | – | 4 | – | – |
| `/api/lms/calendar` | GET | yes | Y | Y | – | – | – | – | – | 2 | – | – |
| `/api/lms` | GET,POST | yes | Y | Y | **N** | Y | Y | Y | Y | 15 | Y | – |
| `/api/lms/workload` | GET | yes | Y | Y | – | – | – | – | – | 2 | – | – |
| `/api/mail/drafts/:id` | GET,PATCH,DELETE | yes | **N** | Y | Y | **N** | Y | Y | **N** | 5 | Y | – |
| `/api/mail/drafts` | GET,POST | yes | **N** | Y | Y | **N** | Y | Y | **N** | 5 | Y | – |
| `/api/notifications` | GET,POST | yes | Y | Y | Y | **N** | Y | Y | Y | 7 | Y | – |
| `/api/org/mail-config` | GET,PUT,DELETE | yes | Y | Y | Y | **N** | **N** | Y | Y | 4 | Y | – |
| `/api/org/settings` | GET,POST,PATCH,PUT | NONE-FOUND | **N** | **N** | **N** | **N** | **N** | Y | **N** | 13 | Y | Y |
| `/api/reports` | GET | yes | Y | Y | – | – | – | – | – | 2 | – | – |
| `/api/rms/:id/receipt/:file` | GET | yes | Y | Y | – | – | – | – | – | 22 | Y | – |
| `/api/rms/:id` | GET,PATCH,DELETE | yes | Y | Y | **N** | Y | Y | Y | Y | 22 | Y | – |
| `/api/rms/ocr` | GET,POST | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 3 | Y | – |
| `/api/rms` | GET,POST | yes | Y | Y | **N** | Y | Y | Y | Y | 22 | Y | – |
| `/api/search` | GET | yes | Y | Y | – | – | – | – | – | 4 | – | – |
| `/api/support/chat` | POST | NONE-FOUND | **N** | **N** | **N** | **N** | **N** | Y | **N** | 3 | Y | – |
| `/api/sync/email` | POST,GET | yes | Y | Y | **N** | **N** | **N** | Y | **N** | 1 | – | – |
| `/api/travel/:id/expense` | POST | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 15 | Y | – |
| `/api/travel/:id/itinerary/:file` | GET | yes | Y | Y | – | – | – | – | – | 15 | Y | – |
| `/api/travel/:id` | GET,PATCH,DELETE | yes | Y | Y | **N** | **N** | Y | Y | Y | 15 | Y | – |
| `/api/travel` | GET,POST | yes | Y | Y | **N** | **N** | Y | Y | Y | 15 | Y | – |
| `/api/uploads/sign` | POST | yes | **N** | Y | **N** | **N** | Y | Y | **N** | 16 | Y | – |
| `/api/user/account` | DELETE | yes | **N** | Y | **N** | **N** | **N** | Y | **N** | 2 | – | – |
| `/api/user/email-config` | GET,POST,DELETE | yes | **N** | Y | Y | **N** | Y | Y | Y | 5 | Y | Y |
| `/api/user/email-config/test` | POST | yes | **N** | Y | **N** | **N** | **N** | Y | **N** | 2 | Y | – |
| `/api/webhooks/outlook` | GET,POST | yes | **N** | Y | Y | **N** | Y | Y | **N** | 2 | – | – |
