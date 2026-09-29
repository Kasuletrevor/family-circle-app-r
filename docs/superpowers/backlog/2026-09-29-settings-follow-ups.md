# Settings follow-ups (2026-09-29)

Issues found while reviewing the Settings release (#49) and shipping Remove Private AI (#50) and Open data folder (#51). Ordered by priority within each group. Each entry is independent and can be picked up as its own slice.

Status key: `[ ]` open · `[x]` done

---

## Product gaps

### 1. [x] Restore from local backup

**Problem.** Settings can create a local backup (`SettingsService.createBackup`), but there is no way to restore one. The rebuild spec lists "local backup/restore" as a local application-layer responsibility (`docs/superpowers/specs/2026-09-02-family-circle-rebuild-design.md:51`). A backup that cannot be restored only protects users who restore it by hand.

**Evidence.** `desktop.settings` exposes only `createBackup` and `openDataFolder` (`src/shared/desktopApi.ts`). Backups are written as a folder containing `family.db`, `vault/`, `story/` and `backup.json` (manifest `formatVersion: 1`).

**Suggested direction.**
- Needs a design/spec first: restore replaces live data, so it needs a confirmation step, a pre-restore safety snapshot, and an app restart or re-open of the database.
- Validate `backup.json` (format version, `includes`) before touching live data.
- Run under the shared `MutationLock` so Vault/Story/indexing cannot write mid-restore.
- Decide how the single-account boundary (see #4) applies to restore.

**Done (this branch).** Settings → Local data backup → *Restore from backup…*
- Confirmation step, then a folder picker. The main process checks that `backup.json` has `formatVersion: 1` and includes the database, that the backup was not made by a newer app version, that it contains exactly one account, and that the account's email matches the signed-in user. It also keeps the same single-account-profile rule as backup.
- Validation and staging run under the shared `MutationLock`. The backup is copied to `<userData>/pending-restore` (with the `restore.json` marker written last) and the app relaunches.
- At startup, before the database opens, `applyPendingRestore` moves the current `family.db` (+ `-wal`/`-shm`), `vault/` and `story/` into `<userData>/pre-restore` and moves the staged data into place. If a step fails it rolls back and shows an error dialog. Private AI, voice models and the protected session are never touched.
- Still open: restoring on a fresh computer before signing in (needs the sign-in/registration flow to offer it), and cleanup or UI for the `pre-restore` safety copy (it is replaced on the next restore).

---

### 2. [x] Circle settings: rename and delete Circle

**Problem.** The legacy app's Settings tab let owners **rename** and **delete** a Circle, and let members **leave**. The rebuild has Leave Circle (`src/renderer/features/circles/CircleManagement.tsx:124`), but no rename or delete anywhere. The members/invitations spec says "Circle settings next" (`docs/superpowers/specs/2026-09-04-circle-members-invitations-design.md:405`).

**Evidence.** No `renameCircle` / `deleteCircle` in `src/shared/desktopApi.ts` `circle` namespace. Legacy reference: `kin-keepers-family-circle-app-upload-performance/public/index.html` (`#tabSettings`: Rename Circle, Leave Circle, Delete Circle for owners, with a confirmation step).

**Suggested direction.**
- Check which endpoints Jose's shared API offers for rename/delete (and whether they need `/v2` identity-bound versions).
- Owner-only rename; owner-only delete with a confirmation step that requires typing the Circle name, matching the legacy UX.
- Place in Circle management (per-Circle) rather than device Settings.

**Done (this branch).** Circle management (Members/Invitations) now shows owners a *Circle settings* section:
- Rename: trimmed, 1–120 characters, no-op when unchanged → `POST /api/group/:id/rename { fromUserId, name }`.
- Delete: a dialog that stays disabled until the exact Circle name is typed → `POST /api/group/:id/delete { fromUserId, confirmationName }`, then selects another Circle (or none) and navigates to My Circles.
- Owner checks run in `CircleService` (main); the renderer never sends Circle or user IDs.
- Endpoint shapes were taken from the legacy app and its local Circle server stand-in. **Verify against the live shared server** before release.

---

### 3. [ ] Offline voice setup is not in Settings and cannot be removed

**Problem.** Voice (offline Whisper) has its own setup lifecycle: status, setup, pause, repair (`src/shared/desktopApi.ts:356-359`, under `story`). It is only reachable from My Story. Settings shows Private AI but not voice, and unlike Private AI (after #50) there is no way to remove the downloaded voice models.

**Suggested direction.**
- Add a "Offline voice" card to Settings reusing the Private AI card pattern (status, size, setup/pause/repair).
- Port the #50 removal design: `OfflineVoiceAssetService.remove()`, stop any running transcription first, serialize with the mutation lock, confirm in the UI.

---

### 4. [ ] Backup is blocked on shared Windows profiles

**Problem.** Local backup refuses to run unless the local database contains exactly one Family Circle account (`src/main/settings/SettingsService.ts:76`). Families sharing one Windows login cannot back up at all.

**Why it exists.** The backup copies the whole `family.db`, `vault/` and `story/`, which would include other local users' private data.

**Suggested direction.**
- Either a per-user export (only the signed-in user's rows and `vault/users/<id>`, `story/users/<id>`), or an explicit "back up everyone on this computer" option gated behind re-entering the password.
- Decide together with restore (#1).

---

### 5. [ ] Biometric login

**Problem.** Deferred by the auth/onboarding spec (`docs/superpowers/specs/2026-09-02-auth-onboarding-design.md:672`); the rebuild design reserves `settings/` and `biometrics/` feature folders. Not started.

**Suggested direction.** Needs its own spec (Windows Hello via main process, never exposing credentials to the renderer; setting toggle lives in Settings → Password & security).

---

## Tests and tooling

### 6. [ ] Flaky Family Tree positioning test

**Problem.** `src/renderer/features/family-tree/FamilyTreePage.positioning.test.tsx` fails intermittently with `expected "vi.fn()" to be called 1 times, but got 0 times`. It failed the Windows Package run on #49's final commit (run `36164234240`, test "persists one position write after a completed owner drag", line 71) and failed locally on a different test in the same file ("ordinary member can persist only the viewer node movement", line 109).

**Suggested direction.** Likely a timing race between the simulated drag end and the debounced/async position save. Use fake timers or `waitFor` on the save mock instead of asserting synchronously.

---

### 7. [ ] Renderer tests time out under load

**Problem.** When the machine is busy, several renderer tests exceed Vitest's default 5 s timeout and fail, then pass on re-run: `MyStory.test.tsx` (six-chapter schema render, ~9.6 s), `Vault.privateAi.test.tsx`, `App.test.tsx`, `SettingsPage.test.tsx`, and `CircleManagement.test.tsx` (leave-confirmation test).

**Suggested direction.** Set a realistic `testTimeout` in `vitest.config.ts` (e.g. 15 s) and investigate why the MyStory render test is so slow.

---

### 8. [ ] Pin the Node version (local Node 22 cannot load SQLite tests)

**Problem.** CI uses Node 24 (`.github/workflows/desktop-shell-ci.yml:31`). On local Node 22.13, all 15 test files that import `node:sqlite` fail to load with `Cannot bundle Node.js built-in "node:sqlite"`. This includes `SettingsService`, `AuthService`, the database/migrations tests, and the Story and Vault repositories. The repo has no `engines` field and no `.nvmrc` / `.node-version`, so nothing warns you.

**Suggested direction.** Add `"engines": { "node": ">=24" }` to `package.json` and a `.nvmrc` containing `24`; optionally mark main-process tests with `// @vitest-environment node`.

---

### 9. [x] Windows Package does not run on PRs that touch packaging-critical code

**Problem.** On `pull_request`, `.github/workflows/windows-package.yml` runs only for a hand-picked path list. That list omits `src/main/main.ts`, `src/preload/**`, `src/shared/desktopApi.ts`, `src/main/ai/**`, `src/main/settings/**`, `src/main/vault/**` and most of `src/renderer/features/**`. On `push` to `main` it runs for all of `src/**`. #50 and #51 therefore had their first packaged build only after merging.

**Suggested direction.** Add at least `src/main/**`, `src/preload/**` and `src/shared/**` to the `pull_request` paths, or align the PR filter with the push filter.

**Done (this branch).** The `pull_request` paths now include `src/main/**`, `src/preload/**` and `src/shared/**` (replacing the per-folder main entries and `src/shared/story.ts`). `windowsPackageWorkflow.test.ts` now asserts these paths on the `pull_request` block specifically. Renderer-only changes still skip the packaged build; the Desktop shell CI `npm run check` build covers them.

### 12. [x] Top bar shows a stale Circle name

**Problem.** `TopBar` loads the active Circle name once on mount (`src/renderer/app/TopBar.tsx`, `loadShell`). After switching, leaving, deleting or renaming a Circle, the top bar keeps showing the old name until the app reloads.

**Suggested direction.** Have `DesktopCircleClient` notify subscribers when a Circle mutation succeeds (or reload the shell snapshot on route change), and have `TopBar` refresh its shell snapshot then.

**Done.** `CircleClient.onChange` notifies after every Circle mutation made through the client (select, create, leave, rename, delete, …), and `TopBar` reloads its shell snapshot when it fires.

---

## Private AI (found while testing v0.6.1 end to end, 2026-09-29)

Tested against the manual acceptance list in `docs/PRIVATE_AI.md` using the published 0.6.1 build and then the fixed source build, in an isolated profile.

Blocking bugs, fixed on `fix/private-ai-runtime-extraction`:
- [x] **Setup always failed on Windows** with "Private AI runtime extraction failed". `Expand-Archive` got no paths (arguments after `-Command` are not `$args`) and also rejects `*.zip.part` names.
- [x] **Indexing and every question failed** with "Local embedding failed". llama.cpp b8772 returns `{ embedding: [[…]] }` and `NomicClient` rejected the nested vector.
- [x] **No answer could ever be generated.** llama.cpp b8772 cannot load the Qwen3.5 GGUF (`missing tensor 'blk.24.ssm_conv1d.weight'`). The engine was bumped to b11243 (manifest `1.3.0`). **Requires uploading `llama-b11243-bin-win-cpu-x64.zip` to `familycircle.o2gventures.com/private-ai/bin/`.**
- [x] Answers showed raw Markdown (`**bold**`, `*   ` bullets) in a plain-text box. The prompt now asks for short plain text and `QwenClient` strips leftover Markdown.

### 13. [ ] My Story questions are not reachable from the app
`PrivateArchiveQueryService` supports `story` and `combined` scopes (including the direct-fact fast path and the 384-token "complex" budget), but the desktop API only exposes Vault scopes and the AI Assistant page only asks the Vault. Confirmed Story memories are indexed but cannot be asked about. Acceptance steps 8 and 10 cannot be run.

### 14. [ ] "Not found" answers still list sources
When the model answers that it could not find something, the Sources panel still shows the retrieved chunks, which suggests the answer came from them.

### 15. [ ] Old engine folder is left behind after an engine upgrade
After repairing from `1.2.0` to `1.3.0`, `offline-ai/bin/llama-b8772-bin-win-cpu-x64` (about 130 MB) stays on disk.

### 16. [ ] Smaller findings
- PDF extraction keeps page markers such as `-- 1 of 1 --` in the text, and they get indexed.
- Sign-up surfaces raw IPC errors to users (for example `Error invoking remote method 'auth:check-invitation': Error: Circle service authentication failed`).
- Answers are still somewhat wordy for a 0.8B model. Consider tightening the prompt further and adding a benchmark fixture set (`scripts/benchmark-private-ai.mjs`).

---

## Repo housekeeping

### 10. [ ] Delete stale Settings branches

- `origin/feat/settings-foundation`: closed PR #48, superseded by #49. Its unique work (Remove Private AI, Open data folder) has been ported in #50 and #51.
- Local `feat/settings-v1`: merged as #49.

---

### 11. [ ] Triage old open PRs

- #11 `feature/my-story-history-media-recorder`: "My Story History media and recorder experience", open since 2026-09-12.
- #27 `ci/demo-deploy-status`: "report demo deployment status", open since 2026-09-18.

Decide whether to rebase and merge, or close each one.
