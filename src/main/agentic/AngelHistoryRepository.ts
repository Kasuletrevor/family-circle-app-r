import type { DatabaseSync } from 'node:sqlite'
import type { AngelChatMessage, AngelChatSource, AngelEscalationGroup } from '../../shared/agenticChat'

const KEPT_PER_ANGEL = 200

interface MessageRow {
  id: number
  role: 'person' | 'angel'
  text: string
  sources_json: string
  escalation: AngelEscalationGroup | null
  created_at: number
}

function sources(json: string): AngelChatSource[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed as AngelChatSource[] : []
  } catch {
    return []
  }
}

function shape(row: MessageRow): AngelChatMessage {
  return {
    id: Number(row.id),
    role: row.role,
    text: String(row.text),
    sources: sources(String(row.sources_json)),
    escalation: row.escalation ?? null,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  }
}

/** Conversations with angels and their cached recipes, kept only on this computer. */
export class AngelHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  add(localUserId: number, angelId: string, entry: {
    role: 'person' | 'angel'
    text: string
    sources?: AngelChatSource[]
    escalation?: AngelEscalationGroup | null
    executionBackend?: 'llama.cpp' | null
    model?: string | null
  }): AngelChatMessage {
    const now = Date.now()
    const result = this.db.prepare(`
      INSERT INTO angel_messages (local_user_id, angel_id, role, text, sources_json, escalation, execution_backend, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(localUserId, angelId, entry.role, entry.text, JSON.stringify(entry.sources ?? []), entry.escalation ?? null,
      entry.executionBackend ?? null, entry.model ?? null, now)
    this.db.prepare(`
      DELETE FROM angel_messages
       WHERE local_user_id = ? AND angel_id = ?
         AND id NOT IN (
           SELECT id FROM angel_messages WHERE local_user_id = ? AND angel_id = ? ORDER BY id DESC LIMIT ${KEPT_PER_ANGEL}
         )
    `).run(localUserId, angelId, localUserId, angelId)
    return {
      id: Number(result.lastInsertRowid),
      role: entry.role,
      text: entry.text,
      sources: entry.sources ?? [],
      escalation: entry.escalation ?? null,
      createdAt: new Date(now).toISOString(),
    }
  }

  /** The whole kept conversation, oldest first. */
  list(localUserId: number, angelId: string): AngelChatMessage[] {
    return this.recent(localUserId, angelId, KEPT_PER_ANGEL)
  }

  /** The newest `limit` messages, oldest first. */
  recent(localUserId: number, angelId: string, limit: number): AngelChatMessage[] {
    const rows = this.db.prepare(`
      SELECT id, role, text, sources_json, escalation, created_at
        FROM angel_messages
       WHERE local_user_id = ? AND angel_id = ?
       ORDER BY id DESC
       LIMIT ?
    `).all(localUserId, angelId, limit) as unknown as MessageRow[]
    return rows.reverse().map(shape)
  }

  /** Where a saved reply ran. */
  model(localUserId: number, angelId: string, messageId: number): { executionBackend: string | null; model: string | null } | null {
    const row = this.db.prepare(`
      SELECT execution_backend, model FROM angel_messages WHERE local_user_id = ? AND angel_id = ? AND id = ?
    `).get(localUserId, angelId, messageId) as { execution_backend: string | null; model: string | null } | undefined
    return row ? { executionBackend: row.execution_backend, model: row.model } : null
  }

  clear(localUserId: number, angelId: string): void {
    this.db.prepare('DELETE FROM angel_messages WHERE local_user_id = ? AND angel_id = ?').run(localUserId, angelId)
  }

  saveRecipe(localUserId: number, angelId: string, recipeJson: string): void {
    this.db.prepare(`
      INSERT INTO angel_recipes (local_user_id, angel_id, recipe_json, fetched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(local_user_id, angel_id) DO UPDATE SET recipe_json = excluded.recipe_json, fetched_at = excluded.fetched_at
    `).run(localUserId, angelId, recipeJson, Date.now())
  }

  recipe(localUserId: number, angelId: string): string | null {
    const row = this.db.prepare('SELECT recipe_json FROM angel_recipes WHERE local_user_id = ? AND angel_id = ?')
      .get(localUserId, angelId) as { recipe_json: string } | undefined
    return row ? String(row.recipe_json) : null
  }

  /** Every recipe saved for this person, so their angels can be opened without a connection. */
  recipes(localUserId: number): Array<{ angelId: string; recipeJson: string }> {
    const rows = this.db.prepare('SELECT angel_id, recipe_json FROM angel_recipes WHERE local_user_id = ? ORDER BY angel_id')
      .all(localUserId) as unknown as Array<{ angel_id: string; recipe_json: string }>
    return rows.map((row) => ({ angelId: String(row.angel_id), recipeJson: String(row.recipe_json) }))
  }

  /** Removes the angel's conversation and its cached recipe. */
  forget(localUserId: number, angelId: string): void {
    this.clear(localUserId, angelId)
    this.db.prepare('DELETE FROM angel_recipes WHERE local_user_id = ? AND angel_id = ?').run(localUserId, angelId)
  }
}
