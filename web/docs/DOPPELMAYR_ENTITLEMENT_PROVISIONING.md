# Doppelmayr lifetime entitlement — provisioning run book (P0-03)

**What:** sets, on the existing `org_doppelmayr` organisation, the persisted fields `plan=premium`, `entitlementSource=lifetime_grant`, `lifetimeGrant=true`, `webEnabled=true`, `androidEnabled=true`, and writes an audit entry (`organization.entitlement_provisioned`: who, when, why, before → after). Nothing else is touched; the organisation is never created.
**Why a script:** runtime code must not recognise Doppelmayr by name/slug/domain; access is decided only by these stored fields (`lib/entitlements/entitlementService.ts`, `lib/auth/webAccess.ts`).

1. **Dry run** (writes nothing; prints the stored values and the fields that would change):
   `MONGODB_URI="…" node web/scripts/provision-doppelmayr-entitlement.js`
2. **Apply** (owner/operator, after reviewing step 1; all five flags required):
   `MONGODB_URI="…" node web/scripts/provision-doppelmayr-entitlement.js --apply --confirm-db=<db> --confirm-org=org_doppelmayr --actor="<name>" --reason="<ticket / why>"`
3. **Verify:** re-run step 1 → "Already provisioned"; `GET /api/billing/entitlements` as a Doppelmayr member shows premium + web/android; a public organisation still shows `webEnabled=false`.
4. Safe to repeat: when already provisioned nothing is written and no second audit entry appears.

Status: script and tests are FAKE-VERIFIED. **Not run against any shared or production database** — that is an owner action (never share the connection string in chat; the script prints only the database name).

## Reviewed dry-run checklist (operator; all boxes before any `--apply`)
- [ ] Target identified by the owner in writing: database name `<db>` and organisation id `org_doppelmayr`; the connection string is exported only in the operator's shell (never pasted in chat, a ticket or a commit).
- [ ] The database is the intended shared database, confirmed against the Atlas project/cluster name (not a restore copy, not a test database).
- [ ] Dry run executed (no flags): output attached to the ticket; it prints the database name and org id — they equal the written target; `orgFound` is true (the script never creates an organisation); the "would write" list is exactly the documented fields (`plan`, `entitlementSource`, `lifetimeGrant`, `webEnabled`, `androidEnabled`, ...).
- [ ] A second reviewer compared the dry-run output with the runbook above.
- [ ] Explicit written approval to apply, with the actor name and reason text to use.
- [ ] `ALLOW_DEV_SEED`/`DEV_SEED_SECRET` are NOT set in that environment (`check-release-env.js --context=production` must PASS).
- [ ] After apply: re-run the dry run -> "Already provisioned" (idempotent, no second audit entry); `GET /api/billing/entitlements` as a member shows premium + web/android; a public organisation still has `webEnabled=false`.
