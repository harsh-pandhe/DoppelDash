# Phase 4D — remaining functional QA and policy closure (append-only; follows `…_PHASE4C.md`)

**Evidence class: DEVICE / BROWSER-VERIFIED on a QA build against a LOCAL disposable backend with FAKE providers; API/contract results are labelled as such. Not live-provider, not production.** Results: `PASS` · `FAIL` · `BLOCKED` · `NOT RUN` · `N/A`.
Starting point: Web CI [run 38759255552](https://github.com/harsh-pandhe/DoppelDash/actions/runs/38759255552) on `c6c94c84` **succeeded** (67 files / 918 tests: 917 pass, 0 fail, 1 skip = `ds_tokens` T8 interim exception); Flutter CI [run 38759263323](https://github.com/harsh-pandhe/DoppelDash-mobile/actions/runs/38759263323) on `6d8bb3ff` succeeded (594 pass / 20 skipped). Environment as in 4B/4C; the phone is a Samsung SM-S721B (Android 16, QA package `com.doppeldash.app.qa` 1.0.1-qa, battery 7–8 % on USB). Incident: one scripted input sequence ran while the QA app was not in the foreground and landed on the phone's launcher (a few taps and typed characters, no app opened that I could see); the scripts now abort unless the QA app has focus.

## Policy decisions
**Admin actions at `pending_manager` — decided and made consistent.** Admins keep the manager stage on the server (unchanged) *and* now see the same actions in the Web UI; Android already offered them. Reason: a workspace may have no manager (every public workspace starts with a single admin); restricting admins would leave claims stuck, and the audit trail records any admin action. Single source of truth for the UI: `lib/expenses/reviewPolicy.ts` (`reviewActions(role, status)`), used by the detail sheet, both list layouts, bulk actions (per-claim target: manager stage → forward, admin stage → pay) and line-item buttons. `tests/expense_approval_policy.test.js` P5 drives the real route for every reviewer × state × action and fails if the table and the server disagree; P6 pins the table; P7 fails if the page re-implements role/state conditions. Android pins the same rules (`test/domain/expense_rules_test.dart`: admin reviews at the manager step and pays at the payout step; manager has nothing at `pending_admin`). Note: bulk "Approve Selected" by an admin at the manager stage now forwards the claim (it previously did not appear for admins at that stage).

**Paid-claim deletion — OWNER DECISION REQUIRED (D-03); behaviour unchanged.** Today `DELETE /api/rms/:id` lets any manager/admin delete a claim in *any* status including `paid` (the owner cannot delete paid / pending-admin claims); disbanding a sole-owner organisation also deletes all expenses (`docs/ACCOUNT_DELETION_POLICY.md`, decision D-02 still open). Pinned by a clearly-labelled characterisation test (P8) so any change is deliberate. Decision requested: (1) forbid deleting `paid` (and `pending_admin`) claims for everyone; (2) replace deletion of financial claims by an audited **void / correction** state (reason required, who/when, amount retained, receipts retained, excluded from totals); (3) retention period for paid claims and receipts and whether member/organisation deletion may purge them or must pseudonymise (ties into D-02 items 1–2); (4) whether an organisation disband may delete paid claims at all. No behaviour was changed without that decision.

## Acceptance matrix
| ID | Case | Role / plan | Client | Env | Result | Evidence |
|---|---|---|---|---|---|---|
| F1 | CRM create (+ validation) and edit | Employee / Free | phone | QA | PASS | device |
| F2 | Leave apply (casual) → Manager approves | Employee, Manager / Free | phone | QA | PASS | device |
| F3 | Travel request → Manager approves | Employee, Manager / Free | phone | QA | PASS | device |
| P1 | CRM create/edit, leave apply + approve, travel + approve | Employee, Manager / Premium (simulated subscription) | phone | QA | PASS | device (first review attempt hit the first-run coach mark and was repeated) |
| W-Free/Premium | Premium admin → `/web-access-restricted` (4C); Free (4B) | Admin | desktop browser | QA | PASS | 4B/4C |
| I1 | Invitation as the invited user: invalid code, mismatch, accept, replay ("already used"), expiry — **4C** | — | phone | QA | PASS | 4C |
| I2 | Fresh invitation accepted on the phone → "Complete your profile" → Do this later → welcome / role capabilities → dashboard (own empty state, leave balance 37 days) → sign out → password + email OTP sign-in again | Invited employee / Lifetime | phone | QA | PASS | device |
| I3 | After sign-in the invited user is prompted again for the optional profile step | Invited employee | phone | QA | PASS (observation: expected until the profile is completed) | device |
| W1 | Travel approval (Manager "Approve Directly") | Manager / Lifetime | desktop browser | QA | PASS | browser + API |
| W2 | CRM: create, edit (persists after a hard refresh), delete confirmation — Cancel keeps it, Delete removes it (404 afterwards) | Employee / Lifetime | 375×812 | QA | PASS | browser |
| W3 | Web write flows at 375×812: expense with a **PDF receipt**, casual leave, travel request, CRM — no horizontal overflow; dialog fits the viewport | Employee / Lifetime | 375×812 emulation | QA | PASS (emulation, not a real phone browser) | browser |
| R1 | Receipt (PDF) retrieval: `GET /api/rms/:id/receipt/0.pdf` → 200 `application/pdf`, `attachment`, `nosniff`, bytes intact; without a session 401 (the only provider host in a header is the site-wide CSP) | Employee / Lifetime | browser (authenticated fetch) | QA | PASS | browser |
| R2 | Receipt/PDF viewing inside the Web or Android UI (viewer rendering) | — | — | — | NOT RUN (Android PDF preview not implemented — documented limitation; Web opens it as a download) | |
| N1 | Direct navigation + hard refresh on nested routes (`/crm/:id`, `/travel/:id`), back/forward across `/travel/:id` ↔ `/lms/team`; a missing travel/expense id returns to its list | Manager, Employee / Lifetime | desktop browser | QA | PASS | browser |
| N2 | Missing CRM contact id shows an error with a way back (fixed in 4C) | — | browser | QA | PASS | 4C |
| X1 | Cross-tenant GET/PATCH/DELETE and file reads for contact, expense, travel, leave, receipt, itinerary, leave document | 6 Free/Premium users | API | QA | PASS | all 404 (employee PATCH 403) |
| X2 | Same-org **peer** employee (the user invited through the phone) reading a colleague's expense, **PDF receipt** and travel request | Employee / Lifetime | API | QA | PASS | 403 / 403 / 403; anonymous 401; owner 200 |
| X3 | Peer / cross-tenant medical-document denial | — | API (4B/4C) + contract tests | QA | PASS (API); **NOT RUN on the phone** — no UI path to a colleague's document, no deep links |
| X4 | Private CRM contact not visible to same-org manager/admin | Manager, Admin / Lifetime | API | QA | PASS | |
| D1 | Android deep links | — | phone (intent resolution) | QA | N/A (none registered) | 4C |
| L1 | Offline Leave screen fix (4C) | — | phone | QA | PASS | 4C |

## Source / results
Web 67 files / 922 tests pass locally (baseline 918 → 922: +P5, P6, P7, P8); `tsc`, lint (0 errors) and build pass. Flutter analyze clean, 594 pass / 20 skipped (unchanged; no Flutter source change this phase). Final Web CI run: recorded in the checklist row.

## Known release blockers (unchanged by this phase)
Netlify deployment / environment isolation and deployment provenance; real SMTP + mailbox tests; isolated Cloudinary private storage and document streaming (real provider); Google Play Billing / RTDN verification; actual scheduled-job configuration and idempotency; owner-approved legacy medical-document inventory/migration; retention decisions D-02 (account deletion) and D-03 (paid claims); backup/restore, rollback, staging smoke tests and release sign-off. Not run in this phase: the Android PDF viewer (not implemented), a real phone browser, device-driven medical-document denial.

## CI note (append)
Web CI [run 38766436480](https://github.com/harsh-pandhe/DoppelDash/actions/runs/38766436480) on `3069026d` **failed one test**: `travel_attachments` E3 (`0 !== 1` on the `travel.attachments_added` audit row). Not related to this phase's changes: the route writes that audit row fire-and-forget after responding (`writeAudit` is not awaited) and the test read it with no wait. The test helper now waits for the first row and settles before reading; 3/3 isolated runs pass. No application change. Other tests that read fire-and-forget audit rows without waiting may be similarly timing-sensitive; they were not audited.
