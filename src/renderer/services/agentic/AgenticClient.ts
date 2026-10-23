import type {
  AddAngelResult,
  AngelConnection,
  GuardianAngelCatalogResult,
  MyAngelsResult,
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewStatus,
  PartnerViewTarget,
  RemoveAngelResult,
} from '../../../shared/agentic'

/** Agentic Services: the Guardian Angel catalog, the person's own angels and isolated partner web views. */
export interface AgenticClient {
  getCatalog(refresh?: boolean): Promise<GuardianAngelCatalogResult>
  /** Without a target an open view is shown again on its current page. */
  openView(service: PartnerServiceKey, target?: PartnerViewTarget): Promise<void>
  setViewBounds(service: PartnerServiceKey, bounds: PartnerViewBounds): Promise<void>
  hideView(service: PartnerServiceKey): Promise<void>
  viewCommand(service: PartnerServiceKey, command: PartnerViewCommand): Promise<void>
  onViewState(listener: (status: PartnerViewStatus) => void): () => void
  getAngelConnection(): Promise<AngelConnection>
  /** Opens the Kin-Keepers.ai connect page in the Guardian Angel view. */
  connect(): Promise<void>
  cancelConnect(): Promise<void>
  disconnect(): Promise<void>
  getMyAngels(): Promise<MyAngelsResult>
  addAngel(templateId: string): Promise<AddAngelResult>
  removeAngel(angelId: string): Promise<RemoveAngelResult>
  onAngelConnection(listener: (connection: AngelConnection) => void): () => void
}
