// Keyword ranking (BM25) for private archive search. Meaning-based (vector) search
// finds rewordings but can bury an exact name, number or rare phrase inside a large
// document; keyword ranking finds those. The two rankings are fused with
// reciprocal rank fusion, so a chunk ranked well by either one rises.

const BM25_K1 = 1.2
const BM25_B = 0.75
/** The usual reciprocal-rank-fusion constant; it damps the gap between top ranks. */
export const RRF_K = 60

// Question words that say little about which chunk holds the answer.
const STOP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'before',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'so', 'tell',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'us', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'will', 'with', 'would', 'you', 'your',
])

// Chinese and Japanese are written without spaces, so they are indexed as overlapping character pairs.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
// Japanese text often attaches names and years directly ("Jinjaで", "1941年"), so a
// word is first split into its CJK and non-CJK parts.
const SCRIPT_RUNS = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[^\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/gu
const TOKEN = /[\p{L}\p{N}]+(?:['\u2019][\p{L}]+)?/gu

// Accents are ignored ("Nakató" matches "Nakato"). Normalising a whole text at once is
// far cheaper than normalising each word.
function normalizeText(text: string): string {
  return String(text ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

function normalizeWord(word: string): string {
  return /['\u2019]/u.test(word)
    ? word.replace(/['\u2019]s$/u, '').replace(/['\u2019]/gu, '')
    : word
}

/** Splits text into searchable terms: words, numbers and CJK character pairs. */
export function tokenize(text: string): string[] {
  const terms: string[] = []
  for (const match of normalizeText(text).matchAll(TOKEN)) {
    for (const run of match[0].match(SCRIPT_RUNS) ?? []) {
      if (CJK.test(run)) {
        const characters = [...run]
        if (characters.length === 1) terms.push(characters[0]!)
        for (let index = 0; index + 1 < characters.length; index += 1) terms.push(characters[index]! + characters[index + 1]!)
        continue
      }
      const term = normalizeWord(run)
      if (term) terms.push(term)
    }
  }
  return terms
}

function inverseFrequency(total: number, containing: number): number {
  return Math.log(1 + (total - containing + 0.5) / (containing + 0.5))
}

/** The meaningful words of a text (names, numbers, places), without question words. */
export function contentTerms(text: string): Set<string> {
  return new Set(tokenize(text).filter((term) => !STOP_WORDS.has(term)))
}

function queryTerms(queries: string[]): string[] {
  const terms = new Set<string>()
  for (const query of queries) {
    for (const term of tokenize(query)) {
      if (!STOP_WORDS.has(term)) terms.add(term)
    }
  }
  return [...terms]
}

/**
 * A BM25 keyword index over a fixed list of texts. Building it reads every text once
 * (about half a second for 6,000 sections); each question then only looks up its own
 * words, so the index is built once and reused while the texts stay the same.
 */
export class KeywordIndex {
  private readonly postings = new Map<string, { documents: number[]; frequencies: number[] }>()
  private readonly lengths: Float64Array
  private readonly averageLength: number

  constructor(documents: string[]) {
    this.lengths = new Float64Array(documents.length)
    documents.forEach((document, index) => {
      const tokens = tokenize(document)
      this.lengths[index] = tokens.length
      const counts = new Map<string, number>()
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
      for (const [term, frequency] of counts) {
        let posting = this.postings.get(term)
        if (!posting) {
          posting = { documents: [], frequencies: [] }
          this.postings.set(term, posting)
        }
        posting.documents.push(index)
        posting.frequencies.push(frequency)
      }
    })
    const total = this.lengths.reduce((sum, length) => sum + length, 0)
    this.averageLength = documents.length > 0 ? total / documents.length || 1 : 1
  }

  get size(): number {
    return this.lengths.length
  }

  /**
   * How rare a word is across these texts (BM25 inverse document frequency): high for
   * a name in one section, low for common words, in any language. A word in none of
   * the texts, or in more than half of them, weighs 0: it cannot tell sections apart,
   * however few there are.
   */
  rarity(term: string): number {
    const containing = this.postings.get(term)?.documents.length ?? 0
    if (containing === 0 || containing > this.size / 2) return 0
    return inverseFrequency(this.size, containing)
  }

  /** The rarity of a word found in exactly one text, the most a single word can weigh. */
  get maxRarity(): number {
    return inverseFrequency(this.size, 1)
  }

  /**
   * One BM25 score per text (0 when no query word appears). Several queries (the
   * question and its English translation) share one bag of words.
   */
  score(queries: string[]): number[] {
    const count = this.size
    const scores = new Array<number>(count).fill(0)
    for (const term of queryTerms(queries)) {
      const posting = this.postings.get(term)
      if (!posting) continue
      const idf = inverseFrequency(count, posting.documents.length)
      posting.documents.forEach((document, position) => {
        const frequency = posting.frequencies[position]!
        const lengthNorm = 1 - BM25_B + BM25_B * (this.lengths[document]! / this.averageLength)
        scores[document] += idf * (frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * lengthNorm)
      })
    }
    return scores
  }

  /** Text indexes that contain at least one query word, best match first. */
  rank(queries: string[]): number[] {
    const scores = this.score(queries)
    return [...scores.keys()]
      .filter((index) => scores[index]! > 0)
      .sort((a, b) => scores[b]! - scores[a]! || a - b)
  }
}

/** Ranks texts against the queries with BM25 without keeping an index. */
export function keywordScores(queries: string[], documents: string[]): number[] {
  return new KeywordIndex(documents).score(queries)
}

/**
 * Reciprocal rank fusion. Each ranking lists item indexes best first; items missing
 * from a ranking get nothing from it. Returns item indexes best first.
 */
export function fuseRankings(rankings: number[][], itemCount: number): number[] {
  const fused = new Array<number>(itemCount).fill(0)
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => { fused[item] += 1 / (RRF_K + rank + 1) })
  }
  // Ties keep the order of the first ranking (meaning-based search).
  const firstRank = new Map((rankings[0] ?? []).map((item, rank) => [item, rank]))
  return [...fused.keys()]
    .filter((item) => fused[item]! > 0)
    .sort((a, b) => (fused[b]! - fused[a]!) || ((firstRank.get(a) ?? itemCount) - (firstRank.get(b) ?? itemCount)))
}
