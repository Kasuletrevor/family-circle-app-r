import { useState } from 'react'
import type { StoryMediaPublicItem, StoryMediaType } from '../../../shared/desktopApi'
import type { StoryFieldKey } from '../../../shared/story'

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(sizeBytes % 1024 === 0 ? 0 : 1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function StoryMedia({
  fieldKey,
  items,
  onAdd,
  onOpen,
  onDelete,
}: {
  fieldKey: StoryFieldKey
  items: StoryMediaPublicItem[]
  onAdd(fieldKey: StoryFieldKey, mediaType: StoryMediaType): Promise<void>
  onOpen(mediaId: number): Promise<void>
  onDelete(mediaId: number): Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)

  async function perform(key: string, operation: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setError(false)
    try {
      await operation()
    } catch {
      setError(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="my-story__media" aria-label="Memory attachments">
      <div className="my-story__media-toolbar">
        <span>Private attachments</span>
        <div>
          <button type="button" disabled={busy !== null} onClick={() => void perform('add-photo', () => onAdd(fieldKey, 'photo'))}>
            {busy === 'add-photo' ? 'Adding photo…' : 'Add photo'}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void perform('add-audio', () => onAdd(fieldKey, 'audio'))}>
            {busy === 'add-audio' ? 'Adding audio…' : 'Add audio'}
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="my-story__media-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.fileName}</strong>
                <span>{item.mediaType === 'photo' ? 'Photo' : 'Audio'} · {formatBytes(item.sizeBytes)}</span>
              </div>
              <div className="my-story__media-actions">
                <button
                  type="button"
                  aria-label={`Open ${item.fileName}`}
                  disabled={busy !== null}
                  onClick={() => void perform(`open-${item.id}`, () => onOpen(item.id))}
                >
                  Open
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${item.fileName}`}
                  disabled={busy !== null}
                  onClick={() => void perform(`delete-${item.id}`, () => onDelete(item.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert">That attachment action could not be completed. Try again.</p>}
    </section>
  )
}
