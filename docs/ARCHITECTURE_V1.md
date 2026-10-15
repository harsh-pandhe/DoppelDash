# DoppelDash V1 — architecture of record

_Verified 2026-10-15 against Web `phase-1j-work` and Flutter `phase-1j-work` (see git log); statements about the live Netlify site are **unverified** (no Netlify session in the audit environment)._

## Source of truth
- **Backend = `web/` (Next.js 14 route handlers, Mongoose, one MongoDB).** `web/app/api/**/route.ts` is the only API. The Flutter app (`API_BASE_URL`, default `https://doppeldash-crm.netlify.app/api`, `lib/data/services/api_config.dart`) and the Web UI call the same handlers.
- **`server/` (Express) and `client/` (Vite) are retired.** They were reachable by accident via the root `npm run dev` (which started `server/` next to `web/`). Phase V1 removed that script and made `server/` `start`/`dev` fail with an explanation. The Dockerfile and `docker-compose.yml` build only `web/`; CI builds only `web/`.
- **Two deploy descriptors exist in `web/`:** `netlify.toml` (the real host: `@netlify/plugin-nextjs`, previews cancelled) and `vercel.json` (legacy; its only cron `/api/cron/birthday` is **not scheduled on Netlify**). Required cron jobs therefore need an authenticated external scheduler — see the release checklist.

## "Separate Doppelmayr Web" = access isolation, not a second site or database
One database, one deployment. Web access is a persisted organisation entitlement (`webEnabled`), enforced by the server on login (no browser session cookie without it) and on every cookie-authenticated request. No hostname or organisation-name shortcut exists (test S13 pins that).

| Organisation | plan | source | lifetimeGrant | webEnabled | androidEnabled |
|---|---|---|---|---|---|
| Public Free (registration) | free | none | false | false | true |
| Public Premium (Google Play) | premium | subscription | false | false | true |
| Doppelmayr (audited provisioning) | premium | lifetime_grant | true | true | true |

Pinned by `tests/entitlement_matrix_mobile_web.test.js` (E1/E2), `tests/entitlement_hardening.test.js` (registration cannot elevate; a stored `plan: premium` without a verified subscription or grant resolves to Free; expired/ended/on-hold/pending states resolve to Free; a lifetime grant survives a lapsed subscription).

## Privileged organisation creation
`Organization.ensureDoppelmayr()` callers: the audited provisioning path (`scripts/provision-doppelmayr-entitlement.js`, library `lib/provisioning/doppelmayrEntitlement.ts` — dry-run by default), the dev seed route (`app/api/dev/seed`, which wipes the database and is refused in production unless `ALLOW_DEV_SEED=true` **and** `DEV_SEED_SECRET` is configured), and tests on throwaway databases. `tests/entitlement_hardening.test.js` H4 fails if any other runtime file calls it. **Owner rule: never set `ALLOW_DEV_SEED=true` on the production site.**

## Tenancy: one workspace per account (V1)
`User.email` is globally unique and a user has exactly one `orgId`. Registration creates a new organisation for a new email. **Multiple workspaces under one login are not implemented and are not part of V1.**

## Unverified here (needs the owner's Netlify / provider access)
Linked repo, base directory, production branch, deployed commit, env-var names and scopes, SMTP, Cloudinary (staging), Play Console, scheduler, backups. Tracked in `FINAL_RELEASE_CLOSURE_CHECKLIST.md`.
