import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmCircleActionDialog } from './ConfirmCircleActionDialog'

describe('ConfirmCircleActionDialog', () => {
  it('does not mutate until confirmed and Cancel closes without mutation', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn(async () => undefined)
    render(
      <ConfirmCircleActionDialog
        open
        title="Leave Kasule Family?"
        message="You will lose access to this Circle."
        confirmLabel="Leave Circle"
        busyLabel="Leaving…"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('blocks duplicate confirmations while the destructive operation is in flight', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    const onConfirm = vi.fn(() => pending)
    render(
      <ConfirmCircleActionDialog
        open
        title="Remove John?"
        message="John will lose access to this Circle."
        confirmLabel="Remove member"
        busyLabel="Removing…"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'Remove member' })
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Removing…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Removing…' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    resolve()
  })

  it('renders nothing while closed', () => {
    render(
      <ConfirmCircleActionDialog
        open={false}
        title="Remove John?"
        message="John will lose access to this Circle."
        confirmLabel="Remove member"
        busyLabel="Removing…"
        onCancel={vi.fn()}
        onConfirm={vi.fn(async () => undefined)}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
