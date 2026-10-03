export interface AuditGateResult {
  ok: boolean
  blocking: Array<{ id: string; name: string; title: string; severity: string }>
  allowed: Array<{ id: string; name: string; expires: string }>
  expired: Array<{ id: string; name: string; expires: string | null }>
  unused: string[]
}

export function advisoryId(advisory: unknown): string
export function evaluateAudit(report: unknown, allowlist: unknown, today?: string): AuditGateResult
