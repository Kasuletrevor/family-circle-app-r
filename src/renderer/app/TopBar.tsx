import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut } from 'lucide-react'
import type { AuthUser } from '../../shared/desktopApi'
import type { ShellSnapshot } from '../services/circle/types'
import { useAppServices } from './services'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function TopBar({ user, onSignOut }: { user: AuthUser; onSignOut: () => Promise<void> }) {
  const { circle } = useAppServices()
  const navigate = useNavigate()
  const [shell, setShell] = useState<ShellSnapshot | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

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

  const displayName = String(user.name ?? '').trim() || user.email
  const profileInitials = useMemo(() => initials(displayName), [displayName])
  const activeCircleName = shell?.activeCircleName ?? null
  const circleLabel = shell === null ? 'Loading Circle…' : activeCircleName || 'No Circle yet'
  const circleInitial = activeCircleName?.trim().charAt(0).toUpperCase() || '+'

  return (
    <header className="top-bar">
      <button
        className="circle-switcher"
        type="button"
        aria-label="Choose active family circle"
        onClick={() => navigate('/circles')}
      >
        <span className="circle-switcher__mark">{circleInitial}</span>
        <span>{circleLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <div className="top-bar__actions">
        <div className="profile-menu">
          <button
            className="profile-button"
            type="button"
            aria-label="Open user menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => {
              setProfileMenuOpen((open) => !open)
              setSignOutError(null)
            }}
          >
            <span className="profile-button__avatar">{profileInitials}</span>
            <span className="profile-button__copy">
              <strong>{displayName}</strong>
              <small><i aria-hidden="true" /> Private session</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>

          {profileMenuOpen ? (
            <div className="profile-menu__popover" role="menu" aria-label="User menu">
              <div className="profile-menu__identity">
                <strong>{displayName}</strong>
                <span>{user.email}</span>
              </div>
              <button
                className="profile-menu__logout"
                type="button"
                role="menuitem"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true)
                  setSignOutError(null)
                  try {
                    await onSignOut()
                  } catch {
                    setSignOutError('Could not log out. Please try again.')
                    setSigningOut(false)
                  }
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                <span>{signingOut ? 'Logging out…' : 'Log out'}</span>
              </button>
              {signOutError ? <p className="profile-menu__error" role="alert">{signOutError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
