import { describe, expect, it } from 'vitest'
import type { AngelChatMessage } from '../../shared/agenticChat'
import type { AngelRecipe } from './angelRecipe'
import { ANGEL_PROMPT_TOKENS, buildAngelPrompt, estimateTokens } from './angelPrompt'

const recipe = (tools: string[]): AngelRecipe => ({
  angelId: '5', name: 'Morning Check-in', instructions: 'Be warm and patient.', tools,
  trustBoundaries: ['No medical advice'], escalationKeys: [],
})
const turn = (id: number, role: 'person' | 'angel', text: string): AngelChatMessage => ({
  id, role, text, sources: [], escalation: null, createdAt: '2026-10-23T10:00:00.000Z',
})

describe('buildAngelPrompt', () => {
  it("puts Family Circle's rules before the angel's instructions", () => {
    const [system] = buildAngelPrompt({ recipe: recipe([]), firstName: null, stories: [], history: [], message: 'Hi' })
    expect(system!.role).toBe('system')
    expect(system!.content.indexOf('never invent family details')).toBeLessThan(system!.content.indexOf('Be warm and patient.'))
    expect(system!.content).toContain('No medical advice')
    expect(system!.content).not.toContain('You may write drafts')
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
    expect(withTools[0]!.content).toContain('You are talking with Pat.')
    expect(withTools.map((item) => item.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(withTools.at(-1)!.content).toContain('We lived by the lake.')
    expect(withTools.at(-1)!.content).toContain('Tell me a memory')
  })

  it('allows drafts when the angel has a messaging tool', () => {
    const [system] = buildAngelPrompt({ recipe: recipe(['draft_email']), firstName: null, stories: [], history: [], message: 'Hi' })
    expect(system!.content).toContain('You may write drafts')
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

describe('buildAngelPrompt for the small local model', () => {
  const withSections = {
    ...recipe(['get_elder_profile']),
    instructions: [
      'You are a warm companion.',
      '## Tone',
      '- Be patient',
      '## Tool Usage',
      '- Use at most one read tool',
      '## Sending Email (Safety)',
      '- Use draft_email first',
      '## Escalation Triggers (Alert caregivers immediately)',
      '- Any mention of self-harm',
    ].join('\n'),
  }

  it('drops the instruction sections Family Circle handles itself', () => {
    const [system] = buildAngelPrompt({ recipe: withSections, firstName: 'Pat', stories: [], history: [], message: 'Hi' })
    expect(system!.content).toContain('You are a warm companion.')
    expect(system!.content).toContain('- Be patient')
    expect(system!.content).not.toMatch(/read tool|draft_email|Alert caregivers/)
  })

  it('asks for an answer first, grounded in the memories, and a written message when asked', () => {
    const [system] = buildAngelPrompt({ recipe: withSections, firstName: 'Pat', stories: [], history: [], message: 'Hi' })
    expect(system!.content).toContain('talking with Pat')
    expect(system!.content).toContain('Answer what the person said or asked first.')
    expect(system!.content).toContain('use their details in your answer')
    expect(system!.content).toContain('write the short message itself')
  })
})

describe('buildAngelPrompt token budget', () => {
  const tools = ['get_family_content', 'get_recent_interactions']
  const han = (count: number) => '我'.repeat(count)

  it('estimates CJK text as a token per character and other text more cheaply', () => {
    expect(estimateTokens(han(300))).toBe(300)
    expect(estimateTokens('a'.repeat(300))).toBe(100)
  })

  it('keeps a long Chinese conversation inside the context window, dropping the oldest history first', () => {
    const prompt = buildAngelPrompt({
      recipe: { ...recipe(tools), instructions: han(4000) },
      firstName: null,
      stories: [1, 2, 3].map((index) => ({ label: `S${index}`, text: han(900) })),
      history: Array.from({ length: 6 }, (_, index) => turn(index, index % 2 ? 'angel' : 'person', `${index}${han(300)}`)),
      message: han(1000),
    })
    const total = prompt.reduce((sum, item) => sum + estimateTokens(item.content) + 8, 0)
    expect(total).toBeLessThanOrEqual(ANGEL_PROMPT_TOKENS)
    expect(prompt.at(-1)!.content).toContain(han(1000))
    const kept = prompt.slice(1, -1).map((item) => item.content[0])
    expect(kept).not.toContain('0')
  })

  it('leaves an English conversation untouched', () => {
    const input = {
      recipe: recipe(tools), firstName: null,
      stories: [{ label: 'S1', text: 'We lived by the lake.' }],
      history: [turn(1, 'person', 'Hello'), turn(2, 'angel', 'Hi there')],
      message: 'Tell me a memory',
    }
    const prompt = buildAngelPrompt(input)
    expect(prompt.map((item) => item.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(prompt.at(-1)!.content).toContain('We lived by the lake.')
  })
})
