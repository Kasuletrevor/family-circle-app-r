import {
  isPartnerServiceKey,
  publicAngel,
  publicTemplate,
  safeAngelConnection,
  TEMPLATE_ID,
  type GuardianAngelCatalogResult,
  type PartnerServiceKey,
  type PartnerViewCommand,
  type PartnerViewTarget,
} from '../../shared/agentic'
import { MAX_ANGEL_MESSAGE } from '../../shared/agenticChat'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { AngelsController } from './angelsController'
import type { LocalAngelRunner } from './LocalAngelRunner'
import type { PartnerViews } from './PartnerViews'

export interface AgenticIpcDeps {
  catalog: { get(options?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult> }
  views: Pick<PartnerViews, 'open' | 'setBounds' | 'hide' | 'command'>
  angels: Omit<AngelsController, 'interceptNavigation'>
  chat: Pick<LocalAngelRunner, 'open' | 'send' | 'clear' | 'forget'>
}

function catalogIdOf(payload: unknown, field: 'templateId' | 'angelId'): string {
  const value = recordOf(payload)[field]
  if (typeof value !== 'string' || !TEMPLATE_ID.test(value)) throw new Error('Invalid Guardian Angel')
  return value
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function serviceOf(payload: unknown): PartnerServiceKey {
  const service = recordOf(payload).service
  if (!isPartnerServiceKey(service)) throw new Error('Unknown partner service')
  return service
}

function targetOf(value: unknown): PartnerViewTarget | undefined {
  if (value === undefined) return undefined
  const raw = recordOf(value)
  if (raw.kind === 'start' || raw.kind === 'care-builder') return { kind: raw.kind }
  if (raw.kind === 'template' && typeof raw.templateId === 'string' && TEMPLATE_ID.test(raw.templateId)) {
    return { kind: 'template', templateId: raw.templateId }
  }
  if (raw.kind === 'angel' && typeof raw.angelId === 'string' && TEMPLATE_ID.test(raw.angelId) && (raw.page === 'edit' || raw.page === 'run')) {
    return { kind: 'angel', angelId: raw.angelId, page: raw.page }
  }
  throw new Error('Invalid partner page')
}

const COMMANDS = new Set<unknown>(['back', 'reload', 'open-external'] satisfies PartnerViewCommand[])

export function registerAgenticIpc(ipc: IpcHandleRegistrar, deps: AgenticIpcDeps): void {
  ipc.handle('agentic:catalog', async (_event, payload) => {
    const result = await deps.catalog.get({ refresh: recordOf(payload).refresh === true })
    return result.status === 'ready' ? { ...result, templates: result.templates.map(publicTemplate) } : result
  })
  ipc.handle('agentic:open-view', async (_event, payload) => {
    const service = serviceOf(payload)
    await deps.views.open(service, targetOf(recordOf(payload).target))
    return { success: true }
  })
  ipc.handle('agentic:set-view-bounds', (_event, payload) => {
    const raw = recordOf(payload)
    deps.views.setBounds(serviceOf(payload), { x: raw.x, y: raw.y, width: raw.width, height: raw.height })
    return { success: true }
  })
  ipc.handle('agentic:hide-view', (_event, payload) => {
    deps.views.hide(serviceOf(payload))
    return { success: true }
  })
  ipc.handle('agentic:view-command', (_event, payload) => {
    const command = recordOf(payload).command
    if (!COMMANDS.has(command)) throw new Error('Unknown command')
    deps.views.command(serviceOf(payload), command as PartnerViewCommand)
    return { success: true }
  })
  ipc.handle('agentic:angel-connection', async () => safeAngelConnection(await deps.angels.connection()))
  ipc.handle('agentic:connect', async () => {
    await deps.angels.connect()
    return { success: true }
  })
  ipc.handle('agentic:cancel-connect', () => {
    deps.angels.cancelConnect()
    return { success: true }
  })
  ipc.handle('agentic:disconnect', async () => {
    await deps.angels.disconnect()
    return { success: true }
  })
  ipc.handle('agentic:my-angels', async () => {
    const result = await deps.angels.list()
    return result.status === 'ready' ? { status: 'ready', angels: result.angels.map(publicAngel) } : { status: result.status }
  })
  ipc.handle('agentic:add-angel', async (_event, payload) => {
    const result = await deps.angels.add(catalogIdOf(payload, 'templateId'))
    return result.status === 'added' ? { status: 'added', angel: publicAngel(result.angel) } : { status: result.status }
  })
  ipc.handle('agentic:remove-angel', async (_event, payload) => {
    const angelId = catalogIdOf(payload, 'angelId')
    const result = await deps.angels.remove(angelId)
    // Removing an angel also removes its conversation and recipe from this computer.
    if (result.status === 'removed') await deps.chat.forget(angelId).catch(() => undefined)
    return { status: result.status }
  })
  ipc.handle('agentic:angel-chat-open', async (_event, payload) => deps.chat.open(catalogIdOf(payload, 'angelId')))
  ipc.handle('agentic:angel-chat-send', async (_event, payload) => {
    const text = recordOf(payload).text
    if (typeof text !== 'string' || text.length > MAX_ANGEL_MESSAGE) throw new Error('Invalid message')
    return deps.chat.send(catalogIdOf(payload, 'angelId'), text)
  })
  ipc.handle('agentic:angel-chat-clear', async (_event, payload) => {
    await deps.chat.clear(catalogIdOf(payload, 'angelId'))
    return { success: true }
  })
}
