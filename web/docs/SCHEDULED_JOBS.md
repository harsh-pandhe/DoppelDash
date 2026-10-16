# Scheduled jobs — inventory, scheduling gap, idempotency, runbook

Status: **code FAKE-VERIFIED (auth + exactly-once under overlapping runs); NOT SCHEDULED anywhere (BLOCKED on an owner-chosen scheduler + `CRON_SECRET`).** A route that exists, or a `vercel.json` entry, is not an operational job: `vercel.json` is ignored by Netlify.

| Job | Route | Purpose | Cadence (suggested) | Idempotency (since Phase 5) |
|---|---|---|---|---|
| Birthday reminders | `GET /api/cron/birthday` | Mails an organisation's managers/admins about CRM contacts whose birthday is today | daily 07:00 UTC | per-contact **atomic claim** `birthdayGreetingYear = <year>` before sending (the old boolean + Jan-1 reset could re-send); a failed attempt releases the claim |
| Urgent scheduled announcements | `GET /api/cron/announcements` | Emails urgent announcements whose `scheduledFor` has passed | every 5 min | atomic claim of `urgentEmailSent` before sending; failure releases it |
| Onboarding nudges | `GET /api/cron/onboarding` | Nudges employees 7+ days in and not onboarded, at most weekly | daily 09:00 UTC | atomic claim of `onboardingNudgeSentAt` before sending; failure restores the previous marker |
| Abandoned-receipt cleanup | `POST /api/cron/receipts-cleanup` | Deletes unreferenced uploads (dry-run by default; `apply` needs `RECEIPT_CLEANUP_APPLY=1`) | **not to be enabled until Cloudinary staging verification (RECEIPT_STORAGE_AND_OCR.md §12)** | atomic manifest claims (`deleting` lease); never deletes referenced files; POST only |

Authentication (all four): `Authorization: Bearer <CRON_SECRET>` only — never the query string; constant-time compare; **fails closed if `CRON_SECRET` is unset**. Tests: `tests/cron_idempotency.test.js` (J1 refusal matrix incl. query-string/case/basic-scheme; J2–J4 six overlapping runs → exactly one send, negative control: all three fail on the previous code), `tests/receipt_cleanup*.test.js`.

## The scheduling gap (owner decision)
The site is on Netlify; Next.js API routes are not Netlify Scheduled Functions. Pick ONE scheduler and record it here:
1. **GitHub Actions `schedule:`** calling the production URL with the secret from an Actions secret (simple, auditable; runs only on the default branch; ≥5-minute granularity, can be delayed).
2. **Netlify Scheduled Function** (a tiny function that `fetch`es the route with the secret from the site environment).
3. An external cron service (cron-job.org, EasyCron, UptimeRobot) — store the secret in that service; verify it supports custom headers.
Whichever is chosen: configure **retries off or limited to 1**, alert on non-2xx, and never put the secret in a URL.

## Verification runbook (staging first, never production first)
1. Staging site with its own database and `CRON_SECRET`. `curl -s -o /dev/null -w "%{http_code}\n" https://<staging>/api/cron/birthday` → `401`; with a wrong bearer → `401`; with `?secret=…` → `401`.
2. Seed one synthetic contact with today's birthday in a synthetic organisation whose manager is a test mailbox you own. Call the job twice in a row → first `{sent:1}`, second `{sent:0}`; exactly one message in the mailbox.
3. Call it twice concurrently (`curl … & curl … & wait`) → still one message.
4. Watch the scheduler's own run history for one full day (birthday/onboarding) and 30 minutes (announcements). Record timestamps and HTTP codes.
5. Failure drill: temporarily point `SMTP_HOST` at an unreachable host in staging → the job still returns 200 and the claim is **not** lost silently (mail failures are logged as `[mail]` codes only).
Evidence class when done: LIVE-STAGING. Until then: FAKE-VERIFIED.

## Claim leases (Phase 6)
Birthday, announcement and onboarding jobs claim work with a lease (`lib/cron/claim.ts`): an atomic conditional update ensures one runner per item, an overlapping run skips claimed items, an expired lease is reclaimable (crash recovery), and attempts are capped per day. The scheduler itself remains BLOCKED pending owner decision.
