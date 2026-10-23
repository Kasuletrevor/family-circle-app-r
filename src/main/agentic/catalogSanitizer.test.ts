import { describe, expect, it } from 'vitest'
import { humanizeRule, sanitizeCatalog } from './catalogSanitizer'

const curated = {
  id: 7,
  name: 'Elder Companion',
  slug: 'elder-companion',
  description: 'Warm, patient conversational presence',
  avatar_src: '/avatars/1999625.png',
  category: 'elder_companion',
  is_curated: true,
  model: 'gpt-4o-mini',
  tools: ['get_elder_profile', 'send_email'],
  created_by: 'someone@example.test',
  trust_boundaries: ['no_medical_advice', 'no_financial_decisions'],
  escalation_triggers: ['self_harm_mentions'],
}

describe('sanitizeCatalog', () => {
  it('keeps curated templates in the public shape only', () => {
    const [entry] = sanitizeCatalog([curated])
    expect(entry).toEqual({
      template: {
        id: '7',
        name: 'Elder Companion',
        description: 'Warm, patient conversational presence',
        category: 'elder_companion',
        trustBoundaries: ['No medical advice', 'No financial decisions'],
        escalationTriggers: ['Self harm mentions'],
        slug: 'elder-companion',
      },
      avatarPath: '/avatars/1999625.png',
    })
    expect(JSON.stringify(entry)).not.toMatch(/example\.test|gpt-4o|send_email/)
  })

  it('drops non-curated, invalid and duplicate entries without failing', () => {
    const result = sanitizeCatalog([
      { ...curated, id: 1, is_curated: false },
      { ...curated, id: 'abc' },
      { ...curated, id: 2, name: '   ' },
      null,
      { ...curated, id: 3 },
      { ...curated, id: 3, name: 'Duplicate' },
    ])
    expect(result.map((entry) => entry.template.id)).toEqual(['3'])
  })

  it('returns nothing for a response that is not a list', () => {
    expect(sanitizeCatalog({ agents: [curated] })).toEqual([])
  })

  it('maps unknown categories to other and caps text', () => {
    const [entry] = sanitizeCatalog([{
      ...curated,
      category: 'something_new',
      name: 'N'.repeat(300),
      description: 'D'.repeat(900),
      trust_boundaries: Array.from({ length: 20 }, (_, index) => `rule_${index}`),
      escalation_triggers: 'not a list',
    }])
    expect(entry!.template.category).toBe('other')
    expect(entry!.template.name).toHaveLength(120)
    expect(entry!.template.description).toHaveLength(600)
    expect(entry!.template.trustBoundaries).toHaveLength(12)
    expect(entry!.template.escalationTriggers).toEqual([])
  })

  it('accepts only simple avatar paths on the template site', () => {
    const avatar = (avatar_src: unknown) => sanitizeCatalog([{ ...curated, avatar_src }])[0]!.avatarPath
    expect(avatar('/avatars/a-1_b.jpg')).toBe('/avatars/a-1_b.jpg')
    expect(avatar('https://evil.test/a.png')).toBeNull()
    expect(avatar('/avatars/../secret.png')).toBeNull()
    expect(avatar('/avatars/a.svg')).toBeNull()
    expect(avatar(null)).toBeNull()
  })

  it('strips control and direction characters', () => {
    const [entry] = sanitizeCatalog([{ ...curated, name: `Elder${String.fromCharCode(0)} Companion${String.fromCharCode(0x202e)}` }])
    expect(entry!.template.name).toBe('Elder Companion')
  })
})

describe('humanizeRule', () => {
  it('turns rule keys into plain sentences', () => {
    expect(humanizeRule('no_memory_correction_unless_safety')).toBe('No memory correction unless safety')
    expect(humanizeRule('  Already a sentence. ')).toBe('Already a sentence.')
    expect(humanizeRule('___')).toBe('')
  })
})

describe('template slug', () => {
  it('keeps a safe template slug', () => {
    const [kept] = sanitizeCatalog([{ id: 7, name: 'Elder Companion', is_curated: true, slug: 'elder-companion' }])
    expect(kept!.template.slug).toBe('elder-companion')
    const [bad] = sanitizeCatalog([{ id: 8, name: 'X', is_curated: true, slug: '../Admin' }])
    expect(bad!.template.slug).toBeUndefined()
  })
})
