import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppServicesProvider } from '../../app/services'
import type { CircleClient } from '../../services/circle/CircleClient'
import type { PersonPhotoClient } from '../../services/circle/PersonPhotoClient'
import type { FamilyPerson } from '../../services/circle/types'
import { MemberDetailsPanel } from '../home/MemberDetailsPanel'
import { PersonAvatar, PersonPhotosProvider } from './PersonPhotos'

const GRANDMA = 'data:image/jpeg;base64,R1JBTkRNQQ=='
const NEW_PHOTO = 'data:image/jpeg;base64,TkVX'

const rose: FamilyPerson = {
  id: 'user:rose',
  name: 'Rose Nakato',
  role: 'Grandmother',
  initials: 'RN',
  kind: 'member',
  generation: 0,
}

function circleClient() {
  const listeners = new Set<() => void>()
  const client = {
    onChange: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  } as unknown as CircleClient
  return { client, notify: () => listeners.forEach((listener) => listener()) }
}

function photoClient(overrides: Partial<PersonPhotoClient> = {}): PersonPhotoClient {
  return {
    listPhotos: vi.fn(async () => ({})),
    choosePhoto: vi.fn(async (personId: string) => ({ status: 'saved' as const, personId, dataUrl: NEW_PHOTO })),
    removePhoto: vi.fn(async () => undefined),
    ...overrides,
  }
}

function renderPanel(photos: PersonPhotoClient | undefined, circle = circleClient()) {
  render(
    <AppServicesProvider services={{ circle: circle.client, photos }}>
      <PersonPhotosProvider>
        <MemberDetailsPanel person={rose} />
        <PersonAvatar personId={rose.id} initials="RN" className="elsewhere-avatar" />
      </PersonPhotosProvider>
    </AppServicesProvider>,
  )
  return circle
}

const portraitImage = () => document.querySelector('.member-panel__portrait img')

describe('profile photos', () => {
  it('shows initials until a photo is chosen, then shows the photo everywhere', async () => {
    const photos = photoClient()
    renderPanel(photos)

    expect(screen.getAllByText('RN')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Change photo of Rose Nakato' }))
    expect(screen.getByText('Photos stay on this computer.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Choose photo/ }))

    await waitFor(() => expect(portraitImage()).toHaveAttribute('src', NEW_PHOTO))
    expect(document.querySelector('.elsewhere-avatar img')).toHaveAttribute('src', NEW_PHOTO)
    expect(photos.choosePhoto).toHaveBeenCalledWith('user:rose')
    expect(screen.queryByText('RN')).not.toBeInTheDocument()
  })

  it('loads saved photos and removes one', async () => {
    const photos = photoClient({ listPhotos: vi.fn(async () => ({ 'user:rose': GRANDMA })) })
    renderPanel(photos)

    await waitFor(() => expect(portraitImage()).toHaveAttribute('src', GRANDMA))
    fireEvent.click(screen.getByRole('button', { name: 'Change photo of Rose Nakato' }))
    expect(screen.getByRole('menuitem', { name: /Choose a different photo/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove photo' }))

    await waitFor(() => expect(portraitImage()).toBeNull())
    expect(photos.removePhoto).toHaveBeenCalledWith('user:rose')
    expect(screen.getAllByText('RN')).toHaveLength(2)
  })

  it('explains refused files and keeps quiet when the picker is cancelled', async () => {
    const choosePhoto = vi.fn()
      .mockResolvedValueOnce({ status: 'canceled' })
      .mockResolvedValueOnce({ status: 'unsupported' })
      .mockResolvedValueOnce({ status: 'too-large' })
    renderPanel(photoClient({ choosePhoto }))
    const choose = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change photo of Rose Nakato' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /Choose photo/ }))
      await waitFor(() => expect(choosePhoto).toHaveBeenCalled())
    }

    await choose()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change photo of Rose Nakato' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await choose()
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a JPG or PNG photo.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change photo of Rose Nakato' })).toBeEnabled())

    await choose()
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than 20 MB')
    expect(portraitImage()).toBeNull()
  })

  it('reloads photos when the active Circle changes', async () => {
    const listPhotos = vi.fn()
      .mockResolvedValueOnce({ 'user:rose': GRANDMA })
      .mockResolvedValueOnce({})
    const circle = renderPanel(photoClient({ listPhotos }))

    await waitFor(() => expect(portraitImage()).toHaveAttribute('src', GRANDMA))
    act(() => circle.notify())
    await waitFor(() => expect(portraitImage()).toBeNull())
    expect(listPhotos).toHaveBeenCalledTimes(2)
  })

  it('ignores a photo that finishes saving after the Circle was switched', async () => {
    let finish!: (value: { status: 'saved'; personId: string; dataUrl: string }) => void
    const choosePhoto = vi.fn(() => new Promise<{ status: 'saved'; personId: string; dataUrl: string }>((resolve) => { finish = resolve }))
    const listPhotos = vi.fn(async () => ({}))
    const circle = renderPanel(photoClient({ choosePhoto, listPhotos }))

    fireEvent.click(screen.getByRole('button', { name: 'Change photo of Rose Nakato' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Choose photo/ }))
    await waitFor(() => expect(choosePhoto).toHaveBeenCalled())
    act(() => circle.notify())
    await act(async () => finish({ status: 'saved', personId: 'user:rose', dataUrl: NEW_PHOTO }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Change photo of Rose Nakato' })).toBeEnabled())
    expect(portraitImage()).toBeNull()
  })

  it('shows initials and no photo button when photos are not available', () => {
    renderPanel(undefined)
    expect(screen.getAllByText('RN')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Change photo of Rose Nakato' })).not.toBeInTheDocument()
  })
})
