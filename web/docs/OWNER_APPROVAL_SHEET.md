# Owner approval sheet — D-02 / D-03 retention and provisioning

**Nothing below is implemented or approved.** Current behaviour is unchanged (`ACCOUNT_DELETION_POLICY.md`, `RETENTION_DECISIONS.md` describe it). Fill the last two columns; an answer of Amend needs the amended text. Implementation starts only after the sheet is returned.
Recommendations are engineering defaults, not legal advice: confirm retention periods with the company accountant/legal counsel.

| # | Decision | Recommendation | Risk of delaying | Implementation consequence if approved | Approve / Amend / Reject | Owner · date |
|---|---|---|---|---|---|---|
| D-03.1 | Hard-delete of `paid` and `pending_admin` claims | **Forbid** for every role (409 `claim_settled`); hard-delete stays only for `pending_manager`/`returned`, by owner or reviewer | Today any manager/admin can delete a **paid** claim and its receipt: financial record loss, no audit trail of the amount | `DELETE /api/rms/:id` status guard + tests; UI hides Delete on settled claims; no data migration | | |
| D-03.2 | Void / correction for settled claims | New status `void` (+ optional `correctionOf`), admin only, mandatory reason; original amount, items and receipt evidence preserved; audited | Without it, settled mistakes can only be left wrong or deleted (conflicts with D-03.1) | New status + transition + audit action; totals, reports, analytics and exports exclude `void` (tests); void receipt kept until retention end | | |
| D-03.3 | Retention periods | Claims + receipts 8 y from payment (confirm with accountant); leave 3 y; other HR records 2 y; audit log 8 y | Undefined period blocks the purge job and the privacy statement | Retention constants + purge job (idempotent, dry-run first, audited); `/privacy` text | | |
| D-03.4 | Org disband / account deletion vs retained records | Disband deactivates the tenant and blocks sign-in; **may not purge** paid claims/receipts before retention end; members pseudonymised on retained records | Today disband hard-deletes paid claims (and blobs) irreversibly | Disband becomes soft + scheduled purge after retention; pseudonymisation helper; tests for disband and delete paths | | |
| D-02.5 | Audit log content on deletion | Remove e-mail from `user.account_deleted` metadata, keep user id | Deleted users' e-mails persist in audit indefinitely | One-line change + test; existing rows optionally scrubbed by an approved script | | |
| D-02.6 | Backup retention statement | State period (proposal 30 days) on `/privacy` and `/delete-account` | Deletion promise is inaccurate while backups keep data | Copy change only; Atlas backup policy must match | | |
| D-02.7 | Owner leaving while members remain | Keep the 400 refusal and add an ownership-transfer flow first | Sole-owner orgs can become unmanageable | New transfer endpoint + UI + audit + tests | | |
| D-02.8 | Deletion grace period | 14-day soft delete (sign-in blocked, data hidden), then purge job | Accidental deletions are immediate and irreversible | `deletedAt` state, restore path, purge job (dry-run first), tests | | |

## Provisioning and real-data gates (separate approvals)
| Gate | Required before it can run | Approved by · date |
|---|---|---|
| Doppelmayr lifetime entitlement apply | Reviewed dry-run output attached to the ticket; exact database name + `org_doppelmayr` confirmed by the owner; written approval; then `--apply --confirm-db --confirm-org --actor --reason` (`DOPPELMAYR_ENTITLEMENT_PROVISIONING.md`). Never set dev seed flags in production | |
| Atlas restore rehearsal | Owner names: backup source, isolated target cluster, access list, change window; restore from snapshot/PITR; record duration, counts, hashes | |
| Legacy medical-document inventory (read-only) | Successful Atlas restore rehearsal + owner approval; run against the **restored copy**, never production first | |
| Legacy medical-document migration | Separate approval; inventory report reviewed; rollback plan; post-migration authorisation checks | |
