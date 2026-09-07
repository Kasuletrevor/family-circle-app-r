export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    throw new Error('Invalid cosine vectors')
  }

  let dot = 0
  let magnitudeA = 0
  let magnitudeB = 0
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index]!
    const bv = b[index]!
    dot += av * bv
    magnitudeA += av * av
    magnitudeB += bv * bv
  }

  if (magnitudeA === 0 || magnitudeB === 0) throw new Error('Invalid cosine vectors')
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB))
}
