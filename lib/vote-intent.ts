// Parse a chat message for a Snapshot vote intent — "vote For on aave.eth",
// "cast my vote against 0xabc…", "vote yes". Pure + unit-tested. The orchestrator
// uses this to decide whether to resolve a proposal and call prepare_vote.

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
  if (!VOTE_VERB.test(text)) return { isVote: false }

  const proposalId = text.match(/0x[a-fA-F0-9]{64}/)?.[0]
  const spaceHint = text.match(/\b([a-z0-9][a-z0-9-]*\.eth)\b/i)?.[1]?.toLowerCase()

  // Choice: "vote [to] <word>", or an explicit "option/choice N".
  let choiceText: string | undefined
  const optionMatch = text.match(/\b(?:option|choice)\s+(\d+)\b/i)
  if (optionMatch) {
    choiceText = `option ${optionMatch[1]}`
  } else {
    const wordMatch = text.match(new RegExp(`\\bvote\\s+(?:to\\s+)?(${CHOICE_WORDS})\\b`, 'i'))
    const looseMatch = wordMatch ?? text.match(new RegExp(`\\b(${CHOICE_WORDS})\\b`, 'i'))
    if (looseMatch) choiceText = normalizeChoiceWord(looseMatch[1].toLowerCase())
  }

  // A vote intent needs a verb plus either a choice or an explicit proposal —
  // otherwise "I'll vote later" or "where do I vote?" would falsely trigger.
  const isVote = !!choiceText || !!proposalId
  return { isVote, proposalId, choiceText, spaceHint }
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
