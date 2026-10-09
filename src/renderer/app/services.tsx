import { createContext, type PropsWithChildren, useContext } from 'react'
import type { CircleClient } from '../services/circle/CircleClient'
import { DesktopCircleClient } from '../services/circle/DesktopCircleClient'
import type { PersonPhotoClient } from '../services/circle/PersonPhotoClient'

export type AppServices = {
  circle: CircleClient
  /** Profile photos on this computer; without it, people show their initials. */
  photos?: PersonPhotoClient
}

const desktopCircle = new DesktopCircleClient()
const defaultServices: AppServices = {
  circle: desktopCircle,
  photos: desktopCircle,
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
