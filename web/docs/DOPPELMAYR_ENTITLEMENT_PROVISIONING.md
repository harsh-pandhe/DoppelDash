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
