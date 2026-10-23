import { GUARDIAN_ANGEL_CATEGORIES, TEMPLATE_SLUG, type GuardianAngelCategory, type GuardianAngelTemplate } from '../../shared/agentic'

export interface SanitizedTemplate {
  template: Omit<GuardianAngelTemplate, 'avatar'>
  avatarPath: string | null
}

const KNOWN_CATEGORIES = new Set<string>(GUARDIAN_ANGEL_CATEGORIES.map((category) => category.key))
const AVATAR_PATH = /^\/avatars\/[A-Za-z0-9_-]{1,80}\.(png|jpe?g|webp)$/
// C0/C1 controls plus bidi and zero-width formatting characters.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_CHARACTERS, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** "no_medical_advice" becomes "No medical advice"; sentences are kept as they are. */
export function humanizeRule(value: string): string {
  const text = cleanText(value.replace(/_/g, ' '), 200)
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

export function rules(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(humanizeRule)
    .filter(Boolean)
    .slice(0, 12)
}

/** A positive numeric catalog id as a string, or null. */
export function catalogId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 1e10) return String(value)
  if (typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value)) return value
  return null
}

/** Keeps curated templates from the public list, in the public shape only. */
export function sanitizeCatalog(raw: unknown): SanitizedTemplate[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: SanitizedTemplate[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (entry.is_curated !== true) continue
    const id = catalogId(entry.id)
    const name = cleanText(entry.name, 120)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const category = typeof entry.category === 'string' && KNOWN_CATEGORIES.has(entry.category)
      ? entry.category as GuardianAngelCategory
      : 'other'
    const slug = typeof entry.slug === 'string' && TEMPLATE_SLUG.test(entry.slug) ? entry.slug : undefined
    result.push({
      template: {
        id,
        name,
        description: cleanText(entry.description, 600),
        category,
        trustBoundaries: rules(entry.trust_boundaries),
        escalationTriggers: rules(entry.escalation_triggers),
        ...(slug ? { slug } : {}),
      },
      avatarPath: typeof entry.avatar_src === 'string' && AVATAR_PATH.test(entry.avatar_src) ? entry.avatar_src : null,
    })
  }
  return result
}
