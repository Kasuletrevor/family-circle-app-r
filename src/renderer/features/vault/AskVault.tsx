import { useEffect, useMemo, useState } from 'react'
import { BookOpen, BrainCircuit, FileText, LockKeyhole, Sparkles } from 'lucide-react'
import type { VaultAnswer, VaultDocumentSummary, VaultQueryScope } from '../../../shared/desktopApi'
import { DesktopVaultClient } from '../../services/vault/DesktopVaultClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import './AskVault.css'

const defaultClient = new DesktopVaultClient()

type ScopeMode = 'story-and-vault' | 'story' | 'all' | 'documents'

const SCOPE_OPTIONS: Array<{ mode: ScopeMode; title: string; hint: string }> = [
  { mode: 'story-and-vault', title: 'My Story and Vault', hint: 'Search your confirmed memories and indexed documents together.' },
  { mode: 'story', title: 'My Story', hint: 'Search only your confirmed My Story memories.' },
  { mode: 'all', title: 'All Vault documents', hint: 'Search every document currently ready to ask.' },
  { mode: 'documents', title: 'Choose Vault documents', hint: 'Limit this question to selected indexed files.' },
]

function scopeFor(mode: ScopeMode, documentIds: number[]): VaultQueryScope {
  if (mode === 'documents') return { type: 'documents', documentIds }
  return { type: mode }
}

export function AskVault({ client = defaultClient }: { client?: VaultClient }) {
  const [documents, setDocuments] = useState<VaultDocumentSummary[]>([])
  const [scopeMode, setScopeMode] = useState<ScopeMode>('story-and-vault')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<VaultAnswer | null>(null)
  const [loadingDocuments, setLoadingDocuments] = useState(true)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void client.listDocuments().then(
      (items) => {
        if (!cancelled) {
          setDocuments(items)
          setLoadingDocuments(false)
        }
      },
      () => {
        if (!cancelled) {
          setDocuments([])
          setLoadingDocuments(false)
        }
      },
    )
    return () => { cancelled = true }
  }, [client])

  const indexedDocuments = useMemo(
    () => documents.filter((document) => document.indexStatus === 'indexed'),
    [documents],
  )

  const canAsk = question.trim().length > 0
    && !asking
    && (scopeMode !== 'documents' || selectedIds.length > 0)

  function toggleDocument(documentId: number): void {
    setSelectedIds((current) => current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId])
  }

  async function submit(): Promise<void> {
    const cleanQuestion = question.trim()
    if (!canAsk || !cleanQuestion) return

    const scope = scopeFor(scopeMode, selectedIds)

    setAsking(true)
    setError(null)
    setAnswer(null)
    try {
      setAnswer(await client.ask(cleanQuestion, scope))
    } catch {
      setError('Private AI could not answer right now. Please try again.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <section className="ask-vault" aria-labelledby="ask-vault-title">
      <header className="ask-vault__header">
        <div>
          <div className="ask-vault__eyebrow"><LockKeyhole size={14} aria-hidden="true" /> Local Private AI</div>
          <h1 id="ask-vault-title">Ask Private AI</h1>
          <p>Ask about your confirmed My Story memories and indexed Vault documents. Everything stays on this computer.</p>
        </div>
        <div className="ask-vault__privacy"><BrainCircuit size={18} aria-hidden="true" /> Answers only from your private sources</div>
      </header>

      <div className="ask-vault__layout">
        <aside className="ask-vault__scope" aria-label="Question scope">
          <h2>Search scope</h2>
          {SCOPE_OPTIONS.map((option) => (
            <label className="ask-vault__scope-option" key={option.mode}>
              <input
                type="radio"
                name="vault-scope"
                aria-label={option.title}
                checked={scopeMode === option.mode}
                onChange={() => setScopeMode(option.mode)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          ))}

          {scopeMode === 'documents' ? (
            <div className="ask-vault__documents">
              {loadingDocuments ? <p>Loading indexed documents…</p> : null}
              {!loadingDocuments && indexedDocuments.length === 0 ? <p>No indexed documents available.</p> : null}
              {indexedDocuments.map((document) => (
                <label className="ask-vault__document" key={document.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(document.id)}
                    onChange={() => toggleDocument(document.id)}
                  />
                  <FileText size={15} aria-hidden="true" />
                  <span>{document.fileName}</span>
                </label>
              ))}
            </div>
          ) : null}
        </aside>

        <main className="ask-vault__main">
          <div className="ask-vault__composer">
            <label htmlFor="vault-question">Question</label>
            <textarea
              id="vault-question"
              rows={4}
              value={question}
              placeholder="Ask something from your memories or family documents…"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="ask-vault__composer-footer">
              <span>Answers stay local and use only what your private sources say.</span>
              <button type="button" disabled={!canAsk} onClick={() => void submit()}>
                <Sparkles size={16} aria-hidden="true" />
                {asking ? 'Thinking locally…' : 'Ask Private AI'}
              </button>
            </div>
          </div>

          {error ? <div className="ask-vault__error" role="alert">{error}</div> : null}

          {answer ? (
            <section className="ask-vault__answer" aria-live="polite">
              <div className="ask-vault__answer-heading">
                <BrainCircuit size={19} aria-hidden="true" />
                <h2>Answer</h2>
              </div>
              <p className="ask-vault__answer-text">{answer.answer}</p>

              {answer.sources.length > 0 ? (
                <div className="ask-vault__sources">
                  <h3>Sources</h3>
                  {answer.sources.map((source, index) => (
                    <article key={`${source.sourceType}-${index}`}>
                      <strong>
                        {source.sourceType === 'story'
                          ? <><BookOpen size={14} aria-hidden="true" /> My Story · {source.label}</>
                          : <><FileText size={14} aria-hidden="true" /> {source.fileName}</>}
                      </strong>
                      <p>{source.excerpt}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>
    </section>
  )
}
