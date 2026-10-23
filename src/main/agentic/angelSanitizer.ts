import type { GuardianAngelTemplate, MyGuardianAngel } from '../../shared/agentic'
import { catalogId, cleanText, rules } from './catalogSanitizer'

export const MAX_ANGELS = 100

function utcTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  // The API sends UTC times, sometimes without a zone.
  const text = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/**
 * One angel from the API in the safe shape, with the avatar and name of the template it came from.
 * The marketplace's model and provider are left out: in Family Circle, angels run on the local runtime.
 */
export function sanitizeAngel(raw: unknown, templates: ReadonlyMap<string, GuardianAngelTemplate>): MyGuardianAngel | null {
  if (raw == null || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const id = catalogId(entry.id)
  const name = cleanText(entry.name, 120)
  if (!id || !name) return null
  const templateId = catalogId(entry.original_agent_id)
  const template = templateId ? templates.get(templateId) : undefined
  const runs = entry.run_count
  return {
    id,
    name,
    description: cleanText(entry.description, 600),
    templateId,
    templateName: template?.name ?? null,
    avatar: template?.avatar ?? null,
    runCount: typeof runs === 'number' && Number.isSafeInteger(runs) && runs > 0 ? runs : 0,
    lastRunAt: utcTime(entry.last_run_at),
    trustBoundaries: rules(entry.trust_boundaries),
    escalationTriggers: rules(entry.escalation_triggers),
  }
}

/** The angel list in the safe shape, or null when the response is not a list. */
export function sanitizeAngels(raw: unknown, templates: ReadonlyMap<string, GuardianAngelTemplate>): MyGuardianAngel[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const angels: MyGuardianAngel[] = []
  for (const item of raw) {
    const angel = sanitizeAngel(item, templates)
    if (!angel || seen.has(angel.id)) continue
    seen.add(angel.id)
    angels.push(angel)
    if (angels.length === MAX_ANGELS) break
  }
  return angels
}
