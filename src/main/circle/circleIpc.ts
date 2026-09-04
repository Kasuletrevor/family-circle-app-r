import type {
  CircleDetails,
  CircleListItem,
  CircleOverview,
  CreateCircleInput,
  CreateCircleResult,
  InvitationFamilyRole,
  InviteMemberInput,
  InviteMemberResult,
  ResendInvitationResult,
} from '../../shared/desktopApi'
import type { IpcHandleRegistrar } from '../auth/authIpc'

export interface CircleIpcService {
  getOverview(): Promise<CircleOverview>
  getMyCircles(): Promise<CircleListItem[]>
  getCircleDetails(): Promise<CircleDetails | null>
  selectCircle(circleId: string): Promise<{ success: true }>
  createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
  resendInvitation(input: { personId: string }): Promise<ResendInvitationResult>
  cancelInvitation(input: { personId: string }): Promise<{ success: true }>
  removeMember(input: { personId: string }): Promise<{ success: true }>
  leaveCircle(): Promise<{ success: true }>
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function personInput(payload: unknown): { personId: string } {
  const raw = recordOf(payload)
  return { personId: String(raw.personId ?? '') }
}

export function registerCircleIpc(ipc: IpcHandleRegistrar, service: CircleIpcService): void {
  ipc.handle('circle:get-overview', () => service.getOverview())
  ipc.handle('circle:get-my-circles', () => service.getMyCircles())
  ipc.handle('circle:get-details', () => service.getCircleDetails())
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
  ipc.handle('circle:resend-invitation', (_event, payload) => service.resendInvitation(personInput(payload)))
  ipc.handle('circle:cancel-invitation', (_event, payload) => service.cancelInvitation(personInput(payload)))
  ipc.handle('circle:remove-member', (_event, payload) => service.removeMember(personInput(payload)))
  ipc.handle('circle:leave', () => service.leaveCircle())
}
