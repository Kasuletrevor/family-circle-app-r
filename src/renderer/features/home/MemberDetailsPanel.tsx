import { MoreHorizontal, Pencil } from 'lucide-react'
import type { FamilyPerson } from '../../services/circle/types'

export function MemberDetailsPanel({ person }: { person: FamilyPerson }) {
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

      <div className="member-panel__portrait-wrap">
        <div className="member-panel__portrait" aria-hidden="true">{person.initials}</div>
        <button type="button" className="member-panel__edit" aria-label="Edit member photo">
          <Pencil size={13} aria-hidden="true" />
        </button>
      </div>

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
