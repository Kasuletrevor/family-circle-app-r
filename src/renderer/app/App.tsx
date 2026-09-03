import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthUser } from '../../shared/desktopApi'
import { MyCircles } from '../features/circles/MyCircles'
import { Home } from '../features/home/Home'
import { PlaceholderPage } from './PlaceholderPage'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import './App.css'

const placeholderRoutes = [
  { path: '/family-tree', title: 'Family Tree' },
  { path: '/members', title: 'Members' },
  { path: '/invitations', title: 'Invitations' },
  { path: '/stories', title: 'Stories' },
  { path: '/vault', title: 'Vault' },
  { path: '/memories', title: 'Memories' },
  { path: '/ai', title: 'AI Assistant' },
  { path: '/settings', title: 'Settings' },
] as const

export function AuthenticatedApp({ user }: { user: AuthUser }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-shell__workspace">
        <TopBar user={user} />
        <main className="app-shell__content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/circles" element={<MyCircles />} />
            {placeholderRoutes.map(({ path, title }) => (
              <Route key={path} path={path} element={<PlaceholderPage title={title} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export const App = AuthenticatedApp
