import { TEMPLATE_ID, type PartnerServiceKey, type PartnerViewBounds, type PartnerViewTarget } from '../../shared/agentic'

interface PartnerService {
  name: string
  startUrl: string
  hosts: readonly string[]
  /** Services in one group share a session, so people sign in once. */
  group: 'kin-keepers' | 'ubercare'
}

const KIN_KEEPERS_HOSTS = ['kin-keepers.ai', 'www.kin-keepers.ai'] as const

export const PARTNER_SERVICES: Record<PartnerServiceKey, PartnerService> = {
  'guardian-angel': { name: 'Guardian Angel', startUrl: 'https://kin-keepers.ai/', hosts: KIN_KEEPERS_HOSTS, group: 'kin-keepers' },
  ubercare: { name: 'UberCare', startUrl: 'https://remotecarers.net/worker/', hosts: ['remotecarers.net', 'www.remotecarers.net'], group: 'ubercare' },
  marketplace: { name: 'Marketplace', startUrl: 'https://kin-keepers.ai/', hosts: KIN_KEEPERS_HOSTS, group: 'kin-keepers' },
}

/** Where a main-frame navigation in a partner view may go. */
export function decideNavigation(service: PartnerServiceKey, url: string): 'allow' | 'external' | 'block' {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'block'
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return 'block'
  return PARTNER_SERVICES[service].hosts.includes(parsed.hostname) ? 'allow' : 'external'
}

export function targetUrl(service: PartnerServiceKey, target: PartnerViewTarget): string {
  if (target.kind === 'start') return PARTNER_SERVICES[service].startUrl
  if (service !== 'guardian-angel') throw new Error('Only Guardian Angel has template pages')
  if (target.kind === 'care-builder') return 'https://kin-keepers.ai/care-builder'
  if (target.kind === 'angel') {
    if (!TEMPLATE_ID.test(target.angelId) || (target.page !== 'edit' && target.page !== 'run')) throw new Error('Invalid angel page')
    return `https://kin-keepers.ai/agents/${target.angelId}/${target.page}`
  }
  if (!TEMPLATE_ID.test(target.templateId)) throw new Error('Invalid template')
  return `https://kin-keepers.ai/templates/${target.templateId}`
}

export function clampBounds(input: unknown, content: { width: number; height: number }): PartnerViewBounds {
  const raw = input != null && typeof input === 'object' ? input as Record<string, unknown> : null
  const values = raw ? [raw.x, raw.y, raw.width, raw.height] : []
  if (values.length !== 4 || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Invalid view bounds')
  }
  const [x, y, width, height] = (values as number[]).map(Math.round) as [number, number, number, number]
  const left = Math.min(Math.max(0, x), content.width)
  const top = Math.min(Math.max(0, y), content.height)
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.min(width, content.width - left)),
    height: Math.max(0, Math.min(height, content.height - top)),
  }
}

export function partitionFor(service: PartnerServiceKey, accountKey: string): string {
  return `persist:agentic-${PARTNER_SERVICES[service].group}-${accountKey}`
}
