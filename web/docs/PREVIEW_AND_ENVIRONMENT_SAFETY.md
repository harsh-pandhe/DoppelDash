# Preview and environment safety (P0-05)

## What is enforced in code (this repo)
1. `netlify.toml`: `[context.deploy-preview]` and `[context.branch-deploy]` set `ignore = "exit 0"` → those builds are **cancelled**, so unreviewed PR code is not built or run with the site's variables. Production builds are untouched.
2. `lib/deployContext.ts` + `lib/db.ts`: on any recognised hosting platform the process refuses to open a database connection unless `DD_DEPLOY_CONTEXT` is exactly `production` or `staging` (and `production` is refused if Netlify's visible `CONTEXT` says preview/branch-deploy). Local development and the CI/test servers have no platform marker and are unaffected. Tests: `tests/preview_safety.test.js`.

## ⚠ Rollout order (owner action, BEFORE any production deploy of this change)
In Netlify → Site configuration → Environment variables, create `DD_DEPLOY_CONTEXT` scoped to the **Production** deploy context only, value `production`. Without it a production deployment of this code cannot reach the database (by design — fail closed). Do **not** define it for Deploy Previews / Branch deploys unless those use a disposable database and non-production credentials (then value `staging`).

## Inspecting the failed preview of PR #1 (deploy `6acf9433dd7541ef9306cd77`) — owner/ops, needs Netlify login
The GitHub check only says "Deploy failed"; the cause and whether the build saw production variables are unknown from the repository side. Please check, and record the answers in the checklist (P0-05):
- [ ] Build log: why did it fail (header/redirect rules checks suggest a failed build, not a rules problem)? Does the log print any environment values?
- [ ] Which variables exist for the *Deploy Previews* context? Are any production `MONGODB_URI`, `JWT_SECRET`, `ENCRYPTION_SECRET`, `CRON_SECRET`, SMTP/IMAP, Cloudinary, Gemini, Play-billing or `DEV_SEED_SECRET`/`ALLOW_DEV_SEED` values scoped to it? (Use "Specific scopes" so previews get none of them.)
- [ ] Did a preview deployment ever go live (a `deploy-preview-1--…netlify.app` URL)? If yes, was it reachable and did it connect to production data? Check the production database's connection log for the preview window.
- [ ] If any production secret was available to a preview build, treat it as exposed to the build log and rotate it (separate decision; nothing was rotated by this change).
- [ ] Site → Build & deploy → Deploy previews: set to "None" (or "Any pull request … only with isolated variables").
- [ ] GitHub: branch protection / ruleset on `main` requiring the `web` and `flutter-ci` checks and a review; the integration branches currently report `protected=false`.

## Gate
P0-05 stays **BLOCKED** until the checklist above is answered by someone with Netlify access. Code-side mitigation is CODE-VERIFIED / FAKE-VERIFIED only.
