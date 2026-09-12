import { createHash } from 'node:crypto'
import {
  STORY_FIELD_KEYS,
  STORY_SCHEMA_VERSION,
  type StoryFieldKey,
  type StoryIndexStatus,
  type StoryLanguage,
} from '../../shared/story'

export interface StoryAnswerInternal {
  id: number
  localUserId: number
  fieldKey: StoryFieldKey
  schemaVersion: number
  section: string
  label: string
  question: string
  answer: string
  language: StoryLanguage
  confirmed: boolean
  indexStatus: StoryIndexStatus
  createdAt: number
  updatedAt: number
  confirmedAt: number | null
}

export interface StoryDraftInput {
  fieldKey: StoryFieldKey
  answer: string
  language: StoryLanguage
}

export interface StorySemanticAnswer {
  answer: string
  language: StoryLanguage
  confirmed: boolean
  confirmedAt: number | null
}

export interface StorySemanticSnapshot {
  schemaVersion: typeof STORY_SCHEMA_VERSION
  answers: Record<StoryFieldKey, StorySemanticAnswer>
}

export interface StoryVersionInternal {
  id: number
  localUserId: number
  snapshot: StorySemanticSnapshot
  semanticSignature: string
  createdAt: number
}

export function storySemanticSnapshot(answers: readonly StoryAnswerInternal[]): StorySemanticSnapshot {
  const byKey = new Map(answers.map((answer) => [answer.fieldKey, answer]))
  const entries = STORY_FIELD_KEYS.map((fieldKey) => {
    const answer = byKey.get(fieldKey)
    return [fieldKey, {
      answer: answer?.answer ?? '',
      language: answer?.language ?? 'en',
      confirmed: answer?.confirmed ?? false,
      confirmedAt: answer?.confirmedAt ?? null,
    }] as const
  })
  return {
    schemaVersion: STORY_SCHEMA_VERSION,
    answers: Object.fromEntries(entries) as Record<StoryFieldKey, StorySemanticAnswer>,
  }
}

export function storySemanticSignature(snapshot: StorySemanticSnapshot): string {
  const semantic = {
    schemaVersion: snapshot.schemaVersion,
    answers: STORY_FIELD_KEYS.map((fieldKey) => {
      const answer = snapshot.answers[fieldKey]
      return [fieldKey, answer.answer, answer.language, answer.confirmed] as const
    }),
  }
  return createHash('sha256').update(JSON.stringify(semantic), 'utf8').digest('hex')
}
