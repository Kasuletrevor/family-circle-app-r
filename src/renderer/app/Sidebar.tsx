import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bot,
  CircleUserRound,
  Home,
  Image,
  LockKeyhole,
  MailPlus,
  Network,
  Settings,
  UsersRound,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { BrandMark } from '../design-system/BrandMark'

export type NavigationItem = {
  label: string
  to: string
  icon: LucideIcon
}

export const navigationItems: NavigationItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'My Circles', to: '/circles', icon: CircleUserRound },
  { label: 'Family Tree', to: '/family-tree', icon: Network },
  { label: 'Members', to: '/members', icon: UsersRound },
  { label: 'Invitations', to: '/invitations', icon: MailPlus },
  { label: 'Stories', to: '/stories', icon: BookOpen },
  { label: 'Vault', to: '/vault', icon: LockKeyhole },
  { label: 'Memories', to: '/memories', icon: Image },
  { label: 'AI Assistant', to: '/ai', icon: Bot },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export function Sidebar() {
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <BrandMark />
      </div>

      <nav className="app-sidebar__nav" aria-label="Primary navigation">
        {navigationItems.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            end={to === '/'}
            to={to}
            aria-label={label}
            className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
          >
            <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="ai-runtime-card" aria-label="Local AI status">
        <div className="ai-runtime-card__icon" aria-hidden="true">
          <Bot size={18} />
        </div>
        <div>
          <strong>Local AI</strong>
          <span>Granite · private runtime</span>
          <span className="ai-runtime-card__status">
            <i aria-hidden="true" /> Ready (Offline)
          </span>
        </div>
      </div>
    </aside>
  )
}
