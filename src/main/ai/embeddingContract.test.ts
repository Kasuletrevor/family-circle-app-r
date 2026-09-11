import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_PREFIX,
  EMBEDDING_INDEX_VERSION,
  EMBEDDING_MODEL_ID,
  QUERY_PREFIX,
} from './embeddingContract'

describe('shared embedding contract', () => {
  it('pins the common Story and Vault embedding contract', () => {
    expect(EMBEDDING_MODEL_ID).toBe('nomic-embed-text-v1.5.Q4_K_M')
    expect(EMBEDDING_INDEX_VERSION).toBe(1)
    expect(DOCUMENT_PREFIX).toBe('search_document: ')
    expect(QUERY_PREFIX).toBe('search_query: ')
  })
})
