import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthUser } from '../../shared/desktopApi'
import { CircleManagement } from '../features/circles/CircleManagement'
import { MyCircles } from '../features/circles/MyCircles'
import { Home } from '../features/home/Home'
import { FamilyTreePage } from '../features/family-tree/FamilyTreePage'
import { MyStory } from '../features/story/MyStory'
import { AskVault } from '../features/vault/AskVault'
import { Vault } from '../features/vault/Vault'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import './App.css'


export function AuthenticatedApp({ user, onSignOut }: { user: AuthUser; onSignOut: () => Promise<void> }) {
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export const App = AuthenticatedApp
