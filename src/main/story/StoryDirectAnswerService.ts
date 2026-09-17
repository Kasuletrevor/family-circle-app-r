import type { StoryFieldKey } from '../../shared/story'

export interface StoryDirectAnswerSource {
  sourceType: 'story'
  chapter: string
  label: string
  fileName: string
  excerpt: string
}

export interface PrivateDirectAnswer {
  answer: string
  source: StoryDirectAnswerSource
}

export interface StoryDirectAnswerRecord {
  fieldKey: StoryFieldKey
  section: string
  label: string
  answer: string
  confirmed: boolean
}

interface StoryDirectAnswerDependencies {
  getAnswer(localUserId: number, fieldKey: StoryFieldKey): Promise<StoryDirectAnswerRecord | null>
}

const INTENTS: ReadonlyArray<{ fieldKey: StoryFieldKey; patterns: RegExp[] }> = [
  {
    fieldKey: 'fullName',
    patterns: [
      /^what is my full name$/,
      /^what is my name$/,
      /^tell me my full name$/,
      /^tell me my name$/,
    ],
  },
  {
    fieldKey: 'preferredName',
    patterns: [
      /^what do people call me$/,
      /^what do the people closest to me call me$/,
      /^what is my preferred name$/,
    ],
  },
  {
    fieldKey: 'roots',
    patterns: [
      /^where was i born$/,
      /^where are my roots$/,
      /^what is my birthplace$/,
      /^what is my place of birth$/,
    ],
  },
  {
    fieldKey: 'languages',
    patterns: [
      /^what languages do i speak$/,
      /^which languages do i speak$/,
      /^what languages do i understand$/,
    ],
  },
  {
    fieldKey: 'occupation',
    patterns: [
      /^what do i do for work$/,
      /^what is my occupation$/,
      /^what is my job$/,
      /^what do i do$/,
    ],
  },
  {
    fieldKey: 'education',
    patterns: [
      /^what is my education$/,
      /^what is my education level$/,
      /^where did i study$/,
      /^where did i go to school$/,
      /^where did i go to university$/,
    ],
  },
]

function normalizeQuestion(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function intentFor(question: string): StoryFieldKey | null {
  const normalized = normalizeQuestion(question)
  for (const intent of INTENTS) {
    if (intent.patterns.some((pattern) => pattern.test(normalized))) return intent.fieldKey
  }
  return null
}

export class StoryDirectAnswerService {
  constructor(private readonly dependencies: StoryDirectAnswerDependencies) {}

  async answer(localUserId: number, question: string): Promise<PrivateDirectAnswer | null> {
    const fieldKey = intentFor(question)
    if (!fieldKey) return null

    const record = await this.dependencies.getAnswer(localUserId, fieldKey)
    if (!record?.confirmed || !record.answer.trim()) return null

    return {
      answer: record.answer.trim(),
      source: {
        sourceType: 'story',
        chapter: record.section,
        label: record.label,
        fileName: `My Story › ${record.section} › ${record.label}`,
        excerpt: record.answer.trim(),
      },
    }
  }
}
