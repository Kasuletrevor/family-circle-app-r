import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { AuthenticatedApp } from './app/App'
import { SessionGate } from './app/SessionGate'
import './design-system/base.css'
import { AuthScreen } from './features/auth/AuthScreen'
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
        renderOnboarding={() => (
          <main className="session-gate">
            <h1>Finish setting up your Family Circle</h1>
            <p>Your account is secure. Complete the remaining setup steps to continue.</p>
          </main>
        )}
        renderAuthenticated={() => <AuthenticatedApp />}
      />
    </HashRouter>
  </StrictMode>,
)
