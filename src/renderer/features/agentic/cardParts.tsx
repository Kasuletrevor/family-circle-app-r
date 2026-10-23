import { ShieldCheck } from 'lucide-react'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('')
}

export function CardAvatar({ name, avatar }: { name: string; avatar: string | null }) {
  return avatar
    ? <img className="ga-card__avatar" src={avatar} alt="" draggable={false} />
    : <span className="ga-card__avatar" aria-hidden="true">{initials(name)}</span>
}

/** The trust boundaries and escalation triggers of a template or angel, as plain sentences. */
export function SafetyRules({ trustBoundaries, escalationTriggers }: { trustBoundaries: string[]; escalationTriggers: string[] }) {
  const count = trustBoundaries.length + escalationTriggers.length
  if (count === 0) return null
  return (
    <details className="ga-card__rules">
      <summary><ShieldCheck size={15} aria-hidden="true" /> Safety rules ({count})</summary>
      {trustBoundaries.length > 0 ? (
        <>
          <h4>Stays within</h4>
          <ul>{trustBoundaries.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        </>
      ) : null}
      {escalationTriggers.length > 0 ? (
        <>
          <h4>Alerts the family about</h4>
          <ul>{escalationTriggers.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        </>
      ) : null}
    </details>
  )
}
