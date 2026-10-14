# Google Play RTDN — setup and contract (P0-01)

**Endpoint:** `POST /api/billing/play/rtdn` (Pub/Sub *push*). **Authentication is mandatory and fails closed.**

| Variable (names only) | Meaning |
|---|---|
| `GOOGLE_PLAY_RTDN_AUDIENCE` | the audience configured on the push subscription's authentication (use the exact endpoint URL) |
| `GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL` | the service account the push subscription uses to sign its OIDC token |
| `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_PREMIUM_PRODUCT_ID` | package / product the server accepts |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (or `_EMAIL` + `_KEY`) | credentials for the Play Developer API (reconciliation) |

**Removed:** `GOOGLE_PLAY_RTDN_SECRET`, the `?token=` query secret and the `x-rtdn-secret` header — none is read any more (query strings end up in logs).
**Rules enforced:** valid Google-signed OIDC JWT (RS256, issuer `accounts.google.com`, audience, `email` == push service account, `email_verified`), else 401; either variable unset ⇒ 503 for everything; the notification type is only a hint — the stored state is always what the Play Developer API returns now (Play unreachable ⇒ 503 so Pub/Sub retries; nothing changes); duplicate message ids are acknowledged without work (atomic claim); unknown tokens / other packages are acknowledged and ignored; lifetime-granted organisations are never downgraded; a response without an expiry is never trusted.
**Owner setup (staging first):** create the Pub/Sub topic + push subscription → endpoint = staging URL, enable authentication with the service account and audience above → set the two variables on the server → send the Play Console test notification (expect 200) → license-tester purchase/cancel/refund (LIVE-STAGING evidence). Until then P0-01 is **FAKE-VERIFIED** (`tests/billing_rtdn.test.js`, `tests/batch_m.test.js`) only.
