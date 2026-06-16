// Client/server-shared types + helpers for the Snapshot vote-signing flow.
//
// The snapshot MCP's `prepare_vote` tool returns a `sign_vote` payload carrying
// the canonical Snapshot EIP-712 typed data. The chat surfaces it as
// Message.meta.voteRequest; <SignVoteButton> turns it into a wallet signature
// (the VOTER signs — voting power is bound to their address) and relays the
// signed envelope to the Snapshot sequencer via /api/snapshot/relay.

export interface VoteTypedData {
  domain: { name: string; version: string }
  types: { Vote: { name: string; type: string }[] }
  primaryType?: string
  message: {
    from: string
    space: string
    timestamp: number
    proposal: string
    choice: number | number[] | string
    reason: string
    app: string
    metadata: string
  }
}

export interface VoteRequest {
  proposal: { id: string; title: string; type: string; choices: string[]; space: string }
  choice: number | number[] | string
  choiceLabels?: string[]
  summary: string
  typedData: VoteTypedData
}

/** Narrow the raw `sign_vote` payload returned by prepare_vote into a VoteRequest. */
export function voteRequestFromToolResult(data: unknown): VoteRequest | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.action !== 'sign_vote') return null
  const td = d.typedData as VoteTypedData | undefined
  const proposal = d.proposal as VoteRequest['proposal'] | undefined
  if (!td?.domain || !td?.types?.Vote || !td?.message || !proposal?.id) return null
  return {
    proposal,
    choice: (d.choice ?? td.message.choice) as VoteRequest['choice'],
    choiceLabels: Array.isArray(d.choiceLabels) ? (d.choiceLabels as string[]) : undefined,
    summary: typeof d.summary === 'string' ? d.summary : `Vote on ${proposal.title}`,
    typedData: td,
  }
}

/** Defensive extraction of meta.voteRequest (meta is user-era JSON). */
export function voteRequestOf(meta: unknown): VoteRequest | null {
  if (!meta || typeof meta !== 'object') return null
  const vr = (meta as { voteRequest?: unknown }).voteRequest
  if (!vr || typeof vr !== 'object') return null
  const v = vr as VoteRequest
  if (!v.typedData?.types?.Vote || !v.typedData?.message || !v.proposal?.id) return null
  return v
}

/**
 * Convert the JSON typed data into the exact shape viem/wagmi `signTypedData`
 * hashes: integer (uint*) fields become BigInt. Pure — exported for tests.
 * Snapshot's domain carries only name+version (no chainId/verifyingContract),
 * which viem handles by omitting the absent EIP712Domain fields.
 */
export function toSignable(td: VoteTypedData) {
  const fields = td.types.Vote ?? []
  const message = { ...td.message } as Record<string, unknown>
  for (const f of fields) {
    if (!f.type.startsWith('uint')) continue
    const v = message[f.name]
    if (f.type.endsWith('[]')) {
      if (Array.isArray(v)) message[f.name] = v.map((x) => BigInt(x as number))
    } else if (typeof v === 'number' || typeof v === 'string') {
      message[f.name] = BigInt(v)
    }
  }
  return {
    domain: td.domain,
    types: td.types,
    primaryType: (td.primaryType ?? 'Vote') as 'Vote',
    message,
  }
}
