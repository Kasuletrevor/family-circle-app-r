# Vault + Private AI Design

**Date:** 2026-09-04  
**Status:** Approved design  
**Branch:** `feature/vault-private-ai`  
**Base:** `main` at `182ecb430054f65e269558df779317e34cf0e015`

## Goal

Build a private local Vault that is useful immediately, even before Private AI is installed, then add persistent local semantic indexing and Granite-powered question answering without changing the Vault storage model.

The agreed product rule is:

> Upload/storage/extraction are core Vault capabilities. Private AI is an optional enhancement layer for semantic indexing and question answering.

The initial document formats are **PDF, DOCX, and TXT** only.

## Scope

### Included

- Real `/vault` page.
- Multi-file local upload for PDF/DOCX/TXT.
- Private per-local-user file storage under the application data directory.
- SHA-256 duplicate detection.
- Local text extraction independent of AI readiness.
- Local document metadata and extracted text in SQLite.
- Document list with truthful extraction/indexing status.
- Open document through a main-process document ID lookup.
- Delete document with confirmation and full local cleanup.
- Retry failed extraction.
- Private AI seven-state setup model.
- Progressive download/verification/repair of llama.cpp + Granite + Nomic assets.
- Persistent chunking and Nomic embeddings.
- Automatic/background indexing when AI becomes ready.
- Retry failed indexing.
- Local Vault Q&A across all documents or a selected set.
- Granite answers grounded only in retrieved Vault chunks.
- Safe source citations returned to the renderer.
- Lazy local AI runtime startup.

### Excluded from this feature

- Images/OCR.
- Audio/Whisper ingestion.
- Cloud document upload or cloud-model fallback.
- Sharing Vault files with Circles.
- My Story as a RAG source.
- Family Tree as a RAG source.
- A dedicated external vector database.
- Remote sync/backup of Vault data.
- Document editing/version merging.

## Product boundaries

The application keeps two independent privacy domains:

```text
Shared Circle data -> Jose's shared Circle API
Private Vault data -> local Windows machine only
```

Vault ownership is by the authenticated **local user**, not by the active Circle. Switching active Circles never changes the user's Vault.

No document bytes, extracted text, chunks, embeddings, prompts, or answers are sent to Jose's Circle API.

## Architecture

```text
Renderer
  |
  | safe business DTOs only
  v
Typed preload API
  |
  v
Electron main
  |
  +-- VaultService
  |    +-- VaultRepository -> SQLite
  |    +-- VaultFileStore -> private AppData files
  |    +-- DocumentExtractor -> PDF/DOCX/TXT
  |
  +-- OfflineAiService
  |    +-- asset manifest/download/verify/repair
  |    +-- embedding runtime (Nomic)
  |    +-- generation runtime (Granite)
  |
  +-- VaultIndexService
  |    +-- chunk extracted text
  |    +-- Nomic embeddings
  |    +-- persist Float32 vectors
  |
  +-- VaultQueryService
       +-- embed question
       +-- local similarity search
       +-- retrieve top chunks
       +-- Granite grounded answer
```

React never receives arbitrary source-file paths, SQLite paths, model paths, embedding vectors, localhost model endpoints, or process IDs.

## Local storage layout

Use Electron's application data directory as the root. Conceptually on Windows:

```text
%APPDATA%/Family Circle/
  family.db
  vault/
    users/
      <local-user-id>/
        documents/
          <generated-storage-name>.pdf
          <generated-storage-name>.docx
          <generated-storage-name>.txt
  offline-ai/
    bin/
      llama-.../
        llama-server.exe
        *.dll
    models/
      granite-4.0-h-micro-Q4_K_M.gguf
      nomic-embed-text-v1.5.Q4_K_M.gguf
```

Database rows store a safe relative storage path. Renderer-facing DTOs never expose that path.

## Document data model

### `vault_documents`

Conceptual fields:

```text
id
local_user_id
file_name
file_type
mime_type
size_bytes
sha256
stored_relative_path
extraction_status
index_status
word_count
preview
extracted_text
last_error_code
uploaded_at
updated_at
```

`extraction_status`:

```text
pending
extracting
ready
failed
```

`index_status`:

```text
not_indexed
waiting_for_ai
indexing
indexed
failed
```

A missing AI package is **not** an error. A successfully extracted document becomes `waiting_for_ai` when AI is unavailable.

### `vault_chunks`

Conceptual fields:

```text
id
document_id
chunk_index
text
embedding_blob
embedding_model
index_version
created_at
updated_at
```

Embeddings are persisted as compact Float32 BLOB data, not JSON. Embeddings and chunks can be deleted/rebuilt without touching the source file or document row.

## Upload and ingestion

Renderer starts upload through a narrow desktop capability. The main process owns file selection or receives an Electron-safe selected-file handle; React must never be trusted with arbitrary storage destinations.

Recommended public operations:

```ts
vault.listDocuments()
vault.chooseAndUploadDocuments()
vault.openDocument({ documentId })
vault.retryExtraction({ documentId })
vault.deleteDocument({ documentId })
```

Upload flow for each selected file:

```text
validate extension/type
  -> validate file size/safety
  -> SHA-256
  -> reject exact-byte duplicate for this local user
  -> copy into private Vault storage
  -> create/update document row
  -> extract text locally
  -> update word count + preview
  -> if AI ready: queue indexing
     else: waiting_for_ai
```

The first implementation uses a configurable per-document size safety limit. The initial default should be conservative enough for in-memory PDF/DOCX extraction and exposed as a stable business error, not a raw filesystem/parser exception.

## Duplicate behavior

Duplicate identity is `(local_user_id, sha256)`.

- Same bytes uploaded again: do not make a second copy; return a stable `already-exists` result.
- Same filename but different bytes: keep both documents.
- Display-name collision is resolved locally, e.g. `Family History.pdf`, `Family History (2).pdf`.

Do **not** reproduce the legacy behavior of replacing the previous same-name document.

## Extraction

Initial extractors:

- PDF: local PDF parser.
- DOCX: Mammoth/raw-text extraction.
- TXT: UTF-8 text.

Extraction occurs without Granite or Nomic. A parser failure does not delete the stored file.

Failure state:

```text
Stored, but text could not be extracted
[Retry extraction]
```

Retry must re-resolve ownership and source path in main.

## Vault UI

`/vault` becomes a real page.

Header:

```text
Vault                                  [Upload documents]
Your private documents stay on this computer.
```

Each document card/row shows:

```text
file name
file type + size + word count when available
extraction/index state
Open
Delete
Retry extraction/indexing when applicable
```

Examples of truthful AI state copy:

```text
Ready for Private AI
Indexing...
Ready to ask
AI indexing failed
```

Uploading supports multiple PDF/DOCX/TXT files in one picker operation. Files progress independently; one failure does not roll back unrelated successful files.

## Open and delete security

Renderer sends only a safe document ID.

```ts
vault.openDocument({ documentId })
vault.deleteDocument({ documentId })
```

Main restores the protected local session, loads the row scoped to that local user, resolves the private path, then performs the operation.

Delete removes, in a controlled sequence/transaction where appropriate:

- chunk rows/embedding data;
- document DB row;
- source file.

If filesystem cleanup partially fails, return a stable recoverable error and preserve enough metadata to retry rather than silently orphaning private data.

## Private AI state model

Reuse the seven-state model:

```text
not_installed
downloading
paused
verifying
ready
repair_required
failed
```

Private AI is optional. Vault upload remains enabled in every AI state.

User-facing setup copy must be non-technical. Terms such as GGUF, llama.cpp, model filenames, ports, and local endpoints stay in developer logs/docs.

## Private AI assets

Preserve Jose's proven local architecture:

- llama.cpp Windows runtime;
- IBM Granite 4.0 H Micro Q4 GGUF for generation;
- Nomic Embed Text v1.5 Q4 GGUF for embeddings.

Small installer mode downloads verified assets later into AppData. A future/full-offline installer may bundle the same verified assets.

The manifest must provide immutable expected metadata such as target path, size, SHA-256, required/optional status, and extraction information. Download to staging/temp, support resume where feasible, verify before promotion, and never treat an unverified partial file as ready.

## Runtime process model

Do not start both AI servers merely because the desktop app launched.

Split runtime ownership conceptually:

```ts
ensureEmbeddingRuntime()
ensureGenerationRuntime()
```

- Indexing requires Nomic only.
- Question answering requires Nomic for the query vector and Granite for generation.

Processes are main-process owned, health-checked, hidden from the renderer, and cleanly stopped on app shutdown. Idle shutdown may be added once core behavior is stable.

## Indexing

Indexing is independent of upload.

```text
extracted document
  -> deterministic chunking
  -> Nomic document embeddings
  -> persist chunks + Float32 vectors
  -> mark indexed
```

Chunking must be deterministic and versioned. Store `embedding_model` and `index_version` so a future model/chunking change can mark documents stale and reindex without touching source files.

Nomic task prefixes remain explicit:

```text
search_document: <chunk>
search_query: <question>
```

When Private AI transitions to `ready`, the index service scans the authenticated user's documents whose extracted text is ready and index status is not current, then indexes them in the background. No re-upload is required.

Index failure does not affect source/extraction health and can be retried.

## Query/retrieval

Public operation conceptually:

```ts
vault.ask({
  question,
  scope: { type: 'all' }
})
```

or selected documents:

```ts
vault.ask({
  question,
  scope: { type: 'documents', documentIds: [...] }
})
```

Main validates every selected document belongs to the protected local user.

Query flow:

```text
question
  -> ensure Nomic runtime
  -> Nomic query embedding
  -> cosine similarity against persisted chunk vectors
  -> top K chunks (initially around 4-6)
  -> ensure Granite runtime
  -> grounded prompt with retrieved context only
  -> answer + safe source metadata
```

Unlike the old prototype, stored chunks are **not re-embedded on every question**.

SQLite + in-process cosine similarity is sufficient for the initial personal-Vault scale. Do not introduce FAISS/LanceDB/vector-server infrastructure until real scale measurements justify it.

## Q&A renderer contract

Renderer receives only safe answer/source data:

```ts
{
  answer: string,
  sources: [
    {
      documentId: string,
      fileName: string,
      excerpt: string,
      score?: number
    }
  ]
}
```

Do not expose stored paths, vectors, localhost ports/URLs, process identifiers, or raw model responses/errors.

## Q&A UX

Initial query scope options:

- All Vault documents.
- Selected Vault documents.

Do not add legacy `latest/current/story/combined` scope modes in this slice.

The query page/composer must communicate:

- AI setup required when not installed;
- documents may already be safely stored while setup occurs;
- indexing progress when documents are not yet searchable;
- grounded-answer sources after a successful question.

If no indexed content is available, do not start Granite and hallucinate an answer. Return a stable `no-searchable-content` result.

## Error and recovery model

Renderer displays stable business outcomes only. Internal parser, SQLite, filesystem, HTTP/local-runtime, model, and stack-trace details remain in main-process logs.

Examples:

```text
Unsupported file type.
This document is already in your Vault.
This document could not be extracted. Try again.
Private AI is not installed yet.
This document could not be indexed. Try again.
No searchable information was found in the selected documents.
Private AI could not start. Repair or retry setup.
```

## Security invariants

- Protected local session is restored in main for every Vault read/write/query.
- Renderer never supplies `localUserId`.
- Renderer never chooses destination paths.
- Renderer never receives storage/model/SQLite paths.
- Renderer never talks directly to localhost AI ports.
- File open/delete/retry is scoped by `(documentId, localUserId)` in main.
- Selected query document IDs are revalidated in main.
- Documents/text/chunks/embeddings/prompts/answers are never sent to the Circle service.
- No cloud LLM fallback in this feature.
- Raw model/parser/filesystem errors never cross the public desktop contract.

## Delivery sequence

The architecture is intentionally separable into three executable milestones while remaining one coherent feature design.

### Milestone 1 — Real Vault

- migrations/repository;
- safe local file store;
- PDF/DOCX/TXT extraction;
- multi-file upload;
- list/open/delete/retry extraction;
- real `/vault` UI;
- visible AI/index readiness state without embeddings.

### Milestone 2 — Private AI + persistent indexing

- manifest/setup state;
- download/verify/repair;
- split Nomic/Granite runtime lifecycle;
- deterministic chunking;
- persisted Float32 embeddings;
- background/retry indexing.

### Milestone 3 — Local Vault Q&A

- all/selected-document scope;
- query embedding;
- local similarity retrieval;
- grounded Granite generation;
- safe source excerpts;
- real `/ai` or Vault query experience.

The intent is to implement these milestones back-to-back, not pause for unrelated Circle features.

## Test requirements

At minimum, TDD coverage must include:

### Persistence/file store

- migrations are copy-safe;
- rows are local-user scoped;
- stored paths never enter public DTOs;
- duplicate SHA behavior;
- same-name/different-content behavior;
- delete cleanup and partial-failure handling.

### Extraction

- PDF/DOCX/TXT successful extraction fixtures;
- unsupported type rejection;
- extraction failure preserves stored file;
- retry works;
- AI absence never blocks extraction.

### IPC/preload/boundaries

- business payloads only;
- malicious `localUserId`, arbitrary path, model path/endpoint fields cannot affect main operations;
- no renderer filesystem/network/model-runtime access.

### Offline AI

- seven-state normalization;
- verified asset promotion only;
- interrupted/resumed setup;
- repair state;
- embedding runtime can start without generation runtime.

### Indexing

- deterministic chunks;
- persisted vectors;
- waiting-for-AI -> indexing -> indexed transition;
- retry failed index;
- model/index-version stale reindex behavior;
- no re-embedding of unchanged chunks at query time.

### Query

- protected local-user scoping;
- selected document validation;
- top-K retrieval from persisted vectors;
- grounded prompt only;
- no-content short circuit;
- safe answer/source DTOs;
- Granite/Nomic internal endpoints never cross preload/public contracts.

### Renderer

- Vault empty/list/upload/progress/duplicate/error states;
- open/delete confirmations;
- extraction/index retry states;
- Private AI setup messaging does not block upload;
- all/selected question scope;
- source rendering;
- no searchable content/AI unavailable states.

## Verification gate

Before merge:

```text
npm ci
npm run typecheck
npm run test
npm run verify:boundaries
npm run build:electron
npm run build:renderer
npm audit --audit-level=high
```

Also add targeted smoke/integration coverage for a local test document flowing through:

```text
upload -> extraction -> chunk/index (mock/local runtime) -> query -> grounded source result
```

Real large model binaries must never be committed to Git.
