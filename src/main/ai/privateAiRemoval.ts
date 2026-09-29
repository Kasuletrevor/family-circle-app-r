import type { MutationLock } from '../storage/MutationLock'
import type { PrivateAiStatus } from './privateAiModels'

interface PrivateAiRemovalDependencies {
  mutationLock: MutationLock
  stopRuntimes(): Promise<void>
  removeAssets(): Promise<PrivateAiStatus>
}

// Runtimes are stopped and assets deleted inside the shared mutation lock so an
// in-flight Vault/Story indexing job cannot restart a runtime mid-removal.
export function createPrivateAiRemoval(dependencies: PrivateAiRemovalDependencies): () => Promise<PrivateAiStatus> {
  return () => dependencies.mutationLock.runExclusive(async () => {
    await dependencies.stopRuntimes()
    return dependencies.removeAssets()
  })
}
