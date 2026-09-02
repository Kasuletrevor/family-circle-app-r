type PlaceholderPageProps = {
  title: string
  description?: string
}

export function PlaceholderPage({
  title,
  description = 'This feature will be migrated from the current Family Circle application in a later slice.',
}: PlaceholderPageProps) {
  return (
    <section className="placeholder-page" aria-labelledby="page-title">
      <div className="placeholder-page__eyebrow">Family Circle</div>
      <h1 id="page-title">{title}</h1>
      <p>{description}</p>
      <div className="placeholder-page__card">
        <strong>Clean migration boundary</strong>
        <span>Existing behaviour stays available while this area moves into the rebuilt application.</span>
      </div>
    </section>
  )
}
