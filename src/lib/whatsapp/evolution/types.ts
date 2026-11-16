export type SessionState = 'disconnected' | 'connecting' | 'connected' | 'unknown'

export interface EvolutionCredentials {
  baseUrl: string
  /** Evolution instance name, not a CRM database identifier. */
  instanceId: string
  token: string
}

export interface SessionSnapshot {
  state: SessionState
  qr: { dataUrl: string; expiresAt: string } | null
  checkedAt: string
}
