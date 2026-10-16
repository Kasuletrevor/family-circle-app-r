import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { MockCircleClient } from '../services/circle/MockCircleClient'
import { fakeAgenticClient } from '../test/fakeAgenticClient'
import { App } from './App'
import { AppServicesProvider } from './services'

const user: AuthUser = {
  id: 12,
  email: 'ada@example.test',
  name: 'Ada Example',
  accountOrigin: 'registered',
  mustChangePassword: false,
  onboardingCompleted: true,
}

afterEach(() => { delete (window as { familyCircle?: unknown }).familyCircle })

function shellAt(path: string) {
  Object.defineProperty(window, 'familyCircle', {
    configurable: true,
    value: {
      app: { getVersion: async () => '0.2.3', getPlatform: async () => 'win32' },
      privateAi: { getStatus: async () => ({ state: 'ready' }), onProgress: () => () => undefined },
      vault: { listDocuments: async () => [], onUploadProgress: () => () => undefined },
    },
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppServicesProvider services={{ circle: new MockCircleClient(), agentic: fakeAgenticClient() }}>
        <App user={user} onSignOut={async () => undefined} />
      </AppServicesProvider>
    </MemoryRouter>,
  )
  return document.querySelector('.app-shell')
}

describe('COMMAND mode', () => {
  it('turns the frame green on Agentic Services pages', () => {
    expect(shellAt('/agentic/guardian-angel')).toHaveAttribute('data-mode', 'command')
  })

  it('stays in blue Ask mode on core pages', () => {
    expect(shellAt('/vault')).toHaveAttribute('data-mode', 'ask')
  })
})
