import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import { CreateCircleDialog } from './CreateCircleDialog'

function service(createCircle: CircleClient['createCircle']): CircleClient {
  return {
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => []),
    getCircleDetails: vi.fn(async () => null),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: null, unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle,
    inviteMember: vi.fn(async () => ({ outcome: 'sent' as const })),
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    leaveCircle: vi.fn(async () => undefined),
  }
}

function renderDialog(createCircle: CircleClient['createCircle'], props: Partial<ComponentProps<typeof CreateCircleDialog>> = {}) {
  const onClose = vi.fn()
  const onCreated = vi.fn(async () => undefined)
  render(
    <AppServicesProvider services={{ circle: service(createCircle) }}>
      <CreateCircleDialog open onClose={onClose} onCreated={onCreated} {...props} />
    </AppServicesProvider>,
  )
  return { onClose, onCreated }
}

describe('CreateCircleDialog', () => {
  it('validates required and maximum length locally before calling the service', () => {
    const createCircle = vi.fn<CircleClient['createCircle']>()
    renderDialog(createCircle)

    fireEvent.click(screen.getByRole('button', { name: 'Create Circle' }))
    expect(screen.getByText('Circle name is required.')).toBeInTheDocument()
    expect(createCircle).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Circle name'), { target: { value: 'A'.repeat(121) } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Circle' }))
    expect(screen.getByText('Circle name is too long.')).toBeInTheDocument()
    expect(createCircle).not.toHaveBeenCalled()
  })

  it('trims the name, blocks duplicate submit, and reports confirmed creation', async () => {
    let resolveCreate!: (value: { circleId: string }) => void
    const createCircle = vi.fn<CircleClient['createCircle']>(() => new Promise((resolve) => { resolveCreate = resolve }))
    const { onClose, onCreated } = renderDialog(createCircle)

    fireEvent.change(screen.getByLabelText('Circle name'), { target: { value: '  Kasule Family  ' } })
    const submit = screen.getByRole('button', { name: 'Create Circle' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(createCircle).toHaveBeenCalledTimes(1)
    expect(createCircle).toHaveBeenCalledWith({ name: 'Kasule Family' })
    expect(submit).toBeDisabled()

    resolveCreate({ circleId: 'circle-new' })
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('circle-new'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('maps known validation failures and generic failures safely without erasing input', async () => {
    const createCircle = vi
      .fn<CircleClient['createCircle']>()
      .mockRejectedValueOnce(new Error('Circle name is too long'))
      .mockRejectedValueOnce(new Error('socket secret: upstream.internal'))
    renderDialog(createCircle)

    const input = screen.getByLabelText('Circle name')
    fireEvent.change(input, { target: { value: 'Kasule Family' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Circle' }))
    expect(await screen.findByText('Circle name is too long.')).toBeInTheDocument()
    expect(input).toHaveValue('Kasule Family')

    fireEvent.click(screen.getByRole('button', { name: 'Create Circle' }))
    expect(await screen.findByText("We couldn't create the Circle. Please try again.")).toBeInTheDocument()
    expect(screen.queryByText(/upstream\.internal/i)).not.toBeInTheDocument()
    expect(input).toHaveValue('Kasule Family')
  })
})
