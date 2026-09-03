import type {
  CreateCircleInput,
  CreateCircleResult,
  InviteMemberInput,
  InviteMemberResult,
} from '../../../shared/desktopApi'
import type { CircleSummary, HomeSnapshot, ShellSnapshot } from './types'

export interface CircleClient {
  getHomeSnapshot(): Promise<HomeSnapshot>
  getMyCircles(): Promise<CircleSummary[]>
  getShellSnapshot(): Promise<ShellSnapshot>
  selectCircle(circleId: string): Promise<void>
  createCircle(input: CreateCircleInput): Promise<CreateCircleResult>
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>
}
