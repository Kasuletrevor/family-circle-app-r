import { describe, expect, it } from 'vitest'
import {
  STORY_FIELDS,
  STORY_FIELD_KEYS,
  STORY_LANGUAGES,
  STORY_SCHEMA_VERSION,
  normalizeStoryLanguage,
  requireStoryField,
} from './story'

describe('My Story fixed contract', () => {
  it('pins schema version, field order, chapters, and life-stage options', () => {
    expect(STORY_SCHEMA_VERSION).toBe(1)
    expect(STORY_FIELDS).toHaveLength(16)
    expect(STORY_FIELD_KEYS).toEqual([
      'fullName',
      'preferredName',
      'roots',
      'languages',
      'occupation',
      'lifeStage',
      'snapshot',
      'childhood',
      'education',
      'workLife',
      'relationships',
      'milestones',
      'traditions',
      'values',
      'carePreferences',
      'futureMessage',
    ])

    expect([...new Set(STORY_FIELDS.map((field) => field.section))]).toEqual([
      'Identity',
      'Everyday Life',
      'Life Story',
      'People & Places',
      'Values & Wishes',
      'Care & Future',
    ])

    expect(requireStoryField('lifeStage')).toMatchObject({
      key: 'lifeStage',
      input: 'select',
      options: [
        'Building my archive',
        'Preserving elder memories',
        'Preparing family handover',
        'Documenting health and care',
      ],
    })
  })

  it('pins the exact reference language set and Whisper mapping', () => {
    expect(STORY_LANGUAGES.map((item) => item.code)).toEqual([
      'en', 'fr', 'es', 'pt', 'zh', 'ja', 'fil',
    ])
    expect(STORY_LANGUAGES).toEqual([
      { code: 'en', label: 'English', speechLocale: 'en-US', whisperCode: 'en' },
      { code: 'fr', label: 'French', speechLocale: 'fr-FR', whisperCode: 'fr' },
      { code: 'es', label: 'Spanish', speechLocale: 'es-ES', whisperCode: 'es' },
      { code: 'pt', label: 'Portuguese', speechLocale: 'pt-BR', whisperCode: 'pt' },
      { code: 'zh', label: 'Simplified Chinese', speechLocale: 'zh-CN', whisperCode: 'zh' },
      { code: 'ja', label: 'Japanese', speechLocale: 'ja-JP', whisperCode: 'ja' },
      { code: 'fil', label: 'Filipino (Tagalog)', speechLocale: 'fil-PH', whisperCode: 'tl' },
    ])

    expect(normalizeStoryLanguage('fil-PH')).toEqual({
      code: 'fil',
      label: 'Filipino (Tagalog)',
      speechLocale: 'fil-PH',
      whisperCode: 'tl',
    })
    expect(normalizeStoryLanguage('PT_br')).toMatchObject({ code: 'pt', whisperCode: 'pt' })
    expect(() => normalizeStoryLanguage('lg')).toThrow('Unsupported Story language')
  })

  it('derives immutable field metadata from the fixed schema', () => {
    expect(requireStoryField('childhood')).toMatchObject({
      key: 'childhood',
      section: 'Life Story',
      label: 'Childhood and early memories',
      prompt: 'What childhood memory or place still feels alive to you?',
      input: 'textarea',
    })
    expect(() => requireStoryField('unknown')).toThrow('Unknown Story field')
  })
})
