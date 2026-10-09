import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAppServices } from '../../app/services'

type PhotoMessage = { personId: string; text: string } | null

interface PersonPhotosValue {
  photoFor(personId: string | null | undefined): string | null
  /** Opens the picker; resolves when the photo is saved, cancelled or refused. */
  choose(personId: string): Promise<void>
  remove(personId: string): Promise<void>
  busyPersonId: string | null
  message: PhotoMessage
  available: boolean
}

const NO_PHOTOS: PersonPhotosValue = {
  photoFor: () => null,
  choose: async () => undefined,
  remove: async () => undefined,
  busyPersonId: null,
  message: null,
  available: false,
}

const PersonPhotosContext = createContext<PersonPhotosValue>(NO_PHOTOS)

const REFUSED: Record<string, string> = {
  unsupported: 'Choose a JPG or PNG photo.',
  'too-large': 'That photo is larger than 20 MB. Choose a smaller one.',
}

/**
 * Profile photos for the active Circle, shared by every screen that shows people.
 * Photos are kept on this computer only; people without one show their initials.
 */
export function PersonPhotosProvider({ children }: PropsWithChildren) {
  const { circle, photos: client } = useAppServices()
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [busyPersonId, setBusyPersonId] = useState<string | null>(null)
  const [message, setMessage] = useState<PhotoMessage>(null)
  const loadRef = useRef(0)

  const load = useCallback(async () => {
    if (!client) return
    const request = ++loadRef.current
    try {
      const next = await client.listPhotos()
      if (request === loadRef.current) setPhotos(next)
    } catch {
      if (request === loadRef.current) setPhotos({})
    }
  }, [client])

  useEffect(() => {
    void load()
    // Switching, creating or leaving a Circle changes whose photos apply.
    return circle.onChange(() => { void load() })
  }, [circle, load])

  const choose = useCallback(async (personId: string) => {
    if (!client) return
    setBusyPersonId(personId)
    setMessage(null)
    try {
      const result = await client.choosePhoto(personId)
      if (result.status === 'saved') {
        loadRef.current += 1
        setPhotos((current) => ({ ...current, [result.personId]: result.dataUrl }))
      } else if (result.status !== 'canceled') {
        setMessage({ personId, text: REFUSED[result.status] ?? REFUSED.unsupported! })
      }
    } catch {
      setMessage({ personId, text: 'The photo could not be saved. Please try again.' })
    } finally {
      setBusyPersonId(null)
    }
  }, [client])

  const remove = useCallback(async (personId: string) => {
    if (!client) return
    setBusyPersonId(personId)
    setMessage(null)
    try {
      await client.removePhoto(personId)
      loadRef.current += 1
      setPhotos((current) => {
        const next = { ...current }
        delete next[personId]
        return next
      })
    } catch {
      setMessage({ personId, text: 'The photo could not be removed. Please try again.' })
    } finally {
      setBusyPersonId(null)
    }
  }, [client])

  const value = useMemo<PersonPhotosValue>(() => ({
    photoFor: (personId) => (personId ? photos[personId] ?? null : null),
    choose,
    remove,
    busyPersonId,
    message,
    available: Boolean(client),
  }), [photos, choose, remove, busyPersonId, message, client])

  return <PersonPhotosContext.Provider value={value}>{children}</PersonPhotosContext.Provider>
}

export function usePersonPhotos(): PersonPhotosValue {
  return useContext(PersonPhotosContext)
}

/** A person's photo when one is set on this computer, otherwise their initials. */
export function PersonAvatar({
  personId,
  initials,
  className,
}: {
  personId: string | null | undefined
  initials: string
  className: string
}) {
  const photo = usePersonPhotos().photoFor(personId)
  return (
    <span className={`${className}${photo ? ' person-avatar--photo' : ''}`} aria-hidden="true">
      {photo ? <img className="person-avatar__image" src={photo} alt="" draggable={false} /> : initials}
    </span>
  )
}
