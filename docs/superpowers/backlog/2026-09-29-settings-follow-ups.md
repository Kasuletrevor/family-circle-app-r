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

### 3. [ ] Offline voice setup is not in Settings and cannot be removed (partly done)

**Problem.** Voice (offline Whisper) has its own setup lifecycle: status, setup, pause, repair (`src/shared/desktopApi.ts:356-359`, under `story`). It is only reachable from My Story. Settings shows Private AI but not voice, and unlike Private AI (after #50) there is no way to remove the downloaded voice models.

**Suggested direction.**
- Add a "Offline voice" card to Settings reusing the Private AI card pattern (status, size, setup/pause/repair).
- Port the #50 removal design: `OfflineVoiceAssetService.remove()`, stop any running transcription first, serialize with the mutation lock, confirm in the UI.

**Partly done (PR #11).** No screen called the voice setup API at all, so voice could never be installed. My Story's Record voice now shows setup (size, progress, pause/continue/repair) when voice is not ready. Still open: a Settings card, and removing the voice models.

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

### 6. [x] Flaky Family Tree positioning test

**Problem.** `src/renderer/features/family-tree/FamilyTreePage.positioning.test.tsx` fails intermittently with `expected "vi.fn()" to be called 1 times, but got 0 times`. It failed the Windows Package run on #49's final commit (run `36164234240`, test "persists one position write after a completed owner drag", line 71) and failed locally on a different test in the same file ("ordinary member can persist only the viewer node movement", line 109).

**Suggested direction.** Likely a timing race between the simulated drag end and the debounced/async position save. Use fake timers or `waitFor` on the save mock instead of asserting synchronously.

**Done.** This was a real component bug, not a test-timing issue. `FamilyTreeCanvas` ran a `[layout]` effect that set `dragRef.current = null`. That effect also runs on mount, as a passive effect: when the test found the node and pressed on it before React flushed the effect, the flush cleared the drag, so pointer-up saved nothing. Confirmed with logging in a failing run (`layout effect cleared an active drag` → `pointerUp drag present=false`). In the app, a tree refresh mid-drag would also silently drop the user's move. The effect now skips the layout it was initialised from, and keeps an in-progress drag (at its current position) when the layout refreshes, unless that person left the tree. A new deterministic test refreshes the layout mid-drag. Stress runs: 1/12 failures before, 0/25 after.

---

### 7. [ ] Renderer tests time out under load

**Problem.** When the machine is busy, several renderer tests exceed Vitest's default 5 s timeout and fail, then pass on re-run: `MyStory.test.tsx` (six-chapter schema render, ~9.6 s), `Vault.privateAi.test.tsx`, `App.test.tsx`, `SettingsPage.test.tsx`, and `CircleManagement.test.tsx` (leave-confirmation test).

**Suggested direction.** Set a realistic `testTimeout` in `vitest.config.ts` (e.g. 15 s) and investigate why the MyStory render test is so slow.

---

### 8. [x] Pin the Node version (local Node 22 cannot load SQLite tests)

**Problem.** CI uses Node 24 (`.github/workflows/desktop-shell-ci.yml:31`). On local Node 22.13, all 15 test files that import `node:sqlite` fail to load with `Cannot bundle Node.js built-in "node:sqlite"`. This includes `SettingsService`, `AuthService`, the database/migrations tests, and the Story and Vault repositories. The repo has no `engines` field and no `.nvmrc` / `.node-version`, so nothing warns you.

**Suggested direction.** Add `"engines": { "node": ">=24" }` to `package.json` and a `.nvmrc` containing `24`; optionally mark main-process tests with `// @vitest-environment node`.

**Done.** `package.json` has `"engines": { "node": ">=24" }` (npm warns on older Node) and `.nvmrc` contains `24`. `nodeVersion.test.ts` keeps both in step with every `node-version` in the CI workflows.

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

### 13. [x] My Story questions are not reachable from the app
`PrivateArchiveQueryService` supports `story` and `combined` scopes (including the direct-fact fast path and the 384-token "complex" budget), but the desktop API only exposes Vault scopes and the AI Assistant page only asks the Vault. Confirmed Story memories are indexed but cannot be asked about. Acceptance steps 8 and 10 cannot be run.

**Done.** The AI Assistant is now "Ask Private AI", with four scopes: My Story and Vault (default), My Story, All Vault documents, Choose Vault documents. Public scopes `story` / `story-and-vault` map to the engine's `story` / `combined`, and Story sources come back as `{ sourceType: 'story', chapter, label, excerpt }`. Real-model test: direct Story facts in 0.3 s; memory questions and combined Story + Vault answers correct in 2–6 s.

### 14. [x] "Not found" answers still list sources
When the model answers that it could not find something, the Sources panel still shows the retrieved chunks, which suggests the answer came from them.

**Done.** The prompt asks for `NOT_FOUND`, which is replaced by the scope's local not-found answer with no sources. If the model words it instead ("there is no information…" in the first sentence), the text is kept but the sources are dropped. Real-model test: unanswerable questions show no sources in every scope, and real answers keep theirs.

### 15. [x] Old engine folder is left behind after an engine upgrade
After repairing from `1.2.0` to `1.3.0`, `offline-ai/bin/llama-b8772-bin-win-cpu-x64` (about 130 MB) stays on disk.

**Done.** After a successful setup, and once per run when Private AI is ready (so existing installs are cleaned too), engines, models and staging inside `offline-ai` that the current manifest does not reference are deleted. Verified in the app: the old 115 MB b8772 folder was removed on launch.

### 17. [ ] Sources always show the top three matches
Answers list the three highest-ranked chunks even when one is barely relevant (for example "My Story · What I do" under a question about the family doctor). Consider a similarity threshold, or showing only the sources the answer used.

### 16. [ ] Smaller findings
- [x] PDF extraction keeps page markers such as `-- 1 of 1 --` in the text, and they get indexed. **Done:** removed from PDF text at extraction. PDFs indexed before the fix keep the markers until they are re-indexed.
- [x] Sign-up surfaces raw IPC errors to users (for example `Error invoking remote method 'auth:check-invitation': Error: Circle service authentication failed`). **Done:** `userFacingError` removes the IPC prefix, turns server, network and mail failures into plain sentences, and hides paths and stack details. Used on sign-in, sign-up, recovery, onboarding, session restore and Settings.
- Answers are still somewhat wordy for a 0.8B model. Consider tightening the prompt further and adding a benchmark fixture set (`scripts/benchmark-private-ai.mjs`).

---

## Repo housekeeping

### 10. [x] Delete stale Settings branches

- `origin/feat/settings-foundation`: closed PR #48, superseded by #49. Its unique work (Remove Private AI, Open data folder) has been ported in #50 and #51.
- Local `feat/settings-v1`: merged as #49.

---

### 11. [x] Triage old open PRs

- #11 `feature/my-story-history-media-recorder`: "My Story History media and recorder experience", open since 2026-09-12.
- #27 `ci/demo-deploy-status`: "report demo deployment status", open since 2026-09-18.

Decide whether to rebase and merge, or close each one.

**Done (#10, #11).** Deleted 65 stale remote branches (44 with merged PRs, 3 with closed PRs, 18 with no PR that were already in `main`, were identical old snapshots, or held superseded/temporary work) and 2 stale local branches. A list of their commit IDs was kept locally for recovery. Closed #27 as superseded (demo-deploy status reporting already exists in `windows-package.yml`). Revived #11: rebased onto `main` and tested in the real app. It adds My Story Review, History/restore, photo and audio attachments, and the voice recorder. While testing it, these were fixed on the same branch:
- offline voice could never be installed (no UI called the setup API), so Record voice now offers setup;
- dictation replaced existing memory text, so it now adds to it;
- attachment delete had no confirmation, so it now asks first.

### 18. [x] Hybrid keyword + vector search for large archives
Large-document test (2026-10-01, see `docs/PRIVATE_AI.md`): 8 of 9 planted facts were found among ~6,000 chunks. One ranked #4, just outside the top 3, because its words ("family", "Bible", "records") also match much of the surrounding prose. Add SQLite FTS5 over chunk text and fuse keyword and vector ranks (for example reciprocal rank fusion), so exact names, numbers and phrases always surface. Consider 5 context chunks instead of 3.

**Done.** In-memory BM25 keyword ranking fused with vector ranking (reciprocal rank fusion) instead of SQLite FTS5: search already loads every section in scope, FTS5's default tokenizer cannot split Chinese or Japanese, and this needs no migration, sync triggers or backfill. The index is cached per scope. On the large-document set, 9 of 9 facts now rank in the top 3 (the family Bible fact moved from #4 to #1), keyword ranking takes 5–11 ms per question once built, and building takes about 1 s for 6,000 sections. Context stays at 3 chunks.

### 19. [ ] Faster indexing on low-end CPUs (decision needed)
Indexing is CPU-bound at about 2.5 sections/s on an i3 laptop (a 3.7k-section book takes about 22 min). The only large lever measured was a smaller embedding model (bge-small: 2.4x faster, 384-dim, somewhat lower retrieval quality). That would need an embedding index version bump (re-index everyone) and a new asset upload.

### 20. [x] Offline voice repair showed the full 149 MB as the download
Found while testing languages and voice (#60). A repair that needed only the 8 MB whisper.cpp engine said "Repair downloads about 149 MB", because the voice status reported no pending size. The downloader also checked for `llama-server.exe` to decide whether any engine archive was extracted, so an installed whisper.cpp engine always counted as missing (and was re-downloaded on every repair).

**Done.** The downloader recognises both engines (`llama-server.exe`, `Release/whisper-cli.exe`), and the voice status reports `pendingDownloadBytes`, passed to the screen as `downloadSizeBytes`.

### 21. [x] Remove the build-time npm advisory allowlist (re-check by 2026-11-03)
`GHSA-ch52-4w7c-c8xp` (`http-cache-semantics`, no fixed version) reaches us only through electron-builder 26's build-time Electron download (`app-builder-lib > @electron/get@3 > got > cacheable-request`). It is allowlisted in `config/audit-allowlist.json` until **2026-11-03**, after which CI fails again.

**Long-term fix:** electron-builder 27 uses `@electron/get@5`, which drops `got`; with `27.0.0-alpha.9` `npm audit` reports 0 vulnerabilities. Tried on 2026-10-03: the Windows installer builds and the app launches, once `build.publish` is set to `null` (27 crashes in `computeChannelNames` when no publish config is detected; we publish with our own script, so `null` is correct anyway). `scripts/verify-package.mjs` pins `26.15.3` and needs updating too. Decision (2026-10-03): stay on 26 until 27 is stable; revisit when the allowlist expires.

**Done (2026-10-09).** `http-cache-semantics` 4.3.0 (released 2026-10-04) fixes GHSA-ch52-4w7c-c8xp, so a lockfile-only `npm audit fix` cleared it and the allowlist is empty again. electron-builder stays on 26; the 27 notes above still apply when it goes stable.
