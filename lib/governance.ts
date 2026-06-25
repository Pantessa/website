// ─────────────────────────────────────────────────────────────────────────
//  Governance routing — the engine's Snapshot voting flow, built on the GENERAL
//  EIP-712 signing tool (lib/eip712). The auto-router calls runGovernanceTurn
//  when a message is about proposals/votes; it runs a chain of free tools and
//  emits each as a terminal step so the engine window shows its work:
//
//    resolve_space (name → id) → list_proposals → [vote:] build_eip712 →
//    sign_eip712 (agent or wallet) → relay_vote → read_results
//
//  No x402 spend: Snapshot reads are free and a vote is a gasless signature.
//  The EIP-712 builder here is the Snapshot Vote SCHEMA; the signer (lib/eip712)
//  is schema-agnostic, so other EIP-712 MCPs reuse it with their own builder.
// ─────────────────────────────────────────────────────────────────────────

import type { Eip712TypedData } from './eip712'
import { signEip712, agentSignerAddress, describeTypedData } from './eip712'
import { hasAgentWallet } from './agent-wallet'
import {
  resolveSpaceByName, listActiveProposals, getProposalResults,
  type ActiveProposal, type ProposalResults,
} from './snapshot-read'
import { friendlyVoteError, buildVoteTypedData, type VoteProposal } from './snapshot-vote'

const SEQUENCER = process.env.SNAPSHOT_SEQUENCER_URL ?? 'https://seq.snapshot.org'

// ── Intent detection ─────────────────────────────────────────────────────────
export interface GovernanceIntent {
  kind: 'list' | 'vote'
  spaceQuery?: string // a DAO name or id mentioned ("Nate DAO", "aave.eth")
  proposalId?: string // explicit 0x…64-hex
  choiceText?: string // "for"/"against"/"abstain"/"option 2"
  /** The user explicitly asked their AGENT to vote ("let my agent vote"). */
  agentRequested: boolean
}

const GOV_RE = /\b(proposal|proposals|governance|dao|snapshot|vote|voting)\b/i
const VOTE_RE = /\b(vote|voting|cast)\b/i
const AGENT_RE = /\b(my\s+)?agent\b|\bfor\s+me\b|\bon\s+my\s+behalf\b|let\s+my/i

/** Pull the DAO/space the user named — "for Nate DAO", "in aave.eth",
 *  "proposals on X". Returns the raw phrase; resolveSpaceByName resolves it. */
export function extractSpaceQuery(message: string): string | undefined {
  const id = message.match(/\b([a-z0-9][a-z0-9-]*\.(?:eth|xyz|io|dao))\b/i)?.[1]
  if (id) return id.toLowerCase()
  // "... (for|in|on|of|from) <Name DAO/space> ..." — capture up to a DAO noun.
  const m = message.match(/\b(?:for|in|on|of|from|at)\s+(?:the\s+)?([A-Z0-9][\w'&-]*(?:\s+[A-Z0-9][\w'&-]*){0,3}?\s+(?:DAO|dao|space))\b/)
  if (m) return m[1].trim()
  // "<Name> DAO" anywhere.
  const m2 = message.match(/\b([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,2}\s+DAO)\b/)
  return m2?.[1]?.trim()
}

/** Decide whether (and how) a message is a governance turn. Pure + tested. */
export function detectGovernanceIntent(message: string): GovernanceIntent | null {
  if (!GOV_RE.test(message)) return null
  const proposalId = message.match(/0x[a-fA-F0-9]{64}/)?.[0]
  const spaceQuery = extractSpaceQuery(message)
  const agentRequested = AGENT_RE.test(message)

  // Vote when there's a vote verb + (a choice word or a proposal id), or an
  // explicit "option N". Otherwise it's a read ("any open proposals for X?").
  const choiceText = parseChoice(message)
  const isVote = (VOTE_RE.test(message) && (!!choiceText || !!proposalId)) || /\boption\s+\d+\b/i.test(message)
  if (isVote) return { kind: 'vote', spaceQuery, proposalId, choiceText, agentRequested }
  return { kind: 'list', spaceQuery, proposalId, choiceText, agentRequested }
}

const CHOICE_SYNONYMS: [RegExp, string][] = [
  [/\b(for|yes|yea|approve|approving|support|supporting|in\s+favou?r)\b/i, 'for'],
  [/\b(against|no|nay|reject|rejecting|oppose|opposing)\b/i, 'against'],
  [/\b(abstain|abstaining)\b/i, 'abstain'],
]
function parseChoice(message: string): string | undefined {
  const opt = message.match(/\boption\s+(\d+)\b/i)
  if (opt) return `option ${opt[1]}`
  if (!VOTE_RE.test(message)) return undefined
  for (const [re, canon] of CHOICE_SYNONYMS) if (re.test(message)) return canon
  return undefined
}

/**
 * Map a choice phrase to a 1-based Snapshot choice index against the proposal's
 * labels. "for"/"yes" → the "For" label; "option 2" → 2; a bare label match.
 * Returns null when it can't pin one. Pure + tested.
 */
export function mapChoiceToIndex(choiceText: string | undefined, choices: string[]): number | null {
  if (!choiceText) return null
  const opt = choiceText.match(/^option\s+(\d+)$/i)
  if (opt) {
    const n = Number(opt[1])
    return n >= 1 && n <= choices.length ? n : null
  }
  const t = choiceText.toLowerCase()
  // Direct label match.
  const direct = choices.findIndex((c) => c.toLowerCase() === t)
  if (direct >= 0) return direct + 1
  // Synonym → canonical → label. An unknown word maps to nothing (no default).
  const canon = CHOICE_SYNONYMS.find(([re]) => re.test(t))?.[1]
  if (!canon) return null
  const want = canon === 'for' ? ['for', 'yes', 'approve'] : canon === 'against' ? ['against', 'no', 'reject'] : ['abstain']
  const idx = choices.findIndex((c) => want.some((w) => c.toLowerCase().includes(w)))
  return idx >= 0 ? idx + 1 : null
}

// The Snapshot Vote EIP-712 builder lives in lib/snapshot-vote (client/server
// shared) so the server agent-signer and the client wallet buttons build the
// identical payload. Re-exported here for callers/tests of the governance tool.
export { buildVoteTypedData } from './snapshot-vote'

/** Relay a signed vote envelope to the Snapshot sequencer. Returns the receipt
 *  id on success; throws a friendly error otherwise. */
export async function relayVote(address: string, sig: string, td: Eip712TypedData): Promise<string | null> {
  const envelope = { address, sig, data: { domain: td.domain, types: td.types, message: td.message } }
  const res = await fetch(SEQUENCER, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope), cache: 'no-store',
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    const reason = data && typeof data === 'object' && 'error_description' in data
      ? (data as { error_description: string }).error_description : text
    throw new Error(friendlyVoteError(reason))
  }
  return data && typeof data === 'object' && 'id' in data ? String((data as { id: unknown }).id) : null
}

// ── Trace emit shape (matches the engine's SSE wire) ────────────────────────
export type GovEmit = (e:
  | { type: 'status'; label: string }
  | { type: 'analyze'; intent: string; needs: string[] }
  | { type: 'select'; service: string; endpoint?: string; priceUsd?: string; reason: string }
  | { type: 'tool'; name: string; status: 'run' | 'ok' | 'error'; detail?: string }
  | { type: 'eip712'; scheme: string; signer: string; summary: string }
  | { type: 'note'; level: 'info' | 'warn'; label: string }
) => void

export interface GovernanceResult {
  reply: string
  /** A vote for the human's wallet to sign (wallet mode). Shape matches
   *  Message.meta.voteRequest so SignVoteButton renders it. */
  voteRequest?: unknown
  /** A proposal + its choices for the client to render signing buttons
   *  (wallet mode) — Message.meta.voteProposal → VoteChoiceButtons. */
  voteProposal?: VoteProposal
  cast?: boolean
}

function fmtScores(p: ProposalResults): string {
  if (p.scoresTotal === 0) return '_no votes yet_'
  return p.choices
    .map((c, i) => `${c}: ${p.scores[i] ?? 0}${p.scoresTotal ? ` (${Math.round(((p.scores[i] ?? 0) / p.scoresTotal) * 100)}%)` : ''}`)
    .join(' · ')
}

/**
 * Run a governance turn end-to-end, emitting each tool as a terminal step.
 * agentMode: sign + cast server-side with the agent key ("let my agent vote").
 * Otherwise (a wallet is connected) build the vote for the wallet to sign.
 */
export async function runGovernanceTurn(opts: {
  message: string
  intent: GovernanceIntent
  walletAddress?: string
  emit: GovEmit
}): Promise<GovernanceResult> {
  const { message, intent, walletAddress, emit } = opts

  // Provider selection: governance routes to Snapshot — and unlike paid data MCPs
  // it costs nothing. Surface it like any chosen provider so the terminal shows
  // WHAT we picked and that it's free (public hub reads + a gasless signature).
  emit({
    type: 'select',
    service: 'Snapshot',
    endpoint: 'hub.snapshot.org',
    priceUsd: '0.00',
    reason: 'DAO governance — free hub reads + gasless voting (no x402, no inference)',
  })

  // 1) Resolve the space (name → id) if one was named.
  let spaceId: string | undefined
  let spaceName: string | undefined
  if (intent.spaceQuery) {
    emit({ type: 'tool', name: 'resolve_space', status: 'run', detail: intent.spaceQuery })
    const space = await resolveSpaceByName(intent.spaceQuery)
    if (!space) {
      emit({ type: 'tool', name: 'resolve_space', status: 'error', detail: `no DAO matched “${intent.spaceQuery}”` })
      return { reply: `🗳️ I couldn’t find a DAO matching **${intent.spaceQuery}** on Snapshot. Try its space id (e.g. \`aave.eth\`).` }
    }
    spaceId = space.id; spaceName = space.name
    emit({ type: 'tool', name: 'resolve_space', status: 'ok', detail: `${space.name} → ${space.id}` })
  }

  // 2) List active proposals (scoped to the space when known).
  emit({ type: 'tool', name: 'list_proposals', status: 'run', detail: spaceId ?? 'all active' })
  let proposals: ActiveProposal[] = []
  try {
    proposals = await listActiveProposals(spaceId)
  } catch (e) {
    emit({ type: 'tool', name: 'list_proposals', status: 'error', detail: e instanceof Error ? e.message : 'failed' })
    return { reply: '🗳️ Snapshot’s hub didn’t respond — try again in a moment.' }
  }
  emit({ type: 'tool', name: 'list_proposals', status: 'ok', detail: `${proposals.length} active` })

  // ── LIST path: just show the open proposals. ──────────────────────────────
  if (intent.kind === 'list') {
    if (proposals.length === 0) {
      return { reply: spaceName ? `🗳️ No open proposals in **${spaceName}** right now.` : '🗳️ No open proposals found. Name a DAO (e.g. “Nate DAO”).' }
    }
    emit({ type: 'note', level: 'info', label: 'Free — Snapshot hub reads are public; no x402 payment ($0.00).' })
    const lines = proposals.slice(0, 10).map((p) => `· **${p.title}** — \`${p.id.slice(0, 10)}…\``).join('\n')
    const where = spaceName ? ` in **${spaceName}**` : ''
    return { reply: `🗳️ ${proposals.length} open proposal${proposals.length === 1 ? '' : 's'}${where}:\n${lines}\n\nSay e.g. “vote For on ${proposals[0].title}” and I’ll prepare the EIP-712 signature.` }
  }

  // ── VOTE path: pin one proposal, build the EIP-712, sign + cast or hand off. ─
  let target: ActiveProposal | undefined
  if (intent.proposalId) {
    target = proposals.find((p) => p.id === intent.proposalId) ?? { id: intent.proposalId, title: 'proposal', space: { id: spaceId ?? '', name: spaceName ?? '' } }
  } else if (proposals.length === 1) {
    target = proposals[0]
  } else if (proposals.length > 1) {
    // Prefer an exact full-title mention (handles quoted titles like
    // 'vote For on "Agent Loaded with VIRTUAL"'); the longest match wins so a
    // title that's a substring of another doesn't steal it.
    const exact = proposals
      .filter((p) => message.toLowerCase().includes(p.title.toLowerCase()))
      .sort((a, b) => b.title.length - a.title.length)
    if (exact.length >= 1) target = exact[0]
    else {
      // Fuzzy fallback: 2+ shared title words (command words excluded).
      const hits = proposals.filter((p) => messageMentionsTitle(message, p.title))
      if (hits.length === 1) target = hits[0]
    }
  }
  if (!target) {
    const lines = proposals.slice(0, 8).map((p) => `· **${p.title}**`).join('\n')
    return { reply: `🗳️ Which proposal do you want to vote on?\n${lines}` }
  }

  // Fetch the proposal's choices + the space.
  const results = await getProposalResults(target.id)
  const choices = results?.choices ?? []
  const space = target.space.id || spaceId || ''
  const suggested = mapChoiceToIndex(intent.choiceText, choices) ?? undefined

  // Signer: when a wallet is CONNECTED the human signs (choice buttons → wallet
  // popup) — that's the default. Agent server-side signing ("let my agent vote")
  // is the headless case: no wallet connected + an agent key configured. (We
  // don't keyword-sniff "agent" from the message — proposal titles contain it.)
  const agentMode = !walletAddress && hasAgentWallet()

  // ── Wallet mode: hand the proposal to the client so it builds the EIP-712 for
  //    each choice and the user signs in their own wallet. No server signature. ─
  if (!agentMode) {
    if (!walletAddress) {
      return { reply: `🗳️ **${target.title}** — connect your wallet to vote (each choice opens your wallet to sign), or say “let my agent vote” to have your agent cast it.` }
    }
    emit({ type: 'eip712', scheme: 'eip712', signer: `wallet ${walletAddress.slice(0, 6)}…`, summary: `Vote on “${target.title}” — pick a choice to sign` })
    emit({ type: 'note', level: 'info', label: 'Gasless — your wallet signs the vote; no gas, no x402 ($0.00).' })
    const voteProposal: VoteProposal = { id: target.id, title: target.title, space, type: results?.type ?? 'basic', choices, suggestedChoice: suggested }
    const hint = suggested ? ` I’ll pre-highlight **${choices[suggested - 1]}**.` : ''
    return { reply: `🗳️ Ready to vote on **${target.title}** — pick a choice below to sign with your wallet.${hint}`, voteProposal }
  }

  // ── Agent mode (headless): the agent needs a concrete choice to cast. ────────
  if (!suggested) {
    return { reply: `🗳️ **${target.title}** — which choice should the agent cast? ${choices.map((c, i) => `${i + 1}) ${c}`).join('  ')}` }
  }
  const choice = suggested
  const choiceLabel = choices[choice - 1]
  const from = agentSignerAddress()

  // Build the EIP-712 (the general signing tool's input) + sign server-side.
  const td = buildVoteTypedData({ from, space, proposalId: target.id, choice, reason: 'Cast by my Yeetful agent.' })
  emit({ type: 'eip712', scheme: 'eip712', signer: `agent ${from.slice(0, 6)}…`, summary: `${describeTypedData(td)} — ${choiceLabel} on “${target.title}”` })

  // Agent mode: sign server-side + relay.
  emit({ type: 'tool', name: 'sign_eip712', status: 'run', detail: `agent ${from.slice(0, 6)}…` })
  let sig: string
  try {
    sig = await signEip712(td)
  } catch (e) {
    emit({ type: 'tool', name: 'sign_eip712', status: 'error', detail: e instanceof Error ? e.message : 'sign failed' })
    return { reply: `🗳️ The agent couldn’t sign the vote: ${e instanceof Error ? e.message : 'unknown error'}.` }
  }
  emit({ type: 'tool', name: 'sign_eip712', status: 'ok' })

  emit({ type: 'tool', name: 'relay_vote', status: 'run', detail: 'snapshot sequencer' })
  let receiptId: string | null = null
  try {
    receiptId = await relayVote(from, sig, td)
    emit({ type: 'tool', name: 'relay_vote', status: 'ok', detail: receiptId ? receiptId.slice(0, 14) + '…' : 'accepted' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'relay failed'
    emit({ type: 'tool', name: 'relay_vote', status: 'error', detail: msg })
    return { reply: `🗳️ Built + signed the vote, but Snapshot rejected it: **${msg}**\n\n_(The EIP-712 signature verified — this is a Snapshot-side gate, e.g. voting power at the proposal’s snapshot block.)_` }
  }

  // Read back the live tally.
  emit({ type: 'tool', name: 'read_results', status: 'run', detail: target.id.slice(0, 10) + '…' })
  const after = await getProposalResults(target.id)
  emit({ type: 'tool', name: 'read_results', status: 'ok' })
  emit({ type: 'note', level: 'info', label: 'Free — gasless agent signature relayed to Snapshot; no x402 ($0.00).' })
  const tally = after ? `\n\n**Live results** — ${fmtScores(after)}` : ''
  const link = `https://snapshot.box/#/${target.space.id || spaceId}/proposal/${target.id}`
  return {
    reply: `🗳️ ✅ Your agent cast **${choiceLabel}** on **${target.title}**.${tally}\n\n[View on Snapshot](${link})`,
    cast: true,
  }
}

// Words that come from the vote COMMAND, not the proposal title — excluded from
// fuzzy title matching so "vote For on X" doesn't match a title containing "vote".
const COMMAND_WORDS = new Set(['vote', 'voting', 'agent', 'proposal', 'proposals', 'against', 'abstain', 'dao', 'snapshot'])

function messageMentionsTitle(message: string, title: string): boolean {
  // Best-effort: the message contains the title, or shares 2+ of its distinctive
  // 4+ char words (command words excluded).
  const hay = message.toLowerCase()
  if (hay.includes(title.toLowerCase())) return true
  const words = title.toLowerCase().split(/\W+/).filter((w) => w.length >= 4 && !COMMAND_WORDS.has(w))
  return words.filter((w) => hay.includes(w)).length >= 2
}
