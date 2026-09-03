import type {
  CircleListItem,
  CircleOverview,
  CreateCircleInput,
  CreateCircleResult,
  InvitationFamilyRole,
  InviteMemberInput,
  InviteMemberResult,
} from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'

export interface CircleIpcService {
  getOverview(): Promise<CircleOverview>
  getMyCircles(): Promise<CircleListItem[]>
  selectCircle(circleId: string): Promise<{ success: true }>
  createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function registerCircleIpc(ipc: IpcHandleRegistrar, service: CircleIpcService): void {
  ipc.handle('circle:get-overview', () => service.getOverview())
  ipc.handle('circle:get-my-circles', () => service.getMyCircles())
  ipc.handle('circle:select', (_event, payload) => service.selectCircle(String(payload ?? '')))
  ipc.handle('circle:create', (_event, payload) => {
    const raw = recordOf(payload)
    return service.createCircle({ name: String(raw.name ?? '') })
  })
  ipc.handle('circle:invite-member', (_event, payload) => {
    const raw = recordOf(payload)
    return service.inviteMember({
      circleId: String(raw.circleId ?? ''),
      email: String(raw.email ?? ''),
      role: String(raw.role ?? '') as InvitationFamilyRole,
    })
  })
}
