import type { PrivateAiClient, PrivateAiProgress, PrivateAiStatus } from './PrivateAiClient'

export interface PrivateAiDesktopOperations {
  getStatus(): Promise<PrivateAiStatus>
  startSetup(): Promise<PrivateAiStatus>
  pauseSetup(): Promise<PrivateAiStatus>
  repair(): Promise<PrivateAiStatus>
  onProgress(listener: (progress: PrivateAiProgress) => void): () => void
}

function defaultOperations(): PrivateAiDesktopOperations {
  const privateAi = (window.familyCircle as unknown as { privateAi: PrivateAiDesktopOperations }).privateAi
  if (!privateAi) throw new Error('Private AI desktop bridge is unavailable')
  return privateAi
}

export class DesktopPrivateAiClient implements PrivateAiClient {
  constructor(private readonly injectedOperations?: PrivateAiDesktopOperations) {}

  private operations(): PrivateAiDesktopOperations {
    return this.injectedOperations ?? defaultOperations()
  }

  async getStatus(): Promise<PrivateAiStatus> {
    return this.operations().getStatus()
  }

  async startSetup(): Promise<PrivateAiStatus> {
    return this.operations().startSetup()
  }

  async pauseSetup(): Promise<PrivateAiStatus> {
    return this.operations().pauseSetup()
  }

  async repair(): Promise<PrivateAiStatus> {
    return this.operations().repair()
  }

  onProgress(listener: (progress: PrivateAiProgress) => void): () => void {
    return this.operations().onProgress(listener)
  }
}
