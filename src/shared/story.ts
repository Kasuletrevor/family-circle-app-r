export const STORY_SCHEMA_VERSION = 1 as const

export type StoryIndexStatus = 'not_indexed' | 'pending' | 'ready' | 'failed'
export type StoryFieldInput = 'text' | 'textarea' | 'select'
export type StorySection =
  | 'Identity'
  | 'Everyday Life'
  | 'Life Story'
  | 'People & Places'
  | 'Values & Wishes'
  | 'Care & Future'

export const STORY_FIELDS = [
  {
    key: 'fullName',
    section: 'Identity',
    label: 'Full name',
    prompt: 'What is your full name, and is there a story behind it?',
    input: 'text',
  },
  {
    key: 'preferredName',
    section: 'Identity',
    label: 'Preferred name',
    prompt: 'What do the people closest to you call you?',
    input: 'text',
  },
  {
    key: 'roots',
    section: 'Identity',
    label: 'Birthplace and roots',
    prompt: 'Where are your roots?',
    input: 'text',
  },
  {
    key: 'languages',
    section: 'Identity',
    label: 'Languages',
    prompt: 'Which languages do you speak or understand?',
    input: 'text',
  },
  {
    key: 'occupation',
    section: 'Everyday Life',
    label: 'What I do',
    prompt: 'Tell me about what you do and what a normal day looks like for you.',
    input: 'textarea',
  },
  {
    key: 'lifeStage',
    section: 'Everyday Life',
    label: 'Life stage',
    prompt: 'Which stage best describes why you are capturing your story now?',
    input: 'select',
    options: [
      'Building my archive',
      'Preserving elder memories',
      'Preparing family handover',
      'Documenting health and care',
    ],
  },
  {
    key: 'snapshot',
    section: 'Life Story',
    label: 'My story in a few words',
    prompt: 'If you introduced your life to a future family member, what would you want them to know first?',
    input: 'textarea',
  },
  {
    key: 'childhood',
    section: 'Life Story',
    label: 'Childhood and early memories',
    prompt: 'What childhood memory or place still feels alive to you?',
    input: 'textarea',
  },
  {
    key: 'education',
    section: 'Life Story',
    label: 'Learning and education',
    prompt: 'Where and how did you learn the lessons that mattered most?',
    input: 'textarea',
  },
  {
    key: 'workLife',
    section: 'Life Story',
    label: 'Work and contribution',
    prompt: 'What work, service, or contribution are you proud of?',
    input: 'textarea',
  },
  {
    key: 'relationships',
    section: 'People & Places',
    label: 'Important people',
    prompt: 'Who are the people who shaped your life, and how?',
    input: 'textarea',
  },
  {
    key: 'milestones',
    section: 'People & Places',
    label: 'Milestones and turning points',
    prompt: 'Which moments changed the direction of your life?',
    input: 'textarea',
  },
  {
    key: 'traditions',
    section: 'Values & Wishes',
    label: 'Traditions to preserve',
    prompt: 'What family tradition, recipe, belief, or practice should never be lost?',
    input: 'textarea',
  },
  {
    key: 'values',
    section: 'Values & Wishes',
    label: 'Values and lessons',
    prompt: 'What values or lessons have guided the way you live?',
    input: 'textarea',
  },
  {
    key: 'carePreferences',
    section: 'Care & Future',
    label: 'Care and daily preferences',
    prompt: 'What would help someone support and care for you well?',
    input: 'textarea',
  },
  {
    key: 'futureMessage',
    section: 'Care & Future',
    label: 'Message for the future',
    prompt: 'What message would you like future generations to hear in your own words?',
    input: 'textarea',
  },
] as const satisfies readonly Array<{
  key: string
  section: StorySection
  label: string
  prompt: string
  input: StoryFieldInput
  options?: readonly string[]
}>

export type StoryFieldKey = typeof STORY_FIELDS[number]['key']
export type StoryFieldDefinition = typeof STORY_FIELDS[number]

export const STORY_FIELD_KEYS: readonly StoryFieldKey[] = Object.freeze(
  STORY_FIELDS.map((field) => field.key),
)

export const STORY_LANGUAGES = [
  { code: 'en', label: 'English', speechLocale: 'en-US', whisperCode: 'en' },
  { code: 'fr', label: 'French', speechLocale: 'fr-FR', whisperCode: 'fr' },
  { code: 'es', label: 'Spanish', speechLocale: 'es-ES', whisperCode: 'es' },
  { code: 'pt', label: 'Portuguese', speechLocale: 'pt-BR', whisperCode: 'pt' },
  { code: 'zh', label: 'Simplified Chinese', speechLocale: 'zh-CN', whisperCode: 'zh' },
  { code: 'ja', label: 'Japanese', speechLocale: 'ja-JP', whisperCode: 'ja' },
  { code: 'fil', label: 'Filipino (Tagalog)', speechLocale: 'fil-PH', whisperCode: 'tl' },
] as const

export type StoryLanguage = typeof STORY_LANGUAGES[number]['code']
export type StoryLanguageDefinition = typeof STORY_LANGUAGES[number]

export function requireStoryField(value: unknown): StoryFieldDefinition {
  const key = typeof value === 'string' ? value : ''
  const field = STORY_FIELDS.find((item) => item.key === key)
  if (!field) throw new Error('Unknown Story field')
  return field
}

export function normalizeStoryLanguage(value: unknown): StoryLanguageDefinition {
  const code = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0]
  const language = STORY_LANGUAGES.find((item) => item.code === code)
  if (!language) throw new Error('Unsupported Story language')
  return language
}
