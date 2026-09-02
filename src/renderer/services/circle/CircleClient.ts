import type { CircleSummary, HomeSnapshot } from './types'

export interface CircleClient {
  getHomeSnapshot(): Promise<HomeSnapshot>
  getMyCircles(): Promise<CircleSummary[]>
}
