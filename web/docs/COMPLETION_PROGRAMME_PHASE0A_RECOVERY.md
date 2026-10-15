# Phase 0A — preserve and reconcile all local work

Executed 2026-10-12. Operations were read-only on every repository (git run with `GIT_OPTIONAL_LOCKS=0`); the only writes were the private backup directory below and this report. Nothing was committed, staged, reset, stashed, cleaned, pruned, merged, branched, pushed or deployed. No secret value was read into this report (environment files were inspected for variable **names** only).

## 1. Backup — verified
| Item | Value |
|---|---|
| Location | `/home/harsh-pandhe/dd-phase0a-backup-20261012-162746` (outside every repo; `drwx------`, files `-rw-------`, owner current user; never copied anywhere else) |
| Created | 2026-10-12T16:27:46+05:30 |
| `web-repo.tar.gz` | `/home/harsh-pandhe/GitHub/DoppelDash` **including its `.git`** (all branches, objects incl. the dropped-stash commits, worktree metadata) and all five worktrees under `.claude/worktrees/`; modified, deleted-on-disk, untracked **and ignored** files (`web/.env.local` ×4, `server/.env`, `web/public/uploads`, `scratch/`, the 4 git-ignored source files, …). 2 904 files (+ symlinks), 177 MB |
| `flutter-repo.tar.gz` | `/home/harsh-pandhe/GitHub/DoppelDash-mobile` incl. `.git`, `android/key.properties`, `android/app/upload-keystore.jks` (presence only verified; contents never read). 994 files, 8.2 MB |
| Deliberately excluded (regenerable) | every `node_modules`, `.next`, `.next-*`; Flutter `build/` (3.4 GB), `.dart_tool/`, `android/.gradle/` — listed in `EXCLUDED.txt` |
| Integrity checks | (1) `gzip -t` on both archives passed; (2) both archives were **extracted** into a scratch dir and every regular file/symlink was SHA-256-hashed on both sides: web 2 904 = 2 904 and flutter 994 = 994 entries, **`diff` of the sorted manifests empty**; (3) all 19 symlinks have identical targets; (4) presence spot-checks passed for the Slice 1–5 files, the four git-ignored upload files, both env/signing files, and the worktree `.git` pointers; (5) archive hashes in `TARBALLS.sha256`; per-file manifests `*-source.sha256` / `*-backup.sha256`. The scratch extraction was then deleted. |
| Baselines (`baseline/<name>/`) | for main checkout, the 4 worktrees and Flutter: `HEAD.txt`, `branch.txt`, `status.z` (`git status --porcelain=v1 -z`), `status.z.sha256`, `worktree.diff`/`staged.diff` (binary), `untracked.txt`, `deleted.txt`, `ignored.txt`; plus worktree/branch/stash listings |
| Original state unchanged | status hashes re-computed after the backup: Flutter `e07ae8ed…`, main checkout `9ab62a52…`, implementation worktree `d0485c80…` — **identical to baseline** (the implementation worktree has since gained this one report file) |

Limits of the verification: the hashes prove the archives contain exactly the bytes that were on disk at backup time; they do not prove the code is correct. The excluded build output is not backed up (rebuildable). File **permissions/ownership** are stored in the tar but not separately manifested. Anything written after the backup (this report) is not in it.

## 2. Inventory of every location
| Location | Branch / HEAD | State | Unique work |
|---|---|---|---|
| Web main checkout `…/DoppelDash` | `main` d6c89b3 = `origin/main` (last fetch) | 2 modified docs, no staged/untracked | the two Play docs (§3); ignored local files: `web/.env.local` (29 var names), `server/.env` (6), `web/public/uploads` (32 legacy uploaded files), `scratch/` (3 patch scripts) |
| **Implementation worktree** `nostalgic-cray-fe329d` | `claude/vigilant-panini-a41107` d6c89b3, no upstream | 156 modified + 77 untracked paths (+3 197/−1 455 lines in tracked files) | **all Slice 1–5 / receipts / OCR / auth / design-system work** (see §5) — exists nowhere else |
| Worktree `cranky-golick-8c3bfb` | detached 56eb3d1 (2026-07-03, "phase-14 audit") | clean | none — commit is an ancestor of `main` (0 ahead, 11 behind) |
| Worktree `thirsty-herschel-2cd8c3` | detached e5b1eca (2026-08-02, "pre-launch hardening") | clean | none — ancestor of `main`; local-only `.env.local` (17 names, older config incl. Anthropic/Google-Vision/Cloudinary-public names) |
| Worktree `upbeat-wiles-83b1c3` | detached e5b1eca | clean | none — ancestor of `main`; `.env.local` (28 names, ⊂ main's) |
| Branches `claude/gracious-spence-f67777`, `claude/thirsty-herschel-2cd8c3` | 56eb3d1 | — | none (ancestors of `main`; thirsty's upstream is `origin/main`, behind 11) |
| Branch `claude/upbeat-wiles-83b1c3` | e5b1eca | — | none (ancestor of `main`) |
| Stash lists (both repos) | empty | — | — |
| **Dropped stash commits** (unreachable, restorable) | web **84**, Flutter **26** (2026-10-04 … 10-12, "WIP on …"/"index on …") | still in the object database and in the backup | snapshots of earlier states of the *same* working trees. Every path they touch exists in the current trees except 2 Flutter paths (below); none include untracked-file parents. Older revisions only — **no file is unique to them**. Do **not** run `git gc`/`prune` until integration is done |
| Flutter checkout `…/DoppelDash-mobile` | `v1-completion-uiux-quality-deploy` 970154e, no upstream | 74 modified, 2 deleted, 62 untracked paths | all uncommitted Flutter work (§5). Branch `master` c631833 is an ancestor of HEAD (0 unique) |

**Flutter deleted files (both intentional, both recoverable from HEAD/backup):** `android/app/src/main/kotlin/com/doppelmayr/doppeldash_mobile/MainActivity.kt` (old package; new `com/doppeldash/…` is untracked) and `assets/branding/doppelmayr-logo.svg` (Doppelmayr branding removed from the public SaaS app).

## 3. Conflicts, duplicates and Play-documentation differences
1. **`.gitignore` line 108 `uploads/` ignores source code.** `web/lib/uploads/{attachmentStorage,privateFile,receiptCleanup}.ts` and `web/app/api/uploads/sign/route.ts` are **ignored, untracked and imported by 26 files**. `git add -A` would silently omit them and every commit containing the receipts/Travel work would not build on a fresh checkout. They are in the backup. *Recovery must anchor the pattern (e.g. `/web/public/uploads/`) in the same change that commits them — an owner/maintainer approval item (a source edit is outside this phase).*
2. **Play docs (the two modified files in the main checkout).** The implementation worktree's copies are byte-identical to `HEAD`; the main checkout's edits therefore exist only there and conflict with nothing in the worktree. Content: they replace the `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE` permission rows and checklist item with "no broad media permissions — system Photo Picker", and bump the expected upload from `1.0.0 (1)` to `1.0.1 (2)`. Both agree with the current Flutter manifest (INTERNET, USE_BIOMETRIC, USE_FINGERPRINT, CAMERA; no media permission) and `pubspec` `1.0.1+2`. **Keep the main-checkout version; do not overwrite.**
3. **Duplicate, stale copies in the Flutter repo.** `docs/PLAY_STORE_ASSETS.md` (42 differing lines), `docs/PLAY_UPLOAD_CHECKLIST.md` (56) and `docs/PLAY_LAUNCH_AUDIT.md` (identical to web's) exist as **untracked** files in the Flutter repo. The Web repo's versions are newer (canonical Netlify URLs, reviewer-account section); the Flutter copies still say Vercel and placeholder URLs. One home should be chosen (decision O3) before committing either.
4. **Credential-bearing docs.** The committed reviewer text names a reviewer account and a static OTP, and the OTP value appears in commit messages already in `main` history. Not reproduced here; rotate before launch (it is already declared "remove after Play review").
5. **`web/.env.local` differs in all four trees** (29 / 14 / 17 / 28 names). The implementation worktree's file is the smallest and carries stale Clerk/Resend names that current code no longer reads; main's holds a `VERCEL_OIDC_TOKEN`. Treat main's as the owner's real local config; the others are disposable. All are mode 664 (group-readable) — tighten.
6. **Overlap check between implementation worktree and the older worktrees/branches:** none (they have no changes of their own), so no merge conflicts are expected from them.
7. **Flutter `android/gradlew`, `gradle-wrapper.jar` and `android/app/src/main/java/` are git-ignored**; a fresh clone cannot run `./gradlew` until Flutter regenerates them (CI note, not data loss).

## 4. Not backed up / not verified
* Build outputs and `node_modules` (regenerable; Flutter `build/` 3.4 GB).
* The remote GitHub state: no network call was made, so "remote HEAD" is the last local fetch.
* Whether an earlier backup elsewhere on the machine exists — not searched.
* The archives sit on the same disk (`/dev/nvme0n1p5`) as the originals: **a disk failure would lose both.** An encrypted off-disk copy requires an owner decision (O2).
* Contents of `key.properties` / the keystore / env files were deliberately not read; only their presence and byte-identity were checked.

## 5. Proposed recovery map (nothing executed)
Counts are tracked+untracked paths in each area (heuristic grouping of `git status`; some paths belong to two areas). Each commit should be made only after it passes `tsc`/`flutter analyze`; if two groups cannot build apart they are merged into one commit.

**Web — branch `integration/phase0-recovery` from `main` (d6c89b3), in this order**
| # | Group | ≈paths | Depends on |
|---|---|---|---|
| 0 | `.gitignore` fix so `lib/uploads` & `api/uploads` are tracked; `.env.local.example` (names only) | 2 | — |
| 1 | Models and indexes (Organization/Subscription/UsageCounter/ReceiptUpload/AuditLog/TravelRequest/Expense/…) | 24 | 0 |
| 2 | Auth, entitlements, web-access boundary, invitations, password policy, middleware | 40 | 1 |
| 3 | Private uploads, receipts, OCR, cleanup cron, staging scripts, docs | 26 + 4 ignored | 1, 2 |
| 4 | CRM / mail / expenses libs and routes | 17 | 1–3 |
| 5 | Travel Slices 1–5 (lib, routes, clients, tests, `TRAVEL_VERTICAL_AUDIT.md`) | 13 + libs/tests | 1–3 |
| 6 | Design system (`components/ds`, `lib/ds`, `app/design*`, docs) — Web look unchanged | 9 | — |
| 7 | Page/client edits (CRM, RMS, dashboard, layout, error boundary) | ~15 | 4–6 |
| 8 | Remaining API route edits (admin, analytics, announcements, reports, search, notifications…) | ~28 | 1–2 |
| 9 | Doppelmayr brand provisioning | 3 | 1 |
| 10 | Tests, helpers, fixtures (backend suite: 50 files) | ~36 | with their feature groups |
| 11 | Docs: Phase 0 / 0A reports, receipts doc, token-handling doc; **Play docs from the main checkout kept as-is** | ~6 | — |

**Flutter — branch `integration/phase0-recovery` from 970154e**
| # | Group | ≈paths | Depends on |
|---|---|---|---|
| A | Package/Android config (applicationId, signing wiring, manifest, kotlin move, gradle) | 20 | — |
| B | Design system, branding, core UI components, dev gallery | 21 | — |
| C | Billing/entitlements/plan limits | 7 | A |
| D | Auth/onboarding/invite/reset/routing | 27 | B |
| E | Travel (revision, paginated list) | 5 | D |
| F | Expenses, receipts, OCR | 11 | D |
| G | CRM/mail/settings/profile/dashboard/admin/directory + data layer | 25 | B–D |
| H | Tests (android, core, routing, security, ui, integration) | 12 | with each group |
| I | Docs/tools (choose one home for Play docs — O3) | 6 | — |
| J | Generated platform files (macos/linux/windows registrants) — review before committing | 2 | — |

Gate for both branches: backup verified (done); fresh-clone build and test run after the last commit must equal the current totals (backend 681 pass/0 fail/0 skip over 50 files; Flutter 442 pass/13 skipped/0 fail) with no assertion edited.

## 6. Owner decisions still required
* **O1** Approve creating the two integration branches and the commit grouping above (and the `.gitignore` correction, §3.1).
* **O2** Approve an additional encrypted off-disk copy of the backup (the current one is single-disk).
* **O3** Which repo is the home of the Play/store documents; whether the main-checkout Play-doc edits are accepted as-is.
* **O4** Whether the legacy ignored files `web/public/uploads/*` (32 files), `server/.env`, `scratch/` are still needed or can be retired later (not touched).
* **O5** When it is safe to prune the 110 dropped-stash commits and retire the 3 clean worktrees / 3 ancestor-only branches (recommendation: not before integration is merged and verified; nothing is deleted now).
* **O6** Rotation of the reviewer OTP/credentials and the `VERCEL_OIDC_TOKEN`/local env tokens before launch.

## 7. Recommendation — **GO** (with conditions)
GO for creating the integration branches **after your review**: the backup is complete and byte-verified for everything that is not regenerable, the original working-tree states are unchanged, the four other worktrees and every other branch hold **no unique work**, and the dropped stashes hold nothing absent from the current trees. The single material hazard found is the ignored `uploads/` source (§3.1), which must be fixed in the first commit. Conditions: O1 approved; keep the backup directory intact; do not run `git gc`/`prune`/`clean` or remove any worktree until the integration branches are pushed and a fresh-clone run reproduces the totals above. I stopped here as instructed — no branch, commit, push or CI was created.
