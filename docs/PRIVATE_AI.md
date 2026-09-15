# Private AI + Private Archive Retrieval

Family Circle's Private AI is an **optional, user-triggered local capability** layered on top of the private Vault and confirmed My Story memories. PDF, DOCX, and TXT upload/storage/extraction and Story editing work without AI. Installing or repairing Private AI is never required to keep using those local features.

The Private AI path is owned by the Electron main process. React receives only safe setup progress, index status, answers, and short source excerpts. Model paths, local endpoints, process details, embeddings, full extracted text, stored paths, hashes, and local user IDs never cross the desktop boundary.

## Runtime contract

Private AI uses the manifest in `config/offline-ai-manifest.json`. The current manifest version is `1.1.0` and requires four verified assets:

| Friendly name | Asset | Expected bytes | Expected SHA-256 |
| --- | --- | ---: | --- |
| AI engine | llama.cpp b8772 Windows CPU x64 runtime ZIP | 39,870,081 | `1C18C414B86E8F84D61D003F8605159ACF97492EEECF6891B2D879AF4A0DBFD2` |
| AI knowledge | IBM Granite 4.0 H Micro Q4_K_M GGUF | 1,942,564,512 | `BCC78B9B25450101D1AD90D4B9A264E1BAC892F534DFB76066F4EEC792FDF023` |
| AI fast answers | IBM Granite 4.0 350M Q4_K_M GGUF | 236,985,760 | `771C588A49607F274A2BBA3185733607EBE6F74B996AB90E2D6BEE0D98BCEC52` |
| AI search | Nomic Embed Text v1.5 Q4_K_M GGUF | 84,106,624 | `D4E388894E09CF3816E8B0896D81D265B55E7A9FFF9AB03FE8BF4EF5E11295AC` |

The combined required transfer is **2,303,526,977 bytes (about 2.15 GiB)**. The URLs and technical asset metadata are main-process/developer configuration, not renderer data.

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
│   ├── granite-4.0-350m-Q4_K_M.gguf
│   └── nomic-embed-text-v1.5.Q4_K_M.gguf
└── .staging/
    └── 1.1.0/
        └── ... resumable .part downloads ...
```

The version marker is written only after every required asset verifies. Model files must match both the immutable expected byte size and SHA-256. The llama.cpp ZIP is verified before extraction and `llama-server.exe` must exist in the extracted target before the runtime can be considered installed.

Partial `.part` files are not considered installed. Setup can pause and resume using HTTP Range requests. If a server ignores a resume request, the downloader restarts that file safely rather than appending incompatible bytes. Existing verified files are reused when a manifest upgrade adds a new required asset.

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
- Vault upload and Story editing do **not** trigger setup.
- `Start setup` downloads/verifies the configured assets.
- `Pause` preserves valid partial bytes.
- Continue resumes the staged transfer.
- `Repair` removes the installed marker and re-runs verified setup.

No setup state disables Vault upload, local extraction, or Story drafting/confirmation.

## Lazy llama.cpp lifecycle

`AiRuntimeManager` starts no AI process at construction or normal app startup. It owns three independent llama.cpp server lifecycles:

```text
Granite H-Micro complex generation   developer-only port 8080
Nomic embedding/search               developer-only port 8081
Granite 350M fast generation         developer-only port 8082
```

These ports and endpoints are internal implementation details. They must never appear in the public desktop contract or production renderer code. All three servers bind only to local loopback use through main-process clients.

## Indexing lifecycle

Indexing uses **Nomic only**. Generation models are not required for document or Story indexing.

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

Draft Story answers are not queryable. Editing previously confirmed text invalidates its old chunks until the changed answer is explicitly confirmed and indexed again. Query-time Story retrieval joins through `story_answers` and requires both `confirmed = 1` and `index_status = 'ready'`.

The exact document prefix is:

```text
search_document: <chunk text>
```

Embedding model/version compatibility is checked before a stored chunk is ranked. `EMBEDDING_INDEX_VERSION` is currently `1`.

Existing chunks are embedded once per index operation and persisted. They are **not re-embedded for each question**.

## Low-latency private query lifecycle

`PrivateArchiveQueryService` is the one main-process retrieval engine behind the existing Vault query façade and future Story/combined query surfaces.

The approved order is:

```text
protected local user + question + scope
  -> validate selected Vault document IDs, if any
  -> for Story/combined scope: try deterministic confirmed-Story fact lookup
  -> load owned persistent Vault/Story chunks for the scope
  -> start/reuse Nomic only if semantic retrieval is required
  -> embed one English query
     OR original + local English translation for supported non-English input
  -> score all eligible Story + Vault candidates in one shared rank
  -> keep at most top 3 chunks total
  -> default: start/reuse Granite 350M fast generator
  -> explicit complex combined synthesis: use Granite H-Micro
  -> if the fast generator fails/unavailable: local H-Micro fallback only
  -> grounded answer + display-safe source excerpts
```

The exact query prefix is:

```text
search_query: <question>
```

There is **one shared retrieval budget of three chunks**. It is not three Vault chunks plus three Story chunks. Citation/source display is deduplicated after chunk ranking so multiple high-scoring chunks from one logical source cannot widen the context budget.

### Deterministic Story fast path

High-confidence factual questions for a small fixed set of confirmed Story fields can be answered directly from the canonical Story row without Nomic or either generation model. The current direct intents include full name, preferred name, roots, languages, occupation, and education.

This path remains confirmed-only and user-owned. If phrase matching is not high confidence, the request falls back to semantic retrieval rather than guessing.

### Generation routes

Normal grounded questions use Granite 4.0 350M with a maximum of **192 output tokens**.

Explicit complex synthesis over combined private sources uses Granite 4.0 H-Micro with a maximum of **384 output tokens**. The H-Micro prompt is private-archive grounded rather than Vault-only.

No conversation transcript is automatically injected into either model. Both receive only the current question plus the selected retrieved private-source context.

If no usable context is found, the service returns a scope-appropriate local not-found answer and does not start a generation model.

## Persistent vector stores

Vault chunks are stored in `vault_chunks` and derive ownership through `vault_documents.local_user_id`:

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

Story chunks are stored in `story_chunks` and derive ownership/confirmation state through their `story_answers` row.

Embeddings are serialized as exact-range Float32 bytes in SQLite BLOBs and decoded only inside the main process. Invalid/malformed vectors and incompatible embedding model/version rows are skipped at query time rather than exposed to generation.

Replacing an index is transactional. Deleting or invalidating the owning content removes/stales its corresponding chunks so old private text is not silently queryable.

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
graniteModel
fastGraniteModel
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

The private query engine derives the local user from the protected desktop session. Renderer-supplied identity is not accepted. Selected Vault IDs are revalidated against that user before chunk retrieval. Story chunks are queried only through the same user's confirmed/ready rows.

Generation receives at most the three ranked local chunks needed for the current question. It does not send private content to Jose's Circle compatibility adapter or to an external AI service.

## Developer benchmark

`scripts/benchmark-private-ai.mjs` is an explicit developer tool for comparing the fast and complex local generators. It is **not** called by app startup, `npm run check`, Desktop shell CI, or the Windows packaging workflow.

The llama.cpp servers must already be running locally. Example:

```bash
node scripts/benchmark-private-ai.mjs --fixtures ./private-ai-benchmark-fixtures.json --model both
```

Fixture JSON is a non-empty array. Each case requires:

```json
{
  "caseId": "known-family-fact",
  "question": "Where was grandmother born?",
  "context": "Grandmother was born in Jinja.",
  "expectedIncludes": ["Jinja"],
  "groundingIncludes": ["Jinja"],
  "forbiddenIncludes": ["Kampala"]
}
```

The harness permits only `http://127.0.0.1` endpoints. It emits one JSON line per fixture/model pair with:

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

`firstTokenMs` is measured from streaming output. `generatedTokens` is populated when the local server reports usage. `correct` and `grounded` are `null` when the fixture does not provide rules for those judgments. `peakRssBytes` is currently `null` because the benchmark process cannot safely infer the RSS of separately managed llama.cpp server processes; it deliberately does not report its own RSS as model memory.

## Shutdown

The main process owns every llama.cpp child it starts. Application shutdown stops the managed embedding, fast-generation, and complex-generation processes before database close. Family Circle does not attach to or kill unrelated system processes.

## Manual Windows clean-machine acceptance test

Run this sequence on a clean Windows machine before release. Use small known-answer documents and confirmed Story memories so grounding is easy to inspect.

1. **Clean state** — confirm there is no existing `<userData>/offline-ai` installation.
2. **Private data before AI** — upload Vault documents and edit My Story; confirm those local features work before setup.
3. **Explicit setup** — click the Private AI setup action; confirm no download began before that user action.
4. **Pause/resume** — pause during transfer, confirm partial bytes remain, continue, and confirm valid partial data is reused.
5. **Verified ready** — confirm setup reaches `ready` only after all four required assets pass configured verification and the runtime executable exists.
6. **Persistent indexing** — confirm Nomic indexes extraction-ready documents and confirmed Story answers without re-upload/re-entry.
7. **Known-answer Vault RAG** — ask a question whose answer exists in a Vault document; confirm the answer and source excerpt are grounded.
8. **Direct Story fact** — for a supported confirmed field, confirm the answer works without starting semantic/generation runtimes where the direct path applies.
9. **Fast generated answer** — ask a normal grounded question requiring synthesis and confirm the 350M route is usable.
10. **Offline question** — disconnect from the internet and confirm indexed/direct private questions still work.
11. **User isolation** — switch to another local account; confirm the other account cannot list/select/retrieve first-user Vault or Story content.
12. **Lifecycle cleanup** — exit Family Circle and confirm all managed llama.cpp processes stop.

Also verify failure paths: corrupt a required asset and confirm `repair_required`; retry indexing without re-uploading; ask with a selected document ID from another account and confirm a safe rejection; stop the fast generator and confirm fallback stays local.

## CI contract

CI must never download or start the real ~2.15 GiB AI stack. Downloader, runtime, model-server, planner, ranking, and health behavior is exercised with injected fakes/ports plus SQLite-backed security tests.

The merge gate is:

```bash
npm run check
npm audit --audit-level=high
```

`npm run check` covers TypeScript, Vitest, architectural boundary verification, and Electron/renderer production builds. `VaultRagSecurity.test.ts` adds merge-blocking regressions for cross-user isolation, no cloud/Circle path, no query-time document re-embedding, explicit-only downloads, Nomic-only indexing, lazy runtime construction, and AI-independent upload/extraction. `PrivateArchiveQueryService.test.ts` covers deterministic/direct routing, the shared top-three budget, Story/Vault ranking, multilingual query planning, safe source projection, and local-only generation fallback.
