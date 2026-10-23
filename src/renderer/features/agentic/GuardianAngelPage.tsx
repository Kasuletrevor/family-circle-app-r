import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LogIn, Plus, RefreshCw, Search, Wrench } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { GUARDIAN_ANGEL_CATEGORIES, type GuardianAngelCatalogResult, type GuardianAngelTemplate } from '../../../shared/agentic'
import { useAppServices } from '../../app/services'
import { addResultMessage, GUARDIAN_ANGEL_VIEW, UNREACHABLE } from './angelMessages'
import { CardAvatar, SafetyRules } from './cardParts'
import { MyGuardianAngelsPanel } from './MyGuardianAngelsPanel'
import './agentic.css'

type LoadState = { status: 'loading' } | GuardianAngelCatalogResult
type Tab = 'templates' | 'mine'

function savedOn(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function TemplateCard({ template, adding, onUse, onAdd }: {
  template: GuardianAngelTemplate
  adding: boolean
  onUse(): void
  onAdd(): void
}) {
  const headingId = `ga-template-${template.id}`
  return (
    <article className="ga-card" aria-labelledby={headingId}>
      <div className="ga-card__top">
        <CardAvatar name={template.name} avatar={template.avatar} />
        <h3 id={headingId}>{template.name}</h3>
      </div>
      {template.description ? <p className="ga-card__description">{template.description}</p> : null}
      <SafetyRules trustBoundaries={template.trustBoundaries} escalationTriggers={template.escalationTriggers} />
      <div className="ga-card__actions">
        <button type="button" className="agentic-button agentic-button--primary" disabled={adding} onClick={onAdd}>
          <Plus size={16} aria-hidden="true" /> {adding ? 'Adding…' : 'Add to my Guardian Angels'}
        </button>
        <button type="button" className="agentic-button" onClick={onUse}>Use this template</button>
      </div>
    </article>
  )
}

/** The public Guardian Angel templates and the person's own angels, shown natively. */
export function GuardianAngelPage() {
  const { agentic } = useAppServices()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'mine' ? 'mine' : 'templates'
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const addingRef = useRef(false)
  const [notice, setNotice] = useState<{ text: string; added: boolean } | null>(null)

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

  const showTab = (next: Tab) => {
    setNotice(null)
    setParams(next === 'mine' ? { tab: 'mine' } : {}, { replace: true })
  }

  const add = async (templateId: string) => {
    // A ref, not state, so a quick double click still adds one angel.
    if (!agentic || addingRef.current) return
    addingRef.current = true
    setAdding(templateId)
    setNotice(null)
    try {
      const connection = await agentic.getAngelConnection()
      if (connection.status !== 'connected') {
        // Connect first; the My Guardian Angels tab finishes the add afterwards.
        await agentic.connect()
        navigate(`${GUARDIAN_ANGEL_VIEW}?page=connect&add=${encodeURIComponent(templateId)}`)
        return
      }
      const result = await agentic.addAngel(templateId)
      setNotice({ text: addResultMessage(result), added: result.status === 'added' })
    } catch {
      setNotice({ text: UNREACHABLE, added: false })
    } finally {
      addingRef.current = false
      setAdding(null)
    }
  }

  return (
    <section className="agentic-page ga-page" aria-labelledby="ga-heading">
      <header className="ga-page__header">
        <div>
          <h1 id="ga-heading">Guardian Angel</h1>
          <p>Ready-made care helpers from Kin-Keepers.ai. Choose one, then set it up on Kin-Keepers.ai. Family Circle shares nothing with it.</p>
        </div>
        <div className="ga-page__actions">
          <button type="button" className="agentic-button" onClick={() => navigate(GUARDIAN_ANGEL_VIEW)}>
            <LogIn size={16} aria-hidden="true" /> Sign in to Kin-Keepers.ai
          </button>
          <button type="button" className="agentic-button" onClick={() => navigate(`${GUARDIAN_ANGEL_VIEW}?page=care-builder`)}>
            <Wrench size={16} aria-hidden="true" /> Care Builder
          </button>
        </div>
      </header>

      <div className="ga-tabs" role="tablist" aria-label="Guardian Angel">
        <button type="button" role="tab" id="ga-tab-templates" className="ga-tabs__tab" aria-selected={tab === 'templates'} aria-controls="ga-panel" onClick={() => showTab('templates')}>
          Templates
        </button>
        <button type="button" role="tab" id="ga-tab-mine" className="ga-tabs__tab" aria-selected={tab === 'mine'} aria-controls="ga-panel" onClick={() => showTab('mine')}>
          My Guardian Angels
        </button>
      </div>

      <div id="ga-panel" role="tabpanel" aria-labelledby={`ga-tab-${tab}`}>
        {tab === 'mine' ? <MyGuardianAngelsPanel onBrowse={() => showTab('templates')} /> : null}

        {tab === 'templates' && notice ? (
          <p className="ga-notice" role="status">
            {notice.text}
            {notice.added ? (
              <button type="button" className="agentic-link" onClick={() => showTab('mine')}>Show My Guardian Angels</button>
            ) : null}
          </p>
        ) : null}

        {tab === 'templates' && state.status === 'loading' ? <p className="ga-page__note" role="status">Loading templates…</p> : null}

        {tab === 'templates' && state.status === 'unavailable' ? (
          <div className="ga-page__problem" role="alert">
            <strong>Couldn't reach Guardian Angel</strong>
            <span>Check your internet connection and try again.</span>
            <button type="button" className="agentic-button" onClick={() => void load(true)}>
              <RefreshCw size={16} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : null}

        {tab === 'templates' && state.status === 'ready' ? (
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
                    <TemplateCard
                      key={template.id}
                      template={template}
                      adding={adding === template.id}
                      onUse={() => navigate(`${GUARDIAN_ANGEL_VIEW}?template=${encodeURIComponent(template.id)}`)}
                      onAdd={() => void add(template.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </section>
  )
}
