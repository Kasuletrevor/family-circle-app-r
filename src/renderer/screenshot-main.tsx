import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { AuthenticatedApp } from './app/App'
import { AppServicesProvider } from './app/services'
import './design-system/base.css'
import { MockCircleClient } from './services/circle/MockCircleClient'

const root = document.getElementById('root')
if (!root) throw new Error('Screenshot renderer root was not found')

const user = {
  id: 7,
  email: 'trevor@kasule.family',
  name: 'Trevor Kasule',
  accountOrigin: 'registered' as const,
  mustChangePassword: false,
  onboardingCompleted: true,
}

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <AppServicesProvider services={{ circle: new MockCircleClient() }}>
        <AuthenticatedApp user={user} />
      </AppServicesProvider>
    </HashRouter>
  </StrictMode>,
)
