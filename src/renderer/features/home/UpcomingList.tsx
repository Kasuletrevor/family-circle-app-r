import { CakeSlice, CalendarDays, Heart } from 'lucide-react'
import type { UpcomingItem } from '../../services/circle/types'

const icons = {
  birthday: CakeSlice,
  anniversary: Heart,
  gathering: CalendarDays,
} as const

export function UpcomingList({ items }: { items: UpcomingItem[] }) {
  return (
    <section className="home-card home-list-card" aria-labelledby="upcoming-heading">
      <div className="home-card__heading-row">
        <h2 id="upcoming-heading">Upcoming</h2>
        <button type="button" className="text-action">View all</button>
      </div>
      <div className="home-list">
        {items.map((item) => {
          const Icon = icons[item.kind]
          return (
            <article className="home-list__item" key={item.id}>
              <span className={`home-list__icon home-list__icon--${item.kind}`} aria-hidden="true">
                <Icon size={16} strokeWidth={1.9} />
              </span>
              <div>
                <strong>{item.title}</strong>
                <span>{item.when}</span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
