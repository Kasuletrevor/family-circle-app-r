import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { StoryMediaStore } from './StoryMediaStore'
import { StoryLegacyImporter } from './StoryLegacyImporter'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'story-import-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  db.prepare(`INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (1,'one@example.com','hash','One',1,1)`).run()
  db.prepare(`INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (2,'two@example.com','hash','Two',1,1)`).run()
  db.exec(`
    CREATE TABLE my_stories (user_id INTEGER PRIMARY KEY, story_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE story_entries (
      user_id INTEGER NOT NULL, field_key TEXT NOT NULL, section TEXT NOT NULL, label TEXT NOT NULL,
      question TEXT NOT NULL, answer TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', entity_type TEXT,
      updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, field_key)
    );
    CREATE TABLE story_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, story_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE story_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, field_key TEXT NOT NULL,
      media_type TEXT NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `)
  return db
}

function entry(db: DatabaseSync, userId: number, fieldKey: string, answer: string, language = 'en', updatedAt = 100): void {
  db.prepare(`
    INSERT INTO story_entries (user_id, field_key, section, label, question, answer, language, entity_type, updated_at)
    VALUES (?, ?, 'legacy', 'legacy', 'legacy', ?, ?, NULL, ?)
  `).run(userId, fieldKey, answer, language, updatedAt)
}

describe('StoryLegacyImporter', () => {
  it('imports only fixed fields with JSON precedence and legacy confirmation/language semantics', async () => {
    const root = await tempRoot()
    const db = createDb()
    db.prepare('INSERT INTO my_stories VALUES (1, ?, 200)').run(JSON.stringify({
      childhood: 'JSON childhood',
      education: 'JSON education',
      unknownField: 'must stay legacy-only',
      __confirmed: { childhood: true, education: false },
      __languages: { childhood: 'fr' },
      __language: 'es',
    }))
    entry(db, 1, 'childhood', 'ENTRY childhood', 'en', 150)
    entry(db, 1, 'education', 'ENTRY education', 'ja', 150)
    entry(db, 1, 'roots', 'Entry roots', 'pt', 150)
    db.prepare('INSERT INTO my_stories VALUES (2, ?, 300)').run(JSON.stringify({ childhood: 'Pre-confirmation memory', __language: 'fil' }))

    const importer = new StoryLegacyImporter({
      db,
      appDataPath: join(root, 'app-data'),
      userDataPath: join(root, 'new-app'),
      mediaStore: new StoryMediaStore(join(root, 'new-app')),
    })
    await importer.importForExistingUsers()

    const rows = db.prepare(`
      SELECT local_user_id, field_key, answer, language, confirmed, index_status, confirmed_at
        FROM story_answers ORDER BY local_user_id, field_key
    `).all() as Array<Record<string, unknown>>
    expect(rows).toContainEqual(expect.objectContaining({
      local_user_id: 1, field_key: 'childhood', answer: 'JSON childhood', language: 'fr', confirmed: 1, index_status: 'pending', confirmed_at: 200,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      local_user_id: 1, field_key: 'education', answer: 'JSON education', language: 'ja', confirmed: 0, index_status: 'not_indexed', confirmed_at: null,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      local_user_id: 1, field_key: 'roots', answer: 'Entry roots', language: 'pt', confirmed: 0, index_status: 'not_indexed', confirmed_at: null,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      local_user_id: 2, field_key: 'childhood', answer: 'Pre-confirmation memory', language: 'fil', confirmed: 1, index_status: 'pending', confirmed_at: 300,
    }))
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_answers WHERE field_key = 'unknownField'").get()).toEqual({ n: 0 })
    expect(JSON.parse(String((db.prepare('SELECT story_json FROM my_stories WHERE user_id = 1').get() as { story_json: string }).story_json))).toHaveProperty('unknownField', 'must stay legacy-only')
    db.close()
  })

  it('falls back to story_entries when JSON is damaged and safely defaults unsupported languages', async () => {
    const root = await tempRoot()
    const db = createDb()
    db.prepare("INSERT INTO my_stories VALUES (1, '{damaged', 200)").run()
    entry(db, 1, 'values', 'Entry-only values', 'xx', 210)
    entry(db, 1, 'notAField', 'ignore me', 'en', 210)

    await new StoryLegacyImporter({ db, appDataPath: join(root, 'app'), userDataPath: join(root, 'new'), mediaStore: new StoryMediaStore(join(root, 'new')) }).importForExistingUsers()

    expect(db.prepare("SELECT answer, language, confirmed, index_status FROM story_answers WHERE local_user_id=1 AND field_key='values'").get())
      .toEqual({ answer: 'Entry-only values', language: 'en', confirmed: 1, index_status: 'pending' })
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_answers WHERE field_key='notAField'").get()).toEqual({ n: 0 })
    db.close()
  })

  it('deduplicates legacy history semantically and retains only the newest 30 versions', async () => {
    const root = await tempRoot()
    const db = createDb()
    for (let index = 0; index < 32; index += 1) {
      db.prepare('INSERT INTO story_history (user_id, story_json, created_at) VALUES (1, ?, ?)')
        .run(JSON.stringify({ childhood: `Memory ${index}` }), 1_000 + index)
    }
    db.prepare('INSERT INTO story_history (user_id, story_json, created_at) VALUES (1, ?, 5000)')
      .run(JSON.stringify({ childhood: 'Memory 31', __resume: { step: 4 } }))

    await new StoryLegacyImporter({ db, appDataPath: join(root, 'app'), userDataPath: join(root, 'new'), mediaStore: new StoryMediaStore(join(root, 'new')) }).importForExistingUsers()
    const rows = db.prepare('SELECT semantic_signature, created_at FROM story_versions WHERE local_user_id=1 ORDER BY created_at DESC').all() as Array<{ semantic_signature: string; created_at: number }>

    expect(rows).toHaveLength(30)
    expect(new Set(rows.map((row) => row.semantic_signature)).size).toBe(30)
    expect(rows[0]?.created_at).toBe(5000)
    db.close()
  })

  it('copies only eligible legacy media under the known legacy root, skips unsafe rows, and never changes originals', async () => {
    const root = await tempRoot()
    const appDataPath = join(root, 'app-data')
    const userDataPath = join(root, 'new-app')
    const legacyRoot = join(appDataPath, 'Family Circle')
    const mediaDir = join(legacyRoot, 'story_media', '1', 'childhood')
    await mkdir(mediaDir, { recursive: true })
    const valid = join(mediaDir, 'family.jpg')
    await writeFile(valid, Buffer.from([0xff,0xd8,0xff,1,2,3,4]))
    const before = await readFile(valid)
    const outside = join(root, 'outside.jpg')
    await writeFile(outside, Buffer.from([0xff,0xd8,0xff,9]))

    const db = createDb()
    db.prepare("INSERT INTO story_media (user_id, field_key, media_type, file_name, file_path, created_at) VALUES (1,'childhood','photo','family.jpg',?,100)").run(valid)
    db.prepare("INSERT INTO story_media (user_id, field_key, media_type, file_name, file_path, created_at) VALUES (1,'childhood','photo','outside.jpg',?,101)").run(outside)
    db.prepare("INSERT INTO story_media (user_id, field_key, media_type, file_name, file_path, created_at) VALUES (1,'bogus','photo','bad.jpg',?,102)").run(join(mediaDir, 'missing.jpg'))

    const report = await new StoryLegacyImporter({ db, appDataPath, userDataPath, mediaStore: new StoryMediaStore(userDataPath) }).importForExistingUsers()
    const rows = db.prepare("SELECT * FROM story_media_items WHERE local_user_id=1 AND storage_status='active'").all() as Array<{ stored_relative_path: string; legacy_source_key: string }>

    expect(rows).toHaveLength(1)
    expect(rows[0]?.legacy_source_key).toBeTruthy()
    const copiedPath = new StoryMediaStore(userDataPath).resolveOwnedPath(1, rows[0]!.stored_relative_path)
    expect(await readFile(copiedPath)).toEqual(before)
    expect(await readFile(valid)).toEqual(before)
    expect(report.diagnostics.map((item) => item.reason)).toEqual(expect.arrayContaining(['outside-legacy-root', 'invalid-field']))
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_import_state WHERE local_user_id=1 AND migration_key='legacy-my-story-v1'").get()).toEqual({ n: 1 })
    db.close()
  })

  it('resumes a copying media reservation to the same destination and remains idempotent', async () => {
    const root = await tempRoot()
    const appDataPath = join(root, 'app-data')
    const userDataPath = join(root, 'new-app')
    const legacyDir = join(appDataPath, 'Family Circle', 'story_media', '1', 'childhood')
    await mkdir(legacyDir, { recursive: true })
    const source = join(legacyDir, 'family.jpg')
    await writeFile(source, Buffer.from([0xff,0xd8,0xff,1,2]))
    const db = createDb()
    db.prepare("INSERT INTO story_media (id,user_id,field_key,media_type,file_name,file_path,created_at) VALUES (44,1,'childhood','photo','family.jpg',?,100)").run(source)

    let crashed = false
    const first = new StoryLegacyImporter({
      db, appDataPath, userDataPath, mediaStore: new StoryMediaStore(userDataPath),
      afterMediaReservation: () => { if (!crashed) { crashed = true; throw new Error('simulated crash') } },
    })
    await expect(first.importForExistingUsers()).rejects.toThrow('simulated crash')
    const reservation = db.prepare("SELECT stored_relative_path, storage_status FROM story_media_items WHERE local_user_id=1").get() as { stored_relative_path: string; storage_status: string }
    expect(reservation.storage_status).toBe('copying')
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_import_state WHERE local_user_id=1").get()).toEqual({ n: 0 })

    const second = new StoryLegacyImporter({ db, appDataPath, userDataPath, mediaStore: new StoryMediaStore(userDataPath) })
    await second.importForExistingUsers()
    const active = db.prepare("SELECT stored_relative_path, storage_status FROM story_media_items WHERE local_user_id=1").get() as { stored_relative_path: string; storage_status: string }
    expect(active).toEqual({ stored_relative_path: reservation.stored_relative_path, storage_status: 'active' })
    await second.importForExistingUsers()
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_media_items WHERE local_user_id=1").get()).toEqual({ n: 1 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_import_state WHERE local_user_id=1 AND migration_key='legacy-my-story-v1'").get()).toEqual({ n: 1 })
    db.close()
  })
})
