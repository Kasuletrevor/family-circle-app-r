import { useEffect, useRef, useState } from 'react'
import { ImagePlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { FamilyPerson } from '../../services/circle/types'
import { PersonAvatar, usePersonPhotos } from '../circles/PersonPhotos'

export function MemberDetailsPanel({ person }: { person: FamilyPerson }) {
  const photos = usePersonPhotos()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const hasPhoto = Boolean(photos.photoFor(person.id))
  const busy = photos.busyPersonId === person.id
  const message = photos.message?.personId === person.id ? photos.message.text : null

  // The menu belongs to one person; close it when another is selected or on an outside click.
  useEffect(() => { setMenuOpen(false) }, [person.id])
  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  return (
    <aside className="home-card member-panel" aria-labelledby="selected-member-heading">
      <div className="member-panel__topline">
        <div>
          <h2 id="selected-member-heading">{person.name}</h2>
          <span className="member-panel__online"><i aria-hidden="true" /> In your circle</span>
        </div>
        <button type="button" className="icon-button" aria-label="More member actions">
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="member-panel__portrait-wrap" ref={menuRef}>
        <PersonAvatar personId={person.id} initials={person.initials} className="member-panel__portrait" />
        {photos.available ? (
          <>
            <button
              type="button"
              className="member-panel__edit"
              aria-label={`Change photo of ${person.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="member-panel__photo-menu" role="menu" aria-label={`Photo of ${person.name}`}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void photos.choose(person.id)
                  }}
                >
                  <ImagePlus size={15} aria-hidden="true" /> {hasPhoto ? 'Choose a different photo…' : 'Choose photo…'}
                </button>
                {hasPhoto ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      void photos.remove(person.id)
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Remove photo
                  </button>
                ) : null}
                <p>Photos stay on this computer.</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {busy ? <p className="member-panel__photo-note" role="status">Saving photo…</p> : null}
      {message ? <p className="member-panel__photo-note member-panel__photo-note--error" role="alert">{message}</p> : null}

      <div className="member-panel__tabs" aria-label="Member detail sections">
        <button type="button" className="member-panel__tab member-panel__tab--active">Details</button>
        <button type="button" className="member-panel__tab">Relationships</button>
        <button type="button" className="member-panel__tab">Stories</button>
      </div>

      <dl className="member-panel__details">
        <div><dt>Full Name</dt><dd>{person.name}</dd></div>
        <div><dt>Role</dt><dd>{person.role}</dd></div>
        {person.birthYear && <div><dt>Year of Birth</dt><dd>{person.birthYear}</dd></div>}
        {person.email && <div><dt>Email</dt><dd>{person.email}</dd></div>}
        {person.phone && <div><dt>Phone</dt><dd>{person.phone}</dd></div>}
        {person.bio && <div><dt>About</dt><dd>{person.bio}</dd></div>}
      </dl>

      <button type="button" className="primary-action member-panel__profile-action">View Full Profile</button>
    </aside>
  )
}
