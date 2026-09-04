import { describe, expect, it } from 'vitest'
import { blobToFloat32, float32ToBlob } from './vectorCodec'

describe('Vault Float32 vector codec', () => {
  it('round-trips Float32 values exactly', () => {
    const input = new Float32Array([0.25, -1.5, 0, 3.125])
    const blob = float32ToBlob(input)
    const output = blobToFloat32(blob)

    expect([...output]).toEqual([...input])
    expect(blob.byteLength).toBe(input.byteLength)
  })

  it('copies only the exact typed-array byte range', () => {
    const pooled = Buffer.alloc(64, 0x7f)
    const view = new Float32Array(pooled.buffer, pooled.byteOffset + 8, 2)
    view[0] = 1.25
    view[1] = -2.5

    const blob = float32ToBlob(view)

    expect(blob.byteLength).toBe(8)
    expect([...blobToFloat32(blob)]).toEqual([1.25, -2.5])
    expect(blob.equals(pooled.subarray(8, 16))).toBe(true)
  })

  it('rejects blobs whose length is not Float32-aligned', () => {
    expect(() => blobToFloat32(Buffer.from([1, 2, 3]))).toThrow('Invalid Float32 embedding blob')
  })
})
