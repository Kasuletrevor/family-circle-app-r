import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VaultDeleteDialog } from './VaultDeleteDialog'

describe('VaultDeleteDialog', () => {
  it('uses explicit local-deletion copy and requires a deliberate confirmation', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <VaultDeleteDialog
        open
        fileName="Family History.pdf"
        deleting={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Delete Family History.pdf?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the local file and its Vault data from this computer.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
