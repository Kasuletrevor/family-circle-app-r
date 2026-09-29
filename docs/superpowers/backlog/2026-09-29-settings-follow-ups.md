# Settings follow-ups (2026-09-29)

Issues found while reviewing the Settings release (#49) and shipping Remove Private AI (#50) and Open data folder (#51). Ordered by priority within each group. Each entry is independent and can be picked up as its own slice.

Status key: `[ ]` open · `[x]` done

---

## Product gaps

### 1. [ ] Restore from local backup

**Problem.** Settings can create a local backup (`SettingsService.createBackup`), but there is no way to restore one. The rebuild spec lists "local backup/restore" as a local application-layer responsibility (`docs/superpowers/specs/2026-09-02-family-circle-rebuild-design.md:51`). A backup that cannot be restored only protects users who restore it by hand.

**Evidence.** `desktop.settings` exposes only `createBackup` and `openDataFolder` (`src/shared/desktopApi.ts`). Backups are written as a folder containing `family.db`, `vault/`, `story/` and `backup.json` (manifest `formatVersion: 1`).

**Suggested direction.**
- Needs a design/spec first: restore replaces live data, so it needs a confirmation step, a pre-restore safety snapshot, and an app restart or re-open of the database.
- Validate `backup.json` (format version, `includes`) before touching live data.
- Run under the shared `MutationLock` so Vault/Story/indexing cannot write mid-restore.
- Decide how the single-account boundary (see #4) applies to restore.

---

### 2. [ ] Circle settings: rename and delete Circle

**Problem.** The legacy app's Settings tab let owners **rename** and **delete** a Circle, and let members **leave**. The rebuild has Leave Circle (`src/renderer/features/circles/CircleManagement.tsx:124`), but no rename or delete anywhere. The members/invitations spec says "Circle settings next" (`docs/superpowers/specs/2026-09-04-circle-members-invitations-design.md:405`).

**Evidence.** No `renameCircle` / `deleteCircle` in `src/shared/desktopApi.ts` `circle` namespace. Legacy reference: `kin-keepers-family-circle-app-upload-performance/public/index.html` (`#tabSettings`: Rename Circle, Leave Circle, Delete Circle for owners, with a confirmation step).

**Suggested direction.**
- Check which endpoints Jose's shared API offers for rename/delete (and whether they need `/v2` identity-bound versions).
- Owner-only rename; owner-only delete with a confirmation step that requires typing the Circle name, matching the legacy UX.
- Place in Circle management (per-Circle) rather than device Settings.

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

### 9. [ ] Windows Package does not run on PRs that touch packaging-critical code

**Problem.** On `pull_request`, `.github/workflows/windows-package.yml` runs only for a hand-picked path list. That list omits `src/main/main.ts`, `src/preload/**`, `src/shared/desktopApi.ts`, `src/main/ai/**`, `src/main/settings/**`, `src/main/vault/**` and most of `src/renderer/features/**`. On `push` to `main` it runs for all of `src/**`. #50 and #51 therefore had their first packaged build only after merging.

**Suggested direction.** Add at least `src/main/**`, `src/preload/**` and `src/shared/**` to the `pull_request` paths, or align the PR filter with the push filter.

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
