# Owner decisions applied — 2026-10-25

**Approval:** the owner answered "approve all recommended" for every row of `OWNER_APPROVAL_SHEET.md` (D-03.1–D-03.4, D-02.5–D-02.8, P-01, P-02, P-03) on 2026-10-25. This file records what that approval changed in code, how it is tested, and what is NOT done. (It is a new file on purpose: the approval sheet itself is being edited on another branch.)

Evidence class for everything below: **FAKE-VERIFIED** (real routes, throw-away MongoDB, local fake providers). Nothing here has been run against production or a real provider.

| # | Decision (approved = recommended) | Implemented in | Tests |
|---|---|---|---|
| D-03.1 | Claims in payout review, paid, rejected or void are never hard-deleted (409 `claim_settled`); only `pending_manager`/`returned` may be deleted | `app/api/rms/[id]/route.ts` (DELETE) | `expense_void_and_delete` D1.*, `expense_approval_policy` P8 |
| D-03.2 | Admin-only `paid → void` with a mandatory reason; amount, lines, receipts kept; `voidedAt/voidedBy`; audited `expense.void`; void excluded from reports/analytics/CSV export | `models/Expense.ts`, `rms/[id]/route.ts`, `lib/expenses/{validation,reviewPolicy}.ts` (`canVoid`), `lib/analytics/compute.ts`, `app/api/reports/route.ts`, claim screen "Void claim" button, status badges | `expense_void_and_delete` V1–V4 |
| D-03.3 | Retention: claims + receipts 8 y from payment, leave 3 y, travel 2 y, audit 8 y. Idempotent purge job, dry-run default, apply needs `RETENTION_PURGE_APPLY=1`, audited, provider-confirmed file deletion | `lib/account/lifecycle.ts` (`RETENTION`, `runRetentionPurge`), `app/api/cron/retention-purge/route.ts` | `account_lifecycle` LC4, LC6, LC7 |
| D-03.4 | Sole-owner disband deactivates the tenant; non-financial data purged after the grace window; claims/leave/travel/subscription records and their private files are kept until retention ends; members pseudonymised ("Former member"); empty shell removed afterwards | `lifecycle.ts` (`scheduleDeletion`, `nonFinancialDisbandSteps`, `pseudonymiseMember`), `app/api/user/account/route.ts`, `models/Organization.ts` | `account_deletion_integrity` I1–I5, `account_lifecycle` LC5–LC6 |
| D-02.5 | No e-mail in `user.account_deleted` / `user.account_deletion_requested` audit entries (user id only) | account route, `lifecycle.ts` | `account_deletion` 3, `account_lifecycle` LC1, LC5 |
| D-02.6 | Backup statement: "up to 30 days" on `/privacy` and `/delete-account` | `app/privacy/page.tsx`, `app/delete-account/page.tsx` | (copy) — **owner action: set the Atlas backup retention to match** |
| D-02.7 | Owner with members must transfer ownership first (kept 400 `owner_must_transfer`); new `POST /api/org/transfer-ownership` (owner-only, target = active admin of the same org, atomic swap, audited, ids only) | `app/api/org/transfer-ownership/route.ts` | `account_lifecycle` OT1–OT3 |
| D-02.8 | 14-day soft delete: deactivated + all sessions revoked at once; restorable by password sign-in with `restoreAccount:true` inside the window; purge only from the retention job | `lifecycle.ts`, `app/api/user/account/route.ts`, `app/api/auth/login/route.ts`, `models/User.ts` | `account_lifecycle` LC1–LC3, `account_deletion` 3–4 |
| P-01 | Overlapping pending/approved leave for one user → 409 `leave_overlap`; morning + afternoon half-day pair allowed (`isHalfDay` + `halfDayPeriod` accepted and validated on POST) | `lib/leave/overlap.ts`, `app/api/lms/route.ts` | `leave_overlap` L1–L7 |
| P-02 | **Keep** Admin self-approval with the audit flag (sole-admin practicality). No code change. Revisit if an auditor requires two-person approval | — | existing `expense_approval_policy` |
| P-03 | Audit events for all admin-reachable mutations | being implemented on the `phase-1j-work` worktree (separate session) — **not in this branch** | — |

## API contract changes the Android client must handle (DoppelDash-mobile)
1. `DELETE /api/user/account` now answers `{ success:true, scheduled:true, restoreUntil, gracePeriodDays, message }` — the account is **not** gone yet. Show `message`, sign out locally. Do not tell the user the data is already deleted.
2. `POST /api/auth/login` can answer **403 `account_pending_deletion` + `restoreUntil`**; offer "Restore my account" and resend with `restoreAccount:true`.
3. `POST /api/lms` can answer **409 `leave_overlap`**; show the message. It now accepts `isHalfDay:true`, `halfDayPeriod:'morning'|'afternoon'` (single day, `days` = 0.5).
4. Expense claims have a new status **`void`**; unknown-status handling must not crash. `DELETE /api/rms/:id` can answer **409 `claim_settled`**.
5. `DELETE /api/user/account` for an owner with members: 400 with `code:'owner_must_transfer'` and `transferEndpoint`.

## Not done / residual risk
* The retention job is **not scheduled anywhere** (same status as the other cron routes — see `SCHEDULED_JOBS.md`). Until a scheduler calls `POST /api/cron/retention-purge`, accounts stay in the soft-deleted state past 14 days. Set `RETENTION_PURGE_APPLY=1` and `CRON_SECRET` on the target site, run a dry-run first.
* Retention periods are engineering defaults; the company accountant/legal counsel must confirm them.
* Leave overlap is check-then-insert (not atomic); the balance check remains the second guard.
* Old rows are not rewritten: existing audit entries that already contain an e-mail (`user.account_deleted`) are untouched (D-02.5 scrub of old rows needs a separate approval + dry-run).
* No web UI yet for ownership transfer (API + audit + tests exist); no UI for "restore my account" on the web sign-in page.
* Medical documents attached to expired leave records are removed by the existing abandoned-receipt cleanup once unreferenced.
