import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../../shared/desktopApi'
import { MockCircleClient } from '../services/circle/MockCircleClient'
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

describe('/ai route', () => {
  it('routes AI Assistant to the real Ask your Vault experience instead of a placeholder', async () => {
    Object.defineProperty(window, 'familyCircle', {
      configurable: true,
      value: {
        vault: {
          listDocuments: async () => [],
          chooseAndUploadDocuments: async () => ({ canceled: true, items: [] }),
          openDocument: async () => ({ success: true }),
          retryExtraction: async () => { throw new Error('not used') },
          retryIndexing: async () => ({ success: true }),
          deleteDocument: async () => ({ success: true }),
          ask: async () => ({ answer: '', sources: [] }),
          onUploadProgress: () => () => undefined,
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AppServicesProvider services={{ circle: new MockCircleClient() }}>
          <App user={user} />
        </AppServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Ask your Vault' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
  })
})
