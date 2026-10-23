import { describe, expect, it } from 'vitest'
import type { GuardianAngelTemplate } from '../../shared/agentic'
import { sanitizeAngel, sanitizeAngels } from './angelSanitizer'

const template: GuardianAngelTemplate = {
  id: '7', name: 'Elder Companion', description: '', category: 'elder_companion',
  trustBoundaries: [], escalationTriggers: [], avatar: 'data:image/png;base64,AAAA',
}
const templates = new Map([['7', template]])
const agent = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Angel ${id}`, description: 'Helps', model: 'llama3.2', original_agent_id: null, run_count: 0,
  last_run_at: null, trust_boundaries: ['no_medical_advice'], escalation_triggers: [], created_by: 'owner@example.test',
  instructions: 'private instructions', ...extra,
})

describe('sanitizeAngel', () => {
  it('keeps the safe shape and takes the avatar and name from the template', () => {
    expect(sanitizeAngel(agent(5, { original_agent_id: 7, run_count: 3, last_run_at: '2026-10-01T10:00:00' }), templates)).toEqual({
      id: '5', name: 'Angel 5', description: 'Helps', templateId: '7', templateName: 'Elder Companion',
      avatar: 'data:image/png;base64,AAAA', runCount: 3, lastRunAt: '2026-10-01T10:00:00.000Z',
      trustBoundaries: ['No medical advice'], escalationTriggers: [], runsHere: false,
    })
  })

  it('leaves out the marketplace model and provider', () => {
    const angel = sanitizeAngel(agent(1, { model: 'gpt-4o-mini', execution_backend: 'openai' }), templates)
    expect(JSON.stringify(angel)).not.toMatch(/gpt-4o-mini|openai|model|execution_backend/)
  })

  it('reads times as UTC and drops bad values', () => {
    const at = (value: unknown) => sanitizeAngel(agent(1, { last_run_at: value }), templates)?.lastRunAt
    expect(at('2026-10-01T12:00:00+02:00')).toBe('2026-10-01T10:00:00.000Z')
    expect(at('nope')).toBeNull()
    expect(sanitizeAngel(agent(1, { run_count: -4 }), templates)?.runCount).toBe(0)
  })

  it('rejects entries without a usable id or name', () => {
    expect(sanitizeAngel(agent(1, { id: '../1' }), templates)).toBeNull()
    expect(sanitizeAngel(agent(1, { name: '  ' }), templates)).toBeNull()
    expect(sanitizeAngel('angel', templates)).toBeNull()
  })
})

describe('sanitizeAngels', () => {
  it('caps the list, drops duplicates and never keeps private fields', () => {
    const list = sanitizeAngels([agent(1), agent(1), ...Array.from({ length: 150 }, (_, index) => agent(index + 2))], templates)
    expect(list).toHaveLength(100)
    expect(list?.filter((angel) => angel.id === '1')).toHaveLength(1)
    expect(JSON.stringify(list)).not.toMatch(/owner@example\.test|private instructions/)
  })

  it('returns null for a response that is not a list', () => {
    expect(sanitizeAngels({ agents: [] }, templates)).toBeNull()
  })
})

describe('runsHere', () => {
  it('marks angels from a runnable template as running here', () => {
    const runnable = new Map<string, GuardianAngelTemplate>([
      ['7', { ...template, slug: 'elder-companion' }],
      ['51', { ...template, id: '51', name: 'Memory Screening', slug: 'memory-screening-guide-template' }],
    ])
    expect(sanitizeAngel(agent(5, { original_agent_id: 7 }), runnable)!.runsHere).toBe(true)
    expect(sanitizeAngel(agent(6, { original_agent_id: 51 }), runnable)!.runsHere).toBe(false)
    expect(sanitizeAngel(agent(7), runnable)!.runsHere).toBe(false)
    expect(sanitizeAngel(agent(8, { original_agent_id: 7 }), templates)!.runsHere).toBe(false)
  })
})
