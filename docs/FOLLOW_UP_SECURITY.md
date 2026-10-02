# Follow-Up Security & Multi-Tenancy Findings

This document tracks secondary security and multi-tenancy observations identified during the **Batch B: Multi-Tenant Security Hardening** audit that do not represent immediate cross-tenant data leaks but should be prioritized in subsequent batches.

---

### 1. Holiday Model Lacks Tenant Scoping
- **Path**: `web/app/api/holidays/route.ts`, `web/models/Holiday.ts`
- **Observation**: Holidays are stored globally without an `orgId` column. All tenants share the same company calendar.
- **Recommendation**: Add `{ orgId: { type: String, default: 'org_doppelmayr', index: true } }` to `HolidaySchema` if distinct organizations operate on different holiday calendars.

---

### 2. Single-Tenant Global IMAP Configuration
- **Path**: `web/lib/imap.ts`, `web/app/api/sync/email/route.ts`
- **Observation**: IMAP credentials (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`) are loaded from environment variables rather than per-organization database configuration.
- **Risk**: Other tenants cannot configure their own mailboxes without utilizing Doppelmayr's centralized inbox relay.
- **Recommendation**: Move IMAP credentials to an encrypted per-organization settings model (`OrgMailSettings`) in a future batch.

---

### 3. Local Development Helper Endpoints
- **Path**: `web/app/api/dev/create-user/route.ts`, `web/app/api/dev/reset-password/route.ts`
- **Observation**: Development helper endpoints are gated by `process.env.NODE_ENV === 'production'`.
- **Recommendation**: Ensure CI/CD build scripts completely exclude the `dev/` directory from production container images.

---

### 4. Background Job Authentication Secret Rotation
- **Path**: `web/app/api/cron/announcements/route.ts`, `web/app/api/cron/birthday/route.ts`, `web/app/api/cron/onboarding/route.ts`
- **Observation**: Crons now strictly enforce `CRON_SECRET` and fail closed if unset or mismatched.
- **Recommendation**: Ensure `CRON_SECRET` in production is a high-entropy 64-character secret and rotated regularly.
