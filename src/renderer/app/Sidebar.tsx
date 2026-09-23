import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bot,
  CircleUserRound,
  Home,
  LockKeyhole,
  MailPlus,
  UsersRound,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { BrandMark } from '../design-system/BrandMark'
import { DesktopPrivateAiClient } from '../services/ai/DesktopPrivateAiClient'
import type { PrivateAiState } from '../services/ai/PrivateAiClient'

export type NavigationItem = {
  label: string
  to: string
  icon: LucideIcon
}

export const navigationItems: NavigationItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'My Circles', to: '/circles', icon: CircleUserRound },
  { label: 'Members', to: '/members', icon: UsersRound },
  { label: 'Invitations', to: '/invitations', icon: MailPlus },
  { label: 'Stories', to: '/stories', icon: BookOpen },
  { label: 'Vault', to: '/vault', icon: LockKeyhole },
  { label: 'AI Assistant', to: '/ai', icon: Bot },
]

function aiStatusLabel(state: PrivateAiState | 'checking' | 'unavailable'): string {
  switch (state) {
    case 'ready': return 'Ready (Offline)'
    case 'not_installed': return 'Not set up'
    case 'downloading': return 'Downloading…'
    case 'paused': return 'Paused'
    case 'verifying': return 'Verifying…'
    case 'repair_required': return 'Needs repair'
    case 'failed': return 'Unavailable'
    case 'checking': return 'Checking…'
    default: return 'Status unavailable'
  }
}

export function Sidebar() {
  const privateAi = useMemo(() => new DesktopPrivateAiClient(), [])
  const [aiState, setAiState] = useState<PrivateAiState | 'checking' | 'unavailable'>('checking')

  useEffect(() => {
    let active = true
    void privateAi.getStatus()
      .then((status) => {
        if (active) setAiState(status.state)
      })
      .catch(() => {
        if (active) setAiState('unavailable')
      })

    let unsubscribe = () => undefined
    try {
      unsubscribe = privateAi.onProgress((progress) => {
        if (active) setAiState(progress.state)
      })
    } catch {
      if (active) setAiState('unavailable')
    }

    return () => {
      active = false
      unsubscribe()
    }
  }, [privateAi])

  const aiReady = aiState === 'ready'

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
          <span>Private AI · local runtime</span>
          <span className={`ai-runtime-card__status${aiReady ? ' ai-runtime-card__status--ready' : ''}`}>
            <i aria-hidden="true" /> {aiStatusLabel(aiState)}
          </span>
        </div>
      </div>
    </aside>
  )
}
