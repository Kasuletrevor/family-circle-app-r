export type PartnerServiceKey = 'guardian-angel' | 'ubercare' | 'marketplace'
export const PARTNER_SERVICE_KEYS: readonly PartnerServiceKey[] = ['guardian-angel', 'ubercare', 'marketplace']

export function isPartnerServiceKey(value: unknown): value is PartnerServiceKey {
  return typeof value === 'string' && (PARTNER_SERVICE_KEYS as readonly string[]).includes(value)
}

export type GuardianAngelCategory =
  | 'elder_companion'
  | 'care_coordinator'
  | 'family_update'
  | 'post_visit'
  | 'medication_appointment'
  | 'other'

/** Display order and labels for the catalog. */
export const GUARDIAN_ANGEL_CATEGORIES: ReadonlyArray<{ key: GuardianAngelCategory; label: string }> = [
  { key: 'elder_companion', label: 'Elder companion' },
  { key: 'care_coordinator', label: 'Care coordinator' },
  { key: 'family_update', label: 'Family update' },
  { key: 'post_visit', label: 'After a visit' },
  { key: 'medication_appointment', label: 'Medication and appointments' },
  { key: 'other', label: 'Other' },
]

export interface GuardianAngelTemplate {
  id: string
  name: string
  description: string
  category: GuardianAngelCategory
  /** Plain sentences, e.g. "No medical advice". */
  trustBoundaries: string[]
  /** Plain sentences, e.g. "Self harm mentions". */
  escalationTriggers: string[]
  /** A PNG, JPEG or WebP data URL, or null to show initials. */
  avatar: string | null
}

export type GuardianAngelCatalogResult =
  | { status: 'ready'; templates: GuardianAngelTemplate[]; fetchedAt: number; stale: boolean }
  | { status: 'unavailable' }

export type PartnerViewTarget =
  | { kind: 'start' }
  | { kind: 'template'; templateId: string }
  | { kind: 'care-builder' }
  | { kind: 'angel'; angelId: string; page: AngelPage }

/** Pages for one of the person's own angels on kin-keepers.ai: its settings or its test page. */
export type AngelPage = 'edit' | 'run'

export type PartnerViewState = 'loading' | 'ready' | 'failed'
export interface PartnerViewStatus { service: PartnerServiceKey; state: PartnerViewState; canGoBack: boolean }
export interface PartnerViewBounds { x: number; y: number; width: number; height: number }
export type PartnerViewCommand = 'back' | 'reload' | 'open-external'

export const TEMPLATE_ID = /^[1-9][0-9]{0,9}$/
export const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const CATEGORY_KEYS = new Set<string>(GUARDIAN_ANGEL_CATEGORIES.map((category) => category.key))

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every((item) => typeof item === 'string' && item.length <= 200)
}

/** Checks the public template shape (used on cached copies and in the preload). */
export function isGuardianAngelTemplate(value: unknown): value is GuardianAngelTemplate {
  if (value == null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return typeof raw.id === 'string' && TEMPLATE_ID.test(raw.id)
    && typeof raw.name === 'string' && raw.name.length > 0 && raw.name.length <= 120
    && typeof raw.description === 'string' && raw.description.length <= 600
    && typeof raw.category === 'string' && CATEGORY_KEYS.has(raw.category)
    && isTextList(raw.trustBoundaries) && isTextList(raw.escalationTriggers)
    && (raw.avatar === null || (typeof raw.avatar === 'string' && AVATAR_DATA_URL.test(raw.avatar)))
}

/** Keeps only the public fields of a template, so nothing extra crosses a boundary. */
export function publicTemplate(template: GuardianAngelTemplate): GuardianAngelTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    trustBoundaries: [...template.trustBoundaries],
    escalationTriggers: [...template.escalationTriggers],
    avatar: template.avatar,
  }
}

/** One of the person's own Guardian Angels on Kin-Keepers.ai, in the safe shape. */
export interface MyGuardianAngel {
  id: string
  name: string
  description: string
  /** The template it was added from, when known. */
  templateId: string | null
  templateName: string | null
  avatar: string | null
  usesCloudAi: boolean
  runCount: number
  /** ISO time in UTC. */
  lastRunAt: string | null
  trustBoundaries: string[]
  escalationTriggers: string[]
}

export type AngelConnection =
  | { status: 'disconnected'; problem?: 'connect-failed' | 'ended' }
  | { status: 'connecting' }
  | { status: 'connected'; email: string | null }

export type MyAngelsResult =
  | { status: 'ready'; angels: MyGuardianAngel[] }
  | { status: 'disconnected' }
  | { status: 'unavailable' }

export type AddAngelResult =
  | { status: 'added'; angel: MyGuardianAngel }
  | { status: 'disconnected' | 'not-found' | 'unavailable' }

export type RemoveAngelResult = { status: 'removed' | 'disconnected' | 'not-yours' | 'unavailable' }

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/

/** Checks the safe angel shape (used in the preload). */
export function isMyGuardianAngel(value: unknown): value is MyGuardianAngel {
  if (value == null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return typeof raw.id === 'string' && TEMPLATE_ID.test(raw.id)
    && typeof raw.name === 'string' && raw.name.length > 0 && raw.name.length <= 120
    && typeof raw.description === 'string' && raw.description.length <= 600
    && (raw.templateId === null || (typeof raw.templateId === 'string' && TEMPLATE_ID.test(raw.templateId)))
    && (raw.templateName === null || (typeof raw.templateName === 'string' && raw.templateName.length <= 120))
    && (raw.avatar === null || (typeof raw.avatar === 'string' && AVATAR_DATA_URL.test(raw.avatar)))
    && typeof raw.usesCloudAi === 'boolean'
    && typeof raw.runCount === 'number' && Number.isSafeInteger(raw.runCount) && raw.runCount >= 0
    && (raw.lastRunAt === null || (typeof raw.lastRunAt === 'string' && ISO_TIME.test(raw.lastRunAt)))
    && isTextList(raw.trustBoundaries) && isTextList(raw.escalationTriggers)
}

/** Keeps only the safe fields of an angel, so nothing extra crosses a boundary. */
export function publicAngel(angel: MyGuardianAngel): MyGuardianAngel {
  return {
    id: angel.id,
    name: angel.name,
    description: angel.description,
    templateId: angel.templateId,
    templateName: angel.templateName,
    avatar: angel.avatar,
    usesCloudAi: angel.usesCloudAi,
    runCount: angel.runCount,
    lastRunAt: angel.lastRunAt,
    trustBoundaries: [...angel.trustBoundaries],
    escalationTriggers: [...angel.escalationTriggers],
  }
}

export function safeAngelConnection(value: unknown): AngelConnection {
  const raw = value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (raw.status === 'connected') {
    return { status: 'connected', email: typeof raw.email === 'string' && EMAIL.test(raw.email) ? raw.email : null }
  }
  if (raw.status === 'connecting') return { status: 'connecting' }
  return raw.problem === 'connect-failed' || raw.problem === 'ended'
    ? { status: 'disconnected', problem: raw.problem }
    : { status: 'disconnected' }
}
