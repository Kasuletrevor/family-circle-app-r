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
  return privateAi
}

export class DesktopPrivateAiClient implements PrivateAiClient {
  private readonly operations: PrivateAiDesktopOperations

  constructor(operations?: PrivateAiDesktopOperations) {
    this.operations = operations ?? defaultOperations()
  }

  getStatus(): Promise<PrivateAiStatus> {
    return this.operations.getStatus()
  }

  startSetup(): Promise<PrivateAiStatus> {
    return this.operations.startSetup()
  }

  pauseSetup(): Promise<PrivateAiStatus> {
    return this.operations.pauseSetup()
  }

  repair(): Promise<PrivateAiStatus> {
    return this.operations.repair()
  }

  onProgress(listener: (progress: PrivateAiProgress) => void): () => void {
    return this.operations.onProgress(listener)
  }
}
