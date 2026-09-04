export function float32ToBlob(values: Float32Array): Buffer {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  return Buffer.from(bytes)
}

export function blobToFloat32(blob: Uint8Array): Float32Array {
  if (blob.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Invalid Float32 embedding blob')
  }
  const buffer = new ArrayBuffer(blob.byteLength)
  new Uint8Array(buffer).set(blob)
  return new Float32Array(buffer)
}
