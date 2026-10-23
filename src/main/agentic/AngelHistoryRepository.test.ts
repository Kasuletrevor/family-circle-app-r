import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../database/migrations'
import { AngelHistoryRepository } from './AngelHistoryRepository'

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  db.exec(`INSERT INTO users (id, email, password_hash) VALUES (1, 'one@example.com', 'h'), (2, 'two@example.com', 'h')`)
  return { db, history: new AngelHistoryRepository(db) }
}

describe('AngelHistoryRepository', () => {
  it('saves both sides with the local runtime and lists them oldest first', () => {
    const { history } = setup()
    history.add(1, '5', { role: 'person', text: 'Hello' })
    const reply = history.add(1, '5', {
      role: 'angel', text: 'Hi Pat', sources: [{ label: 'My Story › Childhood', excerpt: 'Lake' }],
      executionBackend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M',
    })
    expect(history.list(1, '5').map((item) => item.text)).toEqual(['Hello', 'Hi Pat'])
    expect(history.list(1, '5')[1]).toEqual(reply)
    expect(reply).toMatchObject({ role: 'angel', sources: [{ label: 'My Story › Childhood', excerpt: 'Lake' }], escalation: null })
    expect(history.model(1, '5', reply.id)).toEqual({ executionBackend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' })
  })

  it('keeps people and angels apart and keeps only the newest 200', () => {
    const { history } = setup()
    for (let index = 0; index < 205; index += 1) history.add(1, '5', { role: 'person', text: `m${index}` })
    history.add(2, '5', { role: 'person', text: 'other person' })
    history.add(1, '6', { role: 'person', text: 'other angel' })
    const list = history.list(1, '5')
    expect(list).toHaveLength(200)
    expect(list[0]!.text).toBe('m5')
    expect(history.recent(1, '5', 2).map((item) => item.text)).toEqual(['m203', 'm204'])
    expect(history.list(2, '5').map((item) => item.text)).toEqual(['other person'])
  })

  it('keeps the escalation group of a safety reply', () => {
    const { history } = setup()
    history.add(1, '5', { role: 'angel', text: 'Please get help.', escalation: 'medical-emergency' })
    expect(history.list(1, '5')[0]!.escalation).toBe('medical-emergency')
  })

  it('clears messages, caches a recipe and forgets both', () => {
    const { history } = setup()
    history.add(1, '5', { role: 'person', text: 'Hello' })
    history.saveRecipe(1, '5', '{"a":1}')
    history.saveRecipe(1, '5', '{"a":2}')
    expect(history.recipe(1, '5')).toBe('{"a":2}')
    expect(history.recipe(2, '5')).toBeNull()
    history.clear(1, '5')
    expect(history.list(1, '5')).toEqual([])
    expect(history.recipe(1, '5')).toBe('{"a":2}')
    history.forget(1, '5')
    expect(history.recipe(1, '5')).toBeNull()
  })

  it('removes everything when the Family Circle user is deleted', () => {
    const { db, history } = setup()
    history.add(1, '5', { role: 'person', text: 'Hello' })
    history.saveRecipe(1, '5', '{}')
    db.exec('DELETE FROM users WHERE id = 1')
    expect(history.list(1, '5')).toEqual([])
    expect(history.recipe(1, '5')).toBeNull()
  })
})

describe('AngelHistoryRepository.recipes', () => {
  it('lists the saved recipes of one person only', () => {
    const { history } = setup()
    history.saveRecipe(1, '5', '{"a":5}')
    history.saveRecipe(1, '6', '{"a":6}')
    history.saveRecipe(2, '7', '{"a":7}')
    expect(history.recipes(1)).toEqual([{ angelId: '5', recipeJson: '{"a":5}' }, { angelId: '6', recipeJson: '{"a":6}' }])
    expect(history.recipes(3)).toEqual([])
  })
})
