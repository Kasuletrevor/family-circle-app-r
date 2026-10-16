import {
  isPartnerServiceKey,
  publicTemplate,
  TEMPLATE_ID,
  type GuardianAngelCatalogResult,
  type PartnerServiceKey,
  type PartnerViewCommand,
  type PartnerViewTarget,
} from '../../shared/agentic'
import type { IpcHandleRegistrar } from '../auth/authIpc'
import type { PartnerViews } from './PartnerViews'

export interface AgenticIpcDeps {
  catalog: { get(options?: { refresh?: boolean }): Promise<GuardianAngelCatalogResult> }
  views: Pick<PartnerViews, 'open' | 'setBounds' | 'hide' | 'command'>
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
}
