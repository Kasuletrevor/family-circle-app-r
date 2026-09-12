import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database/database'
import {
  storySemanticSignature,
  type StorySemanticSnapshot,
  type StoryVersionInternal,
} from './storyModels'

interface StoryVersionRow {
  id: number
  local_user_id: number
  snapshot_json: string
  semantic_signature: string
  created_at: number
}

function shapeVersion(row: StoryVersionRow | undefined): StoryVersionInternal | null {
  if (!row) return null
  return {
    id: Number(row.id),
    localUserId: Number(row.local_user_id),
    snapshot: JSON.parse(String(row.snapshot_json)) as StorySemanticSnapshot,
    semanticSignature: String(row.semantic_signature),
    createdAt: Number(row.created_at),
  }
}

export class StoryHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  async createIfChanged(localUserId: number, snapshot: StorySemanticSnapshot): Promise<number | null> {
    return withTransaction(this.db, () => this.createIfChangedInOpenTransaction(localUserId, snapshot))
  }

  createIfChangedInOpenTransaction(localUserId: number, snapshot: StorySemanticSnapshot): number | null {
    const signature = storySemanticSignature(snapshot)
    const latest = this.db.prepare(`
      SELECT semantic_signature
        FROM story_versions
       WHERE local_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `).get(localUserId) as { semantic_signature: string } | undefined

    if (latest?.semantic_signature === signature) return null

    const result = this.db.prepare(`
      INSERT INTO story_versions (
        local_user_id, snapshot_json, semantic_signature, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(localUserId, JSON.stringify(snapshot), signature, Date.now())

    this.db.prepare(`
      DELETE FROM story_versions
       WHERE local_user_id = ?
         AND id NOT IN (
           SELECT id
             FROM story_versions
            WHERE local_user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 30
         )
    `).run(localUserId, localUserId)

    return Number(result.lastInsertRowid)
  }

  async list(localUserId: number): Promise<StoryVersionInternal[]> {
    const rows = this.db.prepare(`
      SELECT id, local_user_id, snapshot_json, semantic_signature, created_at
        FROM story_versions
       WHERE local_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 30
    `).all(localUserId) as unknown as StoryVersionRow[]
    return rows.map((row) => shapeVersion(row) as StoryVersionInternal)
  }

  async getOwned(localUserId: number, versionId: number): Promise<StoryVersionInternal | null> {
    if (!Number.isSafeInteger(versionId) || versionId <= 0) return null
    const row = this.db.prepare(`
      SELECT id, local_user_id, snapshot_json, semantic_signature, created_at
        FROM story_versions
       WHERE id = ? AND local_user_id = ?
    `).get(versionId, localUserId) as StoryVersionRow | undefined
    return shapeVersion(row)
  }
}
