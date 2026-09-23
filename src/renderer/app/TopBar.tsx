import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Check, ChevronDown, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AuthUser, CircleNotificationRecord } from '../../shared/desktopApi'
import type { CircleSummary, ShellSnapshot } from '../services/circle/types'
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
  const [circleMenuOpen, setCircleMenuOpen] = useState(false)
  const [circles, setCircles] = useState<CircleSummary[]>([])
  const [circleMenuError, setCircleMenuError] = useState<string | null>(null)
  const [switchingCircleId, setSwitchingCircleId] = useState<string | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<CircleNotificationRecord[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  const loadShell = useCallback(async () => {
    try {
      setShell(await circle.getShellSnapshot())
    } catch {
      setShell({ activeCircleName: null, unreadNotifications: 0 })
    }
  }, [circle])

  useEffect(() => {
    void loadShell()
  }, [loadShell])

  const displayName = String(user.name ?? '').trim() || user.email
  const profileInitials = useMemo(() => initials(displayName), [displayName])
  const activeCircleName = shell?.activeCircleName ?? null
  const circleLabel = shell === null ? 'Loading Circle…' : activeCircleName || 'No Circle yet'
  const circleInitial = activeCircleName?.trim().charAt(0).toUpperCase() || '+'
  const unreadNotifications = shell?.unreadNotifications ?? 0
  const notificationLabel = unreadNotifications > 0
    ? `Notifications, ${unreadNotifications} unread`
    : 'Notifications'

  async function toggleCircleMenu() {
    const opening = !circleMenuOpen
    setCircleMenuOpen(opening)
    setNotificationsOpen(false)
    setProfileMenuOpen(false)
    setCircleMenuError(null)
    if (!opening) return
    try {
      setCircles(await circle.getMyCircles())
    } catch {
      setCircles([])
      setCircleMenuError('Could not load your family circles.')
    }
  }

  async function chooseCircle(circleId: string) {
    setSwitchingCircleId(circleId)
    setCircleMenuError(null)
    try {
      await circle.selectCircle(circleId)
      await loadShell()
      setCircles(await circle.getMyCircles())
      setCircleMenuOpen(false)
      navigate('/circles')
    } catch {
      setCircleMenuError('Could not switch family circles. Please try again.')
    } finally {
      setSwitchingCircleId(null)
    }
  }

  async function toggleNotifications() {
    const opening = !notificationsOpen
    setNotificationsOpen(opening)
    setCircleMenuOpen(false)
    setProfileMenuOpen(false)
    setNotificationsError(null)
    if (!opening) return

    setNotificationsLoading(true)
    try {
      const overview = await circle.getOverview()
      setNotifications(overview.notifications)
      if (overview.notifications.some((notification) => !notification.read)) {
        await circle.markNotificationsRead()
        setNotifications((items) => items.map((item) => ({ ...item, read: true })))
        setShell((current) => current ? { ...current, unreadNotifications: 0 } : current)
      }
    } catch {
      setNotifications([])
      setNotificationsError('Could not load notifications.')
    } finally {
      setNotificationsLoading(false)
    }
  }

  return (
    <header className="top-bar">
      <div className="circle-menu">
        <button
          className="circle-switcher"
          type="button"
          aria-label="Choose active family circle"
          aria-haspopup="menu"
          aria-expanded={circleMenuOpen}
          onClick={() => void toggleCircleMenu()}
        >
          <span className="circle-switcher__mark">{circleInitial}</span>
          <span>{circleLabel}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>

        {circleMenuOpen ? (
          <div className="circle-menu__popover" role="menu" aria-label="Family circles">
            <div className="circle-menu__heading">Switch family circle</div>
            {circles.length === 0 && !circleMenuError ? <p>No family circles yet.</p> : null}
            {circles.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={switchingCircleId !== null}
                className="circle-menu__item"
                onClick={() => void chooseCircle(item.id)}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.role || 'Family member'}</small>
                </span>
                {item.isActive ? <Check size={16} aria-label="Active circle" /> : null}
              </button>
            ))}
            {circleMenuError ? <p className="topbar-menu__error" role="alert">{circleMenuError}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="top-bar__actions">
        <div className="notification-menu">
          <button
            className="icon-button notification-button"
            type="button"
            aria-label={notificationLabel}
            aria-haspopup="menu"
            aria-expanded={notificationsOpen}
            onClick={() => void toggleNotifications()}
          >
            <Bell size={19} aria-hidden="true" />
            {unreadNotifications > 0 ? (
              <span className="notification-button__badge">{unreadNotifications}</span>
            ) : null}
          </button>

          {notificationsOpen ? (
            <div className="notification-menu__popover" role="menu" aria-label="Notifications">
              <div className="notification-menu__heading">
                <strong>Notifications</strong>
                <span>{notifications.length} recent</span>
              </div>
              {notificationsLoading ? <p>Loading notifications…</p> : null}
              {!notificationsLoading && notifications.length === 0 && !notificationsError ? (
                <p>No notifications yet.</p>
              ) : null}
              {!notificationsLoading ? notifications.slice(0, 8).map((notification) => (
                <div className="notification-menu__item" role="menuitem" key={notification.id}>
                  <strong>{notification.title}</strong>
                  {notification.message ? <span>{notification.message}</span> : null}
                  {notification.groupName ? <small>{notification.groupName}</small> : null}
                </div>
              )) : null}
              {notificationsError ? <p className="topbar-menu__error" role="alert">{notificationsError}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="profile-menu">
          <button
            className="profile-button"
            type="button"
            aria-label="Open user menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => {
              setProfileMenuOpen((open) => !open)
              setCircleMenuOpen(false)
              setNotificationsOpen(false)
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
