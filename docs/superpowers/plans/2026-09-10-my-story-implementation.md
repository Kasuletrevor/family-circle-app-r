# My Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the full private local My Story memory studio with guided capture, history, media, offline voice transcription, confirmed-memory indexing, legacy migration, and combined My Story + Vault private retrieval.

**Architecture:** My Story is owned by the restored local user and stays behind Electron main/preload boundaries. Canonical answers, immutable semantic versions, private media, Story embeddings, migration state, and optional voice assets live locally; the renderer receives only safe DTOs through a dedicated Story client. Existing Nomic/Granite processes are reused through a new `PrivateArchiveQueryService` that ranks Story and Vault chunks together without making Story a Vault document or shared Circle data.

**Tech Stack:** Electron 44, React 19, TypeScript 7, `node:sqlite`, Vitest 4, Testing Library, existing Nomic/Granite llama.cpp runtime, `whisper.cpp` v1.9.1 Windows x64 + multilingual Whisper base as an optional verified voice pack, GitHub Actions Windows NSIS packaging.

**Spec:** `docs/superpowers/specs/2026-09-10-my-story-design.md`

## Global Constraints

- Before Task 1 implementation, update `feature/my-story` from latest `main`. If PR #8 Family Tree has merged, preserve the real `/family-tree` route and replace only `/stories`.
- Prove the synchronized baseline with `npm ci`, `npm run check`, and `npm audit --audit-level=high`. Do not begin Story code from an unrelated failing baseline.
- My Story is private local data. No Story service imports/calls `LegacyCircleAuthAdapter`, Circle URLs, or cloud AI/STT.
- V1 has exactly 16 Story fields, six chapters, and languages `en`, `fr`, `es`, `pt`, `zh`, `ja`, `fil`; Whisper maps `fil -> tl`.
- Draft/unconfirmed answers never exist in `story_chunks`.
- First edit of confirmed text snapshots the old semantic Story and deletes stale chunks in the same SQLite transaction that writes the unconfirmed replacement.
- Nomic inference never runs inside a SQLite transaction. Indexing failure leaves no stale chunks.
- Story/Vault use `nomic-embed-text-v1.5.Q4_K_M`, index version `1`, the same `search_document:` prefix, 1000-character chunks with 150-character overlap, and the existing `search_query:` query prefix.
- Combined retrieval creates one query embedding and selects one shared top-5 across selected Story/Vault candidates.
- Story media limits: photo 25 MiB, audio 100 MiB, max eight selected files per add operation.
- Voice transcription accepts only 16 kHz mono PCM WAV bytes, max 25 MiB, one concurrent job, 120-second timeout.
- Optional voice pack v1 is Windows x64 only. Standard NSIS contains the voice manifest/license only, never runtime/model files.
- Public/renderer contracts never expose `localUserId`, absolute or stored paths, embedding blobs, model/runtime paths, ports, secrets, Circle IDs, or shared-service identities.
- Media/version handles are always re-resolved for the protected-session local user in main.
- Legacy database/media import is copy-safe and idempotent; original legacy DB/files are never modified.
- Every behavior change uses RED -> GREEN -> focused commit.

## Execution Preflight

- [ ] Fetch latest `main` and update `feature/my-story` while retaining this spec/plan.
- [ ] Inspect `src/renderer/app/App.tsx`; if Family Tree merged, confirm `/family-tree` remains real.
- [ ] Run:

```bash
npm ci
npm run check
npm audit --audit-level=high
```

Expected: existing verification and audit pass. If not, invoke `superpowers:systematic-debugging` before Task 1.

---

### Task 1: Fixed Story contract and canonical database schema

**Files:**
- Create: `src/shared/story.ts`
- Create: `src/shared/story.test.ts`
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`

**Interfaces:**
- `STORY_SCHEMA_VERSION = 1`
- `STORY_FIELDS`, `STORY_FIELD_KEYS`, `STORY_LANGUAGES`
- `StoryFieldKey`, `StoryLanguage`, `StoryIndexStatus`
- `requireStoryField(key)` and `normalizeStoryLanguage(value)`
- Canonical tables: `story_answers`, `story_versions`, `story_media_items`, `story_chunks`, `story_import_state`.

- [ ] **Step 1: Write failing contract/migration tests**

```ts
expect(STORY_FIELDS).toHaveLength(16)
expect(STORY_FIELDS.map((field) => field.key)).toEqual([
  'fullName', 'preferredName', 'roots', 'languages',
  'occupation', 'lifeStage', 'snapshot', 'childhood',
  'education', 'workLife', 'relationships', 'milestones',
  'traditions', 'values', 'carePreferences', 'futureMessage',
])
expect(STORY_LANGUAGES.map((item) => item.code)).toEqual(['en','fr','es','pt','zh','ja','fil'])
expect(normalizeStoryLanguage('fil-PH')).toMatchObject({ code: 'fil', whisperCode: 'tl' })
expect(() => normalizeStoryLanguage('lg')).toThrow('Unsupported Story language')
```

Migration tests assert exact columns/FKs/uniques and prove any pre-existing `my_stories`, `story_entries`, `story_history`, and `story_media` rows survive unchanged.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/shared/story.test.ts src/main/database/migrations.test.ts
```

Expected: FAIL because Story exports/tables are absent.

- [ ] **Step 3: Implement schema and migrations**

Add `ensureStoryAnswers`, `ensureStoryVersions`, `ensureStoryMediaItems`, `ensureStoryChunks`, and `ensureStoryImportState`; call them inside the existing `runMigrations()` transaction after `users` exists. `src/shared/story.ts` contains only renderer-safe fixed schema metadata/types.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/shared/story.test.ts src/main/database/migrations.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/story* src/main/database/migrations*
git commit -m "feat: add My Story schema"
```

---

### Task 2: Owned answers, semantic history, and atomic restore primitives

**Files:**
- Create: `src/main/story/storyModels.ts`
- Create: `src/main/story/StoryHistoryRepository.ts`
- Create: `src/main/story/StoryHistoryRepository.test.ts`
- Create: `src/main/story/StoryRepository.ts`
- Create: `src/main/story/StoryRepository.test.ts`

**Interfaces:**

```ts
class StoryHistoryRepository {
  createIfChanged(localUserId: number, snapshot: StorySemanticSnapshot): Promise<number | null>
  createIfChangedInOpenTransaction(localUserId: number, snapshot: StorySemanticSnapshot): number | null
  list(localUserId: number): Promise<StoryVersionInternal[]>
  getOwned(localUserId: number, versionId: number): Promise<StoryVersionInternal | null>
}

class StoryRepository {
  getStory(localUserId: number): Promise<StoryAnswerInternal[]>
  getAnswer(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal | null>
  saveDraft(localUserId: number, input: StoryDraftInput): Promise<StoryAnswerInternal>
  invalidateConfirmedAnswer(localUserId: number, input: StoryDraftInput): Promise<StoryAnswerInternal>
  markConfirmedPending(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryAnswerInternal>
  markIndexStatus(localUserId: number, fieldKey: StoryFieldKey, status: StoryIndexStatus): Promise<void>
  restoreSnapshot(localUserId: number, target: StorySemanticSnapshot): Promise<StoryAnswerInternal[]>
}
```

`StoryRepository` receives `StoryHistoryRepository` in its constructor. `invalidateConfirmedAnswer()` opens one `withTransaction()` transaction, builds the current semantic Story, calls `history.createIfChangedInOpenTransaction()` **before** updating the answer, writes the changed unconfirmed answer, deletes that answer's chunks, and sets `not_indexed`. `restoreSnapshot()` similarly snapshots current semantic state in the same transaction before replacing answers/deleting all current Story chunks/marking restored confirmed fields `pending`.

- [ ] **Step 1: Write RED repository tests**

Prove user isolation, fixed-field metadata derivation, ordinary draft upsert without history, confirmed-edit snapshot-before-overwrite, immediate chunk deletion, semantic dedupe, 30-version cap, foreign version ownership, and atomic restore rollback.

```ts
await repo.invalidateConfirmedAnswer(1, {
  fieldKey: 'childhood', answer: 'Changed', language: 'en',
})
expect((await history.list(1))[0].snapshot.answers.childhood.answer).toBe('Old confirmed text')
expect(db.prepare('SELECT COUNT(*) AS n FROM story_chunks').get()).toEqual({ n: 0 })
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryHistoryRepository.test.ts src/main/story/StoryRepository.test.ts
```

- [ ] **Step 3: Implement minimal repositories**

All writes include `local_user_id` predicates. Section/label/question come from `requireStoryField()`, never renderer input. `createIfChangedInOpenTransaction()` does not begin/commit its own transaction; standalone `createIfChanged()` wraps it with `withTransaction()`.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryHistoryRepository.test.ts src/main/story/StoryRepository.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story
git commit -m "feat: add private Story repositories"
```

---

### Task 3: Shared embedding contract and fail-closed Story indexing

**Files:**
- Create: `src/main/ai/embeddingContract.ts`
- Create: `src/main/ai/embeddingContract.test.ts`
- Modify: `src/main/vault/VaultIndexService.ts`
- Modify: `src/main/vault/VaultIndexService.test.ts`
- Create: `src/main/story/StoryChunkRepository.ts`
- Create: `src/main/story/StoryChunkRepository.test.ts`
- Create: `src/main/story/StoryIndexService.ts`
- Create: `src/main/story/StoryIndexService.test.ts`

**Interfaces:**

```ts
export const EMBEDDING_MODEL_ID = 'nomic-embed-text-v1.5.Q4_K_M'
export const EMBEDDING_INDEX_VERSION = 1
export const DOCUMENT_PREFIX = 'search_document: '
export const QUERY_PREFIX = 'search_query: '
```

`VaultIndexService` imports these exact constants; behavior remains unchanged.

```ts
StoryChunkRepository.replaceAnswerIndex(localUserId, answerId, chunks, model, version)
StoryChunkRepository.deleteForAnswer(localUserId, answerId)
StoryChunkRepository.listQueryChunks(localUserId)
StoryIndexService.indexField(localUserId, fieldKey)
StoryIndexService.indexPendingFields(localUserId)
```

`replaceAnswerIndex()` verifies answer ownership and performs delete+insert+`index_status='ready'` in one local transaction after embeddings are fully computed.

- [ ] **Step 1: Write RED tests**

Prove unconfirmed content cannot index, Story provenance is included, same chunk/prefix/model contract as Vault, unavailable AI leaves pending, embedding failure leaves no stale chunks and sets failed, and one pending-field failure does not stop another.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/ai/embeddingContract.test.ts src/main/story/StoryChunkRepository.test.ts src/main/story/StoryIndexService.test.ts src/main/vault/VaultIndexService.test.ts
```

- [ ] **Step 3: Implement**

Reuse existing `chunkDocument()` (1000/150) and `NomicClient.embedDocument()`. Never await Nomic inside a DB transaction.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/ai/embeddingContract.test.ts src/main/story/StoryChunkRepository.test.ts src/main/story/StoryIndexService.test.ts src/main/vault/VaultIndexService.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/embeddingContract* src/main/story src/main/vault/VaultIndexService*
git commit -m "feat: index confirmed Story memories"
```

---

### Task 4: Story lifecycle service

**Files:**
- Create: `src/main/story/StoryService.ts`
- Create: `src/main/story/StoryService.test.ts`

**Interfaces:**

```ts
get(): Promise<StoryPublicState>
saveDraft(input: { fieldKey: StoryFieldKey; answer: string; language: StoryLanguage }): Promise<StoryPublicState>
confirmField(input: { fieldKey: StoryFieldKey }): Promise<StoryPublicState>
retryIndexing(input: { fieldKey: StoryFieldKey }): Promise<StoryPublicState>
saveNow(): Promise<StoryPublicState>
getHistory(): Promise<StoryVersionSummary[]>
restoreVersion(input: { versionId: number }): Promise<StoryPublicState>
```

Every method begins with protected `session.restore()` and uses that local user ID only. `saveDraft()` inspects current owned answer: confirmed + semantic change -> `repository.invalidateConfirmedAnswer()`; otherwise normal `saveDraft()`. `confirmField()` commits `confirmed/pending` first, then attempts indexing outside the transaction. `restoreVersion()` resolves `(localUserId, versionId)`, delegates atomic snapshot/restore to `StoryRepository.restoreSnapshot()`, then reindexes restored confirmed fields outside the transaction.

- [ ] **Step 1: Write RED tests**

Cover no session, invalid key/language, draft save, confirmed-edit invalidation, confirm ready/unavailable/failure, retry, save-now dedupe, foreign version rejection, restore DB rollback, and post-restore index failure with restored text retained/no stale chunks.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryService.test.ts
```

- [ ] **Step 3: Implement with stable service error codes**

Do not surface SQLite/model stderr/path details. Private AI absence never prevents draft/history/media capture.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryService.test.ts src/main/story/StoryRepository.test.ts src/main/story/StoryIndexService.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story
git commit -m "feat: add My Story lifecycle service"
```

---

### Task 5: Private Story media

**Files:**
- Create: `src/main/story/StoryMediaStore.ts`
- Create: `src/main/story/StoryMediaStore.test.ts`
- Create: `src/main/story/StoryMediaRepository.ts`
- Create: `src/main/story/StoryMediaRepository.test.ts`
- Create: `src/main/story/StoryMediaService.ts`
- Create: `src/main/story/StoryMediaService.test.ts`

**Interfaces:**

```ts
StoryMediaStore.validateSelected(path, expectedType)
StoryMediaStore.copyIntoStory(localUserId, sourcePath, extension)
StoryMediaStore.resolveOwnedPath(localUserId, relativePath)
StoryMediaStore.deleteOwnedFile(localUserId, relativePath)
StoryMediaService.chooseAndAdd({ fieldKey, mediaType })
StoryMediaService.list()
StoryMediaService.open({ mediaId })
StoryMediaService.delete({ mediaId })
```

Main owns the picker. Storage root is `<userData>/story/users/<localUserId>/media/<UUID>.<ext>`; DB keeps only relative paths. Supported photo/audio types and limits exactly match the spec.

- [ ] **Step 1: Write RED tests**

Test signatures/container markers, extension mismatch, limits, eight-file cap, randomized paths, traversal, picker cancel, copy-before-row insert, failed-copy no active row, cross-user open/delete rejection, already-missing owned file cleanup.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryMediaStore.test.ts src/main/story/StoryMediaRepository.test.ts src/main/story/StoryMediaService.test.ts
```

- [ ] **Step 3: Implement using Vault-style ownership defenses**

Do not reuse Vault IDs/storage root. Normal attachments set `legacy_source_key=NULL`, `storage_status='active'` only after successful copy.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryMediaStore.test.ts src/main/story/StoryMediaRepository.test.ts src/main/story/StoryMediaService.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StoryMedia*
git commit -m "feat: add private Story media"
```

---

### Task 6: Copy-safe idempotent legacy importer

**Files:**
- Create: `src/main/story/StoryLegacyImporter.ts`
- Create: `src/main/story/StoryLegacyImporter.test.ts`
- Modify: `src/main/database/database.ts`
- Modify: `src/main/database/database.test.ts`

**Interfaces:** `StoryLegacyImporter.importForExistingUsers(): Promise<StoryImportReport>`.

Import source is the rebuild-owned copied DB only. Answer precedence: valid `my_stories.story_json` -> `story_entries`. Preserve explicit `__confirmed`; only when confirmation metadata is absent entirely, treat legacy non-empty answers as confirmed. Language precedence: `__languages[field]` -> `story_entries.language` -> `__language` -> `en`; unsupported legacy language -> `en`. Unknown fields remain only in legacy source tables.

Legacy media root is derived from `appDataPath`. Each eligible media row has a stable `legacy_source_key`; a reservation transaction creates/reuses one `copying` row with one randomized destination; restart copies to the same destination and marks active. Write `legacy-my-story-v1` only after all eligible reservations are active or classified skipped.

- [ ] **Step 1: Write RED tests with temp DB/files**

Cover intact/damaged JSON, fallback entries, confirmation/language preservation, unknown keys, history dedupe/cap, valid media, missing/out-of-root/oversized media, crash after reservation + resume, rerun idempotency, and hash/byte immutability of original DB/media.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryLegacyImporter.test.ts src/main/database/database.test.ts
```

- [ ] **Step 3: Integrate after copy + canonical migrations**

`prepareDatabase()` keeps copy-first semantics. Run importer against active `DatabaseSync`; never open original DB for write. Roots come from `DatabasePathInputs` only.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StoryLegacyImporter.test.ts src/main/database/database.test.ts src/main/database/migrations.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StoryLegacyImporter* src/main/database/database*
git commit -m "feat: migrate legacy My Story safely"
```

---

### Task 7: Verified optional Windows voice pack and local transcription

**Files:**
- Create: `src/main/voice/voiceModels.ts`
- Create: `src/main/voice/OfflineVoiceAssetService.ts`
- Create: `src/main/voice/OfflineVoiceAssetService.test.ts`
- Create: `src/main/voice/VoiceTranscriptionService.ts`
- Create: `src/main/voice/VoiceTranscriptionService.test.ts`
- Create: `config/offline-voice-manifest.json`
- Create: `third_party/whisper.cpp-LICENSE.txt`
- Modify: `package.json`
- Modify: `src/main/packaging/packagingContract.test.ts`
- Modify: `src/main/packaging/packageVerifier.test.ts`
- Modify: `src/main/packaging/windowsPackageWorkflow.test.ts`
- Modify: `.github/workflows/windows-package.yml`

**Pinned assets:**

```text
Runtime
URL: https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip
sizeBytes: 7982101
SHA256: 7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539
extract target: runtime/whisper-v1.9.1-win-x64
required executable: Release/whisper-cli.exe

Model
URL: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
sizeBytes: 147951465
SHA256: 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe
target: models/ggml-base.bin
```

`OfflineVoiceAssetService` uses the existing tested `OfflineAiDownloader` with a compatible two-file manifest, maps downloader errors to voice-safe messages, and stores marker/assets under `userData/offline-voice`. Voice public states match Private AI public states.

`VoiceTranscriptionService.transcribe({ wavBytes, language })` validates RIFF/WAVE PCM, <=25 MiB, supported language, busy guard, verified installed paths, fixed main-owned arguments, bounded threads, and 120-second timeout. No network port exists.

The Windows workflow `pull_request.paths` must include:

```text
config/offline-voice-manifest.json
third_party/whisper.cpp-LICENSE.txt
src/main/story/**
src/main/voice/**
src/renderer/features/story/**
src/renderer/services/story/**
src/shared/story.ts
```

Preserve its existing push/tag/base trigger policy exactly.

- [ ] **Step 1: Write RED tests**

Pin URL/size/hash values above; reject altered/zero hashes; corrupt/missing assets -> repair; package config includes manifest/license but no runtime/model. Voice tests cover WAV validation, seven languages, `fil -> tl`, busy guard, exact safe argv, timeout kill, temp cleanup success/failure/timeout, stderr suppression, no network fallback. `windowsPackageWorkflow.test.ts` must fail until the Story/voice PR path filters are present.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/voice/OfflineVoiceAssetService.test.ts src/main/voice/VoiceTranscriptionService.test.ts src/main/packaging/packagingContract.test.ts src/main/packaging/packageVerifier.test.ts src/main/packaging/windowsPackageWorkflow.test.ts
```

- [ ] **Step 3: Implement**

Do not refactor `OfflineAiDownloader` unless a failing test proves a generic seam is necessary; its existing resume/size/SHA/redirect/ZIP behavior is sufficient. Voice remains a distinct readiness service.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/voice/OfflineVoiceAssetService.test.ts src/main/voice/VoiceTranscriptionService.test.ts src/main/packaging/packagingContract.test.ts src/main/packaging/packageVerifier.test.ts src/main/packaging/windowsPackageWorkflow.test.ts
npm run verify:package -- --config-only
```

- [ ] **Step 5: Commit**

```bash
git add src/main/voice config/offline-voice-manifest.json third_party/whisper.cpp-LICENSE.txt package.json src/main/packaging .github/workflows/windows-package.yml
git commit -m "feat: add optional offline Story voice pack"
```

---

### Task 8: Safe Story IPC, preload, and dedicated renderer client

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

**Public Story surface:** `get`, `saveDraft`, `confirmField`, `retryIndexing`, `saveNow`, `getHistory`, `restoreVersion`, `chooseAndAddMedia`, `listMedia`, `openMedia`, `deleteMedia`, `transcribeRecording`, `getVoiceStatus`, `startVoiceSetup`, `pauseVoiceSetup`, `repairVoiceSetup`, `onVoiceSetupProgress`.

Inputs contain only field/answer/language, version ID, media ID/type, or WAV bytes. IPC reconstructs each field explicitly and sanitizes every returned DTO.

- [ ] **Step 1: Write RED boundary tests**

Inject `localUserId`, paths, model/runtime fields, Circle/shared IDs, arbitrary flags. Service spies must receive only approved fields. Fake internal outputs containing paths/embeddings must be stripped. Hard-check WAV byte size before service dispatch.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/storyIpc.test.ts src/preload/createDesktopApi.story.test.ts src/renderer/services/story/DesktopStoryClient.test.ts
```

- [ ] **Step 3: Implement narrow bridge/client**

Only `DesktopStoryClient` accesses `window.familyCircle.story` in production renderer code.

- [ ] **Step 4: Run GREEN plus preload regression**

```bash
npx vitest run src/main/story/storyIpc.test.ts src/preload/createDesktopApi.test.ts src/preload/createDesktopApi.story.test.ts src/renderer/services/story/DesktopStoryClient.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/desktopApi.ts src/main/story/storyIpc* src/preload src/renderer/services/story
git commit -m "feat: expose safe My Story desktop API"
```

---

### Task 9: Main composition and pending-index hooks

**Files:**
- Create: `src/main/story/createStoryServices.ts`
- Create: `src/main/story/createStoryServices.test.ts`
- Modify: `src/main/main.ts`

`createStoryServices()` composes Story repositories/lifecycle/media/index, voice assets/transcription from `DatabaseSync`, `SessionStore`, `userDataPath`, picker/opener, and shared AI runtime/Nomic/assets. Register `storyIpc` in main.

Private AI ready callback and startup ready check invoke both:

```ts
vaultIndexService.indexPendingDocuments(current.id)
storyIndexService.indexPendingFields(current.id)
```

- [ ] **Step 1: Write RED composition tests**

Assert Story IPC registration, pending Story retry after AI-ready/startup, shared Nomic/runtime, and no Circle adapter in Story dependencies.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/createStoryServices.test.ts
```

- [ ] **Step 3: Implement composition**

Keep Story-only construction outside `main.ts`.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/createStoryServices.test.ts src/main/ai/privateAiIpc.test.ts src/main/vault/vaultIpc.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story/createStoryServices* src/main/main.ts
git commit -m "feat: wire My Story services"
```

---

### Task 10: Guided and Chapters studio

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

`/stories` renders `MyStory`; remove only Stories placeholder. Preserve synchronized `/family-tree`. Guided is default. Progress = confirmed/16 and chapter confirmed/total. Draft save debounce = 600 ms. First edit of confirmed field calls `saveDraft` immediately once, then later edits debounce. Guided has prompt/hint/language/followups/status/Previous/Confirm/Next; Chapters groups all six sections with identical edit semantics.

- [ ] **Step 1: Write RED UI tests**

Assert real route, 16/six schema, Guided default, confirmed-only progress, chapter jumps, deterministic followups, 600 ms debounce, immediate confirmed edit, confirm/retry status, seven languages, safe generic errors.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/app/App.test.tsx
```

- [ ] **Step 3: Implement**

Required text:

```text
Draft — review your words before making this memory searchable.
Confirmed — available to your private local AI.
Saving…
Saved privately on this computer
Not saved yet — retry
```

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/app/App.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/story src/renderer/app/App.tsx src/renderer/app/App.test.tsx src/renderer/app/Sidebar.tsx
git commit -m "feat: add guided My Story studio"
```

---

### Task 11: Review, History, media, and recorder UX

**Files:**
- Create: `src/renderer/features/story/ReviewStoryView.tsx`
- Create: `src/renderer/features/story/HistoryStoryView.tsx`
- Create: `src/renderer/features/story/StoryMedia.tsx`
- Create: `src/renderer/features/story/StoryVoiceRecorder.ts`
- Create: `src/renderer/features/story/StoryVoiceRecorder.test.ts`
- Modify: `src/renderer/features/story/MyStory.tsx`
- Modify: `src/renderer/features/story/MyStory.test.tsx`
- Modify: `src/renderer/features/story/MyStory.css`

Review shows exact populated text by chapter, local filter, Edit -> Guided. History newest-first; restore requires confirmation; main owns pre-restore snapshot. `StoryVoiceRecorder` requests microphone and emits 16 kHz mono PCM WAV `Uint8Array`, always releasing tracks/context. Transcript inserts as draft only. Media controls use IDs through StoryClient only.

- [ ] **Step 1: Write RED tests**

Cover four mode selected states, Review text/filter/Edit, restore confirm/cancel/focus return, media controls, microphone denial, record/transcribing/success/error, transcript remains draft, recorder cleanup.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/features/story/StoryVoiceRecorder.test.ts
```

- [ ] **Step 3: Implement**

Use the synchronized app's accessible confirmation-dialog pattern. If Family Tree has merged, reuse its proven dialog/focus conventions rather than create a second behavior.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/features/story/StoryVoiceRecorder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/story
git commit -m "feat: complete My Story memory studio"
```

---

### Task 12: One ranking pipeline for Story + Vault

**Files:**
- Create: `src/main/ai/PrivateArchiveQueryService.ts`
- Create: `src/main/ai/PrivateArchiveQueryService.test.ts`
- Modify: `src/main/vault/VaultQueryService.ts`
- Modify: `src/main/vault/VaultQueryService.test.ts`
- Modify: `src/main/vault/VaultChunkRepository.ts`
- Modify: `src/main/vault/VaultChunkRepository.test.ts`
- Modify: `src/main/story/StoryChunkRepository.ts`
- Modify: `src/main/story/StoryChunkRepository.test.ts`

```ts
type PrivateArchiveScope =
  | { type: 'story' }
  | { type: 'vault-all' }
  | { type: 'vault-documents'; documentIds: number[] }
  | { type: 'all-private' }

type PrivateArchiveAnswerSource =
  | { type: 'story'; fieldKey: StoryFieldKey; chapter: string; label: string; excerpt: string }
  | { type: 'vault'; documentId: number; fileName: string; excerpt: string }
```

`PrivateArchiveQueryService.ask()` restores session, validates Vault scope, calls `embedQuery()` exactly once, loads selected owned candidates, scores one combined list with existing `cosineSimilarity`, slices one top-5, starts Granite only if context exists, generates once, returns safe union citations. `VaultQueryService` becomes a Vault-only compatibility delegate so ranking logic is not duplicated.

- [ ] **Step 1: Write RED tests**

Story-only/Vault-all/selected-Vault/all-private; foreign document rejection; one query embedding; no query-time re-embedding; mixed score order; shared top-5 not 5+5; safe Story/Vault citations; no-context; generation failure.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/VaultQueryService.test.ts
```

- [ ] **Step 3: Implement normalized internal candidate union**

Never expose embedding/path/local-user data.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/VaultQueryService.test.ts src/main/story/StoryChunkRepository.test.ts src/main/vault/VaultChunkRepository.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/PrivateArchiveQueryService* src/main/vault/VaultQueryService* src/main/vault/VaultChunkRepository* src/main/story/StoryChunkRepository*
git commit -m "feat: search Story and Vault together"
```

---

### Task 13: `/ai` Story / Vault / combined scopes

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

Keep existing `vault.ask` public entry point to minimize preload churn; change typed input to `PrivateArchiveScope` and result to `PrivateArchiveAnswer`. Source choices: My Story, Vault documents, My Story + Vault. Vault mode retains all vs selected documents. Story citation: `My Story › <Chapter> › <Memory>`.

- [ ] **Step 1: Write RED tests**

Exact IPC reconstruction for all four scopes, malicious identity/path stripping, Story works with zero Vault docs, combined payload, safe citations, keyboard submit, source-aware privacy/error copy.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/vault/vaultIpc.ask.test.ts src/preload/createDesktopApi.askVault.test.ts src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/AskVault.test.tsx
```

- [ ] **Step 3: Wire generalized query service and UI**

One runtime manager, Nomic client, Granite client; no Story model process.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/vaultIpc.ask.test.ts src/preload/createDesktopApi.askVault.test.ts src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/AskVault.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/desktopApi.ts src/main/main.ts src/main/vault/vaultIpc* src/preload/createDesktopApi* src/renderer/services/vault src/renderer/features/vault/AskVault*
git commit -m "feat: ask My Story and Vault privately"
```

---

### Task 14: Merge-blocking Story security and architecture boundaries

**Files:**
- Create: `src/main/story/StorySecurity.test.ts`
- Modify: `scripts/verify-boundaries.mjs`

**Required invariants:**

1. Cross-user answer read/save/confirm denied.
2. Cross-user version list/restore denied.
3. Cross-user media open/delete denied.
4. Renderer identity/path/model/runtime injection stripped.
5. Absolute legacy/current paths never cross preload.
6. Draft/unconfirmed answers have no chunks.
7. First confirmed edit snapshots old state/removes stale chunks immediately.
8. Embedding failure leaves no old searchable chunks.
9. Restore leaves no newer stale chunks.
10. Foreign/stale media/version IDs fail before mutation.
11. Media traversal/out-of-root resolution fails.
12. Import reads only known legacy Story root.
13. Import restart is idempotent; originals unchanged.
14. Story never imports/calls Circle adapter/transport.
15. Voice accepts no executable/model/flag/path from renderer.
16. Voice has no cloud/network fallback.
17. Temp WAV cleanup on success/failure/timeout.
18. Attachments are never silently transcribed/OCR'd/indexed.
19. Public errors contain no paths, stderr, ports, embeddings, secrets.
20. Only `DesktopStoryClient` accesses `window.familyCircle.story` in production renderer code.

- [ ] **Step 1: Write StorySecurity RED coverage and extend scanner expectations**

Add source-scan assertions inside `StorySecurity.test.ts` for `scripts/verify-boundaries.mjs`-equivalent invariants; do not create a second standalone boundary scanner. At least the production boundary command must fail until Story rules are added.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StorySecurity.test.ts
npm run verify:boundaries
```

- [ ] **Step 3: Fix only proven gaps**

Add Story rules to `scripts/verify-boundaries.mjs`: direct Story preload access outside `DesktopStoryClient`, Story imports of Circle transport, private Story internals in renderer/shared public files.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StorySecurity.test.ts
npm run verify:boundaries
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StorySecurity.test.ts scripts/verify-boundaries.mjs src/main src/preload src/renderer src/shared
git commit -m "test: enforce My Story privacy boundaries"
```

---

### Task 15: Accessibility, documentation, exact-head verification, and review

**Files:**
- Create: `src/renderer/features/story/MyStory.accessibility.test.tsx`
- Modify: Story renderer files only for proven accessibility failures.
- Modify: `README.md`
- Modify: `docs/PRIVATE_AI.md`
- Modify: `docs/WINDOWS_RELEASE.md`

**Accessibility acceptance:** four view controls expose selected state; draft/confirmed/index state textual; chapter progress accessible names; deterministic Previous/Next focus; Confirm explains searchability; recorder live status; media accessible names include filename/type; restore labelled/Escape-closeable/focus-returning; errors use alert/status semantics; no core hover-only action.

- [ ] **Step 1: Write accessibility RED tests**

Use Testing Library role/name/state queries across Guided, Chapters, Review, History, confirmation, media, restore, recorder.

- [ ] **Step 2: Run focused RED/GREEN**

```bash
npx vitest run src/renderer/features/story/MyStory.accessibility.test.tsx src/renderer/features/story/MyStory.test.tsx
```

- [ ] **Step 3: Update docs truthfully**

README: real private My Story studio. `PRIVATE_AI.md`: confirmed Story indexing/pending retry/shared top-5. `WINDOWS_RELEASE.md`: installer includes manifest/license only; verified optional voice pack separate; seven-language v1; no cloud fallback.

- [ ] **Step 4: Run clean complete local gate**

```bash
rm -rf node_modules
npm ci
npm run check
npm audit --audit-level=high
```

- [ ] **Step 5: Review full diff**

Invoke `superpowers:requesting-code-review`. Review `main...feature/my-story` for ownership predicates, original-source immutability, media traversal, stale chunks, restore invalidation, shared top-5, voice command injection, network fallback, IPC stripping, path/ID/embedding leakage, Family Tree route preservation, and Windows exclusions. Every merge-blocking finding gets RED -> GREEN evidence.

- [ ] **Step 6: Open/update PR and require exact-head CI**

Require exact feature head:

```text
Linux: npm run check + npm audit --audit-level=high
Windows: Verify application + NSIS build + package verifier + exactly-one-installer + artifact upload
```

- [ ] **Step 7: Record immutable evidence and stop at merge boundary**

Record feature SHA, test file/test totals, StorySecurity count, accessibility count, audit, Linux run/job IDs, Windows run/job IDs, installer artifact ID/digest. Never merge without explicit user instruction.

- [ ] **Step 8: Commit docs/accessibility slice**

```bash
git add src/renderer/features/story README.md docs/PRIVATE_AI.md docs/WINDOWS_RELEASE.md
git commit -m "docs: finish My Story release slice"
```

If review fixes create later commits, the later exact head is the final verification target.
