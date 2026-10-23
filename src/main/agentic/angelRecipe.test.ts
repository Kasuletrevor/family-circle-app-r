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

  it('keeps line breaks in the instructions', () => {
    expect(sanitizeRecipe('5', pkg({ config: { instructions: 'One.\nTwo.', tools: [] } }))!.instructions).toBe('One.\nTwo.')
  })

  it('cuts long instructions and refuses a package without a name', () => {
    const long = sanitizeRecipe('5', pkg({ config: { instructions: 'a'.repeat(9000), tools: [] } }))!
    expect(long.instructions).toHaveLength(4000)
    expect(sanitizeRecipe('5', pkg({ agent: {} }))).toBeNull()
    expect(sanitizeRecipe('5', null)).toBeNull()
  })

  it('rejects cached recipes in the wrong shape', () => {
    expect(isAngelRecipe({ angelId: '5', name: 'A', instructions: 'x', tools: [1], trustBoundaries: [], escalationKeys: [] })).toBe(false)
    expect(isAngelRecipe(null)).toBe(false)
  })
})
