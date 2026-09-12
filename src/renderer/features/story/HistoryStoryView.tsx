import { useMemo, useRef, useState } from 'react'
import type { StoryVersionSummary } from '../../../shared/storyPublic'
import { ConfirmCircleActionDialog } from '../circles/ConfirmCircleActionDialog'

export function HistoryStoryView({
  versions,
  loading,
  error,
  onRestore,
}: {
  versions: StoryVersionSummary[]
  loading: boolean
  error: boolean
  onRestore(versionId: number): Promise<void>
}) {
  const [restoreTarget, setRestoreTarget] = useState<StoryVersionSummary | null>(null)
  const [restoreError, setRestoreError] = useState(false)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const ordered = useMemo(
    () => [...versions].sort((left, right) => right.createdAt - left.createdAt || right.versionId - left.versionId),
    [versions],
  )

  function returnFocus() {
    const target = restoreFocus.current
    restoreFocus.current = null
    queueMicrotask(() => target?.focus())
  }

  function cancelRestore() {
    setRestoreTarget(null)
    setRestoreError(false)
    returnFocus()
  }

  async function confirmRestore() {
    if (!restoreTarget) return
    const versionId = restoreTarget.versionId
    setRestoreError(false)
    try {
      await onRestore(versionId)
      setRestoreTarget(null)
      returnFocus()
    } catch {
      setRestoreError(true)
    }
  }

  return (
    <section className="my-story__history" aria-label="My Story history">
      <div>
        <h2>History</h2>
        <p>Restore an earlier semantic version of My Story. Your current Story is preserved first when it is materially different.</p>
      </div>

      {loading && <p>Loading Story history…</p>}
      {error && <p role="alert">Story history could not be loaded. Try again.</p>}
      {restoreError && (
        <p role="alert">That Story version could not be restored. Your current Story was not changed. Try again.</p>
      )}
      {!loading && !error && ordered.length === 0 && <p className="my-story__empty">No saved Story versions yet.</p>}

      <div className="my-story__history-list">
        {ordered.map((version) => (
          <article className="my-story__history-card" key={version.versionId}>
            <div>
              <h3>Version {version.versionId}</h3>
              <p>{new Date(version.createdAt).toLocaleString()}</p>
              <p>{version.confirmedCount} confirmed memories</p>
            </div>
            <button
              type="button"
              aria-label={`Restore version ${version.versionId}`}
              onClick={(event) => {
                restoreFocus.current = event.currentTarget
                setRestoreError(false)
                setRestoreTarget(version)
              }}
            >
              Restore
            </button>
          </article>
        ))}
      </div>

      <ConfirmCircleActionDialog
        open={restoreTarget !== null}
        title="Restore this Story version?"
        message="Your current Story will be preserved first when it is materially different. The selected version will then become your current private Story."
        confirmLabel="Restore version"
        busyLabel="Restoring…"
        onCancel={cancelRestore}
        onConfirm={confirmRestore}
      />
    </section>
  )
}
