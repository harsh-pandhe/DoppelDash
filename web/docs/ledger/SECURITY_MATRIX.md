# DoppelDash API Route & Tenant Security Matrix (G2 Baseline)

*Generated on 2026-10-15 by `web/scripts/inventory/generate-security-matrix.js`.*

## Executive Summary

- **Total API Route Files**: 92
- **Total Method Handlers**: 151
- **Public Handlers**: 18 (authentication, invitations, shared dashboard, support chat, public assets)
- **Session-Authenticated Handlers**: 118
- **Service-Authenticated Handlers**: 15 (cron jobs, RTDN webhook, Outlook notifications, dev seed)
- **Handlers with Test Coverage**: 105
- **Handlers with Coverage Gaps**: 46
- **P0 Launch Blockers**: 1 (RTDN Pub/Sub OIDC, Account Deletion Integrity)
- **P1 High-Risk Gaps**: 7 (Passkey, TOTP, Shared Analytics, Outlook Webhook, Support Chat)

## High-Risk Group Analysis (Batch 1)

### 1. Public Auth, Reset, Passkey, TOTP & Invitations (24 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/auth/invitations/[token]` | public | none | none | none | **NONE** | `GAPS_FOUND` |
| **HEAD** | `/api/auth/invitations/[token]` | public | none | none | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/auth/invitations/accept` | public | none | none | webEnabled | `tests/auth_foundation.test.js` +3 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/invitations/verify` | public | none | none | none | `tests/batch_f.test.js` +2 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/login` | public | none | none | none | `tests/auth_foundation.test.js` +12 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/logout` | public | none | none | none | `tests/batch_h.test.js` +6 | `VERIFIED_FAKE` |
| **DELETE** | `/api/auth/passkey/credentials` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_security.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/auth/passkey/credentials` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_security.test.js` | `VERIFIED_FAKE` |
| **POST** | `/api/auth/passkey/login` | public | none | none | webEnabled + plan:premium | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **PUT** | `/api/auth/passkey/login` | public | none | none | webEnabled + plan:premium | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/passkey/register` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **PUT** | `/api/auth/passkey/register` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/password-reset/check` | public | lookup_token (User by email/token) | none | none | `tests/batch_h.test.js` +2 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/password-reset/confirm` | public | lookup_token (User by email/token) | none | none | `tests/auth_foundation.test.js` +3 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/password-reset/request` | public | lookup_token (User by email/token) | none | none | `tests/auth_foundation.test.js` +6 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/refresh` | public | none | none | none | `tests/auth_foundation.test.js` +2 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/register` | public | none | none | webEnabled + plan:premium | `tests/auth_me_contract.test.js` +15 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/send-otp` | public | none | none | none | `tests/secret_exposure.test.js` | `VERIFIED_FAKE` |
| **POST** | `/api/auth/setup` | service | service_context | none | none | `tests/batch_k.test.js` | `VERIFIED_FAKE` |
| **DELETE** | `/api/auth/totp/setup` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/totp/setup` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **PUT** | `/api/auth/totp/setup` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/passkey_totp_concurrency.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/auth/tour-seen` | session | session_jwt (unscoped / user-only) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/auth/verify-otp` | public | none | none | webEnabled + plan:premium | `tests/auth_foundation.test.js` +10 | `VERIFIED_FAKE` |

### 10. Mail & Inbox (8 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/inbox` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/inbox/[id]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/inbox/[id]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/mail/drafts` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/mail/drafts` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **DELETE** | `/api/mail/drafts/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/mail/drafts/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/mail/drafts/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |

### 11. Admin, Users & Profiles (27 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/admin/audit` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/batch_i.test.js` +2 | `VERIFIED_FAKE` |
| **GET** | `/api/admin/balances/[userId]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/admin/balances/[userId]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/admin/invitations` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/auth_foundation.test.js` +5 | `VERIFIED_FAKE` |
| **POST** | `/api/admin/invitations` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/auth_foundation.test.js` +5 | `VERIFIED_FAKE` |
| **DELETE** | `/api/admin/invitations/[id]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/admin/invitations/[id]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/admin/invitations/[id]/resend` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/admin/settings` | session | session_jwt (user.orgId) | admin | none | `tests/batch_e.test.js` | `VERIFIED_FAKE` |
| **PATCH** | `/api/admin/settings` | session | session_jwt (user.orgId) | admin | none | `tests/batch_e.test.js` | `VERIFIED_FAKE` |
| **POST** | `/api/admin/settings` | session | session_jwt (user.orgId) | admin | none | `tests/batch_e.test.js` | `VERIFIED_FAKE` |
| **PUT** | `/api/admin/settings` | session | session_jwt (user.orgId) | admin | none | `tests/batch_e.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/admin/users` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/auth_foundation.test.js` +7 | `VERIFIED_FAKE` |
| **POST** | `/api/admin/users` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/auth_foundation.test.js` +7 | `VERIFIED_FAKE` |
| **DELETE** | `/api/admin/users/[userId]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/admin/users/[userId]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/admin/users/[userId]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/employees/[id]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/employees/[id]` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/employees/directory` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/auth_foundation.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/employees/me` | session | session_jwt (user.orgId) | admin | none | `tests/auth_foundation.test.js` +4 | `VERIFIED_FAKE` |
| **PATCH** | `/api/employees/me` | session | session_jwt (user.orgId) | admin | none | `tests/auth_foundation.test.js` +4 | `VERIFIED_FAKE` |
| **DELETE** | `/api/user/account` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/account_deletion.test.js` +1 | `VERIFIED_FAKE` |
| **DELETE** | `/api/user/email-config` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/user/email-config` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/user/email-config` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/user/email-config/test` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |

### 12. Leave, Holidays & LMS (10 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **DELETE** | `/api/holidays` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/holidays` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/holidays` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **DELETE** | `/api/lms/[id]` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/lms/[id]` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **PATCH** | `/api/lms/[id]` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/lms/[id]/document/[file]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/lms/balance` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/batch_j.test.js` +2 | `VERIFIED_FAKE` |
| **GET** | `/api/lms/calendar` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/lms/workload` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |

### 13. Announcements & Notifications (7 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/announcements` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/batch_c.test.js` +3 | `VERIFIED_FAKE` |
| **POST** | `/api/announcements` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/batch_c.test.js` +3 | `VERIFIED_FAKE` |
| **DELETE** | `/api/announcements/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/announcements/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/announcements/broadcast` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/notifications` | session | session_jwt (user.orgId) | admin | none | `tests/auth_foundation.test.js` +3 | `VERIFIED_FAKE` |
| **POST** | `/api/notifications` | session | session_jwt (user.orgId) | admin | none | `tests/auth_foundation.test.js` +3 | `VERIFIED_FAKE` |

### 14. Reports & Analytics Core (4 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/analytics` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/analytics_share_security.test.js` +3 | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/drill` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/software` | session | session_jwt (user.orgId) | admin | none | `tests/batch_b.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/reports` | session | session_jwt (user.orgId) | admin | none | **NONE** | `GAPS_FOUND` |

### 15. General Settings & Sync (16 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **POST** | `/api/auth/change-password` | session | session_jwt (unscoped / user-only) | any_authenticated | none | `tests/auth_foundation.test.js` +4 | `VERIFIED_FAKE` |
| **GET** | `/api/auth/me` | session | session_jwt (user.orgId) | admin | webEnabled + plan:premium | `tests/auth_foundation.test.js` +14 | `VERIFIED_FAKE` |
| **GET** | `/api/crm` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/auth_foundation.test.js` +12 | `VERIFIED_FAKE` |
| **POST** | `/api/crm` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/auth_foundation.test.js` +12 | `VERIFIED_FAKE` |
| **GET** | `/api/lms` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/auth_foundation.test.js` +7 | `VERIFIED_FAKE` |
| **POST** | `/api/lms` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/auth_foundation.test.js` +7 | `VERIFIED_FAKE` |
| **DELETE** | `/api/org/mail-config` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/mail_architecture.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/org/mail-config` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/mail_architecture.test.js` +1 | `VERIFIED_FAKE` |
| **PUT** | `/api/org/mail-config` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/mail_architecture.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/org/settings` | session | session_jwt (user.orgId) | admin | none | `tests/auth_me_contract.test.js` +6 | `VERIFIED_FAKE` |
| **PATCH** | `/api/org/settings` | session | session_jwt (user.orgId) | admin | none | `tests/auth_me_contract.test.js` +6 | `VERIFIED_FAKE` |
| **POST** | `/api/org/settings` | session | session_jwt (user.orgId) | admin | none | `tests/auth_me_contract.test.js` +6 | `VERIFIED_FAKE` |
| **PUT** | `/api/org/settings` | session | session_jwt (user.orgId) | admin | none | `tests/auth_me_contract.test.js` +6 | `VERIFIED_FAKE` |
| **GET** | `/api/search` | session | session_jwt (user.orgId) | admin | none | `tests/batch_b.test.js` +2 | `VERIFIED_FAKE` |
| **GET** | `/api/sync/email` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/sync/email` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |

### 2. Shared Analytics & Public Token Links (4 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/analytics/share` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/analytics_share_security.test.js` | `VERIFIED_FAKE` |
| **POST** | `/api/analytics/share` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/analytics_share_security.test.js` | `VERIFIED_FAKE` |
| **DELETE** | `/api/analytics/share/[token]` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/analytics_share_security.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/shared/[token]` | public | lookup_token (SharedDashboard.orgId) | none | none | `tests/analytics_share_security.test.js` | `VERIFIED_FAKE` |

### 3. Outlook Webhooks & OAuth / Token Handling (4 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/auth/outlook` | session | session_jwt (unscoped / user-only) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/auth/outlook/callback` | service | service_global | none | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/webhooks/outlook` | service | service_context | none | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/webhooks/outlook` | service | service_context | none | none | **NONE** | `GAPS_FOUND` |

### 4. Upload Signing, Receipts & Private Streaming (1 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **POST** | `/api/uploads/sign` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/expense_idempotency_receipts.test.js` +12 | `VERIFIED_FAKE` |

### 5. Support Chat, Cron & Destructive Dev Endpoints (12 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/cron/announcements` | service | service_context | none | none | `tests/batch_c.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/cron/birthday` | service | service_context | none | none | `tests/batch_c.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/cron/onboarding` | service | service_context | none | none | `tests/batch_c.test.js` +1 | `VERIFIED_FAKE` |
| **DELETE** | `/api/cron/receipts-cleanup` | service | service_global | none | none | `tests/receipt_cleanup.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/cron/receipts-cleanup` | service | service_global | none | none | `tests/receipt_cleanup.test.js` +1 | `VERIFIED_FAKE` |
| **PATCH** | `/api/cron/receipts-cleanup` | service | service_global | none | none | `tests/receipt_cleanup.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/cron/receipts-cleanup` | service | service_global | none | none | `tests/receipt_cleanup.test.js` +1 | `VERIFIED_FAKE` |
| **PUT** | `/api/cron/receipts-cleanup` | service | service_global | none | none | `tests/receipt_cleanup.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/dev/migrate` | service | service_context | none | none | `tests/batch_k.test.js` +3 | `VERIFIED_FAKE` |
| **POST** | `/api/dev/reset-to-admin` | service | service_global | none | none | `tests/batch_k.test.js` | `VERIFIED_FAKE` |
| **POST** | `/api/dev/seed` | service | service_context | none | none | `tests/batch_k.test.js` +4 | `VERIFIED_FAKE` |
| **POST** | `/api/support/chat` | public | none | none | none | `tests/support_chat_security.test.js` | `VERIFIED_FAKE` |

### 6. Billing, RTDN, Entitlements & Account Deletion (3 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/billing/entitlements` | session | session_jwt (user.orgId) | any_authenticated | webEnabled + plan:premium | `tests/auth_foundation.test.js` +6 | `VERIFIED_FAKE` |
| **POST** | `/api/billing/play/rtdn` | public | none | none | plan:premium | `tests/batch_m.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/billing/play/verify` | session | session_jwt (user.orgId) | any_authenticated | webEnabled + plan:premium | `tests/batch_m.test.js` | `VERIFIED_FAKE` |

### 7. CRM Vertical (16 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **DELETE** | `/api/crm/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/crm/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **PATCH** | `/api/crm/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` | `VERIFIED_FAKE` |
| **DELETE** | `/api/crm/[id]/share` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/crm/[id]/share` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **POST** | `/api/crm/[id]/share` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **GET** | `/api/crm/campaign` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/batch_l.test.js` +2 | `VERIFIED_FAKE` |
| **POST** | `/api/crm/campaign` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/batch_l.test.js` +2 | `VERIFIED_FAKE` |
| **POST** | `/api/crm/generate` | session | session_jwt (user.orgId) | admin | plan:premium | `tests/batch_c.test.js` +3 | `VERIFIED_FAKE` |
| **POST** | `/api/crm/ocr` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/batch_i.test.js` +2 | `VERIFIED_FAKE` |
| **GET** | `/api/crm/reminders` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/crm_vertical.test.js` | `VERIFIED_FAKE` |
| **PATCH** | `/api/crm/reminders` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/crm_vertical.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/crm/scanned-cards` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/batch_c.test.js` +2 | `VERIFIED_FAKE` |
| **POST** | `/api/crm/scanned-cards` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/batch_c.test.js` +2 | `VERIFIED_FAKE` |
| **DELETE** | `/api/crm/scanned-cards/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |
| **PATCH** | `/api/crm/scanned-cards/[id]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |

### 8. Travel Vertical (7 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/travel` | session | session_jwt (user.orgId) | admin | none | `tests/auth_foundation.test.js` +10 | `VERIFIED_FAKE` |
| **POST** | `/api/travel` | session | session_jwt (user.orgId) | admin | none | `tests/auth_foundation.test.js` +10 | `VERIFIED_FAKE` |
| **DELETE** | `/api/travel/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/travel/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` +1 | `VERIFIED_FAKE` |
| **PATCH** | `/api/travel/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` +1 | `VERIFIED_FAKE` |
| **POST** | `/api/travel/[id]/expense` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/batch_j.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/travel/[id]/itinerary/[file]` | session | session_jwt (user.orgId) | any_authenticated | none | **NONE** | `GAPS_FOUND` |

### 9. Expenses & RMS Vertical (8 handlers)

| Method | Route | Auth | Tenant Source | Role | Entitlement | Tests | Status |
|---|---|---|---|---|---|---|---|
| **GET** | `/api/rms` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/auth_foundation.test.js` +16 | `VERIFIED_FAKE` |
| **POST** | `/api/rms` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/auth_foundation.test.js` +16 | `VERIFIED_FAKE` |
| **DELETE** | `/api/rms/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/rms/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` +1 | `VERIFIED_FAKE` |
| **PATCH** | `/api/rms/[id]` | session | session_jwt (user.orgId) | admin | none | `tests/batch_i.test.js` +1 | `VERIFIED_FAKE` |
| **GET** | `/api/rms/[id]/receipt/[file]` | session | session_jwt (user.orgId) | any_authenticated | none | `tests/receipt_ocr_vertical.test.js` | `VERIFIED_FAKE` |
| **GET** | `/api/rms/ocr` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/receipt_ocr_vertical.test.js` | `VERIFIED_FAKE` |
| **POST** | `/api/rms/ocr` | session | session_jwt (user.orgId) | any_authenticated | plan:premium | `tests/receipt_ocr_vertical.test.js` | `VERIFIED_FAKE` |

## Full Handlers Inventory

| Method | Route | File | Auth | Role | Status |
|---|---|---|---|---|---|
| **GET** | `/api/admin/audit` | `app/api/admin/audit/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/admin/balances/[userId]` | `app/api/admin/balances/[userId]/route.ts` | session | admin | `GAPS_FOUND` |
| **PATCH** | `/api/admin/balances/[userId]` | `app/api/admin/balances/[userId]/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/admin/invitations` | `app/api/admin/invitations/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/admin/invitations` | `app/api/admin/invitations/route.ts` | session | admin | `VERIFIED_FAKE` |
| **DELETE** | `/api/admin/invitations/[id]` | `app/api/admin/invitations/[id]/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/admin/invitations/[id]` | `app/api/admin/invitations/[id]/route.ts` | session | admin | `GAPS_FOUND` |
| **POST** | `/api/admin/invitations/[id]/resend` | `app/api/admin/invitations/[id]/resend/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/admin/settings` | `app/api/admin/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/admin/settings` | `app/api/admin/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/admin/settings` | `app/api/admin/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PUT** | `/api/admin/settings` | `app/api/admin/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/admin/users` | `app/api/admin/users/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/admin/users` | `app/api/admin/users/route.ts` | session | admin | `VERIFIED_FAKE` |
| **DELETE** | `/api/admin/users/[userId]` | `app/api/admin/users/[userId]/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/admin/users/[userId]` | `app/api/admin/users/[userId]/route.ts` | session | admin | `GAPS_FOUND` |
| **PATCH** | `/api/admin/users/[userId]` | `app/api/admin/users/[userId]/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/analytics` | `app/api/analytics/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/drill` | `app/api/analytics/drill/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/share` | `app/api/analytics/share/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/analytics/share` | `app/api/analytics/share/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/analytics/share/[token]` | `app/api/analytics/share/[token]/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/shared/[token]` | `app/api/analytics/shared/[token]/route.ts` | public | none | `VERIFIED_FAKE` |
| **GET** | `/api/analytics/software` | `app/api/analytics/software/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/announcements` | `app/api/announcements/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/announcements` | `app/api/announcements/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/announcements/[id]` | `app/api/announcements/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **PATCH** | `/api/announcements/[id]` | `app/api/announcements/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/announcements/broadcast` | `app/api/announcements/broadcast/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/auth/change-password` | `app/api/auth/change-password/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/auth/invitations/[token]` | `app/api/auth/invitations/[token]/route.ts` | public | none | `GAPS_FOUND` |
| **HEAD** | `/api/auth/invitations/[token]` | `app/api/auth/invitations/[token]/route.ts` | public | none | `GAPS_FOUND` |
| **POST** | `/api/auth/invitations/accept` | `app/api/auth/invitations/accept/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/invitations/verify` | `app/api/auth/invitations/verify/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/login` | `app/api/auth/login/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/logout` | `app/api/auth/logout/route.ts` | public | none | `VERIFIED_FAKE` |
| **GET** | `/api/auth/me` | `app/api/auth/me/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/auth/outlook` | `app/api/auth/outlook/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/auth/outlook/callback` | `app/api/auth/outlook/callback/route.ts` | service | none | `GAPS_FOUND` |
| **DELETE** | `/api/auth/passkey/credentials` | `app/api/auth/passkey/credentials/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/auth/passkey/credentials` | `app/api/auth/passkey/credentials/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/auth/passkey/login` | `app/api/auth/passkey/login/route.ts` | public | none | `VERIFIED_FAKE` |
| **PUT** | `/api/auth/passkey/login` | `app/api/auth/passkey/login/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/passkey/register` | `app/api/auth/passkey/register/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **PUT** | `/api/auth/passkey/register` | `app/api/auth/passkey/register/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/auth/password-reset/check` | `app/api/auth/password-reset/check/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/password-reset/confirm` | `app/api/auth/password-reset/confirm/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/password-reset/request` | `app/api/auth/password-reset/request/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/refresh` | `app/api/auth/refresh/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/register` | `app/api/auth/register/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/send-otp` | `app/api/auth/send-otp/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/auth/setup` | `app/api/auth/setup/route.ts` | service | none | `VERIFIED_FAKE` |
| **DELETE** | `/api/auth/totp/setup` | `app/api/auth/totp/setup/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/auth/totp/setup` | `app/api/auth/totp/setup/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **PUT** | `/api/auth/totp/setup` | `app/api/auth/totp/setup/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/auth/tour-seen` | `app/api/auth/tour-seen/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/auth/verify-otp` | `app/api/auth/verify-otp/route.ts` | public | none | `VERIFIED_FAKE` |
| **GET** | `/api/billing/entitlements` | `app/api/billing/entitlements/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/billing/play/rtdn` | `app/api/billing/play/rtdn/route.ts` | public | none | `VERIFIED_FAKE` |
| **POST** | `/api/billing/play/verify` | `app/api/billing/play/verify/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/crm` | `app/api/crm/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/crm` | `app/api/crm/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/crm/[id]` | `app/api/crm/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/crm/[id]` | `app/api/crm/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/crm/[id]` | `app/api/crm/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **DELETE** | `/api/crm/[id]/share` | `app/api/crm/[id]/share/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/crm/[id]/share` | `app/api/crm/[id]/share/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/crm/[id]/share` | `app/api/crm/[id]/share/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/crm/campaign` | `app/api/crm/campaign/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/crm/campaign` | `app/api/crm/campaign/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/crm/generate` | `app/api/crm/generate/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/crm/ocr` | `app/api/crm/ocr/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/crm/reminders` | `app/api/crm/reminders/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **PATCH** | `/api/crm/reminders` | `app/api/crm/reminders/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/crm/scanned-cards` | `app/api/crm/scanned-cards/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/crm/scanned-cards` | `app/api/crm/scanned-cards/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/crm/scanned-cards/[id]` | `app/api/crm/scanned-cards/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **PATCH** | `/api/crm/scanned-cards/[id]` | `app/api/crm/scanned-cards/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/cron/announcements` | `app/api/cron/announcements/route.ts` | service | none | `VERIFIED_FAKE` |
| **GET** | `/api/cron/birthday` | `app/api/cron/birthday/route.ts` | service | none | `VERIFIED_FAKE` |
| **GET** | `/api/cron/onboarding` | `app/api/cron/onboarding/route.ts` | service | none | `VERIFIED_FAKE` |
| **DELETE** | `/api/cron/receipts-cleanup` | `app/api/cron/receipts-cleanup/route.ts` | service | none | `VERIFIED_FAKE` |
| **GET** | `/api/cron/receipts-cleanup` | `app/api/cron/receipts-cleanup/route.ts` | service | none | `VERIFIED_FAKE` |
| **PATCH** | `/api/cron/receipts-cleanup` | `app/api/cron/receipts-cleanup/route.ts` | service | none | `VERIFIED_FAKE` |
| **POST** | `/api/cron/receipts-cleanup` | `app/api/cron/receipts-cleanup/route.ts` | service | none | `VERIFIED_FAKE` |
| **PUT** | `/api/cron/receipts-cleanup` | `app/api/cron/receipts-cleanup/route.ts` | service | none | `VERIFIED_FAKE` |
| **POST** | `/api/dev/migrate` | `app/api/dev/migrate/route.ts` | service | none | `VERIFIED_FAKE` |
| **POST** | `/api/dev/reset-to-admin` | `app/api/dev/reset-to-admin/route.ts` | service | none | `VERIFIED_FAKE` |
| **POST** | `/api/dev/seed` | `app/api/dev/seed/route.ts` | service | none | `VERIFIED_FAKE` |
| **GET** | `/api/employees/[id]` | `app/api/employees/[id]/route.ts` | session | admin | `GAPS_FOUND` |
| **PATCH** | `/api/employees/[id]` | `app/api/employees/[id]/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/employees/directory` | `app/api/employees/directory/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/employees/me` | `app/api/employees/me/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/employees/me` | `app/api/employees/me/route.ts` | session | admin | `VERIFIED_FAKE` |
| **DELETE** | `/api/holidays` | `app/api/holidays/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/holidays` | `app/api/holidays/route.ts` | session | admin | `GAPS_FOUND` |
| **POST** | `/api/holidays` | `app/api/holidays/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/inbox` | `app/api/inbox/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/inbox/[id]` | `app/api/inbox/[id]/route.ts` | session | admin | `GAPS_FOUND` |
| **PATCH** | `/api/inbox/[id]` | `app/api/inbox/[id]/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/lms` | `app/api/lms/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/lms` | `app/api/lms/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/lms/[id]` | `app/api/lms/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/lms/[id]` | `app/api/lms/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/lms/[id]` | `app/api/lms/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/lms/[id]/document/[file]` | `app/api/lms/[id]/document/[file]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/lms/balance` | `app/api/lms/balance/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/lms/calendar` | `app/api/lms/calendar/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/lms/workload` | `app/api/lms/workload/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/mail/drafts` | `app/api/mail/drafts/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/mail/drafts` | `app/api/mail/drafts/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **DELETE** | `/api/mail/drafts/[id]` | `app/api/mail/drafts/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/mail/drafts/[id]` | `app/api/mail/drafts/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **PATCH** | `/api/mail/drafts/[id]` | `app/api/mail/drafts/[id]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/notifications` | `app/api/notifications/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/notifications` | `app/api/notifications/route.ts` | session | admin | `VERIFIED_FAKE` |
| **DELETE** | `/api/org/mail-config` | `app/api/org/mail-config/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/org/mail-config` | `app/api/org/mail-config/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PUT** | `/api/org/mail-config` | `app/api/org/mail-config/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/org/settings` | `app/api/org/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/org/settings` | `app/api/org/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/org/settings` | `app/api/org/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PUT** | `/api/org/settings` | `app/api/org/settings/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/reports` | `app/api/reports/route.ts` | session | admin | `GAPS_FOUND` |
| **GET** | `/api/rms` | `app/api/rms/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/rms` | `app/api/rms/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/rms/[id]` | `app/api/rms/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/rms/[id]` | `app/api/rms/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/rms/[id]` | `app/api/rms/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/rms/[id]/receipt/[file]` | `app/api/rms/[id]/receipt/[file]/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/rms/ocr` | `app/api/rms/ocr/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **POST** | `/api/rms/ocr` | `app/api/rms/ocr/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/search` | `app/api/search/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/support/chat` | `app/api/support/chat/route.ts` | public | none | `VERIFIED_FAKE` |
| **GET** | `/api/sync/email` | `app/api/sync/email/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/sync/email` | `app/api/sync/email/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/travel` | `app/api/travel/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/travel` | `app/api/travel/route.ts` | session | admin | `VERIFIED_FAKE` |
| **DELETE** | `/api/travel/[id]` | `app/api/travel/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **GET** | `/api/travel/[id]` | `app/api/travel/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **PATCH** | `/api/travel/[id]` | `app/api/travel/[id]/route.ts` | session | admin | `VERIFIED_FAKE` |
| **POST** | `/api/travel/[id]/expense` | `app/api/travel/[id]/expense/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **GET** | `/api/travel/[id]/itinerary/[file]` | `app/api/travel/[id]/itinerary/[file]/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/uploads/sign` | `app/api/uploads/sign/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/user/account` | `app/api/user/account/route.ts` | session | any_authenticated | `VERIFIED_FAKE` |
| **DELETE** | `/api/user/email-config` | `app/api/user/email-config/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/user/email-config` | `app/api/user/email-config/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/user/email-config` | `app/api/user/email-config/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **POST** | `/api/user/email-config/test` | `app/api/user/email-config/test/route.ts` | session | any_authenticated | `GAPS_FOUND` |
| **GET** | `/api/webhooks/outlook` | `app/api/webhooks/outlook/route.ts` | service | none | `GAPS_FOUND` |
| **POST** | `/api/webhooks/outlook` | `app/api/webhooks/outlook/route.ts` | service | none | `GAPS_FOUND` |

