import { describe, expect, it, vi } from 'vitest'
import { planRetrievalQueries, selectGenerationRoute } from './PrivateQueryPlanner'

describe('PrivateQueryPlanner retrieval queries', () => {
  it('uses exactly one retrieval query for English', async () => {
    const translateToEnglish = vi.fn(async () => 'unused')

    await expect(planRetrievalQueries({
      question: 'Where was I born?',
      language: 'en',
      translateToEnglish,
    })).resolves.toEqual(['Where was I born?'])
    expect(translateToEnglish).not.toHaveBeenCalled()
  })

  it('uses original and English retrieval queries for supported non-English questions', async () => {
    const translateToEnglish = vi.fn(async () => 'Where was I born?')

    await expect(planRetrievalQueries({
      question: '¿Dónde nací?',
      language: 'es',
      translateToEnglish,
    })).resolves.toEqual(['¿Dónde nací?', 'Where was I born?'])
  })

  it('falls back to the original question when local translation fails', async () => {
    await expect(planRetrievalQueries({
      question: 'Où suis-je né?',
      language: 'fr',
      translateToEnglish: async () => { throw new Error('runtime unavailable') },
    })).resolves.toEqual(['Où suis-je né?'])
  })

  it('deduplicates a translation that is effectively unchanged', async () => {
    await expect(planRetrievalQueries({
      question: 'Tokyo?',
      language: 'ja',
      translateToEnglish: async () => '  Tokyo?  ',
    })).resolves.toEqual(['Tokyo?'])
  })
})

describe('PrivateQueryPlanner generation routing', () => {
  it('keeps ordinary questions and single-source summaries on the fast route', () => {
    expect(selectGenerationRoute({ question: 'Where was I born?', scopeType: 'story' })).toBe('fast')
    expect(selectGenerationRoute({ question: 'Summarize this document briefly.', scopeType: 'vault' })).toBe('fast')
    expect(selectGenerationRoute({ question: 'What traditions do I want preserved?', scopeType: 'combined' })).toBe('fast')
  })

  it('uses the complex route only for explicit combined synthesis', () => {
    expect(selectGenerationRoute({
      question: 'Compare my story and documents and explain any differences.',
      scopeType: 'combined',
    })).toBe('complex')
    expect(selectGenerationRoute({
      question: 'Compare the memories in my story.',
      scopeType: 'story',
    })).toBe('fast')
  })
})
