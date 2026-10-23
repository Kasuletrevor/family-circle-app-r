# Guardian Angels on This Computer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person talk with their own Guardian Angel inside Family Circle, run on the local llama.cpp Qwen model, using their confirmed My Story memories, with the conversation kept only on this computer.

**Architecture:** The angel's recipe (instructions, tools, safety rules) comes from the Kin-Keepers.ai export endpoint and is cached in SQLite. For each message the main process checks fixed escalation word lists first. It then gathers what the recipe's tools ask for (first name, matching My Story sections, recent local history) and builds one chat prompt that fits the 4,096-token window. It sends that to the local llama-server and saves both sides to a local history table. The model never calls tools.

**Tech Stack:** Electron 44 main process (TypeScript, `node:sqlite`), llama.cpp `llama-server` on 127.0.0.1:8080 (`/v1/chat/completions`), React 19 + react-router 7, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-23-local-guardian-angels-design.md`

## Global Constraints

- Angels run only on llama.cpp and the installed Qwen model. Never read or use the marketplace's `model`, `runtime` or `execution_backend` fields.
- Family content is confirmed My Story sections only. No Vault access in this slice.
- Conversations stay on this computer: no network request carries a message, reply or history.
- Runnable templates (by slug): `elder-companion`, `family-content-storyteller`, `gentle-storytelling-template`, `post-visit-follow-up`, `elder-tech-confidence-coach`.
- Prompt budgets: instructions ≤ 4,000 chars; 3 story sections ≤ 900 chars each; history ≤ 6 messages and ≤ 1,800 chars; message ≤ 1,000 chars; reply ≤ 256 tokens.
- Each saved angel reply records `executionBackend: 'llama.cpp'` and the installed model file name without `.gguf`.
- History kept to the newest 200 messages per angel; clearing or removing an angel deletes its messages, and removing also deletes its recipe.
- Escalation replies are fixed text; the model is not called; no phone numbers.
- All user-visible copy in plain English, sentence case, as written in this plan.
- Run the whole check before the last commit: `npm run check`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/agenticChat.ts` (new) | Chat types and the safe parsers used by preload |
| `src/shared/agentic.ts` (modify) | `slug?` on templates, `runsHere` on angels, the runnable slug list |
| `src/main/agentic/catalogSanitizer.ts`, `GuardianAngelCatalog.ts`, `angelSanitizer.ts` (modify) | Carry the template slug; work out `runsHere` |
| `src/main/agentic/angelRecipe.ts` (new) | Sanitise the export package into an `AngelRecipe` |
| `src/main/agentic/MyGuardianAngels.ts` (modify) | `recipe(angelId)` via the export endpoint |
| `src/main/database/migrations.ts` (modify) | `angel_messages`, `angel_recipes` tables |
| `src/main/agentic/AngelHistoryRepository.ts` (new) | Local messages and cached recipes |
| `src/main/agentic/angelSafety.ts` (new) | Escalation word lists and fixed replies |
| `src/main/agentic/angelPrompt.ts` (new) | Build the chat messages within budget |
| `src/main/ai/QwenClient.ts` (modify) | `chat(messages, maxTokens)` |
| `src/main/ai/PrivateArchiveQueryService.ts` (modify) | `findStorySections(localUserId, query)` |
| `src/main/agentic/LocalAngelRunner.ts` (new) | open / send / clear / forget |
| `src/main/agentic/agenticIpc.ts`, `src/main/main.ts`, `src/shared/desktopApi.ts`, `src/preload/createDesktopApi.ts` (modify) | IPC wiring |
| `src/renderer/services/agentic/*`, `src/renderer/test/fakeAgenticClient.ts` (modify) | Renderer client |
| `src/renderer/features/agentic/AngelChatPage.tsx` (new), `MyGuardianAngelsPanel.tsx`, `App.tsx`, `agentic.css` (modify) | The conversation page and Talk button |

---

### Task 1: Runnable angels (`runsHere`) from the template slug

**Files:**
- Modify: `src/shared/agentic.ts`
- Modify: `src/main/agentic/catalogSanitizer.ts`
- Modify: `src/main/agentic/GuardianAngelCatalog.ts`
- Modify: `src/main/agentic/angelSanitizer.ts`
- Modify: `src/renderer/test/fakeAgenticClient.ts`
- Test: `src/main/agentic/catalogSanitizer.test.ts`, `src/main/agentic/angelSanitizer.test.ts`, `src/shared/agentic.angels.test.ts`

**Interfaces:**
- Produces: `LOCAL_ANGEL_TEMPLATE_SLUGS: ReadonlySet<string>`, `GuardianAngelTemplate.slug?: string`, `MyGuardianAngel.runsHere: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/agentic/catalogSanitizer.test.ts`:

```ts
it('keeps a safe template slug', () => {
  const [kept] = sanitizeCatalog([{ id: 7, name: 'Elder Companion', is_curated: true, slug: 'elder-companion' }])
  expect(kept!.template.slug).toBe('elder-companion')
  const [bad] = sanitizeCatalog([{ id: 8, name: 'X', is_curated: true, slug: '../Admin' }])
  expect(bad!.template.slug).toBeUndefined()
})
```

Add to `src/main/agentic/angelSanitizer.test.ts` (use the file's existing template map helper. If it has none, build `new Map([['7', { id: '7', name: 'Elder Companion', description: '', category: 'elder_companion', trustBoundaries: [], escalationTriggers: [], avatar: null, slug: 'elder-companion' }]])`):

```ts
it('marks angels from a runnable template as running here', () => {
  const templates = new Map([
    ['7', { id: '7', name: 'Elder Companion', description: '', category: 'elder_companion' as const, trustBoundaries: [], escalationTriggers: [], avatar: null, slug: 'elder-companion' }],
    ['51', { id: '51', name: 'Memory Screening', description: '', category: 'elder_companion' as const, trustBoundaries: [], escalationTriggers: [], avatar: null, slug: 'memory-screening-guide-template' }],
  ])
  expect(sanitizeAngel({ id: 5, name: 'A', original_agent_id: 7 }, templates)!.runsHere).toBe(true)
  expect(sanitizeAngel({ id: 6, name: 'B', original_agent_id: 51 }, templates)!.runsHere).toBe(false)
  expect(sanitizeAngel({ id: 7, name: 'C', original_agent_id: null }, templates)!.runsHere).toBe(false)
})
```

Add to `src/shared/agentic.angels.test.ts`:

```ts
it('requires runsHere to be a boolean and keeps it in the public shape', () => {
  const angel = { id: '5', name: 'A', description: '', templateId: null, templateName: null, avatar: null, runCount: 0, lastRunAt: null, trustBoundaries: [], escalationTriggers: [], runsHere: true }
  expect(isMyGuardianAngel(angel)).toBe(true)
  expect(isMyGuardianAngel({ ...angel, runsHere: 'yes' })).toBe(false)
  expect(publicAngel(angel).runsHere).toBe(true)
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run src/main/agentic/catalogSanitizer.test.ts src/main/agentic/angelSanitizer.test.ts src/shared/agentic.angels.test.ts`
Expected: FAIL (`slug` undefined, `runsHere` undefined).

- [ ] **Step 3: Implement**

In `src/shared/agentic.ts`:
- Add after the `GuardianAngelTemplate` interface:

```ts
/** Templates whose angels Family Circle can run on this computer, by template slug. */
export const LOCAL_ANGEL_TEMPLATE_SLUGS: ReadonlySet<string> = new Set([
  'elder-companion',
  'family-content-storyteller',
  'gentle-storytelling-template',
  'post-visit-follow-up',
  'elder-tech-confidence-coach',
])
```

- Add to `GuardianAngelTemplate`: `/** The template's stable name on Kin-Keepers.ai, e.g. "elder-companion". */ slug?: string`.
- Add to `MyGuardianAngel`: `/** True when Family Circle can run this angel on this computer. */ runsHere: boolean`.
- In `isMyGuardianAngel` add `&& typeof raw.runsHere === 'boolean'`.
- In `publicAngel` add `runsHere: angel.runsHere,`.

In `src/main/agentic/catalogSanitizer.ts`, inside `sanitizeCatalog` before `result.push`:

```ts
    const slug = typeof entry.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(entry.slug) ? entry.slug : undefined
```

and add `...(slug ? { slug } : {}),` to the `template` object.

In `src/main/agentic/GuardianAngelCatalog.ts` change the saved version from 1 to 2 everywhere (`interface SavedCatalog { version: 2; ... }`, the `refresh()` literal, and `load()`'s check and assignment). That way a cache saved before slugs existed is downloaded again.

In `src/main/agentic/angelSanitizer.ts` import `LOCAL_ANGEL_TEMPLATE_SLUGS` and add to the returned object:

```ts
    runsHere: Boolean(template?.slug && LOCAL_ANGEL_TEMPLATE_SLUGS.has(template.slug)),
```

In `src/renderer/test/fakeAgenticClient.ts` add `runsHere: true,` to `SAMPLE_ANGEL`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/main/agentic src/shared && npm run typecheck`
Expected: PASS. Fix any other object literal of `MyGuardianAngel` that typecheck reports by adding `runsHere: false`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agentic.ts src/main/agentic src/renderer/test/fakeAgenticClient.ts src/shared/agentic.angels.test.ts
git commit -m "feat: mark angels Family Circle can run on this computer"
```

---

### Task 2: The angel's recipe from the export endpoint

**Files:**
- Create: `src/main/agentic/angelRecipe.ts`
- Test: `src/main/agentic/angelRecipe.test.ts`
- Modify: `src/main/agentic/MyGuardianAngels.ts`
- Test: `src/main/agentic/MyGuardianAngels.test.ts`

**Interfaces:**
- Produces:
  - `interface AngelRecipe { angelId: string; name: string; instructions: string; tools: string[]; trustBoundaries: string[]; escalationKeys: string[] }`
  - `sanitizeRecipe(angelId: string, raw: unknown): AngelRecipe | null`
  - `isAngelRecipe(value: unknown): value is AngelRecipe`
  - `MyGuardianAngels.recipe(angelId): Promise<RecipeResult>`, where `type RecipeResult = { status: 'ready'; recipe: AngelRecipe } | { status: 'disconnected' | 'unavailable' | 'not-yours' }`

- [ ] **Step 1: Write the failing tests**

`src/main/agentic/angelRecipe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isAngelRecipe, sanitizeRecipe } from './angelRecipe'

const pkg = (extra: Record<string, unknown> = {}) => ({
  schema_version: '1.0',
  agent: { name: 'Morning Check-in' },
  config: { model: 'gpt-4o', instructions: 'Be warm.\u0007', tools: ['get_elder_profile', 'get_family_content', 'BAD TOOL'] },
  runtime: { execution_backend: 'openai' },
  safety: { trust_boundaries: ['no_medical_advice'], escalation_triggers: ['self_harm_mentions', 'severe_confusion'] },
  ...extra,
})

describe('sanitizeRecipe', () => {
  it('keeps instructions, safe tool names and safety rules, never the model', () => {
    const recipe = sanitizeRecipe('5', pkg())!
    expect(recipe).toEqual({
      angelId: '5',
      name: 'Morning Check-in',
      instructions: 'Be warm.',
      tools: ['get_elder_profile', 'get_family_content'],
      trustBoundaries: ['No medical advice'],
      escalationKeys: ['self_harm_mentions', 'severe_confusion'],
    })
    expect(JSON.stringify(recipe)).not.toMatch(/gpt-4o|openai/)
    expect(isAngelRecipe(recipe)).toBe(true)
  })

  it('cuts long instructions and refuses a package without a name', () => {
    const long = sanitizeRecipe('5', pkg({ config: { instructions: 'a'.repeat(9000), tools: [] } }))!
    expect(long.instructions).toHaveLength(4000)
    expect(sanitizeRecipe('5', pkg({ agent: {} }))).toBeNull()
    expect(sanitizeRecipe('5', null)).toBeNull()
  })
})
```

Add to `src/main/agentic/MyGuardianAngels.test.ts`:

```ts
describe('recipe', () => {
  it('exports the angel with the app token', async () => {
    const { angels, call } = setup([json(200, { agent: { name: 'Angel 5' }, config: { instructions: 'Hi', tools: [] }, safety: {} })])
    await expect(angels.recipe('5')).resolves.toMatchObject({ status: 'ready', recipe: { angelId: '5', name: 'Angel 5', instructions: 'Hi' } })
    expect(call(0)[0]).toBe(`${KIN_KEEPERS_API}/api/agno/agents/5/export`)
  })

  it('maps 403 and 404 to not-yours and a bad id to not-yours without a request', async () => {
    const { angels, fetchImpl } = setup([json(403), json(404)])
    await expect(angels.recipe('5')).resolves.toEqual({ status: 'not-yours' })
    await expect(angels.recipe('5')).resolves.toEqual({ status: 'not-yours' })
    await expect(angels.recipe('../x')).resolves.toEqual({ status: 'not-yours' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/agentic/angelRecipe.test.ts src/main/agentic/MyGuardianAngels.test.ts`
Expected: FAIL (module not found; `recipe` is not a function).

- [ ] **Step 3: Implement**

`src/main/agentic/angelRecipe.ts`:

```ts
import { cleanText, rules } from './catalogSanitizer'

export const MAX_INSTRUCTIONS = 4000
const TOOL_NAME = /^[a-z0-9_]{1,64}$/

/** What Family Circle needs to run one of the person's angels locally. Never the marketplace model. */
export interface AngelRecipe {
  angelId: string
  name: string
  instructions: string
  tools: string[]
  trustBoundaries: string[]
  /** Raw trigger keys, such as "self_harm_mentions", matched against fixed word lists. */
  escalationKeys: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function keys(value: unknown, pattern: RegExp, max: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && pattern.test(item)))].slice(0, max)
}

// Keeps line breaks in the instructions, which matter to the model, but drops other control characters.
function cleanInstructions(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim().slice(0, MAX_INSTRUCTIONS)
}

/** The export package (KinKeepersAgentPackage v1) in the shape the local runner uses, or null. */
export function sanitizeRecipe(angelId: string, raw: unknown): AngelRecipe | null {
  const pkg = record(raw)
  const name = cleanText(record(pkg.agent).name, 120)
  if (!name) return null
  const config = record(pkg.config)
  const safety = record(pkg.safety)
  return {
    angelId,
    name,
    instructions: cleanInstructions(config.instructions),
    tools: keys(config.tools, TOOL_NAME, 20),
    trustBoundaries: rules(safety.trust_boundaries),
    escalationKeys: keys(safety.escalation_triggers, TOOL_NAME, 20),
  }
}

/** For recipes read back from the local cache. */
export function isAngelRecipe(value: unknown): value is AngelRecipe {
  const raw = record(value)
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string')
  return typeof raw.angelId === 'string' && typeof raw.name === 'string' && raw.name.length > 0
    && typeof raw.instructions === 'string' && raw.instructions.length <= MAX_INSTRUCTIONS
    && strings(raw.tools) && strings(raw.trustBoundaries) && strings(raw.escalationKeys)
}
```

In `src/main/agentic/MyGuardianAngels.ts` import `sanitizeRecipe, type AngelRecipe` from `./angelRecipe`, export the result type and add the method after `remove`:

```ts
export type RecipeResult = { status: 'ready'; recipe: AngelRecipe } | { status: 'disconnected' | 'unavailable' | 'not-yours' }
```

```ts
  /** The angel's instructions, tools and safety rules, for running it on this computer. */
  async recipe(angelId: string): Promise<RecipeResult> {
    if (!TEMPLATE_ID.test(angelId)) return { status: 'not-yours' }
    const outcome = await this.request('GET', `/api/agno/agents/${angelId}/export`)
    if (outcome.kind !== 'response') return { status: outcome.kind }
    const { status, bytes } = outcome.response
    if (status === 403 || status === 404) return { status: 'not-yours' }
    if (status !== 200) return { status: 'unavailable' }
    const recipe = sanitizeRecipe(angelId, parse(bytes))
    return recipe ? { status: 'ready', recipe } : { status: 'unavailable' }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/agentic/angelRecipe.test.ts src/main/agentic/MyGuardianAngels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic/angelRecipe.ts src/main/agentic/angelRecipe.test.ts src/main/agentic/MyGuardianAngels.ts src/main/agentic/MyGuardianAngels.test.ts
git commit -m "feat: fetch an angel's recipe from its export"
```

---

### Task 3: Chat types shared by main, preload and renderer

**Files:**
- Create: `src/shared/agenticChat.ts`
- Test: `src/shared/agenticChat.test.ts`

**Interfaces:**
- Produces:

```ts
export type AngelEscalationGroup = 'self-harm' | 'medical-emergency' | 'abuse' | 'confusion' | 'distress' | 'privacy'
export interface AngelChatSource { label: string; excerpt: string }
export interface AngelChatMessage { id: number; role: 'person' | 'angel'; text: string; sources: AngelChatSource[]; escalation: AngelEscalationGroup | null; createdAt: string }
export interface AngelRuntimeInfo { backend: 'llama.cpp'; model: string }
export type AngelChatOpenResult =
  | { status: 'ready'; angel: { id: string; name: string }; runtime: AngelRuntimeInfo; messages: AngelChatMessage[]; offline: boolean }
  | { status: 'private-ai-needed' | 'connect-needed' | 'not-here' | 'unavailable' }
export type AngelChatSendResult =
  | { status: 'replied'; person: AngelChatMessage; reply: AngelChatMessage }
  | { status: 'private-ai-needed' | 'connect-needed' | 'not-here' | 'failed' }
export const MAX_ANGEL_MESSAGE = 1000
export interface StorySection { label: string; text: string }
export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }
export function safeAngelChatOpen(value: unknown): AngelChatOpenResult
export function safeAngelChatSend(value: unknown): AngelChatSendResult
```

- [ ] **Step 1: Write the failing test**

`src/shared/agenticChat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { safeAngelChatOpen, safeAngelChatSend } from './agenticChat'

const message = { id: 1, role: 'angel', text: 'Hello', sources: [{ label: 'My Story › Childhood', excerpt: 'We lived by the lake.' }], escalation: null, createdAt: '2026-10-23T10:00:00.000Z' }

describe('safe chat results', () => {
  it('keeps a valid open result and drops extra fields', () => {
    const result = safeAngelChatOpen({ status: 'ready', angel: { id: '5', name: 'Morning', secret: 1 }, runtime: { backend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [message, { bad: true }], offline: false })
    expect(result).toEqual({ status: 'ready', angel: { id: '5', name: 'Morning' }, runtime: { backend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [message], offline: false })
  })

  it('turns anything unknown into unavailable or failed', () => {
    expect(safeAngelChatOpen({ status: 'ready', angel: { id: '../x', name: 'A' } })).toEqual({ status: 'unavailable' })
    expect(safeAngelChatOpen({ status: 'not-here' })).toEqual({ status: 'not-here' })
    expect(safeAngelChatSend({ status: 'replied', person: message, reply: { ...message, role: 'robot' } })).toEqual({ status: 'failed' })
    expect(safeAngelChatSend({ status: 'connect-needed' })).toEqual({ status: 'connect-needed' })
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/shared/agenticChat.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/shared/agenticChat.ts`:

```ts
import { TEMPLATE_ID } from './agentic'

export type AngelEscalationGroup = 'self-harm' | 'medical-emergency' | 'abuse' | 'confusion' | 'distress' | 'privacy'
const GROUPS: readonly AngelEscalationGroup[] = ['self-harm', 'medical-emergency', 'abuse', 'confusion', 'distress', 'privacy']

/** A My Story section an angel reply drew on. */
export interface AngelChatSource { label: string; excerpt: string }

export interface AngelChatMessage {
  id: number
  role: 'person' | 'angel'
  text: string
  sources: AngelChatSource[]
  /** Set when the message matched a safety trigger and got Family Circle's fixed reply. */
  escalation: AngelEscalationGroup | null
  /** ISO time in UTC. */
  createdAt: string
}

/** Where the angel runs: always Family Circle's own llama.cpp runtime. */
export interface AngelRuntimeInfo { backend: 'llama.cpp'; model: string }

export type AngelChatOpenResult =
  | { status: 'ready'; angel: { id: string; name: string }; runtime: AngelRuntimeInfo; messages: AngelChatMessage[]; offline: boolean }
  | { status: 'private-ai-needed' | 'connect-needed' | 'not-here' | 'unavailable' }

export type AngelChatSendResult =
  | { status: 'replied'; person: AngelChatMessage; reply: AngelChatMessage }
  | { status: 'private-ai-needed' | 'connect-needed' | 'not-here' | 'failed' }

export const MAX_ANGEL_MESSAGE = 1000

/** A My Story section given to the angel's prompt. */
export interface StorySection { label: string; text: string }
/** One message of a local llama.cpp chat request. */
export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function chatMessage(value: unknown): AngelChatMessage | null {
  const raw = record(value)
  if (!Number.isSafeInteger(raw.id) || (raw.role !== 'person' && raw.role !== 'angel')) return null
  if (!text(raw.text, 4000) || !text(raw.createdAt, 40) || !ISO_TIME.test(raw.createdAt)) return null
  if (raw.escalation !== null && !GROUPS.includes(raw.escalation as AngelEscalationGroup)) return null
  if (!Array.isArray(raw.sources)) return null
  const sources: AngelChatSource[] = []
  for (const source of raw.sources.slice(0, 3)) {
    const entry = record(source)
    if (!text(entry.label, 200) || !text(entry.excerpt, 400)) return null
    sources.push({ label: entry.label, excerpt: entry.excerpt })
  }
  return { id: raw.id as number, role: raw.role, text: raw.text, sources, escalation: raw.escalation as AngelEscalationGroup | null, createdAt: raw.createdAt }
}

export function safeAngelChatOpen(value: unknown): AngelChatOpenResult {
  const raw = record(value)
  if (raw.status === 'ready') {
    const angel = record(raw.angel)
    const runtime = record(raw.runtime)
    if (typeof angel.id !== 'string' || !TEMPLATE_ID.test(angel.id) || !text(angel.name, 120) || !angel.name) return { status: 'unavailable' }
    if (runtime.backend !== 'llama.cpp' || !text(runtime.model, 120) || !runtime.model) return { status: 'unavailable' }
    if (!Array.isArray(raw.messages) || typeof raw.offline !== 'boolean') return { status: 'unavailable' }
    const messages = raw.messages.map(chatMessage).filter((item): item is AngelChatMessage => item !== null)
    return { status: 'ready', angel: { id: angel.id, name: angel.name }, runtime: { backend: 'llama.cpp', model: runtime.model }, messages, offline: raw.offline }
  }
  return raw.status === 'private-ai-needed' || raw.status === 'connect-needed' || raw.status === 'not-here'
    ? { status: raw.status }
    : { status: 'unavailable' }
}

export function safeAngelChatSend(value: unknown): AngelChatSendResult {
  const raw = record(value)
  if (raw.status === 'replied') {
    const person = chatMessage(raw.person)
    const reply = chatMessage(raw.reply)
    return person && reply ? { status: 'replied', person, reply } : { status: 'failed' }
  }
  return raw.status === 'private-ai-needed' || raw.status === 'connect-needed' || raw.status === 'not-here'
    ? { status: raw.status }
    : { status: 'failed' }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/agenticChat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agenticChat.ts src/shared/agenticChat.test.ts
git commit -m "feat: chat types for angels on this computer"
```

---

### Task 4: Local history and recipe cache

**Files:**
- Modify: `src/main/database/migrations.ts`
- Create: `src/main/agentic/AngelHistoryRepository.ts`
- Test: `src/main/agentic/AngelHistoryRepository.test.ts`

**Interfaces:**
- Consumes: `AngelChatMessage`, `AngelChatSource`, `AngelEscalationGroup` (Task 3).
- Produces: `class AngelHistoryRepository(db: DatabaseSync)` with
  - `add(localUserId: number, angelId: string, entry: { role: 'person' | 'angel'; text: string; sources?: AngelChatSource[]; escalation?: AngelEscalationGroup | null; executionBackend?: 'llama.cpp' | null; model?: string | null }): AngelChatMessage`
  - `list(localUserId: number, angelId: string): AngelChatMessage[]` (oldest first, at most 200)
  - `recent(localUserId: number, angelId: string, limit: number): AngelChatMessage[]` (oldest first)
  - `clear(localUserId: number, angelId: string): void`
  - `saveRecipe(localUserId: number, angelId: string, recipeJson: string): void`
  - `recipe(localUserId: number, angelId: string): string | null`
  - `forget(localUserId: number, angelId: string): void` (messages and recipe)
  - `model(localUserId: number, angelId: string, messageId: number): { executionBackend: string | null; model: string | null } | null`, used by tests and the live check

- [ ] **Step 1: Write the failing test**

`src/main/agentic/AngelHistoryRepository.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { AngelHistoryRepository } from './AngelHistoryRepository'

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  db.exec(`INSERT INTO users (id, email, password_hash) VALUES (1, 'one@example.com', 'h'), (2, 'two@example.com', 'h')`)
  return { db, history: new AngelHistoryRepository(db) }
}

describe('AngelHistoryRepository', () => {
  it('saves both sides with the local runtime and lists them oldest first', () => {
    const { history } = setup()
    history.add(1, '5', { role: 'person', text: 'Hello' })
    const reply = history.add(1, '5', { role: 'angel', text: 'Hi Pat', sources: [{ label: 'My Story › Childhood', excerpt: 'Lake' }], executionBackend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' })
    expect(history.list(1, '5').map((item) => item.text)).toEqual(['Hello', 'Hi Pat'])
    expect(reply).toMatchObject({ role: 'angel', sources: [{ label: 'My Story › Childhood', excerpt: 'Lake' }], escalation: null })
    expect(history.model(1, '5', reply.id)).toEqual({ executionBackend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' })
  })

  it('keeps people and angels apart and keeps only the newest 200', () => {
    const { history } = setup()
    for (let index = 0; index < 205; index += 1) history.add(1, '5', { role: 'person', text: `m${index}` })
    history.add(2, '5', { role: 'person', text: 'other person' })
    history.add(1, '6', { role: 'person', text: 'other angel' })
    const list = history.list(1, '5')
    expect(list).toHaveLength(200)
    expect(list[0]!.text).toBe('m5')
    expect(history.recent(1, '5', 2).map((item) => item.text)).toEqual(['m203', 'm204'])
    expect(history.list(2, '5').map((item) => item.text)).toEqual(['other person'])
  })

  it('clears messages, caches a recipe and forgets both', () => {
    const { history } = setup()
    history.add(1, '5', { role: 'person', text: 'Hello' })
    history.saveRecipe(1, '5', '{"a":1}')
    history.saveRecipe(1, '5', '{"a":2}')
    expect(history.recipe(1, '5')).toBe('{"a":2}')
    history.clear(1, '5')
    expect(history.list(1, '5')).toEqual([])
    expect(history.recipe(1, '5')).toBe('{"a":2}')
    history.forget(1, '5')
    expect(history.recipe(1, '5')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/agentic/AngelHistoryRepository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

In `src/main/database/migrations.ts` add before `runMigrations`:

```ts
function ensureAngelTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS angel_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_user_id INTEGER NOT NULL,
      angel_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('person', 'angel')),
      text TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      escalation TEXT,
      execution_backend TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_angel_messages_angel ON angel_messages(local_user_id, angel_id, id);
    CREATE TABLE IF NOT EXISTS angel_recipes (
      local_user_id INTEGER NOT NULL,
      angel_id TEXT NOT NULL,
      recipe_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (local_user_id, angel_id),
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)
}
```

and call `ensureAngelTables(db)` after `ensureStoryImportState(db)` in `runMigrations`.

`src/main/agentic/AngelHistoryRepository.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import type { AngelChatMessage, AngelChatSource, AngelEscalationGroup } from '../../shared/agenticChat'

const KEPT_PER_ANGEL = 200

interface MessageRow {
  id: number
  role: 'person' | 'angel'
  text: string
  sources_json: string
  escalation: AngelEscalationGroup | null
  created_at: number
}

function sources(json: string): AngelChatSource[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed as AngelChatSource[] : []
  } catch {
    return []
  }
}

function shape(row: MessageRow): AngelChatMessage {
  return {
    id: Number(row.id),
    role: row.role,
    text: String(row.text),
    sources: sources(String(row.sources_json)),
    escalation: row.escalation ?? null,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  }
}

/** Conversations with angels and their cached recipes, kept only on this computer. */
export class AngelHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  add(localUserId: number, angelId: string, entry: {
    role: 'person' | 'angel'
    text: string
    sources?: AngelChatSource[]
    escalation?: AngelEscalationGroup | null
    executionBackend?: 'llama.cpp' | null
    model?: string | null
  }): AngelChatMessage {
    const now = Date.now()
    const result = this.db.prepare(`
      INSERT INTO angel_messages (local_user_id, angel_id, role, text, sources_json, escalation, execution_backend, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(localUserId, angelId, entry.role, entry.text, JSON.stringify(entry.sources ?? []), entry.escalation ?? null,
      entry.executionBackend ?? null, entry.model ?? null, now)
    this.db.prepare(`
      DELETE FROM angel_messages
       WHERE local_user_id = ? AND angel_id = ?
         AND id NOT IN (SELECT id FROM angel_messages WHERE local_user_id = ? AND angel_id = ? ORDER BY id DESC LIMIT ${KEPT_PER_ANGEL})
    `).run(localUserId, angelId, localUserId, angelId)
    return {
      id: Number(result.lastInsertRowid),
      role: entry.role,
      text: entry.text,
      sources: entry.sources ?? [],
      escalation: entry.escalation ?? null,
      createdAt: new Date(now).toISOString(),
    }
  }

  list(localUserId: number, angelId: string): AngelChatMessage[] {
    return this.recent(localUserId, angelId, KEPT_PER_ANGEL)
  }

  recent(localUserId: number, angelId: string, limit: number): AngelChatMessage[] {
    const rows = this.db.prepare(`
      SELECT id, role, text, sources_json, escalation, created_at
        FROM angel_messages
       WHERE local_user_id = ? AND angel_id = ?
       ORDER BY id DESC
       LIMIT ?
    `).all(localUserId, angelId, limit) as unknown as MessageRow[]
    return rows.reverse().map(shape)
  }

  model(localUserId: number, angelId: string, messageId: number): { executionBackend: string | null; model: string | null } | null {
    const row = this.db.prepare(`
      SELECT execution_backend, model FROM angel_messages WHERE local_user_id = ? AND angel_id = ? AND id = ?
    `).get(localUserId, angelId, messageId) as { execution_backend: string | null; model: string | null } | undefined
    return row ? { executionBackend: row.execution_backend, model: row.model } : null
  }

  clear(localUserId: number, angelId: string): void {
    this.db.prepare('DELETE FROM angel_messages WHERE local_user_id = ? AND angel_id = ?').run(localUserId, angelId)
  }

  saveRecipe(localUserId: number, angelId: string, recipeJson: string): void {
    this.db.prepare(`
      INSERT INTO angel_recipes (local_user_id, angel_id, recipe_json, fetched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(local_user_id, angel_id) DO UPDATE SET recipe_json = excluded.recipe_json, fetched_at = excluded.fetched_at
    `).run(localUserId, angelId, recipeJson, Date.now())
  }

  recipe(localUserId: number, angelId: string): string | null {
    const row = this.db.prepare('SELECT recipe_json FROM angel_recipes WHERE local_user_id = ? AND angel_id = ?')
      .get(localUserId, angelId) as { recipe_json: string } | undefined
    return row ? String(row.recipe_json) : null
  }

  forget(localUserId: number, angelId: string): void {
    this.clear(localUserId, angelId)
    this.db.prepare('DELETE FROM angel_recipes WHERE local_user_id = ? AND angel_id = ?').run(localUserId, angelId)
  }
}
```

- [ ] **Step 4: Run the tests, including migrations**

Run: `npx vitest run src/main/agentic/AngelHistoryRepository.test.ts src/main/database`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/migrations.ts src/main/agentic/AngelHistoryRepository.ts src/main/agentic/AngelHistoryRepository.test.ts
git commit -m "feat: keep angel conversations on this computer"
```

---

### Task 5: Safety word lists

**Files:**
- Create: `src/main/agentic/angelSafety.ts`
- Test: `src/main/agentic/angelSafety.test.ts`

**Interfaces:**
- Consumes: `AngelEscalationGroup` (Task 3).
- Produces: `escalationFor(message: string, escalationKeys: string[]): AngelEscalationGroup | null`, `ESCALATION_REPLIES: Record<AngelEscalationGroup, string>`.

- [ ] **Step 1: Write the failing test**

`src/main/agentic/angelSafety.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ESCALATION_REPLIES, escalationFor } from './angelSafety'

describe('escalationFor', () => {
  it('always catches self-harm, emergencies and abuse, whatever the angel', () => {
    expect(escalationFor('Some days I want to end my life', [])).toBe('self-harm')
    expect(escalationFor("I have chest pain and can't breathe", [])).toBe('medical-emergency')
    expect(escalationFor('My carer hits me', [])).toBe('abuse')
  })

  it('adds groups only when the angel has the trigger', () => {
    expect(escalationFor("I don't know where I am", [])).toBeNull()
    expect(escalationFor("I don't know where I am", ['severe_confusion'])).toBe('confusion')
    expect(escalationFor('I feel hopeless and panicking', ['extreme_distress'])).toBe('distress')
    expect(escalationFor('Someone asked for my bank password', ['privacy_or_security_concern'])).toBe('privacy')
  })

  it('ignores everyday words and unknown trigger keys', () => {
    expect(escalationFor('I killed it at bingo today, my chest of drawers is full', ['made_up_trigger'])).toBeNull()
  })

  it('gives a fixed reply for every group without phone numbers', () => {
    for (const reply of Object.values(ESCALATION_REPLIES)) {
      expect(reply.length).toBeGreaterThan(20)
      expect(reply).not.toMatch(/\d{3}/)
    }
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/agentic/angelSafety.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/main/agentic/angelSafety.ts`:

```ts
import type { AngelEscalationGroup } from '../../shared/agenticChat'

// Fixed phrases, checked before the model runs: a 0.8B model cannot be trusted to notice danger.
const PATTERNS: Record<AngelEscalationGroup, RegExp[]> = {
  'self-harm': [
    /\b(?:kill|hurt|harm) (?:my ?self|myself)\b/i,
    /\bend (?:my|it all|my own) life\b/i,
    /\bend it all\b/i,
    /\bsuicid/i,
    /\b(?:want|wish) (?:to|I could) (?:die|be dead|not wake up)\b/i,
    /\bjoin (?:him|her|them) (?:soon|in heaven)\b/i,
  ],
  'medical-emergency': [
    /\bchest pains?\b/i,
    /\b(?:can't|cannot|can not) breathe\b/i,
    /\btrouble breathing\b/i,
    /\bi(?:'ve| have)? fallen\b/i,
    /\b(?:i fell|had a fall)\b/i,
    /\bstroke\b/i,
    /\bunconscious\b/i,
    /\bbleeding (?:badly|a lot|won't stop)\b/i,
  ],
  abuse: [
    /\b(?:hits|hit|beats|beat|hurts|slaps|kicks) me\b/i,
    /\bsomeone (?:is )?(?:hurting|abusing) me\b/i,
    /\babus(?:e|ed|ing)\b/i,
    /\btakes? my money\b/i,
    /\bscared of (?:my )?(?:carer|son|daughter|husband|wife|nurse)\b/i,
  ],
  confusion: [
    /\b(?:don't|do not) know where I am\b/i,
    /\bwhere am I\b/i,
    /\b(?:don't|do not) recogni[sz]e\b/i,
    /\bwhat year is it\b/i,
  ],
  distress: [
    /\bhopeless\b/i,
    /\bpanic(?:king)?\b/i,
    /\bcan't (?:go on|cope)\b/i,
    /\bso (?:scared|frightened)\b/i,
  ],
  privacy: [
    /\b(?:asked|wants?) (?:for )?my (?:bank |card |pin|password)/i,
    /\bpassword\b/i,
    /\bscam\b/i,
  ],
}

const ALWAYS: AngelEscalationGroup[] = ['self-harm', 'medical-emergency', 'abuse']

// Trigger keys from the templates, mapped to the groups they turn on.
const KEY_GROUPS: Record<string, AngelEscalationGroup> = {
  severe_confusion: 'confusion',
  confusion_about_family_members: 'confusion',
  confusion_or_distress: 'confusion',
  sudden_confusion: 'confusion',
  extreme_distress: 'distress',
  distress_about_family_absence: 'distress',
  distress_or_safety_concern: 'distress',
  severe_distress: 'distress',
  privacy_or_security_concern: 'privacy',
  account_access_problem: 'privacy',
}

export const ESCALATION_REPLIES: Record<AngelEscalationGroup, string> = {
  'self-harm': "I'm worried about what you just said, and I want you to be safe. Please talk to someone now: a family member, your carer, or emergency services if you are in danger.",
  'medical-emergency': 'This sounds like it could be urgent. Please get help now: call emergency services, or ask someone near you to call for you.',
  abuse: 'Thank you for telling me. No one should treat you that way. Please tell someone you trust today, such as a family member or your doctor, or call emergency services if you are in danger.',
  confusion: "It's all right to feel unsure. Please let a family member or your carer know how you are feeling, so they can be with you.",
  distress: "I'm sorry this feels so hard right now. Please reach out to a family member or your carer, so you're not alone with it.",
  privacy: 'Please never share passwords, PINs or bank details with anyone who asks. Check with a family member you trust before you do anything.',
}

/** The first safety group the message matches, or null. */
export function escalationFor(message: string, escalationKeys: string[]): AngelEscalationGroup | null {
  const groups = new Set<AngelEscalationGroup>(ALWAYS)
  for (const key of escalationKeys) {
    const group = KEY_GROUPS[key]
    if (group) groups.add(group)
  }
  for (const group of groups) {
    if (PATTERNS[group].some((pattern) => pattern.test(message))) return group
  }
  return null
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/main/agentic/angelSafety.test.ts`
Expected: PASS. If an everyday phrase in the third test matches, tighten that pattern instead of loosening the test.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic/angelSafety.ts src/main/agentic/angelSafety.test.ts
git commit -m "feat: fixed safety replies for angels on this computer"
```

---

### Task 6: Prompt builder within the 4,096-token window

**Files:**
- Create: `src/main/agentic/angelPrompt.ts`
- Test: `src/main/agentic/angelPrompt.test.ts`

**Interfaces:**
- Consumes: `AngelRecipe` (Task 2), `AngelChatMessage`, `ChatTurn`, `StorySection`, `MAX_ANGEL_MESSAGE` (Task 3).
- Produces:
  - `buildAngelPrompt(input: { recipe: AngelRecipe; firstName: string | null; stories: StorySection[]; history: AngelChatMessage[]; message: string }): ChatTurn[]`
  - `STORY_TOOL = 'get_family_content'`, `PROFILE_TOOL = 'get_elder_profile'`, `HISTORY_TOOL = 'get_recent_interactions'`, `DRAFT_TOOLS: ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

`src/main/agentic/angelPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AngelChatMessage } from '../../shared/agenticChat'
import type { AngelRecipe } from './angelRecipe'
import { buildAngelPrompt } from './angelPrompt'

const recipe = (tools: string[]): AngelRecipe => ({
  angelId: '5', name: 'Morning Check-in', instructions: 'Be warm and patient.', tools,
  trustBoundaries: ['No medical advice'], escalationKeys: [],
})
const turn = (id: number, role: 'person' | 'angel', text: string): AngelChatMessage => ({ id, role, text, sources: [], escalation: null, createdAt: '2026-10-23T10:00:00.000Z' })

describe('buildAngelPrompt', () => {
  it("puts Family Circle's rules before the angel's instructions", () => {
    const [system] = buildAngelPrompt({ recipe: recipe([]), firstName: null, stories: [], history: [], message: 'Hi' })
    expect(system!.role).toBe('system')
    expect(system!.content.indexOf('never invent family details')).toBeLessThan(system!.content.indexOf('Be warm and patient.'))
    expect(system!.content).toContain('No medical advice')
  })

  it('adds the first name, stories and history only when the angel has those tools', () => {
    const input = {
      firstName: 'Pat',
      stories: [{ label: 'My Story › Childhood', text: 'We lived by the lake.' }],
      history: [turn(1, 'person', 'Good morning'), turn(2, 'angel', 'Good morning, Pat')],
      message: 'Tell me a memory',
    }
    const without = buildAngelPrompt({ ...input, recipe: recipe([]) })
    expect(JSON.stringify(without)).not.toMatch(/Pat|lake|Good morning/)
    const withTools = buildAngelPrompt({ ...input, recipe: recipe(['get_elder_profile', 'get_family_content', 'get_recent_interactions']) })
    expect(withTools[0]!.content).toContain('Pat')
    expect(withTools.map((item) => item.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(withTools.at(-1)!.content).toContain('We lived by the lake.')
    expect(withTools.at(-1)!.content).toContain('Tell me a memory')
  })

  it('keeps everything within budget', () => {
    const long = 'x'.repeat(5000)
    const prompt = buildAngelPrompt({
      recipe: { ...recipe(['get_family_content', 'get_recent_interactions']), instructions: long.slice(0, 4000) },
      firstName: 'Pat',
      stories: [1, 2, 3, 4].map((index) => ({ label: `S${index}`, text: long })),
      history: Array.from({ length: 10 }, (_, index) => turn(index, index % 2 ? 'angel' : 'person', long)),
      message: long,
    })
    const total = prompt.reduce((sum, item) => sum + item.content.length, 0)
    expect(total).toBeLessThan(12_800)
    expect(prompt.at(-1)!.content.match(/\[Memory \d:/g)).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/agentic/angelPrompt.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/main/agentic/angelPrompt.ts`:

```ts
import { MAX_ANGEL_MESSAGE, type AngelChatMessage, type ChatTurn, type StorySection } from '../../shared/agenticChat'
import type { AngelRecipe } from './angelRecipe'

export const PROFILE_TOOL = 'get_elder_profile'
export const STORY_TOOL = 'get_family_content'
export const HISTORY_TOOL = 'get_recent_interactions'
export const DRAFT_TOOLS: ReadonlySet<string> = new Set(['draft_email', 'send_email', 'send_family_notification'])

const MAX_STORIES = 3
const MAX_STORY_CHARS = 900
const MAX_HISTORY_MESSAGES = 6
const MAX_HISTORY_CHARS = 1800

const FAMILY_CIRCLE_RULES = [
  'You are a Guardian Angel inside Family Circle, a private family app. You run on this computer.',
  'Always follow these rules first, before anything else below:',
  '- Reply in plain, short, kind sentences. No Markdown.',
  '- For facts about the family, use only the memories you are given; never invent family details, names or events.',
  '- Never give medical, legal or money advice. Suggest asking a family member or a professional instead.',
  '- You cannot send messages. If asked, write a short draft the person can copy, and say they need to send it themselves.',
  '- If the person seems unsafe, unwell or very upset, gently ask them to contact a family member or their carer.',
].join('\n')

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd()
}

/** One chat request that fits the local model's 4,096-token window. The model never calls tools. */
export function buildAngelPrompt(input: {
  recipe: AngelRecipe
  firstName: string | null
  stories: StorySection[]
  history: AngelChatMessage[]
  message: string
}): ChatTurn[] {
  const tools = new Set(input.recipe.tools)
  const system = [
    FAMILY_CIRCLE_RULES,
    input.recipe.trustBoundaries.length ? `Safety rules for this angel: ${input.recipe.trustBoundaries.join('; ')}.` : '',
    tools.has(PROFILE_TOOL) && input.firstName ? `You are talking with ${input.firstName}.` : '',
    [...DRAFT_TOOLS].some((tool) => tools.has(tool)) ? 'You may write drafts of messages for the person to send themselves.' : '',
    `Your name is ${input.recipe.name}. Your instructions from the angel's settings:`,
    input.recipe.instructions || 'Be a warm, patient companion.',
  ].filter(Boolean).join('\n\n')

  const turns: ChatTurn[] = [{ role: 'system', content: system }]

  if (tools.has(HISTORY_TOOL)) {
    let used = 0
    const kept: ChatTurn[] = []
    for (const item of input.history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
      const room = MAX_HISTORY_CHARS - used
      if (room <= 0) break
      const content = cut(item.text, room)
      used += content.length
      kept.unshift({ role: item.role === 'person' ? 'user' : 'assistant', content })
    }
    turns.push(...kept)
  }

  const memories = tools.has(STORY_TOOL)
    ? input.stories.slice(0, MAX_STORIES).map((story, index) => `[Memory ${index + 1}: ${story.label}]\n${cut(story.text, MAX_STORY_CHARS)}`)
    : []
  const message = cut(input.message.trim(), MAX_ANGEL_MESSAGE)
  turns.push({
    role: 'user',
    content: memories.length ? `Family memories you may use:\n${memories.join('\n\n')}\n\nMessage:\n${message}` : message,
  })
  return turns
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/main/agentic/angelPrompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic/angelPrompt.ts src/main/agentic/angelPrompt.test.ts
git commit -m "feat: build angel prompts that fit the local model"
```

---

### Task 7: Qwen chat and My Story search for angels

**Files:**
- Modify: `src/main/ai/QwenClient.ts`
- Test: `src/main/ai/QwenClient.test.ts`
- Modify: `src/main/ai/PrivateArchiveQueryService.ts`
- Test: `src/main/ai/PrivateArchiveQueryService.test.ts`

**Interfaces:**
- Consumes: `ChatTurn`, `StorySection`, `AngelChatSource` (Task 3).
- Produces:
  - `QwenClient.chat(messages: ChatTurn[], maxTokens: number): Promise<string>` (plain text, throws `QwenClientError`)
  - `PrivateArchiveQueryService.findStorySections(localUserId: number, query: string): Promise<{ sections: StorySection[]; cite(answer: string): AngelChatSource[] }>` (empty sections when nothing is indexed; throws `PrivateArchiveQueryServiceError('private-ai-unavailable')` when the embedding runtime is down)

- [ ] **Step 1: Write the failing tests**

Add to `src/main/ai/QwenClient.test.ts`:

```ts
it('sends an angel chat as given and returns plain text', async () => {
  const post = vi.fn(async () => ({ choices: [{ message: { content: '**Good** morning' } }] }))
  const client = new QwenClient({ http: { post } as QwenHttpPort })
  const messages = [{ role: 'system' as const, content: 'Rules' }, { role: 'user' as const, content: 'Hi' }]
  await expect(client.chat(messages, 256)).resolves.toBe('Good morning')
  expect(post).toHaveBeenCalledWith('/v1/chat/completions', { messages, max_tokens: 256, temperature: 0.4, top_p: 0.9, stream: false })
})
```

Add to `src/main/ai/PrivateArchiveQueryService.test.ts`, using the file's existing dependency builder. If none exists, build the dependencies inline as below. The story chunk shape is `StoryQueryChunk` from `src/main/story/StoryChunkRepository.ts`. Use `EMBEDDING_MODEL_ID` and `EMBEDDING_INDEX_VERSION` from `./embeddingContract`.

```ts
describe('findStorySections', () => {
  const chunk = (fieldKey: string, label: string, text: string, embedding: number[]) => ({
    answerId: 1, fieldKey, chapter: 'Childhood', label, text,
    embedding: new Float32Array(embedding), embeddingModel: EMBEDDING_MODEL_ID, indexVersion: EMBEDDING_INDEX_VERSION,
  })
  const build = (rows: ReturnType<typeof chunk>[], embeddingReady = true) => new PrivateArchiveQueryService({
    session: { restore: async () => null },
    documents: { getByIdForUser: async () => null },
    vaultChunks: { listQueryChunks: async () => { throw new Error('the Vault must not be read') } },
    storyChunks: { listQueryChunks: async () => rows as never },
    runtime: { ensureEmbeddingRuntime: async () => embeddingReady, ensureGenerationRuntime: async () => true },
    nomic: { embedQuery: async () => new Float32Array([1, 0]) },
    qwen: { generateFast: async () => '', generateComplex: async () => '', translateForRetrieval: async () => '' },
    direct: { answer: async () => null },
  })

  it('ranks confirmed My Story sections and cites the ones a reply used', async () => {
    const service = build([
      chunk('home', 'Where I grew up', 'We lived by Lake Victoria in Entebbe.', [1, 0]),
      chunk('school', 'My school', 'I went to Gayaza High School.', [0, 1]),
    ])
    const found = await service.findStorySections(1, 'Tell me about the lake')
    expect(found.sections[0]).toEqual({ label: 'My Story › Childhood › Where I grew up', text: 'We lived by Lake Victoria in Entebbe.' })
    expect(found.cite('You lived by Lake Victoria in Entebbe.')).toEqual([
      { label: 'My Story › Childhood › Where I grew up', excerpt: 'We lived by Lake Victoria in Entebbe.' },
    ])
  })

  it('returns nothing when no story is indexed and fails when search is down', async () => {
    await expect(build([]).findStorySections(1, 'Hi')).resolves.toMatchObject({ sections: [] })
    await expect(build([chunk('a', 'A', 'B', [1, 0])], false).findStorySections(1, 'Hi')).rejects.toMatchObject({ code: 'private-ai-unavailable' })
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/ai/QwenClient.test.ts src/main/ai/PrivateArchiveQueryService.test.ts`
Expected: FAIL (`chat` and `findStorySections` are not functions).

- [ ] **Step 3: Implement**

In `src/main/ai/QwenClient.ts`, import `type ChatTurn` from `../../shared/agenticChat` and add a public method after `translateForRetrieval`:

```ts
  /** An angel conversation turn: Family Circle builds the whole prompt, the model only writes. */
  async chat(messages: ChatTurn[], maxTokens: number): Promise<string> {
    const answer = await this.complete({ messages, max_tokens: maxTokens, temperature: 0.4, top_p: 0.9, stream: false })
    return plainAnswer(answer)
  }
```

In `src/main/ai/PrivateArchiveQueryService.ts`, import `type AngelChatSource, type StorySection` from `../../shared/agenticChat`, then add a public method to the class:

```ts
  /**
   * Confirmed My Story sections that match an angel message, ranked like private search.
   * Only My Story is read; the Vault is not part of angel conversations yet.
   */
  async findStorySections(localUserId: number, query: string): Promise<{ sections: StorySection[]; cite(answer: string): AngelChatSource[] }> {
    const candidates = await this.loadCandidates(localUserId, { type: 'story' }, undefined)
    const none = { sections: [], cite: () => [] }
    if (candidates.length === 0 || !query.trim()) return none
    if (!await this.dependencies.runtime.ensureEmbeddingRuntime()) {
      throw new PrivateArchiveQueryServiceError('private-ai-unavailable', 'Private AI search is unavailable')
    }
    let embedding: Float32Array
    try {
      embedding = await this.dependencies.nomic.embedQuery(query)
    } catch {
      throw new PrivateArchiveQueryServiceError('private-ai-unavailable', 'Private AI search is unavailable')
    }
    const vectorRanking = candidates
      .map((candidate, index) => ({ index, score: cosineSimilarity(embedding, candidate.embedding) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => b.score - a.score)
      .map(({ index }) => index)
    const keywordIndex = this.keywordIndexFor(candidates)
    const ranked = fuseRankings([vectorRanking, keywordIndex.rank([query])], candidates.length)
      .slice(0, MAX_RETRIEVAL_CHUNKS)
      .map((index) => candidates[index]!)
    return {
      sections: ranked.map((candidate) => ({ label: candidate.fileName, text: candidate.text })),
      cite: (answer) => citedCandidates(answer, ranked, keywordIndex)
        .filter((candidate, index, list) => list.findIndex((other) => other.logicalKey === candidate.logicalKey) === index)
        .map((candidate) => ({ label: candidate.fileName, excerpt: excerpt(candidate.text) })),
    }
  }
```

`citedCandidates` falls back to every ranked section when none clearly matches. That is the same behaviour private search has, and the test's distinctive words make the first section qualify.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/ai`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/QwenClient.ts src/main/ai/QwenClient.test.ts src/main/ai/PrivateArchiveQueryService.ts src/main/ai/PrivateArchiveQueryService.test.ts
git commit -m "feat: local chat and My Story search for angels"
```

---

### Task 8: The local angel runner

**Files:**
- Create: `src/main/agentic/LocalAngelRunner.ts`
- Test: `src/main/agentic/LocalAngelRunner.test.ts`

**Interfaces:**
- Consumes: `AngelRecipe`, `isAngelRecipe` (Task 2), `RecipeResult` (Task 2), `AngelHistoryRepository` (Task 4), `escalationFor`, `ESCALATION_REPLIES` (Task 5), `buildAngelPrompt`, `STORY_TOOL` (Task 6), `AngelChatOpenResult`, `AngelChatSendResult`, `ChatTurn`, `StorySection`, `MAX_ANGEL_MESSAGE` (Task 3), `MyAngelsResult` (`src/shared/agentic.ts`).
- Produces:

```ts
export interface LocalAngelRunnerDeps {
  session: { restore(): Promise<{ id: number; name: string | null } | null> }
  angels: { list(): Promise<MyAngelsResult>; recipe(angelId: string): Promise<RecipeResult> }
  history: Pick<AngelHistoryRepository, 'add' | 'list' | 'recent' | 'clear' | 'saveRecipe' | 'recipe' | 'forget'>
  stories: { findStorySections(localUserId: number, query: string): Promise<{ sections: StorySection[]; cite(answer: string): AngelChatSource[] }> }
  runtime: { ensureGenerationRuntime(): Promise<boolean>; installedModel(): Promise<string | null> }
  qwen: { chat(messages: ChatTurn[], maxTokens: number): Promise<string> }
  interactiveGate?: { begin(): () => void }
}
export class LocalAngelRunner {
  open(angelId: string): Promise<AngelChatOpenResult>
  send(angelId: string, text: string): Promise<AngelChatSendResult>
  clear(angelId: string): Promise<void>
  forget(angelId: string): Promise<void>
}
```

Behaviour:
- `open`: no signed-in user → `unavailable`. Then `angels.list()`:
  - `ready`: the angel is missing or `runsHere` is false → `not-here`. Otherwise call `angels.recipe`; on `ready` save the recipe JSON to the cache with `offline: false`. On anything else use the cache (`offline: true`), and with no cache → `unavailable`.
  - `disconnected`/`unavailable`: use the cache (`offline: true`); with no cache → `connect-needed` when disconnected, `unavailable` otherwise.
  - Finally, no installed model → `private-ai-needed`.
- `send`: trims the text. An empty or over-long message → `failed`. Resolves the recipe from memory or the cache, and with none → `connect-needed`. Checks safety first; on a match it saves the person message and a fixed reply with the escalation, and doesn't call the model. Otherwise it needs `ensureGenerationRuntime()` and the model name (→ `private-ai-needed`), and calls `findStorySections` only when the recipe has `get_family_content`. A failed search means no stories. It builds the prompt from `recent(…, 6)`, calls `qwen.chat(prompt, 256)`, and on failure → `failed` with nothing saved. Then it saves the person message and the reply with sources, `'llama.cpp'` and the model.
- Recipes resolved by `open` are kept in a `Map` keyed by `${localUserId}:${angelId}`.
- `clear` → `history.clear`. `forget` → `history.forget` and drop from the map.

- [ ] **Step 1: Write the failing test**

`src/main/agentic/LocalAngelRunner.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import type { MyGuardianAngel } from '../../shared/agentic'
import { runMigrations } from '../database/migrations'
import { AngelHistoryRepository } from './AngelHistoryRepository'
import type { AngelRecipe } from './angelRecipe'
import { LocalAngelRunner, type LocalAngelRunnerDeps } from './LocalAngelRunner'

const angel: MyGuardianAngel = {
  id: '5', name: 'Morning Check-in', description: '', templateId: '7', templateName: 'Elder Companion', avatar: null,
  runCount: 0, lastRunAt: null, trustBoundaries: [], escalationTriggers: [], runsHere: true,
}
const recipe: AngelRecipe = {
  angelId: '5', name: 'Morning Check-in', instructions: 'Be warm.', tools: ['get_elder_profile', 'get_family_content'],
  trustBoundaries: [], escalationKeys: ['severe_confusion'],
}

function setup(overrides: Partial<LocalAngelRunnerDeps> = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  db.exec(`INSERT INTO users (id, email, password_hash, name) VALUES (1, 'pat@example.com', 'h', 'Pat Okello')`)
  const history = new AngelHistoryRepository(db)
  const deps: LocalAngelRunnerDeps = {
    session: { restore: async () => ({ id: 1, name: 'Pat Okello' }) },
    angels: {
      list: vi.fn(async () => ({ status: 'ready' as const, angels: [angel] })),
      recipe: vi.fn(async () => ({ status: 'ready' as const, recipe })),
    },
    history,
    stories: {
      findStorySections: vi.fn(async () => ({
        sections: [{ label: 'My Story › Childhood › Home', text: 'We lived by the lake.' }],
        cite: () => [{ label: 'My Story › Childhood › Home', excerpt: 'We lived by the lake.' }],
      })),
    },
    runtime: { ensureGenerationRuntime: vi.fn(async () => true), installedModel: vi.fn(async () => 'Qwen_Qwen3.5-0.8B-Q4_K_M') },
    qwen: { chat: vi.fn(async () => 'Good morning, Pat. You lived by the lake.') },
    ...overrides,
  }
  return { runner: new LocalAngelRunner(deps), deps, history }
}

describe('LocalAngelRunner', () => {
  it('opens a runnable angel and reports the local runtime', async () => {
    const { runner } = setup()
    await expect(runner.open('5')).resolves.toEqual({
      status: 'ready', angel: { id: '5', name: 'Morning Check-in' },
      runtime: { backend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [], offline: false,
    })
  })

  it('refuses angels that do not run here', async () => {
    const { runner } = setup({ angels: { list: async () => ({ status: 'ready', angels: [{ ...angel, runsHere: false }] }), recipe: vi.fn() } })
    await expect(runner.open('5')).resolves.toEqual({ status: 'not-here' })
  })

  it('uses the cached recipe when disconnected, and asks to connect without one', async () => {
    const first = setup()
    await first.runner.open('5')
    const offline = new LocalAngelRunner({ ...first.deps, angels: { list: async () => ({ status: 'disconnected' }), recipe: vi.fn() } })
    await expect(offline.open('5')).resolves.toMatchObject({ status: 'ready', offline: true })
    const fresh = setup({ angels: { list: async () => ({ status: 'disconnected' }), recipe: vi.fn() } })
    await expect(fresh.runner.open('5')).resolves.toEqual({ status: 'connect-needed' })
  })

  it('asks for private AI when no model is installed', async () => {
    const { runner } = setup({ runtime: { ensureGenerationRuntime: async () => false, installedModel: async () => null } })
    await expect(runner.open('5')).resolves.toEqual({ status: 'private-ai-needed' })
  })

  it('replies with memories, saves both sides with the runtime, and sends nothing over the network', async () => {
    const { runner, deps, history } = setup()
    await runner.open('5')
    const result = await runner.send('5', '  Tell me about home  ')
    expect(result).toMatchObject({
      status: 'replied',
      person: { role: 'person', text: 'Tell me about home' },
      reply: { role: 'angel', text: 'Good morning, Pat. You lived by the lake.', sources: [{ label: 'My Story › Childhood › Home' }] },
    })
    const [prompt, maxTokens] = vi.mocked(deps.qwen.chat).mock.calls[0]!
    expect(maxTokens).toBe(256)
    expect(JSON.stringify(prompt)).toContain('We lived by the lake.')
    expect(JSON.stringify(prompt)).toContain('Pat')
    if (result.status !== 'replied') throw new Error('expected a reply')
    expect(history.model(1, '5', result.reply.id)).toEqual({ executionBackend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' })
    expect(deps.angels.recipe).toHaveBeenCalledTimes(1)
  })

  it('answers a safety trigger with the fixed reply and never calls the model', async () => {
    const { runner, deps } = setup()
    await runner.open('5')
    const result = await runner.send('5', "I don't know where I am")
    expect(result).toMatchObject({ status: 'replied', reply: { escalation: 'confusion', sources: [] } })
    expect(deps.qwen.chat).not.toHaveBeenCalled()
  })

  it('answers without memories when story search fails, and saves nothing when generation fails', async () => {
    const { runner, history } = setup({
      stories: { findStorySections: async () => { throw new Error('search down') } },
      qwen: { chat: vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue('Hello') },
    })
    await runner.open('5')
    await expect(runner.send('5', 'Hi')).resolves.toEqual({ status: 'failed' })
    expect(history.list(1, '5')).toEqual([])
    await expect(runner.send('5', 'Hi')).resolves.toMatchObject({ status: 'replied', reply: { sources: [] } })
  })

  it('refuses empty and over-long messages, and clears and forgets history', async () => {
    const { runner, history } = setup()
    await runner.open('5')
    await expect(runner.send('5', '   ')).resolves.toEqual({ status: 'failed' })
    await expect(runner.send('5', 'x'.repeat(1001))).resolves.toEqual({ status: 'failed' })
    await runner.send('5', 'Hi')
    await runner.clear('5')
    expect(history.list(1, '5')).toEqual([])
    await runner.forget('5')
    expect(history.recipe(1, '5')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/agentic/LocalAngelRunner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/main/agentic/LocalAngelRunner.ts`:

```ts
import { TEMPLATE_ID, type MyAngelsResult } from '../../shared/agentic'
import {
  MAX_ANGEL_MESSAGE,
  type AngelChatOpenResult,
  type AngelChatSendResult,
  type AngelChatSource,
  type ChatTurn,
  type StorySection,
} from '../../shared/agenticChat'
import type { AngelHistoryRepository } from './AngelHistoryRepository'
import { buildAngelPrompt, STORY_TOOL } from './angelPrompt'
import { isAngelRecipe, type AngelRecipe } from './angelRecipe'
import { ESCALATION_REPLIES, escalationFor } from './angelSafety'
import type { RecipeResult } from './MyGuardianAngels'

const REPLY_TOKENS = 256
const HISTORY_FOR_PROMPT = 6

export interface LocalAngelRunnerDeps {
  session: { restore(): Promise<{ id: number; name: string | null } | null> }
  angels: { list(): Promise<MyAngelsResult>; recipe(angelId: string): Promise<RecipeResult> }
  history: Pick<AngelHistoryRepository, 'add' | 'list' | 'recent' | 'clear' | 'saveRecipe' | 'recipe' | 'forget'>
  stories: { findStorySections(localUserId: number, query: string): Promise<{ sections: StorySection[]; cite(answer: string): AngelChatSource[] }> }
  runtime: { ensureGenerationRuntime(): Promise<boolean>; installedModel(): Promise<string | null> }
  qwen: { chat(messages: ChatTurn[], maxTokens: number): Promise<string> }
  interactiveGate?: { begin(): () => void }
}

/** Runs the person's own angels on Family Circle's llama.cpp runtime. Conversations never leave this computer. */
export class LocalAngelRunner {
  private readonly recipes = new Map<string, AngelRecipe>()

  constructor(private readonly deps: LocalAngelRunnerDeps) {}

  async open(angelId: string): Promise<AngelChatOpenResult> {
    const user = await this.deps.session.restore()
    if (!user || !TEMPLATE_ID.test(angelId)) return { status: 'unavailable' }

    let recipe: AngelRecipe | null = null
    let offline = true
    const listed = await this.deps.angels.list()
    if (listed.status === 'ready') {
      const angel = listed.angels.find((item) => item.id === angelId)
      if (!angel?.runsHere) return { status: 'not-here' }
      const fetched = await this.deps.angels.recipe(angelId)
      if (fetched.status === 'ready') {
        recipe = fetched.recipe
        offline = false
        this.deps.history.saveRecipe(user.id, angelId, JSON.stringify(recipe))
      }
    }
    recipe ??= this.cached(user.id, angelId)
    if (!recipe) return { status: listed.status === 'disconnected' ? 'connect-needed' : 'unavailable' }
    this.recipes.set(this.key(user.id, angelId), recipe)

    const model = await this.deps.runtime.installedModel()
    if (!model) return { status: 'private-ai-needed' }
    return {
      status: 'ready',
      angel: { id: angelId, name: recipe.name },
      runtime: { backend: 'llama.cpp', model },
      messages: this.deps.history.list(user.id, angelId),
      offline,
    }
  }

  async send(angelId: string, input: string): Promise<AngelChatSendResult> {
    const user = await this.deps.session.restore()
    const text = typeof input === 'string' ? input.trim() : ''
    if (!user || !TEMPLATE_ID.test(angelId) || !text || text.length > MAX_ANGEL_MESSAGE) return { status: 'failed' }
    const recipe = this.recipes.get(this.key(user.id, angelId)) ?? this.cached(user.id, angelId)
    if (!recipe) return { status: 'connect-needed' }

    const escalation = escalationFor(text, recipe.escalationKeys)
    if (escalation) {
      const person = this.deps.history.add(user.id, angelId, { role: 'person', text })
      const reply = this.deps.history.add(user.id, angelId, { role: 'angel', text: ESCALATION_REPLIES[escalation], escalation })
      return { status: 'replied', person, reply }
    }

    const end = this.deps.interactiveGate?.begin()
    try {
      const model = await this.deps.runtime.installedModel()
      if (!model || !await this.deps.runtime.ensureGenerationRuntime()) return { status: 'private-ai-needed' }

      let found: { sections: StorySection[]; cite(answer: string): AngelChatSource[] } = { sections: [], cite: () => [] }
      if (recipe.tools.includes(STORY_TOOL)) {
        // Without search the angel still answers, just without memories.
        found = await this.deps.stories.findStorySections(user.id, text).catch(() => found)
      }
      const prompt = buildAngelPrompt({
        recipe,
        firstName: user.name?.trim().split(/\s+/)[0] || null,
        stories: found.sections,
        history: this.deps.history.recent(user.id, angelId, HISTORY_FOR_PROMPT),
        message: text,
      })
      let answer: string
      try {
        answer = await this.deps.qwen.chat(prompt, REPLY_TOKENS)
      } catch {
        return { status: 'failed' }
      }
      const person = this.deps.history.add(user.id, angelId, { role: 'person', text })
      const reply = this.deps.history.add(user.id, angelId, {
        role: 'angel', text: answer, sources: found.cite(answer), executionBackend: 'llama.cpp', model,
      })
      return { status: 'replied', person, reply }
    } finally {
      end?.()
    }
  }

  async clear(angelId: string): Promise<void> {
    const user = await this.deps.session.restore()
    if (user && TEMPLATE_ID.test(angelId)) this.deps.history.clear(user.id, angelId)
  }

  async forget(angelId: string): Promise<void> {
    const user = await this.deps.session.restore()
    if (!user || !TEMPLATE_ID.test(angelId)) return
    this.recipes.delete(this.key(user.id, angelId))
    this.deps.history.forget(user.id, angelId)
  }

  private cached(localUserId: number, angelId: string): AngelRecipe | null {
    const json = this.deps.history.recipe(localUserId, angelId)
    if (!json) return null
    try {
      const parsed = JSON.parse(json) as unknown
      return isAngelRecipe(parsed) && parsed.angelId === angelId ? parsed : null
    } catch {
      return null
    }
  }

  private key(localUserId: number, angelId: string): string {
    return `${localUserId}:${angelId}`
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/main/agentic/LocalAngelRunner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic/LocalAngelRunner.ts src/main/agentic/LocalAngelRunner.test.ts
git commit -m "feat: run angels on this computer"
```

---

### Task 9: IPC, preload and main wiring

**Files:**
- Modify: `src/main/agentic/agenticIpc.ts`, test `src/main/agentic/agenticIpc.test.ts`
- Modify: `src/shared/desktopApi.ts`, `src/preload/createDesktopApi.ts` (and its test, if the preload has one listing channels)
- Modify: `src/main/ai/AiRuntimeManager.ts` (`installedModel()`), test `src/main/ai/AiRuntimeManager.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**
- Consumes: `LocalAngelRunner` (Task 8), `safeAngelChatOpen`, `safeAngelChatSend`, `MAX_ANGEL_MESSAGE` (Task 3).
- Produces:
  - IPC channels `agentic:angel-chat-open` `{angelId}` → `AngelChatOpenResult`, `agentic:angel-chat-send` `{angelId, text}` → `AngelChatSendResult`, `agentic:angel-chat-clear` `{angelId}` → `{success: true}`.
  - `AgenticIpcDeps.chat: Pick<LocalAngelRunner, 'open' | 'send' | 'clear' | 'forget'>`
  - On `agentic:remove-angel` with result `removed`, `chat.forget(angelId)` is called.
  - Preload `window.familyCircle.agentic.openAngelChat({angelId})`, `sendAngelMessage({angelId, text})`, `clearAngelChat({angelId})`.
  - `AiRuntimeManager.installedModel(): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/agentic/agenticIpc.test.ts`, following the file's existing `setup()` that registers handlers on a fake `ipc` and calls them. Add a `chat` dependency of `{ open: vi.fn(async () => ({ status: 'not-here' })), send: vi.fn(async () => ({ status: 'failed' })), clear: vi.fn(async () => undefined), forget: vi.fn(async () => undefined) }` to that setup.

```ts
it('opens, sends and clears angel chats with validated input', async () => {
  const { invoke, deps } = setup()
  await expect(invoke('agentic:angel-chat-open', { angelId: '5' })).resolves.toEqual({ status: 'not-here' })
  await invoke('agentic:angel-chat-send', { angelId: '5', text: 'Hi' })
  expect(deps.chat.send).toHaveBeenCalledWith('5', 'Hi')
  await expect(invoke('agentic:angel-chat-send', { angelId: '5', text: 'x'.repeat(1001) })).rejects.toThrow()
  await expect(invoke('agentic:angel-chat-open', { angelId: '../5' })).rejects.toThrow()
  await expect(invoke('agentic:angel-chat-clear', { angelId: '5' })).resolves.toEqual({ success: true })
  expect(deps.chat.clear).toHaveBeenCalledWith('5')
})

it('forgets the local conversation when an angel is removed', async () => {
  const { invoke, deps } = setup()
  deps.angels.remove.mockResolvedValue({ status: 'removed' })
  await invoke('agentic:remove-angel', { angelId: '5' })
  expect(deps.chat.forget).toHaveBeenCalledWith('5')
})
```

Add to `src/main/ai/AiRuntimeManager.test.ts`, using its existing asset fake:

```ts
it('names the installed generation model without its extension', async () => {
  const manager = new AiRuntimeManager({ assets: { getInstalledPaths: async () => ({ llamaDir: 'C:/ai', serverExe: 'C:/ai/llama-server.exe', generationModel: 'C:/ai/models/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf', nomicModel: 'C:/ai/models/nomic.gguf' }) } })
  await expect(manager.installedModel()).resolves.toBe('Qwen_Qwen3.5-0.8B-Q4_K_M')
  const none = new AiRuntimeManager({ assets: { getInstalledPaths: async () => null } })
  await expect(none.installedModel()).resolves.toBeNull()
})
```

If the `AiRuntimeManager` constructor needs more dependencies in tests, pass the same fakes the file's other tests pass.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/agentic/agenticIpc.test.ts src/main/ai/AiRuntimeManager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/main/ai/AiRuntimeManager.ts`, add `import { basename } from 'node:path'` and a method:

```ts
  /** The installed answer model's file name without ".gguf", e.g. "Qwen_Qwen3.5-0.8B-Q4_K_M". */
  async installedModel(): Promise<string | null> {
    const installed = await this.assets.getInstalledPaths()
    return installed ? basename(installed.generationModel).replace(/\.gguf$/i, '') : null
  }
```

Use whatever field the class stores the `assets` dependency in; check the constructor.

`src/main/agentic/agenticIpc.ts`:
- Import `MAX_ANGEL_MESSAGE` from `../../shared/agenticChat` and `type LocalAngelRunner` from `./LocalAngelRunner`.
- Add `chat: Pick<LocalAngelRunner, 'open' | 'send' | 'clear' | 'forget'>` to `AgenticIpcDeps`.
- Replace the remove handler and add three handlers:

```ts
  ipc.handle('agentic:remove-angel', async (_event, payload) => {
    const angelId = catalogIdOf(payload, 'angelId')
    const result = await deps.angels.remove(angelId)
    // Removing an angel also removes its conversation and recipe from this computer.
    if (result.status === 'removed') await deps.chat.forget(angelId).catch(() => undefined)
    return { status: result.status }
  })
  ipc.handle('agentic:angel-chat-open', async (_event, payload) => deps.chat.open(catalogIdOf(payload, 'angelId')))
  ipc.handle('agentic:angel-chat-send', async (_event, payload) => {
    const text = recordOf(payload).text
    if (typeof text !== 'string' || text.length > MAX_ANGEL_MESSAGE) throw new Error('Invalid message')
    return deps.chat.send(catalogIdOf(payload, 'angelId'), text)
  })
  ipc.handle('agentic:angel-chat-clear', async (_event, payload) => {
    await deps.chat.clear(catalogIdOf(payload, 'angelId'))
    return { success: true }
  })
```

`src/shared/desktopApi.ts`, inside the `agentic` API interface next to `removeAngel`:

```ts
    openAngelChat(input: { angelId: string }): Promise<AngelChatOpenResult>
    sendAngelMessage(input: { angelId: string; text: string }): Promise<AngelChatSendResult>
    clearAngelChat(input: { angelId: string }): Promise<{ success: true }>
```

with `import type { AngelChatOpenResult, AngelChatSendResult } from './agenticChat'`.

`src/preload/createDesktopApi.ts`: import `safeAngelChatOpen, safeAngelChatSend` from `../shared/agenticChat` and add after `removeAngel`:

```ts
      async openAngelChat(input) {
        return safeAngelChatOpen(await invoke('agentic:angel-chat-open', { angelId: String(input.angelId) }))
      },
      async sendAngelMessage(input) {
        return safeAngelChatSend(await invoke('agentic:angel-chat-send', { angelId: String(input.angelId), text: String(input.text) }))
      },
      async clearAngelChat(input) {
        await invoke('agentic:angel-chat-clear', { angelId: String(input.angelId) })
        return { success: true as const }
      },
```

If the preload validates channel names against an allow-list, add the three channels to it.

`src/main/main.ts`:
- The agentic setup (around `createAngelsController`) and the private AI services (`createAppServices`, around `PrivateArchiveQueryService`) are built in different functions. Expose what the runner needs on `AppServices`:
  - Add `privateArchiveQueryService` and an `angelHistory: new AngelHistoryRepository(database)` to the services object, and add both to the `AppServices` interface.
  - `aiRuntimeManager`, `interactiveAiGate` and `sessions` are already reachable there; use the same references the file uses.
- Keep one `MyGuardianAngels` instance in a const (`myAngels`) so the controller and the runner share it.
- Build the runner next to the controller:

```ts
  const myAngels = new MyGuardianAngels({ /* the existing options */ })
  angels = createAngelsController({ connection: angelConnection, angels: myAngels, /* existing openPage, accountKey */ })
  const angelChat = new LocalAngelRunner({
    session: services.sessions,
    angels: { list: () => angels!.list(), recipe: (angelId) => myAngels.recipe(angelId) },
    history: services.angelHistory,
    stories: services.privateArchiveQueryService,
    runtime: aiRuntimeManager,
    qwen: new QwenClient(),
    interactiveGate: interactiveAiGate,
  })
```

  `angels.list()` goes through the controller, so the signed-in account check still applies.
- Pass `chat: angelChat` to `registerAgenticIpc`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/main src/preload src/shared && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload src/shared
git commit -m "feat: wire angel conversations through IPC"
```

---

### Task 10: The conversation page and Talk button

**Files:**
- Modify: `src/renderer/services/agentic/AgenticClient.ts`, `src/renderer/services/agentic/DesktopAgenticClient.ts`, `src/renderer/test/fakeAgenticClient.ts`
- Create: `src/renderer/features/agentic/AngelChatPage.tsx`
- Test: `src/renderer/features/agentic/AngelChatPage.test.tsx`
- Modify: `src/renderer/features/agentic/MyGuardianAngelsPanel.tsx`, `src/renderer/features/agentic/angelMessages.ts`, `src/renderer/app/App.tsx`, `src/renderer/features/agentic/agentic.css`
- Test: `src/renderer/features/agentic/GuardianAngelPage.angels.test.tsx`

**Interfaces:**
- Consumes: the preload methods (Task 9), `AngelChatOpenResult`, `AngelChatSendResult`, `AngelChatMessage` (Task 3).
- Produces:
  - `AgenticClient.openAngelChat(angelId: string): Promise<AngelChatOpenResult>`
  - `AgenticClient.sendAngelMessage(angelId: string, text: string): Promise<AngelChatSendResult>`
  - `AgenticClient.clearAngelChat(angelId: string): Promise<void>`
  - Route `/agentic/guardian-angel/chat?angel=<id>`, exported as `ANGEL_CHAT = '/agentic/guardian-angel/chat'` from `angelMessages.ts`

- [ ] **Step 1: Write the failing tests**

`src/renderer/features/agentic/AngelChatPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AngelChatMessage } from '../../../shared/agenticChat'
import { AppServicesProvider } from '../../app/services'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../../test/fakeAgenticClient'
import { AngelChatPage } from './AngelChatPage'

const message = (id: number, role: 'person' | 'angel', text: string, extra: Partial<AngelChatMessage> = {}): AngelChatMessage => ({
  id, role, text, sources: [], escalation: null, createdAt: '2026-10-23T10:00:00.000Z', ...extra,
})
const ready = {
  status: 'ready' as const, angel: { id: '5', name: 'Morning Check-in' },
  runtime: { backend: 'llama.cpp' as const, model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [message(1, 'angel', 'Hello again')], offline: false,
}

function renderPage(agentic = fakeAgenticClient()) {
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={['/agentic/guardian-angel/chat?angel=5']}>
        <Routes>
          <Route path="/agentic/guardian-angel/chat" element={<AngelChatPage />} />
          <Route path="*" element={<p>Elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

describe('AngelChatPage', () => {
  it('shows the history and that it runs on this computer', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    renderPage(agentic)
    expect(await screen.findByRole('heading', { name: 'Morning Check-in' })).toBeInTheDocument()
    expect(screen.getByText('Runs on this computer · llama.cpp · Qwen3.5-0.8B')).toBeInTheDocument()
    expect(screen.getByText('Hello again')).toBeInTheDocument()
  })

  it('sends a message and shows the reply with its memories', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    agentic.sendAngelMessage.mockResolvedValue({
      status: 'replied', person: message(2, 'person', 'Tell me about home'),
      reply: message(3, 'angel', 'You lived by the lake.', { sources: [{ label: 'My Story › Childhood › Home', excerpt: 'We lived by the lake.' }] }),
    })
    renderPage(agentic)
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Tell me about home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('You lived by the lake.')).toBeInTheDocument()
    expect(screen.getByText('My Story › Childhood › Home')).toBeInTheDocument()
    expect(agentic.sendAngelMessage).toHaveBeenCalledWith('5', 'Tell me about home')
  })

  it('keeps the typed message when the angel cannot answer', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    agentic.sendAngelMessage.mockResolvedValue({ status: 'failed' })
    renderPage(agentic)
    const box = await screen.findByLabelText('Message')
    fireEvent.change(box, { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText("The angel couldn't answer just now. Try again.")).toBeInTheDocument()
    expect(box).toHaveValue('Hi')
  })

  it('marks safety replies', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue({ ...ready, messages: [message(1, 'angel', 'Please get help now.', { escalation: 'medical-emergency' })] })
    renderPage(agentic)
    expect(await screen.findByRole('note', { name: 'Safety message' })).toHaveTextContent('Please get help now.')
  })

  it('explains what is needed when the angel cannot open', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue({ status: 'private-ai-needed' })
    renderPage(agentic)
    expect(await screen.findByText('Set up private AI in Settings to talk with your angels here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
  })

  it('clears the history after asking', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    renderPage(agentic)
    fireEvent.click(await screen.findByRole('button', { name: "Clear this angel's history" }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    await waitFor(() => expect(agentic.clearAngelChat).toHaveBeenCalledWith('5'))
    expect(screen.queryByText('Hello again')).not.toBeInTheDocument()
  })
})
```

Add to `src/renderer/features/agentic/GuardianAngelPage.angels.test.tsx`:

```tsx
it('offers Talk only for angels that run on this computer', async () => {
  const agentic = fakeAgenticClient()
  agentic.getAngelConnection.mockResolvedValue({ status: 'connected', email: 'pat@example.test' })
  agentic.getMyAngels.mockResolvedValue({ status: 'ready', angels: [SAMPLE_ANGEL, { ...SAMPLE_ANGEL, id: '6', name: 'Shift Notes', runsHere: false }] })
  renderAt('/agentic/guardian-angel?tab=mine', agentic)
  const talk = await screen.findAllByRole('button', { name: 'Talk' })
  expect(talk).toHaveLength(1)
  fireEvent.click(talk[0]!)
  expect(where()).toBe('/agentic/guardian-angel/chat?angel=5')
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/renderer/features/agentic`
Expected: FAIL (module not found; no Talk button).

- [ ] **Step 3: Implement the client**

`AgenticClient.ts`, add to the interface (and import the two result types from `../../../shared/agenticChat`):

```ts
  /** A conversation with one of the person's angels, run on this computer. */
  openAngelChat(angelId: string): Promise<AngelChatOpenResult>
  sendAngelMessage(angelId: string, text: string): Promise<AngelChatSendResult>
  clearAngelChat(angelId: string): Promise<void>
```

`DesktopAgenticClient.ts`: add `openAngelChat: (input) => window.familyCircle.agentic.openAngelChat(input)`, `sendAngelMessage: (input) => window.familyCircle.agentic.sendAngelMessage(input)` and `clearAngelChat: (input) => window.familyCircle.agentic.clearAngelChat(input)` to the operations object. Then add the methods:

```ts
  openAngelChat(angelId: string) {
    return this.operations.openAngelChat({ angelId })
  }

  sendAngelMessage(angelId: string, text: string) {
    return this.operations.sendAngelMessage({ angelId, text })
  }

  async clearAngelChat(angelId: string) {
    await this.operations.clearAngelChat({ angelId })
  }
```

Match how the class types its `operations` field; add the three keys to that type.

`fakeAgenticClient.ts`, add to the fake:

```ts
    openAngelChat: vi.fn(async (_angelId: string): Promise<AngelChatOpenResult> => ({ status: 'not-here' })),
    sendAngelMessage: vi.fn(async (_angelId: string, _text: string): Promise<AngelChatSendResult> => ({ status: 'failed' })),
    clearAngelChat: vi.fn(async (_angelId: string) => undefined),
```

- [ ] **Step 4: Implement the page and the Talk button**

`angelMessages.ts`: add `export const ANGEL_CHAT = '/agentic/guardian-angel/chat'`.

`src/renderer/features/agentic/AngelChatPage.tsx`:

```tsx
import { ArrowLeft, Send, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MAX_ANGEL_MESSAGE, type AngelChatMessage, type AngelChatOpenResult } from '../../../shared/agenticChat'
import { useAppServices } from '../../app/services'
import { MY_ANGELS_TAB } from './angelMessages'
import './agentic.css'

const NOT_READY: Record<Exclude<AngelChatOpenResult['status'], 'ready'>, string> = {
  'private-ai-needed': 'Set up private AI in Settings to talk with your angels here.',
  'connect-needed': 'Connect your Kin-Keepers.ai account once so Family Circle can get this angel.',
  'not-here': 'This angel runs only on Kin-Keepers.ai.',
  unavailable: "This angel couldn't be opened just now. Try again.",
}

function modelLabel(model: string): string {
  return model.replace(/^Qwen_/, '').replace(/-Q\d.*$/i, '')
}

function Message({ message }: { message: AngelChatMessage }) {
  if (message.escalation) {
    return (
      <div className="angel-chat__message angel-chat__message--safety" role="note" aria-label="Safety message">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>{message.text}</p>
      </div>
    )
  }
  return (
    <div className={`angel-chat__message angel-chat__message--${message.role}`}>
      <p>{message.text}</p>
      {message.sources.length > 0 && (
        <ul className="angel-chat__sources" aria-label="Memories used">
          {message.sources.map((source) => <li key={source.label} title={source.excerpt}>{source.label}</li>)}
        </ul>
      )}
    </div>
  )
}

/** A conversation with one of the person's angels, run on this computer with private AI. */
export function AngelChatPage() {
  const { agentic } = useAppServices()
  const [params] = useSearchParams()
  const angelId = params.get('angel') ?? ''
  const [opened, setOpened] = useState<AngelChatOpenResult | null>(null)
  const [messages, setMessages] = useState<AngelChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const sendingRef = useRef(false)

  useEffect(() => {
    if (!agentic) return
    let current = true
    void agentic.openAngelChat(angelId).catch((): AngelChatOpenResult => ({ status: 'unavailable' })).then((result) => {
      if (!current) return
      setOpened(result)
      setMessages(result.status === 'ready' ? result.messages : [])
    })
    return () => { current = false }
  }, [agentic, angelId])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!agentic || !text || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setNotice(null)
    try {
      const result = await agentic.sendAngelMessage(angelId, text).catch(() => ({ status: 'failed' as const }))
      if (result.status === 'replied') {
        setMessages((list) => [...list, result.person, result.reply])
        setDraft('')
      } else if (result.status === 'failed') {
        setNotice("The angel couldn't answer just now. Try again.")
      } else {
        setNotice(NOT_READY[result.status])
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const clear = async () => {
    if (!agentic) return
    await agentic.clearAngelChat(angelId).catch(() => undefined)
    setMessages([])
    setConfirmingClear(false)
  }

  const back = <Link className="agentic-back" to={MY_ANGELS_TAB}><ArrowLeft size={16} aria-hidden="true" /> My Guardian Angels</Link>

  if (!opened) return <section className="angel-chat">{back}<p role="status">Opening…</p></section>
  if (opened.status !== 'ready') {
    return (
      <section className="angel-chat">
        {back}
        <p>{NOT_READY[opened.status]}</p>
        {opened.status === 'private-ai-needed' && <Link className="agentic-button" to="/settings">Open Settings</Link>}
        {opened.status === 'connect-needed' && <Link className="agentic-button" to={MY_ANGELS_TAB}>Connect</Link>}
      </section>
    )
  }

  return (
    <section className="angel-chat">
      {back}
      <header className="angel-chat__header">
        <h1>{opened.angel.name}</h1>
        <p className="angel-chat__runtime">Runs on this computer · llama.cpp · {modelLabel(opened.runtime.model)}</p>
        {opened.offline && <p className="angel-chat__offline">Using the copy of this angel saved on this computer.</p>}
        <p className="angel-chat__privacy">Your conversation stays on this computer. The angel can use your confirmed My Story memories.</p>
      </header>

      <div className="angel-chat__messages" aria-live="polite">
        {messages.length === 0 && <p className="angel-chat__empty">Say hello to start.</p>}
        {messages.map((message) => <Message key={message.id} message={message} />)}
        {sending && <p role="status" className="angel-chat__thinking">{opened.angel.name} is thinking…</p>}
      </div>

      {notice && <p className="angel-chat__notice" role="alert">{notice}</p>}

      <form className="angel-chat__form" onSubmit={(event) => void send(event)}>
        <label htmlFor="angel-message" className="visually-hidden">Message</label>
        <textarea id="angel-message" value={draft} maxLength={MAX_ANGEL_MESSAGE} rows={2}
          onChange={(event) => setDraft(event.target.value)} disabled={sending} />
        <button type="submit" className="agentic-button agentic-button--primary" disabled={sending || !draft.trim()}>
          <Send size={16} aria-hidden="true" /> Send
        </button>
      </form>

      {confirmingClear ? (
        <div className="angel-chat__confirm" role="dialog" aria-label="Clear history">
          <p>Delete this conversation from this computer? This can't be undone.</p>
          <button type="button" className="agentic-button" onClick={() => setConfirmingClear(false)}>Cancel</button>
          <button type="button" className="agentic-button agentic-button--danger-solid" onClick={() => void clear()}>Clear history</button>
        </div>
      ) : (
        <button type="button" className="agentic-button agentic-button--danger" onClick={() => setConfirmingClear(true)}>
          <Trash2 size={16} aria-hidden="true" /> Clear this angel's history
        </button>
      )}
    </section>
  )
}
```

If the project's visually-hidden class has a different name, use that one (search `agentic.css` and `src/renderer/styles` for `sr-only` or `visually-hidden`). If the back link in `PartnerViewPage.tsx` uses a different class, reuse it.

`MyGuardianAngelsPanel.tsx`: give the card component an `onTalk?: () => void` prop and render, first among the card buttons:

```tsx
        {onTalk && (
          <button type="button" className="agentic-button agentic-button--primary" onClick={onTalk}>
            <MessageCircle size={16} aria-hidden="true" /> Talk
          </button>
        )}
```

Add `MessageCircle` to the lucide import. Where cards are rendered (next to `onOpen=...`), pass:

```tsx
              onTalk={angel.runsHere ? () => navigate(`${ANGEL_CHAT}?angel=${encodeURIComponent(angel.id)}`) : undefined}
```

and import `ANGEL_CHAT` from `./angelMessages`.

`App.tsx`: import `AngelChatPage` and add `<Route path="/agentic/guardian-angel/chat" element={<AngelChatPage />} />` after the Guardian Angel route.

`agentic.css`, add (use the file's existing colour variables in place of the literal colours if it defines them):

```css
.angel-chat { display: flex; flex-direction: column; gap: 16px; max-width: 760px; }
.angel-chat__header h1 { margin: 0; }
.angel-chat__runtime, .angel-chat__privacy, .angel-chat__offline { margin: 4px 0 0; color: var(--text-muted, #5b6472); font-size: 0.9rem; }
.angel-chat__messages { display: flex; flex-direction: column; gap: 10px; min-height: 200px; }
.angel-chat__message { max-width: 85%; padding: 10px 14px; border-radius: 12px; }
.angel-chat__message p { margin: 0; white-space: pre-wrap; }
.angel-chat__message--person { align-self: flex-end; background: var(--surface-accent, #e9fbf6); }
.angel-chat__message--angel { align-self: flex-start; background: var(--surface-muted, #f2f4f7); }
.angel-chat__message--safety { align-self: stretch; display: flex; gap: 10px; background: #fff4e5; border: 1px solid #f0b35b; }
.angel-chat__sources { margin: 8px 0 0; padding: 0; list-style: none; font-size: 0.8rem; color: var(--text-muted, #5b6472); }
.angel-chat__form { display: flex; gap: 8px; align-items: flex-end; }
.angel-chat__form textarea { flex: 1; resize: vertical; font: inherit; padding: 8px; }
.angel-chat__notice { color: var(--danger, #b42318); margin: 0; }
.angel-chat__confirm { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
```

- [ ] **Step 5: Run the renderer tests**

Run: `npx vitest run src/renderer/features/agentic`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: talk with an angel on this computer"
```

---

### Task 11: Full check and live verification

**Files:**
- Modify (only if a check fails): files from earlier tasks

- [ ] **Step 1: Run the whole check**

Run: `npm run check`
Expected: typecheck, all tests, the boundary check and the build pass. `src/main/ai` imports angel types only from `src/shared/agenticChat.ts`, never from `src/main/agentic`. If the boundary check flags another import, fix the import, not the rule.

- [ ] **Step 2: Live check in the isolated test profile**

Use the test app setup from the My Guardian Angels live test (scratchpad `agentic-check` profile, test account `kasulejohntrevor@gmail.com`, password from Trevor, never stored or printed). Private AI must be set up in that profile, and at least one My Story answer confirmed and indexed.
1. Connect, open My Guardian Angels, add Elder Companion, and check it shows **Talk**. Check an angel from another template (for example Shift Handoff) shows no Talk.
2. Talk: "Tell me about where I grew up". Expect a short reply naming a confirmed memory, with that memory under it as a source. Check the header reads "Runs on this computer · llama.cpp · Qwen3.5-0.8B".
3. Send "I have chest pain". Expect the fixed safety message, marked as a safety note.
4. Disconnect, reopen the angel. Expect "Using the copy of this angel saved on this computer." and a working reply.
5. Clear this angel's history. Expect an empty conversation after reopening.
6. Reconnect, remove the test angel, and check its rows are gone: `SELECT COUNT(*) FROM angel_messages WHERE angel_id = '<id>'` returns 0 in the test profile's `family.db`.
7. Disconnect the app session and close the test app.

- [ ] **Step 3: Commit any fixes and push**

```bash
git push -u origin feat/local-angels
```

Open a PR against `main` after PR #71 merges (or against `feat/my-guardian-angels` until then), with the live check results in the description.
