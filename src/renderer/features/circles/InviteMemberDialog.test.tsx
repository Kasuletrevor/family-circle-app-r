import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { INVITATION_FAMILY_ROLES, type InviteMemberResult } from '../../../shared/desktopApi'
import { AppServicesProvider } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import { InviteMemberDialog } from './InviteMemberDialog'

function service(inviteMember: CircleClient['inviteMember']): CircleClient {
  return {
    getHomeSnapshot: vi.fn(),
    getMyCircles: vi.fn(async () => []),
    getCircleDetails: vi.fn(async () => null),
    getShellSnapshot: vi.fn(async () => ({ activeCircleName: null, unreadNotifications: 0 })),
    selectCircle: vi.fn(async () => undefined),
    createCircle: vi.fn(async () => ({ circleId: 'circle-new' })),
    inviteMember,
    resendInvitation: vi.fn(async () => ({ outcome: 'sent' as const })),
    cancelInvitation: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    leaveCircle: vi.fn(async () => undefined),
  }
}

function renderDialog(inviteMember: CircleClient['inviteMember'], onInvited = vi.fn(async () => undefined)) {
  render(
    <AppServicesProvider services={{ circle: service(inviteMember) }}>
      <InviteMemberDialog
        open
        circleId="circle-a"
        circleName="Kasule Family"
        onClose={vi.fn()}
        onInvited={onInvited}
      />
    </AppServicesProvider>,
  )
  return { onInvited }
}

describe('InviteMemberDialog', () => {
  it('exposes exactly the descriptive family roles and never Circle owner', () => {
    renderDialog(vi.fn())

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([...INVITATION_FAMILY_ROLES])
    expect(options).not.toContain('Circle owner')
  })

  it('validates email locally and submits only business fields with duplicate-submit protection', async () => {
    let resolveInvite!: (value: InviteMemberResult) => void
    const inviteMember = vi.fn<CircleClient['inviteMember']>(() => new Promise((resolve) => { resolveInvite = resolve }))
    renderDialog(inviteMember)

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(inviteMember).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' Relative@Example.Test ' } })
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Sibling' } })
    const submit = screen.getByRole('button', { name: 'Send invitation' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(inviteMember).toHaveBeenCalledTimes(1)
    expect(inviteMember).toHaveBeenCalledWith({
      circleId: 'circle-a',
      email: 'relative@example.test',
      role: 'Sibling',
    })
    expect(submit).toBeDisabled()

    resolveInvite({ outcome: 'sent' })
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument()
  })

  it.each([
    ['sent', 'Invitation sent.'],
    ['already-pending', 'An invitation is already pending.'],
    ['already-member', 'This person is already a member.'],
    ['delivery-failed', 'The invitation was created, but email delivery failed.'],
  ] as const)('renders the normalized %s outcome safely', async (outcome, expected) => {
    const onInvited = vi.fn(async () => undefined)
    renderDialog(vi.fn(async () => ({ outcome })), onInvited)

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'relative@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(onInvited).toHaveBeenCalledWith(outcome)
  })

  it('shows the safe owner-specific authorization message when ownership changed', async () => {
    renderDialog(vi.fn(async () => { throw new Error('Only the Circle owner can invite members') }))

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'relative@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByText('Only the Circle owner can invite members.')).toBeInTheDocument()
  })

  it('does not reveal unexpected backend details', async () => {
    renderDialog(vi.fn(async () => { throw new Error('smtp secret upstream.internal') }))

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'relative@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByText("We couldn't send the invitation. Please try again.")).toBeInTheDocument()
    expect(screen.queryByText(/upstream\.internal/i)).not.toBeInTheDocument()
  })
})
