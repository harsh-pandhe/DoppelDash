# Phase 4B — functional acceptance closure (append-only; follows `DEVICE_QA_2026-10-15.md`)

**Evidence class: DEVICE / BROWSER-VERIFIED on a QA build against a LOCAL disposable backend with FAKE providers. Not live-provider, not production.** Results: `PASS` · `FAIL` · `BLOCKED` · `NOT RUN`.

Environment: fresh `dd_qa5_*_test` MongoDB (loopback), throwaway secrets, fake Cloudinary/Gemini/SMTP, scratch copy of `web/` (real `.env.local` untouched). QA package `com.doppeldash.app.qa` 1.0.1-qa on Samsung SM-S721B / Android 16 (`adb reverse` 3100 + 3912). Synthetic orgs QA Lifetime / QA Free / QA Premium (Premium = simulated active subscription, not a Play purchase), each Admin + Manager + Employee. Desktop browser: the in-app browser pane; mobile viewport 375×812 emulation. Evidence references are the screenshots/dumps kept in the (uncommitted) session scratchpad; none contain secrets in this record.

## Source / CI
Web `d1db5062` (code identical to `b9484934`; docs-only difference). Flutter `93c7aa5b`: analyze clean, 590 pass / 20 skipped. CI dispatch on `d1db5062` (run 38735041235) **failed** `expenses_vertical` X13 — see below; fixed in the commit that adds this record.

## Matrix
| ID | Case | Role / org | Surface | Result | Notes |
|---|---|---|---|---|---|
| A1 | CRM: create contact; required name (Create disabled when empty); invalid e-mail rejected ("Enter a valid email"); edit; persists after app restart | Employee / Lifetime | phone | PASS | |
| A2 | CRM privacy: employee's *Private* contact not visible to same-org Manager/Admin | Manager, Admin / Lifetime | API | PASS | |
| A3 | CRM cross-tenant read by id | all 6 Free/Premium users | API | PASS | 404 |
| B1 | Expense: create single-amount; negative amount cannot be typed (numeric field drops "-") | Employee / Lifetime | phone | PASS | |
| B2 | Expense with synthetic receipt: upload → attached → persisted with a private `cld:` reference | Employee / Lifetime | phone + DB | PASS | |
| B3 | Approval chain: Manager "Approve (forward)" → no further manager action; Admin "Mark as paid" → Paid | Manager, Admin / Lifetime | phone | PASS | UI hides post-forward actions; see policy note |
| B4 | Expense / receipt cross-tenant read | Free/Premium users | API | PASS | 404 (incl. `receipt/0.png`) |
| C1 | Travel: create request (destination, purpose, dates, estimate) | Employee / Lifetime | phone | PASS | |
| C2 | Travel review: Manager sees it under *Team Requests*, Approve → Approved | Manager / Lifetime | phone | PASS | |
| C3 | Travel / itinerary cross-tenant read | Free/Premium users | API | PASS | 404 |
| D1 | Leave: sick > 2 days requires a document (Submit disabled, "A document is required") — Phase 4A | Employee / Lifetime | phone | PASS | 4A |
| D2 | Leave doc: upload failure → Retry → attached; submit; open doc (200); restart persists; Manager opens doc and approves — Phase 4A | Employee, Manager | phone | PASS | 4A |
| D3 | Leave + document cross-tenant (`GET/PATCH/DELETE /api/lms/:id`, `document/0.png`) | Free/Premium users | API | PASS | 404; employee PATCH 403 |
| D4 | Peer-employee (same org) cannot read another employee's medical document | Employee | contract/web tests | PASS (tests only) | `leave_medical_docs` D1 + live E2E; **NOT driven on the phone** |
| E1 | Admin: user list (own org only), add user with a synthetic address | Admin / Lifetime | phone | PASS | invite e-mail delivery to the fake SMTP not verified |
| E2 | Admin: audit log shows travel/expense events; org settings; mail screen loads | Admin / Lifetime | phone | PASS | mail send / IMAP sync **NOT RUN** (provider) |
| E3 | Manager and Employee do not get Admin Management / Analytics-Campaigns (employee) | all | phone (9/9 sweep, 4A) | PASS | |
| F1 | Offline (adb reverse removed): Leave/Expenses/CRM show an explanatory error with Retry; restoring the link and tapping Retry recovers | Employee / Lifetime | phone | PASS | Leave shows the error text and the empty-state together (cosmetic) |
| F2 | Session revocation (server bumps sessionVersion): next request 401 → refresh rejected → sign-in screen "Your session expired. Please sign in again." | Employee / Lifetime | phone | PASS | |
| G1 | Entitlements: cookie/Web only for Lifetime (all roles); Free and Premium denied | 9 users | API (28 endpoints) | PASS | 4A |
| G2 | Free admin Web sign-in → `/web-access-restricted`, no session | Admin / Free | desktop browser | PASS | |
| G3 | Premium admin Web sign-in in the browser | Admin / Premium | browser | NOT RUN | API proves no cookie (G1) |
| H1 | Deep-link / direct request to another tenant's document | — | API | PASS | see D3 |
| H2 | Device deep links (intent URIs) | — | phone | NOT RUN | |
| W1 | Web: sign-in → OTP → dashboard; logout (cookie cleared, `/api/auth/me` 401) | Admin, Employee / Lifetime | browser | PASS | |
| W2 | Web: 17 sidebar routes load for Admin with no error text and no horizontal overflow; analytics shows the phone-created records | Admin / Lifetime | desktop | PASS | shallow: render check only |
| W3 | Web mobile viewport: dashboard + leave/expense/travel/CRM pages, no horizontal overflow | Employee / Lifetime | 375×812 emulation | PASS | emulation, not a real phone browser |
| W4 | Web: Employee opening `/admin/users` and `/admin/audit` is redirected to `/dashboard` | Employee / Lifetime | browser | PASS | |
| W5 | Web write flows (create expense/leave/travel/contact, approvals) in the browser UI | all | browser | NOT RUN | covered by the Node route tests, not by hand |
| W6 | Web refresh/back-forward/dialog cancel/validation on nested pages | — | browser | NOT RUN | |
| X1 | Manager/Admin/Employee of the other roles repeated for QA Free and QA Premium (write journeys) | Free, Premium | phone | NOT RUN | sign-in + role UI 9/9 only (4A) |

## Defects / findings
1. **CI failure on `d1db5062`: `expenses_vertical` X13 (not an application defect).** The test fired four reviewer PATCHes at once and assumed all four would be judged against `pending_manager`. A request that starts after the first commit is judged against the new state, and `pending_admin → rejected` is a legal second step in `VALID_TRANSITIONS`, so two 200s (`pending_admin` then `rejected`) are a valid serial outcome (CI log: `200,409,200,409`). The conditional update (`status: existingExpense.status`) still prevents two transitions out of the *same* state. X13 now asserts serial-order consistency (1 winner, or exactly `pending_admin`+`rejected`, audit rows == applied steps). 5/5 isolated runs pass; earlier intermittent failures of this test in local runs had the same cause.
2. **Policy question for the owner (no change made):** the server lets a *manager* reject an expense that is already `pending_admin`, and send it back to `pending_manager` (only `paid` is admin-only). The phone UI hides these actions after forwarding. If the intent is that the admin stage belongs to admins, `VALID_TRANSITIONS` needs a role dimension; this needs a product decision, not a drive-by change.
3. Cosmetic: leave list shows the error banner and the "No leave requests yet" empty state together when offline.

## Still outstanding
Phone: QA Free/QA Premium write journeys, device deep links, device peer-document denial, invitation acceptance by the invited user, mail provider flows. Browser: UI write flows, nested-route refresh/back-forward, Premium browser sign-in, real phone browser. All Phase 3 live-provider gates. No UI redesign was started.
