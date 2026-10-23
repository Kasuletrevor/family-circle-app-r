import type { AddAngelResult } from '../../../shared/agentic'

export const GUARDIAN_ANGEL_VIEW = '/agentic/guardian-angel/view'
export const MY_ANGELS_TAB = '/agentic/guardian-angel?tab=mine'
export const UNREACHABLE = "Couldn't reach Kin-Keepers.ai. Check your internet connection."
export const CONNECTION_ENDED = 'Your Kin-Keepers.ai connection has ended. Connect again.'

export function addResultMessage(result: AddAngelResult): string {
  switch (result.status) {
    case 'added': return `Added ${result.angel.name} to My Guardian Angels.`
    case 'disconnected': return CONNECTION_ENDED
    case 'not-found': return 'That template is no longer available.'
    default: return UNREACHABLE
  }
}
