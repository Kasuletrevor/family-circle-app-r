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

  it('refuses angels that do not run here, are missing, or bad ids', async () => {
    const { runner } = setup({ angels: { list: async () => ({ status: 'ready', angels: [{ ...angel, runsHere: false }] }), recipe: vi.fn() } })
    await expect(runner.open('5')).resolves.toEqual({ status: 'not-here' })
    await expect(runner.open('6')).resolves.toEqual({ status: 'not-here' })
    await expect(runner.open('../5')).resolves.toEqual({ status: 'unavailable' })
  })

  it('uses the cached recipe when disconnected, and asks to connect without one', async () => {
    const first = setup()
    await first.runner.open('5')
    const offline = new LocalAngelRunner({ ...first.deps, angels: { list: async () => ({ status: 'disconnected' }), recipe: vi.fn() } })
    await expect(offline.open('5')).resolves.toMatchObject({ status: 'ready', offline: true })
    await expect(offline.send('5', 'Hi')).resolves.toMatchObject({ status: 'replied' })
    const fresh = setup({ angels: { list: async () => ({ status: 'disconnected' }), recipe: vi.fn() } })
    await expect(fresh.runner.open('5')).resolves.toEqual({ status: 'connect-needed' })
    await expect(fresh.runner.send('5', 'Hi')).resolves.toEqual({ status: 'connect-needed' })
  })

  it('asks for private AI when no model is installed', async () => {
    const { runner } = setup({ runtime: { ensureGenerationRuntime: async () => false, installedModel: async () => null } })
    await expect(runner.open('5')).resolves.toEqual({ status: 'private-ai-needed' })
    await expect(runner.send('5', 'Hi')).resolves.toEqual({ status: 'private-ai-needed' })
  })

  it('replies with memories and saves both sides with the runtime', async () => {
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
    expect(JSON.stringify(prompt)).toContain('You are talking with Pat.')
    if (result.status !== 'replied') throw new Error('expected a reply')
    expect(history.model(1, '5', result.reply.id)).toEqual({ executionBackend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' })
    expect(deps.angels.recipe).toHaveBeenCalledTimes(1)
  })

  it('searches stories only when the angel has the family content tool', async () => {
    const { runner, deps } = setup({ angels: { list: async () => ({ status: 'ready', angels: [angel] }), recipe: async () => ({ status: 'ready', recipe: { ...recipe, tools: [] } }) } })
    await runner.open('5')
    await runner.send('5', 'Hi')
    expect(deps.stories.findStorySections).not.toHaveBeenCalled()
  })

  it('answers a safety trigger with the fixed reply and never calls the model', async () => {
    const { runner, deps, history } = setup()
    await runner.open('5')
    const result = await runner.send('5', "I don't know where I am")
    expect(result).toMatchObject({ status: 'replied', reply: { escalation: 'confusion', sources: [] } })
    expect(deps.qwen.chat).not.toHaveBeenCalled()
    expect(history.list(1, '5')).toHaveLength(2)
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
    await expect(runner.send('5', 'Hi')).resolves.toEqual({ status: 'connect-needed' })
  })

  it('marks the question as in progress so indexing waits', async () => {
    const end = vi.fn()
    const { runner } = setup({ interactiveGate: { begin: vi.fn(() => end) } })
    await runner.open('5')
    await runner.send('5', 'Hi')
    expect(end).toHaveBeenCalledTimes(1)
  })
})
