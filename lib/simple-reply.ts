// ─────────────────────────────────────────────────────────────────────────
//  Simple-surface reply split — /i only (memory: intent-link-simple-mode).
//
//  A built-artifact reply is one emoji-run paragraph in the thread ("🔏 Swap
//  20 USDC → ~0.010555 ETH via Uniswap v3 on Base (1bps pool), min received
//  … 🔗 Two steps in the card below … ⚠️ Approve USDC to Uniswap's
//  SwapRouter02 first …") — markdown collapses the newlines and a stranger
//  on a link reads router internals before the one button. The chat surface
//  keeps printing exactly that (shared with the embed); on /i we LEAD with
//  the human line and fold the rest behind a details disclosure. Pure so the
//  harness can pin it; null → render the content unchanged.
// ─────────────────────────────────────────────────────────────────────────

export interface SimpleReplySplit {
  /** "Swap 20 USDC → ~0.010555 ETH · on Base · fee 0.5% · your wallet signs" */
  lead: string
  /** The original sentences, one per line, emoji stripped — the disclosure body. */
  details: string[]
}

const EMOJI_LEAD = /^\s*(?:🔏|🔗|⚠️|🚫|✅|🧾|📎|💡|ℹ️)\s*/u

/** Split "🔏 a\n🔗 b ⚠️ c" into ["a","b","c"] — newlines first, then any
 *  emoji that starts a sentence mid-line (the run-together case). */
function sentences(content: string): string[] {
  return content
    .split(/\n+/)
    .flatMap((line) => line.split(/(?=(?:🔏|🔗|⚠️|🚫|✅|🧾)\s)/u))
    .map((s) => s.replace(EMOJI_LEAD, '').trim())
    .filter(Boolean)
}

/**
 * Human lead from a venue summary. Handles the three swap builders' shapes
 * ("… via Uniswap v3 on Base (1bps pool), min received …", "… on Robinhood
 * Chain via its own settlement venue …") plus a plain fallback (text up to
 * the first parenthetical). Returns null when nothing artifact-shaped leads.
 */
export function splitSimpleReply(content: string, chainName?: string | null): SimpleReplySplit | null {
  if (!content || !/^\s*🔏/u.test(content)) return null
  const parts = sentences(content)
  if (parts.length === 0) return null
  // The lead is rendered as TEXT, not markdown: a reply whose first sentence
  // is bold ("**Swap 5 USDC · Base → Arbitrum** · your wallet signs", the
  // cross-chain card) printed its asterisks on /i (measured at 375,
  // mobile-onboarding squad). Strip emphasis markers before cutting.
  const first = stripEmphasis(parts[0])
  // Head = the trade itself: cut at " via " or " on <Chain> via" or the first "(".
  let head = first
  const viaIdx = head.search(/\s+via\s+/i)
  const onIdx = head.search(/\s+on\s+[A-Z][\w ]*?(?:\s+via|\s*\(|,|$)/)
  const parenIdx = head.indexOf(' (')
  const cut = [viaIdx, onIdx, parenIdx].filter((i) => i > 0)
  if (cut.length) head = head.slice(0, Math.min(...cut))
  head = head.replace(/,\s*$/, '').trim()
  if (!head) return null
  const chain = chainName ?? first.match(/\s+on\s+([A-Z][\w]*(?:\s[A-Z][\w]*)?)(?=\s+via|\s*\(|,|$)/)?.[1] ?? null
  const fee = first.match(/incl\.\s*([\d.]+%)\s*Pantessa fee/i)?.[1] ?? first.match(/Pantessa fee\s*\(([\d.]+%)\)/i)?.[1] ?? null
  const lead = [head, chain ? `on ${chain}` : null, fee ? `fee ${fee}` : null, 'your wallet signs'].filter(Boolean).join(' · ')
  return { lead, details: parts.map(stripEmphasis) }
}

/** `**bold**`, `__bold__`, `*em*`, `_em_` and inline code ticks → plain text. */
export function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

// ─────────────────────────────────────────────────────────────────────────
//  The funding-offer turn on /i — "We can make this happen." (2026-09-23).
//
//  The route answers a short wallet with ONE paragraph: the headline, the
//  wallet's every balance in bold, then the plan, then the clarify chips.
//  On a phone that paragraph was the screen (Nate's META screenshot: six
//  holdings and the plan in one 11-line block above the cards). /i leads
//  with the headline and the PLAN, and folds the holdings behind one tap —
//  the words are the route's own, re-ordered, never rewritten. Pure so the
//  harness pins it; null → render the content unchanged.
// ─────────────────────────────────────────────────────────────────────────

export interface FundingHolding {
  /** "~$1806" as the route printed it (null when the row didn't parse). */
  usd: string | null
  token: string | null
  chain: string | null
  /** The route's own words for this row, always. */
  raw: string
}

export interface FundingOfferSplit {
  /** "We can make this happen." */
  headline: string
  /** The sentence(s) before the holdings clause, if any ("You asked for …"). */
  before: string | null
  holdings: FundingHolding[]
  /** "You're holding ≈$3,216 across 5 chains" — the fold's label. */
  holdingsLabel: string
  /** The plan, from the holdings clause on ("This buy needs …"). */
  after: string
}

const OFFER_HEAD = /^\s*🌉\s*\*\*([^*]+)\*\*\s*([\s\S]*)$/u
const HOLDING_ROW = /^(~?\$[\d,.]+[kKmM]?)\s+of\s+([A-Za-z0-9.]+)\s+on\s+(.+)$/

function holdingOf(raw: string): FundingHolding {
  const m = raw.trim().match(HOLDING_ROW)
  return m ? { usd: m[1], token: m[2], chain: m[3].trim(), raw: raw.trim() } : { usd: null, token: null, chain: null, raw: raw.trim() }
}

function usdOf(usd: string | null): number | null {
  if (!usd) return null
  const m = usd.match(/([\d,.]+)([kKmM]?)/)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return m[2].toLowerCase() === 'k' ? n * 1e3 : m[2].toLowerCase() === 'm' ? n * 1e6 : n
}

export function fundingHoldingsLabel(holdings: FundingHolding[]): string {
  const n = holdings.length
  const rows = n === 1 ? '1 balance' : `${n} balances`
  const chains = new Set(holdings.map((h) => h.chain).filter(Boolean)).size
  const usd = holdings.map((h) => usdOf(h.usd))
  const total = usd.every((u) => u !== null) ? usd.reduce((a, b) => (a ?? 0) + (b ?? 0), 0) : null
  const money = total === null ? rows : `≈$${Math.round(total).toLocaleString('en-US')}`
  const where = chains > 1 ? ` across ${chains} chains` : chains === 1 ? ` on ${holdings[0].chain}` : ''
  return `You're holding ${money}${where}`
}

export function splitFundingOfferReply(content: string): FundingOfferSplit | null {
  const m = content.match(OFFER_HEAD)
  if (!m) return null
  const headline = m[1].trim()
  const rest = m[2]
  const h = rest.match(/\*\*([^*]+)\*\*/)
  if (!h || h.index === undefined) return null
  const holdings = h[1].split(/,\s*(?=~?\$)/).map(holdingOf).filter((r) => r.raw)
  if (holdings.length === 0) return null
  // The clause that introduced the list ("You're holding", "— but you're
  // holding") is the fold's label now; whatever came before it stays.
  const before =
    rest
      .slice(0, h.index)
      .replace(/\s*[—–-]?\s*(?:but\s+)?you'?re\s+holding\s*$/i, '')
      .replace(/\*\*/g, '')
      .trim() || null
  // The plan picks up after the list: strip the joining punctuation and
  // start the sentence properly.
  let after = rest
    .slice(h.index + h[0].length)
    .replace(/\*\*/g, '')
    .replace(/^[\s,;:—–-]+/, '')
    .trim()
  if (!after) return null
  after = after.charAt(0).toUpperCase() + after.slice(1)
  return { headline, before, holdings, holdingsLabel: fundingHoldingsLabel(holdings), after }
}
