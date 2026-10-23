import type { AddAngelResult, AngelConnection, MyAngelsResult, PartnerServiceKey, RemoveAngelResult } from '../../shared/agentic'
import { connectDoneCode, type KinKeepersConnection } from './KinKeepersConnection'
import type { MyGuardianAngels } from './MyGuardianAngels'

export interface AngelsController {
  connection(): Promise<AngelConnection>
  connect(): Promise<void>
  cancelConnect(): void
  disconnect(): Promise<void>
  list(): Promise<MyAngelsResult>
  add(templateId: string): Promise<AddAngelResult>
  remove(angelId: string): Promise<RemoveAngelResult>
  /** True for the Guardian Angel view's `/connect/done`, which finishes the connection. */
  interceptNavigation(service: PartnerServiceKey, url: string): boolean
}

export interface AngelsControllerDeps {
  connection: Pick<KinKeepersConnection, 'useAccount' | 'status' | 'begin' | 'cancel' | 'complete' | 'disconnect'>
  angels: Pick<MyGuardianAngels, 'list' | 'add' | 'remove'>
  openPage(service: PartnerServiceKey, url: string): Promise<void>
  accountKey(): Promise<string | null>
}

/** My Guardian Angels for whoever is signed in to Family Circle. */
export function createAngelsController(deps: AngelsControllerDeps): AngelsController {
  // Each request checks the signed-in account first, so one account never uses another's connection.
  const signedIn = async () => {
    const account = await deps.accountKey()
    await deps.connection.useAccount(account)
    return account !== null
  }

  // Overlapping Connect requests share one attempt: a second begin() would replace the verifier
  // the first page's code must be exchanged with.
  let connecting: Promise<void> | null = null

  return {
    async connection() {
      await signedIn()
      return deps.connection.status()
    },
    connect() {
      connecting ??= (async () => {
        if (!await signedIn()) throw new Error('Sign in to Family Circle first')
        await deps.openPage('guardian-angel', deps.connection.begin())
      })().finally(() => { connecting = null })
      return connecting
    },
    cancelConnect() {
      deps.connection.cancel()
    },
    async disconnect() {
      await deps.connection.disconnect()
    },
    async list() {
      return await signedIn() ? deps.angels.list() : { status: 'disconnected' }
    },
    async add(templateId) {
      return await signedIn() ? deps.angels.add(templateId) : { status: 'disconnected' }
    },
    async remove(angelId) {
      return await signedIn() ? deps.angels.remove(angelId) : { status: 'disconnected' }
    },
    interceptNavigation(service, url) {
      if (service !== 'guardian-angel') return false
      const code = connectDoneCode(url)
      if (!code) return false
      void deps.connection.complete(code)
      return true
    },
  }
}
