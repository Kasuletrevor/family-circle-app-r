type MetricCardProps = {
  label: string
  value: number
}

export function MetricCard({ label, value }: MetricCardProps) {
  return (
    <article className="metric-card" aria-label={`${label}: ${value}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
