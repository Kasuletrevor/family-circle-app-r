import { describe, expect, it } from 'vitest'
import { safeAngelChatOpen, safeAngelChatSend } from './agenticChat'

const message = {
  id: 1, role: 'angel', text: 'Hello', sources: [{ label: 'My Story › Childhood', excerpt: 'We lived by the lake.' }],
  escalation: null, createdAt: '2026-10-23T10:00:00.000Z',
}

describe('safe chat results', () => {
  it('keeps a valid open result and drops extra fields', () => {
    const result = safeAngelChatOpen({
      status: 'ready', angel: { id: '5', name: 'Morning', secret: 1 },
      runtime: { backend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [message, { bad: true }], offline: false,
    })
    expect(result).toEqual({
      status: 'ready', angel: { id: '5', name: 'Morning' },
      runtime: { backend: 'llama.cpp', model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [message], offline: false,
    })
  })

  it('turns anything unknown into unavailable or failed', () => {
    expect(safeAngelChatOpen({ status: 'ready', angel: { id: '../x', name: 'A' } })).toEqual({ status: 'unavailable' })
    expect(safeAngelChatOpen({ status: 'ready', angel: { id: '5', name: 'A' }, runtime: { backend: 'openai', model: 'gpt' }, messages: [], offline: false }))
      .toEqual({ status: 'unavailable' })
    expect(safeAngelChatOpen({ status: 'not-here' })).toEqual({ status: 'not-here' })
    expect(safeAngelChatOpen('ready')).toEqual({ status: 'unavailable' })
    expect(safeAngelChatSend({ status: 'replied', person: message, reply: { ...message, role: 'robot' } })).toEqual({ status: 'failed' })
    expect(safeAngelChatSend({ status: 'replied', person: message, reply: { ...message, escalation: 'other' } })).toEqual({ status: 'failed' })
    expect(safeAngelChatSend({ status: 'connect-needed' })).toEqual({ status: 'connect-needed' })
  })

  it('keeps a reply with its escalation group', () => {
    const reply = { ...message, id: 2, escalation: 'self-harm', sources: [] }
    expect(safeAngelChatSend({ status: 'replied', person: { ...message, role: 'person' }, reply })).toEqual({
      status: 'replied', person: { ...message, role: 'person' }, reply,
    })
  })
})
