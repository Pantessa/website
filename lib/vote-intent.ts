// Parse a chat message for a Snapshot vote intent — "vote For on aave.eth",
// "cast my vote against 0xabc…", "vote yes". Pure + unit-tested. The orchestrator
// uses this to decide whether to resolve a proposal and call prepare_vote.

import { resolveOrdinalFromOffers, resolveTitleFromOffers, type WorkingContext } from './working-context'

export interface VoteIntent {
  isVote: boolean
  proposalId?: string // 0x… 64-hex, when explicit
  choiceText?: string // "for" | "against" | "abstain" | "option 2" | a label
  spaceHint?: string // e.g. "aave.eth"
}

const VOTE_VERB = /\b(?:vote|voting|cast(?:ing)?\s+(?:a\s+|my\s+)?vote)\b/i
const CHOICE_WORDS =
  'for|against|abstain|yes|no|yea|nay|approve|approving|reject|rejecting|support|supporting|oppose|opposing|in favou?r'

export function parseVoteIntent(message: string): VoteIntent {
  const text = message.trim()
  const hasVerb = VOTE_VERB.test(text)

  const proposalId = text.match(/0x[a-fA-F0-9]{64}/)?.[0]
  const spaceHint = text.match(/\b([a-z0-9][a-z0-9-]*\.eth)\b/i)?.[1]?.toLowerCase()

  // Choice: an explicit "option/choice N" (verb-free — it's a direct answer to a
  // choice prompt), or a choice WORD which only counts WITH the verb (so "approve
  // this" / "I'm for it" don't falsely read as a vote).
  let choiceText: string | undefined
  const optionMatch = text.match(/\b(?:option|choice)\s+(\d+)\b/i)
  if (optionMatch) {
    choiceText = `option ${optionMatch[1]}`
  } else if (hasVerb) {
    const wordMatch =
      text.match(new RegExp(`\\bvote\\s+(?:to\\s+)?(${CHOICE_WORDS})\\b`, 'i')) ??
      text.match(new RegExp(`\\b(${CHOICE_WORDS})\\b`, 'i'))
    if (wordMatch) choiceText = normalizeChoiceWord(wordMatch[1].toLowerCase())
  }

  // A vote intent is: the verb + (a choice or a proposal), OR an UNAMBIGUOUS
  // continuation even without the verb — a bare proposal id, or an explicit
  // "option/choice N". The route is stateless (no chat history), so when the
  // clarifying reply asks the user to "paste the proposal id" or pick an option,
  // that follow-up must still route to the vote flow instead of looping in
  // generic MCP planning (the repeating-questions bug). A bare choice word or a
  // lone DAO name stays NOT a vote — too ambiguous without history.
  const isVote = (hasVerb && (!!choiceText || !!proposalId)) || !!proposalId || !!optionMatch
  return { isVote, proposalId, choiceText, spaceHint }
}

// ── Working-context resolution (invariant #11) ───────────────────────────────

export interface VoteReference {
  proposalId: string
  title?: string
  space?: string
  /** The message's number picked a PROPOSAL off the offered list — its
   *  "option N" reading is spent, so it must not double as choice N. */
  pickedByNumber?: boolean
}

/**
 * Pin the proposal a vote intent refers to against the STRUCTURED working
 * context — the pending vote, then the numbered list the user was shown
 * (ordinal → title → sole offer) — exactly like the free governance path
 * (lib/governance.ts step 1b). Returns null when nothing pins, so the caller
 * falls back to its stateless resolve. Pure + tested.
 */
export function resolveVoteReference(
  message: string,
  intent: VoteIntent,
  ctx: WorkingContext | undefined,
): VoteReference | null {
  if (intent.proposalId) return { proposalId: intent.proposalId, space: intent.spaceHint }
  if (!ctx) return null
  const pending = ctx.pending?.kind === 'vote' ? ctx.pending : undefined
  if (pending?.data.proposalId) {
    return { proposalId: pending.data.proposalId, title: pending.data.title, space: pending.data.space ?? intent.spaceHint }
  }
  if (ctx.offers?.kind !== 'proposal') return null
  const byOrdinal = resolveOrdinalFromOffers(message, ctx)
  const offered =
    byOrdinal ??
    resolveTitleFromOffers(message, ctx) ??
    // A bare choice ("vote yes") with exactly ONE offered proposal — that's the
    // one. The user still signs explicitly, so a wrong pick can't move money.
    (ctx.offers.items.length === 1 && intent.choiceText ? ctx.offers.items[0] : undefined)
  if (!offered) return null
  return {
    proposalId: offered.id,
    title: offered.title,
    space: offered.data?.spaceId ?? intent.spaceHint,
    pickedByNumber: !!byOrdinal && /^option \d+$/i.test(intent.choiceText ?? ''),
  }
}

// Collapse inflected synonyms to the canonical word the MCP's resolver knows.
function normalizeChoiceWord(w: string): string {
  if (/^approv/.test(w)) return 'approve'
  if (/^reject/.test(w)) return 'reject'
  if (/^support/.test(w)) return 'support'
  if (/^oppos/.test(w)) return 'oppose'
  if (/favou?r/.test(w)) return 'for'
  return w
}
