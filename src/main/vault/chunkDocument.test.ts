import { describe, expect, it } from 'vitest'
import { chunkDocument, MAX_CHARS, OVERLAP_CHARS } from './chunkDocument'

describe('deterministic Vault document chunking', () => {
  it('uses the version-1 1000/150 character contract', () => {
    expect(MAX_CHARS).toBe(1000)
    expect(OVERLAP_CHARS).toBe(150)
  })

  it('returns one numbered chunk for short text', () => {
    expect(chunkDocument('  A short family memory.  ')).toEqual([
      { chunkIndex: 0, text: 'A short family memory.' },
    ])
  })

  it('produces deterministic numbered non-empty chunks with overlap', () => {
    const text = Array.from({ length: 2300 }, (_, index) => String(index % 10)).join('')

    const first = chunkDocument(text)
    const second = chunkDocument(text)

    expect(second).toEqual(first)
    expect(first.map((chunk) => chunk.chunkIndex)).toEqual(first.map((_, index) => index))
    expect(first.every((chunk) => chunk.text.length > 0 && chunk.text.length <= MAX_CHARS)).toBe(true)
    expect(first[0]?.text.slice(-OVERLAP_CHARS)).toBe(first[1]?.text.slice(0, OVERLAP_CHARS))
  })

  it('drops whitespace-only input instead of creating an empty chunk', () => {
    expect(chunkDocument('   \n\t  ')).toEqual([])
  })
})
