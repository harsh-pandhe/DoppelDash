# Account and organisation deletion — data inventory and policy (P0-02)

Status: **mechanics FAKE-VERIFIED; retention policy BLOCKED on owner decision D-02.** Code: `lib/account/deletion.ts`, `app/api/user/account/route.ts`; tests: `tests/account_deletion.test.js`, `tests/account_deletion_integrity.test.js`.

## What changed (policy-independent hardening)
* The old route swallowed every failure (`Promise.allSettled`) and always answered success, deleted the organisation/user before other data, and its disband list missed 9 tenant collections and all private files.
* Now: ordered, idempotent, retryable plan — (1) private blobs (manifest rows are kept until the provider confirmed deletion), (2) tenant/personal data, (3) the organisation, (4) personal credentials/Employee/User **last**. Success is reported only if every step succeeded; otherwise **HTTP 500 `deletion_incomplete`**, the account stays intact and signed in, and the same request can be repeated. A repeat after completion is a 401, never a false success.
* Audit trail: `user.account_deletion_incomplete` (failed step names only) and, on success, `user.account_deleted`.

## Inventory (all models with tenant or user keys)
| Data | Sole-owner disband (non-lifetime org) | Member / owner-of-protected-org self-deletion |
|---|---|---|
| Expenses (+line items), TravelRequests, Leave, LeaveBalance | deleted | **retained** (business records of the organisation) — *decision* |
| Contacts, ScannedCards, CampaignLog, Announcements, PublicHolidays, SharedDashboards, Invitations | deleted | retained — *decision* |
| InboxMessage, OrgMailConfig, OutlookToken, SyncState, UsageCounter, Subscription, OrgSettings | deleted | OutlookToken/own mail config/drafts of the member deleted; rest retained |
| Private files (ReceiptUpload manifest + Cloudinary assets) | deleted (provider confirmation required) | retained with the records that reference them — *decision* |
| User, Employee, RefreshToken, PasswordResetToken, PasskeyCredential, UserEmailConfig, MailDraft | deleted | deleted |
| Organization | deleted | kept (protected lifetime orgs are never disbanded) |
| **AuditLog** | **retained** (contains the deleted user's e-mail in `user.account_deleted` metadata) | retained |
| Google Play subscription | record deleted; **the Play subscription itself must be cancelled by the user in Play** (the server cannot cancel it) | — |

## Decisions needed (D-02) — recommended defaults in italics
1. Retention of financial/HR records after a *member* leaves: *keep, but pseudonymise `userName`/e-mail to "Former member" on expenses, leave, travel and audit entries* (not implemented yet — needs the decision on the legal basis and period).
2. Audit log: *keep for N years with the e-mail removed from `user.account_deleted` metadata* (currently the e-mail is stored — conflicts with data minimisation).
3. Backups: deleted data persists in database backups until they expire — state the period in the privacy policy.
4. Whether an owner may delete while members remain (currently refused with 400) and how ownership is transferred.
5. Grace period / soft-delete window before irreversible purge (currently immediate).
Until these are decided the destructive behaviour for **members** is unchanged and the policy text on `/privacy` and `/delete-account` must not promise more than the table above.
