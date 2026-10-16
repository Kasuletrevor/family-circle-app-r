import { vi } from 'vitest'
import type { GuardianAngelCatalogResult, PartnerViewStatus } from '../../shared/agentic'
import type { AgenticClient } from '../services/agentic/AgenticClient'

export const SAMPLE_CATALOG: GuardianAngelCatalogResult = {
  status: 'ready',
  fetchedAt: Date.UTC(2026, 9, 15, 9, 30),
  stale: false,
  templates: [
    { id: '7', name: 'Elder Companion', description: 'Warm, patient daily conversation', category: 'elder_companion', trustBoundaries: ['No medical advice'], escalationTriggers: ['Self harm mentions'], avatar: null },
    { id: '9', name: 'Weekly Family Update', description: 'A short note to the family each week', category: 'family_update', trustBoundaries: [], escalationTriggers: [], avatar: null },
    { id: '12', name: 'Pill Reminder', description: 'Reminds about medication times', category: 'medication_appointment', trustBoundaries: ['No dosage changes'], escalationTriggers: [], avatar: null },
  ],
}

export function fakeAgenticClient(overrides: Partial<AgenticClient> = {}) {
  const listeners = new Set<(status: PartnerViewStatus) => void>()
  const client = {
    getCatalog: vi.fn(async (_refresh?: boolean) => SAMPLE_CATALOG),
    openView: vi.fn(async (..._args: Parameters<AgenticClient['openView']>) => undefined),
    setViewBounds: vi.fn(async (..._args: Parameters<AgenticClient['setViewBounds']>) => undefined),
    hideView: vi.fn(async (..._args: Parameters<AgenticClient['hideView']>) => undefined),
    viewCommand: vi.fn(async (..._args: Parameters<AgenticClient['viewCommand']>) => undefined),
    onViewState: vi.fn((listener: (status: PartnerViewStatus) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    emitState: (status: PartnerViewStatus) => listeners.forEach((listener) => listener(status)),
  }
  // Overrides replace methods at run time; the mock types stay for assertions.
  return Object.assign(client, overrides) as typeof client
}
