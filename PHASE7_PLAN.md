# Phase 7+ Master Plan (saved 2026-06-11)

## Phase 7 — Auth Hardening + Navigation Polish ← IN PROGRESS
### 7A Auth (tri-option: Passkey / TOTP / Email OTP) — ✅ SHIPPED 2026-06-11
- [x] Install otplib v13 + @simplewebauthn v10 (server/browser)
- [x] User model: totpSecret (encrypted), totpEnabled, webauthnChallenge(+expiry), tourSeen
- [x] PasskeyCredential model (credentialId/publicKey base64url, counter, transports, nickname)
- [x] Routes: totp/setup (POST begin / PUT confirm / DELETE disable), send-otp,
      verify-otp (method param), passkey/register (POST opts / PUT verify),
      passkey/login (POST opts / PUT verify+session), passkey/credentials (GET/DELETE), tour-seen
- [x] Middleware: send-otp + passkey/login public
- [x] Login flow: TOTP users choose Authenticator/Email tab (email OTP on demand);
      no-TOTP users get email auto-sent (legacy); "Sign in with a passkey" button skips password
- [x] Profile "Sign-in & Security" card: TOTP QR setup + passkey add/list/remove
- [x] Sign-in support AI: instruction rewritten for 3 methods, stale OTP-only info removed
- [x] WelcomeTour: DB-persisted tourSeen (backfills from localStorage; no repeat popups)

### 7B Navigation quick wins
- Sidebar Directory icon → BookOpen; BottomNav unread dot; Sent stub in Communications
- BottomNav: swap News → Travel

### 7C Keyboard shortcuts: wire ?, G+D/G+C/etc, Cmd+N

## Phase 8 — Scan Card + Profile UX
- Scan: flip camera, viewfinder overlay, retake→pick, yellow low-confidence fields, dup banner
- Profile: photo crop, OOO badge in directory/calendar, manager fallback text
- Onboarding: skip for bank/medical, actionable work step, confetti finish

## Phase 9 — Forms / Empty states / Micro-interactions
- Shared DatePicker (replace native date inputs)
- Wire useFormAutosave into RMS new + travel new (hook exists, unused there)
- Scroll-to-first-error + toast; illustrated EmptyStates; skeletons; optimistic approve/reject
- 30s auto-refresh "Updated just now" indicator

## Phase 10 — Feature completions
- Mail: click-queue per-contact bulk (fix mailto block), Copy-rich-HTML button,
  drafts Subject column, pre-send confirmation dialog
- CRM: CSV import, reminder notif href fix (/reports → /crm/[id]), share UI, merge tool
- LMS/RMS/Travel: employee leave calendar, receipt preview, travel legs UI, advance-paid flow

## Phase 11 — Search / Reports / Admin
- Role-aware global search (+employees, travel); employee self-report + CSV/PDF export
- Audit filters; bulk user deactivate

## Phase 12 — Platform
- Dark mode (DB-persisted), IMAP inbox/sent, open tracking + templates

## Auth decision
TOTP + Email OTP + Passkeys ALL offered; user picks at login. TOTP solves
"OTP email unreachable in Citrix". Passkeys = strongest, WebAuthn works in Citrix Chrome.
