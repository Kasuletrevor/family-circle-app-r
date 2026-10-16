import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bot,
  CircleUserRound,
  HeartHandshake,
  Home,
  LockKeyhole,
  MailPlus,
  Network,
  Settings,
  ShieldCheck,
  Store,
  UsersRound,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { PRIVATE_AI_MODELS } from '../../shared/privateAiModels'
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
  { label: 'Family Tree', to: '/family-tree', icon: Network },
  { label: 'Members', to: '/members', icon: UsersRound },
  { label: 'Invitations', to: '/invitations', icon: MailPlus },
  { label: 'Stories', to: '/stories', icon: BookOpen },
  { label: 'Vault', to: '/vault', icon: LockKeyhole },
  { label: 'AI Assistant', to: '/ai', icon: Bot },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export const agenticNavigationItems: NavigationItem[] = [
  { label: 'Guardian Angel', to: '/agentic/guardian-angel', icon: ShieldCheck },
  { label: 'UberCare', to: '/agentic/ubercare', icon: HeartHandshake },
  { label: 'Marketplace', to: '/agentic/marketplace', icon: Store },
]

/** Agentic Services run in COMMAND mode (green); everything else is Ask mode (blue). */
export function isCommandPath(pathname: string): boolean {
  return pathname === '/agentic' || pathname.startsWith('/agentic/')
}

function SidebarLink({ label, to, icon: Icon }: NavigationItem) {
  return (
    <NavLink
      end={to === '/'}
      to={to}
      aria-label={label}
      className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
    >
      <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  )
}

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

function defaultGetVersion(): Promise<string | null> {
  // Hosts without the desktop bridge (tests, previews) simply show no version.
  return window.familyCircle?.app?.getVersion() ?? Promise.resolve(null)
}

export function Sidebar({ getVersion = defaultGetVersion }: { getVersion?: () => Promise<string | null> } = {}) {
  const privateAi = useMemo(() => new DesktopPrivateAiClient(), [])
  const [aiState, setAiState] = useState<PrivateAiState | 'checking' | 'unavailable'>('checking')
  const [version, setVersion] = useState<string | null>(null)
  const modeLabel = isCommandPath(useLocation().pathname) ? 'Command mode' : 'Ask mode'

  useEffect(() => {
    let active = true
    void getVersion()
      .then((value) => { if (active) setVersion(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [getVersion])

  useEffect(() => {
    let active = true
    void privateAi.getStatus()
      .then((status) => {
        if (active) setAiState(status.state)
      })
      .catch(() => {
        if (active) setAiState('unavailable')
      })

    let unsubscribe: () => void = () => {}
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
        {/* Ask mode is the blue family workspace; Agentic Services switch to green Command mode. */}
        <span className="app-sidebar__mode" aria-label={`Current mode: ${modeLabel}`}>{modeLabel}</span>
      </div>

      <div className="app-sidebar__nav">
        <nav className="app-sidebar__group" aria-label="Primary navigation">
          {navigationItems.map((item) => <SidebarLink key={item.to} {...item} />)}
        </nav>
        <nav className="app-sidebar__group" aria-labelledby="agentic-services-heading">
          <h2 id="agentic-services-heading" className="app-sidebar__group-title">Agentic Services</h2>
          {agenticNavigationItems.map((item) => <SidebarLink key={item.to} {...item} />)}
        </nav>
      </div>

      <div className="ai-runtime-card" aria-label="Local AI status">
        <div className="ai-runtime-card__icon" aria-hidden="true">
          <Bot size={18} />
        </div>
        <div>
          <strong>Local AI</strong>
          <span className="ai-runtime-card__model">{PRIVATE_AI_MODELS.answers} · on this computer</span>
          <span className={`ai-runtime-card__status${aiReady ? ' ai-runtime-card__status--ready' : ''}`}>
            <i aria-hidden="true" /> {aiStatusLabel(aiState)}
          </span>
        </div>
      </div>
      {version ? <p className="app-sidebar__version">Family Circle v{version}</p> : null}
    </aside>
  )
}
