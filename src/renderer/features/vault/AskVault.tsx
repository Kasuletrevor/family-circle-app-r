import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, FileText, LockKeyhole, Sparkles } from 'lucide-react'
import type { VaultAnswer, VaultDocumentSummary, VaultQueryScope } from '../../../shared/desktopApi'
import { DesktopVaultClient } from '../../services/vault/DesktopVaultClient'
import type { VaultClient } from '../../services/vault/VaultClient'
import './AskVault.css'

const defaultClient = new DesktopVaultClient()

type ScopeMode = 'all' | 'documents'

export function AskVault({ client = defaultClient }: { client?: VaultClient }) {
  const [documents, setDocuments] = useState<VaultDocumentSummary[]>([])
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all')
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
    && (scopeMode === 'all' || selectedIds.length > 0)

  function toggleDocument(documentId: number): void {
    setSelectedIds((current) => current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId])
  }

  async function submit(): Promise<void> {
    const cleanQuestion = question.trim()
    if (!canAsk || !cleanQuestion) return

    const scope: VaultQueryScope = scopeMode === 'all'
      ? { type: 'all' }
      : { type: 'documents', documentIds: selectedIds }

    setAsking(true)
    setError(null)
    setAnswer(null)
    try {
      setAnswer(await client.ask(cleanQuestion, scope))
    } catch {
      setError('Private AI could not answer from your Vault. Please try again.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <section className="ask-vault" aria-labelledby="ask-vault-title">
      <header className="ask-vault__header">
        <div>
          <div className="ask-vault__eyebrow"><LockKeyhole size={14} aria-hidden="true" /> Local Private AI</div>
          <h1 id="ask-vault-title">Ask your Vault</h1>
          <p>Ask questions using only your indexed private documents on this computer.</p>
        </div>
        <div className="ask-vault__privacy"><BrainCircuit size={18} aria-hidden="true" /> Grounded in your Vault only</div>
      </header>

      <div className="ask-vault__layout">
        <aside className="ask-vault__scope" aria-label="Vault question scope">
          <h2>Search scope</h2>
          <label className="ask-vault__scope-option">
            <input
              type="radio"
              name="vault-scope"
              checked={scopeMode === 'all'}
              onChange={() => setScopeMode('all')}
            />
            <span>
              <strong>All indexed documents</strong>
              <small>Search everything currently ready to ask.</small>
            </span>
          </label>
          <label className="ask-vault__scope-option">
            <input
              type="radio"
              name="vault-scope"
              checked={scopeMode === 'documents'}
              onChange={() => setScopeMode('documents')}
            />
            <span>
              <strong>Choose documents</strong>
              <small>Limit this question to selected indexed files.</small>
            </span>
          </label>

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
              placeholder="Ask something contained in your family documents…"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="ask-vault__composer-footer">
              <span>Answers stay local and use only retrieved Vault context.</span>
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
                    <article key={`${source.documentId}-${index}`}>
                      <strong>{source.fileName}</strong>
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
