import { Navigate, Route, Routes } from 'react-router-dom'
import { Home } from '../features/home/Home'
import { PlaceholderPage } from './PlaceholderPage'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import './App.css'

const placeholderRoutes = [
  { path: '/circles', title: 'My Circles' },
  { path: '/family-tree', title: 'Family Tree' },
  { path: '/members', title: 'Members' },
  { path: '/invitations', title: 'Invitations' },
  { path: '/stories', title: 'Stories' },
  { path: '/vault', title: 'Vault' },
  { path: '/memories', title: 'Memories' },
  { path: '/ai', title: 'AI Assistant' },
  { path: '/settings', title: 'Settings' },
] as const

export function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-shell__workspace">
        <TopBar />
        <main className="app-shell__content">
          <Routes>
            <Route path="/" element={<Home />} />
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
