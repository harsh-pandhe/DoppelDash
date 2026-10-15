# Phase 4C — acceptance gaps and expense-approval policy (append-only; follows `…_PHASE4B.md`)

**Evidence class: DEVICE / BROWSER-VERIFIED on a QA build against a LOCAL disposable backend with FAKE providers; contract/API results are labelled as such. Not live-provider, not production.** Results: `PASS` · `FAIL` · `BLOCKED` · `NOT RUN` · `N/A`.
Environment as in 4B (fresh `dd_qa5_*_test`, throwaway secrets, fake Cloudinary/Gemini/SMTP, scratch copy of `web/`, `.env.local` untouched). QA package `com.doppeldash.app.qa` 1.0.1-qa, Samsung SM-S721B, Android 16 (screen/USB interruptions: the phone locked while the session was paused and was unlocked again by the owner; battery 7–8 % on USB). Desktop browser = in-app browser pane.

## Expense approval policy (decision + regression coverage)
Investigated: `VALID_TRANSITIONS` in `app/api/rms/[id]/route.ts` (the only route that moves an expense's status; `rms` POST and `travel/conversion` only create at `pending_manager`), the Web UI (`rms/page.tsx`), the Android review sheets, existing audit actions and tests. **The Web UI and the README ("Manager review → Boss approval → Payment") already implement the proposed policy; the server was more permissive** (a manager could reject, send back, or note a claim already at `pending_admin`, or decide line items at any status). No conflicting specification was found, so the proposed policy was adopted:
- `pending_manager`: manager **or admin** may approve (→ `pending_admin`), reject, return to the employee (unchanged; admins keep this on the server and on Android — the Web UI shows these actions to managers only. Left as is; owner may want to align).
- `pending_admin`: **only an admin** may pay, reject or send back; any review write by a manager (status, notes, line decisions) → **403 `review_stage_admin_only`**; same for settled states.
- Admin send-back (`pending_admin → pending_manager`) **requires a reason** (`adminNote`/`managerNote`, else 400 `reason_required`, checked after transition validity so invalid transitions stay 409) and is audited as `expense.returned_to_manager` with `from` and the note.
- The Web line-item buttons now follow the stage (they were shown to managers at every status).
Tests: `tests/expense_approval_policy.test.js` (41: actor × state × target matrix, refused requests leave the document byte-identical and write no audit row, send-back audit, concurrent managers-vs-admin race, payment fields); `expenses_vertical` X13 restored to the strict single-winner invariant and X4 updated for the deliberate change (manager rejecting at `pending_admin` was 200, now 403). 18 of the matrix cases fail against the previous route (negative control).
**Not changed / findings for the owner:** (a) `DELETE /api/rms/:id` lets any manager/admin delete a claim at any status including `paid`; (b) admin acting at `pending_manager` is allowed by server and Android but hidden in the Web UI. Both need a product decision.

## Acceptance matrix
| ID | Case | Role / org plan | Client | Env | Result | Evidence |
|---|---|---|---|---|---|---|
| I1 | Invitation: invalid code → "We couldn't recognise that invitation" | none / Lifetime invite | phone | QA | PASS | device UI dump |
| I2 | Invitation: valid code → "Join QA Lifetime", email + role shown, password mismatch rejected ("Passwords do not match"), accept → signed in, profile step | invited employee / Lifetime | phone | QA | PASS | device |
| I3 | Invitation replay → "This invitation has already been used" | — | phone | QA | PASS | device |
| I4 | Invitation expired (expiry forced in the DB) → "This invitation has expired. Ask your administrator…" | — | phone | QA | PASS | device |
| I5 | Invited user's own sign-in afterwards (password + OTP) | invited employee | API | QA | PASS | login ok |
| F1 | Free: employee logs expense (phone), manager forwards it (phone) | Employee, Manager / Free | phone | QA | PASS | device |
| F2 | Premium (simulated subscription): same journey | Employee, Manager / Premium | phone | QA | PASS | device |
| F3 | Premium admin Web sign-in → `/web-access-restricted`, no session; `/rms` redirects to sign-in | Admin / Premium | desktop browser | QA | PASS | browser |
| F4 | Free admin Web denial (4B) | Admin / Free | desktop browser | QA | PASS | 4B |
| D1 | Android deep links: the manifest declares only MAIN/LAUNCHER; an `https://…/admin/users` VIEW intent resolves to Chrome and a custom `doppeldash://` scheme to nothing — no external entry point exists, so unauthorised / wrong-tenant deep-link destinations cannot be reached | — | phone (intent resolution) | QA | N/A (no deep links implemented) | adb resolve-activity |
| P1 | Peer employee (same org, created through the phone invitation) reading another employee's medical document / leave / expense | Employee / Lifetime | **API** (not on the phone) | QA | PASS | 403 / 403 / 403; owner 200; anonymous 401 |
| P2 | Same on the phone UI | Employee | phone | — | NOT RUN | blocker: the app has no UI path to a colleague's document (employees only see their own leaves) and no deep links; the denial is exercised at API level |
| X1 | Cross-tenant GET/PATCH/DELETE and private-file reads for contact, expense, travel, leave, receipt, itinerary, medical document | 6 Free/Premium users | API | QA | PASS (4B) | all 404 |
| W1 | Web leave: sick > 2 days refused without a document (nothing created); with a synthetic document → created with the private proxy path; visible under the month filter; the default month filter explains why an other-month leave is not listed | Employee / Lifetime | desktop browser | QA | PASS | browser + API |
| W2 | Web expense: incomplete form creates nothing; with a synthetic receipt → created, private proxy path; Manager Approve → `pending_admin` and **no** manager actions remain; Admin Send Back → audited `expense.returned_to_manager`(from `pending_admin`); Admin Mark Paid → `paid` | Employee, Manager, Admin / Lifetime | desktop browser | QA | PASS | browser + audit |
| W3 | Web CRM: empty/invalid submit blocked; valid create → listed; detail loads; back/forward between `/crm` and `/crm/:id` | Admin / Lifetime | desktop browser | QA | PASS | browser |
| W4 | Web CRM detail with a missing/foreign id | Admin / Lifetime | desktop browser | QA | **FAIL → fixed**: showed an empty contact with Edit/Share (the 404 body was used as the contact); now an error with a way back. Regression: `crm_detail_load_states` (3 of 4 fail on the old page) | browser + jsdom test |
| W5 | Web travel: incomplete form creates nothing; valid → `pending_manager` | Admin / Lifetime | desktop browser | QA | PASS | browser |
| W6 | Web travel approval, CRM edit/delete and expense reject/return in the browser UI; real receipt-viewer/PDF; refresh on every nested route | — | desktop browser | QA | NOT RUN | |
| W7 | Mobile-viewport Web write flows | — | 375×812 emulation | QA | NOT RUN (layout checked in 4B) | |
| L1 | Leave screen offline: banner + **"Couldn't load leave requests"** instead of "No leave requests yet"; Retry recovers | Employee / Lifetime | phone | QA | **FAIL → fixed**; PASS after fix | device; Flutter `leave_offline_state_test` (4 tests; the first fails on the old view) |
| A1 | Android expense chain employee → manager forward → admin pay (4B) | — | phone | QA | PASS | 4B |

## Source / results
Web 67 files / 918 tests pass locally (baseline raised from 65/873); tsc, lint (0 errors) and build pass. Flutter analyze clean, 594 pass / 20 skipped (baseline 590 → 594); live contract tests 20/20 against the disposable backend on the final route code.

## Still outstanding
Phone: Premium/Free journeys beyond expenses (leave, travel, CRM), the invited user's full journey, device-driven peer-document denial (see P2). Browser: W6/W7 items. Server: DELETE-on-paid and admin-at-`pending_manager` policy decisions. All Phase 3 live-provider gates (Netlify, SMTP/mailbox, Cloudinary staging, Google Play/RTDN, scheduled jobs, approved legacy medical-document inventory).
