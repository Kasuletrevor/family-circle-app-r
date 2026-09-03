import { createContext, type PropsWithChildren, useContext } from 'react'
import type { CircleClient } from '../services/circle/CircleClient'
import { DesktopCircleClient } from '../services/circle/DesktopCircleClient'

export type AppServices = {
  circle: CircleClient
}

const defaultServices: AppServices = {
  circle: new DesktopCircleClient(),
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
