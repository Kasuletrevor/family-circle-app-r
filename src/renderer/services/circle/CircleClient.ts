import type {
  CreateCircleInput,
  CreateCircleResult,
  InviteMemberInput,
  InviteMemberResult,
  ResendInvitationResult,
} from '../../../shared/desktopApi'
import type { CircleManagementSnapshot, CircleSummary, HomeSnapshot, ShellSnapshot } from './types'

export interface CircleClient {
  getHomeSnapshot(): Promise<HomeSnapshot>
  getMyCircles(): Promise<CircleSummary[]>
  getCircleDetails(): Promise<CircleManagementSnapshot | null>
  getShellSnapshot(): Promise<ShellSnapshot>
  selectCircle(circleId: string): Promise<void>
  createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
  resendInvitation(personId: string): Promise<ResendInvitationResult>
  cancelInvitation(personId: string): Promise<void>
  removeMember(personId: string): Promise<void>
  leaveCircle(): Promise<void>
}
