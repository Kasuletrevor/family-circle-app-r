import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryStoryView } from './HistoryStoryView'

describe('HistoryStoryView', () => {
  it('keeps restore retryable and shows only a safe error when restore fails', async () => {
    const onRestore = vi.fn(async () => {
      throw new Error('C:\\private\\family.db SQLITE_BUSY version=91')
    })

    render(
      <HistoryStoryView
        versions={[{ versionId: 91, createdAt: 2_000, confirmedCount: 4 }]}
        loading={false}
        error={false}
        onRestore={onRestore}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Restore version 91' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(91))
    expect(screen.getByRole('dialog', { name: 'Restore this Story version?' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('That Story version could not be restored. Your current Story was not changed. Try again.')
    expect(screen.queryByText(/family\.db|SQLITE_BUSY|version=91/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
