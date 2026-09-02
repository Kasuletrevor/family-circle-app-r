import { createContext, type PropsWithChildren, useContext } from 'react'
import type { CircleClient } from '../services/circle/CircleClient'
import { MockCircleClient } from '../services/circle/MockCircleClient'

export type AppServices = {
  circle: CircleClient
}

const defaultServices: AppServices = {
  circle: new MockCircleClient(),
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
