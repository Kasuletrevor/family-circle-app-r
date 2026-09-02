import { BookOpen, Network, RefreshCw, UserRoundCheck } from 'lucide-react'
import type { ActivityItem } from '../../services/circle/types'

const icons = {
  invitation: UserRoundCheck,
  relationship: Network,
  story: BookOpen,
  tree: RefreshCw,
} as const

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <section className="home-card home-list-card" aria-labelledby="activity-heading">
      <div className="home-card__heading-row">
        <h2 id="activity-heading">Recent activity</h2>
      </div>
      <div className="home-list home-list--activity">
        {items.map((item) => {
          const Icon = icons[item.kind]
          return (
            <article className="home-list__item" key={item.id}>
              <span className="home-list__icon home-list__icon--activity" aria-hidden="true">
                <Icon size={15} strokeWidth={1.9} />
              </span>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <small>{item.when}</small>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
