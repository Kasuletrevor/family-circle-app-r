import { describe, expect, it, vi } from 'vitest'
import type { StoryFieldKey } from '../../shared/story'
import { StoryDirectAnswerService } from './StoryDirectAnswerService'

const CONFIRMED: Record<string, { fieldKey: StoryFieldKey; section: string; label: string; answer: string; confirmed: boolean }> = {
  fullName: { fieldKey: 'fullName', section: 'Identity', label: 'Full name', answer: 'Amina Nansubuga', confirmed: true },
  preferredName: { fieldKey: 'preferredName', section: 'Identity', label: 'Preferred name', answer: 'Mina', confirmed: true },
  roots: { fieldKey: 'roots', section: 'Identity', label: 'Birthplace and roots', answer: 'Masaka, Uganda', confirmed: true },
  languages: { fieldKey: 'languages', section: 'Identity', label: 'Languages', answer: 'Luganda and English', confirmed: true },
  occupation: { fieldKey: 'occupation', section: 'Everyday Life', label: 'What I do', answer: 'I teach primary school.', confirmed: true },
  education: { fieldKey: 'education', section: 'Life Story', label: 'Learning and education', answer: 'Makerere University', confirmed: true },
}

function makeService(overrides: Partial<typeof CONFIRMED> = {}) {
  const entries = { ...CONFIRMED, ...overrides }
  const getAnswer = vi.fn(async (_localUserId: number, fieldKey: StoryFieldKey) => entries[fieldKey] ?? null)
  return { service: new StoryDirectAnswerService({ getAnswer }), getAnswer }
}

describe('StoryDirectAnswerService', () => {
  it.each([
    ['What is my full name?', 'fullName', 'Amina Nansubuga'],
    ['What do people call me?', 'preferredName', 'Mina'],
    ['Where was I born?', 'roots', 'Masaka, Uganda'],
    ['What languages do I speak?', 'languages', 'Luganda and English'],
    ['What do I do for work?', 'occupation', 'I teach primary school.'],
    ['What is my education?', 'education', 'Makerere University'],
  ] as const)('answers high-confidence confirmed fact: %s', async (question, fieldKey, expected) => {
    const { service, getAnswer } = makeService()

    const result = await service.answer(27, question)

    expect(result).toMatchObject({
      answer: expected,
      source: {
        sourceType: 'story',
        fileName: expect.stringMatching(/^My Story › /),
      },
    })
    expect(getAnswer).toHaveBeenCalledWith(27, fieldKey)
  })

  it('does not answer from an unconfirmed Story draft', async () => {
    const { service } = makeService({
      roots: { ...CONFIRMED.roots, answer: 'Draft secret place', confirmed: false },
    })

    await expect(service.answer(27, 'Where was I born?')).resolves.toBeNull()
  })

  it('returns null for questions outside the high-confidence direct fact set', async () => {
    const { service, getAnswer } = makeService()

    await expect(service.answer(27, 'What lessons did I learn from my grandmother?')).resolves.toBeNull()
    expect(getAnswer).not.toHaveBeenCalled()
  })
})
