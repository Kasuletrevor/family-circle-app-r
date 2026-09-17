import { describe, expect, it, vi } from 'vitest'
import { PrivateArchiveQueryServiceError } from '../ai/PrivateArchiveQueryService'
import { VaultQueryService, VaultQueryServiceError } from './VaultQueryService'

function archiveAnswer() {
  return {
    answer: 'Grounded answer',
    route: 'fast' as const,
    sources: [
      {
        sourceType: 'document' as const,
        documentId: 9,
        fileName: 'Letters.txt',
        excerpt: 'A safe excerpt',
      },
    ],
  }
}

describe('VaultQueryService archive compatibility facade', () => {
  it('delegates to the shared private archive engine with a Vault-only scope', async () => {
    const ask = vi.fn(async () => archiveAnswer())
    const service = new VaultQueryService({ ask })

    const result = await service.ask({
      question: 'What do the letters say?',
      scope: { type: 'documents', documentIds: [9] },
    })

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith({
      question: 'What do the letters say?',
      scope: {
        type: 'vault',
        vault: { type: 'documents', documentIds: [9] },
      },
    })
    expect(result).toEqual({
      answer: 'Grounded answer',
      sources: [{ documentId: 9, fileName: 'Letters.txt', excerpt: 'A safe excerpt' }],
    })
  })

  it('does not expose archive route metadata or Story sources through the legacy Vault contract', async () => {
    const service = new VaultQueryService({
      ask: vi.fn(async () => ({
        answer: 'Answer',
        route: 'complex' as const,
        sources: [
          { sourceType: 'story' as const, chapter: 'Identity', label: 'Full name', fileName: 'My Story › Identity › Full name', excerpt: 'Hidden from Vault facade' },
          { sourceType: 'document' as const, documentId: 3, fileName: 'History.pdf', excerpt: 'Visible' },
        ],
      })),
    })

    const result = await service.ask({ question: 'Question?', scope: { type: 'all' } })

    expect(Object.keys(result).sort()).toEqual(['answer', 'sources'])
    expect(result.sources).toEqual([{ documentId: 3, fileName: 'History.pdf', excerpt: 'Visible' }])
    expect(JSON.stringify(result)).not.toContain('route')
    expect(JSON.stringify(result)).not.toContain('My Story')
  })

  it('maps shared archive errors back to the existing safe Vault error contract', async () => {
    const service = new VaultQueryService({
      ask: vi.fn(async () => {
        throw new PrivateArchiveQueryServiceError('invalid-scope', 'Selected Vault document is unavailable')
      }),
    })

    await expect(service.ask({
      question: 'Question?',
      scope: { type: 'documents', documentIds: [999] },
    })).rejects.toBeInstanceOf(VaultQueryServiceError)
    await expect(service.ask({
      question: 'Question?',
      scope: { type: 'documents', documentIds: [999] },
    })).rejects.toMatchObject({ code: 'invalid-scope' })
  })
})
