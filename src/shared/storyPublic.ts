import type { StoryFieldKey, StoryIndexStatus, StoryLanguage, StorySection } from './story'

export interface StoryPublicAnswer {
  fieldKey: StoryFieldKey
  section: StorySection
  label: string
  question: string
  answer: string
  language: StoryLanguage
  confirmed: boolean
  indexStatus: StoryIndexStatus
  updatedAt: number
  confirmedAt: number | null
}

export interface StoryPublicState {
  schemaVersion: 1
  answers: StoryPublicAnswer[]
  confirmedCount: number
}

export interface StoryVersionSummary {
  versionId: number
  createdAt: number
  confirmedCount: number
}
