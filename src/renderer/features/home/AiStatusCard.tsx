import { Bot, LockKeyhole } from 'lucide-react'

export function AiStatusCard() {
  return (
    <section className="home-card ai-status-card" aria-label="Private AI status">
      <span className="ai-status-card__icon" aria-hidden="true"><Bot size={17} /></span>
      <div>
        <strong>Private AI is ready</strong>
        <span><LockKeyhole size={12} aria-hidden="true" /> Your family context stays on this computer.</span>
      </div>
    </section>
  )
}
