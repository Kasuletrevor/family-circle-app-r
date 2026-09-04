# Private AI + Vault RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-triggered verified Private AI setup, persistent Nomic indexing and local Granite Q&A on top of the shipped private Vault without re-uploading documents or re-embedding document chunks on each question.

**Architecture:** Electron main owns the seven-state AI installer, lazy llama.cpp processes, chunk/vector persistence, indexing and grounded retrieval/generation. `vault_documents` remains the source of truth; extracted text is deterministically chunked and embedded once into SQLite Float32 BLOBs. React receives only safe status, document/index state, answers and source excerpts.

**Tech Stack:** Electron 44.1.1, TypeScript 7.0.2, Node 24, `node:sqlite`, `node:child_process`, `node:http`/`node:https`, llama.cpp b8772 Windows x64, IBM Granite 4.0 H Micro Q4_K_M, Nomic Embed Text v1.5 Q4_K_M, React 19.2.7, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-09-04-vault-private-ai-design.md`

**Prerequisite:** `docs/superpowers/plans/2026-09-04-vault-foundation-implementation.md` is merged and verified on `main`. Start this implementation from a fresh branch named **`feature/private-ai-rag`** created from that updated green `main`.

## Global Constraints

- Private AI setup is **user-triggered**; never auto-download ~2 GB on app start.
- Upload/storage/extraction remain enabled in every AI state.
- States are exactly `not_installed | downloading | paused | verifying | ready | repair_required | failed`.
- Required assets are verified by immutable expected size/SHA-256 before promotion.
- Indexing starts Nomic only; Q&A uses Nomic query embedding + Granite generation.
- Stored document chunks are embedded once and persisted; query-time re-embedding of all document chunks is forbidden.
- Prefixes are exact: `search_document: ` and `search_query: `.
- Retrieval v1 is SQLite + in-process cosine similarity; no Qdrant/FAISS/LanceDB.
- Scope v1 is `all` or explicit Vault document IDs validated against the protected local user.
- Granite receives retrieved context only; no cloud fallback.
- Renderer never receives model paths, endpoints, PIDs, embeddings, full extracted text or stored paths.
- CI uses fake downloader/runtime/model ports; CI never downloads or starts the real 2+ GB model stack.

---

### Task 1: Feature-branch CI and verified Private AI asset service

**Files:**
- Modify: `.github/workflows/desktop-shell-ci.yml`
- Create: `config/offline-ai-manifest.json`
- Create: `src/main/ai/privateAiModels.ts`
- Create: `src/main/ai/OfflineAiAssetService.ts`, `OfflineAiAssetService.test.ts`
- Create: `src/main/ai/OfflineAiDownloader.ts`, `OfflineAiDownloader.test.ts`

**Interfaces:** produces seven-state status/progress, `getStatus`, `getInstalledPaths`, `startSetup`, `pauseSetup`, `repair`.

- [ ] **Step 1: Enable push CI on the fresh RAG branch**

Add `feature/private-ai-rag` to workflow push branches and commit alone:

```bash
git add .github/workflows/desktop-shell-ci.yml
git commit -m "ci: verify Private AI feature branch"
```

- [ ] **Step 2: Add exact Jose-proven manifest**

Create:

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

`main.ts` later injects manifest path as:

```ts
join(app.getAppPath(), 'config', 'offline-ai-manifest.json')
```

so the installer service does not depend on `process.cwd()`.

- [ ] **Step 3: Write asset-state RED tests**

```ts
it('reports not_installed with no assets')
it('never considers .part ready')
it('reports repair_required when marker exists but required asset is invalid')
it('reports ready only after all required assets verify')
it('reports manifest total bytes')
```

State type:

```ts
type PrivateAiState = 'not_installed'|'downloading'|'paused'|'verifying'|'ready'|'repair_required'|'failed'
```

- [ ] **Step 4: Implement installed asset verification**

Root: `join(userDataPath, 'offline-ai')`; marker: `installed-version.json`. Internal `InstalledAiPaths` contains `llamaDir`, `serverExe`, `graniteModel`, `nomicModel` and never leaves main.

For model files verify exact size + SHA-256. For runtime, verify downloaded ZIP before extraction, then require `llama-server.exe` in the extracted target before writing the marker.

- [ ] **Step 5: Write downloader RED tests**

```ts
it('resumes .part via Range bytes=<existing>-')
it('restarts when server ignores resume')
it('emits aggregate/per-file progress')
it('pause keeps valid partial bytes')
it('rejects size mismatch')
it('rejects SHA mismatch')
it('promotes only verified files')
it('extracts runtime only after zip verification')
```

Inject HTTP/filesystem/process ports; tests stay offline.

- [ ] **Step 6: Implement download/verify/promotion**

Stage under:

```text
<userData>/offline-ai/.staging/<version>/
```

Use `.part`, Range requests, SHA-256 streaming and atomic marker write. Windows runtime extraction uses main-owned child-process arguments for PowerShell `Expand-Archive`; no renderer string reaches the command.

Public progress contains state/phase/percent/file counts/name/byte metrics/message only—no URLs or paths.

- [ ] **Step 7: GREEN gate + commit**

```bash
npm test -- src/main/ai/OfflineAiAssetService.test.ts src/main/ai/OfflineAiDownloader.test.ts
npm run typecheck
git add config/offline-ai-manifest.json src/main/ai .github/workflows/desktop-shell-ci.yml
git commit -m "feat: add verified Private AI setup service"
```

---

### Task 2: Lazy split llama.cpp runtime manager

**Files:**
- Create: `src/main/ai/AiRuntimeManager.ts`, `AiRuntimeManager.test.ts`

**Interfaces:** `ensureEmbeddingRuntime()`, `ensureGenerationRuntime()`, `stopAll()`; internal ports `8081` Nomic and `8080` Granite.

- [ ] **Step 1: Write lifecycle RED tests**

```ts
it('starts nothing at construction')
it('starts only Nomic for embedding request')
it('starts only Granite for generation request')
it('reuses healthy managed process')
it('restarts unhealthy managed process')
it('returns false without verified assets')
it('stops both managed children')
```

- [ ] **Step 2: Implement health and startup**

Health: `GET /health`. Nomic args:

```text
--model <nomic> --port 8081 --threads <cpu-count> --ctx-size 2048 --embeddings --pooling mean
```

Granite:

```text
--model <granite> --port 8080 --threads <cpu-count> --ctx-size 4096
```

Use `windowsHide:true`; default CPU path must work. Optional GPU detection may only optimize and must fall back to CPU.

- [ ] **Step 3: Add 60-second startup timeout and cleanup**

Poll ~500 ms; kill only the failed managed child on timeout/error.

- [ ] **Step 4: GREEN gate + commit**

```bash
npm test -- src/main/ai/AiRuntimeManager.test.ts
npm run typecheck
git add src/main/ai/AiRuntimeManager*
git commit -m "feat: add lazy local AI runtime manager"
```

---

### Task 3: Persistent chunk/vector schema and repository

**Files:**
- Modify: `src/main/database/migrations.ts`, `migrations.test.ts`
- Create: `src/main/vault/vectorCodec.ts`, `vectorCodec.test.ts`
- Create: `src/main/vault/VaultChunkRepository.ts`, `VaultChunkRepository.test.ts`

**Interfaces:** `float32ToBlob`, `blobToFloat32`, `replaceDocumentIndex`, `listQueryChunks`.

- [ ] **Step 1: Write migration RED test and create table**

```sql
CREATE TABLE IF NOT EXISTS vault_chunks (
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
);
CREATE INDEX IF NOT EXISTS idx_vault_chunks_document ON vault_chunks(document_id);
```

No duplicate `local_user_id` on chunks; ownership joins through `vault_documents`.

- [ ] **Step 2: Write/implement Float32 codec**

Round-trip:

```ts
new Float32Array([0.25, -1.5, 0, 3.125])
```

Copy exact byte range; never expose pooled Buffer excess bytes.

- [ ] **Step 3: Write repository RED tests**

```ts
it('atomically replaces one document index')
it('keeps prior index on failed replacement')
it('never returns another user chunks')
it('filters selected ids by local-user ownership')
it('returns documentId,fileName,chunkIndex,text,embedding for query use')
it('stores model/version metadata')
it('cascades on document delete')
```

`listQueryChunks(localUserId, documentIds?)` joins `vault_documents` and returns internal rows including `fileName`; SQL placeholders are parameterized.

- [ ] **Step 4: Implement transaction**

One transaction deletes old chunks, inserts all replacements, and updates document `index_status='indexed', last_error_code=NULL`. Roll back entirely on failure.

- [ ] **Step 5: GREEN gate + commit**

```bash
npm test -- src/main/database/migrations.test.ts src/main/vault/vectorCodec.test.ts src/main/vault/VaultChunkRepository.test.ts
npm run typecheck
git add src/main/database src/main/vault/vectorCodec* src/main/vault/VaultChunkRepository*
git commit -m "feat: persist Vault embeddings"
```

---

### Task 4: Nomic client, deterministic chunking and indexing service

**Files:**
- Create: `src/main/ai/NomicClient.ts`, `NomicClient.test.ts`
- Create: `src/main/vault/chunkDocument.ts`, `chunkDocument.test.ts`
- Create: `src/main/vault/VaultIndexService.ts`, `VaultIndexService.test.ts`
- Modify: `src/main/vault/VaultService.ts`, `VaultService.test.ts`

**Interfaces:**

```ts
const INDEX_VERSION = 1
const EMBEDDING_MODEL_ID = 'nomic-embed-text-v1.5.Q4_K_M'
```

Produces `embedDocument`, `embedQuery`, `indexDocument`, `indexPendingDocuments`.

- [ ] **Step 1: Write Nomic RED tests**

POST internal `/embedding`. Exact bodies:

```ts
{ content: `search_document: ${chunk}` }
{ content: `search_query: ${question}` }
```

Normalize `[{embedding:[...]}]`, `{embedding:[...]}` and direct numeric arrays. Empty/non-numeric vectors -> stable `embedding-failed`.

- [ ] **Step 2: Write deterministic chunker RED tests**

Version 1:

```ts
MAX_CHARS = 1000
OVERLAP_CHARS = 150
```

Same text must always produce same numbered non-empty chunks; short text is one chunk.

- [ ] **Step 3: Write index-service RED tests**

```ts
it('requires owned extraction-ready document')
it('starts only embedding runtime')
it('marks indexing')
it('embeds each chunk once')
it('persists model/version Float32 vectors')
it('marks failed without harming source/text')
it('retries without re-upload')
it('indexes pending docs for supplied user only')
```

- [ ] **Step 4: Implement index flow**

```text
owned ready doc -> indexing -> ensure Nomic -> deterministic chunks
-> search_document embeddings -> atomic replace -> indexed
```

Failure -> `index_status='failed', last_error_code='indexing-failed'`; source/extracted text remain healthy.

Background jobs always capture explicit `localUserId`; no mutable global current user.

- [ ] **Step 5: Queue indexing after extraction without blocking upload**

Inject into `VaultService`:

```ts
interface VaultIndexQueue { queueDocument(localUserId: number, documentId: number): void }
```

Queue checks AI ready; otherwise leaves `waiting_for_ai`. Upload returns before indexing finishes.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/main/ai/NomicClient.test.ts src/main/vault/chunkDocument.test.ts src/main/vault/VaultIndexService.test.ts src/main/vault/VaultService.test.ts
npm run typecheck
git add src/main/ai/NomicClient* src/main/vault/chunkDocument* src/main/vault/VaultIndexService* src/main/vault/VaultService*
git commit -m "feat: index Vault documents with Nomic"
```

---

### Task 5: Safe Private AI API and Vault setup/indexing UI

**Files:**
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`, `createDesktopApi.test.ts`, `preload.ts`
- Create: `src/main/ai/privateAiIpc.ts`, `privateAiIpc.test.ts`
- Modify: `src/main/vault/vaultIpc.ts`, `vaultIpc.test.ts`
- Modify: `src/main/main.ts`
- Create: `src/renderer/services/ai/PrivateAiClient.ts`, `DesktopPrivateAiClient.ts`, `DesktopPrivateAiClient.test.ts`
- Modify: `src/renderer/features/vault/Vault.tsx`, `Vault.css`, `Vault.test.tsx`

**Interfaces:** safe `privateAi.getStatus/startSetup/pauseSetup/repair/onProgress` and `vault.retryIndexing({documentId})`.

- [ ] **Step 1: Write public/preload RED tests**

Public status contains only:

```ts
state, ready, repairRequired, totalSizeBytes, version, message
```

Progress contains friendly transfer metrics, not URL/path/hash/model/PID/port.

- [ ] **Step 2: Write IPC RED tests**

Channels:

```text
private-ai:get-status
private-ai:start-setup
private-ai:pause-setup
private-ai:repair
vault:retry-indexing
```

Event: `private-ai:progress`. No renderer URL/path is accepted. Retry-index reconstructs numeric document ID and re-derives user in main.

- [ ] **Step 3: Wire services in `main.ts`**

Use one shared `OfflineAiAssetService`, `AiRuntimeManager`, `VaultChunkRepository`, `NomicClient`, `VaultIndexService`.

On transition to `ready`, restore protected session again; if a user is still signed in:

```ts
void vaultIndexService.indexPendingDocuments(current.id)
```

No session -> no guessed user. `before-quit` awaits/stops managed AI children before DB close.

- [ ] **Step 4: Write Vault setup UI RED tests**

Cover all seven states, explicit setup click, pause/continue/repair, progress, indexing/retry, and **Upload remains enabled in every state**.

Approved copy:

```text
Private AI is optional
Your documents are already stored privately. Set up Private AI to search them semantically and ask questions without sending them online.
Set up Private AI
```

- [ ] **Step 5: Implement client/UI**

Only `DesktopPrivateAiClient.ts` may access `window.familyCircle.privateAi`. Unsubscribing a React listener never cancels the main-process download.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/main/ai/privateAiIpc.test.ts src/main/vault/vaultIpc.test.ts src/preload/createDesktopApi.test.ts src/renderer/services/ai src/renderer/features/vault/Vault.test.tsx
npm run typecheck
npm run build:electron
npm run build:renderer
git add src/shared/desktopApi.ts src/preload src/main/ai/privateAiIpc* src/main/vault/vaultIpc* src/main/main.ts src/renderer/services/ai src/renderer/features/vault
git commit -m "feat: add Private AI setup and Vault indexing UI"
```

---

### Task 6: Granite grounded retrieval and real `/ai` Ask your Vault

**Files:**
- Create: `src/main/ai/GraniteClient.ts`, `GraniteClient.test.ts`
- Create: `src/main/vault/cosineSimilarity.ts`, `cosineSimilarity.test.ts`
- Create: `src/main/vault/VaultQueryService.ts`, `VaultQueryService.test.ts`
- Modify: `src/main/vault/vaultIpc.ts`, `vaultIpc.test.ts`
- Modify: `src/shared/desktopApi.ts`
- Modify: `src/preload/createDesktopApi.ts`, `createDesktopApi.test.ts`
- Modify: `src/renderer/services/vault/VaultClient.ts`, `DesktopVaultClient.ts`, `DesktopVaultClient.test.ts`
- Create: `src/renderer/features/vault/AskVault.tsx`, `AskVault.css`, `AskVault.test.tsx`
- Modify: `src/renderer/app/App.tsx`, `App.test.tsx`

**Interfaces:** `vault.ask({question, scope})`; scope is `all` or selected document IDs.

- [ ] **Step 1: Write Granite client RED tests**

Internal POST: `http://127.0.0.1:8080/v1/chat/completions`. System instruction:

```text
You are a private family-knowledge assistant. Answer using ONLY the provided Vault source context. If the answer is not supported by the context, say you could not find it in the selected Vault documents.
```

Use `max_tokens:512`, `temperature:0`, `top_k:40`, `top_p:0.95`, `stream:false`. Normalize `choices[0].message.content`; empty/transport failures map to stable generation failure.

- [ ] **Step 2: Write retrieval-service RED tests**

```ts
it('requires protected session and non-empty question')
it('validates every selected id belongs to local user')
it('loads persisted chunks instead of extracted docs')
it('never calls document embedding')
it('embeds question exactly once')
it('sorts cosine and takes top 5')
it('starts Granite only after context exists')
it('grounds prompt in top chunks only')
it('returns safe documentId,fileName,excerpt sources')
it('returns no vector/path/full text/endpoint')
it('handles no indexed context safely')
```

Source excerpt <=320 chars.

- [ ] **Step 3: Implement query flow**

```text
restore user -> validate scope -> ensure Nomic -> embed query once
-> listQueryChunks(user.id, ids?) -> decode persisted vectors -> cosine
-> top 5 -> ensure Granite -> grounded answer -> safe sources
```

Public types:

```ts
type VaultQueryScope = {type:'all'} | {type:'documents'; documentIds:number[]}
interface VaultAnswerSource { documentId:number; fileName:string; excerpt:string }
```

- [ ] **Step 4: Write IPC/client/UI RED tests**

`vault.ask` IPC reconstructs question/scope and rejects non-numeric selected IDs. `AskVault` tests composer visible, all/selected modes, empty question guard, generating state, answer and sources, and no technical filesystem/model detail.

- [ ] **Step 5: Implement `/ai`**

Replace `/ai` placeholder with `<AskVault />`. Selected mode lists only `indexed` Vault documents.

- [ ] **Step 6: GREEN gate + commit**

```bash
npm test -- src/main/ai/GraniteClient.test.ts src/main/vault/cosineSimilarity.test.ts src/main/vault/VaultQueryService.test.ts src/main/vault/vaultIpc.test.ts src/preload/createDesktopApi.test.ts src/renderer/services/vault src/renderer/features/vault/AskVault.test.tsx src/renderer/app/App.test.tsx
npm run typecheck
npm run build:electron
npm run build:renderer
git add src/main/ai/GraniteClient* src/main/vault/cosineSimilarity* src/main/vault/VaultQueryService* src/main/vault/vaultIpc* src/shared/desktopApi.ts src/preload src/renderer/services/vault src/renderer/features/vault/AskVault* src/renderer/app/App*
git commit -m "feat: add local Granite Vault questions"
```

---

### Task 7: RAG privacy/lifecycle hardening, docs and final verification

**Files:**
- Modify: `scripts/verify-boundaries.mjs`
- Create: `src/main/vault/VaultRagSecurity.test.ts`
- Modify: `README.md`
- Create: `docs/PRIVATE_AI.md`

- [ ] **Step 1: Strengthen boundary verifier**

Reject from production Vault/AI renderer and public contract:

```text
embeddingBlob, Float32Array, storedRelativePath, extractedText, modelPath,
graniteModel, nomicModel, llama-server.exe, 127.0.0.1:8080,
127.0.0.1:8081, llmPid, embPid
```

Allow `window.familyCircle.privateAi` only in `DesktopPrivateAiClient.ts`; `window.familyCircle.vault` only in `DesktopVaultClient.ts`.

- [ ] **Step 2: Add merge-blocking regression tests**

```ts
it('cannot query another user selected ids')
it('cannot retrieve another user chunks')
it('never sends Vault content to Circle adapter')
it('never cloud-falls-back')
it('never re-embeds document chunks on ask')
it('never downloads until explicit setup/repair')
it('never starts Granite for indexing')
it('starts no AI process at construction')
it('keeps upload/extraction available in all AI states')
```

- [ ] **Step 3: Document developer/runtime contract**

`docs/PRIVATE_AI.md` records manifest/hashes, AppData layout, seven states, explicit setup/repair, developer-only ports, Nomic prefixes, `INDEX_VERSION=1`, Float32 BLOB persistence, lazy lifecycle and no-cloud/no-Circle content rule.

README states upload works before AI; setup later indexes existing docs; Ask Vault is local Nomic + Granite.

- [ ] **Step 4: Document manual Windows clean-machine test**

```text
1 no offline-ai directory
2 upload/extract docs before setup
3 explicit setup
4 pause/continue uses partial bytes
5 verify hashes before ready
6 Nomic indexes and docs become Ready to ask
7 ask known-answer question and inspect sources
8 disconnect internet and ask again
9 switch local account; no cross-user docs/sources
10 exit; managed llama.cpp processes stop
```

CI mirrors orchestration with fakes, not real model downloads.

- [ ] **Step 5: Full exact-head gate**

```bash
npm ci
npm run typecheck
npm run test
npm run verify:boundaries
npm run build:electron
npm run build:renderer
npm audit --audit-level=high
```

- [ ] **Step 6: Merge-blocking review**

Confirm: no auto-download, cloud fallback, Circle content path, public model technicals/vectors, query-time document re-embedding, cross-user leakage, Granite during index-only path or upload lock tied to AI readiness.

- [ ] **Step 7: Commit hardening**

```bash
git add scripts/verify-boundaries.mjs src/main/vault/VaultRagSecurity.test.ts README.md docs/PRIVATE_AI.md
git commit -m "test: harden Private AI Vault boundaries"
```

Open the PR only after CI is green on the exact final `feature/private-ai-rag` head. After merge, verify the exact resulting `main` SHA before declaring the full Vault + Private AI feature complete.
