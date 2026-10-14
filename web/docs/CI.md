# CI — what runs and what the owner must configure

* **Web (`.github/workflows/web-ci.yml`)**: install, `tsc`, lint, production build, then `scripts/ci/run-backend-tests.js` (disposable loopback MongoDB, local fake providers, secret-log scan last). Enforces `scripts/ci/baseline.json` (50 files / 681 tests; skips only if listed in `allowedSkips`).
* **Flutter (`DoppelDash-mobile`, `flutter-ci`)**: `flutter analyze` + `tool/ci/check_tests.sh` (442 pass / 13 skipped, the live-backend integration tests).

## Cross-repository design-token check (ds_tokens T8) — owner action required
Test T8 compares `web/design/tokens.json` with the Android copy in the private repo `harsh-pandhe/DoppelDash-mobile`. GitHub's built-in `GITHUB_TOKEN` cannot read another private repository, so a credential is needed. Smallest option: a **read-only deploy key** on the Flutter repository (access to that one repo only, no write, no API scopes).

Secret name in the **Web** repository (Settings → Secrets and variables → Actions): **`MOBILE_REPO_DEPLOY_KEY`** (the private half of the key; never commit or print it).

```bash
ssh-keygen -t ed25519 -N '' -C web-ci-readonly-mobile -f ./mobile_deploy_key          # outside any repo
gh repo deploy-key add ./mobile_deploy_key.pub -R harsh-pandhe/DoppelDash-mobile -t web-ci-readonly   # read-only (no --allow-write)
gh secret set MOBILE_REPO_DEPLOY_KEY -R harsh-pandhe/DoppelDash < ./mobile_deploy_key
shred -u ./mobile_deploy_key ./mobile_deploy_key.pub
```
Alternative (broader, not recommended): a fine-grained personal access token limited to the single repository `DoppelDash-mobile` with **Repository permissions → Contents: Read-only** (nothing else), stored under the same kind of secret and used with `token:` instead of `ssh-key:` in the checkout step.

Until the secret exists, the workflow prints a warning and the runner tolerates exactly one skip (the interim exception in `baseline.json`). **A run using the exception is not a fully reproduced baseline.** Once the secret is configured the runner sets `DD_MOBILE_TOKENS`, allows **zero** skips, and the exception entry should then be deleted after one green run. Pull requests from forks never receive the secret (by GitHub design) and will use the interim exception.
