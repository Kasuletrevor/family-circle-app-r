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
