import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, LayoutGrid, RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PartnerServiceKey, PartnerViewCommand, PartnerViewState, PartnerViewTarget } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import { useOverlayOpen } from './useOverlayOpen'
import './agentic.css'

const SERVICE_NAMES: Record<PartnerServiceKey, string> = {
  'guardian-angel': 'Guardian Angel',
  ubercare: 'UberCare',
  marketplace: 'Marketplace',
}

/** The newest page open per service, so a late, older open never hides a newer view. */
const latestOpen = new Map<PartnerServiceKey, number>()

function targetFrom(template: string | null, page: string | null): PartnerViewTarget {
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
  const target = useMemo(() => targetFrom(template, page), [template, page])
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

  // Load the page asked for in the address: a template, Care Builder or the start page.
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
          <h1 id="partner-view-heading">{name}</h1>
          <span>Partner service. Family Circle shares nothing with it.</span>
        </div>
        {service === 'guardian-angel' ? (
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
