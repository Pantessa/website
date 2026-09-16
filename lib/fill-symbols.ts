// Fill symbols — which charted symbols a signed trade moved, and which way,
// WITHOUT the sentence that asked for it. Client-safe + pure.
//
// First-party beacons (/chat, /i, the App Mode panels) never carry the prompt
// (chat asks stay private by design), so GET /api/markets/viz/fills had
// nothing to match a /chat swap against and those fills never painted on
// /t/<symbol>. The beacon now carries only tagged symbols — `buy:ETH`,
// `sell:AAPL` — the client derives them from the ask + artifact it already
// holds, and the telemetry route re-allowlists every entry against the
// Markets index before `embed_turns.symbols` stores it.

import { chartPairFor, chartSymbolsIn } from '@/lib/charts'

export type FillSide = 'buy' | 'sell'
export const MAX_FILL_SYMBOLS = 4

/** Artifacts whose fills the chart reads from job steps instead — tagging the
 *  beacon too would paint the same fill twice. */
const UNTAGGED_ARTIFACTS = new Set(['job', 'job-step', 'vote', 'opensea-listing'])

const SELL_VERB_RE = /^(sell|sold|swap|convert|trade|exchange|dump|short|close|exit|unstake|withdraw|redeem)$/i
const BUY_VERB_RE = /^(buy|bought|long|get|acquire|dca|stake|supply|deposit|invest|earn)$/i
/** Words that aren't trades at all: money leaving to someone else. */
const NOT_A_TRADE_RE = /\b(send|transfer|tip|pay)\b/i

/** Word index of the first word matching `re` at or after `from` (the same
 *  word split chartSymbolsIn uses, so indexes line up), or -1. */
function wordIndexOf(text: string, re: RegExp, from = 0): number {
  const words = text.slice(0, 400).replace(/\bS\s*&\s*P(?:\s*500)?\b/gi, ' SPY ').replace(/['’]s\b/gi, '').split(/[^A-Za-z0-9$]+/).filter(Boolean)
  for (let i = Math.max(0, from); i < words.length; i++) if (re.test(words[i])) return i
  return -1
}

/**
 * Tag the charted symbols a trade ask names with a side. "swap $5 of ETH for
 * AAPL" → sell:ETH, buy:AAPL; "buy $10 of AAPL with ETH" → buy:AAPL,
 * sell:ETH; "sell $50 of ETH" → sell:ETH; "2x long HYPE" → buy:HYPE. A send
 * or transfer is not a fill → [].
 */
export function fillSymbolsInAsk(ask: string): string[] {
  const text = ask.trim()
  if (!text || NOT_A_TRADE_RE.test(text)) return []
  const found = chartSymbolsIn(text)
  if (found.length === 0) return []
  const buyAt = wordIndexOf(text, BUY_VERB_RE)
  const sellAt = wordIndexOf(text, SELL_VERB_RE)
  // No trade verb, no trade ("Why is TSLA moving?").
  if (buyAt < 0 && sellAt < 0) return []
  const leadsWithSell = sellAt >= 0 && (buyAt < 0 || sellAt < buyAt)
  const out: string[] = []
  const push = (side: FillSide, symbol: string) => {
    const tag = `${side}:${symbol}`
    if (!out.includes(tag) && !out.some((t) => t.endsWith(`:${symbol}`))) out.push(tag)
  }
  if (leadsWithSell) {
    // sell/swap X (for|to|into) Y — before the pivot sells, after it buys.
    const pivot = wordIndexOf(text, /^(for|to|into)$/i, sellAt)
    for (const f of found) push(pivot >= 0 && f.at > pivot ? 'buy' : 'sell', f.symbol)
  } else {
    // buy X (with|using) Y — before the pivot buys, after it pays.
    const pivot = wordIndexOf(text, /^(with|using)$/i, buyAt)
    for (const f of found) push(pivot >= 0 && f.at > pivot ? 'sell' : 'buy', f.symbol)
  }
  return out.slice(0, MAX_FILL_SYMBOLS)
}

/** The fill tags for one built/signed artifact. A Hyperliquid order names its
 *  own coin and direction — that wins over the sentence; everything else reads
 *  the ask. Job/vote/listing artifacts are never tagged (see above). */
export function fillSymbolsOf(input: { ask?: string | null; meta?: unknown; artifact?: string }): string[] | undefined {
  if (input.artifact && UNTAGGED_ARTIFACTS.has(input.artifact)) return undefined
  const meta = (input.meta ?? {}) as { jobId?: unknown; orderRequest?: { protocol?: unknown; hl?: { expected?: { coin?: unknown; isBuy?: unknown } } } }
  if (typeof meta.jobId === 'string') return undefined
  const hl = meta.orderRequest?.protocol === 'hyperliquid' ? meta.orderRequest.hl?.expected : undefined
  if (hl && typeof hl.coin === 'string' && typeof hl.isBuy === 'boolean') {
    const pair = chartPairFor(hl.coin)
    return pair ? [`${hl.isBuy ? 'buy' : 'sell'}:${pair.symbol}`] : undefined
  }
  const tags = input.ask ? fillSymbolsInAsk(input.ask) : []
  return tags.length ? tags : undefined
}

/** Tags for a trade that names both sides outright (the App Mode swap panel). */
export function fillSymbolsForPair(sellToken: string | null | undefined, buyToken: string | null | undefined): string[] | undefined {
  const out: string[] = []
  const sell = sellToken ? chartPairFor(sellToken) : null
  const buy = buyToken ? chartPairFor(buyToken) : null
  if (sell) out.push(`sell:${sell.symbol}`)
  if (buy && buy.symbol !== sell?.symbol) out.push(`buy:${buy.symbol}`)
  return out.length ? out : undefined
}

/**
 * Server-side allowlist for a self-reported beacon: `side:SYMBOL` entries only,
 * the symbol canonicalized through the chart resolver and accepted by
 * `isAllowed` (the route passes the Markets index), one side per symbol,
 * at most MAX_FILL_SYMBOLS. Anything else is dropped, never stored.
 */
export function sanitizeFillSymbols(raw: unknown, isAllowed: (symbol: string) => boolean = (s) => !!chartPairFor(s)): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw.slice(0, 16)) {
    if (typeof v !== 'string') continue
    const m = /^(buy|sell):([A-Za-z0-9$]{1,13})$/.exec(v.trim())
    if (!m) continue
    const pair = chartPairFor(m[2])
    if (!pair || !isAllowed(pair.symbol)) continue
    if (out.some((t) => t.endsWith(`:${pair.symbol}`))) continue
    out.push(`${m[1].toLowerCase()}:${pair.symbol}`)
    if (out.length >= MAX_FILL_SYMBOLS) break
  }
  return out
}
