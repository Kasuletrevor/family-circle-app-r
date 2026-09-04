export const MAX_CHARS = 1000
export const OVERLAP_CHARS = 150

export interface VaultTextChunk {
  chunkIndex: number
  text: string
}

export function chunkDocument(text: string): VaultTextChunk[] {
  const source = text.trim()
  if (!source) return []

  const chunks: VaultTextChunk[] = []
  let start = 0

  while (start < source.length) {
    const end = Math.min(source.length, start + MAX_CHARS)
    const chunkText = source.slice(start, end).trim()
    if (chunkText) chunks.push({ chunkIndex: chunks.length, text: chunkText })
    if (end >= source.length) break
    start = end - OVERLAP_CHARS
  }

  return chunks
}
