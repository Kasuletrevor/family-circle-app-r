# My Story Design

**Date:** 2026-09-10  
**Status:** Approved design, pending implementation plan  
**Branch:** `feature/my-story`  
**Base:** `main` at `9f8d7fefa1f2336654c727683e20285daf0319d9`

## 1. Purpose

Recreate the reference Kin-Keepers **My Story** experience as a private, local, first-class desktop feature in the Electron + React rebuild.

The new `/stories` experience is a personal memory studio for the signed-in local user. It preserves the reference app's guided life-story questions, progress, review, history, photo/audio attachments, offline voice transcription, and private AI retrieval, while applying the rebuild's stronger ownership, IPC, filesystem, and local-AI trust boundaries.

My Story is **not shared Circle data**. It does not use `LegacyCircleAuthAdapter`, does not depend on Circle membership, and does not send story content, media, embeddings, or local identities to the Circle service.

## 2. Goals

The first release must provide the complete practical reference experience:

1. All 16 guided prompts across six chapters.
2. Guided, Chapters, Review, and History views.
3. Private debounced draft autosave.
4. A per-memory explicit **Confirm memory** privacy/searchability gate.
5. Deterministic follow-up prompt chips from the reference experience.
6. Whole-story version history capped at 30 meaningful versions.
7. Explicit restore confirmation with a pre-restore snapshot.
8. Photo and audio attachments on individual memories.
9. Private open/delete behavior for Story media.
10. Microphone recording and local offline transcription.
11. Per-answer language metadata and transcription language hints.
12. Confirmed-memory indexing with the existing local Nomic runtime.
13. `/ai` source selection for My Story, Vault, or both private sources.
14. Story-aware citations in private AI answers.
15. Copy-safe migration of legacy My Story content and media.
16. Merge-blocking accessibility, ownership, migration, indexing, media, voice, IPC-boundary, and Windows-package tests.

## 3. Non-goals

This release does not add:

- Story sharing with Circle members;
- collaborative Story editing;
- comments, reactions, likes, or a social Story feed;
- public publishing;
- cloud transcription or cloud AI fallback;
- automatic confirmation of typed or transcribed text;
- automatic transcription/indexing of attached audio files;
- image understanding or OCR of Story photos;
- arbitrary custom Story questions;
- AI rewriting or rewriting-in-place of a user's memory;
- cross-device Story synchronization;
- Story content in the shared Circle service;
- Story text or media in the Windows installer.

## 4. Product boundary

### 4.1 Local/private responsibilities

My Story belongs to the signed-in **local user** and is stored under the desktop application's private local data boundary.

Local/private data includes:

- answers and confirmation state;
- answer language metadata;
- Story versions/history;
- photo/audio attachments;
- private Story storage paths;
- Story embeddings/chunks;
- optional offline voice assets;
- temporary voice recordings during transcription.

### 4.2 Shared Circle responsibilities

Circles, memberships, invitations, shared Family Tree relationships/positions, and other deliberately shared family content remain server-owned.

No My Story main-process service may call `LegacyCircleAuthAdapter` or any Circle URL.

## 5. Reference Story schema

The initial Story schema is fixed and versioned. It recreates the 16 reference prompts.

| Key | Chapter | Label | Prompt | Input |
|---|---|---|---|---|
| `fullName` | Identity | Full name | What is your full name, and is there a story behind it? | text |
| `preferredName` | Identity | Preferred name | What do the people closest to you call you? | text |
| `roots` | Identity | Birthplace and roots | Where are your roots? | text |
| `languages` | Identity | Languages | Which languages do you speak or understand? | text |
| `occupation` | Everyday Life | What I do | Tell me about what you do and what a normal day looks like for you. | textarea |
| `lifeStage` | Everyday Life | Life stage | Which stage best describes why you are capturing your story now? | select |
| `snapshot` | Life Story | My story in a few words | If you introduced your life to a future family member, what would you want them to know first? | textarea |
| `childhood` | Life Story | Childhood and early memories | What childhood memory or place still feels alive to you? | textarea |
| `education` | Life Story | Learning and education | Where and how did you learn the lessons that mattered most? | textarea |
| `workLife` | Life Story | Work and contribution | What work, service, or contribution are you proud of? | textarea |
| `relationships` | People & Places | Important people | Who are the people who shaped your life, and how? | textarea |
| `milestones` | People & Places | Milestones and turning points | Which moments changed the direction of your life? | textarea |
| `traditions` | Values & Wishes | Traditions to preserve | What family tradition, recipe, belief, or practice should never be lost? | textarea |
| `values` | Values & Wishes | Values and lessons | What values or lessons have guided the way you live? | textarea |
| `carePreferences` | Care & Future | Care and daily preferences | What would help someone support and care for you well? | textarea |
| `futureMessage` | Care & Future | Message for the future | What message would you like future generations to hear in your own words? | textarea |

The `lifeStage` options remain:

- Building my archive
- Preserving elder memories
- Preparing family handover
- Documenting health and care

The schema also carries static hints and deterministic follow-up prompt chips. Follow-up prompts are presentation guidance only; they are not AI-generated and are not stored as Story content unless the user types an answer into the memory field.

Examples retained from the reference include:

- roots: “What did that place feel like?” and “Which people or traditions connect you to it?”
- childhood: “Who was there with you?” and “What sounds, food, or small details do you remember?”

## 6. Canonical local data model

Do not reuse the legacy Story table names as canonical tables. The copied legacy database may already contain `my_stories`, `story_entries`, `story_history`, and `story_media`; those remain migration sources.

### 6.1 `story_answers`

Canonical current answers.

```text
id                  INTEGER PRIMARY KEY
local_user_id       INTEGER NOT NULL FK users(id) ON DELETE CASCADE
field_key           TEXT NOT NULL
schema_version      INTEGER NOT NULL
section             TEXT NOT NULL
label               TEXT NOT NULL
question            TEXT NOT NULL
answer              TEXT NOT NULL DEFAULT ''
language            TEXT NOT NULL DEFAULT 'en'
confirmed           INTEGER NOT NULL DEFAULT 0
index_status        TEXT NOT NULL DEFAULT 'not_indexed'
created_at          INTEGER NOT NULL
updated_at          INTEGER NOT NULL
confirmed_at        INTEGER
UNIQUE(local_user_id, field_key)
```

`index_status` values:

```text
not_indexed
pending
ready
failed
```

### 6.2 `story_versions`

Immutable whole-story snapshots.

```text
id                  INTEGER PRIMARY KEY AUTOINCREMENT
local_user_id       INTEGER NOT NULL FK users(id) ON DELETE CASCADE
snapshot_json       TEXT NOT NULL
semantic_signature TEXT NOT NULL
created_at          INTEGER NOT NULL
```

Keep at most the newest **30 semantic versions per user**. Draft autosaves do not create history rows.

### 6.3 `story_media_items`

Private attachments associated with a Story field.

```text
id                    INTEGER PRIMARY KEY AUTOINCREMENT
local_user_id         INTEGER NOT NULL FK users(id) ON DELETE CASCADE
field_key             TEXT NOT NULL
media_type            TEXT NOT NULL           -- photo | audio
file_name             TEXT NOT NULL            -- display name only
mime_type             TEXT NOT NULL
size_bytes            INTEGER NOT NULL
stored_relative_path  TEXT NOT NULL
created_at            INTEGER NOT NULL
```

Absolute paths are never stored in renderer-facing DTOs.

### 6.4 `story_chunks`

Private embeddings for confirmed Story memories.

```text
id                  INTEGER PRIMARY KEY AUTOINCREMENT
story_answer_id     INTEGER NOT NULL FK story_answers(id) ON DELETE CASCADE
chunk_index         INTEGER NOT NULL
text                TEXT NOT NULL
embedding_blob      BLOB NOT NULL
embedding_model     TEXT NOT NULL
index_version       INTEGER NOT NULL
created_at          INTEGER NOT NULL
updated_at          INTEGER NOT NULL
UNIQUE(story_answer_id, chunk_index)
```

Ownership is always resolved by joining `story_chunks -> story_answers -> users`. The renderer never sees embeddings or chunk rows.

### 6.5 `story_import_state`

Tracks idempotent migration of legacy Story data.

```text
local_user_id       INTEGER NOT NULL
migration_key       TEXT NOT NULL
completed_at        INTEGER NOT NULL
PRIMARY KEY(local_user_id, migration_key)
```

The first migration key is `legacy-my-story-v1`.

## 7. Confirmation as privacy/searchability gate

A Story answer can exist as a private draft without being searchable.

```text
type or transcribe
      ↓
private local draft
      ↓
user reviews words
      ↓
Confirm memory
      ↓
confirmed = true
      ↓
local Nomic indexing
      ↓
eligible for My Story private retrieval
```

### 7.1 Editing confirmed text

The instant a confirmed answer changes in the UI, it is considered unconfirmed in renderer state.

On the first change from confirmed content, the renderer immediately persists the new draft state through main rather than waiting for the normal debounce. Main performs one transaction that:

1. writes the changed draft text;
2. sets `confirmed = 0`;
3. clears `confirmed_at`;
4. deletes all existing `story_chunks` for that answer;
5. sets `index_status = 'not_indexed'`.

Subsequent draft edits use the normal debounce.

This fail-closed rule ensures stale confirmed text is not searchable while the user is editing.

### 7.2 Confirming a memory

Confirmation is split deliberately around the potentially slow embedding operation.

Main first commits the authoritative state transactionally:

1. validate field key, answer, and language;
2. create a meaningful pre-change Story version when required;
3. set `confirmed = 1` and `confirmed_at`;
4. delete old chunks for the answer;
5. set `index_status = 'pending'`.

Only after that transaction commits does the indexing service call Nomic.

Successful indexing atomically replaces that answer's chunks and sets `index_status = 'ready'`.

If embedding fails, the answer remains safely saved and confirmed, no stale chunks remain, and `index_status = 'failed'`. The UI offers **Retry private indexing**.

No cloud fallback is permitted.

## 8. Story history and restore semantics

History captures meaningful Story state, not keystrokes.

A semantic version is considered for creation:

- immediately before a confirmed memory is materially changed;
- when the user explicitly chooses **Save now** and the semantic Story differs from the newest version;
- immediately before restoring an older version, when current semantic Story content differs.

`semantic_signature` ignores ephemeral UI state such as active view/step and indexing status.

A snapshot contains the 16 answers plus their language and confirmation metadata. It does not duplicate media files or embeddings.

### 8.1 Restore

Restore requires an explicit confirmation dialog.

Main re-resolves the version by `(version_id, local_user_id)`. It never trusts a renderer-supplied user ID.

Restore flow:

```text
validate owned version
  → snapshot current semantic Story if different
  → replace canonical answers from snapshot transactionally
  → delete all current Story chunks
  → mark confirmed non-empty answers pending
  → commit restored Story
  → rebuild index for confirmed answers
```

If the database restore transaction fails, the current Story remains unchanged.

If reindexing fails afterward, restored text remains canonical but search fails closed for affected fields with `index_status = 'failed'` and no stale newer chunks.

Media is not versioned. Existing media remains associated with its field across text restores.

## 9. Story media

### 9.1 Supported media

Photos:

- `.jpg` / `.jpeg`
- `.png`
- `.gif`
- `.webp`

Audio:

- `.mp3`
- `.wav`
- `.m4a`
- `.ogg`
- `.flac`
- `.webm`

The application validates both supported extension/container type and file signature/container markers where practical. Extension alone is never trusted.

Limits retain the useful reference behavior:

- photo: **25 MiB** maximum per file;
- audio: **100 MiB** maximum per file;
- at most **8 selected files per add operation**.

### 9.2 Private storage

The main process owns file selection and path resolution. Selected files are copied into randomized per-user storage:

```text
<userData>/story/users/<localUserId>/media/<UUID>.<ext>
```

The database stores only a relative path under application user data.

Renderer DTOs contain only:

```text
id
fieldKey
mediaType
fileName
mimeType
sizeBytes
createdAt
```

### 9.3 Media operations

Public operations use media IDs only. Main re-resolves ownership before open/delete.

A successful add inserts the DB row only after the private copy succeeds.

Delete is retry-safe. The owned database record is removed only for the authenticated local user; filesystem cleanup treats already-missing owned files as successful cleanup.

Raw filesystem errors and absolute paths are never shown to React.

Attaching audio does **not** automatically transcribe or index it. Attaching a photo does not trigger OCR or image analysis.

## 10. Legacy migration

The rebuild already performs copy-safe database migration:

```text
%APPDATA%/Family Circle/family.db
          ↓ copy only when rebuild DB absent
<rebuild userData>/family.db
          ↓
additive rebuild migrations
```

The original legacy database is never opened for migration writes.

My Story migration runs only against the rebuild-owned copy.

### 10.1 Answer migration

For each existing local user:

1. If `my_stories` exists and contains valid `story_json`, treat it as the most complete legacy Story source.
2. Import all known schema fields into `story_answers`.
3. Preserve per-field confirmation from legacy `__confirmed` metadata when present.
4. For legacy Stories that predate confirmation metadata, treat non-empty answers as confirmed to preserve previously searchable memories.
5. Preserve per-field language from legacy `__languages` when present.
6. Otherwise fall back to matching legacy `story_entries.language`, then legacy `__language`, then `en`.
7. If `my_stories` is absent/damaged but `story_entries` exists, reconstruct known fields from `story_entries` as a fallback.
8. Unknown legacy keys are not silently promoted into the fixed v1 schema; they remain in the untouched legacy source tables.

### 10.2 History migration

Existing `story_history` snapshots are converted into `story_versions`, preserving original creation timestamps where valid. Duplicate semantic snapshots are deduplicated. The newest 30 semantic versions are retained.

### 10.3 Media migration

Copying the SQLite database does not copy external Story media.

The known legacy Story media root is derived from the legacy app data directory, not from renderer input. A legacy `story_media.file_path` is eligible only when:

- it resolves under that known legacy Story media root;
- the referenced file exists;
- its field key belongs to the fixed Story schema;
- its media type and size pass current validation.

Eligible files are **copied**, never moved, into new randomized private storage. The original media remains untouched.

Missing, invalid, oversized, or out-of-root legacy attachments are skipped and recorded as unavailable migration diagnostics; they are never opened from arbitrary locations.

### 10.4 Idempotency

`story_import_state` prevents duplicate import after restart/crash. Import steps are transactionally checkpointed per user. Re-running migrations must not duplicate answers, versions, or media.

The importer never mutates legacy source tables or original legacy media files.

## 11. User experience

`/stories` becomes **My Story** and replaces the placeholder route.

The page has four primary views:

```text
Guided | Chapters | Review | History
```

### 11.1 Header / hero

The hero frames My Story as a living private family archive, not a questionnaire.

Progress is based on **confirmed memories**, for example:

```text
9 of 16 memories confirmed
```

Filled drafts do not increase confirmed progress.

Chapter cards show confirmed/total progress and allow navigation.

### 11.2 Guided view

One memory prompt at a time.

The card shows:

- chapter and position (`Life Story · 7 of 16`);
- prompt;
- optional hint;
- answer field;
- language control;
- deterministic follow-up prompt chips after text exists;
- confirmation/searchability state;
- attached media;
- voice recording/transcription action;
- photo/audio attachment actions;
- Previous / Confirm memory / Next actions.

Confirmation copy must make the privacy consequence understandable, e.g.:

```text
Draft — review your words before making this memory searchable.
```

and after confirmation:

```text
Confirmed — available to your private local AI.
```

### 11.3 Chapters view

Shows all fields grouped by the six chapters for users who prefer a full-form workflow.

Editing a confirmed field invokes the same immediate invalidation semantics as Guided view.

### 11.4 Review view

Shows populated memories as a readable life-story review, grouped by chapter, with:

- search/filter;
- answer text;
- confirmation/searchability state;
- attachments;
- **Edit** action that jumps to the relevant Guided prompt.

The review does not fabricate narrative prose or rewrite user content.

### 11.5 History view

Shows newest-first semantic Story versions with:

- date/time;
- number of populated memories;
- number of confirmed memories;
- safe short preview;
- **Restore** action.

Restore requires explicit confirmation and explains that current Story text is saved as a recoverable version first when materially different.

### 11.6 Footer/save state

The UI distinguishes:

```text
Saving…
Saved privately on this computer
Not saved yet — retry
```

A **Save now** action forces immediate draft persistence and creates a history version only when semantic Story state differs from the newest version.

## 12. Offline voice transcription

The reference implementation records mono audio, resamples to 16 kHz PCM WAV, and invokes a local `whisper.cpp` CLI with a Whisper base model and language hint.

The rebuild recreates that capability without bundling the runtime/model in the standard installer.

### 12.1 Recorder

A renderer-only `StoryVoiceRecorder` requests microphone permission, captures mono speech, and produces a **16 kHz PCM WAV** byte payload. It exposes no filesystem paths.

The recording UI has explicit states:

```text
idle
recording
transcribing
success
error
```

Stopping a recording releases microphone tracks immediately.

### 12.2 Public transcription boundary

Renderer calls a narrow method conceptually equivalent to:

```ts
story.transcribeRecording({ wavBytes, language })
```

The renderer cannot provide executable paths, model paths, command-line flags, temp paths, or network endpoints.

Main validates:

- protected local session exists;
- payload is non-empty WAV;
- maximum transcription payload is **25 MiB**;
- language hint is from the allowed language model;
- no second transcription is already running.

### 12.3 Voice asset pack

The optional voice pack contains:

- verified `whisper.cpp` runtime for supported desktop platform;
- verified Whisper base model;
- manifest size and SHA-256 values.

It is installed separately on first use, using the same security properties as the existing optional Private AI asset setup: resumable verified download, no secrets, no model in the NSIS payload, and repair status when assets fail verification.

The implementation may reuse/generalize existing verified-download/hash primitives, but voice setup must remain a distinct product capability/status from Granite/Nomic readiness.

### 12.4 Transcription execution

Main writes the WAV bytes to a main-controlled temporary path, invokes the verified local runtime with a bounded thread count and language hint, and enforces a **120-second timeout**.

Temporary audio is deleted in `finally` on success or failure.

The transcript is returned as plain text only. Process stderr, executable/model paths, and temp paths are never returned to React.

The transcript is inserted into the current answer as **draft text**. It is never auto-confirmed.

There is **no ElevenLabs or other network transcription fallback**.

## 13. Language metadata

Every answer stores a short validated language code. The default is `en` until the user selects another supported option.

The selected answer language is passed as a hint to local transcription where supported. Unsupported language hints fail safely or use a documented local-model automatic mode; they never cause a cloud request.

Language metadata affects transcription/retrieval metadata only. It does not change Story ownership or confirmation rules.

## 14. Private AI indexing

My Story reuses the existing local Nomic + Granite runtime. It does not create a second model server.

### 14.1 Story chunk format

Confirmed memory text is embedded with provenance-preserving text similar to:

```text
[[MY STORY | childhood | Life Story | Childhood and early memories]]
Chapter: Life Story
Memory: Childhood and early memories
Question: What childhood memory or place still feels alive to you?
Answer: <confirmed user text>
```

Chunking is deterministic and versioned.

Only confirmed, non-empty `story_answers` are eligible for Story chunks.

### 14.2 Query scopes

The private AI UI gains three user-visible source modes:

```text
My Story
Vault documents
My Story + Vault
```

The underlying query scope is explicit and renderer-safe.

A single Nomic query embedding is created per question. Candidate chunks are loaded only for the authenticated local user from the selected private source repositories, scored using the existing cosine-similarity rules, combined, ranked, and capped before Granite generation.

No Story or Vault source is sent to a cloud model.

### 14.3 Story citations

Story results are cited with user-readable provenance:

```text
My Story › Life Story › Childhood and early memories
```

Vault citations remain document-based as today.

Renderer citations never expose local row IDs as meaningful identity, filesystem paths, embedding data, or model internals.

## 15. Main-process architecture

Expected units:

```text
StoryService
  ├── protected-session ownership
  ├── StoryRepository
  ├── StoryHistoryRepository
  ├── StoryMediaRepository
  ├── StoryMediaStore
  ├── StoryIndexService
  ├── StoryLegacyImporter
  └── VoiceTranscriptionService

PrivateArchiveQueryService (or equivalent generalized query layer)
  ├── VaultChunkRepository
  ├── StoryChunkRepository
  ├── NomicClient
  └── GraniteClient
```

Units must remain independently testable. React never imports database/filesystem/model/process code.

The implementation should reuse existing Vault and Private AI primitives where they are genuinely generic, but must not couple Story ownership to a Vault document ID or fake Story memories as Vault documents.

## 16. Public preload API

The renderer-facing Story API is narrow and reconstructs accepted business inputs field-by-field.

Conceptual surface:

```text
story.get()
story.saveDraft({ fieldKey, answer, language })
story.confirmField({ fieldKey })
story.retryIndexing({ fieldKey })
story.saveNow()
story.getHistory()
story.restoreVersion({ versionId })
story.chooseAndAddMedia({ fieldKey, mediaType })
story.openMedia({ mediaId })
story.deleteMedia({ mediaId })
story.transcribeRecording({ wavBytes, language })
story.getVoiceStatus()
story.setupVoice()
story.retryVoiceSetup()
```

Actual setup-progress subscription naming should follow the existing `privateAi` preload pattern.

No public Story input may contain:

```text
localUserId
absolutePath
storedRelativePath
embeddingBlob
modelPath
runtimePath
port
apiKey
circleId
serverUserId
```

All IDs are treated as untrusted handles and re-resolved for the authenticated local user in main.

## 17. Error and recovery behavior

### Draft saving

A failed draft autosave leaves the typed text visible and shows a retryable `Not saved yet` state. Raw SQLite errors are hidden.

### Confirmation/indexing

A confirmed answer is never lost because embedding fails. Confirmation remains durable, stale chunks are already deleted, `index_status` becomes `failed`, and retry is explicit.

### Restore

A failed DB restore does not replace current canonical answers. A successful restore followed by indexing failure keeps restored text but no stale pre-restore chunks.

### Media

Failed copy creates no media row. Failed open/delete returns stable user-facing errors without paths. Missing owned files are handled as recoverable cleanup, not as authorization bypasses.

### Voice

Missing/corrupt voice assets show setup/repair guidance. Microphone denial is a normal user-facing state. Temporary files and microphone tracks are cleaned up on all paths.

### Private AI

If Private AI is not installed, users can still create, confirm, review, version, and attach media to My Story. Confirmation can remain `pending`/`failed` for indexing until local AI becomes available. Story capture never requires cloud or model readiness.

## 18. Security invariants

Merge-blocking tests must prove all of the following:

1. User A cannot read User B Story answers.
2. User A cannot save/confirm User B Story answers by injecting ownership fields.
3. User A cannot list or restore User B Story versions.
4. User A cannot open/delete User B Story media.
5. Renderer cannot choose `local_user_id` or storage paths.
6. Absolute legacy/current media paths never cross preload.
7. Unconfirmed answers never exist in `story_chunks`.
8. The first edit of confirmed text deletes stale searchable chunks before debounce can leave them visible to retrieval.
9. Failed embedding leaves no stale prior chunks.
10. Restoring a version cannot leave newer Story chunks searchable.
11. Foreign/stale version and media IDs are rejected before filesystem/database mutation.
12. Path traversal and out-of-root media paths are rejected.
13. Legacy media importer reads only from the known legacy Story media root.
14. Legacy import is idempotent.
15. Legacy import never mutates the original database or original media files.
16. Story content never reaches `LegacyCircleAuthAdapter`.
17. Voice transcription cannot select arbitrary executables/models/arguments.
18. Voice transcription has no network fallback.
19. Temporary voice files are removed on success/failure/timeout.
20. Attached audio/images are not silently transcribed, OCR'd, or indexed.
21. Public errors do not reveal SQLite paths, media paths, model/runtime paths, local AI ports, process stderr, or secrets.

## 19. Accessibility requirements

My Story must be fully keyboard-usable and screen-reader meaningful.

Required coverage includes:

- four view controls expose selected state;
- confirmed/draft/indexing state is textual and not color-only;
- chapter progress has accessible names;
- guided Previous/Next controls have deterministic focus behavior;
- Confirm memory communicates its privacy/searchability effect;
- recording/transcribing status is announced through a suitable live region;
- media controls have filenames/types in accessible names;
- History restore dialog traps/returns focus through the app's existing accessible-dialog pattern;
- errors use an accessible alert/status surface;
- no interaction relies solely on hover.

## 20. Testing strategy

### Database/migrations

Tests cover fresh schema, additive upgrade, old Story tables present/absent/damaged, idempotent import, history cap/deduplication, and foreign-key cleanup.

### Story repositories/service

Tests cover per-user ownership, draft invalidation, confirmation, meaningful versioning, restore, index state transitions, safe errors, and stale/foreign handles.

### Media

Tests cover supported signatures, type mismatch, size limits, randomized private storage, path traversal, owned open/delete, missing files, legacy-root enforcement, and copy-not-move migration.

### Voice

Tests cover WAV validation, 25 MiB cap, busy guard, language validation, command construction, timeout, temp cleanup, missing/corrupt assets, safe stderr handling, and explicit proof that no network fallback is called.

### Indexing/retrieval

Tests cover confirmed-only indexing, immediate stale-chunk deletion, per-field atomic replacement, failed indexing, restore rebuild, user ownership, Story/Vault/all scopes, combined ranking, one query embedding, Story citations, and no query-time re-embedding of all Story answers.

### IPC/preload/client

Tests prove exact allowed channels/payloads, identity/path stripping, no direct preload use outside dedicated clients, and no Story internals in the renderer contract.

### UI

Tests cover empty/new Story, all four modes, 16 fields/six chapters, confirmed progress, deterministic follow-ups, draft save state, confirmation, indexing retry, Review edit navigation, History restore, media, recording/transcription states, safe errors, and accessibility.

### Architecture/security

Add a dedicated merge-blocking Story security test suite and extend the architecture boundary scanner so Story private internals cannot leak into renderer/shared Circle code.

### Release

Final verification remains:

```text
npm ci
npm run check
npm audit --audit-level=high
```

Then require exact-head Linux CI plus the full Windows NSIS/package verification chain before merge readiness.

## 21. Implementation sequencing constraints

The implementation plan must preserve these dependencies:

1. schema + migration foundations before Story repositories;
2. ownership-safe Story service before IPC/preload;
3. draft/confirmation/history before indexing;
4. private media store before UI attachments;
5. voice asset/runtime service before UI transcription;
6. Story indexing before generalized My Story/Vault retrieval scopes;
7. complete renderer client before the `/stories` page;
8. security/accessibility tests before merge readiness.

Every behavior-changing task follows real RED → GREEN TDD with focused commits and exact-head verification at meaningful checkpoints.

## 22. Interaction with Family Tree PR

This design branch intentionally starts from current `main`, not the unmerged Family Tree feature branch. My Story has no data/runtime dependency on Family Tree.

If Family Tree merges before My Story implementation, the My Story branch should be rebased/updated onto the new `main` before implementation starts. The expected route-level overlap is limited to replacing the `/stories` placeholder in `App.tsx`; implementation must preserve the real `/family-tree` route after rebasing.

## 23. Acceptance criteria

The feature is complete only when:

- `/stories` is a real My Story memory studio, not a placeholder;
- all 16 reference memories and six chapters are present;
- drafts survive restart without becoming searchable;
- confirmation explicitly controls Story AI searchability;
- editing confirmed text fails closed by removing stale chunks;
- meaningful history/restore works and remains capped at 30;
- photo/audio attachments are private, owned, and path-safe;
- microphone recording can transcribe locally through verified optional Whisper assets without cloud fallback;
- transcripts remain drafts until explicit confirmation;
- My Story, Vault, and combined private AI query scopes work with readable citations;
- legacy Story content/history/media migrates copy-safely and idempotently;
- no Story content or local identity crosses the Circle compatibility boundary;
- security/accessibility suites pass;
- `npm run check` and high-severity audit are green;
- exact feature head passes Linux CI and the Windows installer/package chain.
