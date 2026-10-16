import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogIn, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { GUARDIAN_ANGEL_CATEGORIES, type GuardianAngelCatalogResult, type GuardianAngelTemplate } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import './agentic.css'

type LoadState = { status: 'loading' } | GuardianAngelCatalogResult

const VIEW = '/agentic/guardian-angel/view'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('')
}

function savedOn(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function TemplateCard({ template, onUse }: { template: GuardianAngelTemplate; onUse(): void }) {
  const headingId = `ga-template-${template.id}`
  const rules = template.trustBoundaries.length + template.escalationTriggers.length
  return (
    <article className="ga-card" aria-labelledby={headingId}>
      <div className="ga-card__top">
        {template.avatar
          ? <img className="ga-card__avatar" src={template.avatar} alt="" draggable={false} />
          : <span className="ga-card__avatar" aria-hidden="true">{initials(template.name)}</span>}
        <h3 id={headingId}>{template.name}</h3>
      </div>
      {template.description ? <p className="ga-card__description">{template.description}</p> : null}
      {rules > 0 ? (
        <details className="ga-card__rules">
          <summary><ShieldCheck size={15} aria-hidden="true" /> Safety rules ({rules})</summary>
          {template.trustBoundaries.length > 0 ? (
            <>
              <h4>Stays within</h4>
              <ul>{template.trustBoundaries.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </>
          ) : null}
          {template.escalationTriggers.length > 0 ? (
            <>
              <h4>Alerts the family about</h4>
              <ul>{template.escalationTriggers.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </>
          ) : null}
        </details>
      ) : null}
      <button type="button" className="agentic-button agentic-button--primary ga-card__use" onClick={onUse}>Use this template</button>
    </article>
  )
}

/** The public Guardian Angel templates, shown natively; people activate them on Kin-Keepers.ai. */
export function GuardianAngelPage() {
  const { agentic } = useAppServices()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')

  const load = useCallback(async (refresh: boolean) => {
    if (!agentic) {
      setState({ status: 'unavailable' })
      return
    }
    try {
      setState(await agentic.getCatalog(refresh))
    } catch {
      setState({ status: 'unavailable' })
    }
  }, [agentic])

  useEffect(() => { void load(false) }, [load])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    const matches = state.templates.filter((template) => (
      !needle || `${template.name} ${template.description}`.toLowerCase().includes(needle)
    ))
    return GUARDIAN_ANGEL_CATEGORIES
      .map((category) => ({ ...category, templates: matches.filter((template) => template.category === category.key) }))
      .filter((group) => group.templates.length > 0)
  }, [state, query])

  return (
    <section className="agentic-page ga-page" aria-labelledby="ga-heading">
      <header className="ga-page__header">
        <div>
          <h1 id="ga-heading">Guardian Angel</h1>
          <p>Ready-made care helpers from Kin-Keepers.ai. Choose one, then set it up on Kin-Keepers.ai. Family Circle shares nothing with it.</p>
        </div>
        <div className="ga-page__actions">
          <button type="button" className="agentic-button" onClick={() => navigate(VIEW)}>
            <LogIn size={16} aria-hidden="true" /> Sign in to Kin-Keepers.ai
          </button>
          <button type="button" className="agentic-button" onClick={() => navigate(`${VIEW}?page=care-builder`)}>
            <Wrench size={16} aria-hidden="true" /> Care Builder
          </button>
        </div>
      </header>

      {state.status === 'loading' ? <p className="ga-page__note" role="status">Loading templates…</p> : null}

      {state.status === 'unavailable' ? (
        <div className="ga-page__problem" role="alert">
          <strong>Couldn't reach Guardian Angel</strong>
          <span>Check your internet connection and try again.</span>
          <button type="button" className="agentic-button" onClick={() => void load(true)}>
            <RefreshCw size={16} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          {state.stale ? (
            <div className="ga-page__stale" role="status">
              <span>Showing the copy from {savedOn(state.fetchedAt)}. Couldn't reach Guardian Angel just now.</span>
              <button type="button" className="agentic-button" onClick={() => void load(true)}>
                <RefreshCw size={16} aria-hidden="true" /> Retry
              </button>
            </div>
          ) : null}
          <label className="ga-page__search">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Search templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {groups.length === 0 ? <p className="ga-page__note">No templates match “{query.trim()}”.</p> : null}
          {groups.map((group) => (
            <section key={group.key} className="ga-group" aria-labelledby={`ga-group-${group.key}`}>
              <h2 id={`ga-group-${group.key}`}>{group.label}</h2>
              <div className="ga-grid">
                {group.templates.map((template) => (
                  <TemplateCard key={template.id} template={template} onUse={() => navigate(`${VIEW}?template=${encodeURIComponent(template.id)}`)} />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </section>
  )
}
