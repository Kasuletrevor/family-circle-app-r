import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { AuthenticatedApp } from './app/App'
import { SessionGate } from './app/SessionGate'
import './design-system/base.css'
import { AuthScreen } from './features/auth/AuthScreen'
import { Onboarding } from './features/onboarding/Onboarding'
import { DesktopAuthClient } from './services/auth/DesktopAuthClient'

const root = document.getElementById('root')
if (!root) throw new Error('Family Circle renderer root was not found')

const authClient = new DesktopAuthClient(window.familyCircle)

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <SessionGate
        client={authClient}
        renderUnauthenticated={(onStateChange) => (
          <AuthScreen client={authClient} onStateChange={onStateChange} />
        )}
        renderOnboarding={(state, onStateChange) => (
          <Onboarding state={state} client={authClient} onStateChange={onStateChange} />
        )}
        renderAuthenticated={(state) => <AuthenticatedApp user={state.user} />}
      />
    </HashRouter>
  </StrictMode>,
)
