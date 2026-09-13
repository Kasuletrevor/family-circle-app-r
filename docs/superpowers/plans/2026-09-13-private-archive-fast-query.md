# Private Archive Fast Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route ordinary local Story/Vault questions through a deterministic-first, shared-top-3 retrieval pipeline backed by a 350M fast generator, while retaining H-Micro for explicitly complex synthesis.

**Architecture:** `PrivateArchiveQueryService` becomes the query engine behind the existing Vault query façade and the future Story/combined UI. It ranks persistent `vault_chunks` and `story_chunks` together, uses at most three chunks, answers high-confidence confirmed Story facts without embeddings or generation, and selects a fast or complex local generation port through deterministic routing. Existing renderer contracts stay Vault-only in this slice; Task 13 can expose Story/combined scope after the backend is proven.

**Tech Stack:** Electron 44, TypeScript 7, `node:sqlite`, Vitest 4, existing llama.cpp b8772, Nomic embed-text v1.5 Q4_K_M, IBM Granite 4.0 350M Q4_K_M fast model, existing Granite 4.0 H-Micro Q4_K_M complex model.

**Spec:** `docs/superpowers/specs/2026-09-13-private-archive-fast-query-design.md`

## Global Constraints

- `MAX_RETRIEVAL_CHUNKS = 3`; combined retrieval has one shared budget, never per-source quotas.
- Direct confirmed-Story facts bypass Nomic and both generation models.
- English retrieval embeds one query. Supported non-English retrieval may embed original + local English translation.
- Fast normal generation caps output at 192 tokens.
- Complex generation caps output at 384 tokens.
- Fast generation uses loopback port 8082; existing H-Micro remains on 8080; Nomic remains on 8081.
- Fast model asset: `granite-4.0-350m-Q4_K_M.gguf`, 236985760 bytes, SHA-256 `771C588A49607F274A2BBA3185733607EBE6F74B996AB90E2D6BEE0D98BCEC52`.
- No conversation transcript is automatically passed into generation.
- Story/Vault ownership is derived/revalidated in main; no local user ID is accepted from renderer.
- No cloud generation, embedding, translation, or fallback.
- PR #11 remains independent and unmerged; this branch is based on `main` and must not import its renderer-only Task 11 files.

---

### Task 1: Fast Granite asset, runtime, and generation client

**Files:**
- Modify: `config/offline-ai-manifest.json`
- Modify: `src/main/ai/privateAiModels.ts`
- Modify: `src/main/ai/OfflineAiAssetService.ts`
- Modify: `src/main/ai/OfflineAiAssetService.test.ts`
- Modify: `src/main/ai/AiRuntimeManager.ts`
- Modify: `src/main/ai/AiRuntimeManager.test.ts`
- Create: `src/main/ai/FastGraniteClient.ts`
- Create: `src/main/ai/FastGraniteClient.test.ts`

**Interfaces:**

```ts
export type OfflineAiAssetType = 'runtime' | 'model' | 'fast-model' | 'embedding'

export interface InstalledAiPaths {
  llamaDir: string
  serverExe: string
  graniteModel: string
  fastGraniteModel: string
  nomicModel: string
}

AiRuntimeManager.ensureFastGenerationRuntime(): Promise<boolean>
FastGraniteClient.generate(question: string, context: string): Promise<string>
FastGraniteClient.translateForRetrieval(question: string): Promise<string>
```

- [ ] **Step 1: Write RED tests** proving manifest pin, asset verification, upgrade reuse, fast runtime port/model/2048 context, 192-token answer cap, and concise translation output.
- [ ] **Step 2: Run RED:**

```bash
npx vitest run src/main/ai/OfflineAiAssetService.test.ts src/main/ai/AiRuntimeManager.test.ts src/main/ai/FastGraniteClient.test.ts
```

Expected: FAIL because `fast-model`, `fastGraniteModel`, `ensureFastGenerationRuntime`, and `FastGraniteClient` do not exist.

- [ ] **Step 3: Implement minimal production behavior.** Increment offline AI manifest version to `1.1.0`, add the IBM 350M required model, verify it with the exact byte/hash contract, launch it on port 8082 with `--ctx-size 2048`, and keep its client prompt grounded in provided private-source context only.
- [ ] **Step 4: Run GREEN** with the same focused command.
- [ ] **Step 5: Commit** as `feat: add fast private AI generator`.

---

### Task 2: Deterministic Story facts, multilingual query planning, and complexity routing

**Files:**
- Create: `src/main/ai/PrivateQueryPlanner.ts`
- Create: `src/main/ai/PrivateQueryPlanner.test.ts`
- Create: `src/main/story/StoryDirectAnswerService.ts`
- Create: `src/main/story/StoryDirectAnswerService.test.ts`

**Interfaces:**

```ts
export type PrivateGenerationRoute = 'fast' | 'complex'

planRetrievalQueries(input: {
  question: string
  language?: string
  translateToEnglish?: (question: string) => Promise<string>
}): Promise<string[]>

selectGenerationRoute(input: {
  question: string
  scopeType: 'vault' | 'story' | 'combined'
}): PrivateGenerationRoute

StoryDirectAnswerService.answer(localUserId: number, question: string): Promise<PrivateDirectAnswer | null>
```

`PrivateDirectAnswer` contains answer text plus display-safe Story provenance only.

- [ ] **Step 1: Write RED tests** for six Story fact intents, confirmed-only behavior, foreign-user isolation, English single-query planning, non-English original+translation planning, translation failure fallback, and complex routing only for explicit combined synthesis.
- [ ] **Step 2: Run RED:**

```bash
npx vitest run src/main/ai/PrivateQueryPlanner.test.ts src/main/story/StoryDirectAnswerService.test.ts
```

- [ ] **Step 3: Implement** high-confidence normalized phrase matching only. Do not use fuzzy LLM intent classification for the direct path.
- [ ] **Step 4: Run GREEN** with the same focused command.
- [ ] **Step 5: Commit** as `feat: add fast private query routing`.

---

### Task 3: Shared top-3 Story + Vault retrieval service

**Files:**
- Create: `src/main/ai/PrivateArchiveQueryService.ts`
- Create: `src/main/ai/PrivateArchiveQueryService.test.ts`
- Modify: `src/main/vault/VaultQueryService.ts`
- Modify: `src/main/vault/VaultQueryService.test.ts`

**Interfaces:**

```ts
export type PrivateArchiveScope =
  | { type: 'vault'; vault: { type: 'all' } | { type: 'documents'; documentIds: number[] } }
  | { type: 'story' }
  | { type: 'combined'; vault: { type: 'all' } | { type: 'documents'; documentIds: number[] } }

export type PrivateArchiveSource =
  | { sourceType: 'document'; fileName: string; excerpt: string }
  | { sourceType: 'story'; chapter: string; label: string; fileName: string; excerpt: string }

PrivateArchiveQueryService.ask(input: {
  question: string
  scope: PrivateArchiveScope
  language?: string
}): Promise<{ answer: string; sources: PrivateArchiveSource[]; route: 'direct' | 'fast' | 'complex' }>
```

The existing `VaultQueryService.ask()` remains source-compatible and delegates to `PrivateArchiveQueryService` with a `vault` scope, mapping its sources back to the existing Vault public DTO.

- [ ] **Step 1: Write RED tests** proving session ownership, selected-document revalidation, Story confirmed/ready-only loading, one or two query embeddings as planned, malformed vector skipping, one shared rank across candidate types, top-3 maximum, citation dedupe by logical source, no-context short-circuit, direct-answer short-circuit, fast normal route, complex combined route, and local H-Micro fallback when fast runtime/generation fails.
- [ ] **Step 2: Run RED:**

```bash
npx vitest run src/main/ai/PrivateArchiveQueryService.test.ts src/main/vault/VaultQueryService.test.ts
```

- [ ] **Step 3: Implement** with `cosineSimilarity`; never re-embed stored chunks. Build generation context from no more than three ranked candidates and display-safe source labels.
- [ ] **Step 4: Run GREEN** with the same focused command.
- [ ] **Step 5: Commit** as `feat: rank private Story and Vault context together`.

---

### Task 4: Main-process wiring, benchmark harness, and full verification

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/main.test.ts` or the existing composition test that owns Private AI service wiring
- Create: `scripts/benchmark-private-ai.mjs`
- Create: `src/main/ai/privateAiBenchmarkContract.test.ts`
- Modify: `README.md`

**Interfaces:**

The benchmark accepts loopback fast/complex generation endpoints and writes one JSON result per fixture with:

```ts
{
  caseId: string
  model: 'fast' | 'complex'
  firstTokenMs: number | null
  totalMs: number
  generatedTokens: number | null
  peakRssBytes: number | null
  correct: boolean | null
  grounded: boolean | null
}
```

- [ ] **Step 1: Write RED composition/benchmark-contract tests** proving main constructs one `PrivateArchiveQueryService`, existing Vault IPC still receives a `VaultQueryService`, both generation clients are local-only, and the benchmark contains the approved correctness/latency comparison fields.
- [ ] **Step 2: Run RED:**

```bash
npx vitest run src/main/ai/privateAiBenchmarkContract.test.ts src/main/main.test.ts
```

Use the repository's actual composition test path if `src/main/main.test.ts` does not exist; do not invent a second composition harness.

- [ ] **Step 3: Implement wiring and benchmark script.** The benchmark must not run in normal app startup or CI because model binaries are intentionally absent there.
- [ ] **Step 4: Run focused GREEN, then full gate:**

```bash
npm run check
npm audit --audit-level=high
```

- [ ] **Step 5: Run exact-head Linux CI and Windows packaging.** Windows must still package manifests/licenses only and must not package GGUF/runtime binaries.
- [ ] **Step 6: Review changed-file scope, raw error handling, loopback-only generation, and PR threads; fix regressions with RED tests first.
- [ ] **Step 7: Commit** as `feat: route private archive queries for low latency` and mark the PR review-ready only after exact-head gates are green.
