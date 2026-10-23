import type {
  AngelConnection,
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
  getAngelConnection: () => window.familyCircle.agentic.getAngelConnection(),
  connectAngels: () => window.familyCircle.agentic.connectAngels(),
  cancelConnectAngels: () => window.familyCircle.agentic.cancelConnectAngels(),
  disconnectAngels: () => window.familyCircle.agentic.disconnectAngels(),
  getMyAngels: () => window.familyCircle.agentic.getMyAngels(),
  addAngel: (input) => window.familyCircle.agentic.addAngel(input),
  removeAngel: (input) => window.familyCircle.agentic.removeAngel(input),
  onAngelConnection: (listener) => window.familyCircle.agentic.onAngelConnection(listener),
  openAngelChat: (input) => window.familyCircle.agentic.openAngelChat(input),
  sendAngelMessage: (input) => window.familyCircle.agentic.sendAngelMessage(input),
  clearAngelChat: (input) => window.familyCircle.agentic.clearAngelChat(input),
  getSavedAngels: () => window.familyCircle.agentic.getSavedAngels(),
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

  getAngelConnection() {
    return this.operations.getAngelConnection()
  }

  async connect() {
    await this.operations.connectAngels()
  }

  async cancelConnect() {
    await this.operations.cancelConnectAngels()
  }

  async disconnect() {
    await this.operations.disconnectAngels()
  }

  getMyAngels() {
    return this.operations.getMyAngels()
  }

  addAngel(templateId: string) {
    return this.operations.addAngel({ templateId })
  }

  removeAngel(angelId: string) {
    return this.operations.removeAngel({ angelId })
  }

  onAngelConnection(listener: (connection: AngelConnection) => void) {
    return this.operations.onAngelConnection(listener)
  }

  openAngelChat(angelId: string) {
    return this.operations.openAngelChat({ angelId })
  }

  sendAngelMessage(angelId: string, text: string) {
    return this.operations.sendAngelMessage({ angelId, text })
  }

  async clearAngelChat(angelId: string) {
    await this.operations.clearAngelChat({ angelId })
  }

  getSavedAngels() {
    return this.operations.getSavedAngels()
  }
}
