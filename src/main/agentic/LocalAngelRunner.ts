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

type StoryMatch = { sections: StorySection[]; cite(answer: string): AngelChatSource[] }

export interface LocalAngelRunnerDeps {
  session: { restore(): Promise<{ id: number; name: string | null } | null> }
  angels: { list(): Promise<MyAngelsResult>; recipe(angelId: string): Promise<RecipeResult> }
  history: Pick<AngelHistoryRepository, 'add' | 'list' | 'recent' | 'clear' | 'saveRecipe' | 'recipe' | 'forget'>
  stories: { findStorySections(localUserId: number, query: string): Promise<StoryMatch> }
  runtime: { ensureGenerationRuntime(): Promise<boolean>; installedModel(): Promise<string | null> }
  qwen: { chat(messages: ChatTurn[], maxTokens: number): Promise<string> }
  /** Marks a question in progress so background indexing yields the CPU to it. */
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
    // Disconnected or offline: the copy saved the last time this angel was opened.
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

    // Safety comes first and never depends on the model.
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

      let found: StoryMatch = { sections: [], cite: () => [] }
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

  /** Removes the conversation and the saved recipe, for an angel that was removed. */
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
