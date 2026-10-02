// Electron prefixes errors from the main process with the IPC channel name.
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

const CONNECTION_PROBLEM = /Circle service|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|getaddrinfo|socket hang up|network/i
const MAIL_PROBLEM = /Mail API|Failed to send email/i
// Paths, stack frames and internal error codes are never useful to the person reading them.
const INTERNAL_DETAIL = /[A-Za-z]:\|\/Users\/|\/home\/|\n\s+at |\bat .+:\d+:\d+|\bE[A-Z]{3,}\b|SQLITE_|undefined|null|\[object /

export const CONNECTION_MESSAGE = 'Family Circle could not reach the family server. Check your internet connection and try again.'
export const MAIL_MESSAGE = 'The email could not be sent right now. Please try again in a few minutes.'

/** Turns an error from the desktop bridge into a sentence a family member can act on. */
export function userFacingError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw.replace(IPC_PREFIX, '').trim()
  if (!message) return fallback
  if (CONNECTION_PROBLEM.test(message)) return CONNECTION_MESSAGE
  if (MAIL_PROBLEM.test(message)) return MAIL_MESSAGE
  if (INTERNAL_DETAIL.test(message)) return fallback
  return message
}
