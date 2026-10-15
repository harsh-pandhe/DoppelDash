# Travel vertical — audit and proposed plan (Feature 3.1.8 · audit only, nothing implemented)

Travel is the next planned vertical after CRM, Expenses and Receipts/OCR (the roadmap has it as "11E travel chain", with only incidental tests). Follow the same method used for Expenses: validation module → state machine/concurrency → audit → presenter/contract → dedicated vertical test file → Web/Android parity. **Web UI layout stays as approved; only functional validation and copy change.**

## What exists
* Model `TravelRequest` (org-scoped, `userId`, legs, accommodation, `itineraryDocs[]`, status `pending_manager | pending_admin | approved | rejected | cancelled`, `expenseId`).
* API: `GET/POST /api/travel`, `GET/PATCH/DELETE /api/travel/[id]`, `POST /api/travel/[id]/expense` (creates an Expense from an approved, finished trip).
* Web pages (`/travel`, `/travel/new`, `/travel/[id]`); Android repository/view-model/views with unit tests; Android create sheet and detail actions.
* Good already: tenant scoping (`orgId` in every query), employee own-record rule, no IDOR found, self-approval block (`selfApprovalCheck`), transition table, audit on every status change and cancel.

## Gaps found (read from the code)
| # | Gap | Where | Risk |
|---|---|---|---|
| T1 | **No input validation at all** on create: types, lengths, `returnDate < departureDate`, invalid/`NaN` dates, negative/huge/NaN costs, leg `mode` enum, leg shape, accommodation shape, unbounded strings; `await req.json()` unguarded (malformed body → 500) | `POST /api/travel` | data integrity, 500s, DoS-by-size |
| T2 | `estimatedTotal` and `advanceRequested` are client-supplied and never reconciled with legs/accommodation; advance can exceed the estimate | `POST` | wrong money figures feed approvals and the generated expense |
| T3 | **`itineraryDocs` are arbitrary strings** and are copied verbatim into the generated Expense's `receipts` — a bypass of the receipt contract (private refs, tenant/format/size checks, one-file-one-claim) | `POST` + `POST /[id]/expense` | arbitrary URLs/strings stored and later rendered/served; breaks private-storage guarantees |
| T4 | Expense creation from a trip is check-then-create (no atomic claim): two concurrent calls can create two expenses; no audit entry; no idempotency key | `/[id]/expense` | duplicate claims / money |
| T5 | No audit entry on **creation** (`travel.submitted`) | `POST` | audit gap |
| T6 | `PATCH` is unvalidated: `status`/notes types and lengths unchecked; notes can be rewritten at any stage by any manager/admin; no optimistic concurrency (two approvers can race); no `returned`/edit-and-resubmit path (Expenses have one) | `PATCH` | races, no revision flow |
| T7 | Lists: managers get the whole org, hard `limit(200)`, no pagination/filters server-side | `GET` | scale |
| T8 | No dedicated test file: only incidental coverage (IDOR, mobile workflow, conversion) in `batch_*` and `web_android_shared_data` | tests | regressions undetected |
| T9 | Responses are raw documents (no presenter): `itineraryDocs` URLs leak as-is, internal ids/fields exposed | `GET` | consistency with Expenses |
| T10 | `emailTravel*` notifications are fire-and-forget with swallowed errors (acceptable) but unit-untested | routes | low |

Not gaps (verified): entitlements have no Travel gate today (nothing to break); roles/ownership/self-approval and audit-on-transition already hold.

## Proposed ordered slices (each small, each with tests, Web layout untouched)
1. **Slice 1 — `lib/travel/validation.ts` + create hardening (T1, T2, T5, T9-part)** ← *first slice to implement*
   * Mirror `lib/expenses/validation.ts`: strict body parsing (400 on malformed JSON/arrays/non-objects, unknown/`__proto__` keys ignored), field lengths, finite non-negative money, date parsing, `returnDate ≥ departureDate`, ≤ N legs, leg `mode` enum, leg dates within trip window, accommodation shape, `advanceRequested ≤ estimatedTotal`.
   * Server computes `estimatedTotal` from legs + accommodation (client value ignored or must match); idempotency via optional `clientRequestId` like Expenses (Android/Web retry safe).
   * Audit `travel.submitted`. Clear, non-sensitive 400s (`fields: [...]`) so Web/Android can show messages without layout change.
   * Tests: new `tests/travel_vertical.test.js` (validation matrix, tenant isolation, role matrix, audit on create, idempotent retry).
2. **Slice 2 — `itineraryDocs` contract (T3):** accept only server-validated attachment refs (same rules as receipts: tenant-bound, type/size verified); stop copying raw strings into Expense receipts; migration note for existing data (read-only report first).
3. **Slice 3 — state machine + concurrency (T6):** validated PATCH body, optimistic-concurrency update (409 on race, like Expenses), role rules per stage, notes only editable by the acting stage, optional `returned` → edit-and-resubmit path.
4. **Slice 4 — trip → expense conversion (T4):** atomic claim of `expenseId` (single winner), idempotent, audited (`travel.expense_created`), receipts per slice 2.
5. **Slice 5 — list/presenter (T7, T9):** pagination/filters, presenter parity with Expenses, Web/Android contract tests.
6. **Slice 6 — Web ↔ Android parity pass:** same error codes/messages, status pills, regression of `batch_*`/shared-data suites.

## Constraints to keep
Tenant isolation (`orgId` everywhere), role permissions and self-approval rules, audit requirements, the shared Web/Android backend contract (additive changes only; Android client updated in the same slice if a field changes), no production credentials/services, no new Web redesign.


---

# Slice 1 — implemented (create validation, authoritative totals, idempotency, submission audit)

Gaps closed: **T1, T2, T5** fully; **T9** untouched (no presenter yet); T3, T4, T6, T7 are later slices and were deliberately not touched.

## Verified create contract (`POST /api/travel`, shared by Web and Android)
| Field | Rule |
|---|---|
| `purpose` (≤1000), `destination` (≤200), `departureDate`, `returnDate` | **required**. Dates: `YYYY-MM-DD` (what the Web date inputs and Flutter send) or ISO-8601 date-time; date-only = UTC midnight (unchanged meaning); real calendar dates, years 2000–2100; `returnDate ≥ departureDate` (same-day trips are valid) |
| `legs[]` (≤20) | each `{from, to (≤200), date, mode, estimatedCost, notes (≤1000)}`; `mode` ∈ `train, flight, bus, taxi, own_vehicle, other` (the existing enum); `date` required; `estimatedCost` optional → 0 (Flutter omits it) |
| `accommodation` | `{required: boolean, city (≤200), checkIn, checkOut (≥ checkIn), estimatedCost}`; counted in the total only when `required: true` |
| `estimatedTotal`, `advanceRequested` | optional; see the cost rule |
| `itineraryDocs[]` (≤10 unique strings, ≤2048 chars) | shape in Slice 1; **resolved server-side against the private-attachment contract in Slice 2** (see below) |
| `clientRequestId` (≤64, `[A-Za-z0-9_.:-]`) | optional idempotency key |
| anything else | **rejected (400)** — this is also what blocks mass-assignment of `userId, userName, orgId, employeeId, status, notes, approvedBy/At, rejectedBy/At, expenseId, requestHash, _id, timestamps` |
| Server-controlled | `orgId, userId, userName` (session), `status = pending_manager`, `requestHash` |
Roles: **any authenticated role may create** (employee/manager/admin) — unchanged. Tenant: `orgId` always from the session. Errors: `{ error, fields[], code }` (`invalid_travel_request`, `invalid_json`, `body_too_large`, `idempotency_key_conflict`, `duplicate_submission`, `audit_failed`); bodies > 64 KB → 413; no stack traces or database details.

## Money (INR by convention; no currency field exists)
Values must be finite, ≥ 0, ≤ ₹100,000,000, numbers or plain numeric strings (`1e3`, `0x10`, `NaN`, `Infinity` rejected); rounded half-up to **paise** and summed in **integer paise** (`0.1 + 0.2` is exactly `0.30`).
**Cost rule:** `itemised = Σ legs.estimatedCost + (accommodation.required ? accommodation.estimatedCost : 0)`.
* `itemised > 0` → the persisted total **is** the server-computed `itemised`. A client `estimatedTotal > 0` that differs → **400** on `estimatedTotal`; an omitted/`0` claim means "unspecified" and is accepted (Flutter sends `0` when its free-text total is blank).
* `itemised = 0` → nothing to compute, so the validated claim is the lump-sum estimate (existing behaviour, e.g. Flutter's typed total); omitted → 0.
* `advanceRequested ≤` persisted total (an advance with no estimate at all is rejected).

## Idempotency (same design as Expenses, plus a request hash)
* **With `clientRequestId`:** unique partial index `{orgId, userId, clientRequestId}` on `travelrequests` — the database lets exactly one concurrent insert win. First request `201`; replay of the same logical request `200` with the same record; the same key with a **different** request → `409 idempotency_key_conflict` (the record stores a sha256 of the canonical *validated* request, so `"123.45"` vs `123.45` is the same request). Keys are scoped per organisation + user.
* **Without a key:** unchanged "creates a new record", plus the Expenses-style best-effort double-tap guard (identical validated request by the same user within 10 s → `409 duplicate_submission`). **Not race-proof by design** — only keys give database-enforced uniqueness.
* **Client adoption is NOT done in this slice:** neither the Web form nor the Flutter app sends a key yet (a non-visual one-line change each: `crypto.randomUUID()` held for the life of the form / sheet). Until then the 10-second guard is the only protection for them.

## Audit (`travel.submitted`, target type `travel_request`, metadata `{employeeName, destination, amount}`)
Written **before** the response and not swallowed. A partial unique index on `auditlogs` (`{orgId, targetType, targetId, action}` where `action = travel.submitted`) makes it exactly-once: duplicates (concurrent retries, healing replays) hit the index and count as success. If the audit write fails, the request returns **500 `audit_failed`** (the trip is saved); the client's retry with the same key — or inside the 10-second window — **heals** the missing entry. This is a deliberate exception to `writeAudit`'s "never fail a request for audit" convention, limited to `travel.submitted`.

## Tests (new `tests/travel_vertical.test.js`, 28, real HTTP + local DB)
Valid Web-shaped and Flutter-shaped payloads; malformed/oversized bodies; required/length/type matrices; protected-field mass assignment (incl. `__proto__`); dates; modes; money boundaries and rounding; tampered totals and advance limits; unauthenticated, tenant and role matrix on both carriers; exactly-one audit with minimal payload; **audit failure injected at the database (collection validator)** and healed by retry; idempotent replay, key conflicts, per-user/org scoping, 10-second guard; **16-way and 18-way concurrent races over 4 rounds** (one trip, one audit); index existence and an `E11000` assertion; approval and trip → expense conversion still working. Mutation check: without persisting the key, 6 of these fail.

## Unresolved product questions (not guessed)
1. **Currency:** none stored; INR assumed from the app labels.
2. **Lump-sum plus partial legs** (Flutter: typed total with some priced legs): an inconsistent claim is *rejected* rather than silently replaced; a human decision may prefer "legs may be a subset of the estimate".
3. **Leg dates outside the trip window** are accepted (no rule invented); same for accommodation dates relative to the trip.
4. **Whether managers/admins should be able to create** (currently yes, unchanged) and whether a trip may be dated in the past (currently yes — required by the trip → expense flow tests).
5. Unknown fields now fail (400) instead of being dropped; if a client adds fields later they must be added to the contract.

## Follow-ups (not in this slice)
Client keys on Web/Flutter; Slice 2 itinerary-document contract (T3, which also copies raw strings into the expense receipts); Slice 3 PATCH validation + concurrency; Slice 4 atomic trip → expense conversion; Slice 5 presenter/pagination.


---

# Slice 2 — itinerary attachments and conversion (implemented; closes T3)

## Read-only inventory of stored data
* **Method:** read-only script (`find`/`countDocuments` only, no writes), aggregate counts only — no stored value, URL, token or asset id was printed. Classification: validated/private references (same vs cross tenant), public provider URLs (tenant-foldered vs legacy, same vs cross tenant), other external URLs, paths, data URIs, malformed `cld:`-prefixed strings, empty/non-string.
* **Environment audited:** the database named in the project's local `.env.local`, positively identified as safe — loopback host, no SRV, name `dd_authphase1_test`, and the file documents itself as a throwaway local test environment. **Audit date: 2026-10-11.**
* **Observed:** `travelrequests` = **0** records (0 with `itineraryDocs`, 0 entries); `expenses` created from trips = **0** (0 receipt entries). Every class: 0. This is an observation about THAT test database only.
* **BLOCKED / not available:** any real, shared, staging or production data. No Atlas or unidentified remote database was touched, so **the real-world counts are unknown** — treat them as unknown, not as zero. The same script (kept out of the repo) can be run by the owner against a database they identify.
* **What the code says about legacy data (no counts needed for these facts):** before Slice 2 the Web form stored the PUBLIC provider URL returned for a `document`-kind upload verbatim in `itineraryDocs`, and the conversion copied those raw strings into `Expense.receipts` (T3). Android never sends `itineraryDocs`. The Web trip detail page never displayed them. So legacy values, if any, are public tenant-foldered provider URLs written by the Web form, plus anything an API caller put there.

## The verified attachment contract
* **Category:** private receipt-storage files (image/PDF; JPEG, PNG, WebP, HEIC, PDF — the same signed-ticket flow, tenant folder, declared-type pinning and provider verification as expense receipts). Public `document`/`image`/`card` uploads are not itinerary documents.
* **Issuance:** `POST /api/uploads/sign { kind:'receipt', purpose:'travel_itinerary' }` (purpose is validated; default/absent = `expense_receipt`; only valid with `kind:'receipt'`). The manifest row (`ReceiptUpload`) now records **purpose** and the **issuing user** next to the organisation and declared type, before any byte exists. Existing receipt tickets keep working unchanged and are *not* usable for travel.
* **Accepting a value** (`itineraryDocs`, create route): it must be the authenticated-delivery URL of an asset in THIS organisation's private receipt folder (as for expense receipts; raw `cld:` references, public URLs, paths, other hosts/tenants, traversal, query/fragment, wrong extension are all rejected), duplicates rejected; then the manifest must say purpose `travel_itinerary`, same organisation, **same user**, state issued|attached (never rejected/deleting); not already held by another trip, referenced by another trip or by any expense; and the provider must confirm: private type, format = the declared type, size within the plan limit (rejected files are marked `rejected` and deleted best-effort; a verification outage is a 503 and nothing is claimed).
* **Claim:** after ALL values pass, files are claimed **exclusively** (`claimedBy` = the new trip's id, atomic update) before the trip is written; trip ids are deterministic for keyed requests so concurrent same-key retries share one claim holder; a lost claim, a failed write or a key conflict **releases only this request's claims**; a stale claim whose holder trip never existed is taken over. The trip stores private `cld:` references; clients see only `/api/travel/<id>/itinerary/<n>.<ext>`.
* **Reading:** new `GET /api/travel/<id>/itinerary/<n>` — same authorization as reading the trip (owner; manager/admin of the same org; other org 404), shared bounded-streaming/`no-store`/verified-type implementation with the expense receipt proxy (`lib/uploads/privateFile.ts`, a pure extraction). Responses never echo any `cld:` string, provider URL or storage id; legacy plain values are shown as stored and answered with 404 `legacy_attachment` by the proxy.
* **Replace/remove:** there is **no API that updates `itineraryDocs`** (PATCH accepts only status and notes), so replacement/removal does not exist yet; it belongs with PATCH validation (Slice 3), where releasing the claim and deleting the file must be defined. Abandoned uploads (never claimed) are removed by the existing cleanup job after 24 h; **the cleanup's reference check now also considers `TravelRequest.itineraryDocs`**, so a file a trip still uses is never deleted.
* **Reverse boundary:** a `travel_itinerary` file cannot be attached to an expense through the normal expense flow (`claimReceiptForAttach` refuses it).
* **Audit:** `travel.attachments_added {count}` (only on a successful create with documents; replays add nothing), `travel.attachments_converted {transferred, excluded, expenseId}`; no references or URLs in any audit payload.

## Conversion (`POST /api/travel/<id>/expense`) — hardened, not made atomic
* Raw strings are **never** copied. For each stored value: it must be a valid `cld:` reference of this organisation whose manifest row is purpose `travel_itinerary`, state attached and **held by this trip**, and the provider must confirm it right now. Only those become `Expense.receipts` (private references, served by the existing receipt proxy).
* Everything else — legacy strings, foreign/forged/unverifiable references, files deleted at the provider — is **excluded, stays on the trip untouched** (nothing rewritten or deleted), is counted in the audit and as `attachmentsExcluded` in the response (only when > 0). A provider outage is a 503 before anything is created.
* The response now uses the expense presenter (private references appear as `/api/rms/<id>/receipt/<n>`).
* **Not claimed:** conversion is still check-then-create (concurrent conversions can still duplicate) — Slice 4.

## Client compatibility
* **Web:** the itinerary uploader now uses `kind="receipt"` + `purpose="travel_itinerary"` (props already existed / one optional prop added; no JSX structure, layout or styling change). Old Web builds that upload documents as public `document` files will now get **400 on `itineraryDocs[n]`** when creating a trip with documents (a clear, non-sensitive message) until updated; trips without documents are unaffected.
* **Android:** never sends `itineraryDocs`; unaffected (it parses the list as strings; private references now arrive as proxy paths). When an Android attachment feature is added it must use the same ticket purpose.
* **Existing data:** untouched. If a migration is ever wanted, it is a separate, approved operation: (1) read-only report per organisation of legacy values; (2) per value decide re-upload vs. archive; (3) never auto-trust a public URL. Nothing like it was run.

## Tests (new `tests/travel_attachments.test.js`, 21; Slice 1 suite kept, one input updated)
Ticket purpose/user recording and validation; valid PNG/PDF/JPEG (private storage, exclusive claim, one audit, presenter hides references); retrieval auth matrix and verified types; 18+ rejected value classes; array rules; tenant/user/purpose binding; reverse boundary; ineligible stored states and tampered manifest; provider checks (oversize on Free, type mismatch, outage); exclusivity and stale claims; idempotent replay and conflicting reuse (claims released); **parallel races** for one file and for one key; conversion with valid, mixed forged/legacy, legacy-only, deleted-file and outage cases; conversion authorization; cleanup interplay; response hygiene. Negative controls: removing the purpose/user/state validation fails 2 tests; restoring the raw copy in conversion fails 3.
One Slice 1 test (U1) passed a raw `https://example.test/doc.pdf` itinerary document that is now rightly rejected; it now uploads a real travel document instead (its audit assertions are unchanged and extended).

## Remaining follow-ups
Slice 3 (PATCH validation/concurrency, document replace/remove with claim release and file deletion); Slice 4 (atomic, idempotent, audited conversion); Slice 5 (presenter/pagination for the whole Travel API); client idempotency keys on Web/Flutter; the real-provider Cloudinary gate (Feature 3.1 — separate release-readiness workstream, still open).


---

# Slice 3 — PATCH security, optimistic concurrency and document lifecycle (implemented and verified)

## Audit of the PATCH contract before this slice (facts from the code)
* Transitions (unchanged): `pending_manager → pending_admin | approved | rejected`; `pending_admin → approved | rejected | pending_manager`; `approved`, `rejected`, `cancelled` are terminal. At `pending_admin`, approve/reject is boss-only (403 for managers); returning to `pending_manager` is open to managers and admins. Self-approval: a manager acting on their own trip is refused (403); the boss may, and it is audited as `travel.<status>.self_approved`.
* Roles: employees could not PATCH at all (403); managers and admins could. Any manager/admin could write **both** notes at any stage, with no length limit (T6).
* Before this slice there was **no way to change `itineraryDocs`** on an existing trip, no revision, and an unconditional read-then-`save()` write (lost updates).
* Clients: Web detail, Web list (ignored the response status), dashboard approvals queue (carried no record state), Flutter view model → repository `updateStatus`.

## The verified PATCH contract (`lib/travel/validation.ts`, `app/api/travel/[id]/route.ts`)
Body: `{ revision, status?, managerNote?, adminNote? }` **or** `{ revision, itineraryDocs }` — never both. Everything else (every protected/server-owned property included) → 400.
| Rule | Behaviour |
|---|---|
| Malformed JSON / non-object body | 400 `invalid_json` / `invalid_travel_request`; > 64 KB → 413 |
| `revision` missing or `null` | **428 `revision_required`** (no opt-out of concurrency protection) |
| `revision` not a non-negative integer ≤ 1e9 | 400 `invalid_revision` |
| `status` | must be one of the five supported values (400 otherwise); a valid value the table does not allow → 409 `invalid_transition` |
| notes | string ≤ 2000 chars after trimming, no control characters (newline/tab fine); `null`/blank clears. **Manager: `managerNote` only; boss: both** (a manager sending `adminNote` → 403 `note_not_permitted` — the one tightening of the old "anyone writes both" behaviour; Web and Flutter never did) |
| notes-only, empty, or status+documents in one request | 400 |
| precedence | JSON parse → employee refused (403) unless the body is a document edit → **other organisation = 404 (before any field validation)** → field validation → role/stage rules → revision → write |

## Revision token and legacy records
* `TravelRequest.revision` (integer, default 0). **Every** GET (list and detail), POST (201 and idempotent replay) and PATCH response carries it (`presentTravel`).
* **Records that predate the field read as 0**, and are matched deterministically: the conditional write uses `{revision: 0} OR {revision: {$exists: false}}` for token 0, and `$inc` creates the field (0 → 1). A legacy record with a non-zero token → 409.
* The mutation is **one conditional `findOneAndUpdate`** matched on `_id + organisation + current status + revision` with `$inc: {revision: 1}` — never read-then-save. Stale → 409 `revision_conflict` with `currentRevision`; nothing (fields, notes, approval metadata, claims, audit, notifications) is applied for the loser. A cheap pre-check answers obviously stale requests before any provider call; the database predicate is what guarantees it.
* Cancelling (`DELETE`) is a conditional update on `status = pending_manager` that also bumps the revision, so cancel and a concurrent review cannot both win. It needs no body, so it carries no token (the status condition is its precondition).
* Not bumped: the trip → expense conversion's `expenseId` write (Slice 4).

## Itinerary documents (API)
* **Who/when:** the **owner** of the trip, and only while it is `pending_manager`. Managers/admins cannot edit someone else's documents (403); another organisation → 404; once review starts or the trip is actioned/cancelled → 409 `not_editable`. A manager/boss may edit documents of their **own** pending trip.
* **Is this consistent with established policy?** Partly — and it is a **business-rule ambiguity, not an established rule.** The existing policy gave employees exactly three powers: create, read their own, and **cancel their own while `pending_manager`**; PATCH was manager/admin-only. Document editing by the owner is therefore a *new* permission. It was derived by analogy (the same window as cancellation) and does not follow from cancellation by itself. It was kept because it is the narrowest option that makes the lifecycle possible, adds no role and no capability outside the owner's own pending trip, and no approver can change a trip's documents. **If the owner prefers that documents be immutable after submission (or editable by a manager), that is a one-line policy change in the PATCH route and needs a product decision.**
* **Shape:** `itineraryDocs` is the COMPLETE desired list. An entry is either the proxy path `/api/travel/<id>/itinerary/<n>[.ext]` of a document already on this trip (keep), a legacy plain value exactly as shown (keep), or a fresh private-upload URL (add). Omitting an existing entry removes it; replace = omit one + add one. Re-submitting the upload URL of a file the trip already stores is rejected (400) — send its path to keep it.
* **Adding/replacing:** new files go through the Slice 2 contract unchanged (private, same org, **same issuing user, purpose `travel_itinerary`**, state issued|attached, not claimed elsewhere, provider-verified type/size) and are **claimed first**; the conditional write follows; the claims of removed files are released **only after a successful write**, and a file the trip references again by then is re-claimed (a referenced file is never left unclaimed). A lost revision race, a failed write or a failed claim releases **only the claims that request acquired**. Removed files are not deleted by this request: they follow the existing abandoned-upload lifecycle (cleanup removes unreferenced files after the 24 h window; referenced files are protected).
* **Audit:** `travel.attachments_added {count}` / `travel.attachments_removed {count}` (counts only, written after a successful write; a replace writes both); status changes keep their existing `travel.<status>` events and metadata. Stale or rejected requests write nothing; a retried successful call is stale (409) and writes nothing. A lost audit entry never undoes a committed change but is now **logged** (`[audit] write failed <action> <ErrorClass>`, no payload) — it is observable.

## Web and Flutter
* **Web:** detail page (revision from the GET, refreshed from every PATCH response; 409 → "changed by someone else, latest version loaded", dialog closed, record reloaded); list page (revision of the row; it previously ignored the response status and always toasted success — now it shows the real outcome and refreshes); dashboard approvals queue (server passes each travel item's revision; 409 → toast + refresh). No JSX/layout/styling change. Cancel/delete calls need no change.
* **Flutter:** `TravelRequest.revision`; `TravelRepository.updateStatus(..., revision:)`; the view model reads the revision from its loaded list, reloads after success, and on 409 `revision_conflict` reloads and shows a message. Tests added/updated.
* **Limitation (functional, not visual):** **the user-facing document lifecycle is NOT complete.** The Web `/travel/new` page uploads documents at creation only; there is **no control on an existing trip** to add, replace or remove them, and the Flutter app has no itinerary-document UI at all. Replace/remove exist as **API only**. No new UI was added in this slice.

## Verification (newly executed; fresh throwaway DB, fake providers, separate build directories)
* **Two failures from the first run, diagnosed with evidence:**
  * *D8* — **test expectation error.** An employee of another organisation sending a *document* PATCH reaches the tenant lookup (only status changes are refused by role first), so the correct answer is 404 (the test's own title says so); it had asserted 403. Product behaviour was right.
  * *D5* — **test helper error.** The invariant helper counted the malformed legacy string `cld:doppeldash/odd/shape` as a claimable reference; the product (correctly) never claims it. The helper now counts only valid private references of the trip's own organisation.
* **Unmasked by the negative controls (real finding):** D6 wiped the whole fake provider mid-test, so its wrong-purpose / other-user / rejected-state cases were refused only because the files no longer existed. Fixed (one file is deleted; every other fixture is asserted to exist). Doing so exposed a **product inconsistency**: re-submitting the URL of a file already on the trip was accepted as a no-op that bumped the revision and wrote misleading add/remove audit events. It is now a 400.
* **Focused suites, 3 repeats before and 3 after the fixes:** `travel_vertical` 28/28, `travel_attachments` 21/21, `travel_patch` 24/24, no flakes.
* **Negative controls (temporary weakening, restored and verified identical afterwards):**
  * *Drop the revision predicate (status predicate kept):* D10, D11 fail — **document edits and note changes are protected only by the revision; status transitions are additionally protected by the status predicate.**
  * *Drop revision and status predicates and the early check:* R1, R2, T2, C1, C2, D9, D10, D11 fail (8).
  * *Drop purpose/user/state ownership validation:* `travel_attachments` R3, S1 and `travel_patch` D6 fail (after the D6 fix; before it the PATCH suite passed 24/24 — the masking described above).
  * *Release old claims before the conditional write:* D3, D4, D11 fail.
  * *Audit before the conditional write (stale requests would be audited):* T1, T2, C1, C2 fail.
* **Full backend/Web suite:** 646 tests, 646 pass, 0 fail, 0 skipped (48 files), including both production-mode suites and the captured-log secret scan; the dev-server log has 0 hits for secrets, `cld:` or `authenticated/`. `tsc` exit 0; lint 0 errors; `next build` succeeds. `flutter analyze` clean; `flutter test` 441 pass, 13 skipped (live-backend tests), 0 fail.

## Remaining
* **Conversion** — closed in Slice 4 (below). **Client create idempotency keys** are not sent by Web or Flutter. **Pagination and a full presenter** for the Travel API (Slice 5). **Document-editing UI** on Web and Flutter (see above). **Business decision** on who may edit documents after submission. Feature 3.1's **real-Cloudinary release blocker is unchanged** — everything here is proven against the fake provider only.


---

# Slice 4 — concurrency-safe, idempotent, audited trip → expense conversion (implemented; verification below)

## Task A — what the code did before (facts)
* **Route:** `POST /api/travel/<id>/expense`; callers: the Web travel list page only (`createExpense`: toasts `error`, redirects to `/rms?highlight=<id>`). **Flutter has no caller.** The body is ignored.
* **Eligibility/permissions (unchanged):** 401 anonymous; invalid id or other organisation 404; **only the trip's owner** (managers/admins 403); status must be `approved` (409 `Travel not approved`); `returnDate` in the past (409 `Trip not finished yet`).
* **Association:** `TravelRequest.expenseId` (string) + `Expense.travelRequestId` (string; also settable by the normal expense flow for *manual* expenses, so it cannot be made unique).
* **Generated expense:** line items from legs (+ accommodation), `amount` = their sum, `status: pending_manager`; receipts only through `attachmentsForExpense` (Slice 2): `cld:` references of the same organisation whose manifest row is purpose `travel_itinerary`, `attached`, claimed by this trip, and confirmed by the provider *now*; everything else (legacy strings, foreign/forged/deleted/wrong-purpose) is excluded, counted (`attachmentsExcluded`) and left on the trip untouched.
* **Audit storage:** `AuditLog` (`orgId, action, performedBy, performedByName, targetId, targetType, metadata`), written by `writeAudit` (swallow + log) or `writeAuditOnce` (throws; a duplicate-key error counts as success). Only `travel.submitted` had a unique index. The feed (`/api/admin/audit`) lists entries newest first.
* **Defects:** read-then-insert with no reservation → N concurrent calls created N expenses and the last `save()` won the link (orphaned expenses); a crash between insert and link left an unlinked expense and the next call created another; `tr.save()` rewrote the whole document (no revision bump, could overwrite concurrent PATCHes); the `attachments_converted` audit was fire-and-forget and could be lost or, with duplicates, repeated; no `travel.expense_created` event existed.
* **Topology (verified, not assumed):** the local `mongod` 7.0 is a **standalone** server. `startSession().withTransaction()` fails with *"Transaction numbers are only allowed on a replica set member or mongos"*. The code must therefore not rely on transactions; Atlas (a replica set) would allow them, but that cannot be tested here and is deliberately not depended on.

## Task B — the protocol (`lib/travel/conversion.ts`)
No atomicity across documents is claimed. The guarantee is **database-enforced uniqueness + an idempotent, resumable state machine**:

```
(no state) ──reserve──▶ reserved ──link──▶ linked ──finish──▶ complete        (trip.conversion.state)
```
1. **Reserve** — one conditional `findOneAndUpdate` (organisation, owner, `status: approved`, `expenseId` absent, no live lease) writes `conversion {state:'reserved', token, leaseUntil = now + 30 s}`. The loser of a race waits (bounded: 8 s, `TRAVEL_CONVERSION_WAIT_MS`) and then resolves to the winner's expense (200); if the lease is still live after the wait it gets **409 `conversion_in_progress`** with `Retry-After: 2`. An expired lease can be taken over.
2. **Expense** — deterministic `_id` (SHA-256 of org + trip) **and** `Expense.travelConversionOf = <trip id>` with a **partial unique index `{orgId, travelConversionOf}`**. A second insert (race or takeover) gets `E11000` and adopts the existing row. `travelConversionOf` is never accepted from clients (not in the expense field allowlist), and manual expenses linked to a trip via `travelRequestId` are unaffected.
3. **Link** — one conditional update (`status: approved`, `expenseId` absent): sets `expenseId`, `state: linked` and **`$inc revision`**. It can succeed once, so the revision advances exactly once per logical conversion. Reservation and an unlinked expense do **not** change the revision.
4. **Finish** (idempotent; also the whole path of any retry once `expenseId` is set) — marks the transferred files (`ReceiptUpload.transferredTo`), writes the audits, sets `state: complete`.
* **Responses:** 201 for the call that inserted the expense, **200 + the same expense** for every other call (concurrent, sequential, or recovering). Errors: 404/403/409 as before, plus codes `travel_not_approved`, `trip_not_finished`, `conversion_in_progress`, **`conversion_conflict`** (the stored link points to a missing expense, another trip's, another organisation's or another user's — non-sensitive text, nothing overwritten), `attachment_verification_unavailable` (503, reservation released), `conversion_failed` (500, reservation released, retry immediately), `conversion_incomplete` (503: expense exists and is linked, the audit could not be recorded — retry completes it). The caller's body is ignored: **a caller-supplied expense id is never authoritative**; the association is always re-read from the database and checked for organisation, trip and owner.
* **Crash recovery:** every step is repeatable and safe to run twice at once, so *any* crash is repaired by calling again: after the lease expiry for a crash before the expense is linked (the next holder adopts an existing expense through its unique key), immediately for a crash after linking. A handled failure before linking releases the lease at once; nothing is repaired in the background. A *stalled* holder whose lease was taken over cannot double-link (the link predicate) or duplicate anything (unique key).
* **Trips converted before this slice** (`expenseId` set, no `conversion`) replay as 200 with their expense; no audit or revision change is invented.
* **Revision & stale behaviour:** the conversion takes no client revision. After conversion the trip's revision is +1 (visible on every GET/list); `approved` is terminal for `PATCH` (status transitions from it are refused and document edits are only allowed while `pending_manager`), so a stale **or** fresh revision cannot modify a converted trip — the bump matters to clients that cache the record and to future write paths.

## Task C — attachments
* Unchanged contract: only references that pass `attachmentsForExpense` *at creation time* enter `Expense.receipts` (no raw strings, no public URLs). **Transfer semantics:** the file is *referenced by both* the trip and the expense; the trip **keeps** its claim (`claimedBy`, purpose `travel_itinerary`) and the manifest gains `transferredTo = <expense id>` (set only for transferred files, only while the trip still holds the claim). Nothing is released, re-purposed or deleted by conversion (so concurrent retries cannot release the winner's claim). The abandoned-upload cleanup already protects any file an expense or trip references.
* The normal expense flow still cannot accept a travel-purpose upload — converted or not (`POST /api/rms` → 400 `attachment_rejected` / 409 `attachment_in_use`; adding it in an expense edit is refused). Expense receipts keep working.
* Provider outage → **503**, nothing created, reservation released, claims intact, no asset deleted. A retry after the expense already exists never re-reads the provider (it reuses the stored receipts), so recovery works during an outage. Excluded count on a replay = trip documents − expense receipts (derived, stable).

## Task D — audit
* `travel.expense_created` (target type `travel_request`, target id = trip, actor = the owner, organisation, metadata `{expenseId, transferred, excluded}` — counts and ids only) and, when the trip has documents, the existing `travel.attachments_converted` (same metadata as before). Both are written by `writeAuditOnce` with a new **`AuditLog.dedupeKey = "<action>|<trip id>"` and a unique partial index `{orgId, dedupeKey}`** — durable, not in-process. A failed audit returns 503 `conversion_incomplete`, is logged as `[travel-conversion] completion failed <ErrorClass>` (class only) and is produced on the retry without a second expense. `dedupeKey` is excluded from the admin audit feed.

## Failpoints (tests only)
`lib/travel/failpoints.ts`: `x-test-failpoint: <point>` simulates a **process crash** (no cleanup) at `after_reserve | after_expense | after_link | after_mark | after_audit_attachments | after_audit`, `stall_after_expense` simulates a stalled (alive) holder, `expense_insert_error` / `audit_error` are handled failures. Armed only if the server has `TRAVEL_FAILPOINTS=1` **and** `NODE_ENV !== 'production'`; a production build ignores the header (test G1).

## Deployment note
Two new unique partial indexes (`expenses {orgId, travelConversionOf}`, `auditlogs {orgId, dedupeKey}`) are built by Mongoose on first connect (autoIndex, as for the existing indexes). Existing documents lack both fields, so the builds cannot conflict. They are not run against Atlas here.

## Tests (new `tests/travel_conversion.test.js`, 21; real HTTP, local throwaway DB, fake provider)
X1–X4 success/shape, repetition (incl. forged client ids), 14-way parallel × 3 rounds, DB-level uniqueness bypassing the route; F1–F8 crash after reservation / after the expense / after linking / between marking and each audit / handled errors / concurrent recovery / stale and stalled holders; V1–V2 revision; P1–P3 permission, ineligible states, incompatible associations, pre-Slice-4 trips; A1–A3 attachment transfer (valid, foreign, deleted, wrong purpose, forged, legacy), provider outage, reverse boundary and claim ownership; G1 failpoint safety.

## Negative controls (temporary weakening, restored and verified byte-identical)
* *Drop the lease predicate of the reservation:* F1 fails (a live lease no longer blocks). **Duplicates are still impossible** — the unique key and deterministic id are an independent layer (defence in depth, by design).
* *Drop the unique index only (deterministic `_id` kept):* X4 fails (direct inserts bypassing the route duplicate); the route stays correct because the deterministic id also collides.
* *Drop the unique index + deterministic `_id` + lease predicate:* 14 of 20 tests fail (duplicate expenses under parallel calls and recovery).
* *Drop the link predicate (`expenseId` absent):* **initially all 20 tests passed** — a real gap (it only matters when two holders overlap). Added `stall_after_expense` and test F8; with it the mutation fails F8 (double revision bump), and it passes again when restored.
* *Drop the audit `dedupeKey` index:* X4, F4, F6 fail (duplicate audits).
* *Replays never finish pending work:* 13 tests fail.
* *Trust the stored association without checking organisation/trip/owner:* P2 fails.

## Verification (newly executed; fresh throwaway DB, fake providers, separate build directories)
* **Focused suites, 3 repeats:** `travel_vertical` 28/28, `travel_attachments` 21/21, `travel_patch` 24/24, `travel_conversion` 21/21, no flakes.
* **Full backend/Web suite on a fresh DB:** 49 files, 667 tests (661 + 6 in the captured-log secret scan), 667 pass, 0 fail, 0 skipped — including the production-mode suites. The dev-server log has 0 hits for secrets, `cld:` or `authenticated/`. `tsc` exit 0; `next lint` 0 errors (existing a11y warnings only); `next build` succeeds (the conversion route is built). `flutter analyze` clean; `flutter test` 441 pass, 13 skipped (live-backend tests), 0 fail — the mobile app has no conversion caller and was not changed in this slice.

## Known limits and open items
* No transactions on the tested topology: between steps the data can be briefly "reserved/linked/incomplete"; it is repaired by the next call, not in the background. A crashed holder blocks other callers for up to the 30 s lease (they get 409 `conversion_in_progress` after an 8 s wait).
* **A converted expense that is later deleted** (owner may delete a `pending_manager` expense) leaves `expenseId` dangling: the conversion now answers **409 `conversion_conflict`** instead of silently creating a second expense (the old behaviour). Whether re-conversion should be allowed after deletion (and how it would be audited) is a **product decision**, not taken here.
* The `Expense.travelRequestId` link of *manual* expenses remains non-unique (existing behaviour, intentional).
* **Itinerary-document editing is still API-only** (no Web control on existing trips, no Flutter UI). The **owner's document-edit permission** (derived by analogy to cancel in Slice 3) is **unchanged and still needs product approval**.
* Client create-idempotency keys are still not sent by Web or Flutter; pagination/presenter is Slice 5.
* **Feature 3.1's real-Cloudinary verification remains a separate release blocker**; everything here is proven against the local fake provider and a standalone MongoDB only.


---

# Slice 5 — secure pagination and one public response contract (implemented; verification at the end)

## Task A — endpoint inventory (facts, before the change)
| Endpoint | Callers | Notes before Slice 5 |
|---|---|---|
| `GET /api/travel` | Web list page (`fetch('/api/travel')`, filters by status **client-side**); Flutter `TravelRepository.list` (also used by the dashboard view-model) | bare array, `sort({createdAt:-1}).limit(200)` with **no tiebreaker and silent truncation**; employees own rows, managers/admins whole org; `status` was an unvalidated string; indexes only `{orgId}`, `{userId,status}` → in-memory sort |
| `GET /api/travel/<id>` | Web detail, Flutter detail | owner or manager/admin; other org 404, other employee 403 |
| `POST /api/travel` | Web new page, Flutter create | 201 / idempotent 200 replay |
| `PATCH /api/travel/<id>` | Web detail/list/approvals queue, Flutter review | revision protocol (Slice 3) |
| `DELETE /api/travel/<id>` | Web, Flutter | atomic cancel; returned only `{success:true}` |
| `POST /api/travel/<id>/expense` | Web list page only | Slice 4 |
| `GET /api/travel/<id>/itinerary/<n>[.ext]` | `<a href>` links / clients through the paths in `itineraryDocs` | authenticated stream |
* **Fields consumed by clients:** Web list `_id,userId,userName,purpose,destination,departureDate,returnDate,estimatedTotal,advanceRequested,status,managerNote,adminNote,revision,expenseId,createdAt`; Web detail adds `legs,accommodation,itineraryDocs,approvedBy/At,rejectedBy/At`; Flutter model reads the same plus `revision`. Neither reads `orgId`, `clientRequestId`, `requestHash`, `__v`.
* **Presentation differences found:** routes returned Mongoose objects/`lean()` rows through `presentTravel`, which only rewrote `itineraryDocs` and added `revision` — everything else stored on the document (`requestHash`, `clientRequestId`, `__v`, and since Slice 4 the **`conversion` lease token/state**) was returned verbatim to every caller who could read the trip, including managers. The Slice 4 conversion result (an *expense*) carried `__v` and the internal `travelConversionOf`. Errors had four shapes (`{error}` only, `{error,code}`, `{error,fields,code}`, `{success}`) and the 401 from the middleware had no `code`.
* **Private references:** unchanged mechanism — `cld:` values never leave the server; documents are authenticated proxy paths; malformed `cld:`-looking values get an extension-less path (404 `legacy_attachment`); legacy plain values are shown as stored.

## Task B — pagination contract (`lib/travel/pagination.ts`)
* **Request:** `GET /api/travel?limit=<1–100>&cursor=<opaque>&status=<all|pending_manager|pending_admin|approved|rejected|cancelled>&sort=newest`. Unknown parameters are ignored; repeated parameters, non-integers (`1.5`, `1e2`, ` 5`, `+5`, `0x10`), `0`, `101`, unknown `status`/`sort` and malformed cursors are **400** (`invalid_limit`, `invalid_status`, `invalid_sort`, `invalid_cursor`, with `fields`). Default page size **50**, maximum **100**.
* **Two response forms (deliberate compatibility decision):**
  * with `limit` and/or `cursor` → `{ "items": [...], "limit": n, "hasMore": bool, "nextCursor": "…" }` (`nextCursor` only when `hasMore`);
  * with neither (installed Android builds, other API users) → the **legacy bare array**, capped at 200 as before, **but no longer silent**: when cut short the response carries `X-Has-More: true` and `X-Next-Cursor: <cursor>`, which continues in paged mode with no gap. The cap itself was kept only to not break old clients; paged callers have no cap.
* **Order:** `createdAt DESC, _id DESC` — `createdAt` never changes (updates cannot move a row), `_id` is unique (ties are broken deterministically; `_id` alone is *not* time-ordered because keyed requests use a hash-derived id). Rows hand-inserted **without `createdAt`** form a final tier ordered by `_id DESC`, so nothing is skipped.
* **Keyset query:** tenant (`orgId` from the session) + visibility (employees `userId`, managers/admins whole org) + `status` are in the query *before* the limit; the page condition is `createdAt <= c AND (createdAt < c OR _id < id)`, so the index seeks to the cursor and at most one tie group is re-examined. The server reads `limit + 1` rows to know `hasMore` — **no count query, no totals** (no client needs one; an exact count would scan the tenant).
* **Cursor:** `base64url({c: createdAt ms | null, i: _id}) + "." + HMAC` where the HMAC (server JWT secret, domain-separated) covers the payload **and the scope** (organisation, own-records vs organisation-wide, status filter). Tampering, truncation, a cursor from another tenant, from an employee used by a manager (or the reverse), or from another status filter all return the **identical** `400 invalid_cursor` body — nothing reveals whether a position exists elsewhere. Manager and admin share a scope by design (identical visibility).
* **Consistency under concurrent writes:** new rows appear at the head and never shift or duplicate what a reader already has; a deleted row disappears; status/revision updates do not move a row (tested).
* **Indexes (new, built by Mongoose on first connect; none created against Atlas):** `{orgId, createdAt:-1, _id:-1}` (manager list), `{orgId, status, createdAt:-1, _id:-1}` (manager + status), `{orgId, userId, createdAt:-1, _id:-1}` (employee list; `status` is a residual filter over one user's own rows). Existing `{orgId}` and `{userId,status}` were kept (used elsewhere). `explain` in the tests shows an index range scan, **no in-memory SORT, no COLLSCAN**, ≤ 40 documents examined for a page of 10 (including deep pages and tie groups).
* **Trade-offs:** no random access to "page N" and no total; one extra tiny query on the final page (legacy undated rows); `sort` supports only `newest`; `status` filters are exact.

## Task C — canonical response schema (`lib/travel/present.ts`)
Every Travel route returns trips through `presentTravelRecord`, an **explicit allowlist**:
`_id, orgId (the caller's own tenant, kept for compatibility), userId, userName, [employeeId], purpose, destination, departureDate, returnDate, legs[{_id,from,to,date,mode,estimatedCost,[notes]}], itineraryDocs (proxy paths / legacy values), estimatedTotal, advanceRequested, [accommodation{required,[city,checkIn,checkOut,estimatedCost]}], status, revision (0 for records that predate it), createdAt, updatedAt, [managerNote, adminNote, approvedBy, approvedAt, rejectedBy, rejectedAt, expenseId]`.
* **Never exposed:** `conversion` (lease token/state), `requestHash`, `clientRequestId`, `__v`, `cld:` references, provider URLs, manifest data, `dedupeKey`, and any other stored field (a new model field is invisible until added to the allowlist; tested with a document carrying junk fields).
* **Single-record shapes:** create/replay/GET/PATCH → the trip above; `DELETE` → `{success:true, _id, status:'cancelled', revision}` (`success` kept for old clients); conversion → the expense (existing `presentExpense`, now without `__v` and `travelConversionOf`) plus `attachmentsExcluded` when applicable (unchanged).
* **One error envelope** `{ error, code, [fields], …extra }` with the established statuses: new codes added where there were none (`unauthorized`, `not_found`, `forbidden`, `not_cancellable`, `boss_only`, `self_approval_forbidden`). The 401 from the global middleware now also carries `code:'unauthorized'` (additive, all API routes). A foreign tenant's record produces byte-identical 404 bodies to a missing one on detail, PATCH, DELETE, conversion and the itinerary proxy (tested).

## Client compatibility (no UI/JSX/style change)
* **Web:** the list page requests `limit=100` pages and follows `nextCursor` (max 20 pages = 2 000 trips, then stops) instead of one capped call; it still accepts a bare array. Filtering stays client-side as before.
* **Flutter:** `TravelRepository.list` follows the cursor the same way (limit 100, max 20 pages) and still accepts a bare list; new unit test. The dashboard shares this method.
* **Intentional contract changes:** `status`/`limit`/`sort`/`cursor` are validated (400 instead of an empty list for a bogus `status`); trips no longer include `clientRequestId`, `requestHash`, `__v`, `conversion`; expenses returned by the expense routes no longer include `__v`/`travelConversionOf`; additive `code` fields; `DELETE` returns extra fields.

## Task D — regression guarantees
All Slice 1–4 suites were re-run unchanged (revision protocol, cancel atomicity, conversion concurrency/recovery/exactly-once audit, attachment ownership, idempotent replay, tenant and role matrices) and still pass; no state machine or write path was altered.

## Tests (new `tests/travel_api.test.js`, 14; real HTTP, throwaway DB, fake provider)
P1 empty lists; P2 multi-page walks with timestamp ties at limits 1/5/10/53/100 and default size; P3 limit validation; P4 employee/manager/admin/tenant visibility and metadata; P5 status/sort filters; P6 consistency with inserts, deletes and updates between pages; P7 eleven kinds of bad cursor (identical body) incl. foreign tenant, other scope, other filter; P8 legacy array form + headers continuing in paged mode; P9 `explain` (no SORT/COLLSCAN, bounded docs, indexes exist); P10 undated legacy rows; R1 public shape for create/replay/list/detail/PATCH status+documents/conversion/replay/cancel and `rms` detail; R2 attachment presentation and proxy authentication; R3 legacy/junk records; R4 error envelope matrix incl. foreign-vs-missing equality.
**Negative controls** (restored, verified identical): cursor not scope-bound → P7 fails; no signature check → P7 fails; presenter spreading the stored document → P8, R1, R3 fail; no `_id` tie-breaker → P2, P6, P10 fail; visibility not in the query → P2, P4, P5, P8 fail; indexes absent → the plan has an in-memory SORT (P9 asserts against it).

## Verification (newly executed this slice; historical Slice 4 totals above are not reused)
* **Focused suites, 3 repeats:** `travel_vertical` 28/28, `travel_attachments` 21/21, `travel_patch` 24/24, `travel_conversion` 21/21, `travel_api` 14/14 — no flakes.
* **Full backend/Web suite on a fresh DB with its own build directory:** 50 files, 681 tests (675 + 6 in the captured-log secret scan), 681 pass, 0 fail, 0 skipped, including both production-mode suites. Dev-server log: 0 hits for secrets, `cld:`, `authenticated/`. `tsc` 0; `next lint` 0 errors; `next build` succeeds (separate dist dir).
* **Flutter:** `flutter analyze` clean; `flutter test` 442 pass (441 + the new pagination test), 13 skipped (live-backend), 0 fail.
* Existing tests were not weakened. Only change to an existing assertion set: none (the allowlist initially dropped `orgId`, which `travel_vertical` asserts; it was restored to the contract instead of editing the test).

## Remaining API and product limitations
* The legacy (parameter-less) list still caps at 200 rows (signalled by headers); Web/Flutter cap their own walk at 2 000 trips. Status filtering on Web is still client-side. No search/date filters, no total counts.
* `orgId` is still returned (compatibility); converting a trip whose expense was deleted still answers `conversion_conflict`; itinerary-document editing remains API-only and the owner's edit permission is **unchanged and still awaits product approval**; client idempotency keys are still not sent by Web/Flutter.
* Index builds on a large production collection should be scheduled by operators (not done here). **Feature 3.1's real-Cloudinary verification remains a separate release blocker** — nothing here makes private storage production-ready.
