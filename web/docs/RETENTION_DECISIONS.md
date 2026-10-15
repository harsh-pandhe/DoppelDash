# Owner decisions required — data retention (D-02 account/organisation deletion, D-03 paid expense claims)

**Nothing in this document has been implemented. Current behaviour is unchanged until the owner records a decision here.** Evidence of today's behaviour: `docs/ACCOUNT_DELETION_POLICY.md`, `lib/account/deletion.ts`, `tests/account_deletion*.test.js`, and `tests/expense_approval_policy.test.js` **P8** (a characterisation test — *not* approval of the behaviour).

## What happens today
| Data | Member leaves / deletes own account | Sole-owner organisation disband |
|---|---|---|
| Expenses (+ line items, receipts), travel, leave, balances, contacts, announcements | **kept** with the member's name/e-mail in the records | **hard-deleted** (incl. **paid** claims), blobs deleted at the provider first |
| Audit log | kept; `user.account_deleted` stores the e-mail | kept |
| Private files (receipts, itinerary, medical docs) | kept with the records | deleted (provider confirmation required) |
| Backups | not purged | not purged |
| `DELETE /api/rms/:id` | owner may delete only `pending_manager`/`returned` claims | — |
|  | **any manager/admin may delete a claim in ANY status, including `paid`** | — |

## Proposed decisions (recommended defaults — please approve, amend or reject each)
**D-03 — financial claims**
1. **Forbid ordinary hard-deletion of `paid` and `pending_admin` claims** for every role (HTTP 409 `claim_settled`). Hard-delete stays only for `pending_manager`/`returned` claims by their owner and by reviewers.
2. Replace deletion of settled claims with an **audited void/correction workflow**: new status `void` (and an optional `correctionOf` link); requires admin + a reason; records who/when/why; **keeps** the original amount, line items and receipt evidence (receipts stay private and readable by admins); voided claims are **excluded from totals/reports/payout queues** but shown in the audit view; a correction is a *new* claim referencing the voided one.
3. **Retention periods** (owner/legal to fix; defaults proposed): paid claims and their receipts **8 years** from payment (Indian tax/Companies Act practice is commonly 8 years — confirm with the company's accountant); other claims 2 years after final status; leave records 3 years after the leave; audit entries 8 years.
4. **Organisation disband and account deletion obey the same policy:** a disband **may not purge paid claims or their receipts before the retention period ends** — instead it deactivates the tenant, blocks sign-in, removes personal/optional data (contacts, mail, tokens) immediately, and schedules the financial records for purge at the end of retention (or exports them to the owner first). Member deletion **pseudonymises** `userName`/e-mail to "Former member" on retained claims, leave and audit entries (needs migration + tests) instead of keeping identifiers.

**D-02 — account/organisation deletion**
5. Audit log: remove the e-mail from `user.account_deleted` metadata (keep the user id); keep entries for the audit retention period.
6. Backups: state the backup retention (e.g. 30 days) on `/privacy` and `/delete-account`; deleted data remains in backups until they expire.
7. Owner leaving while members remain: keep the current refusal (400) and add an **ownership transfer** flow before deletion is allowed.
8. Grace period: introduce a **14-day soft-delete window** (sign-in blocked, data hidden, purge job after the window) instead of immediate irreversible purge.

## Compact approval section (fill in)
| # | Decision | Approve / Amend / Reject | Owner / date |
|---|---|---|---|
| 1 | Forbid hard-delete of `paid` and `pending_admin` claims | | |
| 2 | Void/correction workflow for settled claims (design above) | | |
| 3 | Retention periods (claims 8y, other 2y, leave 3y, audit 8y) — confirm legal basis | | |
| 4 | Disband/deletion obey retention; pseudonymise members on retained records | | |
| 5 | Remove e-mail from `user.account_deleted` audit metadata | | |
| 6 | Backup retention statement (period: ___ days) | | |
| 7 | Ownership transfer before owner deletion | | |
| 8 | 14-day soft-delete window | | |

## What will be implemented after approval (so the approval can be reviewed against a concrete plan)
`void` status + transitions + audit actions; `DELETE /api/rms/:id` refusal for settled claims; totals/report/analytics/export exclusion of voided claims with tests; a retention-aware purge job (idempotent, dry-run first, same claim/lease pattern as receipts cleanup); pseudonymisation migration (read-only dry-run → counts → owner approval → apply on disposable copy first); `/privacy` and `/delete-account` text; updated P8 test replaced by the new contract tests.
