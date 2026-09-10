# My Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the full private local My Story memory studio with guided capture, history, media, offline voice transcription, confirmed-memory indexing, legacy migration, and combined My Story + Vault private retrieval.

**Architecture:** My Story is a local-user-owned subsystem behind Electron main/preload boundaries. Canonical answers, semantic versions, private media, Story embeddings, and migration state live in local SQLite/filesystem storage; the renderer sees only safe DTOs through a dedicated Story client. Existing Nomic/Granite runtimes are reused through a new `PrivateArchiveQueryService` that ranks Vault and Story chunks together without coupling Story ownership to Vault document IDs.

**Tech Stack:** Electron 44, React 19, TypeScript 7, `node:sqlite`, Vitest 4, Testing Library, existing Nomic/Granite llama.cpp runtime, optional verified `whisper.cpp` Windows x64 voice pack, GitHub Actions Windows NSIS packaging.

**Spec:** `docs/superpowers/specs/2026-09-10-my-story-design.md`

## Global Constraints

- Before Task 1 implementation, update `feature/my-story` from the latest `main`; if PR #8 Family Tree has merged, preserve the real `/family-tree` route and replace only `/stories`.
- Run `npm ci`, `npm run check`, and `npm audit --audit-level=high` on the synchronized baseline before adding Story code. Do not continue from a baseline with unrelated failures.
- The current design branch started from `main` at `9f8d7fefa1f2336654c727683e20285daf0319d9`; do not assume that old dependency state is audit-clean.
- My Story is private local data. No Story service calls `LegacyCircleAuthAdapter` or any Circle URL.
- The fixed first-release schema has exactly 16 Story fields across six chapters and exactly seven language codes: `en`, `fr`, `es`, `pt`, `zh`, `ja`, `fil`; Whisper maps `fil -> tl`.
- Draft/unconfirmed answers must never be present in `story_chunks`.
- Editing a confirmed answer must snapshot the old semantic Story before overwriting it and must delete stale chunks immediately before normal debounced saves continue.
- Nomic inference is never held inside a SQLite transaction. Indexing failures fail closed with no stale chunks.
- Story and Vault use the same `nomic-embed-text-v1.5.Q4_K_M`, index version, `search_document:` prefix, 1000-character chunks, 150-character overlap, and `search_query:` query prefix so combined cosine scores are comparable.
- Combined retrieval uses one query embedding and one shared top-5 across selected Story/Vault sources.
- Story media limits: photos 25 MiB, audio 100 MiB, maximum eight selected files per add operation.
- Voice transcription input is 16 kHz mono PCM WAV, maximum 25 MiB, with a 120-second timeout and one-transcription busy guard.
- Voice v1 ships only as an optional verified Windows x64 pack; runtime/model files are never bundled into the standard NSIS installer and there is no cloud/ElevenLabs fallback.
- Renderer/public contracts never expose `localUserId`, absolute/stored filesystem paths, embedding blobs, model/runtime paths, local ports, API keys, Circle IDs, or shared-service identities.
- Every renderer-supplied media/version/field handle is revalidated and re-resolved for the authenticated local user in main.
- Legacy DB/media migration is copy-safe and idempotent; the original legacy database and original media files are never mutated.
- Every behavior-changing task follows RED -> GREEN -> focused regression -> commit.

---

## Execution preflight — synchronize and prove a clean baseline

This is a gate, not a feature task.

- [ ] Fetch the latest `main` and update `feature/my-story` without discarding the committed spec/plan.
- [ ] If Family Tree has merged, inspect `src/renderer/app/App.tsx` and confirm `/family-tree` is still a real route after synchronization.
- [ ] Run:

```bash
npm ci
npm run check
npm audit --audit-level=high
```

Expected: all existing tests/build/boundaries pass and audit reports zero high-severity blockers. If the synchronized baseline fails, use `superpowers:systematic-debugging` before Task 1.

---

### Task 1: Fixed Story schema and canonical database tables

**Files:**
- Create: `src/shared/story.ts`
- Create: `src/shared/story.test.ts`
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`

**Interfaces:**
- Produces `STORY_SCHEMA_VERSION = 1`.
- Produces `STORY_FIELDS`, `STORY_FIELD_KEYS`, `STORY_LANGUAGES`, `StoryFieldKey`, `StoryLanguage`, `StoryIndexStatus`, and `normalizeStoryLanguage(value)`.
- Creates canonical tables `story_answers`, `story_versions`, `story_media_items`, `story_chunks`, and `story_import_state` exactly as the spec defines.
- Legacy `my_stories`, `story_entries`, `story_history`, and `story_media` are preserved if present.

- [ ] **Step 1: Write failing schema contract tests**

In `src/shared/story.test.ts`, assert exact field order/count, exact chapter names, life-stage options, exact language set, and `fil -> tl` mapping. Example:

```ts
expect(STORY_FIELDS).toHaveLength(16)
expect(STORY_FIELDS.map((field) => field.key)).toEqual([
  'fullName', 'preferredName', 'roots', 'languages',
  'occupation', 'lifeStage', 'snapshot', 'childhood',
  'education', 'workLife', 'relationships', 'milestones',
  'traditions', 'values', 'carePreferences', 'futureMessage',
])
expect(STORY_LANGUAGES.map((item) => item.code)).toEqual(['en', 'fr', 'es', 'pt', 'zh', 'ja', 'fil'])
expect(normalizeStoryLanguage('fil-PH')).toMatchObject({ code: 'fil', whisperCode: 'tl' })
expect(() => normalizeStoryLanguage('lg')).toThrow('Unsupported Story language')
```

In `migrations.test.ts`, assert all five canonical tables, their columns, FKs, unique constraints, and preservation of pre-existing legacy Story tables/rows.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/shared/story.test.ts src/main/database/migrations.test.ts
```

Expected: FAIL because Story schema exports/tables do not exist.

- [ ] **Step 3: Implement the schema and additive migrations**

`src/shared/story.ts` owns renderer-safe schema metadata only. `migrations.ts` adds focused helpers such as:

```ts
function ensureStoryAnswers(db: DatabaseSync): void { /* CREATE TABLE/INDEX */ }
function ensureStoryVersions(db: DatabaseSync): void { /* CREATE TABLE/INDEX */ }
function ensureStoryMediaItems(db: DatabaseSync): void { /* CREATE TABLE/INDEX */ }
function ensureStoryChunks(db: DatabaseSync): void { /* CREATE TABLE/INDEX */ }
function ensureStoryImportState(db: DatabaseSync): void { /* CREATE TABLE */ }
```

Call them inside the existing migration transaction after `users` exists.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/shared/story.test.ts src/main/database/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/story.ts src/shared/story.test.ts src/main/database/migrations.ts src/main/database/migrations.test.ts
git commit -m "feat: add My Story schema"
```

---

### Task 2: Owned answers and semantic version repositories

**Files:**
- Create: `src/main/story/storyModels.ts`
- Create: `src/main/story/StoryRepository.ts`
- Create: `src/main/story/StoryRepository.test.ts`
- Create: `src/main/story/StoryHistoryRepository.ts`
- Create: `src/main/story/StoryHistoryRepository.test.ts`

**Interfaces:**
- `StoryRepository.getStory(localUserId): Promise<StoryAnswerInternal[]>`
- `StoryRepository.getAnswer(localUserId, fieldKey): Promise<StoryAnswerInternal | null>`
- `StoryRepository.saveDraft(localUserId, input): Promise<StoryAnswerInternal>`
- `StoryRepository.invalidateConfirmedAnswer(localUserId, input, snapshotOldStory): Promise<StoryAnswerInternal>` where the transaction snapshots before overwrite and deletes chunks.
- `StoryRepository.markConfirmedPending(localUserId, fieldKey): Promise<StoryAnswerInternal>` deletes old chunks before setting `pending`.
- `StoryRepository.markIndexStatus(localUserId, fieldKey, status): Promise<void>`.
- `StoryHistoryRepository.createIfChanged(localUserId, snapshot): Promise<number | null>`.
- `StoryHistoryRepository.list(localUserId): Promise<StoryVersionInternal[]>` newest first, max 30.
- `StoryHistoryRepository.getOwned(localUserId, versionId): Promise<StoryVersionInternal | null>`.
- Semantic signatures exclude indexing/UI state but include answer text, language, and confirmation.

- [ ] **Step 1: Write repository RED tests**

Cover user isolation, field-key validation, draft upsert, first-edit transaction ordering, previous confirmed snapshot preservation, no history for ordinary autosave, semantic dedupe, and 30-version cap.

```ts
await repo.saveDraft(1, { fieldKey: 'childhood', answer: 'Draft', language: 'en' })
expect(await repo.getStory(2)).toEqual([])

await repo.invalidateConfirmedAnswer(1, {
  fieldKey: 'childhood', answer: 'Changed', language: 'en',
}, oldSnapshot)
expect(db.prepare('SELECT COUNT(*) AS n FROM story_chunks').get()).toEqual({ n: 0 })
expect((await history.list(1))[0].snapshot.answers.childhood.answer).toBe('Old confirmed text')
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryRepository.test.ts src/main/story/StoryHistoryRepository.test.ts
```

Expected: FAIL with missing modules/classes.

- [ ] **Step 3: Implement minimal repositories**

Use prepared SQL and the existing `withTransaction()` helper. All mutation predicates include `local_user_id`. Do not accept arbitrary section/label/question from callers; derive metadata from `STORY_FIELDS` by `fieldKey`.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryRepository.test.ts src/main/story/StoryHistoryRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/story
git commit -m "feat: add private Story repositories"
```

---

### Task 3: Story chunk repository and fail-closed indexing

**Files:**
- Create: `src/main/story/StoryChunkRepository.ts`
- Create: `src/main/story/StoryChunkRepository.test.ts`
- Create: `src/main/story/StoryIndexService.ts`
- Create: `src/main/story/StoryIndexService.test.ts`
- Modify: `src/main/vault/VaultIndexService.ts`
- Modify: `src/main/vault/VaultIndexService.test.ts`

**Interfaces:**
- Export shared constants from a neutral location or retain one authoritative import path: `INDEX_VERSION = 1`, `EMBEDDING_MODEL_ID = 'nomic-embed-text-v1.5.Q4_K_M'`.
- `StoryChunkRepository.replaceAnswerIndex(localUserId, answerId, chunks, embeddingModel, indexVersion): Promise<void>` validates ownership through `story_answers`.
- `StoryChunkRepository.deleteForAnswer(localUserId, answerId): Promise<void>`.
- `StoryChunkRepository.listQueryChunks(localUserId): Promise<StoryQueryChunk[]>` returns only chunks belonging to confirmed current answers.
- `StoryIndexService.indexField(localUserId, fieldKey): Promise<void>`.
- `StoryIndexService.indexPendingFields(localUserId): Promise<void>`.
- Story provenance is prepended before calling existing deterministic `chunkDocument()`.

- [ ] **Step 1: Write indexing RED tests**

Prove unconfirmed answers cannot index; current confirmed text receives provenance; old chunks are atomically replaced; embedding failure leaves no old chunks and status `failed`; unavailable AI leaves `pending`; one field failure does not prevent other pending fields from retrying.

```ts
await expect(service.indexField(7, 'childhood')).rejects.toMatchObject({ code: 'not-confirmed' })
expect(nomic.embedDocument).not.toHaveBeenCalled()

expect(nomic.embedDocument).toHaveBeenCalledWith(expect.stringContaining('[[MY STORY | childhood | Life Story'))
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryChunkRepository.test.ts src/main/story/StoryIndexService.test.ts src/main/vault/VaultIndexService.test.ts
```

Expected: FAIL because Story indexing modules do not exist.

- [ ] **Step 3: Implement Story indexing and centralize shared embedding constants**

Reuse `chunkDocument()` and `NomicClient.embedDocument()`; do not reimplement chunking. Never keep a DB transaction open while awaiting embeddings. `replaceAnswerIndex()` performs delete+insert+ready-status update in one local transaction only after all embeddings are available.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryChunkRepository.test.ts src/main/story/StoryIndexService.test.ts src/main/vault/VaultIndexService.test.ts
```

Expected: PASS, including unchanged Vault indexing behavior.

- [ ] **Step 5: Commit**

```bash
git add src/main/story src/main/vault/VaultIndexService.ts src/main/vault/VaultIndexService.test.ts
git commit -m "feat: index confirmed Story memories"
```

---

### Task 4: Story service — drafts, confirmation, history, restore, retry

**Files:**
- Create: `src/main/story/StoryService.ts`
- Create: `src/main/story/StoryService.test.ts`

**Interfaces:**
- Dependencies: protected `session.restore()`, `StoryRepository`, `StoryHistoryRepository`, `StoryIndexService`.
- `get(): Promise<StoryPublicState>` derives current local user.
- `saveDraft({ fieldKey, answer, language }): Promise<StoryPublicState>`.
- `invalidateAndSaveDraft(...)` is the same public save path; main detects whether stored content was confirmed and chooses immediate invalidation semantics.
- `confirmField({ fieldKey }): Promise<StoryPublicState>`.
- `retryIndexing({ fieldKey }): Promise<StoryPublicState>`.
- `saveNow(): Promise<StoryPublicState>` persists current semantic version only if distinct.
- `getHistory(): Promise<StoryVersionSummary[]>`.
- `restoreVersion({ versionId }): Promise<StoryPublicState>` snapshots current state first, replaces canonical answers transactionally, deletes all chunks, marks restored confirmed fields pending, then attempts reindex outside transaction.

- [ ] **Step 1: Write service RED tests**

Cover authentication required, field/language validation, draft save, confirmed-edit snapshot+invalidation, confirm with AI ready/unavailable/failure, retry, save-now semantic dedupe, foreign version rejection, restore failure rollback, and restore with post-commit index failure.

```ts
session.restore.mockResolvedValue(null)
await expect(service.get()).rejects.toMatchObject({ code: 'authentication-required' })

await service.saveDraft({ fieldKey: 'childhood', answer: 'Changed', language: 'en' })
expect(history.createIfChanged).toHaveBeenCalledBefore(repository.invalidateConfirmedAnswer)
expect(index.indexField).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryService.test.ts
```

Expected: FAIL because `StoryService` is absent.

- [ ] **Step 3: Implement minimal orchestration**

Map internal errors to stable Story service error codes. Confirmation remains successful even when Private AI is unavailable; return `indexStatus: 'pending'`. An actual available-runtime embedding failure returns saved Story state with `indexStatus: 'failed'`, not loss of confirmed data.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryService.test.ts src/main/story/StoryRepository.test.ts src/main/story/StoryIndexService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/story
git commit -m "feat: add My Story lifecycle service"
```

---

### Task 5: Private Story media store and owned media operations

**Files:**
- Create: `src/main/story/StoryMediaStore.ts`
- Create: `src/main/story/StoryMediaStore.test.ts`
- Create: `src/main/story/StoryMediaRepository.ts`
- Create: `src/main/story/StoryMediaRepository.test.ts`
- Create: `src/main/story/StoryMediaService.ts`
- Create: `src/main/story/StoryMediaService.test.ts`

**Interfaces:**
- `StoryMediaStore.validateSelected(path, expectedType): Promise<ValidatedStoryMedia>` validates extension, regular file, signature/container marker, and 25/100 MiB limit.
- `copyIntoStory(localUserId, sourcePath, extension): Promise<string>` returns relative randomized path under `story/users/<id>/media/`.
- `resolveOwnedPath(localUserId, storedRelativePath): string` rejects traversal/out-of-root paths.
- `StoryMediaService.chooseAndAdd({ fieldKey, mediaType }): Promise<StoryMediaSummary[]>` owns the native picker through an injected picker port and caps selection at eight.
- `list(): Promise<StoryMediaSummary[]>`, `open({ mediaId })`, `delete({ mediaId })` always derive session user and re-resolve ownership.

- [ ] **Step 1: Write media RED tests**

Cover valid/invalid signatures, extension mismatch, limits, randomized destinations, traversal, user isolation, picker cancel, eight-file cap, copy-before-row insertion, failed copy leaves no active row, safe open/delete, missing owned file cleanup.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryMediaStore.test.ts src/main/story/StoryMediaRepository.test.ts src/main/story/StoryMediaService.test.ts
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement media units**

Follow `VaultFileStore` ownership conventions but keep a separate `story/` root and Story media type rules. Normal new media rows use `legacy_source_key = NULL` and `storage_status = 'active'` only after copy success.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryMediaStore.test.ts src/main/story/StoryMediaRepository.test.ts src/main/story/StoryMediaService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StoryMedia*
git commit -m "feat: add private Story media"
```

---

### Task 6: Copy-safe idempotent legacy My Story importer

**Files:**
- Create: `src/main/story/StoryLegacyImporter.ts`
- Create: `src/main/story/StoryLegacyImporter.test.ts`
- Modify: `src/main/database/database.ts`
- Modify: `src/main/database/database.test.ts`

**Interfaces:**
- `StoryLegacyImporter.importForExistingUsers(): Promise<StoryImportReport>` runs only against the rebuild-owned database after copy.
- It detects legacy tables dynamically with `sqlite_master`/`PRAGMA table_info`.
- Answer precedence: valid `my_stories.story_json`; fallback `story_entries`; import fixed keys only.
- Confirmation precedence: explicit `__confirmed`; otherwise non-empty legacy answers are confirmed only when explicit confirmation metadata is absent entirely.
- Language precedence: `__languages[field]` -> matching `story_entries.language` -> `__language` -> `en`, normalized to supported v1 set; unsupported legacy values fall back to `en` rather than being forwarded to Whisper.
- Legacy history is semantically deduped/capped at 30.
- Legacy media uses a stable opaque `legacy_source_key` and `copying -> active` reservation retry to the same randomized destination.
- The known legacy Story media root is derived from `appDataPath`; importer rejects paths outside it.

- [ ] **Step 1: Write migration RED tests with real temporary files/DBs**

Test intact JSON import, damaged JSON fallback, explicit confirmation preservation, old-story confirmation fallback, languages, unknown keys, history dedupe/cap, valid media copy, out-of-root rejection, missing media diagnostics, crash after reservation then resume, second complete run creates no duplicates, and byte-for-byte immutability of original legacy DB/media.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryLegacyImporter.test.ts src/main/database/database.test.ts
```

Expected: FAIL because importer integration does not exist.

- [ ] **Step 3: Implement importer and startup hook**

`prepareDatabase()` keeps its current copy-first behavior. After `runMigrations(db)`, construct/run the importer only against the active DB and only with roots derived from the existing `DatabasePathInputs`; never open the original DB for writes. Keep importer internals injectable for crash tests.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryLegacyImporter.test.ts src/main/database/database.test.ts src/main/database/migrations.test.ts
```

Expected: PASS and original-source hashes unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StoryLegacyImporter* src/main/database/database.ts src/main/database/database.test.ts
git commit -m "feat: migrate legacy My Story data safely"
```

---

### Task 7: Optional verified Windows voice pack and local Whisper service

**Files:**
- Create: `src/main/voice/voiceModels.ts`
- Create: `src/main/voice/OfflineVoiceAssetService.ts`
- Create: `src/main/voice/OfflineVoiceAssetService.test.ts`
- Create: `src/main/voice/VoiceTranscriptionService.ts`
- Create: `src/main/voice/VoiceTranscriptionService.test.ts`
- Create: `config/offline-voice-manifest.json`
- Modify: `package.json`
- Modify: `scripts/verify-package.mjs`
- Modify: `scripts/verify-package.test.ts` if present; otherwise extend the existing package-verifier test file used by the synchronized branch.

**Interfaces:**
- Voice public states mirror Private AI naming: `not_installed | downloading | paused | verifying | ready | repair_required | failed`.
- `OfflineVoiceAssetService.getStatus/startSetup/pauseSetup/repair/getInstalledPaths` uses resumable verified download primitives and a separate `userData/offline-voice` root.
- Manifest packages exactly a Windows x64 `whisper.cpp` CLI runtime and Whisper base model with immutable URL, size, and SHA-256 values. Before GREEN, obtain those values from the same approved release/model sources used by the reference product; tests must pin the committed values and reject zero/placeholder hashes.
- `VoiceTranscriptionService.transcribe({ wavBytes, language }): Promise<{ text: string; engine: 'whisper-base' }>` validates RIFF/WAVE PCM input, <=25 MiB, supported language, busy guard, verified installed paths, bounded thread count, and 120s timeout.
- No HTTP/network port exists on `VoiceTranscriptionService`.

- [ ] **Step 1: Write voice asset/runtime RED tests**

Assert manifest validation, corrupt/missing assets -> repair, no model in package file list, command construction uses only verified paths and `-l <validated whisperCode>`, `fil -> tl`, busy rejection, timeout kill, temp-file cleanup on success/error/timeout, stderr suppression, and no network fallback dependency.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/voice/OfflineVoiceAssetService.test.ts src/main/voice/VoiceTranscriptionService.test.ts
```

Expected: FAIL because voice modules/manifest are absent.

- [ ] **Step 3: Implement asset and transcription services**

Share only generic download/hash helpers where that reduces duplication; do not merge voice readiness into `OfflineAiAssetService`. Temp WAVs live under OS temp with unguessable names and are removed in `finally`.

- [ ] **Step 4: Run GREEN and package contract tests**

```bash
npx vitest run src/main/voice/OfflineVoiceAssetService.test.ts src/main/voice/VoiceTranscriptionService.test.ts
npm run verify:package -- --config-only
```

Expected: PASS; config includes only `config/offline-voice-manifest.json`, never voice binaries/models.

- [ ] **Step 5: Commit**

```bash
git add src/main/voice config/offline-voice-manifest.json package.json scripts/verify-package.mjs
git add scripts/*Package*test* scripts/*package*test* 2>/dev/null || true
git commit -m "feat: add optional offline Story voice pack"
```

---

### Task 8: Safe Story IPC, preload contract, and renderer client

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Create: `src/main/story/storyIpc.ts`
- Create: `src/main/story/storyIpc.test.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Create: `src/preload/createDesktopApi.story.test.ts`
- Create: `src/renderer/services/story/StoryClient.ts`
- Create: `src/renderer/services/story/DesktopStoryClient.ts`
- Create: `src/renderer/services/story/DesktopStoryClient.test.ts`

**Interfaces:**

Safe public methods:

```ts
story.get()
story.saveDraft({ fieldKey, answer, language })
story.confirmField({ fieldKey })
story.retryIndexing({ fieldKey })
story.saveNow()
story.getHistory()
story.restoreVersion({ versionId })
story.chooseAndAddMedia({ fieldKey, mediaType })
story.listMedia()
story.openMedia({ mediaId })
story.deleteMedia({ mediaId })
story.transcribeRecording({ wavBytes, language })
story.getVoiceStatus()
story.startVoiceSetup()
story.pauseVoiceSetup()
story.repairVoiceSetup()
story.onVoiceSetupProgress(listener)
```

`storyIpc.ts` reconstructs every input field-by-field and returns sanitized DTOs only. `wavBytes` is an owned byte payload with a hard size check before service dispatch; no path is accepted.

- [ ] **Step 1: Write bridge RED tests**

Inject malicious extra fields (`localUserId`, `storedRelativePath`, `modelPath`, `circleId`, `serverUserId`) and assert service spies receive only approved fields. Assert public DTOs strip any internal path/embedding fields even if a malicious fake service returns them.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/storyIpc.test.ts src/preload/createDesktopApi.story.test.ts src/renderer/services/story/DesktopStoryClient.test.ts
```

Expected: FAIL because Story API is absent.

- [ ] **Step 3: Implement the narrow contract**

Follow current Vault/Private AI channel naming and sanitization patterns. Only `DesktopStoryClient` accesses `window.familyCircle.story`; React components depend on `StoryClient`.

- [ ] **Step 4: Run GREEN plus approved-surface regression**

```bash
npx vitest run src/main/story/storyIpc.test.ts src/preload/createDesktopApi.test.ts src/preload/createDesktopApi.story.test.ts src/renderer/services/story/DesktopStoryClient.test.ts
```

Expected: PASS and no unrelated preload capability appears.

- [ ] **Step 5: Commit**

```bash
git add src/shared/desktopApi.ts src/main/story/storyIpc* src/preload src/renderer/services/story
git commit -m "feat: expose safe My Story desktop API"
```

---

### Task 9: Main-process service composition and pending-index/setup hooks

**Files:**
- Modify: `src/main/main.ts`
- Create: `src/main/story/storyComposition.test.ts`

**Interfaces:**
- Compose one `StoryRepository`, `StoryHistoryRepository`, `StoryChunkRepository`, `StoryIndexService`, `StoryMediaStore`, `StoryMediaRepository`, `StoryMediaService`, `StoryService`, `OfflineVoiceAssetService`, and `VoiceTranscriptionService` per app process.
- Register `storyIpc` alongside auth/circle/vault/private AI.
- Private AI ready callback retries both `vaultIndexService.indexPendingDocuments(current.id)` and `storyIndexService.indexPendingFields(current.id)`.
- Startup ready-state check does the same for signed-in user.
- Main native media picker filters photo/audio based on requested media type; opener uses `shell.openPath()` only after owned-path resolution.

- [ ] **Step 1: Write composition RED test**

Extract or inject composition boundaries enough to assert Story IPC registration and both pending-index callbacks occur without importing renderer code. Assert no Story dependency receives `LegacyCircleAuthAdapter`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/storyComposition.test.ts
```

Expected: FAIL because Story services are not wired.

- [ ] **Step 3: Wire main services**

Keep `main.ts` readable by moving Story-only object construction into `src/main/story/createStoryServices.ts` if direct composition would make `main.ts` materially larger; if created, add a focused `createStoryServices.test.ts` and keep `AppServices` typed.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/storyComposition.test.ts src/main/ai/privateAiIpc.test.ts src/main/vault/vaultIpc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/main/story
git commit -m "feat: wire My Story services"
```

---

### Task 10: My Story studio — Guided and Chapters views

**Files:**
- Create: `src/renderer/features/story/MyStory.tsx`
- Create: `src/renderer/features/story/MyStory.css`
- Create: `src/renderer/features/story/MyStory.test.tsx`
- Create: `src/renderer/features/story/GuidedStoryView.tsx`
- Create: `src/renderer/features/story/ChaptersStoryView.tsx`
- Create: `src/renderer/features/story/storyViewModels.ts`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/app/App.test.tsx`
- Modify: `src/renderer/app/Sidebar.tsx`

**Interfaces:**
- `/stories` renders `<MyStory />`; remove only the Stories placeholder entry.
- Preserve `/family-tree` exactly as it exists on synchronized `main`.
- `MyStory` defaults to Guided and merges persisted answers over `STORY_FIELDS`.
- Progress = confirmed fields / 16; each chapter exposes confirmed/total.
- Draft typing uses a debounced save (target 600 ms); first edit of a confirmed field calls `saveDraft` immediately once to invalidate old searchability, then later edits debounce.
- Guided view provides Previous/Next, deterministic follow-up chips, language selector, save state, confirmation/index status, and `Confirm memory`/`Retry private indexing`.
- Chapters renders all six grouped sections with identical edit semantics.

- [ ] **Step 1: Write UI RED tests**

Test real route, 16 prompts/six chapters, default Guided, confirmed-only progress, chapter navigation, deterministic follow-up chips, debounce behavior, immediate first confirmed edit, confirm action, pending/failed/ready copy, language set, and safe generic service errors.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/app/App.test.tsx
```

Expected: FAIL because `/stories` still renders placeholder.

- [ ] **Step 3: Implement Guided/Chapters UI**

Required status text includes:

```text
Draft — review your words before making this memory searchable.
Confirmed — available to your private local AI.
Saving…
Saved privately on this computer
Not saved yet — retry
```

Do not render raw service error messages.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/story src/renderer/app/App.tsx src/renderer/app/App.test.tsx src/renderer/app/Sidebar.tsx
git commit -m "feat: add guided My Story studio"
```

---

### Task 11: Review, History, media, and recorder UI

**Files:**
- Create: `src/renderer/features/story/ReviewStoryView.tsx`
- Create: `src/renderer/features/story/HistoryStoryView.tsx`
- Create: `src/renderer/features/story/StoryMedia.tsx`
- Create: `src/renderer/features/story/StoryVoiceRecorder.ts`
- Create: `src/renderer/features/story/StoryVoiceRecorder.test.ts`
- Modify: `src/renderer/features/story/MyStory.tsx`
- Modify: `src/renderer/features/story/MyStory.test.tsx`
- Modify: `src/renderer/features/story/MyStory.css`

**Interfaces:**
- Review shows exact populated user text grouped by chapter; it never uses Granite to rewrite prose.
- Review search/filter is renderer-local; Edit jumps to Guided at the correct field.
- History lists newest-first version summaries and requires an explicit confirmation dialog before restore.
- Before restore, main owns the pre-restore snapshot guarantee; UI does not attempt to synthesize history.
- `StoryVoiceRecorder` requests microphone, outputs 16 kHz mono PCM WAV `Uint8Array`, and guarantees track/context cleanup.
- Transcription result is inserted as a draft and not auto-confirmed.
- Story media controls call safe Story client methods and use media IDs only.

- [ ] **Step 1: Write RED tests**

Test mode selection state, Review exact text/filter/Edit, History restore confirmation/cancel/focus return, media add/open/delete accessible names, microphone denial, record/stop/transcribing/success/error states, transcript-as-draft, and cleanup on recorder error.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/features/story/StoryVoiceRecorder.test.ts
```

Expected: FAIL because Review/History/media/voice UI is incomplete.

- [ ] **Step 3: Implement the remaining studio**

Use a native accessible dialog pattern already present in the synchronized app if available; otherwise implement a focused modal with `role="dialog"`, labelled title, initial focus on Cancel for destructive restore, Escape close, and focus return.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/features/story/StoryVoiceRecorder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/story
git commit -m "feat: complete My Story memory studio"
```

---

### Task 12: Generalized private archive retrieval across Story and Vault

**Files:**
- Create: `src/main/ai/PrivateArchiveQueryService.ts`
- Create: `src/main/ai/PrivateArchiveQueryService.test.ts`
- Modify: `src/main/vault/VaultQueryService.ts`
- Modify: `src/main/vault/VaultQueryService.test.ts`
- Modify: `src/main/vault/VaultChunkRepository.ts`
- Modify: `src/main/vault/VaultChunkRepository.test.ts`
- Modify: `src/main/story/StoryChunkRepository.ts`
- Modify: `src/main/story/StoryChunkRepository.test.ts`

**Interfaces:**

New safe scope:

```ts
type PrivateArchiveScope =
  | { type: 'story' }
  | { type: 'vault-all' }
  | { type: 'vault-documents'; documentIds: number[] }
  | { type: 'all-private' }
```

Public source union:

```ts
type PrivateArchiveAnswerSource =
  | { type: 'story'; fieldKey: StoryFieldKey; chapter: string; label: string; excerpt: string }
  | { type: 'vault'; documentId: number; fileName: string; excerpt: string }
```

`PrivateArchiveQueryService.ask({ question, scope })` restores session, validates owned Vault document scopes when relevant, obtains exactly one query embedding, loads only selected owned Story/Vault chunks, computes cosine scores together, takes one shared top-5, ensures Granite runtime only when context exists, generates once, and returns safe typed citations.

`VaultQueryService` may remain as a compatibility wrapper delegating Vault-only scopes during the transition; do not duplicate ranking implementations.

- [ ] **Step 1: Write retrieval RED tests**

Prove Story-only/Vault-only/all-private selection, foreign document rejection, one `embedQuery()` call, no document/Story query-time re-embedding, shared top-5 rather than 5+5, mixed-score ordering, confirmed Story ownership, source citations, no-context answer, and safe generation failure.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/VaultQueryService.test.ts
```

Expected: FAIL because generalized service does not exist.

- [ ] **Step 3: Implement one ranking pipeline**

Normalize repository rows into an internal candidate union only inside main. Reuse existing `cosineSimilarity()` and excerpt normalization. No renderer-visible source contains embedding/path/local-user information.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/VaultQueryService.test.ts src/main/story/StoryChunkRepository.test.ts src/main/vault/VaultChunkRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/PrivateArchiveQueryService* src/main/vault src/main/story/StoryChunkRepository*
git commit -m "feat: search Story and Vault together"
```

---

### Task 13: Safe private-archive IPC and `/ai` source selector

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/main/vault/vaultIpc.ts`
- Modify: `src/main/vault/vaultIpc.ask.test.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.askVault.test.ts`
- Modify: `src/renderer/services/vault/VaultClient.ts`
- Modify: `src/renderer/services/vault/DesktopVaultClient.ts`
- Modify: `src/renderer/services/vault/DesktopVaultClient.test.ts`
- Modify: `src/renderer/features/vault/AskVault.tsx`
- Modify: `src/renderer/features/vault/AskVault.test.tsx`
- Modify: `src/renderer/features/vault/AskVault.css`
- Modify: `src/main/main.ts`

**Interfaces:**
- Evolve `vault.ask` to accept `PrivateArchiveScope` and return `PrivateArchiveAnswer`, or rename the public capability to `privateArchive.ask` only if doing so can be completed atomically in this task. Prefer minimum public-surface churn: keep the existing `/ai` client entry point and extend its typed scope.
- UI source choices: **My Story**, **Vault documents**, **My Story + Vault**. Vault mode retains all-indexed vs selected-document control.
- Story source labels render `My Story › <Chapter> › <Memory label>`.

- [ ] **Step 1: Write RED tests**

Test exact IPC reconstruction for all four scope variants, malicious IDs/extra identity stripping, My Story availability even with zero Vault documents, combined ask payload, safe Story/Vault citations, keyboard submit, and error copy that says private archive rather than Vault-only when appropriate.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/vault/vaultIpc.ask.test.ts src/preload/createDesktopApi.askVault.test.ts src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/AskVault.test.tsx
```

Expected: FAIL on new Story/all-private scope expectations.

- [ ] **Step 3: Wire generalized query service and update `/ai`**

Keep one `NomicClient`, one `GraniteClient`, and one runtime manager. Do not introduce Story-specific local ports or a second model process.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/vaultIpc.ask.test.ts src/preload/createDesktopApi.askVault.test.ts src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/AskVault.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/desktopApi.ts src/main/main.ts src/main/vault/vaultIpc* src/preload src/renderer/services/vault src/renderer/features/vault/AskVault*
git commit -m "feat: ask My Story and Vault privately"
```

---

### Task 14: Merge-blocking Story security and architecture boundaries

**Files:**
- Create: `src/main/story/StorySecurity.test.ts`
- Modify: `scripts/verify-boundaries.mjs`
- Modify: the existing boundary-verifier test file if the synchronized branch contains one; otherwise create `scripts/verify-boundaries.test.ts`.
- Modify focused tests from earlier tasks only when a security gap is discovered.

**Interfaces / invariants under test:**

1. User A cannot read/save/confirm User B answers.
2. User A cannot list/restore User B versions.
3. User A cannot open/delete User B media.
4. Renderer cannot inject local ownership or filesystem/model/runtime paths.
5. Absolute legacy/current paths never cross preload.
6. Draft/unconfirmed answers never exist in `story_chunks`.
7. First confirmed edit snapshots old state and removes stale chunks immediately.
8. Failed embedding leaves no old searchable chunks.
9. Restore cannot leave newer chunks searchable.
10. Foreign/stale media and version IDs fail before mutation.
11. Media traversal and out-of-root resolution fail.
12. Legacy importer opens media only under known legacy root.
13. Import is restart-idempotent and original DB/files remain unchanged.
14. Story code never calls/imports `LegacyCircleAuthAdapter` or direct Circle transport.
15. Voice cannot accept executable/model/flag/path input.
16. Voice has no network fallback.
17. Temp voice files are removed on success/failure/timeout.
18. Attached audio/photos are never silently transcribed/OCR'd/indexed.
19. Public errors contain no sensitive internal path/process/port/secret information.
20. Only dedicated Story renderer client may access `window.familyCircle.story`.

- [ ] **Step 1: Write the complete security RED suite and boundary rules**

Where an invariant already passes, keep it as regression evidence. At least one new boundary assertion should fail until `verify-boundaries.mjs` knows the Story isolation rules.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StorySecurity.test.ts
npm run verify:boundaries
```

Expected: Story runtime tests expose any remaining gaps; boundary verifier initially fails until new private-Story import/surface constraints are registered.

- [ ] **Step 3: Fix only proven gaps**

Extend boundary scanning to reject direct `window.familyCircle.story` use outside `DesktopStoryClient`, Story imports of Circle adapter/transport, and private Story internal types/paths in renderer/shared public code.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StorySecurity.test.ts
npm run verify:boundaries
```

Expected: all invariants PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StorySecurity.test.ts scripts/verify-boundaries.mjs scripts/verify-boundaries.test.ts 2>/dev/null || true
git add src/main src/preload src/renderer src/shared
git commit -m "test: enforce My Story privacy boundaries"
```

---

### Task 15: Accessibility, documentation, exact-head verification, and review

**Files:**
- Create: `src/renderer/features/story/MyStory.accessibility.test.tsx`
- Modify: `README.md`
- Modify: `docs/PRIVATE_AI.md`
- Modify: `docs/WINDOWS_RELEASE.md`
- Modify: Story/UI files only for failures proven by accessibility tests.

**Interfaces / acceptance:**
- Four view controls expose selected state (`aria-pressed`, tabs, or equivalent semantically correct pattern).
- Draft/confirmed/index status is textual.
- Chapter progress has accessible names.
- Previous/Next focus behavior is deterministic.
- Confirm memory communicates searchability effect.
- Recording/transcription uses live status semantics.
- Media controls include filename/type in accessible names.
- Restore dialog is labelled, keyboard-operable, Escape-closeable, and returns focus.
- README describes real My Story and no longer lists Stories as absent.
- `PRIVATE_AI.md` describes Story indexing, confirmation gate, shared top-5 retrieval, and pending retry after setup.
- `WINDOWS_RELEASE.md` states the standard installer includes only the voice manifest, never whisper runtime/model, and documents clean-machine optional voice setup verification.

- [ ] **Step 1: Write accessibility RED tests**

Use Testing Library role/name/state queries rather than CSS selectors. Exercise Guided, Chapters, Review, History, media controls, confirmation state, restore dialog, and recorder live state.

- [ ] **Step 2: Run focused RED/GREEN loop**

```bash
npx vitest run src/renderer/features/story/MyStory.accessibility.test.tsx src/renderer/features/story/MyStory.test.tsx
```

Fix only failures demonstrated by those tests, then rerun until PASS.

- [ ] **Step 3: Update documentation truthfully**

Document storage/security boundaries, legacy migration, optional voice pack, seven-language v1 contract, confirmed-only indexing, and `/ai` Story/Vault/all-private scopes. Do not claim cloud sync, Story sharing, custom prompts, OCR, or bundled voice assets.

- [ ] **Step 4: Run the complete local gate from a clean install**

```bash
rm -rf node_modules
npm ci
npm run check
npm audit --audit-level=high
```

Expected: all type checks/tests/boundaries/builds pass; audit has no high-severity failure.

- [ ] **Step 5: Review the complete feature diff**

Inspect `main...feature/my-story` especially for:

```text
Story ownership predicates
legacy source immutability
media path traversal
stale chunk removal
restore index invalidation
one-query/shared-top-5 retrieval
voice command/path injection
cloud/network fallback
public IPC field stripping
absolute path / local ID / embedding leakage
Family Tree route preservation
Windows package exclusions
```

Use `superpowers:requesting-code-review` for the review workflow. Resolve every merge-blocking finding with RED -> GREEN regression evidence.

- [ ] **Step 6: Open/update the PR and require exact-head CI**

PR body must state the feature head SHA and summarize Story storage, migration, voice, indexing, privacy invariants, and intentionally deferred scope. Require both:

```text
Linux: npm run check + npm audit --audit-level=high
Windows: full Verify application + NSIS build + package verifier + exactly-one-installer assertion + artifact upload
```

Do not cite an older commit's CI after review fixes move the head.

- [ ] **Step 7: Record final evidence and stop at merge boundary**

Record exact feature-head SHA, test file/test totals, Story security-suite total, accessibility total, audit result, Linux workflow/job IDs, Windows workflow/job IDs, and installer artifact ID/digest if exposed by CI.

Do not merge without the user's explicit merge instruction.

- [ ] **Step 8: Commit docs/accessibility changes**

```bash
git add src/renderer/features/story/MyStory.accessibility.test.tsx src/renderer/features/story README.md docs/PRIVATE_AI.md docs/WINDOWS_RELEASE.md
git commit -m "docs: finish My Story release slice"
```

If Step 5 review fixes create later commits, the later exact head—not this documentation commit—is the final verification target.
