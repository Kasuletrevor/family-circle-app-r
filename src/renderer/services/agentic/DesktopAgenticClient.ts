import type {
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewStatus,
  PartnerViewTarget,
} from '../../../shared/agentic'
import type { DesktopApi } from '../../../shared/desktopApi'
import type { AgenticClient } from './AgenticClient'

type AgenticDesktopOperations = DesktopApi['agentic']

const defaultOperations: AgenticDesktopOperations = {
  getCatalog: (input) => window.familyCircle.agentic.getCatalog(input),
  openView: (input) => window.familyCircle.agentic.openView(input),
  setViewBounds: (input) => window.familyCircle.agentic.setViewBounds(input),
  hideView: (input) => window.familyCircle.agentic.hideView(input),
  viewCommand: (input) => window.familyCircle.agentic.viewCommand(input),
  onViewState: (listener) => window.familyCircle.agentic.onViewState(listener),
}

export class DesktopAgenticClient implements AgenticClient {
  private readonly operations: AgenticDesktopOperations

  constructor(operations: Partial<AgenticDesktopOperations> = {}) {
    this.operations = { ...defaultOperations, ...operations }
  }

  getCatalog(refresh = false) {
    return this.operations.getCatalog({ refresh })
  }

  async openView(service: PartnerServiceKey, target?: PartnerViewTarget) {
    await this.operations.openView(target ? { service, target } : { service })
  }

  async setViewBounds(service: PartnerServiceKey, bounds: PartnerViewBounds) {
    await this.operations.setViewBounds({ service, ...bounds })
  }

  async hideView(service: PartnerServiceKey) {
    await this.operations.hideView({ service })
  }

  async viewCommand(service: PartnerServiceKey, command: PartnerViewCommand) {
    await this.operations.viewCommand({ service, command })
  }

  onViewState(listener: (status: PartnerViewStatus) => void) {
    return this.operations.onViewState(listener)
  }
}
