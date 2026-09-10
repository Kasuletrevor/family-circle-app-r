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

`VaultIndexService` imports those constants; behavior remains unchanged.

```ts
StoryChunkRepository.replaceAnswerIndex(localUserId, answerId, chunks, model, version)
StoryChunkRepository.deleteForAnswer(localUserId, answerId)
StoryChunkRepository.listQueryChunks(localUserId)
StoryIndexService.indexField(localUserId, fieldKey)
StoryIndexService.indexPendingFields(localUserId)
```

`replaceAnswerIndex()` verifies answer ownership and performs delete+insert+`index_status='ready'` in one local transaction after embeddings are fully computed.

- [ ] **Step 1: Write RED tests**

Prove unconfirmed content cannot index, Story provenance is included, the same chunk/prefix/model contract is used as Vault, unavailable AI leaves pending, old chunks are never retained after failure, actual embedding failure sets failed, and one pending-field failure does not stop another.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/ai/embeddingContract.test.ts src/main/story/StoryChunkRepository.test.ts src/main/story/StoryIndexService.test.ts src/main/vault/VaultIndexService.test.ts
```

- [ ] **Step 3: Implement**

Reuse existing `chunkDocument()` (1000/150) and `NomicClient.embedDocument()`. Do not await Nomic inside a DB transaction.

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

Every method begins with protected `session.restore()` and uses that local user ID only. `saveDraft()` inspects current owned answer: confirmed + semantic change -> `repository.invalidateConfirmedAnswer()`; otherwise normal `saveDraft()`. `confirmField()` commits `confirmed/pending` first, then attempts indexing outside the transaction. `restoreVersion()` resolves `(localUserId, versionId)`, delegates the atomic snapshot/restore to `StoryRepository.restoreSnapshot()`, then reindexes restored confirmed fields outside the DB transaction.

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

Test signatures/container markers, extension mismatch, limits, eight-file cap, randomized paths, traversal, picker cancel, copy-before-row insert, failed-copy no active row, cross-user open/delete rejection, and already-missing owned file cleanup.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryMediaStore.test.ts src/main/story/StoryMediaRepository.test.ts src/main/story/StoryMediaService.test.ts
```

- [ ] **Step 3: Implement using Vault-style ownership defenses**

Do not reuse Vault document IDs/storage root. Normal attachments set `legacy_source_key=NULL`, `storage_status='active'` only after successful copy.

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

**Interfaces:**

```ts
StoryLegacyImporter.importForExistingUsers(): Promise<StoryImportReport>
```

Import source is the rebuild-owned copied database only. Answer precedence: valid `my_stories.story_json` -> `story_entries` fallback. Confirmation: preserve explicit `__confirmed`; only when confirmation metadata is entirely absent, treat legacy non-empty answers as confirmed. Language: `__languages[field]` -> `story_entries.language` -> `__language` -> `en`; unsupported legacy language falls back to `en`. Unknown fields stay only in untouched legacy tables.

Legacy media root is derived from `appDataPath`. Each eligible row gets stable `legacy_source_key`; reservation transaction creates/reuses one `copying` row with one randomized destination; restart copies to that same destination and marks active. `legacy-my-story-v1` is written only after eligible reservations are active or classified skipped.

- [ ] **Step 1: Write RED tests using temp DB/files**

Cover intact/damaged JSON, fallback entries, confirmation/language preservation, unknown keys, history semantic dedupe/cap, valid media, missing/out-of-root/oversized media, crash after reservation + resume, rerun idempotency, and byte/hash immutability of original legacy DB/media.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StoryLegacyImporter.test.ts src/main/database/database.test.ts
```

- [ ] **Step 3: Integrate after copy + canonical migrations**

`prepareDatabase()` retains copy-first semantics. Run importer against the active `DatabaseSync`; never open the original DB for write. Roots come from `DatabasePathInputs`, never renderer input.

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
- Modify: `src/main/packaging/packageVerifierContract.test.ts`
- Modify: `src/main/packaging/packageVerifier.test.ts`
- Modify: `.github/workflows/windows-package.yml` only to add the manifest/license to path filters if required; do not change its existing trigger policy.

**Pinned upstream assets:**

```text
Runtime:
URL: https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip
sizeBytes: 7982101
SHA256: 7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539
extract target: runtime/whisper-v1.9.1-win-x64
required executable: Release/whisper-cli.exe

Model:
URL: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
sizeBytes: 147951465
SHA256: 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe
target: models/ggml-base.bin
```

The checksum/size are the content identity even though Hugging Face's friendly download URL resolves through its current storage layer.

**Interfaces:** Voice states match Private AI public states. `OfflineVoiceAssetService` uses the existing tested `OfflineAiDownloader` with a compatible two-file manifest but maps generic download failures to voice-safe messages and uses separate `userData/offline-voice` marker/root. It verifies `whisper-cli.exe` after extraction and the model hash/size.

```ts
VoiceTranscriptionService.transcribe({ wavBytes, language }): Promise<{ text: string; engine: 'whisper-base' }>
```

Validate RIFF/WAVE PCM, <=25 MiB, supported language, busy guard, installed verified paths, bounded threads, 120s timeout. Spawn arguments are fixed by main. Temp WAV always deletes in `finally`.

- [ ] **Step 1: Write RED tests**

Pin both manifest entries above; reject zero/changed hash/size; prove corrupt/missing assets -> repair; `package.json` includes only manifest/license, not runtime/model. Runtime tests cover WAV validation, all language mappings, `fil -> tl`, busy guard, exact safe argv, timeout kill, temp cleanup success/failure/timeout, stderr suppression, and absence of any network/cloud port.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/voice/OfflineVoiceAssetService.test.ts src/main/voice/VoiceTranscriptionService.test.ts src/main/packaging/packageVerifierContract.test.ts src/main/packaging/packageVerifier.test.ts
```

- [ ] **Step 3: Implement**

Do not generalize/refactor `OfflineAiDownloader` unless a failing test demonstrates a required generic seam; it already provides resume, size, SHA, redirects, and ZIP extraction. Voice remains a distinct readiness service.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/voice/OfflineVoiceAssetService.test.ts src/main/voice/VoiceTranscriptionService.test.ts src/main/packaging/packageVerifierContract.test.ts src/main/packaging/packageVerifier.test.ts
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

**Public surface:**

```text
story.get
story.saveDraft
story.confirmField
story.retryIndexing
story.saveNow
story.getHistory
story.restoreVersion
story.chooseAndAddMedia
story.listMedia
story.openMedia
story.deleteMedia
story.transcribeRecording
story.getVoiceStatus
story.startVoiceSetup
story.pauseVoiceSetup
story.repairVoiceSetup
story.onVoiceSetupProgress
```

Inputs contain only field key/answer/language, version ID, media ID/type, or WAV bytes. IPC reconstructs fields one-by-one. Public answer/media/version/voice DTOs are explicitly sanitized.

- [ ] **Step 1: Write RED boundary tests**

Inject `localUserId`, `storedRelativePath`, `modelPath`, `circleId`, `serverUserId`, arbitrary executable flags and assert service spies never receive them. Fake internal service outputs containing paths/embeddings must be stripped. WAV must be an owned byte payload and hard-size checked before dispatch.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/storyIpc.test.ts src/preload/createDesktopApi.story.test.ts src/renderer/services/story/DesktopStoryClient.test.ts
```

- [ ] **Step 3: Implement narrow bridge/client**

Only `DesktopStoryClient` may access `window.familyCircle.story` in production renderer code.

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

### Task 9: Main composition and pending-index setup hooks

**Files:**
- Create: `src/main/story/createStoryServices.ts`
- Create: `src/main/story/createStoryServices.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:** `createStoryServices()` composes Story repositories/service/media, `StoryIndexService`, `OfflineVoiceAssetService`, and `VoiceTranscriptionService` from `DatabaseSync`, `SessionStore`, `userDataPath`, picker/opener, shared AI runtime/Nomic/assets. `main.ts` registers `storyIpc`.

Private AI `ready` callback and startup ready check invoke both:

```ts
vaultIndexService.indexPendingDocuments(current.id)
storyIndexService.indexPendingFields(current.id)
```

Native media picker filters by requested Story media type; opener is `shell.openPath` after `StoryMediaService` resolves ownership.

- [ ] **Step 1: Write RED composition tests**

Assert Story registration, pending Story retry after AI-ready/startup, one shared Nomic/runtime instance, and no Circle adapter in Story dependencies.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/createStoryServices.test.ts
```

- [ ] **Step 3: Implement composition**

Keep Story construction out of `main.ts` to preserve readable process bootstrap.

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

### Task 10: My Story Guided and Chapters studio

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

**Interfaces/behavior:** `/stories` renders `MyStory`; remove only Stories from placeholder routing. Default Guided view. Renderer merges persisted rows onto fixed schema. Progress is confirmed/16 and chapter confirmed/total. Draft saves debounce at 600 ms; first edit of a confirmed field invokes `saveDraft` immediately once so main invalidates chunks, later edits debounce. Guided has prompt/hint/language/followups/media slots/status/Previous/Confirm/Next; Chapters groups all six sections with identical edit semantics.

- [ ] **Step 1: Write RED UI tests**

Assert real route, 16 fields/six chapters, Guided default, confirmed-only progress, chapter jump, deterministic follow-up chips, 600 ms debounce, immediate confirmed edit, confirm/retry status, exact seven languages, and safe generic errors.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/app/App.test.tsx
```

- [ ] **Step 3: Implement**

Required text includes:

```text
Draft — review your words before making this memory searchable.
Confirmed — available to your private local AI.
Saving…
Saved privately on this computer
Not saved yet — retry
```

Do not render raw main errors.

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

### Task 11: Review, History, attachments, and recorder UX

**Files:**
- Create: `src/renderer/features/story/ReviewStoryView.tsx`
- Create: `src/renderer/features/story/HistoryStoryView.tsx`
- Create: `src/renderer/features/story/StoryMedia.tsx`
- Create: `src/renderer/features/story/StoryVoiceRecorder.ts`
- Create: `src/renderer/features/story/StoryVoiceRecorder.test.ts`
- Modify: `src/renderer/features/story/MyStory.tsx`
- Modify: `src/renderer/features/story/MyStory.test.tsx`
- Modify: `src/renderer/features/story/MyStory.css`

**Interfaces/behavior:** Review shows exact populated text by chapter, renderer-local filter, Edit -> Guided field. History is newest first and restore requires confirmation; main owns pre-restore snapshot. `StoryVoiceRecorder` requests microphone and emits 16 kHz mono PCM WAV `Uint8Array`, always releasing media tracks/audio context. Transcription output is inserted as draft only. Media controls use IDs through `StoryClient` only.

- [ ] **Step 1: Write RED tests**

Cover four mode states, Review text/filter/Edit, restore confirmation/cancel/focus return, media accessible controls, microphone denial, recording/transcribing/success/error states, transcript remains draft, and recorder cleanup.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/renderer/features/story/MyStory.test.tsx src/renderer/features/story/StoryVoiceRecorder.test.ts
```

- [ ] **Step 3: Implement**

Use existing accessible dialog component/pattern after baseline sync if present. Otherwise use labelled `role="dialog"`, Escape close, Cancel initial focus for restore, and focus return.

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

### Task 12: One private archive ranking pipeline for Story + Vault

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

`PrivateArchiveQueryService.ask()` restores session, validates selected Vault IDs when relevant, calls `embedQuery()` exactly once, loads only selected owned candidates, scores all with existing `cosineSimilarity`, sorts one list, slices one top-5, starts Granite only if context exists, generates once, and returns safe union citations. `VaultQueryService` becomes a thin Vault-only compatibility delegate during migration so ranking logic exists in one place.

- [ ] **Step 1: Write RED tests**

Story-only, Vault-only, selected-Vault, all-private; foreign document rejection; exactly one query embedding; no query-time Story/document re-embedding; mixed score ordering; shared top-5 not 5+5; current confirmed Story ownership; safe citations; no-context; generation failure.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/VaultQueryService.test.ts
```

- [ ] **Step 3: Implement normalized internal candidate union**

No candidate passed to renderer contains embedding/path/local user data.

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

### Task 13: `/ai` My Story / Vault / combined scopes

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

**Interfaces:** Keep the existing `vault.ask` public entry point to minimize preload churn, but change its typed input to `PrivateArchiveScope` and result to `PrivateArchiveAnswer`. Story, Vault, and combined scopes are explicit. In Vault mode, retain all-indexed vs selected document controls. Story citation title is `My Story › <Chapter> › <Memory>`.

- [ ] **Step 1: Write RED tests**

Assert exact IPC reconstruction of all four scope variants, malicious identity/path field stripping, My Story works with zero Vault documents, combined payload, safe union citations, keyboard submit, and source-aware error/privacy copy.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/vault/vaultIpc.ask.test.ts src/preload/createDesktopApi.askVault.test.ts src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/AskVault.test.tsx
```

- [ ] **Step 3: Wire `PrivateArchiveQueryService` and update `/ai`**

Use one runtime manager, one Nomic client, one Granite client. Do not introduce Story model ports/processes.

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

### Task 14: Merge-blocking Story security + architecture boundary suite

**Files:**
- Create: `src/main/story/StorySecurity.test.ts`
- Modify: `scripts/verify-boundaries.mjs`
- Modify: `src/main/security/BoundaryVerifier.test.ts` if that file exists after baseline sync; otherwise add Story boundary assertions to the synchronized repository's existing verifier-contract test rather than inventing a parallel scanner.

**Required invariants:**

1. Cross-user answer read/save/confirm denied.
2. Cross-user version list/restore denied.
3. Cross-user media open/delete denied.
4. Renderer identity/path/model/runtime injection stripped.
5. Absolute legacy/current paths never cross preload.
6. Draft/unconfirmed answers have no chunks.
7. First confirmed edit snapshots old state and removes stale chunks immediately.
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
19. Public errors contain no paths, process stderr, ports, embeddings, or secrets.
20. Only `DesktopStoryClient` accesses `window.familyCircle.story` from production renderer code.

- [ ] **Step 1: Write complete security tests and Story boundary rules**

At least the new boundary scanner assertions must be RED before implementation if all runtime invariants already pass.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/main/story/StorySecurity.test.ts
npm run verify:boundaries
```

- [ ] **Step 3: Fix only proven gaps**

Boundary scanner rejects direct Story preload access outside `DesktopStoryClient`, Story imports of Circle transport, and private Story internals in renderer/shared public files.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/main/story/StorySecurity.test.ts
npm run verify:boundaries
```

- [ ] **Step 5: Commit**

```bash
git add src/main/story/StorySecurity.test.ts scripts/verify-boundaries.mjs src/main/security 2>/dev/null || true
git add src/main src/preload src/renderer src/shared
git commit -m "test: enforce My Story privacy boundaries"
```

---

### Task 15: Accessibility, docs, complete verification, and review boundary

**Files:**
- Create: `src/renderer/features/story/MyStory.accessibility.test.tsx`
- Modify: Story renderer files only for failures proven by that test.
- Modify: `README.md`
- Modify: `docs/PRIVATE_AI.md`
- Modify: `docs/WINDOWS_RELEASE.md`

**Accessibility acceptance:** four view controls expose selected state; draft/confirmed/index state is textual; chapter progress has accessible names; Previous/Next focus is deterministic; Confirm describes searchability; recorder status uses live semantics; media buttons include filename/type; restore dialog is labelled/Escape-closeable/focus-returning; errors use alert/status roles; no core action requires hover.

- [ ] **Step 1: Write accessibility RED tests**

Use Testing Library role/name/state queries across Guided, Chapters, Review, History, confirmation, media, restore dialog, and recorder states.

- [ ] **Step 2: Run focused RED/GREEN loop**

```bash
npx vitest run src/renderer/features/story/MyStory.accessibility.test.tsx src/renderer/features/story/MyStory.test.tsx
```

- [ ] **Step 3: Update documentation**

README: My Story is real, private, four-view, confirmed-only searchable. `PRIVATE_AI.md`: Story indexing/pending retry/shared top-5. `WINDOWS_RELEASE.md`: standard installer contains manifest/license only; optional voice setup downloads verified runtime/model separately. Document seven-language v1 contract and no cloud fallback.

- [ ] **Step 4: Run clean complete local gate**

```bash
rm -rf node_modules
npm ci
npm run check
npm audit --audit-level=high
```

Expected: all tests/typechecks/boundaries/builds pass and audit has no high-severity blocker.

- [ ] **Step 5: Perform full diff/security review**

Invoke `superpowers:requesting-code-review`. Review `main...feature/my-story` specifically for ownership predicates, original-source immutability, media traversal, stale chunks, restore invalidation, shared top-5, voice command injection, network fallback, IPC stripping, path/ID/embedding leakage, Family Tree route preservation, and Windows exclusions. Every merge-blocking finding gets RED -> GREEN evidence and a focused commit.

- [ ] **Step 6: Open/update PR and require exact-head CI**

Require exact feature head:

```text
Linux: npm run check + npm audit --audit-level=high
Windows: Verify application + NSIS build + package verifier + exactly-one-installer + artifact upload
```

Do not use an older commit's green run after review fixes move the head.

- [ ] **Step 7: Record final immutable evidence**

Record feature SHA, total test files/tests, `StorySecurity` count, accessibility count, audit result, Linux run/job IDs, Windows run/job IDs, and installer artifact ID/digest when exposed. Stop at merge boundary; do not merge without explicit user instruction.

- [ ] **Step 8: Commit documentation/accessibility slice**

```bash
git add src/renderer/features/story README.md docs/PRIVATE_AI.md docs/WINDOWS_RELEASE.md
git commit -m "docs: finish My Story release slice"
```

If review fixes create later commits, the later exact head is the final verification target.
