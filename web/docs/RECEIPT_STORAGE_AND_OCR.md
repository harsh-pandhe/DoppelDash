# Receipts, attachments and OCR — security model, configuration, rollout

Status: implemented and tested against **local fakes only**. Nothing here has been run against the real Cloudinary or Gemini accounts, and no
production data or assets were touched. Items that depend on the real provider are listed in §8.

## 1. Production configuration (exact)

| Variable | Where | Required in production | Purpose |
|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` (or `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`) | server | **yes** | cloud name (public value) |
| `CLOUDINARY_API_KEY` | server only | **yes** | signing, admin lookup, private download, delete |
| `CLOUDINARY_API_SECRET` | server only | **yes** | same; never sent to a client, never `NEXT_PUBLIC_` |
| `CLOUDINARY_SIGNED_PRESET` | server | recommended | name of a **signed** upload preset so the provider itself enforces formats / size / delivery type |
| `GEMINI_API_KEY` | server only | for OCR | receipt + business-card OCR (Gemini 2.5 Flash via `lib/gemini`) |
| `OLLAMA_URL`, `OLLAMA_MODEL` | server | optional | OCR fallback; used **only if `OLLAMA_URL` is set** (it is unreachable from serverless, so normally leave unset) |
| `OCR_DEADLINE_MS` | server | optional (default 22000) | wall-clock budget for one OCR request |

Never set in production (they are **ignored** when `NODE_ENV=production`, so a stray value cannot redirect traffic):
`CLOUDINARY_UPLOAD_BASE`, `CLOUDINARY_DELIVERY_BASE`, `GEMINI_API_BASE`, `ALLOW_UNSIGNED_UPLOADS`, `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` /
`CLOUDINARY_UPLOAD_PRESET` (legacy unsigned preset).

## 2. Fail-closed behaviour (no unsigned fallback in production)

`storageConfig()` in `lib/uploads/attachmentStorage.ts` is the single decision point.

* Signing is usable only when **cloud name + API key + API secret** are all present.
* In production, anything less (nothing, cloud name only, key without secret, secret without key, a legacy preset, even
  `ALLOW_UNSIGNED_UPLOADS=1`) means **no upload ticket**: `POST /api/uploads/sign` → `503 storage_not_configured` with a generic, user-safe
  message (the reason — e.g. `incomplete_signing` — is only written to the server log; no variable names or secrets reach the client).
* The same condition makes the rest of the pipeline refuse to work: attachment URLs are rejected (400 `receipts`), stored receipts are not served
  (503), nothing is verified or deleted. There is no code path that creates an unsigned ticket in production.
* Legacy *unsigned* mode survives for local development only and requires **both** `ALLOW_UNSIGNED_UPLOADS=1` **and** a preset, and never applies
  when `NODE_ENV=production`.
* Proved by `tests/upload_config.test.js` (pure) and `tests/upload_production_server.test.js` (a real `next build` + `next start` in production
  mode against a throwaway DB, 7 broken configurations + the complete one).
* Both clients get the ticket from the server: Web (`lib/cloudinary.ts`) and Android (`CloudinaryService`) contain no cloud name, preset or secret
  (guarded by `test/security/no_storage_secrets_test.dart`).

## 3. Receipt privacy — what is and is not private

**Before:** uploads were public assets and the database stored a public `https://res.cloudinary.com/...` URL. Hard-to-guess ids do not make a
public URL private: anyone who ever sees such a URL (browser history, a forwarded link, a QR code, a log, a screenshot, a former employee) can read
the receipt forever.

**Now, for receipts uploaded through the new flow:**
1. The upload ticket sets `type=authenticated` (a signed parameter). The provider stores the file as an *authenticated* asset: it has **no public
   delivery URL** (tested: the public `/image/upload/…` URL of the same id is 404).
2. MongoDB stores a provider-neutral **reference** `cld:doppeldash/<orgId>/receipts/<random>.<ext>` — not a URL. API responses never contain a
   provider URL; they contain `/api/rms/<expenseId>/receipt/<n>.<ext>` (`l<n>` for line items).
3. That endpoint is the only way to read a receipt. Per request it checks: session valid → expense in the caller's organisation (other tenants get
   404) → caller is the owner or a manager/admin of that organisation (another employee gets 403) → the stored value is a private reference. Then the
   **server** downloads the file with a freshly signed private-download request and streams it with `Cache-Control: private, no-store`,
   `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and a content type taken from the *stored extension*, not
   from the provider. No provider URL/signature is ever handed to a client, so there is nothing to forward or cache; access ends the moment the
   user's authorisation does ("short-lived" by construction, not by a TTL we cannot verify). Rate limit 300/min/user.
4. The URL the provider returns for the upload itself (a *signed* authenticated URL) is a bearer URL: whoever holds it can read the file. It exists
   only in the uploading client's memory for the duration of the form, is never stored or returned by this API, and the tests assert that it appears
   in no API response and no database row.

**Still NOT private (do not describe these as private):**
* **Receipts uploaded before this change** are public assets referenced by public URLs. They keep working (the API passes legacy values through
  unchanged) and stay public until migrated (§7). They cannot be made private by code alone.
* Other upload kinds — leave medical documents, travel itinerary documents, onboarding documents, profile photos, organisation logos, mail images,
  expense *payment proof* — are signed, tenant-foldered and validated by type/size, but are still **publicly deliverable**. They move to the private
  model in their own feature passes; until then they carry the "public bearer URL" risk. (Web `uploadToCloudinary` defaults to the `document`
  kind so none of those break.)
* Provider delivery is only as private as the provider account's configuration (e.g. an account that allows overriding `type`). Verify in staging (§8).

Limits of the proxy: responses above 12 MB are refused (413) because of serverless response limits; plans cap uploads at 5 MB (Free) / 25 MB
(Premium), so a Premium receipt between 12 and 25 MB cannot be previewed through this endpoint. Receipt photos are normally well under 2 MB; Android
compresses to 1600 px.

## 4. Upload constraints — who enforces what

| Constraint | Enforced by | Independent of the client? | Notes / residual risk |
|---|---|---|---|
| Authentication to upload | `POST /api/uploads/sign` (session, rate-limited 60/min/user) | yes | no ticket, no signature, no upload |
| Allowed formats | signed `allowed_formats` (provider rejects others); ticket refuses other MIME types; server re-checks the **stored** format at attach (`verifyStoredReceipt`) | yes | the provider's own detection is authoritative |
| File type = declared type | **the declared MIME is bound into the signed ticket** (`allowed_formats` = only that type's formats, so the provider refuses other content) **and recorded server-side in the manifest** (`ReceiptUpload.declaredMime`); at attach the provider's real format must be in the declared set, else 400 `attachment_type_mismatch` (file destroyed best-effort, row marked `rejected`, never attachable) | yes | see §13 |
| Max file size | plan limit via the entitlement resolver at sign time; **at attach the server asks the provider for the real stored byte size and rejects + deletes anything over the plan limit** | yes at attach | the backend cannot see bytes during a direct-to-provider upload, so a client can upload more than it declared; the oversized file is stored until attach is attempted (then deleted) or until cleanup. Provider-side hard stop needs the **account-level upload max file size** and/or the **signed preset** — configure in the Cloudinary console (exact setting names to be confirmed there; not verifiable from this repo) |
| Tenant-bound folder | signed `folder=doppeldash/<orgId>/<kind>` | yes (changing it invalidates the signature) | attach also requires the reference to be inside the caller's tenant folder |
| Random public id | signed `public_id` = 128-bit random | yes | client cannot choose or guess ids |
| Overwrite prevention | signed `overwrite=false` | yes | replaying a ticket cannot replace a stored file |
| Delivery type | signed `type=authenticated` for receipts (+ optional signed preset) | yes | see §3 |
| Max attachment count | server: 10 receipts per expense (`validateExpense`) | yes | |
| One file ↔ one claim | server: a reference already attached to another expense is refused (409) | yes | |
| Authorisation to attach | only references that came from an upload in the caller's own tenant folder, verified against the provider; raw `cld:` values from clients are rejected | yes | |
| Authorisation to replace/remove | only the owner, only while the claim is `returned`; dropped files are deleted from storage (best effort) | yes | orphans possible if the provider call fails (unguessable, tenant-foldered) |
| Authorisation to retrieve | §3 endpoint | yes | |
| Timestamp freshness of tickets | signed `timestamp`; provider rejects stale signatures | provider | |

## 5. OCR behaviour (unchanged chain, verified under bad configuration)

`image → Gemini (if GEMINI_API_KEY) → Ollama (only if OLLAMA_URL) → empty fallback`. Credentials absent → no provider is contacted and an honest
empty result is returned (nothing is ever invented); an invalid key is a provider 403 → fallback, with only a short status logged (never the key or
the provider body); a hung provider is cut off by `OCR_DEADLINE_MS` and returns the fallback; junk/hostile output is sanitised or discarded.
Fakes exist only in `tests/` and are reachable only through env overrides that production ignores. Tests: `tests/ocr_config.test.js`,
`tests/receipt_ocr_vertical.test.js`.

## 6. Legacy Android client → signed uploads (rollout)

**The problem.** The Play build in production today (`pubspec` 1.0.1+2) uploads straight to Cloudinary with a hard-coded **public unsigned preset**
and stores public URLs. The new backend deliberately has no mode that accepts that: unsigned tickets do not exist in production and attachment
URLs that are not tenant-foldered, authenticated references are rejected. So a legacy build **cannot attach new receipts** (and cannot render
new private receipts, which it would see as relative paths) once the new backend is live. Receipts it already uploaded keep displaying.

**Minimum compatible version: the first build containing the signed-upload client (`CloudinaryService(_api.dio)` + authenticated receipt
images) — bump `pubspec` to at least `1.0.2+3` (versionCode must exceed the Play build).** There is no server-side compatibility switch and none
must be added: a "temporarily accept legacy uploads" flag would re-open unsigned production uploads.

**Sequence (nothing below has been done; do not release or deploy as part of this task):**
1. *Provider preparation* (operator, Cloudinary console): create an API key/secret; create a **signed** preset restricting formats and
   `type=authenticated`; set the account's upload max file size; confirm Admin API and private-download access for the key. Keep the old unsigned
   preset **enabled** for now (legacy builds still use it).
2. *Staging* (real Cloudinary sandbox cloud + staging backend with `NODE_ENV=production`): run the checklist in §8 end to end with the new Android
   build side-loaded. Do not use the production cloud.
3. *Build*: bump version to ≥ 1.0.2+3, upload to Play **internal → closed testing** pointing at staging. Do not promote to production yet.
4. *Production backend config*: set the §1 variables **before** deploying — deploying without them makes uploads fail closed (by design).
5. *Cutover window*: deploy backend + Web together; immediately promote the Play build to production with a staged rollout (10 % → 50 % → 100 %)
   and, if product allows, a forced-update prompt (Play in-app updates) for builds < 1.0.2+3. Expect legacy users to be unable to attach receipts until
   they update; show nothing misleading — the server returns a clear 400/503, not a silent drop.
6. *Close the provider hole*: when ≥ ~95 % of active Android users are on ≥ 1.0.2+3, **disable the unsigned preset in the Cloudinary console**.
   Until then, the public preset is still an open anonymous-upload endpoint at the provider (nothing in our backend can close it, but nothing we
   accept can reference those files either).
7. *Rollback*: redeploy the previous backend; unsigned tickets cannot be re-enabled by configuration in production.

## 7. Migration plan for existing public receipts (not executed; production assets untouched)

Existing receipts live as public `…/image/upload/…` assets, referenced by URL in `expenses.receipts[]` and `expenses.lineItems[].receiptUrl`
(plus receipts copied from travel itinerary documents). To make them private:
1. **Inventory** (read-only): per organisation, list distinct receipt URLs; classify host/cloud/path; record counts and bytes. Legacy ids need not
   follow the tenant folder convention, so map ownership through the *expense*, not the path.
2. **Dry run** on a staging copy of the database against a staging cloud: for each asset call the provider **rename** with `to_type=authenticated`
   and a new public id `doppeldash/<orgId>/receipts/<random>` (`overwrite=false`, `invalidate=true`), record `old URL → new ref` in a mapping
   collection, then rewrite the Mongo value to `cld:<newId>.<ext>`. Throttle to the Admin API rate limit; make it idempotent and resumable.
3. **Verify**: the old public URL must now be non-deliverable (404/401), the new reference must stream through `/api/rms/<id>/receipt/<n>`, and
   counts must match the inventory.
4. **Production cutover** (separate approval, off-peak): same steps per organisation, Doppelmayr last; keep the mapping collection for rollback
   (rename back + restore URL). Do not delete the mapping or the old values until a full cycle has passed.
5. Until a tenant is migrated its old receipts remain public — report that plainly; do not call them private.
6. Travel-derived expense receipts and the non-receipt kinds (§3) follow in their own feature passes.

## 8. Provider-dependent items still to prove (cannot be verified from this repository)

* Cloudinary **private download** request shape (`/image/download` signed with the API signature) and the **Admin API resource lookup**
  (`/resources/image/authenticated/<public_id>`) behave as implemented and are permitted for the key/plan; Admin API **rate limits** versus
  receipt-attach volume (one lookup per new receipt).
* `type=authenticated` upload is accepted for signed uploads on the account (not blocked by an unsigned/restrictive preset or account setting).
* The exact console settings for account-level max file size and the signed preset (names/availability depend on the plan).
* Real Gemini accuracy and quota; Ollama is not available in production.
* The behaviour of the real provider's signed `secure_url` for authenticated assets (we never store or return it, but the upload response format must
  match what `receiptRefFromUploadUrl` parses: `…/image/authenticated/s--<sig>--/v<ver>/<public_id>.<ext>`).
* End-to-end Android on the real stack, and the migration (§7).

## 9. Carried-forward Expense decisions
* **A. "At least one receipt"** is Web-only UI policy (simple form only). The server does not require receipts; an org-level `requireReceipts`
  setting would be needed to make it a rule.
* **B. Reimbursement privilege limits** are informational (displayed on Web; nothing server-side compares claims to them).
* **C. Deleting a paid expense** is allowed by the API for managers/admins (audited, no client UI). Recommended follow-up: forbid deleting `paid`.
* **Android PDFs:** this phone can attach PDF receipts (they upload and store privately) but cannot yet *preview* a stored private PDF (no PDF
  viewer and the download needs the signed-in session); it tells the user to open it on the web. Images preview normally.

## 10. Size limits (Feature 3.1.1 — one canonical source)

| Layer | Free | Premium | Source |
|---|---|---|---|
| Sign-time ticket `maxBytes` | 5 MB | 25 MB | org entitlement `maxUploadSizeBytes` |
| Attach-time real-size check (provider Admin lookup) | 5 MB | 25 MB | same plan limit, evaluated against the **stored** byte count |
| Retrieval proxy hard ceiling | 25 MB | 25 MB | `receiptSizeCeiling()` = `maxUploadCeilingBytes()` (largest plan limit); a plan-agnostic ceiling so a downgrade never makes a stored file unreadable |
| Web / Android client pre-check | 5 MB | 25 MB | the signed-in organisation's `entitlements.limits.maxUploadSizeBytes` (from `/api/auth/me`); falls back to the 25 MB ceiling only when that value is unavailable. UX only — the server decides |

The old fixed 12 MB proxy cap (smaller than the 25 MB Premium upload limit) is gone. The proxy never buffers: the provider
response is piped through a counting `TransformStream` that errors the stream once the ceiling is crossed, and a declared
`Content-Length` above the ceiling is refused with 413 before streaming. Boundary tests (at / just above limit, Free and
Premium, lying declared size, chunked body without Content-Length) are in `tests/receipt_ocr_vertical.test.js`.
Provider-side hard limit: **not verified** against the real account (run `scripts/verify-cloudinary-staging.js`; the 26 MB
check reports whether the provider itself rejected it). Until then the server attach check is the only guaranteed enforcement.

## 11. Rejected / abandoned uploads — cleanup (implemented in Feature 3.1.2)

* A rejected upload (too large, wrong real format, ext/format mismatch, wrong delivery type) is destroyed at attach time (best effort).
  Attach is **stateless** about verification: every attach re-reads the real stored asset, so a failed destroy never makes a rejected file attachable.
* A file uploaded but never attached stays private and unguessable, but costs storage and holds personal data. The **abandoned-receipt cleanup**
  removes those after 24 h.

### How it works
* **Age tracking = upload manifest** (`ReceiptUpload`, Mongo). `POST /api/uploads/sign` writes one row per *receipt* ticket (full public id
  `doppeldash/<orgId>/receipts/<random>`, `issuedAt`, `nextCheckAt = issuedAt + 24 h`). If the row cannot be written the ticket is refused (503) —
  an untracked upload would be an uncleanable orphan. Other kinds (card/document/image) are never recorded or touched.
* **The job only ever reads the manifest.** It never lists the provider and takes no asset id, folder or tenant from a request. Each row is re-validated
  against the exact namespace `doppeldash/<row.orgId>/receipts/<id>` before any provider call (a bad row is counted as `failed` and kept).
* **Eligibility:** row older than 24 h by `issuedAt` (hard floor, independent of `nextCheckAt`) **and** no `Expense` (top-level `receipts` or line-item
  `receiptUrl`, same tenant) references it **at the time of deletion**.
* **Attach-vs-cleanup race:** both sides use an atomic conditional update on the row. Attach (`claimReceiptForAttach`, called by `checkNewReceipts`
  after provider verification) moves `issued|attached → attached` and pushes the next check out 24 h; cleanup moves `issued|attached → deleting`.
  Exactly one wins. If cleanup already holds the row, the attach is refused (400 `attachment_rejected`); if attach won, cleanup does not see the row as due.
  After claiming, cleanup still re-reads the authoritative expenses, so even a reference written by some other path protects the asset (row released as `attached`,
  re-checked weekly).
* **Failure behaviour (all fail safe):** database read error, provider error/timeout/unreachable/malformed answer ⇒ nothing is deleted, the row is released
  (`failures++`, retried after 1 h). A provider answer of "not found" counts as already deleted and the row is removed. A crashed run's `deleting` lease
  (10 min) is reclaimed by the next run, which re-checks references first.
* **Bounded & idempotent:** at most `limit` rows per run (default 100, max 500) and ~40 s of work; no list is ever loaded into memory. Re-running is a no-op.
  Dry-run paginates with a stable `_id` cursor.

### Endpoint, authorisation, scheduling
`POST /api/cron/receipts-cleanup` with `Authorization: Bearer $CRON_SECRET` (same helper as the other crons; fails closed if `CRON_SECRET` is unset; the secret is
**never** read from the query string or body). Body: `{ "mode": "dry-run" | "apply", "limit"?: 1..500, "cursor"?: "<24 hex>" }` (cursor: dry-run only).
* **GET (and PUT/PATCH/DELETE) → 405 + `Allow: POST` and do nothing** — a link, prefetch, crawler or health probe can never delete. The query string is never read.
* Status codes: 200 ok · 400 malformed body / unknown field / bad mode, limit or cursor (nothing runs) · 401 missing or invalid bearer (also when `CRON_SECRET` is unset) ·
  403 `apply` requested while `RECEIPT_CLEANUP_APPLY` ≠ `1` · 405 wrong method · 500 job failure. All responses `Cache-Control: no-store`; bodies are fixed codes or counts.
* **dry-run is the default** (omitted body or omitted mode). `apply` needs a valid bearer **and** `RECEIPT_CLEANUP_APPLY=1` **and** `"mode":"apply"` in the body.
* The request cannot name assets, folders or tenants (unknown fields are rejected).
* response/log: aggregate counts only — `examined, eligible, deleted, alreadyGone, skippedReferenced, failed, more, applyEnabled` (+ `nextCursor` in the dry-run response). No ids, URLs, credentials or file contents.
* **Scheduled callers:** none. `vercel.json` schedules only `/api/cron/birthday`; there is no CI/other workflow calling this endpoint. Vercel Cron issues GET requests, so this POST-only endpoint
  **cannot be driven by `vercel.json` crons** — production scheduling needs an external scheduler that can POST with a bearer header (decision for the rollout task).
* Manual use: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"mode":"dry-run"}' https://<host>/api/cron/receipts-cleanup`
  (and `-d '{"mode":"apply","limit":100}'` once enabled).
* **No scheduler is enabled by this repository** (`vercel.json` is unchanged). Suggested rollout: (1) deploy with `RECEIPT_CLEANUP_APPLY` unset; (2) run the dry-run by hand and
  check `eligible` looks sane; (3) staging run with `mode: apply` + `RECEIPT_CLEANUP_APPLY=1` against the staging cloud; (4) only then schedule hourly in production with an external POST scheduler; repeat while `more` is true.
* **Coverage limit:** only uploads issued after this change are in the manifest. Receipts uploaded before it (none in production at the time of writing, since private
  receipts were never released) would need a one-off reconciliation. Referenced rows stay in the manifest and are re-checked weekly; if the referencing expense is
  later deleted and the immediate destroy failed, the weekly check removes the file.
* Real-provider behaviour of `/image/destroy` for `authenticated` assets (and its "not found" answer) is **still unverified** — covered by `scripts/verify-cloudinary-staging.js` only for the
  basic destroy call; the cleanup job itself has not been run against a real cloud.

## 12. Live-provider verification — operator runbook (NOT yet performed: no staging credentials exist)

`scripts/verify-cloudinary-staging.js` (core: `scripts/lib/stagingVerify.js`) is the only thing that can produce **staging evidence**. Nothing in this repository has
contacted a real Cloudinary or Gemini account. The unit/integration tests of the harness (`tests/staging_harness.test.js`) run against the local fake provider and prove only
the harness's own safety rules and logic — they are **not** live verification and must never be reported as such.

### 12.1 Variables (export them in the shell that runs the script; nothing is read from any file)
| Variable | Required | Meaning |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | credentials of a **dedicated staging/test** cloud |
| `CLOUDINARY_STAGING_CONFIRM` | yes | exactly equal to `CLOUDINARY_CLOUD_NAME` (case-sensitive) |
| `PRODUCTION_CLOUDINARY_CLOUD_NAME` | yes | the **production** cloud name, used only to refuse a collision (case/whitespace-insensitive). A confirmation string alone is never trusted |
| `MONGODB_URI` | yes | `mongodb://127.0.0.1:27017/dd_staging_verify_<anything>` — a **local, fresh** database; the harness refuses a remote/srv host, any other database name, or a database that already holds manifest/expense rows, and **drops it at the end** |
| `STAGING_APP_URL` + `STAGING_CRON_SECRET` | one of these two modes | recommended: cleanup runs through the real HTTP route of a **local** app server (`http://127.0.0.1:<port>`, see 12.3) |
| `STAGING_CLEANUP_APPLY=1` | …or this | cleanup runs in-process instead (no HTTP/authorization evidence) |
| `CLOUDINARY_SIGNED_PRESET` | optional | signed preset, to observe provider-side size/format enforcement |
| `GEMINI_API_KEY` + `GEMINI_STAGING_CONFIRM=1` | optional | one real OCR call on the synthetic receipt; only with a key you have confirmed is safe |

**Must be unset (the script refuses otherwise):** `NODE_ENV=production`, `CLOUDINARY_UPLOAD_BASE`, `CLOUDINARY_DELIVERY_BASE`, `ALLOW_UNSIGNED_UPLOADS`, `CLOUDINARY_URL`,
`NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`, `CLOUDINARY_UPLOAD_PRESET`, a `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` that differs from the staging cloud (or names production), and — with Gemini enabled —
`GEMINI_API_BASE` and `OLLAMA_URL`.

### 12.2 What the script guarantees before and while it runs
* **Preflight first, then nothing else:** every rule above is checked before any upload, deletion, database write or network call; failure exits **2** with redacted reasons.
* It never loads `.env*` files, never calls deployment tooling, never spawns processes, never recovers credentials from another process.
* **Egress guard:** for the whole run `fetch` may reach only the provider's two hosts (`api.cloudinary.com`, `res.cloudinary.com`), the declared local app server and — only if enabled — Gemini.
* **Ownership:** every tenant id is `zz-verify-<8 hex>` generated for the run; every ticket is tracked **before** its upload; a delete is only issued after an exact identity check (tracked by this run + inside
  its own tenant folder + exact id shape). Nothing else in the cloud is listed, touched or cleaned up.
* **Redaction:** all output passes a redactor (credentials, URLs, `cld:` references, asset ids, long hex, bearer tokens). A failed cleanup prints only the run's **tenant ids**, so you can find leftovers.
* `finally` cleanup runs after success or failure, never hides the primary failure, and a cleanup failure turns the exit code non-zero.

### 12.3 Order of execution
1. Create/choose the dedicated staging cloud. (Optional, recommended) create a signed upload preset restricting formats and maximum size and set `CLOUDINARY_SIGNED_PRESET`.
2. Start a **local** app server on a fresh database *with the same staging credentials*, e.g. `MONGODB_URI=mongodb://127.0.0.1:27017/dd_staging_verify_a1 CRON_SECRET=<random 32+> RECEIPT_CLEANUP_APPLY=1 CLOUDINARY_*=<staging> npx next dev -p 3104`
   (use the same database name for the harness; **never** point either at Atlas/production). To exercise the "apply disabled" path first, start it once with `RECEIPT_CLEANUP_APPLY=0`.
3. In another shell export the variables of 12.1 (`STAGING_APP_URL=http://127.0.0.1:3104`, `STAGING_CRON_SECRET` = the server's `CRON_SECRET`) and run `node scripts/verify-cloudinary-staging.js`.
4. Keep the full output. Do **not** paste credentials anywhere.

### 12.4 What it checks (and what each outcome means)
1. Signed upload; tenant folder; random id; `authenticated` type; Admin-API metadata lookup; plan size limit at attach; other-tenant lookup refused.
2. Private download returns the exact bytes; the public URL and the unsigned authenticated URL are refused; a stale download signature is refused.
3. `overwrite=false`; altered folder/type/signature/timestamp rejected.
4. **File-type contract (3.1.5):** PNG bytes declared as PDF through the real signed flow. Expected: *either* the provider refuses the upload (provider-side enforcement of signed `allowed_formats` — observed and reported)
   *or* the provider accepts it and the application refuses it at attach (detected format ≠ declared; row marked `rejected`; cannot be claimed; the owned asset deleted). **Neither → FAIL.** The script does not assume which one
   Cloudinary does; it reports what it observes. PDF-declared-as-PNG is checked the same way; a genuine PDF's outcome (image vs raw resource) is recorded, not assumed.
5. **Cleanup cycle** on four harness-owned assets: *old unreferenced* (manifest back-dated 30 h in the throwaway DB), *old referenced* (an expense row in the throwaway DB), *recent*, and *untracked control* (no manifest row).
   Endpoint authorization is checked (unauthenticated POST → 401, GET → 405); then **dry-run** must report exactly `examined 2, eligible 1, referenced 1, deleted 0` and delete nothing; **apply is attempted only if that
   dry-run matched exactly** (this also catches a server pointed at the wrong database) and the server reports `applyEnabled`. Expected: exactly one asset deleted; referenced, recent and untracked assets retained.
   If the server's `RECEIPT_CLEANUP_APPLY` is not 1 the script says apply was **not** attempted and the run fails.
6. Optional single Gemini OCR call (total 1250.50 expected).

### 12.5 Exit codes, rollback, cleanup
`0` all passed · `1` a check failed, an unexpected error, or cleanup incomplete · `2` refused to run · `3` harness crash. Rollback is automatic (`finally`): every asset the run created is deleted, the throwaway database is dropped. If the script prints
`CLEANUP INCOMPLETE`, delete the named tenant folders (`doppeldash/zz-verify-…`) in the Cloudinary console; they contain only this run's synthetic assets. Stop the local app server afterwards. No scheduler is involved at any point.

### 12.6 Evidence separation
* **Staging evidence** = the output of a real run (`PASS`/`FAIL` lines, the observed enforcement layer). Only that can close "real Cloudinary private delivery / deletion / provider-side format enforcement" and "Gemini OCR accuracy".
* **Local evidence** = `tests/*.test.js` against `tests/helpers/fakeProviders.js`. It proves our code paths, not Cloudinary's or Gemini's behaviour.

## 13. File-type contract (Feature 3.1.5) — what was wrong, what is enforced

**The defect (found on a physical phone):** a PNG named `lying.pdf` was accepted and stored as a PNG. Trace:
1. Both apps derive the *declared* MIME from the picked file's name/extension and send it only to `POST /api/uploads/sign`; the server checked it against the allow-list and **discarded it**.
2. The ticket's signed `allowed_formats` was the full list for every upload, so any supported format passed.
3. The direct-to-provider upload never shows the server the file name; the provider names the stored asset from its **content-detected** format; the client then sends back the provider's URL.
4. The attach-time check compared the reference's extension with the provider's format — both come from the provider, so for an honest upload it could not fail. It only caught a *forged reference*, not a *renamed file*. (The earlier claim that "mismatched formats are rejected" was therefore true for forged references and false for renamed files.)

**The fix (smallest server-verifiable change):** the original file name never reaches the server in this architecture, so the declared type is the only usable metadata; it is now (a) signed into the ticket and (b) stored server-side and re-checked at attach. The server therefore guarantees *declared type == real content type*; it cannot see a file *name*, and a client that declares the real type of a renamed file simply gets that real type (stored, served and labelled truthfully). The proxy continues to pick `Content-Type` from the verified stored reference, never from the URL suffix.

**Provider-dependent (NOT verified against real Cloudinary):** that Cloudinary rejects a signed `allowed_formats` mismatch against its own detected format. The server-side check at attach is the independent guarantee if it does not (tested with an asset injected under a mismatching ticket).
**Known limit:** an upload with no manifest row (issued before manifests existed, or created outside a ticket) has no declaration to compare and is only held to "extension equals real format".

## 14. Provider status and release readiness (as of Feature 3.1.8) — read this before any launch decision

**Feature 3.1 is OPEN. Private receipt storage is NOT production-ready.** Development of unrelated features continues on the existing non-public testing setup; the items below are explicit **release-readiness blockers** to be closed during launch preparation.

### Locally validated (fake providers, throwaway databases, one physical Android phone against a local backend) — proves OUR code paths only
* Private receipt application logic: signed tickets, tenant-folder/random-id uploads, authenticated retrieval proxy, plan size limits, one-file-one-claim, replace/remove, tenant isolation and role authorization.
* Receipt cleanup protections: manifest-based age tracking, reference checks, attach-vs-cleanup locking, bounded batches, idempotency, and the authenticated **POST-only** cleanup endpoint (Bearer header only, dry-run default, explicit apply mode **and** server-side `RECEIPT_CLEANUP_APPLY=1`).
* File-type contract: declared type bound into the signed ticket and re-checked server-side at attach; renamed/mislabelled files rejected on the phone (both directions); valid PNG/PDF preserved.
* Staging-harness safety and refusal behaviour (preflight rules, egress guard, ownership guard, redaction), and the one-call Gemini script's refusals/redaction.
* Reported physical Android scenarios: attach/submit/open via proxy, replace/remove, PDF attach (no in-app PDF preview), offline/provider-unreachable retry, Free 5 MB / Premium 25 MB pre-checks, dark mode and 1.5× text.

### Real Gemini — one request, one path
* **One real request** using the current testing configuration (not a dedicated staging key) answered by Gemini and extracted the expected vendor, total, date and title from `tests/fixtures/synthetic_receipt.png`.
* This proves **one working request/response path only**. General accuracy, reliability, rate/quota behaviour and coverage of real-world receipts (languages, layouts, photos, handwriting, multi-line items) remain **unverified**. No key or secret-derived value is recorded here.

### Real Cloudinary — NOT verified (blocker for release)
Unverified against the real provider: authenticated private upload and download, provider metadata (Admin API) validation, private-asset deletion and missing-file responses, provider-side `allowed_formats` enforcement (and which layer rejects a PNG declared as PDF), genuine-PDF resource handling, and the guarded cleanup dry-run/apply cycle.
* The cloud name and the legacy **unsigned** upload preset that are available are **not sufficient** to validate private storage; the unsigned preset must never be used as a substitute, and receipts must never go back to public URLs.
* Required to close this gate: Cloudinary **API key and secret** for the cloud under test, then run `scripts/verify-cloudinary-staging.js` per §12 (an owner-authorized current-configuration mode may need to be added to the harness at that point; the strict staging mode stays as is).
* Also decide, before launch: retire/disable the legacy unsigned preset for any asset kind that carries personal data, and approve a cleanup-scheduler rollout plan (none is enabled; Vercel Cron cannot call the POST-only endpoint).
* This is deferred to launch preparation and does **not** block unrelated application development.
