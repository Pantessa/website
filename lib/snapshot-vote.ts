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
  primaryType: string
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

/** A proposal offered for the connected wallet to vote on — the client renders
 *  one signing button per choice (VoteChoiceButtons). Carried on
 *  Message.meta.voteProposal. */
export interface VoteProposal {
  id: string
  title: string
  space: string
  type: string
  choices: string[]
  /** 1-based choice the user already named, if any (highlighted in the UI). */
  suggestedChoice?: number
}

/** A Snapshot vote choice across all proposal types:
 *  - single-choice / basic → a 1-based index (number)
 *  - approval / ranked-choice → an array of 1-based indices (number[])
 *  - weighted / quadratic → a { "1": weight, "2": weight } map (weights object)
 *  The EIP-712 `choice` field type follows: uint32 · uint32[] · string(JSON). */
export type VoteChoice = number | number[] | Record<string, number>

/** The EIP-712 type + the message value for a choice, per Snapshot's encoding. */
function encodeChoice(choice: VoteChoice): { type: string; value: number | number[] | string } {
  if (Array.isArray(choice)) return { type: 'uint32[]', value: choice } // approval / ranked
  if (typeof choice === 'object') return { type: 'string', value: JSON.stringify(choice) } // weighted / quadratic
  return { type: 'uint32', value: choice } // single-choice / basic
}

/**
 * Build the canonical Snapshot Vote EIP-712 typed data for ANY proposal type.
 * Pure + client/server-shared so the SERVER agent-signer and the CLIENT wallet
 * buttons produce the IDENTICAL payload. `choice` is 1-based (see VoteChoice);
 * the timestamp is stamped at build time (Snapshot rejects stale votes — build
 * right before signing). Proven against the live sequencer.
 */
export function buildVoteTypedData(opts: {
  from: string; space: string; proposalId: string; choice: VoteChoice; reason?: string
}): VoteTypedData {
  const choice = encodeChoice(opts.choice)
  return {
    domain: { name: 'snapshot', version: '0.1.4' },
    types: {
      Vote: [
        { name: 'from', type: 'address' },
        { name: 'space', type: 'string' },
        { name: 'timestamp', type: 'uint64' },
        { name: 'proposal', type: 'bytes32' },
        { name: 'choice', type: choice.type },
        { name: 'reason', type: 'string' },
        { name: 'app', type: 'string' },
        { name: 'metadata', type: 'string' },
      ],
    },
    primaryType: 'Vote',
    message: {
      from: opts.from,
      space: opts.space,
      timestamp: Math.floor(Date.now() / 1000),
      proposal: opts.proposalId,
      choice: choice.value,
      reason: opts.reason ?? '',
      app: 'yeetful',
      metadata: '{}',
    },
  }
}

/** Defensive extraction of meta.voteProposal (meta is user-era JSON). */
export function voteProposalOf(meta: unknown): VoteProposal | null {
  if (!meta || typeof meta !== 'object') return null
  const vp = (meta as { voteProposal?: unknown }).voteProposal
  if (!vp || typeof vp !== 'object') return null
  const v = vp as VoteProposal
  if (typeof v.id !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(v.id) || !Array.isArray(v.choices) || v.choices.length === 0) return null
  return v
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

/**
 * Ambiguous-proposal clarification: the chat couldn't pin one proposal, so it
 * offers a few to pick from. Each carries the FULL id (the chat reply truncates
 * it for display, but the click needs the whole thing) plus the choice the user
 * already stated, so a click re-submits "vote <choice> on <full-id>" — which
 * parseVoteIntent routes straight back into the vote flow. Beats asking the user
 * to paste a 64-hex id they can only see truncated.
 */
export interface VoteCandidate {
  id: string
  title: string
  space: string
}
export interface VoteCandidates {
  choiceText: string
  items: VoteCandidate[]
}

/** Defensive extraction of meta.voteCandidates (meta is user-era JSON). */
export function voteCandidatesOf(meta: unknown): VoteCandidates | null {
  if (!meta || typeof meta !== 'object') return null
  const vc = (meta as { voteCandidates?: unknown }).voteCandidates
  if (!vc || typeof vc !== 'object') return null
  const v = vc as VoteCandidates
  if (!Array.isArray(v.items) || v.items.length === 0) return null
  const items = v.items.filter(
    (i) => i && typeof i.id === 'string' && /^0x[a-fA-F0-9]{64}$/.test(i.id) && typeof i.title === 'string',
  )
  if (items.length === 0) return null
  return { choiceText: typeof v.choiceText === 'string' ? v.choiceText : '', items }
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
 * Map a raw Snapshot/relay failure into a clear, human sentence. Pure + tested.
 * Snapshot's sequencer and the prepare_vote tool return terse, sometimes cryptic
 * strings ("failed", "no voting power", a JSON blob); this turns the common ones
 * into something a chat user can act on. Unknown errors pass through trimmed.
 */
export function friendlyVoteError(raw: unknown): string {
  const msg = (typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '')).trim()
  const m = msg.toLowerCase()
  if (/voting power|vp is 0|0 voting power|no\s+vp\b/.test(m))
    return 'This wallet has no voting power on this proposal — Snapshot counts votes by your token/strategy balance at the proposal’s snapshot block.'
  if (/already voted|duplicate/.test(m))
    return 'This wallet has already voted on this proposal.'
  if (/closed|not active|ended|finished/.test(m))
    return 'Voting on this proposal has closed.'
  if (/not started|pending/.test(m))
    return 'Voting on this proposal hasn’t opened yet.'
  if (/not found|unknown proposal/.test(m))
    return 'That proposal couldn’t be found — check the id or ask for active proposals.'
  if (/expired|timestamp|too old|future/.test(m))
    return 'This vote expired before it was submitted — start the vote again so it’s freshly timestamped.'
  if (/signature|invalid sig|unauthorized|recover/.test(m))
    return 'The signature didn’t verify — sign again with the wallet that holds the voting power.'
  if (/rejected|denied|user rejected/.test(m))
    return 'Signature request declined.'
  // Unknown — surface the raw text (clipped) rather than a vague catch-all.
  return msg ? (msg.length > 160 ? msg.slice(0, 160) + '…' : msg) : 'Voting failed.'
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
