# Atlas snapshot / point-in-time restore — isolated rehearsal plan

Status: **NOT RUN.** No Atlas access exists on the build machine. The local logical rehearsal (`scripts/backup-restore-rehearsal.js`, DISPOSABLE) and the new comparison tool test (R6) prove the *tooling*, not Atlas recovery. Nothing here is executed without the owner's written approval of items 1–5.

## Owner-supplied inputs (all required before starting)
1. Source: Atlas project, cluster name, database name (production is read only through Atlas backup features, never queried by us first).
2. Restore point: a named snapshot id **or** a point-in-time (UTC) inside the PITR window.
3. Target: a **separate, non-production** cluster/project created for the rehearsal (name it `dd-restore-rehearsal-<date>`), M10+ is not required for a copy of this size but must support the source's MongoDB major version. It must not share credentials, network access or app deployments with production.
4. Access: a temporary database user with `read` on the restored database only for the verifier; IP access list limited to the operator; both removed afterwards.
5. Change window and operator names; who may delete the target cluster afterwards.

## Procedure
1. Record the start time. In Atlas: Cluster -> Backup -> choose the snapshot or "Point in Time" -> **Restore to another cluster** (target = the rehearsal cluster). CLI alternative: `atlas backups restores start --help` (flags differ by CLI version; verify the installed syntax before use). Do **not** restore over the source.
2. Wait for "Restore complete"; record elapsed minutes (this is the RTO evidence).
3. Reconcile (read-only, prints no content):
   ```bash
   SOURCE_MONGODB_URI=<source read-only URI> RESTORED_MONGODB_URI=<restored copy URI> ATLAS_COMPARE_APPROVAL=1 \
     node web/scripts/compare-databases.js --confirm-source-db=<name> --confirm-restored-db=<name> --exclude=<volatile collections> --json > restore-report.json
   ```
   Expected differences: only collections written after the restore point (rate limits, sessions, refresh tokens, audit appended since). Every other collection must `MATCH` on count, content hash and indexes. Reading a **live production** source is an owner-approved read load; prefer comparing two restores or a source snapshot copy when possible.
4. Run the index pre-flight against the restored copy: `PREFLIGHT_APPROVAL=... node web/scripts/preflight-indexes.js` (read-only; see RELEASE_OPERATIONS §4).
5. Start a **staging** app instance pointed at the restored copy (never production app) and run `node web/scripts/smoke-release.js --url=<staging> --expect-commit=<sha>` plus a login of a synthetic account that exists in the copy.
6. Record: snapshot/PITR id, restore duration, per-collection counts and match flags (`restore-report.json`), index result, smoke result, operator, date. Store the report in the change ticket (it contains collection names and counts only).
7. Teardown: delete the rehearsal cluster and the temporary user/IP entries; confirm in Atlas.

## Gates this unlocks
Only after a PASS with the report attached may the owner approve (a) the legacy medical-document **inventory** (read-only, run against the restored copy: `LEGACY_MEDICAL_MIGRATION.md`) and (b) any migration rehearsal. A FAIL or an unexplained DIFF blocks both.
