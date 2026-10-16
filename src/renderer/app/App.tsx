import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { AuthState, AuthUser } from '../../shared/desktopApi'
import type { AuthClient } from '../services/auth/AuthClient'
import { DesktopAuthClient } from '../services/auth/DesktopAuthClient'
import { GuardianAngelPage } from '../features/agentic/GuardianAngelPage'
import { PartnerViewPage } from '../features/agentic/PartnerViewPage'
import { CircleManagement } from '../features/circles/CircleManagement'
import { MyCircles } from '../features/circles/MyCircles'
import { PersonPhotosProvider } from '../features/circles/PersonPhotos'
import { Home } from '../features/home/Home'
import { SettingsPage } from '../features/settings/SettingsPage'
import { FamilyTreePage } from '../features/family-tree/FamilyTreePage'
import { MyStory } from '../features/story/MyStory'
import { AskVault } from '../features/vault/AskVault'
import { Vault } from '../features/vault/Vault'
import { isCommandPath, Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import './App.css'


export function AuthenticatedApp({
  user,
  auth,
  onAuthStateChange,
  onSignOut,
}: {
  user: AuthUser
  auth?: AuthClient
  onAuthStateChange?(state: AuthState): void
  onSignOut: () => Promise<void>
}) {
  const settingsAuth = auth ?? new DesktopAuthClient(window.familyCircle)
  const updateAuthState = onAuthStateChange ?? (() => undefined)
  const commandMode = isCommandPath(useLocation().pathname)

  return (
    <PersonPhotosProvider>
    <div className="app-shell" data-mode={commandMode ? 'command' : 'ask'}>
      <Sidebar />
      <div className="app-shell__workspace">
        <TopBar user={user} onSignOut={onSignOut} />
        <main className="app-shell__content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/circles" element={<MyCircles />} />
            <Route path="/family-tree" element={<FamilyTreePage />} />
            <Route path="/members" element={<CircleManagement initialSection="members" />} />
            <Route path="/invitations" element={<CircleManagement initialSection="invitations" />} />
            <Route path="/stories" element={<MyStory />} />
            <Route path="/vault" element={<Vault />} />
            <Route path="/ai" element={<AskVault />} />
            <Route path="/settings" element={<SettingsPage user={user} auth={settingsAuth} onAuthStateChange={updateAuthState} />} />
            <Route path="/agentic/guardian-angel" element={<GuardianAngelPage />} />
            <Route path="/agentic/guardian-angel/view" element={<PartnerViewPage key="guardian-angel" service="guardian-angel" />} />
            <Route path="/agentic/ubercare" element={<PartnerViewPage key="ubercare" service="ubercare" />} />
            <Route path="/agentic/marketplace" element={<PartnerViewPage key="marketplace" service="marketplace" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
    </PersonPhotosProvider>
  )
}

export const App = AuthenticatedApp
