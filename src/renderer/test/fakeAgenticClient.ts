import { vi } from 'vitest'
import type {
  AddAngelResult,
  AngelConnection,
  GuardianAngelCatalogResult,
  MyAngelsResult,
  MyGuardianAngel,
  PartnerViewStatus,
  RemoveAngelResult,
} from '../../shared/agentic'
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

export const SAMPLE_ANGEL: MyGuardianAngel = {
  id: '5',
  name: 'Morning Check-in',
  description: 'Says good morning and asks how the night went',
  templateId: '7',
  templateName: 'Elder Companion',
  avatar: null,
  runCount: 0,
  lastRunAt: null,
  trustBoundaries: ['No medical advice'],
  escalationTriggers: [],
}

export function fakeAgenticClient(overrides: Partial<AgenticClient> = {}) {
  const listeners = new Set<(status: PartnerViewStatus) => void>()
  const connectionListeners = new Set<(connection: AngelConnection) => void>()
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
    getAngelConnection: vi.fn(async (): Promise<AngelConnection> => ({ status: 'disconnected' })),
    connect: vi.fn(async () => undefined),
    cancelConnect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    getMyAngels: vi.fn(async (): Promise<MyAngelsResult> => ({ status: 'disconnected' })),
    addAngel: vi.fn(async (_templateId: string): Promise<AddAngelResult> => ({ status: 'added', angel: SAMPLE_ANGEL })),
    removeAngel: vi.fn(async (_angelId: string): Promise<RemoveAngelResult> => ({ status: 'removed' })),
    onAngelConnection: vi.fn((listener: (connection: AngelConnection) => void) => {
      connectionListeners.add(listener)
      return () => { connectionListeners.delete(listener) }
    }),
    emitConnection: (connection: AngelConnection) => connectionListeners.forEach((listener) => listener(connection)),
  }
  // Overrides replace methods at run time; the mock types stay for assertions.
  return Object.assign(client, overrides) as typeof client
}
