# My Story Design

**Date:** 2026-09-10  
**Status:** Approved design, pending implementation plan  
**Branch:** `feature/my-story`  
**Base:** `main` at `9f8d7fefa1f2336654c727683e20285daf0319d9`

## 1. Purpose

Recreate the reference Kin-Keepers **My Story** experience as a private, local, first-class feature in the Electron + React rebuild.

`/stories` becomes a personal memory studio for the signed-in local user. It preserves the reference guided questions, progress, review, history, photo/audio attachments, offline voice transcription, deterministic follow-up prompts, and private AI retrieval, while applying the rebuild's stricter session, IPC, filesystem, migration, and local-AI boundaries.

My Story is **not shared Circle data**. Story text, media, versions, embeddings, and local identities never pass through `LegacyCircleAuthAdapter` or the Circle service.

## 2. First-release scope

The first release recreates the complete practical reference flow:

1. 16 fixed guided memories across six chapters.
2. Guided, Chapters, Review, and History views.
3. Debounced private draft autosave plus **Save now**.
4. Per-memory **Confirm memory** privacy/searchability gate.
5. Deterministic follow-up prompt chips.
6. Whole-story semantic history capped at 30 versions.
7. Explicit restore confirmation with pre-restore snapshot.
8. Per-memory photo and audio attachments.
9. Private media open/delete.
10. Microphone recording and local Whisper transcription.
11. Per-answer language metadata and transcription language hints.
12. Confirmed-memory Nomic indexing.
13. `/ai` scopes: My Story, Vault documents, My Story + Vault.
14. Story-aware private-AI citations.
15. Copy-safe, idempotent legacy Story/history/media migration.
16. Merge-blocking security, ownership, migration, indexing, voice, accessibility, IPC, and Windows-package coverage.

## 3. Non-goals

This release does **not** add Story sharing, collaborative editing, comments/reactions, public publishing, cloud transcription, cloud AI fallback, automatic confirmation, hidden transcription/OCR/indexing of attachments, arbitrary custom questions, cross-device sync, or AI rewriting of the user's memories.

## 4. Ownership boundary

My Story belongs to the restored **local user** and is independent of Circle membership.

Local/private responsibilities:

- answers, language, confirmation and index status;
- Story versions;
- photo/audio attachments;
- relative private media paths;
- Story chunks/embeddings;
- optional offline voice assets;
- temporary transcription audio.

Shared/server responsibilities remain Circles, membership, invitations, shared Family Tree data, notifications, and other deliberately shared content.

No Story main-process service may call a Circle URL.

## 5. Fixed Story schema

The schema is versioned and initially recreates these 16 reference memories:

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

`lifeStage` options remain: Building my archive; Preserving elder memories; Preparing family handover; Documenting health and care.

The schema also owns static hints and deterministic follow-up prompts. Follow-up chips are presentation guidance, not AI output. Examples retained from the reference include “What did that place feel like?”, “Who was there with you?”, and “What sounds, food, or small details do you remember?”.

## 6. Canonical local storage

Do not reuse legacy Story table names. The copied legacy database may already contain `my_stories`, `story_entries`, `story_history`, and `story_media`; those remain migration sources only.

### 6.1 `story_answers`

```text
id               INTEGER PRIMARY KEY
local_user_id    INTEGER NOT NULL FK users(id) ON DELETE CASCADE
field_key        TEXT NOT NULL
schema_version   INTEGER NOT NULL
section          TEXT NOT NULL
label            TEXT NOT NULL
question         TEXT NOT NULL
answer           TEXT NOT NULL DEFAULT ''
language         TEXT NOT NULL DEFAULT 'en'
confirmed        INTEGER NOT NULL DEFAULT 0
index_status     TEXT NOT NULL DEFAULT 'not_indexed'
created_at       INTEGER NOT NULL
updated_at       INTEGER NOT NULL
confirmed_at     INTEGER
UNIQUE(local_user_id, field_key)
```

`index_status` is one of `not_indexed`, `pending`, `ready`, `failed`.

Rows are created/upserted only when a field is saved/imported. Merely opening My Story does not create 16 database rows; the renderer client merges persisted rows over the fixed schema.

### 6.2 `story_versions`

```text
id                  INTEGER PRIMARY KEY AUTOINCREMENT
local_user_id       INTEGER NOT NULL FK users(id) ON DELETE CASCADE
snapshot_json       TEXT NOT NULL
semantic_signature TEXT NOT NULL
created_at          INTEGER NOT NULL
```

Versions are immutable and capped at the newest **30 semantic snapshots per user**. Draft autosave never creates history.

### 6.3 `story_media_items`

```text
id                    INTEGER PRIMARY KEY AUTOINCREMENT
local_user_id         INTEGER NOT NULL FK users(id) ON DELETE CASCADE
field_key             TEXT NOT NULL
media_type            TEXT NOT NULL           -- photo | audio
file_name             TEXT NOT NULL
mime_type             TEXT NOT NULL
size_bytes            INTEGER NOT NULL
stored_relative_path  TEXT NOT NULL
storage_status        TEXT NOT NULL DEFAULT 'active' -- copying | active
legacy_source_key     TEXT
created_at            INTEGER NOT NULL
UNIQUE(local_user_id, legacy_source_key)
```

`legacy_source_key` is `NULL` for normal new attachments; SQLite permits multiple `NULL` values under this unique constraint. It exists only to make legacy media import crash-safe and idempotent.

### 6.4 `story_chunks`

```text
id               INTEGER PRIMARY KEY AUTOINCREMENT
story_answer_id  INTEGER NOT NULL FK story_answers(id) ON DELETE CASCADE
chunk_index      INTEGER NOT NULL
text             TEXT NOT NULL
embedding_blob   BLOB NOT NULL
embedding_model  TEXT NOT NULL
index_version    INTEGER NOT NULL
created_at       INTEGER NOT NULL
updated_at       INTEGER NOT NULL
UNIQUE(story_answer_id, chunk_index)
```

Ownership is always resolved through `story_chunks -> story_answers -> users`; the renderer never sees chunk rows or embeddings.

### 6.5 `story_import_state`

```text
local_user_id  INTEGER NOT NULL
migration_key  TEXT NOT NULL
completed_at   INTEGER NOT NULL
PRIMARY KEY(local_user_id, migration_key)
```

Initial migration key: `legacy-my-story-v1`.

## 7. Confirmation is the privacy/searchability gate

```text
type or transcribe
      ↓
private draft
      ↓
review
      ↓
Confirm memory
      ↓
confirmed=true
      ↓
local Nomic indexing
      ↓
eligible for My Story retrieval
```

Draft text is never searchable merely because it is saved.

### 7.1 First edit of confirmed text

The first modification of a confirmed answer immediately makes it unconfirmed in renderer state and immediately calls main rather than waiting for the normal debounce.

Main performs one transaction in this order:

1. load the currently owned confirmed answer;
2. if semantic Story state differs from the newest version, snapshot the **old confirmed Story before overwriting it**;
3. write the changed draft;
4. set `confirmed=0` and clear `confirmed_at`;
5. delete all chunks for that answer;
6. set `index_status='not_indexed'`.

Subsequent edits debounce normally. This prevents stale confirmed text from remaining searchable during editing and guarantees the prior confirmed wording is recoverable.

### 7.2 Confirmation and indexing

Nomic inference is never held inside a SQLite transaction.

Main first commits authoritative confirmation state:

1. validate field key, non-empty answer and language;
2. set `confirmed=1` and `confirmed_at`;
3. delete any old chunks;
4. set `index_status='pending'`.

After commit, `StoryIndexService` calls Nomic. Success atomically replaces that field's chunks and sets `ready`. Failure leaves the confirmed answer durable, with **no stale chunks**, and sets `failed`. The UI offers **Retry private indexing**.

There is no cloud fallback.

## 8. History and restore

Meaningful versions are considered:

- before the first edit of a confirmed memory;
- on explicit **Save now** when semantic Story differs from the newest version;
- immediately before restoring an older version when current semantic Story differs.

The semantic signature ignores active UI view/step, save state, and indexing status.

Snapshots contain all 16 answers plus language and confirmation metadata. Media and embeddings are not copied into versions.

Restore requires explicit confirmation. Main resolves `(versionId, localUserId)` from the protected session and then:

```text
validate owned version
→ snapshot current semantic Story if different
→ replace canonical answers transactionally
→ delete all current Story chunks
→ mark restored confirmed non-empty fields pending
→ commit
→ rebuild confirmed Story index
```

A database failure leaves the current Story unchanged. A post-commit indexing failure leaves restored text canonical and fails closed with no stale newer chunks.

Media remains attached to its field across text restores.

## 9. Story media

Supported photos: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`.  
Supported audio: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.webm`.

Validate extension/container plus file signature/container markers where practical; extension alone is never trusted.

Limits:

- photo: **25 MiB** per file;
- audio: **100 MiB** per file;
- maximum **8 selected files per add operation**.

Main owns the file picker and copies selected media into:

```text
<userData>/story/users/<localUserId>/media/<UUID>.<ext>
```

The database stores only a relative path. Renderer DTOs expose only `id`, `fieldKey`, `mediaType`, `fileName`, `mimeType`, `sizeBytes`, and timestamps.

New attachment flow copies first and inserts the active row only after copy success. Open/delete accept media IDs only and re-resolve ownership in main. Missing owned files are handled as retry-safe cleanup. Raw paths/errors never reach React.

Attaching audio never silently transcribes it. Attaching a photo never triggers OCR/image analysis.

## 10. Copy-safe legacy migration

The existing rebuild already copies `%APPDATA%/Family Circle/family.db` into rebuild-owned `userData/family.db` before additive migrations. The original database is never opened for migration writes.

My Story migration runs only on the rebuild-owned copy.

### 10.1 Answers

For each preserved local user ID:

1. Prefer valid `my_stories.story_json` as the most complete source.
2. Import only known fixed-schema keys.
3. Preserve explicit legacy `__confirmed` state.
4. If confirmation metadata predates the legacy record, treat non-empty answers as confirmed so previously searchable memories do not disappear after upgrade.
5. Preserve per-field `__languages`; otherwise fall back to matching `story_entries.language`, then `__language`, then `en`.
6. If `my_stories` is absent/damaged, reconstruct known fields from `story_entries` where available.
7. Unknown keys remain untouched in legacy source tables and are not silently promoted into the v1 schema.

### 10.2 History

Convert legacy `story_history` snapshots into `story_versions`, retain valid original timestamps, deduplicate semantic duplicates, and keep the newest 30.

### 10.3 Media

The legacy media root is derived from the known legacy app-data directory, never renderer input. A legacy path is eligible only when it resolves under that root, exists, belongs to a fixed Story field, and passes current type/size validation.

Each legacy row gets a stable opaque `legacy_source_key` derived from its legacy row identity plus normalized source metadata. Import uses a crash-safe reservation:

1. transactionally find/create a `story_media_items` row with a randomized destination path, `storage_status='copying'`, and unique `legacy_source_key`;
2. commit the reservation;
3. copy the original into the **same reserved destination**;
4. mark the row `active` after successful copy.

On restart, a `copying` reservation is retried to the same destination rather than allocating another file. Thus a crash cannot create repeated DB items or repeated destination paths.

Original media is copied, never moved or deleted. Missing/invalid/out-of-root legacy items are skipped and recorded as migration diagnostics; arbitrary source paths are never opened.

### 10.4 Idempotency

Answer/history upserts, semantic dedupe, unique legacy media keys, resumable media reservations, and `story_import_state` together make re-running migration idempotent. Original legacy database tables and files are never mutated.

## 11. My Story studio UX

`/stories` replaces the placeholder with four primary views:

```text
Guided | Chapters | Review | History
```

The hero frames My Story as a living private archive, not a questionnaire. Progress counts **confirmed memories** only, e.g. `9 of 16 memories confirmed`. Chapter cards show confirmed/total progress and navigate directly.

### Guided

One prompt at a time with chapter/position, prompt, hint, answer, language, deterministic follow-ups, confirmation/searchability state, media, record/transcribe, add-photo/audio, Previous, Confirm memory, and Next.

Required privacy copy distinguishes:

```text
Draft — review your words before making this memory searchable.
Confirmed — available to your private local AI.
```

### Chapters

All fields grouped by the six chapters for full-form editing. Editing a confirmed field uses the same immediate invalidation semantics as Guided.

### Review

Readable populated memories grouped by chapter, with search/filter, exact user text, confirmation state, attachments, and **Edit** jump-back. Review never fabricates or rewrites narrative prose.

### History

Newest-first semantic versions with timestamp, populated count, confirmed count, short preview, and **Restore**. Restore explains that the current Story is preserved first when materially different.

### Save state

```text
Saving…
Saved privately on this computer
Not saved yet — retry
```

**Save now** forces immediate draft persistence and adds a semantic version only when distinct from the latest version.

## 12. Offline voice transcription

The reference recorder produced mono 16 kHz PCM WAV and called a local `whisper.cpp` CLI with Whisper base. Recreate that behavior without bundling voice assets in the standard installer.

### 12.1 Recorder

Renderer `StoryVoiceRecorder` requests microphone access, captures mono speech and emits a **16 kHz PCM WAV byte payload**. No filesystem path crosses the renderer boundary. Recording states are `idle`, `recording`, `transcribing`, `success`, `error`; microphone tracks are always released when recording stops or errors.

### 12.2 Public boundary

Conceptually:

```ts
story.transcribeRecording({ wavBytes, language })
```

Renderer cannot choose executable/model/temp paths, flags, ports, or endpoints.

Main requires a protected session and validates non-empty WAV, **25 MiB** maximum, supported language, and a single-transcription busy guard.

### 12.3 Voice pack

The first distributable voice pack target is **Windows x64**, matching the current packaged product. Linux CI tests the service through injected/mock runners and manifests; it does not pretend a Linux voice binary ships in v1.

The optional pack contains verified `whisper.cpp` Windows x64 runtime + verified Whisper base model with expected size/SHA-256. It installs separately on first use using the existing verified-download security properties: resumable download, checksum verification, repair state, no secrets, and **no voice model/runtime in the NSIS installer**.

Voice readiness remains a distinct product capability from Granite/Nomic readiness even if low-level download/hash primitives are shared.

### 12.4 Execution

Main writes WAV bytes to a controlled temp path, invokes only the verified local runtime with bounded threads and a validated language hint, and enforces a **120-second timeout**. Temp audio is deleted in `finally` on success, failure, or timeout.

Only transcript text crosses back to React; stderr and runtime/model/temp paths do not.

Transcription inserts **draft** text and never auto-confirms.

There is no ElevenLabs or other network fallback.

## 13. Language contract

To faithfully recreate the reference first release, selectable Story/voice languages are exactly:

```text
en   English
afr? no
fr   French
es   Spanish
pt   Portuguese
zh   Simplified Chinese
ja   Japanese
fil  Filipino (Tagalog)
```

The literal `afr? no` line above is **not** a supported value; it documents that no additional language is implied. The actual supported codes are exactly `en`, `fr`, `es`, `pt`, `zh`, `ja`, `fil`.

Whisper language mapping is identity except `fil -> tl`, matching the reference. Unknown codes normalize/fail to the documented default `en` rather than invoking any network service.

Each answer stores one of these validated codes and passes it to local transcription as a hint.

## 14. Private AI integration

Reuse the existing Nomic + Granite runtime; do not create a second model server and do not pretend Story memories are Vault documents.

Private sources remain independent:

```text
Vault documents → vault_chunks
My Story       → story_chunks
                    ↓
             shared local ranking
                    ↓
             Nomic query embedding
                    ↓
                 Granite
```

Confirmed Story memory chunks include provenance such as:

```text
[[MY STORY | childhood | Life Story | Childhood and early memories]]
Chapter: Life Story
Memory: Childhood and early memories
Question: ...
Answer: <confirmed user text>
```

Only confirmed non-empty answers are eligible.

The `/ai` source selector becomes:

```text
My Story
Vault documents
My Story + Vault
```

One Nomic query embedding is created per question. Candidate chunks are loaded only for the authenticated local user from the selected repositories, scored with the existing cosine ranking, combined, capped, and passed to local Granite.

Story citations render as `My Story › <Chapter> › <Memory label>`; Vault citations remain document-based. No filesystem path, embedding, internal port, or meaningful local DB identity is exposed.

## 15. Main-process architecture

Expected units:

```text
StoryService
├── StoryRepository
├── StoryHistoryRepository
├── StoryMediaRepository
├── StoryMediaStore
├── StoryIndexService
├── StoryLegacyImporter
└── VoiceTranscriptionService

PrivateArchiveQueryService (or equivalent)
├── VaultChunkRepository
├── StoryChunkRepository
├── NomicClient
└── GraniteClient
```

Every operation derives the local user from the protected session. React never imports database, filesystem, process, or model code.

Reuse generic Vault/Private-AI primitives only when they are genuinely generic; do not couple Story ownership to Vault document IDs.

## 16. Narrow preload API

Conceptual Story surface:

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
story.onVoiceSetupProgress(listener)
```

Exact setup-progress naming should follow the existing private-AI client convention.

Public Story inputs must never contain `localUserId`, absolute/stored paths, embedding blobs, model/runtime paths, ports, API keys, Circle IDs, or shared-service user IDs. Numeric/string handles such as media/version IDs are always re-resolved for the authenticated user in main.

## 17. Error and recovery behavior

- Draft autosave failure keeps visible text and shows `Not saved yet`.
- First edit of confirmed content snapshots old semantic state and removes stale chunks before normal debounce.
- Embedding failure never loses a confirmed answer and never leaves stale chunks.
- Failed DB restore leaves current canonical Story unchanged.
- Successful restore followed by indexing failure keeps restored text and fails closed for search.
- Failed normal media copy creates no active DB item.
- Interrupted legacy media copy resumes through its reserved destination.
- Missing/corrupt voice assets show setup/repair guidance.
- Microphone denial is a normal recoverable UI state.
- Private AI absence never blocks Story capture/history/media; indexing remains pending/failed until local AI is ready.
- Public errors hide SQLite paths, media paths, model paths, process stderr, local AI ports, and secrets.

## 18. Security invariants

Merge-blocking tests must prove:

1. User A cannot read/save/confirm User B Story answers.
2. User A cannot list/restore User B versions.
3. User A cannot open/delete User B media.
4. Renderer cannot inject local ownership or filesystem/model/runtime paths.
5. Absolute legacy/current paths never cross preload.
6. Draft/unconfirmed answers never exist in `story_chunks`.
7. First edit of confirmed text removes stale chunks immediately.
8. Failed embedding leaves no old searchable chunks.
9. Restore cannot leave newer chunks searchable.
10. Stale/foreign media/version IDs are rejected before mutation.
11. Media traversal/out-of-root paths are rejected.
12. Legacy importer reads media only from the known legacy Story root.
13. Legacy import is idempotent across restart/crash.
14. Legacy database/files are never mutated.
15. Story content never reaches `LegacyCircleAuthAdapter`.
16. Voice cannot select arbitrary executable/model/flags/paths.
17. Voice has no network fallback.
18. Temp voice files are removed on success/failure/timeout.
19. Attachments are never silently transcribed, OCR'd, or indexed.
20. Public errors leak no sensitive internals.

## 19. Accessibility

Required coverage:

- four view controls expose selected state;
- draft/confirmed/index status is textual, not color-only;
- chapter progress has accessible names;
- Previous/Next focus behavior is deterministic;
- Confirm memory communicates its searchability effect;
- recording/transcription state uses an appropriate live region;
- media buttons include filename/type in accessible names;
- restore confirmation follows the app's accessible-dialog/focus-return pattern;
- errors use accessible alert/status semantics;
- no core action depends on hover alone.

## 20. Testing strategy

### Database/migration
Fresh schema, additive upgrade, legacy tables absent/present/damaged, answer fallback, confirmation/language preservation, semantic history dedupe/cap, media reservation restart, idempotency, FK cleanup, original-source immutability.

### Story service/repositories
Ownership, draft autosave, first-edit invalidation/versioning, confirm/retry, meaningful versioning, restore, index transitions, stale/foreign handles, safe errors.

### Media
Signatures, extension mismatch, size limits, eight-file cap, randomized storage, traversal defense, ownership, open/delete, missing files, legacy-root enforcement, crash-safe copy reservation.

### Voice
WAV validation, 25 MiB cap, reference language mapping, busy guard, verified command construction, timeout, cleanup, missing/corrupt assets, safe stderr handling, and proof that no network fallback is invoked.

### Retrieval
Confirmed-only indexing, stale-chunk deletion, atomic per-field replacement, failure status, restore rebuild, user ownership, Story/Vault/all scopes, combined ranking, one query embedding, citations, and no query-time re-embedding of every Story answer.

### IPC/preload/client
Exact channels/payloads, field-by-field reconstruction, identity/path stripping, dedicated Story client only, no Story internals in renderer contract.

### UI/accessibility
New/empty Story, all four modes, 16 memories/six chapters, confirmed progress, follow-ups, save states, confirmation/index retry, Review editing, History restore, attachments, recorder states, safe errors, keyboard/screen-reader behavior.

### Architecture/security
Add a merge-blocking Story security suite and extend architecture scanning so Story private internals cannot leak into renderer/shared-Circle code.

Final gate:

```text
npm ci
npm run check
npm audit --audit-level=high
```

Then require exact-head Linux CI and the complete Windows NSIS/package-verification chain.

## 21. Implementation sequencing

The implementation plan must preserve these dependencies:

1. schema and legacy-migration foundations;
2. owned Story repositories/service;
3. draft, confirmation and history semantics;
4. Story indexing and stale-chunk guarantees;
5. private media store/service;
6. optional verified voice pack + transcription service;
7. Story IPC/preload/renderer client;
8. My Story studio UI;
9. generalized Story/Vault private retrieval;
10. security/accessibility/docs/final exact-head review.

Every behavior-changing task uses real RED → GREEN TDD and focused commits.

## 22. Interaction with Family Tree PR

This design branch intentionally starts from current `main`, not the unmerged Family Tree branch. My Story has no data/runtime dependency on Family Tree.

Before implementation begins, if Family Tree has merged, update/rebase `feature/my-story` onto the new `main`. Route work must preserve the real `/family-tree` route while replacing only the `/stories` placeholder.

Because the Family Tree branch currently also contains the nodemailer security bump that makes high-severity audit green, the implementation baseline must re-check dependency audit after updating from the latest `main`; do not assume this older base remains release-clean.

## 23. Acceptance criteria

My Story is complete only when:

- `/stories` is a real four-view memory studio;
- all 16 reference memories and six chapters are present;
- drafts survive restart without becoming searchable;
- confirmation explicitly controls searchability;
- editing confirmed text snapshots prior state and immediately removes stale chunks;
- meaningful history/restore works with a 30-version cap;
- photo/audio media is private, owned, validated and path-safe;
- optional Windows-x64 Whisper voice setup/transcription works locally with no cloud fallback;
- transcripts remain drafts until explicit confirmation;
- exact reference language options are available;
- My Story, Vault and combined private-AI scopes work with readable citations;
- legacy answers/history/media migrate copy-safely and idempotently;
- Story data never crosses the Circle compatibility boundary;
- security/accessibility suites pass;
- `npm run check` and high-severity audit are green;
- exact feature head passes Linux CI and full Windows installer/package verification.
