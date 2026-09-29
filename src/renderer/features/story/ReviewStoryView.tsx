import { useMemo, useState } from 'react'
import type { StoryMediaPublicItem } from '../../../shared/desktopApi'
import { STORY_FIELDS, type StoryFieldKey, type StorySection } from '../../../shared/story'
import type { StoryPublicState } from '../../../shared/storyPublic'

const SECTION_ORDER: readonly StorySection[] = [
  'Identity',
  'Everyday Life',
  'Life Story',
  'People & Places',
  'Values & Wishes',
  'Care & Future',
]

export function ReviewStoryView({
  story,
  media,
  onEdit,
}: {
  story: StoryPublicState
  media: StoryMediaPublicItem[]
  onEdit(fieldKey: StoryFieldKey): void
}) {
  const [filter, setFilter] = useState('')
  const normalizedFilter = filter.trim().toLowerCase()
  const populated = useMemo(() => story.answers.filter((answer) => {
    if (!answer.answer.trim()) return false
    if (!normalizedFilter) return true
    return [answer.section, answer.label, answer.question, answer.answer]
      .some((value) => value.toLowerCase().includes(normalizedFilter))
  }), [normalizedFilter, story.answers])

  return (
    <section className="my-story__review" aria-label="Review My Story">
      <div className="my-story__review-toolbar">
        <div>
          <h2>Review</h2>
          <p>Read your words exactly as you saved them. Nothing here is rewritten.</p>
        </div>
        <label>
          <span>Filter memories</span>
          <input
            type="search"
            aria-label="Filter memories"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search your memories"
          />
        </label>
      </div>

      {populated.length === 0 ? (
        <p className="my-story__empty">No memories match this filter.</p>
      ) : SECTION_ORDER.map((section) => {
        const sectionAnswers = populated.filter((answer) => answer.section === section)
        if (sectionAnswers.length === 0) return null
        return (
          <section className="my-story__review-section" key={section}>
            <h2>{section}</h2>
            {sectionAnswers.map((answer) => {
              const definition = STORY_FIELDS.find((field) => field.key === answer.fieldKey)
              const attachments = media.filter((item) => item.fieldKey === answer.fieldKey)
              return (
                <article className="my-story__review-memory" key={answer.fieldKey}>
                  <div className="my-story__memory-heading">
                    <div>
                      <h3>{answer.label}</h3>
                      <p className="my-story__prompt">{definition?.prompt ?? answer.question}</p>
                    </div>
                    <span className={`my-story__state ${answer.confirmed ? 'my-story__state--confirmed' : ''}`}>
                      {answer.confirmed ? 'Confirmed' : 'Draft'}
                    </span>
                  </div>
                  <p className="my-story__review-text">{answer.answer}</p>
                  {attachments.length > 0 && (
                    <ul className="my-story__review-attachments" aria-label={`Attachments for ${answer.label}`}>
                      {attachments.map((item) => <li key={item.id}>{item.fileName}</li>)}
                    </ul>
                  )}
                  <button type="button" onClick={() => onEdit(answer.fieldKey)}>
                    Edit {answer.label}
                  </button>
                </article>
              )
            })}
          </section>
        )
      })}
    </section>
  )
}
