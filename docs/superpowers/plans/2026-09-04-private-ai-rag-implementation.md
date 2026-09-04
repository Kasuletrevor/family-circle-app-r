# Private AI + Vault RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-triggered verified Private AI setup, persistent Nomic indexing and local Granite question answering on top of the already-shipped private Vault without re-uploading documents or re-embedding document chunks on every question.

**Architecture:** Electron main owns a seven-state Private AI installer, lazy llama.cpp runtime processes, chunk/vector persistence, indexing and grounded retrieval/generation. The existing Vault document rows remain the source of truth; extracted text is chunked and embedded once into SQLite Float32 BLOB vectors. Renderer uses narrow typed `privateAi` and `vault` APIs and receives only setup status, document/index status, answers and safe source excerpts.

**Tech Stack:** Electron 44.1.1, TypeScript 7.0.2, Node 24, `node:sqlite`, `node:child_process`, `node:http`/`node:https`, llama.cpp b8772 Windows x64 runtime, IBM Granite 4.0 H Micro Q4_K_M GGUF, Nomic Embed Text v1.5 Q4_K_M GGUF, React 19.2.7, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-09-04-vault-private-ai-design.md`

**Prerequisite:** `docs/superpowers/plans/2026-09-04-vault-foundation-implementation.md` has been implemented and merged. The repository therefore already has `vault_documents`, `VaultRepository`, protected `VaultService`, real `/vault`, and document rows whose successful extraction has `index_status='waiting_for_ai'`.

## Global Constraints

- Private AI setup is always **user-triggered**; never auto-download ~2 GB of assets at app start.
- Upload/storage/extraction remain enabled in every Private AI state.
- Reuse Jose's verified asset identities exactly unless an explicit future upgrade changes the manifest/version and hashes together.
- Private AI states are exactly: `not_installed`, `downloading`, `paused`, `verifying`, `ready`, `repair_required`, `failed`.
- Install/download assets only under the Electron application-data directory; never the renderer-visible filesystem.
- Partial downloads are never considered ready. Verify expected size and SHA-256 before promotion.
- Indexing uses **Nomic only** and starts its runtime lazily.
- Q&A uses Nomic for the query embedding and Granite for generation; both start lazily.
- Document chunks are embedded once and persisted. Asking a question must never re-embed all document chunks.
- Nomic prefixes are exact: `search_document: ` for stored chunks and `search_query: ` for the user question.
- Initial persistent retrieval uses SQLite + in-process cosine similarity; no Qdrant/FAISS/LanceDB/vector server.
- Query scope v1 is only `all` or an explicit set of Vault document IDs.
- Every selected document ID is revalidated against the protected local user in main.
- Granite is instructed to answer from retrieved Vault context only. No cloud fallback.
- Renderer never receives model paths, localhost model URLs, process IDs, embeddings, extracted full text or stored paths.
- CI tests must fake downloader/runtime/model clients and must not download models or start real llama.cpp.

---

### Task 1: Private AI manifest, seven-state asset service and resumable verified setup

**Files:**
- Create: `config/offline-ai-manifest.json`
- Create: `src/main/ai/privateAiModels.ts`
- Create: `src/main/ai/OfflineAiAssetService.ts`
- Create: `src/main/ai/OfflineAiAssetService.test.ts`
- Create: `src/main/ai/OfflineAiDownloader.ts`
- Create: `src/main/ai/OfflineAiDownloader.test.ts`

**Interfaces:**
- Consumes: Electron `userDataPath` injected from main.
- Produces:
  - `PrivateAiState`
  - `PrivateAiStatusInternal`
  - `PrivateAiProgress`
  - `OfflineAiAssetService.getStatus()`
  - `OfflineAiAssetService.startSetup(onProgress)`
  - `OfflineAiAssetService.pauseSetup()`
  - `OfflineAiAssetService.repair(onProgress)`
  - verified installed paths for later runtime startup.

- [ ] **Step 1: Add the exact verified asset manifest**

Create `config/offline-ai-manifest.json` with:

```json
{
  "version": "1.0.0",
  "files": [
    {
      "name": "AI engine",
      "type": "runtime",
      "url": "https://github.com/ggml-org/llama.cpp/releases/download/b8772/llama-b8772-bin-win-cpu-x64.zip",
      "targetPath": "bin/llama-b8772-bin-win-cpu-x64",
      "sha256": "1C18C414B86E8F84D61D003F8605159ACF97492EEECF6891B2D879AF4A0DBFD2",
      "sizeBytes": 39870081,
      "extract": true,
      "required": true
    },
    {
      "name": "AI knowledge",
      "type": "model",
      "url": "https://huggingface.co/ibm-granite/granite-4.0-h-micro-GGUF/resolve/main/granite-4.0-h-micro-Q4_K_M.gguf?download=true",
      "targetPath": "models/granite-4.0-h-micro-Q4_K_M.gguf",
      "sha256": "BCC78B9B25450101D1AD90D4B9A264E1BAC892F534DFB76066F4EEC792FDF023",
      "sizeBytes": 1942564512,
      "extract": false,
      "required": true
    },
    {
      "name": "AI search",
      "type": "embedding",
      "url": "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf?download=true",
      "targetPath": "models/nomic-embed-text-v1.5.Q4_K_M.gguf",
      "sha256": "D4E388894E09CF3816E8B0896D81D265B55E7A9FFF9AB03FE8BF4EF5E11295AC",
      "sizeBytes": 84106624,
      "extract": false,
      "required": true
    }
  ]
}
```

Do not rename target files independently of manifest/version/hash changes.

- [ ] **Step 2: Write failing seven-state/status tests**

Create `privateAiModels.ts` with the expected public/internal enums referenced by tests:

```ts
export type PrivateAiState =
  | 'not_installed'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'repair_required'
  | 'failed'
```

Tests must cover:

```ts
it('reports not_installed when required assets are absent')
it('reports repair_required when an installed-version marker exists but an asset is missing or invalid')
it('reports ready only when every required asset and installed version verify')
it('never treats a .part file as installed')
it('reports the manifest total download size')
```

Run:

```bash
npm test -- src/main/ai/OfflineAiAssetService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement installed asset resolution and verification**

Root:

```ts
join(userDataPath, 'offline-ai')
```

Installed marker:

```text
offline-ai/installed-version.json
```

The asset service validates required file/directory presence. For non-extracted files it validates exact `sizeBytes` and SHA-256. For the extracted runtime it validates the downloaded archive before extraction, then verifies `llama-server.exe` exists in the target directory before writing the installed-version marker.

Expose absolute paths only through an internal return type:

```ts
export interface InstalledAiPaths {
  root: string
  llamaDir: string
  serverExe: string
  graniteModel: string
  nomicModel: string
}
```

This type must never be imported into shared/renderer code.

- [ ] **Step 4: Write failing downloader tests for resume/pause/verify/promotion**

Inject HTTP and filesystem ports so tests use byte buffers, not internet.

Cover:

```ts
it('continues a partial download using Range bytes=<existing>-')
it('restarts cleanly when the server does not honor resume')
it('emits aggregate and per-file progress')
it('pauses without deleting a valid partial file')
it('rejects a completed file whose size differs')
it('rejects a completed file whose SHA-256 differs')
it('promotes only a verified completed file')
it('extracts the verified runtime archive only after hash verification')
```

- [ ] **Step 5: Implement setup/downloader with Windows runtime extraction**

Download into:

```text
<userData>/offline-ai/.staging/<version>/...
```

Use `.part` files and HTTP Range requests. Progress DTO:

```ts
export interface PrivateAiProgress {
  state: PrivateAiState
  phase: 'downloading' | 'verifying' | 'extracting'
  percent: number | null
  filePercent: number | null
  fileIndex: number | null
  totalFiles: number
  fileName: string | null
  totalSizeBytes: number
  downloadedBytes: number
  bytesPerSecond: number | null
  remainingSeconds: number | null
  message: string
}
```

On Windows, extract the verified llama.cpp ZIP with a child process using PowerShell `Expand-Archive`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '<zip>' -DestinationPath '<dir>' -Force"
```

Pass the command as child-process arguments; do not invoke through a renderer shell or interpolate renderer-provided paths.

Only after every required asset verifies and runtime extraction succeeds:

```text
promote staging files -> offline-ai target paths
write installed-version.json atomically
state = ready
```

Pause aborts the active request/process but preserves `.part` files. `repair()` reuses any verified existing asset and downloads only missing/invalid ones.

- [ ] **Step 6: Verify Task 1 green and commit**

```bash
npm test -- src/main/ai/OfflineAiAssetService.test.ts src/main/ai/OfflineAiDownloader.test.ts
npm run typecheck
```

Expected: PASS without network access.

```bash
git add config/offline-ai-manifest.json src/main/ai
git commit -m "feat: add verified Private AI setup service"
```

---

### Task 2: Lazy split llama.cpp runtime manager

**Files:**
- Create: `src/main/ai/AiRuntimeManager.ts`
- Create: `src/main/ai/AiRuntimeManager.test.ts`

**Interfaces:**
- Consumes: `OfflineAiAssetService.getInstalledPaths()` from Task 1.
- Produces:
  - `ensureEmbeddingRuntime(): Promise<boolean>`
  - `ensureGenerationRuntime(): Promise<boolean>`
  - `stopAll(): Promise<void>`
  - internal embedding URL `http://127.0.0.1:8081`
  - internal generation URL `http://127.0.0.1:8080`

- [ ] **Step 1: Write failing lifecycle tests**

Use injected process-spawn and health-check ports. Cover:

```ts
it('does not start any process at construction/app launch')
it('starts Nomic only when ensureEmbeddingRuntime is requested')
it('starts Granite only when ensureGenerationRuntime is requested')
it('does not duplicate an already healthy process')
it('restarts an unhealthy managed process')
it('returns false when verified assets are unavailable')
it('stops both child processes on stopAll')
```

- [ ] **Step 2: Implement health checking and process startup**

Use internal constants only:

```ts
const LLM_URL = 'http://127.0.0.1:8080'
const EMBED_URL = 'http://127.0.0.1:8081'
```

Health request:

```text
GET /health
2xx -> healthy
```

Embedding runtime arguments:

```text
--model <nomic>
--port 8081
--threads <os.cpus().length>
--ctx-size 2048
--embeddings
--pooling mean
```

Generation runtime arguments:

```text
--model <granite>
--port 8080
--threads <os.cpus().length>
--ctx-size 4096
```

Set `windowsHide: true` and keep child stdio out of the renderer. Initial implementation may run CPU-only by default. If GPU offload is added, hardware detection is main-process best-effort and failure must fall back to CPU rather than blocking AI.

- [ ] **Step 3: Implement startup timeout and safe process cleanup**

Poll health every ~500 ms with a maximum startup window of 60 seconds. A startup failure kills only the process this manager launched and returns a stable runtime-not-ready result to callers.

- [ ] **Step 4: Verify Task 2 green and commit**

```bash
npm test -- src/main/ai/AiRuntimeManager.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/main/ai/AiRuntimeManager.ts src/main/ai/AiRuntimeManager.test.ts
git commit -m "feat: add lazy local AI runtime manager"
```

---

### Task 3: Persistent chunk/vector schema and repository

**Files:**
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/migrations.test.ts`
- Create: `src/main/vault/VaultChunkRepository.ts`
- Create: `src/main/vault/VaultChunkRepository.test.ts`
- Create: `src/main/vault/vectorCodec.ts`
- Create: `src/main/vault/vectorCodec.test.ts`

**Interfaces:**
- Consumes: `vault_documents` from the Vault foundation.
- Produces:
  - `vault_chunks` table
  - `float32ToBlob(vector)`
  - `blobToFloat32(buffer)`
  - `VaultChunkRepository.replaceDocumentIndex(...)`
  - `VaultChunkRepository.listQueryChunks(localUserId, documentIds?)`
  - `VaultChunkRepository.deleteDocumentChunks(...)`

- [ ] **Step 1: Write failing chunk migration tests**

Required schema:

```sql
CREATE TABLE vault_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding_blob BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  index_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES vault_documents(id) ON DELETE CASCADE,
  UNIQUE(document_id, chunk_index)
)
```

Also index `document_id`.

Run migration tests; expected FAIL.

- [ ] **Step 2: Implement migration without changing Vault document ownership**

Add `ensureVaultChunks(db)` inside the existing migration transaction. Do not put `local_user_id` on chunks; ownership is joined through `vault_documents` so it cannot drift independently.

- [ ] **Step 3: Write failing Float32 codec tests**

Cover exact round-trip for positive, negative and zero values:

```ts
const source = new Float32Array([0.25, -1.5, 0, 3.125])
expect(Array.from(blobToFloat32(float32ToBlob(source)))).toEqual(Array.from(source))
```

Codec must copy the exact byte range and not accidentally expose a larger pooled Buffer.

- [ ] **Step 4: Write failing repository ownership/replace tests**

Cover:

```ts
it('replaces all chunks for one document atomically')
it('never returns another local user chunks')
it('filters selected document ids through local-user ownership')
it('stores embedding model and index version')
it('cascades chunks when the document is deleted')
```

Selected IDs must use parameterized placeholders; never concatenate unvalidated strings into SQL.

- [ ] **Step 5: Implement codec and repository**

`replaceDocumentIndex()` uses one SQLite transaction:

```text
DELETE old chunks for document
INSERT every new chunk/vector
UPDATE vault_documents index_status='indexed', last_error_code=NULL, updated_at=?
COMMIT
```

If any insert fails, rollback leaves the previous index intact.

- [ ] **Step 6: Verify Task 3 green and commit**

```bash
npm test -- src/main/database/migrations.test.ts src/main/vault/vectorCodec.test.ts src/main/vault/VaultChunkRepository.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/main/database/migrations.ts src/main/database/migrations.test.ts src/main/vault/VaultChunkRepository.ts src/main/vault/VaultChunkRepository.test.ts src/main/vault/vectorCodec.ts src/main/vault/vectorCodec.test.ts
git commit -m "feat: persist Vault embeddings"
```

---

### Task 4: Nomic client, deterministic chunking and background indexing

**Files:**
- Create: `src/main/ai/NomicClient.ts`
- Create: `src/main/ai/NomicClient.test.ts`
- Create: `src/main/vault/chunkDocument.ts`
- Create: `src/main/vault/chunkDocument.test.ts`
- Create: `src/main/vault/VaultIndexService.ts`
- Create: `src/main/vault/VaultIndexService.test.ts`
- Modify: `src/main/vault/VaultService.ts`
- Modify: `src/main/vault/VaultService.test.ts`

**Interfaces:**
- Consumes: `AiRuntimeManager.ensureEmbeddingRuntime()`, `VaultRepository`, `VaultChunkRepository`.
- Produces:
  - `INDEX_VERSION = 1`
  - `EMBEDDING_MODEL_ID = 'nomic-embed-text-v1.5.Q4_K_M'`
  - `chunkDocument(text): Array<{ index: number; text: string }>`
  - `NomicClient.embedDocument(text)`
  - `NomicClient.embedQuery(text)`
  - `VaultIndexService.indexDocument(localUserId, documentId)`
  - `VaultIndexService.indexPendingDocuments(localUserId)`

- [ ] **Step 1: Write failing Nomic response-shape and prefix tests**

Prove calls use:

```text
POST http://127.0.0.1:8081/embedding
```

Document body:

```json
{ "content": "search_document: <chunk>" }
```

Query body:

```json
{ "content": "search_query: <question>" }
```

Normalize all llama-server shapes Jose encountered:

```ts
[{ embedding: [number, ...] }]
{ embedding: [number, ...] }
[number, ...]
```

Empty/non-numeric vectors throw a stable embedding-failed error.

- [ ] **Step 2: Write failing deterministic chunker tests**

Use version-1 constants:

```ts
const MAX_CHARS = 1000
const OVERLAP_CHARS = 150
```

Tests prove:

```ts
same text -> exactly same chunks/indexes
no chunk is empty
normal documents produce overlapping boundaries
very short text is one chunk
```

Do not use an LLM/tokenizer for chunking v1.

- [ ] **Step 3: Write failing index-service tests**

Cover:

```ts
it('requires an owned document with extraction_status ready')
it('starts only the embedding runtime')
it('marks indexing before embedding work')
it('embeds each deterministic chunk exactly once')
it('persists Float32 vectors with model/version metadata')
it('marks failed without harming source text when one embedding fails')
it('retries a failed index from extracted text without re-upload')
it('indexes all waiting_for_ai documents for the supplied local user only')
```

- [ ] **Step 4: Implement indexing**

Index flow:

```text
owned document + extracted_text ready
-> mark index_status='indexing'
-> ensureEmbeddingRuntime()
-> chunkDocument(text)
-> embed every chunk with search_document prefix
-> VaultChunkRepository.replaceDocumentIndex(...)
-> indexed
```

On failure:

```text
index_status='failed'
last_error_code='indexing-failed'
source file and extracted_text remain unchanged
```

Background work always carries an explicit captured `localUserId`; never consult a mutable global current-user variable inside the worker.

- [ ] **Step 5: Integrate indexing after upload without blocking upload**

Extend `VaultService` with an injected optional index scheduler port:

```ts
export interface VaultIndexQueue {
  queueDocument(localUserId: number, documentId: number): void
}
```

After extraction success:

```ts
this.indexQueue?.queueDocument(user.id, document.id)
```

The queue implementation checks `OfflineAiAssetService.getStatus().state === 'ready'`. If AI is not ready, it leaves `waiting_for_ai`. Upload returns before indexing completes.

- [ ] **Step 6: Verify Task 4 green and commit**

```bash
npm test -- src/main/ai/NomicClient.test.ts src/main/vault/chunkDocument.test.ts src/main/vault/VaultIndexService.test.ts src/main/vault/VaultService.test.ts
npm run typecheck
```

Expected: PASS without real model processes.

```bash
git add src/main/ai/NomicClient.ts src/main/ai/NomicClient.test.ts src/main/vault/chunkDocument.ts src/main/vault/chunkDocument.test.ts src/main/vault/VaultIndexService.ts src/main/vault/VaultIndexService.test.ts src/main/vault/VaultService.ts src/main/vault/VaultService.test.ts
git commit -m "feat: index Vault documents with Nomic"
```

---

### Task 5: Private AI desktop API, setup UI and Vault indexing controls

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Modify: `src/preload/preload.ts`
- Create: `src/main/ai/privateAiIpc.ts`
- Create: `src/main/ai/privateAiIpc.test.ts`
- Modify: `src/main/vault/vaultIpc.ts`
- Modify: `src/main/vault/vaultIpc.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/features/vault/Vault.tsx`
- Modify: `src/renderer/features/vault/Vault.css`
- Modify: `src/renderer/features/vault/Vault.test.tsx`
- Create: `src/renderer/services/ai/PrivateAiClient.ts`
- Create: `src/renderer/services/ai/DesktopPrivateAiClient.ts`
- Create: `src/renderer/services/ai/DesktopPrivateAiClient.test.ts`

**Interfaces:**
- Consumes: asset service, index service, existing Vault UI.
- Produces safe `privateAi` API and `vault.retryIndexing({documentId})`.

- [ ] **Step 1: Write failing shared/preload contract tests**

Public status:

```ts
export interface PrivateAiStatus {
  state: PrivateAiState
  ready: boolean
  repairRequired: boolean
  totalSizeBytes: number
  version: string | null
  message: string
}
```

Public API:

```ts
privateAi: {
  getStatus(): Promise<PrivateAiStatus>
  startSetup(): Promise<PrivateAiStatus>
  pauseSetup(): Promise<PrivateAiStatus>
  repair(): Promise<PrivateAiStatus>
  onProgress(listener: (progress: PrivateAiProgress) => void): () => void
}
```

Extend Vault API:

```ts
retryIndexing(input: { documentId: number }): Promise<VaultDocumentSummary>
```

No model names, paths, URLs, ports, PIDs or SHA hashes are in public status/progress.

- [ ] **Step 2: Write failing IPC authorization/sanitization tests**

Channels:

```text
private-ai:get-status
private-ai:start-setup
private-ai:pause-setup
private-ai:repair
vault:retry-indexing
```

Events:

```text
private-ai:progress
```

`vault:retry-indexing` reconstructs a numeric document ID and the service re-derives local user ownership from the protected session.

Starting/repairing AI is application-local and does not accept renderer URLs/paths.

- [ ] **Step 3: Wire main services and setup-completion indexing**

`createAppServices()` creates one shared:

```text
OfflineAiAssetService
AiRuntimeManager
VaultChunkRepository
NomicClient
VaultIndexService
```

On a successful transition to `ready`, restore the protected session again. If a user is still signed in, call:

```ts
void vaultIndexService.indexPendingDocuments(current.id)
```

If no user is signed in, do not guess a user. The next signed-in Vault read/setup action can schedule that user's pending index work.

On `before-quit`, call `runtime.stopAll()` before closing the database.

- [ ] **Step 4: Write failing Private AI/Vault UI tests**

Cover all seven setup states and the approved product rule:

```ts
it('always leaves Upload documents enabled')
it('shows optional setup copy when not installed')
it('starts setup only after user clicks Set up Private AI')
it('shows aggregate/file progress while downloading')
it('offers Continue when paused')
it('offers Repair when repair_required')
it('shows Ready when verified')
it('shows Indexing and Retry indexing per document')
it('refreshes documents authoritatively after indexing state changes')
```

Approved not-installed copy:

```text
Private AI is optional
Your documents are already stored privately. Set up Private AI to search them semantically and ask questions without sending them online.
Set up Private AI
```

- [ ] **Step 5: Implement clients/UI**

`DesktopPrivateAiClient` is the only production renderer file allowed to access `window.familyCircle.privateAi`.

Vault page adds the setup panel above the document list and a `Retry indexing` action only for `indexStatus === 'failed'` with successful extraction.

Setup navigation must not cancel an active main-process download. Subscriptions are renderer listeners only; unsubscribing a component removes its listener but leaves setup running.

- [ ] **Step 6: Verify Task 5 green and commit**

```bash
npm test -- src/main/ai/privateAiIpc.test.ts src/main/vault/vaultIpc.test.ts src/preload/createDesktopApi.test.ts src/renderer/services/ai/DesktopPrivateAiClient.test.ts src/renderer/features/vault/Vault.test.tsx
npm run typecheck
npm run build:electron
npm run build:renderer
```

Expected: PASS.

```bash
git add src/shared/desktopApi.ts src/preload src/main/ai/privateAiIpc.ts src/main/ai/privateAiIpc.test.ts src/main/vault/vaultIpc.ts src/main/vault/vaultIpc.test.ts src/main/main.ts src/renderer/services/ai src/renderer/features/vault
git commit -m "feat: add Private AI setup and Vault indexing UI"
```

---

### Task 6: Persistent retrieval, Granite client and real Ask your Vault page

**Files:**
- Create: `src/main/ai/GraniteClient.ts`
- Create: `src/main/ai/GraniteClient.test.ts`
- Create: `src/main/vault/cosineSimilarity.ts`
- Create: `src/main/vault/cosineSimilarity.test.ts`
- Create: `src/main/vault/VaultQueryService.ts`
- Create: `src/main/vault/VaultQueryService.test.ts`
- Modify: `src/main/vault/vaultIpc.ts`
- Modify: `src/main/vault/vaultIpc.test.ts`
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`
- Modify: `src/preload/createDesktopApi.test.ts`
- Modify: `src/renderer/services/vault/VaultClient.ts`
- Modify: `src/renderer/services/vault/DesktopVaultClient.ts`
- Modify: `src/renderer/services/vault/DesktopVaultClient.test.ts`
- Create: `src/renderer/features/vault/AskVault.tsx`
- Create: `src/renderer/features/vault/AskVault.css`
- Create: `src/renderer/features/vault/AskVault.test.tsx`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/app/App.test.tsx`

**Interfaces:**
- Consumes: persistent chunks/vectors, Nomic query embeddings, lazy Granite runtime.
- Produces: `vault.ask(...)` and real `/ai` route.

- [ ] **Step 1: Write failing Granite client tests**

Granite call:

```text
POST http://127.0.0.1:8080/v1/chat/completions
```

Request:

```ts
{
  messages: [
    {
      role: 'system',
      content: 'You are a private family-knowledge assistant. Answer using ONLY the provided Vault source context. If the answer is not supported by the context, say you could not find it in the selected Vault documents.'
    },
    { role: 'user', content: prompt }
  ],
  max_tokens: 512,
  temperature: 0,
  top_k: 40,
  top_p: 0.95,
  stream: false
}
```

Tests normalize `choices[0].message.content`, reject empty output and map transport details to stable generation-failed errors.

- [ ] **Step 2: Write failing similarity/retrieval tests**

`cosineSimilarity()` tests cover identical, orthogonal and negative vectors plus mismatched dimensions.

`VaultQueryService` tests cover:

```ts
it('requires a protected local session')
it('requires a non-empty question')
it('validates every selected document belongs to the local user')
it('uses persisted chunks and never calls document embedding')
it('embeds the question once with Nomic search_query prefix')
it('sorts by cosine score and uses top 5 chunks')
it('starts Granite only after relevant chunks exist')
it('grounds the prompt in retrieved chunks only')
it('returns safe sources with document id, file name and excerpt')
it('does not return vectors, paths, full extracted text or model endpoints')
it('returns a stable message when no indexed context exists')
```

- [ ] **Step 3: Implement query service**

Public input:

```ts
export type VaultQueryScope =
  | { type: 'all' }
  | { type: 'documents'; documentIds: number[] }

export interface VaultAskInput {
  question: string
  scope: VaultQueryScope
}
```

Main query flow:

```text
restore session
-> validate selected IDs through VaultRepository ownership
-> ensureEmbeddingRuntime()
-> embed question once
-> load persisted indexed chunks scoped to user/document IDs
-> decode Float32 vectors
-> score cosine similarity
-> top 5
-> ensureGenerationRuntime()
-> Granite grounded prompt
-> safe answer + sources
```

Source DTO:

```ts
export interface VaultAnswerSource {
  documentId: number
  fileName: string
  excerpt: string
}
```

Excerpt is at most 320 characters and is derived only from the retrieved chunk.

- [ ] **Step 4: Write failing IPC/client/UI tests**

Add public API:

```ts
vault.ask(input: VaultAskInput): Promise<VaultAskResult>
```

IPC reconstructs and validates question/scope shapes; it does not accept local-user IDs.

`AskVault` tests cover:

```ts
it('shows Private AI setup guidance when AI is not ready')
it('keeps the question composer visible')
it('supports All documents')
it('supports selecting indexed Vault documents')
it('disables Ask for an empty question')
it('shows an explicit generating state')
it('renders answer and source file/excerpts')
it('does not show filesystem or model technical details')
```

- [ ] **Step 5: Implement Ask your Vault and route**

Page structure:

```text
Ask your Vault
Ask something about your private documents.

Question
[________________________________]

Search
(o) All documents
( ) Selected documents

[Ask]

Answer
...

Sources
Family History.pdf
<excerpt>
```

Replace only `/ai` in `placeholderRoutes`:

```tsx
<Route path="/ai" element={<AskVault />} />
```

The page loads document summaries through `DesktopVaultClient`; only `indexed` documents are selectable for selected-document scope.

- [ ] **Step 6: Verify Task 6 green and commit**

```bash
npm test -- src/main/ai/GraniteClient.test.ts src/main/vault/cosineSimilarity.test.ts src/main/vault/VaultQueryService.test.ts src/main/vault/vaultIpc.test.ts src/preload/createDesktopApi.test.ts src/renderer/services/vault/DesktopVaultClient.test.ts src/renderer/features/vault/AskVault.test.tsx src/renderer/app/App.test.tsx
npm run typecheck
npm run build:electron
npm run build:renderer
```

Expected: PASS without any real model files.

```bash
git add src/main/ai/GraniteClient.ts src/main/ai/GraniteClient.test.ts src/main/vault/cosineSimilarity.ts src/main/vault/cosineSimilarity.test.ts src/main/vault/VaultQueryService.ts src/main/vault/VaultQueryService.test.ts src/main/vault/vaultIpc.ts src/main/vault/vaultIpc.test.ts src/shared/desktopApi.ts src/preload src/renderer/services/vault src/renderer/features/vault/AskVault.tsx src/renderer/features/vault/AskVault.css src/renderer/features/vault/AskVault.test.tsx src/renderer/app/App.tsx src/renderer/app/App.test.tsx
git commit -m "feat: add local Granite Vault questions"
```

---

### Task 7: AI/Vault privacy boundaries, lifecycle hardening, docs and full gate

**Files:**
- Modify: `scripts/verify-boundaries.mjs`
- Create: `src/main/vault/VaultRagSecurity.test.ts`
- Modify: `README.md`
- Create: `docs/PRIVATE_AI.md`

**Interfaces:**
- Consumes: complete Private AI/RAG implementation.
- Produces: mechanical privacy guarantees, documented clean-machine/manual model validation path and merge-ready evidence.

- [ ] **Step 1: Strengthen the boundary verifier**

For production Vault/AI renderer code and public desktop contract, reject:

```text
embeddingBlob
Float32Array
storedRelativePath
extractedText
modelPath
graniteModel
nomicModel
llama-server.exe
127.0.0.1:8080
127.0.0.1:8081
llmPid
embPid
```

Enforce:

```text
window.familyCircle.privateAi -> DesktopPrivateAiClient.ts only
window.familyCircle.vault -> DesktopVaultClient.ts only
```

Do not ban user-facing terms `Private AI`, `Vault`, `Granite` from developer documentation; the rule targets production renderer/shared code for technical paths/endpoints/process details.

- [ ] **Step 2: Write merge-blocking privacy/security regression tests**

Cover:

```ts
it('cannot query another local user selected document IDs')
it('cannot retrieve another user chunks even with guessed document IDs')
it('never sends Vault content to the Circle adapter')
it('never calls a cloud fallback when local AI is unavailable')
it('never re-embeds document chunks while answering a question')
it('never downloads Private AI until startSetup or repair is explicitly called')
it('does not start Granite during document indexing')
it('does not start either runtime at app/service construction')
it('keeps upload/extraction available in every Private AI state')
```

- [ ] **Step 3: Document developer/runtime behavior**

`docs/PRIVATE_AI.md` must record:

```text
Asset manifest + hashes
AppData offline-ai layout
Seven states
User-triggered setup/repair
Ports 8080/8081 (developer-only detail)
Nomic document/query prefixes
INDEX_VERSION=1
persistent Float32 BLOB indexing
lazy runtime lifecycle
no-cloud/no-Circle Vault content rule
```

README user/product architecture should state:

```text
Vault upload/extraction is usable without Private AI.
Private AI can be installed later and indexes existing documents automatically.
Ask your Vault uses local Nomic retrieval + Granite generation.
```

- [ ] **Step 4: Add a manual clean-machine validation checklist without putting models in CI**

Document this exact manual Windows path:

```text
1. Start with no <userData>/offline-ai directory.
2. Upload TXT/PDF/DOCX documents successfully before AI setup.
3. Start Private AI setup explicitly.
4. Interrupt/pause and continue; verify partial bytes are reused.
5. Verify all three SHA-256 checks before ready.
6. Confirm Nomic starts for indexing and documents become Ready to ask.
7. Ask a known-answer question; verify source excerpts match local documents.
8. Disconnect internet and ask again; verify local Q&A still works.
9. Switch local account; verify the first user's documents/sources cannot be seen or selected.
10. Exit app; verify managed llama.cpp processes stop.
```

CI must test the same orchestration with fake downloader/process/HTTP ports rather than downloading 2+ GB.

- [ ] **Step 5: Run focused final tests**

```bash
npm test -- src/main/ai src/main/vault src/renderer/services/ai src/renderer/services/vault src/renderer/features/vault
npm run verify:boundaries
```

Expected: PASS.

- [ ] **Step 6: Run the exact repository gate**

```bash
npm ci
npm run typecheck
npm run test
npm run verify:boundaries
npm run build:electron
npm run build:renderer
npm audit --audit-level=high
```

Expected: all application checks/builds pass with no high/critical dependency findings. Do not claim model runtime verification from CI because CI intentionally uses fakes and has no 2 GB model assets.

- [ ] **Step 7: Perform merge-blocking review and commit**

Review `main...feature/vault-private-ai` for:

```text
no AI auto-download
no cloud fallback
no Circle API Vault content
no public paths/endpoints/process IDs/vectors
no query-time document re-embedding
no cross-user document/chunk leakage
no Granite startup during indexing-only path
no upload lock tied to AI readiness
verified-before-ready install semantics
```

Then commit hardening:

```bash
git add scripts/verify-boundaries.mjs src/main/vault/VaultRagSecurity.test.ts README.md docs/PRIVATE_AI.md
git commit -m "test: harden Private AI Vault boundaries"
```

The Private AI/RAG branch is ready for PR only after CI passes on the exact final head. After merge, run CI again on the exact resulting `main` SHA before calling the complete Vault + Private AI feature finished.
