export type PrivateScopeType = 'vault' | 'story' | 'combined'
export type PrivateGenerationRoute = 'fast' | 'complex'

const SUPPORTED_TRANSLATION_LANGUAGES = new Set(['fr', 'es', 'pt', 'zh', 'ja', 'fil'])
const COMPLEX_SYNTHESIS_PATTERNS = [
  /\bcompare\b/i,
  /\bcontrast\b/i,
  /\bdifferences?\b/i,
  /\breconcile\b/i,
  /\bconflict(?:ing|s)?\b/i,
  /\bsynthesi[sz]e\b/i,
  /\bacross\s+(?:my\s+)?story\s+and\s+documents?\b/i,
]

function normalizeLanguage(value: string | undefined, question: string): string {
  const explicit = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0]
  if (explicit) return explicit
  if (/[\u3040-\u30ff]/u.test(question)) return 'ja'
  if (/[\u3400-\u9fff]/u.test(question)) return 'zh'
  if (/[¿¡]|\b(?:qué|cuál|dónde|quién|cuándo|nací|tengo)\b/iu.test(question)) return 'es'
  if (/\b(?:quel|quelle|où|suis-je|ai-je|née|né)\b/iu.test(question)) return 'fr'
  if (/\b(?:qual|quais|onde|nasci|tenho|minha|meu)\b/iu.test(question)) return 'pt'
  if (/\b(?:ano|alin|saan|sino|kailan|bakit|paano|aking)\b/iu.test(question)) return 'fil'
  return 'en'
}

export async function planRetrievalQueries(input: {
  question: string
  language?: string
  translateToEnglish?: (question: string) => Promise<string>
}): Promise<string[]> {
  const question = String(input.question ?? '').trim()
  if (!question) return []

  const language = normalizeLanguage(input.language, question)
  if (language === 'en' || !SUPPORTED_TRANSLATION_LANGUAGES.has(language) || !input.translateToEnglish) {
    return [question]
  }

  try {
    const translation = String(await input.translateToEnglish(question)).trim()
    if (!translation || translation.length > 1_000 || translation.toLocaleLowerCase() === question.toLocaleLowerCase()) {
      return [question]
    }
    return [question, translation]
  } catch {
    return [question]
  }
}

export function selectGenerationRoute(input: {
  question: string
  translatedQuestion?: string
  scopeType: PrivateScopeType
}): PrivateGenerationRoute {
  if (input.scopeType !== 'combined') return 'fast'

  const questions = [input.question, input.translatedQuestion]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)

  return questions.some((question) => (
    COMPLEX_SYNTHESIS_PATTERNS.some((pattern) => pattern.test(question))
  )) ? 'complex' : 'fast'
}
