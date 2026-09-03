import type { CircleSummary, HomeSnapshot, ShellSnapshot } from './types'

export interface CircleClient {
  getHomeSnapshot(): Promise<HomeSnapshot>
  getMyCircles(): Promise<CircleSummary[]>
  getShellSnapshot(): Promise<ShellSnapshot>
}
