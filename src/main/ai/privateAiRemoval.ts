import type { MutationLock } from '../storage/MutationLock'
import type { PrivateAiSetupStatus } from './privateAiModels'

interface PrivateAiRemovalDependencies {
  mutationLock: MutationLock
  stopRuntimes(): Promise<void>
  removeAssets(): Promise<PrivateAiSetupStatus>
}

// Runtimes are stopped and assets deleted inside the shared mutation lock so an
// in-flight Vault/Story indexing job cannot restart a runtime mid-removal.
export function createPrivateAiRemoval(dependencies: PrivateAiRemovalDependencies): () => Promise<PrivateAiSetupStatus> {
  return () => dependencies.mutationLock.runExclusive(async () => {
    await dependencies.stopRuntimes()
    return dependencies.removeAssets()
  })
}
