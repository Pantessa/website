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
  const first = parts[0]
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
  return { lead, details: parts }
}
