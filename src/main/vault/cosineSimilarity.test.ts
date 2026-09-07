import { describe, expect, it } from 'vitest'
import { cosineSimilarity } from './cosineSimilarity'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors and 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBeCloseTo(1, 6)
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6)
  })

  it('rejects empty, mismatched, and zero-magnitude vectors', () => {
    expect(() => cosineSimilarity(new Float32Array(), new Float32Array())).toThrow()
    expect(() => cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2]))).toThrow()
    expect(() => cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 0]))).toThrow()
  })
})
