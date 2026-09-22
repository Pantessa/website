// lib/ask-failure-shape.ts — the PURE half of lib/ask-failure.ts.
//
// `moneyShaped` is two things at once: the filter that decides what lands in
// `ask_failures`, and the DOOR to the intent net (app/api/chat/route.ts —
// a message that isn't money-shaped never reaches lib/intent-rescue, so it
// can never become chips). That makes it part of the ask grammar, and the
// ladder replica (scripts/ask-ladder.ts) has to read the same rule or the
// audit lies: until 2026-09-21 the replica skipped it and reported CHIPS for
// "put $10 into AAPL", which production answers with planner prose.
//
// It lives here, apart from lib/ask-failure.ts, because that module pulls in
// Prisma and viem — the audits (`npm run audit:asks`, `audit:funding`) and the
// harness need the rule with no database and no RPC. lib/ask-failure.ts
// re-exports it, so there is still exactly ONE definition.

// Verb + evidence-of-money: both required, so "what is a swap?" (no digits,
// no address) and "tell me a joke" never log. The evidence side accepts
// amounts, $, addresses/ENS, marketplace URLs, all-sends, and NFT words —
// the shapes real money asks carry even when no number appears.
// The verb list is also the INTENT NET's door (the route only calls
// lib/intent-rescue for a money-shaped message), so every verb family the net
// knows has to appear here or its chips are unreachable in production. Three
// did not until 2026-09-21 — `earn`/`yield`, `ape`, and `put …into` — so
// "earn yield on my usdc" and "ape $20 into PEPE" fell to the planner while
// audit:asks reported them green, because the replica skipped this gate.
// scripts/audit-asks.ts now pins one probe sentence per family.
const MONEY_VERB_RE =
  /\b(?:send|transfer|swap|sell|buy|bridge|stake|unstake|deposit|withdraw|convert|fund|move|need|want|get\s+me|long|short|list|repay|borrow|supply|protect|mint|pay|(?:re)?tile)\b|\b(?:earn|yield|apy|apr|interest|lend|lending|save|savings)\b|\b(?:ape|yeet|grab|acquire|purchase|invest|pick\s+up|dump|offload|exit|unlend|trade|exchange)\b|\bcash\s+out\b|\b(?:pull|take)\s+out\b|\btop\s+up\b|\bstop[\s-]?loss\b|\btake[\s-]?profit\b|\d+(?:\.\d+)?\s*%\s*(?:stop|drop)\b|\bput\b.*\b(?:into|in\s+to)\b|\bget\b.*\b(?:over\s+to|onto|to)\b/i
const MONEY_EVIDENCE_RE = /\d|\$|0x[0-9a-fA-F]{6,}|\.eth\b|\bnft\b|opensea\.io|\b(?:all|everything|max)\b|\busd[cgte]?\b|\beth\b|\bgas\b/i

// A price with the thing it buys and no verb at all — "$10 of AAPL please",
// "20 bucks of ETH". Real, and common enough that the funded prod queue shows
// it; a verb list can never cover "no verb".
const BARE_AMOUNT_OF_RE =
  /(?:^|\s)\$?\d[\d,]*(?:\.\d+)?\s*(?:dollars?|usd|bucks)?\s+(?:worth\s+of|of|in)\s+\$?[a-zA-Z][a-zA-Z0-9.]{1,11}\b/

// Protection carries no number and no ticker of its own — "protect my UNI
// with a stop" is a money ask with zero `evidence` under the rule above, so
// it fell to the planner, which answered with three invented clarify chips
// that each led nowhere (QA drive `protect/uni`, 2026-09-21). The possessive
// is what separates it from the reference question ("what is a stop loss?"),
// which stays the planner's.
const PROTECT_SHAPE_RE =
  /\b(?:protect|stop[\s-]?loss|take[\s-]?profit)\b[^.?!]*\bmy\b|\bmy\b[^.?!]*\b(?:stop[\s-]?loss|take[\s-]?profit)\b/i

// "fix my gas issue" is the /wallet page's OWN BUTTON LABEL (#763) and `fix`
// is in no verb list, so our own words fell to the planner. Same for a wallet
// that "can't sign". A gas QUESTION stays a read — the net's own question
// fence handles the rest.
const GAS_SHAPE_RE = /\b(?:fix|top\s*up|need|no|out\s+of|more)\b[^.?!]*\bgas\b|\bgas\b[^.?!]*\b(?:on|for)\b|\bcan'?t\s+(?:sign|send|transact)\b/i

/** Pure: does this message look like it wanted money to move? */
export function moneyShaped(message: string): boolean {
  if (MONEY_VERB_RE.test(message) && MONEY_EVIDENCE_RE.test(message)) return true
  return BARE_AMOUNT_OF_RE.test(message) || PROTECT_SHAPE_RE.test(message) || GAS_SHAPE_RE.test(message)
}
