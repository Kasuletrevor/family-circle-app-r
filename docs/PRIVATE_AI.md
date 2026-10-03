# Private AI + Private Archive Retrieval

Family Circle's Private AI is an **optional, user-triggered local capability** layered on top of the private Vault and confirmed My Story memories. PDF, DOCX, and TXT upload/storage/extraction and Story editing work without AI. Installing or repairing Private AI is never required to keep using those local features.

The Private AI path is owned by the Electron main process. React receives only safe setup progress, index status, answers, and short source excerpts. Model paths, local endpoints, process details, embeddings, full extracted text, stored paths, hashes, and local user IDs never cross the desktop boundary.

## Runtime contract

Private AI uses `config/offline-ai-manifest.json`. Manifest version `1.3.0` requires exactly three verified assets:

| Friendly name | Asset | Expected bytes | Expected SHA-256 |
| --- | --- | ---: | --- |
| AI engine | llama.cpp b11243 Windows CPU x64 runtime ZIP | 19,161,151 | `29F91327F4E98FCAC93E3B44E6CC54BEDA26468EB9FFEB804A08CFA67BDA8C5B` |
| AI answers | Qwen3.5-0.8B Q4_K_M GGUF | 579,615,840 | `FB044E93939A70469C905781334F5DE1E6C8B608CED6CBC8C9249BD4127D9526` |
| AI search | Nomic Embed Text v1.5 Q4_K_M GGUF | 84,106,624 | `D4E388894E09CF3816E8B0896D81D265B55E7A9FFF9AB03FE8BF4EF5E11295AC` |

The required transfer is **682,883,615 bytes (about 651 MiB / 0.64 GiB)**. Granite 4.0 H-Micro and Granite 4.0 350M are no longer required assets.

**Engine/model compatibility.** The Qwen3.5-0.8B GGUF carries a next-token-prediction layer (`block_count = 25`, `nextn_predict_layers = 1`). llama.cpp b8772 (manifest `1.2.0`) treated it as a regular layer and failed with `missing tensor 'blk.24.ssm_conv1d.weight'`, so no answer could be generated. b11243 loads it. Before changing either asset, run `llama-server --model <qwen.gguf>` from the candidate engine and confirm `/health` returns `ok`. The unit tests cannot catch this pairing because they never start the real runtime.

**Engine upgrades.** An existing `1.2.0` install reports `repair_required`. *Repair* downloads only the new engine and re-verifies the unchanged models (about 7 seconds with a local mirror). The previous `bin/llama-b8772-…` folder is not removed yet.

### Local layout

```text
<userData>/offline-ai/
├── installed-version.json
├── bin/
│   └── llama-b11243-bin-win-cpu-x64/
│       └── llama-server.exe
├── models/
│   ├── Qwen_Qwen3.5-0.8B-Q4_K_M.gguf
│   └── nomic-embed-text-v1.5.Q4_K_M.gguf
└── .staging/
    └── 1.3.0/
        └── ... resumable .part downloads ...
```

The version marker is written only after every required asset verifies. Model files must match both immutable byte size and SHA-256. The llama.cpp ZIP is verified before extraction and `llama-server.exe` must exist before the runtime is considered installed.

Partial `.part` files are never considered installed. Setup can pause/resume through HTTP Range requests. Existing verified files can be reused across manifest revisions when their configured asset identity still matches.

## Setup states

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

`ready` means the current manifest version is marked installed and every required asset still verifies. A version mismatch or invalid required asset becomes `repair_required`.

Setup and repair remain explicit user actions:

- App startup does **not** download models.
- Vault upload and Story editing do **not** trigger setup.
- `Start setup` downloads/verifies the configured assets.
- `Pause` preserves valid partial bytes.
- Continue resumes the staged transfer.
- `Repair` removes the installed marker and re-runs verified setup.

No setup state disables Vault upload, local extraction, or Story drafting/confirmation.

### Progress shown to the user

Settings and the Vault page share `PrivateAiSetupProgress`:

- **Before starting**, the card shows what will actually be downloaded (`downloadSizeBytes`). A first-time setup shows the full "one-time download"; a repair after an engine upgrade shows only the engine ("Repair downloads about 18 MB"); a paused or partial setup shows what is left. The estimate uses file sizes only, with no hashing.
- **During setup**, installed files are checked first ("Checking installed files…"). The bar, percent, bytes, speed and time left then cover **only the files being downloaded**, and a resumed file counts the bytes already on disk. Steps without a byte count ("Preparing the AI engine…", "Verifying download…") show an indeterminate bar.
- Public progress carries a `phase` (`checking`, `downloading`, `verifying`, `extracting`). The offline voice setup shares the base types without these fields.

## Lazy llama.cpp lifecycle

`AiRuntimeManager` starts no AI process at construction or normal app startup. It owns two local llama.cpp server lifecycles:

```text
Qwen3.5-0.8B generation / translation   developer-only port 8080
Nomic embedding / search                developer-only port 8081
```

Both bind to `127.0.0.1` only. Ports and endpoints are internal implementation details and must never appear in the renderer/public desktop contract.

There is no separate fast-generation process. `ensureFastGenerationRuntime()` is only a compatibility alias to the shared Qwen generation runtime while older internal callers are removed.

## Indexing lifecycle

Indexing uses **Nomic only**. Qwen is not required for document or Story indexing.

Vault:

```text
owned extraction-ready document
  -> deterministic chunks
  -> Nomic document embeddings
  -> atomic SQLite chunk/vector replacement
  -> document index_status = indexed
```

My Story:

```text
owned confirmed Story answer
  -> deterministic Story chunks
  -> Nomic document embeddings
  -> atomic story_chunks replacement
  -> Story index_status = ready
```

Draft Story answers are not queryable. Editing previously confirmed text invalidates its old chunks until the changed answer is explicitly confirmed and indexed again.

The current embedding contract remains intentionally unchanged in this Qwen migration:

```text
search_document: <chunk text>
search_query: <question>
```

`EMBEDDING_INDEX_VERSION` remains `1`. Existing chunks are embedded once per index operation and persisted; they are **not re-embedded for every question**.

A future embedding-model migration must update pooling/prefix semantics and bump the embedding index contract so old vectors cannot be mixed with a different embedding space.

## Private query lifecycle

`PrivateArchiveQueryService` is the single main-process retrieval engine behind Vault questions and reusable Story/combined query surfaces.

```text
protected local user + question + scope
  -> validate selected Vault document IDs, if any
  -> for Story/combined scope: try deterministic confirmed-Story fact lookup
  -> load owned persistent Vault/Story chunks
  -> start/reuse Nomic only if semantic retrieval is required
  -> embed one English query
     OR original + local English translation for supported non-English input
  -> rank eligible Story + Vault candidates together
  -> keep at most top 3 chunks total
  -> start/reuse shared Qwen generation runtime
  -> grounded answer + display-safe source excerpts
```

There is **one shared retrieval budget of three chunks**. It is not three Vault chunks plus three Story chunks. Citation display is deduplicated after chunk ranking so repeated chunks from one logical source do not widen the context budget.

### Deterministic Story fast path

High-confidence factual questions for a small fixed set of confirmed Story fields can be answered from the canonical Story row without Nomic or Qwen. The current direct intents include full name, preferred name, roots, languages, occupation, and education.

If phrase matching is not high confidence, the request falls back to semantic retrieval rather than guessing.

### One Qwen model, two generation budgets

Both generated-answer routes use **Qwen3.5-0.8B Q4_K_M** on the same local server:

```text
fast      normal grounded answer       max 192 output tokens
complex   explicit combined synthesis  max 384 output tokens
```

The route distinction is now a response-budget/policy distinction, **not a model-selection distinction**. There is no H-Micro fallback and no second generator download.

For supported non-English retrieval planning, the same Qwen runtime can produce a short local English retrieval translation before Nomic embeds both useful query forms.

No conversation transcript is automatically injected. Qwen receives only the current request and the selected retrieved private-source context. If no usable context is found, the service returns a scope-appropriate local not-found answer and does not start generation.

### Asking from the app

The AI Assistant ("Ask Private AI") exposes four scopes over the desktop `vault.ask` contract: `story-and-vault` (default, the engine's `combined`), `story`, `all` (all Vault documents) and `documents` (selected Vault documents). Sources are `{ sourceType: 'document', documentId, fileName, excerpt }` or `{ sourceType: 'story', chapter, label, excerpt }`.

When the retrieved context does not answer the question, Qwen is asked to reply `NOT_FOUND`. The service then returns the scope's local not-found answer with **no sources**. A worded refusal in the first sentence also drops the sources, but keeps the text.

## Large documents: measured behaviour

Measured on 2026-10-01 on an Intel Core i3-1215U laptop (6 cores / 8 threads, 16 GB, AC power) with three Project Gutenberg books carrying planted facts at 10%, 50% and 90% depth:

| Document | Text | Sections (chunks) | Indexing time |
|---|---:|---:|---:|
| Pride and Prejudice (TXT) | 716k chars | 855 | 5 min 54 s |
| Moby-Dick (PDF, ~400 pages) | 1.2M chars | 1,436 | 13 min (questions asked meanwhile) |
| War and Peace (DOCX) | 3.2M chars | 3,770 | 22 min |

- **Upload and text extraction** of all three (905k words) took under 10 seconds.
- **Indexing** runs at about **2–2.9 sections per second** and is CPU-bound. Nomic v1.5 Q4 processes about 500 tokens/s on this CPU. Batching, parallel slots, a Q8 model and more threads did not help. bge-small (33M) was 2.4x faster, at some retrieval quality cost; a change would need an index version bump.
- **Documents index one at a time**, holding the Vault lock only to mark them and to write their chunks. The Vault stays usable, and progress ("Indexing… 412 of 3,741 sections") refreshes every 2 s.
- **Questions take priority**: indexing pauses between chunks while one is answered. During indexing, answers took 40–57 s before this, and take 4–8 s now.
- **Answer latency** with ~6,000 chunks and nothing indexing: **1.0–1.3 s**.
- **Retrieval (vector only)**: 8 of 9 planted facts were answered correctly. Six ranked #1 and two #2 among ~6,000 chunks. The miss ("Where is the family Bible kept?") ranked #4, because a one-sentence fact inside 1,000 characters of 19th-century prose is diluted and its common words match much of the book.
- **Retrieval (hybrid, 2026-10-03)**: 9 of 9 planted facts rank in the top 3 (eight #1, one #2); the family Bible fact moved from #4 to #1 and is now answered correctly in the app. See *Hybrid search* below.

## Hybrid search

Every question is ranked two ways over the sections in scope, and the two rankings are fused:

- **Meaning (vector)**: cosine similarity between the Nomic query embedding and each stored chunk embedding. Finds rewordings.
- **Keywords (BM25)**: `src/main/ai/keywordSearch.ts`. Words are lowercased with accents and possessives removed; question words such as "where is the" are ignored; Chinese and Japanese are split into overlapping character pairs because they are written without spaces. Rare words (names, numbers, places) count most. Finds exact terms that a large document can bury.
- **Fusion**: reciprocal rank fusion (`1 / (60 + rank)` from each ranking, summed). A chunk ranked well by either method rises, and one ranked well by both wins. The top 3 go to the answer model as before.

The keyword index is built in memory, in the main process, the first time a set of sections is searched (about 1 s for 6,000 sections), and cached for the three most recent scopes, keyed by a hash of the exact sections. Later questions take 5–11 ms for keyword ranking and fusion. Any change to the sections (re-indexing, a confirmed My Story edit) changes the hash, so the index is rebuilt. Nothing extra is stored on disk, so no migration or backfill is needed.

## Persistent vector stores

Vault chunks live in `vault_chunks` and derive ownership through `vault_documents.local_user_id`. Story chunks live in `story_chunks` and derive ownership/confirmation state through their `story_answers` row.

Embeddings are serialized as exact-range Float32 bytes in SQLite BLOBs and decoded only in the main process. Invalid vectors and incompatible embedding model/version rows are skipped rather than sent to generation.

Replacing an index is transactional. Deleting or invalidating owning content removes or stales its corresponding chunks so old private text is not silently queryable.

## Privacy and trust boundaries

Private AI, Vault content, and My Story content have no Circle-content path and no cloud fallback.

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
generationModel
nomicModel
llama-server.exe
AI runtime ports/endpoints
AI child-process/PID details
```

Production renderer access stays narrow:

- `window.familyCircle.vault` is accessed only by `DesktopVaultClient`.
- `window.familyCircle.privateAi` is accessed only by `DesktopPrivateAiClient`.
- Story operations use the typed Story client/preload surface.
- Feature components do not call localhost model endpoints directly.

The query engine derives the local user from the protected desktop session. Renderer-supplied identity is not accepted. Selected Vault IDs are revalidated against that user before chunk retrieval. Story chunks are queried only through the same user's confirmed/ready rows.

Generation receives at most the three ranked local chunks needed for the current question. It does not send private content to the Circle compatibility adapter or an external AI service.

## Developer benchmark

`scripts/benchmark-private-ai.mjs` is an explicit developer tool. It benchmarks the **fast** and **complex** Qwen token budgets against the same loopback generation endpoint. It is not called by app startup, `npm run check`, Desktop shell CI, or the Windows packaging workflow.

The Qwen llama.cpp server must already be running locally:

```bash
node scripts/benchmark-private-ai.mjs --fixtures ./private-ai-benchmark-fixtures.json --model both
```

The harness permits only `http://127.0.0.1` endpoints and emits one JSON line per fixture/mode pair containing:

```text
caseId
model              fast | complex
firstTokenMs
totalMs
generatedTokens
peakRssBytes
correct
grounded
```

`firstTokenMs` comes from streaming output. `generatedTokens` is populated when the local server reports usage. `peakRssBytes` remains `null` because the benchmark process cannot safely infer the RSS of the separately managed llama.cpp process.

## Shutdown

The main process owns every llama.cpp child it starts. Application shutdown stops the managed embedding and shared Qwen generation processes before database close. Family Circle does not attach to or kill unrelated system processes.

## Manual Windows clean-machine acceptance test

1. **Clean state** — confirm there is no existing `<userData>/offline-ai` installation.
2. **Private data before AI** — upload Vault documents and edit My Story before setup.
3. **Explicit setup** — confirm no AI download begins until the user starts setup.
4. **Pause/resume** — pause during transfer and confirm valid partial bytes are reused.
5. **Verified ready** — confirm setup reaches `ready` only after all three required assets verify and `llama-server.exe` exists.
6. **Persistent indexing** — confirm Nomic indexes extraction-ready Vault documents and confirmed Story answers without re-upload/re-entry.
7. **Known-answer Vault RAG** — confirm grounded answer and source excerpt.
8. **Direct Story fact** — confirm supported direct facts do not start semantic/generation runtimes.
9. **Fast Qwen answer** — confirm a normal grounded question uses the shared Qwen runtime with the 192-token budget.
10. **Complex Qwen answer** — confirm an explicit combined comparison uses the same Qwen runtime with the 384-token budget.
11. **Offline question** — disconnect from the internet and confirm indexed/direct private questions still work.
12. **User isolation** — confirm another local account cannot retrieve first-user Vault or Story content.
13. **Lifecycle cleanup** — exit Family Circle and confirm both managed llama.cpp processes stop.

Also verify failure paths: corrupt a required asset and confirm `repair_required`; retry indexing without re-uploading; ask with another account's selected document ID and confirm safe rejection; stop Qwen and confirm generation fails locally without any cloud fallback.

## CI contract

CI must never download or start the real ~671 MiB AI stack. Downloader, runtime, model-server, planner, ranking, and health behavior is exercised with injected fakes/ports plus SQLite-backed security tests.

The merge gate is:

```bash
npm run check
npm audit --audit-level=high
```

`npm run check` covers TypeScript, Vitest, architecture-boundary verification, and Electron/renderer production builds. `VaultRagSecurity.test.ts` blocks regressions in cross-user isolation, no cloud/Circle path, no query-time document re-embedding, explicit-only downloads, Nomic-only indexing, lazy runtime construction, and AI-independent upload/extraction. `PrivateArchiveQueryService.test.ts` covers deterministic/direct routing, the shared top-three budget, Story/Vault ranking, multilingual planning, safe source projection, and both Qwen generation budgets.
