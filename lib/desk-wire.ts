// lib/desk-wire.ts — THE leg wire between the agent desk and an agent's signer.
//
// Squad contract C1/C2 (~/yeetful/squad-agentdesk-2026-09-23/README.md). Owned by the
// MCP lane; DRIVE writes the batch shape (C2); the `pantessa` SDK mirrors these types in
// `src/desk.ts`; the harness pins the two in sync. Pure — no I/O, no React, no Prisma.
//
// A job step the runner has OFFERED carries exactly one signable artifact shape. `legViewOf`
// turns a raw Jobs-API step into the one view every consumer (SDK, broker_next, the admin
// log) reads, so nobody re-derives "what kind of thing is this" from the artifact by hand.

export type DeskLegKind = 'tx' | 'txChain' | 'hlAction' | 'hlBatch' | 'wait' | 'unknown'

export interface DeskLegView {
  seq: number
  kind: DeskLegKind
  /** One plain sentence: what signing this does ("Bridge 12 USDC from Base to Arbitrum"). */
  summary: string
  /** The signable material, verbatim from the runner — never re-serialized (jsonb/msgpack, #850). */
  artifact: Record<string, unknown> | null
  /** The chain the signature belongs to (EVM id; 1337 for a Hyperliquid L1 action). */
  chainId: number | null
  valueUsd: number | null
  /** ms after which the material must be re-fetched (deadline calldata, HL nonce ~2 min). */
  staleAfterMs: number | null
}

export interface DeskLegResult {
  txHash?: `0x${string}`
  chainId?: number
  /** Hyperliquid: the venue's response to the submitted action(s). */
  orderResponse?: unknown
  /** hlBatch: one entry per member, in order; a missing entry = not submitted. */
  batch?: Array<{ ok: boolean; orderResponse?: unknown; error?: string }>
}

export interface DeskNext {
  leg: DeskLegView | null
  /** Set when there is nothing to sign right now (a wait leg settling, the runner building). */
  waiting: string | null
  retryAfterMs: number | null
  jobStatus: string
}

/** MCP lane: classify a raw Jobs-API step into a DeskLegView. Stub until then. */
export function legViewOf(step: { seq: number; artifact?: unknown; builder?: string; valueUsd?: number | null }): DeskLegView {
  return { seq: step.seq, kind: 'unknown', summary: '', artifact: null, chainId: null, valueUsd: step.valueUsd ?? null, staleAfterMs: null }
}
