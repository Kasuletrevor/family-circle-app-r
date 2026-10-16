import type {
  GuardianAngelCatalogResult,
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewStatus,
  PartnerViewTarget,
} from '../../../shared/agentic'

/** Agentic Services: the Guardian Angel catalog and isolated partner web views. */
export interface AgenticClient {
  getCatalog(refresh?: boolean): Promise<GuardianAngelCatalogResult>
  /** Without a target an open view is shown again on its current page. */
  openView(service: PartnerServiceKey, target?: PartnerViewTarget): Promise<void>
  setViewBounds(service: PartnerServiceKey, bounds: PartnerViewBounds): Promise<void>
  hideView(service: PartnerServiceKey): Promise<void>
  viewCommand(service: PartnerServiceKey, command: PartnerViewCommand): Promise<void>
  onViewState(listener: (status: PartnerViewStatus) => void): () => void
}
