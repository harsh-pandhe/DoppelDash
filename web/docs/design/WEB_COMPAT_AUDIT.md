# Web ↔ shared backend compatibility audit

Locked architecture: one backend, one MongoDB, one auth/org/user/entitlement system; Web = Doppelmayr India client, Android = public DoppelDash client. The approved Web UI is NOT redesigned (see "Visual lock").

## Method
Static inventory (all 100 API routes vs every `/api/...` call made by Web pages/components vs every path Android calls) + live round-trip tests with a Bearer (Android carrier) and a `dd_session` cookie (Web carrier) against the same throwaway DB (`tests/web_android_shared_data.test.js`).

## Findings
| Area | Web API | Collection(s) | Shared contract | Org-scoped | Role gate (server) | Entitlement | Android↔Web verified |
|---|---|---|---|---|---|---|---|
| Auth / OTP / passkey / refresh | /auth/login, verify-otp, passkey/*, refresh, me | users, refreshtokens, passkeycredentials | same routes Android calls | n/a | n/a | webEnabled gate in getUser | S1 |
| Reset / invite | /auth/password-reset/*, /auth/invitations/* | passwordresettokens, invitations | POST body tokens (both clients) | server-derived | — | — | Android E2E (live) |
| Dashboard | server components | expenses, travelrequests, leaves, users, employees, auditlogs | direct Mongo, `orgId` from getUser | yes | role from server | — | tenant isolation test |
| CRM/contacts/OCR | /crm, /crm/[id], /crm/ocr, scanned-cards | contacts, scannedcards | same | yes | yes | maxContacts via org limit | S4 |
| Expenses | /rms | expenses | same | yes | yes (no self-approval) | — | S5, S6, S14 |
| Travel | /travel | travelrequests | same | yes | yes | — | S7 |
| Leave | /lms, /lms/balance | leaves, leavebalances | same | yes | yes | — | S8 |
| Announcements | /announcements | announcements | same | yes | employee blocked | broadcast limits | S9 |
| Notifications / search | /notifications, /search | derived from above | same | yes | yes | — | S10 |
| Org settings / admin | /org/settings, /admin/* | orgsettings, users, auditlogs | same | yes | admin | — | S10, S11 |
| Billing | /billing/entitlements | organizations, subscriptions | same resolver | yes | — | resolver only | S2 |
| Mail / inbox | /inbox, /mail/drafts, /sync/email | inboxmessages, maildrafts, orgmailconfigs | same | yes | mailAccess | — | existing mail tests |
| Cron | /cron/* | announcements, employees | secret header | yes | — | — | existing batch tests |

No legacy Web-only schema or duplicate Web-only backend was found: Web pages call the same routes Android calls. The 3 apparent "missing routes" in the scan are template-string false positives (`/api/lms${…}`, `/api/rms${…}`, `/api/inbox${…}`).

## Entitlement
Organization model already matches the locked table (free/none, premium/subscription, Doppelmayr premium/lifetime_grant/webEnabled/androidEnabled). `ensureDoppelmayr()` verified in S3. No runtime orgId/slug/name/domain entitlement checks (S13, `web_access_boundary` source scan).

## Defects found
1. `POST /api/rms` returned an unhandled **500** for an invalid payload (missing `startDate`). Now **400** with `fields`; regression S14.

## Non-blocking observations (not changed)
- `lib/export.ts` PDFs and `mail/page.tsx` signature hard-code "Doppelmayr India" branding text (brand copy for the Web client, not entitlement logic).
- `user?.role || 'employee'` on the server defaults an absent role to least privilege; no client-side role default remains (Sidebar/Header fixed).

## Visual lock
Auth pages, shell and dashboards use the original approved markup. Only copy changed: "Sign in to DoppelDash" → "Sign in to Doppelmayr India", sidebar/footer/restricted/forgot/reset/invite brand wording, the restricted-page explanation, tour title. Evidence: `docs/design/screenshots/phase2-final/`.
