# Public support chat (`POST /api/support/chat`)

Unauthenticated **by design**: people need help before they can sign in. Abuse is controlled in code, not by requiring a login.

| Control | Where | Behaviour |
|---|---|---|
| Per-client limit | `lib/support/clientIdentity.ts`, `lib/ratelimit.ts#rateLimitConsume` | 8 / minute per trusted client IP; atomic single-document pipeline update (no check-then-write race); expired windows reset in the same update |
| Client identity | `TRUSTED_CLIENT_IP_HEADER` | **Only the header named here is consulted** and only a single valid IP is accepted. Unset or invalid → all callers share one conservative bucket (30 / minute). Raw IPs are never stored (truncated SHA-256 in the key) |
| Input | `lib/support/chatInput.ts` | streaming 64 KiB limit (works without / with a dishonest `Content-Length`), ≤ 12 messages, roles `user`/`model` only, user ≤ 800 chars, model ≤ 2000, last turn from the user, no control chars; only `role`+`text` are forwarded |
| Global spend ceiling | route | 2000 provider calls / 24 h; charged **only** for requests that will call the provider; ceiling reached → bounded fallback text |
| Failure mode | route | any rate-limit storage error → `503` and **no** provider call |
| Data | route | nothing from the conversation is stored or logged; logs carry `{category, providerStatus, cid}` only; the API key travels in `x-goog-api-key`; replies are capped at 2000 chars |
| Notice | `lib/support/chatClient.ts` | shown at both chat entry points; states the messages go to Google's Gemini and warns against secrets. No retention claim is made |

## Owner actions before launch
1. **Verify the client-IP header on the real platform and set `TRUSTED_CLIENT_IP_HEADER`.** On Netlify this is expected to be `x-nf-client-connection-ip`; this repository cannot prove that, and until it is set every caller shares one bucket (safe, but a single abuser can exhaust it for everyone).
2. Review the new "Sign-in help chat" paragraph in `/privacy` and Google's Gemini API data terms; this repo makes no claim about Google's retention.
3. The model can still be talked into off-topic replies — the system instruction is a hint, not a boundary. The controls above bound cost, size and data exposure, not model behaviour.
