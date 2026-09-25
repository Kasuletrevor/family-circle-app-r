import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthState, AuthUser } from '../../shared/desktopApi'
import { CircleManagement } from '../features/circles/CircleManagement'
import { MyCircles } from '../features/circles/MyCircles'
import { Home } from '../features/home/Home'
import { FamilyTreePage } from '../features/family-tree/FamilyTreePage'
import { MyStory } from '../features/story/MyStory'
import { Settings } from '../features/settings/Settings'
import { AskVault } from '../features/vault/AskVault'
import { Vault } from '../features/vault/Vault'
import type { AuthClient } from '../services/auth/AuthClient'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import './App.css'


export function AuthenticatedApp({
  user,
  onSignOut,
  authClient,
  onAuthStateChange,
}: {
  user: AuthUser
  onSignOut: () => Promise<void>
  authClient?: AuthClient
  onAuthStateChange?: (state: AuthState) => void
}) {
  return (
    <div className="app-shell">
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
            <Route
              path="/settings"
              element={<Settings user={user} authClient={authClient} onAuthStateChange={onAuthStateChange} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export const App = AuthenticatedApp
