# Private Archive Fast Query Design

**Status:** Approved architectural amendment for My Story Tasks 12–13.

**Supersedes:** The retrieval-count, query-embedding-count, and generation-routing details in `docs/superpowers/specs/2026-09-10-my-story-design.md` where this document is more specific.

## Goal

Make private Story/Vault questions feel immediate on ordinary hardware while preserving local-only privacy, confirmed-only Story retrieval, strict ownership, and source-grounded answers.

## Reference behavior retained

The legacy Family Circle reference implementation established several useful product behaviors that this rebuild should retain without copying its weaker security/runtime design:

- only confirmed My Story memories are searchable;
- My Story can be queried by itself;
- Vault documents can be queried by themselves;
- combined mode means My Story plus the currently selected Vault document scope;
- source-specific conversations and suggestions are UI behavior, not hidden model context;
- deterministic high-confidence personal facts should bypass generative RAG when possible;
- Story provenance is first-class and renders as `My Story › <Chapter> › <Memory>`;
- multilingual retrieval may use both the original question and an English retrieval translation.

Persistent `story_chunks` and `vault_chunks` remain authoritative in the rebuild. The reference behavior of re-chunking and re-embedding all source text on every question is explicitly rejected.

## Retrieval budget

`MAX_RETRIEVAL_CHUNKS = 3`.

The budget is shared across all selected private sources. Combined mode does not reserve quotas. A result may therefore contain 3 Story chunks, 3 Vault chunks, or any mixture such as 2 Story + 1 Vault.

Visible citations are deduplicated by logical source after ranking. Granite receives at most three retrieved chunks; the UI may show fewer than three citations when multiple chunks belong to the same Story memory or Vault document.

## Query scopes

The private archive supports:

```text
Vault
  ├── all indexed documents
  └── selected indexed documents

My Story
  └── confirmed + ready Story chunks only

My Story + Vault
  ├── confirmed + ready Story chunks
  └── the same Vault document scope selected by the user
```

Renderer-supplied Vault document IDs are always revalidated against the protected local session. Story ownership is never supplied by the renderer.

## Fast path and complex path

The query pipeline is deterministic-first:

```text
question
  ↓
protected local session + scope validation
  ↓
high-confidence direct Story answer?
  ├── yes → return immediately; no embedding or LLM
  └── no
       ↓
load persistent candidate chunks
       ↓
create retrieval query embedding(s)
       ↓
rank together → shared top 3
       ↓
complex synthesis required?
       ├── no → fast 350M generator
       └── yes → existing Granite H-Micro generator
```

The default generator candidate is IBM Granite 4.0 350M, Q4_K_M GGUF, run locally by the existing llama.cpp runtime. It is an Apache-2.0 IBM model, approximately 237 MB, and remains replaceable behind the generation port if benchmark quality is inadequate.

Pinned first candidate:

- repository: `ibm-granite/granite-4.0-350m-GGUF`
- file: `granite-4.0-350m-Q4_K_M.gguf`
- exact size: `236985760` bytes
- SHA-256: `771C588A49607F274A2BBA3185733607EBE6F74B996AB90E2D6BEE0D98BCEC52`
- local fast generation port: `8082`

The existing Granite H-Micro model remains on port `8080` for explicitly complex synthesis. Nomic remains on `8081`.

Normal answers are capped at 192 generated tokens. Complex synthesis is capped at 384 generated tokens. Conversation history is retained by the UI but is not automatically inserted into model prompts.

## Complexity routing

The larger model is used only when the question explicitly asks for multi-source synthesis. The router selects the complex path for phrases such as compare, contrast, differences, reconcile, conflicting, synthesize, across my story and documents, or an equivalent supported-language intent in combined mode. Ordinary factual questions, single-source summaries, and short grounded explanations stay on the fast model.

A fast-model runtime failure may fall back to H-Micro if H-Micro is available. A low-confidence answer must not silently broaden source scope.

## Deterministic Story answers

A direct-answer layer handles only high-confidence fact intents that map cleanly to confirmed Story fields. V1 covers at least:

- full name;
- preferred name;
- roots / birthplace;
- languages;
- occupation;
- education.

The direct answer returns the same public provenance shape as RAG (`sourceType='story'`, chapter, label) and never reads drafts or failed/pending Story indexes as authoritative search context.

## Multilingual retrieval

English questions use one Nomic query embedding.

For supported non-English questions (`fr`, `es`, `pt`, `zh`, `ja`, `fil`), the system may create a short English retrieval translation using the fast local generator and embed both the original and translated queries. Each candidate chunk receives the maximum cosine score across those query embeddings. If translation fails, retrieval proceeds with the original question only.

This is the one approved exception to the earlier one-query-embedding rule.

## Generation prompt

Both generation models receive only:

- the user question;
- the selected three-or-fewer source chunks;
- display-safe source labels;
- a concise grounding instruction.

No local user ID, document ID, Story answer ID, path, model path, port, embedding, token, Circle identity, or conversation transcript enters the prompt.

## Model benchmark gate

The 350M model remains the fast-path default only if a repeatable local benchmark demonstrates:

- at least 90% grounded-answer correctness on the checked Story/Vault fixture set;
- no fabricated source facts on the fixture set;
- median total latency no more than 50% of H-Micro on the same machine and prompts;
- lower peak resident memory than H-Micro.

The benchmark records first-token latency, total latency, generated tokens, peak memory where available, selected route, answer correctness, and grounding result. If the 350M candidate fails quality, the routing interface stays unchanged and a different sub-2B model can replace it.

## Asset and upgrade behavior

The fast model is a required Private AI asset for this architecture. The offline AI manifest version increments. Existing valid llama.cpp, H-Micro, and Nomic files are reused; the downloader verifies and skips them, so an upgrade downloads only the missing fast model when those existing files remain valid.

The standard NSIS installer still contains only manifests/licenses, not model binaries.

## Security and failure behavior

- Story and Vault remain local-only.
- Circle adapters are never called by the private archive query path.
- scope validation occurs before chunk loading;
- Story queries load only confirmed answers whose `index_status='ready'`;
- malformed embeddings are skipped, not surfaced;
- no-context returns a safe source-specific response without generation;
- fast-model failure may use the complex local model but never a cloud service;
- all raw llama.cpp/SQLite/filesystem errors are mapped to safe service errors.

## Testing

Merge-blocking tests cover:

- one protected user cannot retrieve another user's Story or Vault chunks;
- combined mode validates every selected document ID;
- only three chunks total survive shared ranking;
- citations deduplicate logical sources;
- direct facts bypass Nomic and both generators;
- normal questions use the 350M route;
- explicit combined synthesis uses H-Micro;
- fast runtime failure falls back locally to H-Micro;
- English uses one query embedding;
- supported non-English retrieval can use original + translated query embeddings;
- translation failure falls back to original-only retrieval;
- no conversation transcript is passed to generation;
- no cloud/network fallback beyond loopback llama.cpp endpoints exists.
