# Legacy medical documents — inventory → plan → (approval) → migration → verification → (approval) → public-asset removal

Status: **inventory + plan tooling CODE/FAKE-VERIFIED on synthetic data; NOTHING has been run against any real database; the apply step is deliberately NOT implemented yet.** Until the migration is executed and verified, legacy medical documents remain **publicly reachable by URL** (see `LEAVE_MEDICAL_DOCUMENTS.md`). Do not describe them as private.

## Step 0 — what is exposed (read-only)
`web/scripts/inventory-legacy-medical-docs.js` (library `lib/migration/legacyMedicalInventory.ts`): scans `leaves.medicalDocs`, classifies each value (`private_ref`, `legacy_public_url`, `legacy_authenticated_url`, `external_url`, `proxy_path`, `unknown`), and reports counts per class/extension/organisation, duplicates (same file referenced twice — grouped by a 12-hex SHA-256 fingerprint), legacy files **outside the organisation's own folder**, unsupported extensions, private refs **without a matching manifest row**, and `leave_medical` manifest rows nothing references. **The output contains no URL, folder, file name or document content** — only leave ids, organisation ids, fingerprints and classes.
```
MONGODB_URI="<uri incl. database name>" node web/scripts/inventory-legacy-medical-docs.js --out=inventory.json [--plan] [--org-id=<org>]
```
* Refuses any database whose name lacks `test` unless **`LEGACY_INVENTORY_APPROVAL="<approver>:<ticket>"`** is set **and** `--confirm-db=<db name>` is typed exactly (the owner-approval gate for real data). Never writes. `--out` files are mode 0600.
* `--probe-public` (off by default) sends `HEAD` requests to `https://res.cloudinary.com/…` for each legacy URL and reports only status classes (`publicly_reachable_200`, `status_404`, …) — this is what proves the exposure is live; it contacts the provider, so run it only with approval.
* `--plan` adds one entry per legacy document: `copy_to_private_then_rewrite_ref` (supported type, inside the org folder) or `manual_review` (+ reason).
Report fields: `totals` (leaves scanned, documents, byClass, byExtension), `legacyPublic` (count, eligibleForMigration, notInOrgFolder, unsupportedExtension, publicReachability), `privateRefs` (manifest ok/missing/mismatch, orphanManifestRows, rowsBeingDeleted), `duplicates`, `perOrganisation`, `findings` (capped at 200, identifiers only).

## Step 1 — approval gate A (owner): run the inventory on production
Record who approved, the ticket, the date and the report's hash in the checklist. **Take a verified backup first** (see `RELEASE_OPERATIONS.md`: Atlas snapshot + a logical export of `leaves`, `receiptuploads`, `auditlogs`; restore-rehearse it on a disposable database).

## Step 2 — the migration (to be implemented after gate A; design reviewed here)
Per eligible document, in a single-writer, resumable, dry-run-first script (same safety pattern as `provision-doppelmayr-entitlement.js`: `--apply --confirm-db --confirm-org --actor --reason`):
1. **Fetch** the public asset (HTTPS, allow-listed host, size cap = plan limit, content-type sniff against the extension, magic bytes check).
2. **Upload** the bytes to the organisation's **authenticated** receipts folder with a server-chosen random public id (`type=authenticated`) — never reuse the old id.
3. **Verify**: re-download via a signed URL and compare SHA-256 with step 1; confirm `type=authenticated` through the Admin API.
4. **Record**: create the `ReceiptUpload` row (`purpose: leave_medical`, `state: attached`, `claimedBy: <leaveId>`, `userId: <leave owner>`, `declaredMime`) — the same atomic claim the live path uses.
5. **Rewrite** the leave: replace the array element with `cld:<publicId>.<ext>` using a conditional update (`{_id, medicalDocs: <old value>}`), keep the old value in `legacyMedicalDocs` (a new array field) for rollback, add an audit entry `leave.medical_doc_migrated` (counts + ids only).
6. Never delete anything in this step. A failure at any point leaves the legacy value in place and the new private asset either unreferenced (cleanup-safe) or verified; the script is idempotent (skips values already `cld:`).

## Step 3 — verification (read-only)
Re-run the inventory: `legacyPublic.count` must be `0` (or only `manual_review` items with a recorded decision); every `private_ref` has `manifest: ok`; no orphan rows beyond the expected; spot-check three records per organisation through the authenticated endpoint (owner 200, reviewer 200, peer 403, other tenant 404); `--probe-public` on the **old** URLs still returns 200 (that is expected until Step 4).

## Step 4 — approval gate B (owner): remove the public assets
Only after Step 3 and a retention check. Delete the **old public assets** through the provider API with the exact-identity helper (`destroyAttachments`), one organisation at a time, logging counts only; confirm with `--probe-public` that every old URL now returns 404. Keep `legacyMedicalDocs` until the owner approves purging it (it holds the old URLs).

## Rollback
Before Step 4: restore `medicalDocs` from `legacyMedicalDocs` per leave (the public assets still exist), unclaim and let the cleanup remove the new private copies. After Step 4: restore from the verified backup **and** re-upload from the private copies (they are retained until the owner purges them). Rehearse the restore on a disposable database before gate A.

## Not covered / honest limits
Real Cloudinary behaviour (type conversion, signed delivery, transformations that could expose derived public URLs) is unverified — Step 2 must first be rehearsed against the **staging** cloud (`RECEIPT_STORAGE_AND_OCR.md` §12). Legacy URLs that were pasted into e-mails, chats or browser histories remain valid in those places until the assets are deleted (Step 4) — deletion, not the database rewrite, is what closes the exposure. Tests: `tests/legacy_medical_inventory.test.js`.
