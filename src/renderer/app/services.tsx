import { createContext, type PropsWithChildren, useContext } from 'react'
import type { AgenticClient } from '../services/agentic/AgenticClient'
import { DesktopAgenticClient } from '../services/agentic/DesktopAgenticClient'
import type { CircleClient } from '../services/circle/CircleClient'
import { DesktopCircleClient } from '../services/circle/DesktopCircleClient'
import type { PersonPhotoClient } from '../services/circle/PersonPhotoClient'

export type AppServices = {
  circle: CircleClient
  /** Profile photos on this computer; without it, people show their initials. */
  photos?: PersonPhotoClient
  /** Agentic Services; without it, those pages explain they are unavailable. */
  agentic?: AgenticClient
}

const desktopCircle = new DesktopCircleClient()
const defaultServices: AppServices = {
  circle: desktopCircle,
  photos: desktopCircle,
  agentic: new DesktopAgenticClient(),
}

const AppServicesContext = createContext<AppServices>(defaultServices)

export function AppServicesProvider({
  children,
  services = defaultServices,
}: PropsWithChildren<{ services?: AppServices }>) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>
}

export function useAppServices(): AppServices {
  return useContext(AppServicesContext)
}
