import { Bell, ChevronDown, Search } from 'lucide-react'

export function TopBar() {
  return (
    <header className="top-bar">
      <button className="circle-switcher" type="button" aria-label="Select active family circle">
        <span className="circle-switcher__mark">K</span>
        <span>Kasule Family</span>
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
        <button className="icon-button notification-button" type="button" aria-label="Notifications">
          <Bell size={19} aria-hidden="true" />
          <span className="notification-button__badge">2</span>
        </button>

        <button className="profile-button" type="button" aria-label="Open user menu">
          <span className="profile-button__avatar">TK</span>
          <span className="profile-button__copy">
            <strong>Trevor Kasule</strong>
            <small><i aria-hidden="true" /> Private session</small>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
