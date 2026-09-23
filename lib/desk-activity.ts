// lib/desk-activity.ts — the desk log read model (UI lane owns; squad contract C5).
//
// One row per broker intent, with its timeline: opened → chosen → consent → job compiled →
// leg N built → signed (claimed by the agent) → verified (the runner's wait leg / receipt)
// → settled → done | failed. `is_internal` rows are returned but flagged, never counted.
// Pure folds live here; the I/O lives in app/api/admin/desk.

export interface DeskLogEvent {
  at: string
  kind: 'opened' | 'chosen' | 'consent' | 'compiled' | 'built' | 'claimed' | 'verified' | 'settled' | 'done' | 'failed' | 'refused'
  seq?: number
  detail?: string
  txHash?: string
  txUrl?: string
  valueUsd?: number | null
}

export interface DeskLogRow {
  intentId: string
  agentHandle: string | null
  ask: string
  wallet: string | null
  status: string
  isInternal: boolean
  openedAt: string
  jobId: string | null
  valueUsd: number | null
  events: DeskLogEvent[]
}
