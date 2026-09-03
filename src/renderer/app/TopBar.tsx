import { useEffect, useMemo, useState } from 'react'
import { Bell, ChevronDown, Search } from 'lucide-react'
import type { AuthUser } from '../../shared/desktopApi'
import type { ShellSnapshot } from '../services/circle/types'
import { useAppServices } from './services'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function TopBar({ user }: { user: AuthUser }) {
  const { circle } = useAppServices()
  const [shell, setShell] = useState<ShellSnapshot | null>(null)

  useEffect(() => {
    let active = true
    void circle.getShellSnapshot()
      .then((next) => {
        if (active) setShell(next)
      })
      .catch(() => {
        if (active) setShell({ activeCircleName: null, unreadNotifications: 0 })
      })
    return () => { active = false }
  }, [circle])

  const displayName = user.name.trim() || user.email
  const profileInitials = useMemo(() => initials(displayName), [displayName])
  const activeCircleName = shell?.activeCircleName ?? null
  const circleLabel = shell === null ? 'Loading Circle…' : activeCircleName || 'No Circle yet'
  const circleInitial = activeCircleName?.trim().charAt(0).toUpperCase() || '+'
  const unreadNotifications = shell?.unreadNotifications ?? 0
  const notificationLabel = unreadNotifications > 0
    ? `Notifications, ${unreadNotifications} unread`
    : 'Notifications'

  return (
    <header className="top-bar">
      <button className="circle-switcher" type="button" aria-label="Select active family circle">
        <span className="circle-switcher__mark">{circleInitial}</span>
        <span>{circleLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <label className="global-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search Family Circle</span>
        <input
          type="search"
          aria-label="Search Family Circle"
          placeholder="Search people, stories, documents…"
        />
        <kbd>Ctrl + K</kbd>
      </label>

      <div className="top-bar__actions">
        <button className="icon-button notification-button" type="button" aria-label={notificationLabel}>
          <Bell size={19} aria-hidden="true" />
          {unreadNotifications > 0 ? (
            <span className="notification-button__badge">{unreadNotifications}</span>
          ) : null}
        </button>

        <button className="profile-button" type="button" aria-label="Open user menu">
          <span className="profile-button__avatar">{profileInitials}</span>
          <span className="profile-button__copy">
            <strong>{displayName}</strong>
            <small><i aria-hidden="true" /> Private session</small>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
