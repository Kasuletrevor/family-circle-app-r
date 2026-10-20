import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, LayoutGrid, RefreshCw, Sparkles, X } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { PartnerServiceKey, PartnerViewCommand, PartnerViewState, PartnerViewTarget } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import { MY_ANGELS_TAB } from './angelMessages'
import { useOverlayOpen } from './useOverlayOpen'
import './agentic.css'

const SERVICE_NAMES: Record<PartnerServiceKey, string> = {
  'guardian-angel': 'Guardian Angel',
  ubercare: 'UberCare',
  marketplace: 'Marketplace',
}

/** The newest page open per service, so a late, older open never hides a newer view. */
const latestOpen = new Map<PartnerServiceKey, number>()

function targetFrom(template: string | null, page: string | null, angel: string | null): PartnerViewTarget | undefined {
  // The main process already loaded the connect page; just show the view.
  if (page === 'connect') return undefined
  if (angel && (page === 'edit' || page === 'run')) return { kind: 'angel', angelId: angel, page }
  if (template) return { kind: 'template', templateId: template }
  if (page === 'care-builder') return { kind: 'care-builder' }
  return { kind: 'start' }
}

/** A partner website shown inside Family Circle in its own isolated, sandboxed view. */
export function PartnerViewPage({ service }: { service: PartnerServiceKey }) {
  const { agentic } = useAppServices()
  const [params] = useSearchParams()
  const template = params.get('template')
  const page = params.get('page')
  const angel = params.get('angel')
  const pendingAdd = params.get('add')
  const connecting = service === 'guardian-angel' && page === 'connect'
  const navigate = useNavigate()
  const target = useMemo(() => targetFrom(template, page, angel), [template, page, angel])
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [opened, setOpened] = useState(false)
  const [state, setState] = useState<PartnerViewState>('loading')
  const [canGoBack, setCanGoBack] = useState(false)
  const overlayOpen = useOverlayOpen()
  const name = SERVICE_NAMES[service]
  const visible = opened && !overlayOpen && state !== 'failed'

  useEffect(() => {
    if (!agentic) return undefined
    return agentic.onViewState((status) => {
      if (status.service !== service) return
      setState(status.state)
      setCanGoBack(status.canGoBack)
    })
  }, [agentic, service])

  // Back to My Guardian Angels once connecting succeeds or fails, carrying any template still to add.
  useEffect(() => {
    if (!agentic || !connecting) return undefined
    return agentic.onAngelConnection((connection) => {
      if (connection.status === 'connected') {
        navigate(pendingAdd ? `${MY_ANGELS_TAB}&add=${encodeURIComponent(pendingAdd)}` : MY_ANGELS_TAB, { replace: true })
      } else if (connection.status === 'disconnected') {
        navigate(MY_ANGELS_TAB, { replace: true })
      }
    })
  }, [agentic, connecting, pendingAdd, navigate])

  const cancelConnect = () => {
    void agentic?.cancelConnect().catch(() => undefined)
    navigate(MY_ANGELS_TAB, { replace: true })
  }

  // Load the page asked for in the address: a template, an own angel, Care Builder or the start page.
  useEffect(() => {
    if (!agentic) return undefined
    let active = true
    const openNumber = (latestOpen.get(service) ?? 0) + 1
    latestOpen.set(service, openNumber)
    setOpened(false)
    void agentic.openView(service, target)
      .then(() => {
        if (active) setOpened(true)
        // The page was left while the view was opening and the main process just showed it.
        // Hide it, unless a newer page for this service has opened it since.
        else if (latestOpen.get(service) === openNumber) void agentic.hideView(service).catch(() => undefined)
      })
      .catch(() => { if (active) setState('failed') })
    return () => { active = false }
  }, [agentic, service, target])

  // Show the view over its slot and keep it in place; hide it on leave or while a menu is open.
  useEffect(() => {
    if (!agentic || !opened) return undefined
    if (!visible) {
      void agentic.hideView(service).catch(() => undefined)
      return undefined
    }
    const place = () => {
      const rect = slotRef.current?.getBoundingClientRect()
      if (!rect) return
      void agentic.setViewBounds(service, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(() => undefined)
    }
    void agentic.openView(service).then(place).catch(() => undefined)
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (slotRef.current) observer?.observe(slotRef.current)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      void agentic.hideView(service).catch(() => undefined)
    }
  }, [agentic, service, opened, visible])

  const command = (value: PartnerViewCommand) => {
    if (value === 'reload') setState('loading')
    void agentic?.viewCommand(service, value).catch(() => undefined)
  }

  return (
    <section className="agentic-page partner-view" aria-labelledby="partner-view-heading">
      <header className="partner-view__bar">
        <button type="button" className="agentic-button partner-view__icon" aria-label="Back" disabled={!canGoBack} onClick={() => command('back')}>
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <div className="partner-view__title">
          <h1 id="partner-view-heading">{connecting ? 'Connect Kin-Keepers.ai' : name}</h1>
          <span>
            {connecting
              ? 'Sign in if asked, then choose Connect Family Circle. Family Circle shares nothing about your family.'
              : 'Partner service. Family Circle shares nothing with it.'}
          </span>
        </div>
        {connecting ? (
          <button type="button" className="agentic-button" onClick={cancelConnect}>
            <X size={16} aria-hidden="true" /> Cancel
          </button>
        ) : null}
        {service === 'guardian-angel' && !connecting && angel ? (
          <Link className="agentic-button" to={MY_ANGELS_TAB}>
            <Sparkles size={16} aria-hidden="true" /> My Guardian Angels
          </Link>
        ) : null}
        {service === 'guardian-angel' && !connecting ? (
          <Link className="agentic-button" to="/agentic/guardian-angel">
            <LayoutGrid size={16} aria-hidden="true" /> All templates
          </Link>
        ) : null}
        <button type="button" className="agentic-button partner-view__icon" aria-label="Reload" onClick={() => command('reload')}>
          <RefreshCw size={17} aria-hidden="true" />
        </button>
        <button type="button" className="agentic-button" onClick={() => command('open-external')}>
          <ExternalLink size={16} aria-hidden="true" /> Open in browser
        </button>
      </header>
      <div className="partner-view__slot" ref={slotRef}>
        {!agentic ? <p className="partner-view__message">Agentic Services are not available here.</p> : null}
        {agentic && state === 'failed' ? (
          <div className="partner-view__message" role="alert">
            <strong>Couldn't open {name}</strong>
            <span>Check your internet connection, then try again.</span>
            <div>
              <button type="button" className="agentic-button agentic-button--primary" onClick={() => command('reload')}>Retry</button>
              <button type="button" className="agentic-button" onClick={() => command('open-external')}>Open in browser</button>
            </div>
          </div>
        ) : null}
        {agentic && state === 'loading' ? <p className="partner-view__message" role="status">Opening {name}…</p> : null}
      </div>
    </section>
  )
}
