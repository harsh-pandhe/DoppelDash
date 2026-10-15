# Doppelmayr India — outbound-mail brand provisioning (one-time production step)

**Why this exists.** Outbound e-mail is branded from *stored organisation configuration*, never from code that
recognises an organisation. Doppelmayr India is an ordinary tenant; for its mail to carry its own name and colour,
two values must be stored once on its settings document. Application startup never changes production data, so this
is an explicit operator step.

## Canonical stored state (`org_doppelmayr`)

| Collection / field | Value | Notes |
|---|---|---|
| `orgsettings.companyName` | `Doppelmayr India Pvt Ltd` | legal / configuration identity — **never modified** by this step |
| `orgsettings.brandName` | `Doppelmayr India` | customer-facing name used in e-mail subjects, headers, From name |
| `orgsettings.brandColor` | `#0057A8` | header / button colour |
| `organizations.*` entitlement fields | unchanged | `plan`, `entitlementSource`, `lifetimeGrant`, `webEnabled`, `androidEnabled` are never touched |

Rules enforced by the code (`web/lib/provisioning/doppelmayrBrand.ts`):
- fills only a **missing** `brandName` / `brandColor` — a value an administrator already set is never overwritten;
- does nothing (and creates nothing) if the organisation does not exist;
- idempotent: a second run writes nothing and does not even touch `updatedAt`.

## Production procedure

Run from a trusted operator machine with network access to the production cluster. The connection string is read from
the environment and is **never printed**.

1. **Dry run** (default — writes nothing). Review what it would do:
   ```bash
   MONGODB_URI="<production connection string, ending in /<database>>" \
     node web/scripts/provision-doppelmayr-brand.js
   ```
   Expected on a database that predates the brand fields:
   `DRY RUN — would write: brandColor, brandName.`
2. **Apply**, confirming the database name by typing it exactly (a mismatch aborts without writing):
   ```bash
   MONGODB_URI="<production connection string, ending in /<database>>" \
     node web/scripts/provision-doppelmayr-brand.js --apply --confirm-db=<database name>
   ```
   Expected: `Applied: brandColor, brandName.`
3. **Verify idempotence**: run step 1 again → `Already provisioned — no changes needed.`
4. **Smoke check**: trigger a password-reset or invitation e-mail for a Doppelmayr user; the subject/header should read
   "Doppelmayr India" in #0057A8, and mail for any other organisation must be unaffected.

If `org_doppelmayr` does not exist the script stops with an error and changes nothing.

## Not the production path

* `POST /api/dev/migrate` also calls the same function, but that route is a secret-gated *development* migration and is
  disabled in production unless `ALLOW_DEV_SEED=true` (a flag that must stay off in production). Do **not** enable it
  to provision the brand.
* The dev seed (`/api/dev/seed`) already writes the canonical state for local/throwaway databases.

## Rollback

Brand values are plain stored fields. To revert, unset them (this returns Doppelmayr mail to the neutral platform
brand/colour, falling back to the legal `companyName`):

```js
db.orgsettings.updateOne({ orgId: 'org_doppelmayr' }, { $unset: { brandName: '', brandColor: '' } })
```
