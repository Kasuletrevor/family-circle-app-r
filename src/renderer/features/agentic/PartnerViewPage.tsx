import type { PartnerServiceKey } from '../../../shared/agentic'

export function PartnerViewPage({ service }: { service: PartnerServiceKey }) {
  return <section className="agentic-page" data-service={service} />
}
