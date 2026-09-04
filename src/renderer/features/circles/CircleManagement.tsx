import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppServices } from '../../app/services'
import type { CircleManagementSnapshot } from '../../services/circle/types'
import { ConfirmCircleActionDialog } from './ConfirmCircleActionDialog'
import { InviteMemberDialog } from './InviteMemberDialog'
import './CircleManagement.css'

type LoadState =
  | { status: 'loading'; details: CircleManagementSnapshot | null }
  | { status: 'ready'; details: CircleManagementSnapshot | null }
  | { status: 'error'; details: CircleManagementSnapshot | null }

type Notice = { kind: 'status' | 'error'; text: string }

type PendingAction =
  | { kind: 'remove'; personId: string; name: string }
  | { kind: 'cancel'; personId: string; email: string }
  | { kind: 'leave' }

const STALE_CIRCLE_MESSAGE = 'That Circle is no longer available to your account'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function isStaleCircleError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_CIRCLE_MESSAGE)
}

function managementErrorMessage(error: unknown, fallback = "We couldn't update the Circle. Please try again."): string {
  const message = error instanceof Error ? error.message : ''
  const known = [
    'Only the Circle owner can manage invitations',
    'Only the Circle owner can remove members',
    'The Circle owner cannot be removed',
    'Circle owners cannot leave their own Circle',
    'That member is no longer in this Circle',
    'That invitation is no longer pending',
    STALE_CIRCLE_MESSAGE,
  ]
  const matched = known.find((candidate) => message.includes(candidate))
  return matched ? `${matched}.` : fallback
}

export function CircleManagement({ initialSection }: { initialSection: 'members' | 'invitations' }) {
  const { circle } = useAppServices()
  const navigate = useNavigate()
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading', details: null })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [resendingPersonId, setResendingPersonId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState((current) => ({ status: 'loading', details: current.details }))
    void circle.getCircleDetails().then(
      (details) => {
        if (!cancelled) setLoadState({ status: 'ready', details })
      },
      () => {
        if (!cancelled) setLoadState((current) => ({ status: 'error', details: current.details }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [circle, reloadVersion])

  const details = loadState.details
  const isOwner = useMemo(() => {
    if (!details) return false
    return details.members.find((member) => member.isViewer)?.isOwner
      ?? details.circle.role === 'Circle owner'
  }, [details])

  async function resend(personId: string): Promise<void> {
    if (resendingPersonId) return
    setResendingPersonId(personId)
    setNotice(null)
    try {
      const result = await circle.resendInvitation(personId)
      if (result.outcome === 'sent') {
        setNotice({ kind: 'status', text: 'Invitation resent.' })
        setReloadVersion((value) => value + 1)
      } else {
        setNotice({ kind: 'error', text: "We couldn't resend the invitation. Please try again." })
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        text: managementErrorMessage(error, "We couldn't resend the invitation. Please try again."),
      })
      if (isStaleCircleError(error)) setReloadVersion((value) => value + 1)
    } finally {
      setResendingPersonId(null)
    }
  }

  async function confirmPendingAction(): Promise<void> {
    const action = pendingAction
    if (!action) return
    setNotice(null)

    try {
      if (action.kind === 'remove') {
        await circle.removeMember(action.personId)
        setPendingAction(null)
        setNotice({ kind: 'status', text: `${action.name} was removed from the Circle.` })
        setReloadVersion((value) => value + 1)
        return
      }

      if (action.kind === 'cancel') {
        await circle.cancelInvitation(action.personId)
        setPendingAction(null)
        setNotice({ kind: 'status', text: 'Invitation cancelled.' })
        setReloadVersion((value) => value + 1)
        return
      }

      await circle.leaveCircle()
      setPendingAction(null)
      navigate('/circles')
    } catch (error) {
      setPendingAction(null)
      setNotice({ kind: 'error', text: managementErrorMessage(error) })
      if (isStaleCircleError(error)) setReloadVersion((value) => value + 1)
    }
  }

  if (loadState.status === 'loading' && !details) {
    return <section className="circle-management__state" role="status">Loading Circle details…</section>
  }

  if (loadState.status === 'error') {
    return (
      <section className="circle-management__state circle-management__state--error" role="alert">
        <h1>We couldn't load this Circle. Please try again.</h1>
        <button type="button" className="circle-management__secondary" onClick={() => setReloadVersion((value) => value + 1)}>
          Try again
        </button>
      </section>
    )
  }

  if (!details) {
    return (
      <section className="circle-management__state circle-management__state--empty">
        <h1>Choose a Circle</h1>
        <p>Select the family space you want to manage first.</p>
        <Link className="circle-management__primary" to="/circles">Go to My Circles</Link>
      </section>
    )
  }

  const confirmation = pendingAction?.kind === 'remove'
    ? {
        title: `Remove ${pendingAction.name} from ${details.circle.name}?`,
        message: 'They will lose access to this Circle and their shared family-tree relationships may be removed.',
        confirmLabel: 'Remove member',
        busyLabel: 'Removing…',
      }
    : pendingAction?.kind === 'cancel'
      ? {
          title: `Cancel invitation to ${pendingAction.email}?`,
          message: 'This pending invitation will be cancelled. You can invite this person again later.',
          confirmLabel: 'Cancel invitation',
          busyLabel: 'Cancelling…',
        }
      : pendingAction?.kind === 'leave'
        ? {
            title: `Leave ${details.circle.name}?`,
            message: 'You will lose access to its members, relationships and shared family tree. Your account and private information remain.',
            confirmLabel: 'Leave Circle',
            busyLabel: 'Leaving…',
          }
        : null

  return (
    <>
      <section className="circle-management" aria-labelledby="circle-management-title">
        <header className="circle-management__header">
          <div>
            <p className="circle-management__eyebrow">Circle management</p>
            <h1 id="circle-management-title">{details.circle.name}</h1>
            <p className="circle-management__role">{details.circle.role}</p>
            <p className="circle-management__counts">
              {plural(details.circle.memberCount, 'member', 'members')} · {' '}
              {plural(details.circle.pendingInvitationCount, 'pending invitation', 'pending invitations')}
            </p>
          </div>
          {isOwner ? (
            <button className="circle-management__primary" type="button" onClick={() => setInviteOpen(true)}>
              Invite member
            </button>
          ) : null}
        </header>

        <nav className="circle-management__tabs" aria-label="Circle management sections">
          <Link className={initialSection === 'members' ? 'is-active' : ''} to="/members">Members</Link>
          <Link className={initialSection === 'invitations' ? 'is-active' : ''} to="/invitations">Invitations</Link>
        </nav>

        {notice ? (
          <div className="circle-management__notice" role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
          </div>
        ) : null}

        <div className={`circle-management__panel${initialSection === 'members' ? ' is-primary' : ''}`}>
          <div className="circle-management__section-head">
            <div>
              <h2>Members</h2>
              <p>People who currently belong to this Circle.</p>
            </div>
          </div>
          <div className="circle-management__list">
            {details.members.map((member) => (
              <article className="circle-management__row" key={member.personId}>
                <div className="circle-management__avatar" aria-hidden="true">{member.name.trim().charAt(0).toUpperCase() || 'K'}</div>
                <div className="circle-management__row-copy">
                  <div className="circle-management__name-line">
                    <h3>{member.name}</h3>
                    {member.isViewer ? <span>You</span> : null}
                    {member.isOwner ? <span>Circle owner</span> : null}
                  </div>
                  <p>{member.email ?? 'No shared email'}</p>
                  <small>{member.role}</small>
                </div>
                {isOwner && !member.isOwner ? (
                  <button
                    className="circle-management__danger-link"
                    type="button"
                    aria-label={`Remove ${member.name}`}
                    onClick={() => setPendingAction({ kind: 'remove', personId: member.personId, name: member.name })}
                  >
                    Remove
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        <div className={`circle-management__panel${initialSection === 'invitations' ? ' is-primary' : ''}`}>
          <div className="circle-management__section-head">
            <div>
              <h2>Pending invitations</h2>
              <p>Invitations that have not been claimed yet.</p>
            </div>
          </div>
          {details.invitations.length === 0 ? (
            <div className="circle-management__empty-list">No pending invitations.</div>
          ) : (
            <div className="circle-management__list">
              {details.invitations.map((invitation) => (
                <article className="circle-management__row" key={invitation.personId}>
                  <div className="circle-management__avatar" aria-hidden="true">@</div>
                  <div className="circle-management__row-copy">
                    <h3>{invitation.email}</h3>
                    <p>{invitation.role}</p>
                    <small>Pending</small>
                  </div>
                  {isOwner ? (
                    <div className="circle-management__row-actions">
                      <button
                        type="button"
                        className="circle-management__secondary"
                        disabled={resendingPersonId !== null}
                        aria-label={`Resend invitation to ${invitation.email}`}
                        onClick={() => void resend(invitation.personId)}
                      >
                        {resendingPersonId === invitation.personId ? 'Resending…' : 'Resend'}
                      </button>
                      <button
                        type="button"
                        className="circle-management__danger-link"
                        aria-label={`Cancel invitation to ${invitation.email}`}
                        onClick={() => setPendingAction({ kind: 'cancel', personId: invitation.personId, email: invitation.email })}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        {!isOwner ? (
          <section className="circle-management__membership">
            <div>
              <h2>Circle membership</h2>
              <p>Leaving removes your access to this Circle while keeping your private account data.</p>
            </div>
            <button className="circle-management__danger" type="button" onClick={() => setPendingAction({ kind: 'leave' })}>
              Leave Circle
            </button>
          </section>
        ) : null}
      </section>

      <InviteMemberDialog
        open={inviteOpen}
        circleId={details.circle.id}
        circleName={details.circle.name}
        onClose={() => setInviteOpen(false)}
        onInvited={() => setReloadVersion((value) => value + 1)}
      />

      <ConfirmCircleActionDialog
        open={confirmation !== null}
        title={confirmation?.title ?? ''}
        message={confirmation?.message ?? ''}
        confirmLabel={confirmation?.confirmLabel ?? ''}
        busyLabel={confirmation?.busyLabel ?? ''}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </>
  )
}
