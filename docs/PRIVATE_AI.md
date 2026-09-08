# Private AI + Vault RAG

Family Circle's Private AI is an **optional, user-triggered local capability** layered on top of the private Vault. PDF, DOCX, and TXT upload/storage/extraction work without AI. Installing or repairing Private AI is never required to keep using the Vault.

The Private AI path is owned by the Electron main process. React receives only safe setup progress, index status, answers, and short source excerpts. Model paths, local endpoints, process details, embeddings, full extracted text, stored paths, hashes, and local user IDs never cross the desktop boundary.

## Runtime contract

Private AI uses the manifest in `config/offline-ai-manifest.json`. The current manifest version is `1.0.0` and requires three verified assets:

| Friendly name | Asset | Expected bytes | Expected SHA-256 |
| --- | --- | ---: | --- |
| AI engine | llama.cpp b8772 Windows CPU x64 runtime ZIP | 39,870,081 | `1C18C414B86E8F84D61D003F8605159ACF97492EEECF6891B2D879AF4A0DBFD2` |
| AI knowledge | IBM Granite 4.0 H Micro Q4_K_M GGUF | 1,942,564,512 | `BCC78B9B25450101D1AD90D4B9A264E1BAC892F534DFB76066F4EEC792FDF023` |
| AI search | Nomic Embed Text v1.5 Q4_K_M GGUF | 84,106,624 | `D4E388894E09CF3816E8B0896D81D265B55E7A9FFF9AB03FE8BF4EF5E11295AC` |

The combined required transfer is 2,066,541,217 bytes (about 1.93 GiB). The URLs and technical asset metadata are main-process/developer configuration, not renderer data.

### Local layout

All AI assets are stored beneath Electron's `app.getPath('userData')` directory:

```text
<userData>/offline-ai/
├── installed-version.json
├── bin/
│   └── llama-b8772-bin-win-cpu-x64/
│       └── llama-server.exe
├── models/
│   ├── granite-4.0-h-micro-Q4_K_M.gguf
│   └── nomic-embed-text-v1.5.Q4_K_M.gguf
└── .staging/
    └── 1.0.0/
        └── ... resumable .part downloads ...
```

The version marker is written only after every required asset verifies. Model files must match both the immutable expected byte size and SHA-256. The llama.cpp ZIP is verified before extraction and `llama-server.exe` must exist in the extracted target before the runtime can be considered installed.

Partial `.part` files are not considered installed. Setup can pause and resume using HTTP Range requests. If a server ignores a resume request, the downloader restarts that file safely rather than appending incompatible bytes.

## Seven setup states

The public setup state is exactly one of:

```text
not_installed
downloading
paused
verifying
ready
repair_required
failed
```

`ready` means the current manifest version is marked installed and all required assets still verify. A marker/version mismatch or invalid required asset becomes `repair_required`.

Setup and repair are explicit user actions:

- App startup does **not** download models.
- Vault upload does **not** trigger setup.
- `Start setup` downloads/verifies the configured assets.
- `Pause` preserves valid partial bytes.
- Continue resumes the staged transfer.
- `Repair` removes the installed marker and re-runs verified setup.

No setup state disables Vault upload or local extraction.

## Lazy llama.cpp lifecycle

`AiRuntimeManager` starts no AI process at construction or normal app startup. It owns two independent llama.cpp server lifecycles:

```text
Nomic embedding runtime    developer-only port 8081
Granite generation runtime developer-only port 8080
```

These ports and endpoints are internal implementation details. They must never appear in the public desktop contract or production renderer code.

### Indexing lifecycle

Indexing starts/reuses **Nomic only**:

```text
owned extraction-ready document
  -> deterministic chunks
  -> Nomic document embeddings
  -> atomic SQLite chunk/vector replacement
  -> document index_status = indexed
```

The exact document prefix is:

```text
search_document: <chunk text>
```

Index version is currently:

```text
INDEX_VERSION = 1
```

Chunking version 1 uses a maximum of 1000 characters with 150-character overlap. Existing document chunks are embedded once per index operation and persisted. Upload returns before background indexing finishes; if AI is not ready the successful extraction simply remains `waiting_for_ai`.

### Question lifecycle

`Ask your Vault` uses persisted chunks rather than re-reading or re-embedding every document:

```text
protected local user + question + scope
  -> validate selected document IDs, if any
  -> start/reuse Nomic
  -> one query embedding
  -> load this user's persisted chunks
  -> in-process cosine similarity
  -> top five retrieved chunks
  -> start/reuse Granite only when context exists
  -> grounded local answer + safe source excerpts
```

The exact query prefix is:

```text
search_query: <question>
```

Scope v1 is either all indexed Vault documents or an explicit list of numeric Vault document IDs. Every selected ID is validated against the protected restored local user before retrieval.

If no usable indexed context is found, the query path returns a safe local not-found answer and does not need to start Granite.

## Vector persistence

`vault_documents` remains the source of truth for ownership and extraction state. Persistent RAG chunks are stored in `vault_chunks`:

```text
vault_chunks
  document_id
  chunk_index
  text
  embedding_blob
  embedding_model
  index_version
  created_at
  updated_at
```

Embeddings are serialized as exact-range Float32 bytes in SQLite BLOBs and decoded only inside the main process. The chunk table deliberately has no duplicate `local_user_id`; ownership is enforced by joining through `vault_documents.local_user_id`.

Replacing a document index is transactional: old chunks are deleted, all new chunks are inserted, and the document is marked indexed in one transaction. A failed replacement rolls back instead of leaving a partial index.

Deleting a Vault document cascades its stored chunks.

## Privacy and trust boundaries

Private AI/Vault content has no Circle-content path and no cloud fallback.

The renderer must never receive or directly use:

```text
storedRelativePath
sourcePath
absolutePath
sha256
extractedText
localUserId
embeddingBlob
Float32Array
modelPath
graniteModel
nomicModel
llama-server.exe
AI runtime ports/endpoints
AI child-process/PID details
```

Production renderer access is intentionally narrow:

- `window.familyCircle.vault` is accessed only by `DesktopVaultClient`.
- `window.familyCircle.privateAi` is accessed only by `DesktopPrivateAiClient`.
- Feature components use those typed clients instead of `fetch()` or direct localhost calls.

The query service derives the local user from the protected desktop session. Renderer-supplied identity is not accepted. SQLite chunk retrieval also filters by that local user, so guessed document IDs and cross-user chunks are not queryable.

Granite receives only the retrieved local Vault context needed for the current question. The RAG path does not send document content to Jose's Circle compatibility adapter or to an external AI service.

## Shutdown

The main process owns every llama.cpp child it starts. Application shutdown stops the managed embedding and generation processes before database close. Family Circle does not attach to or kill unrelated system processes.

## Manual Windows clean-machine acceptance test

Run this sequence on a clean Windows machine before release. Use small known-answer documents so source grounding is easy to inspect.

1. **Clean state** — confirm there is no existing `<userData>/offline-ai` installation.
2. **Vault before AI** — sign in, upload PDF/DOCX/TXT content, confirm local extraction and normal Vault actions work before setup.
3. **Explicit setup** — click the Private AI setup action; confirm no download began before that user action.
4. **Pause/resume** — pause during transfer, confirm partial bytes remain, continue, and confirm transfer resumes rather than restarting valid partial content unnecessarily.
5. **Verified ready** — confirm setup reaches `ready` only after all required assets pass configured size/SHA verification and the runtime executable exists.
6. **Persistent indexing** — confirm Nomic indexes extraction-ready documents and their UI state becomes **Ready to ask** without re-uploading them.
7. **Known-answer RAG** — ask a question whose answer exists in the test document; confirm the answer is grounded and the displayed source filename/excerpt is correct.
8. **Offline question** — disconnect the machine from the internet and ask the known-answer question again; confirm the local indexed Q&A still works.
9. **User isolation** — sign out/switch to another local account; confirm the other account cannot list, select, retrieve, or receive source excerpts from the first user's Vault documents.
10. **Lifecycle cleanup** — exit Family Circle and confirm the managed llama.cpp processes stop.

Also verify failure paths: corrupt a required asset and confirm `repair_required`; retry an indexing failure without re-uploading; ask with a selected document ID from another account and confirm a safe not-found/authorization-neutral result.

## CI contract

CI must never download or start the real ~2 GiB AI stack. Downloader, runtime, model-server, and health behavior is exercised with injected fakes/ports plus SQLite-backed security tests.

The merge gate is:

```bash
npm run check
npm audit --audit-level=high
```

`npm run check` covers TypeScript, Vitest, architectural boundary verification, and Electron/renderer production builds. `VaultRagSecurity.test.ts` adds merge-blocking regressions for cross-user isolation, no cloud/Circle path, no query-time document re-embedding, explicit-only downloads, Nomic-only indexing, lazy runtime construction, and AI-independent upload/extraction.
