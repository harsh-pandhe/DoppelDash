# Staging: create the Doppelmayr workspace and its Admin (operator runbook)

**Why this exists (found in Phase 12):** a fresh staging database has no `org_doppelmayr`. The entitlement and brand scripts never create an organisation, `/api/auth/setup` needs an existing one, `/api/auth/register` makes ordinary Free (mobile-only) tenants, and the dev seed is correctly disabled on hosted environments. There was no supported path to a Doppelmayr workspace with lifetime Premium + Web in staging. `web/scripts/bootstrap-staging-workspace.js` is that path. It **refuses any database whose name does not contain "staging"**, requires the name typed again, never takes over an existing account, is idempotent and audits what it does.

Run it on **your** machine, with the staging connection string exported only in your shell (never paste it in chat or a ticket):

1. Dry run (writes nothing):
   ```bash
   cd web
   MONGODB_URI='<staging connection string ending /doppeldash_staging>' \
     node scripts/bootstrap-staging-workspace.js --admin-email=harshpandhehome@gmail.com
   ```
   Check the printed database name is the staging one, and the plan says "create organization … create Admin user".
2. Apply:
   ```bash
   MONGODB_URI='…' node scripts/bootstrap-staging-workspace.js \
     --admin-email=harshpandhehome@gmail.com --admin-first=Harsh --admin-last=Pandhe \
     --apply --confirm-db=doppeldash_staging --actor="Harsh Pandhe" --reason="staging acceptance workspace"
   ```
   It prints a **one-time password once, in your terminal only**. Do not paste it anywhere. Sign in at `https://doppeldash-staging.netlify.app/sign-in` with that e-mail and password, enter the OTP that arrives in the mailbox, and set a new password when asked.
3. Re-run step 1 or 2: it reports "No new account was created" (idempotent).
4. Invite the Manager (`harshpandhepcs@gmail.com`) and Employee (`harshpandhe832005@gmail.com`) from Admin → Users in the browser.

Never run this against production: the script will not (name check), and the production site must keep `DD_DEPLOY_CONTEXT=production`.
