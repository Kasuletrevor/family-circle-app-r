import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AngelChatMessage } from '../../../shared/agenticChat'
import { AppServicesProvider } from '../../app/services'
import { MockCircleClient } from '../../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../../test/fakeAgenticClient'
import { AngelChatPage } from './AngelChatPage'

const message = (id: number, role: 'person' | 'angel', text: string, extra: Partial<AngelChatMessage> = {}): AngelChatMessage => ({
  id, role, text, sources: [], escalation: null, createdAt: '2026-10-23T10:00:00.000Z', ...extra,
})
const ready = {
  status: 'ready' as const, angel: { id: '5', name: 'Morning Check-in' },
  runtime: { backend: 'llama.cpp' as const, model: 'Qwen_Qwen3.5-0.8B-Q4_K_M' }, messages: [message(1, 'angel', 'Hello again')], offline: false,
}

function renderPage(agentic = fakeAgenticClient()) {
  render(
    <AppServicesProvider services={{ circle: new MockCircleClient(), agentic }}>
      <MemoryRouter initialEntries={['/agentic/guardian-angel/chat?angel=5']}>
        <Routes>
          <Route path="/agentic/guardian-angel/chat" element={<AngelChatPage />} />
          <Route path="*" element={<p>Elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </AppServicesProvider>,
  )
  return agentic
}

describe('AngelChatPage', () => {
  it('shows the history and that it runs on this computer', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    renderPage(agentic)
    expect(await screen.findByRole('heading', { name: 'Morning Check-in' })).toBeInTheDocument()
    expect(agentic.openAngelChat).toHaveBeenCalledWith('5')
    expect(screen.getByText('Runs on this computer · llama.cpp · Qwen3.5-0.8B')).toBeInTheDocument()
    expect(screen.getByText('Hello again')).toBeInTheDocument()
    expect(screen.queryByText(/saved on this computer/)).not.toBeInTheDocument()
  })

  it('says when it is using the saved copy of the angel', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue({ ...ready, offline: true })
    renderPage(agentic)
    expect(await screen.findByText('Using the copy of this angel saved on this computer.')).toBeInTheDocument()
  })

  it('sends a message and shows the reply with its memories', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    agentic.sendAngelMessage.mockResolvedValue({
      status: 'replied', person: message(2, 'person', 'Tell me about home'),
      reply: message(3, 'angel', 'You lived by the lake.', { sources: [{ label: 'My Story › Childhood › Home', excerpt: 'We lived by the lake.' }] }),
    })
    renderPage(agentic)
    const box = await screen.findByLabelText('Message')
    fireEvent.change(box, { target: { value: 'Tell me about home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('You lived by the lake.')).toBeInTheDocument()
    expect(screen.getByText('Tell me about home')).toBeInTheDocument()
    expect(screen.getByText('My Story › Childhood › Home')).toBeInTheDocument()
    expect(agentic.sendAngelMessage).toHaveBeenCalledWith('5', 'Tell me about home')
    expect(box).toHaveValue('')
  })

  it('keeps the typed message when the angel cannot answer', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    agentic.sendAngelMessage.mockResolvedValue({ status: 'failed' })
    renderPage(agentic)
    const box = await screen.findByLabelText('Message')
    fireEvent.change(box, { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText("The angel couldn't answer just now. Try again.")).toBeInTheDocument()
    expect(box).toHaveValue('Hi')
  })

  it('marks safety replies', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue({ ...ready, messages: [message(1, 'angel', 'Please get help now.', { escalation: 'medical-emergency' })] })
    renderPage(agentic)
    expect(await screen.findByRole('note', { name: 'Safety message' })).toHaveTextContent('Please get help now.')
  })

  it('explains what is needed when the angel cannot open', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue({ status: 'private-ai-needed' })
    renderPage(agentic)
    expect(await screen.findByText('Set up private AI in Settings to talk with your angels here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
  })

  it('clears the history after asking', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    renderPage(agentic)
    fireEvent.click(await screen.findByRole('button', { name: "Clear this angel's history" }))
    expect(screen.getByRole('dialog', { name: "Clear Morning Check-in's history?" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    await waitFor(() => expect(agentic.clearAngelChat).toHaveBeenCalledWith('5'))
    await waitFor(() => expect(screen.queryByText('Hello again')).not.toBeInTheDocument())
  })
})

describe('AngelChatPage while thinking', () => {
  it('cannot clear the history while a reply is being written', async () => {
    const agentic = fakeAgenticClient()
    agentic.openAngelChat.mockResolvedValue(ready)
    let reply!: (value: Awaited<ReturnType<typeof agentic.sendAngelMessage>>) => void
    agentic.sendAngelMessage.mockReturnValue(new Promise((resolve) => { reply = resolve }))
    renderPage(agentic)
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('button', { name: "Clear this angel's history" })).toBeDisabled()
    reply({ status: 'failed' })
    await waitFor(() => expect(screen.getByRole('button', { name: "Clear this angel's history" })).toBeEnabled())
  })
})
