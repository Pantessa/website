// The market READ door (squad polish, 2026-10-13, DEADENDS lane).
//
// "Why is ETH moving?" is a sentence the product OFFERS — the guide's first
// hint, the ask door's last chip on every symbol page, the empty chat's
// example ("What is the current price and 24h change for ETH?"), the AI bar's
// "What's the trend on screen?". Every one of them fell to the planner, which
// holds no candle feed: the 2026-09-15 tweet stranger tapped "Why is TSLA
// moving?" and read "I don't have access to real-time stock prices… try Yahoo
// Finance". The inventory (scripts/deadend-inventory.ts) counted 27 offered
// sentences with no deterministic answer; this is their door.
//
// Pure: the parser and the words. The chat route and /api/markets/ask read
// the tape (lib/markets-ai-context readTape) and the news ladder (lib/news),
// then hand the facts here. Every number on the reply is one we measured;
// nothing is a forecast and nothing says "I can't".

import { chartPairFor, chartSymbolByName, isMoneyAssetWord, normalizeChartSymbol, type ChartPair } from '@/lib/charts'
import { execAsks } from '@/lib/trade-asks'

export type MarketReadKind = 'move' | 'price' | 'trend' | 'opinion'

export interface MarketReadAsk {
  symbol: string
  kind: MarketReadKind
}

/** Words a "why is X moving" capture can hold that are never a ticker. */
const NOT_A_SYMBOL = new Set(['IT', 'THIS', 'THAT', 'THE', 'MARKET', 'MARKETS', 'CRYPTO', 'EVERYTHING', 'PRICE', 'PRICES', 'MY', 'STOCK', 'STOCKS', 'IT\'S', 'ON', 'SCREEN', 'CHART', 'CANDLES'])

/** A captured word → a charted symbol ("eth", "$TSLA", "apple"), or null. */
function symbolOf(raw: string | undefined): string | null {
  if (!raw) return null
  const word = raw.replace(/^\$/, '').replace(/[?.!,'’]+$/, '')
  const norm = normalizeChartSymbol(word)
  if (!norm || NOT_A_SYMBOL.has(norm)) return null
  // A lowercase word is a market only when it can't be English ("should I
  // buy now" is not ServiceNow): the money-asset fence lib/charts keeps.
  const typedAsTicker = /^[A-Z0-9.]+$/.test(word) || raw.startsWith('$')
  if (!typedAsTicker && !isMoneyAssetWord(word)) return null
  return chartPairFor(norm)?.symbol ?? chartSymbolByName(word) ?? null
}

const MOVE_VERBS = 'moving|up|down|pumping|dumping|dropping|rising|falling|crashing|rallying|spiking|tanking|surging|mooning|bleeding'

/**
 * Is this a READ of one market — its price, its 24h move, the news behind it,
 * the trend on its chart? `symbolHint` is the page's symbol (the AI bar on
 * /t/<sym> asks "what's the trend on screen?" without naming it). Returns
 * null for anything else, including a money imperative ("buy ETH") and a
 * bare "eth price" (the starter door's chart chips answer that).
 */
export function marketReadAsk(text: string, symbolHint?: string | null): MarketReadAsk | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 200 || /\n/.test(raw)) return null
  // Courtesy words never change the read ("can you tell me why ETH is moving").
  let t = raw.replace(/\s+/g, ' ')
  for (let i = 0; i < 3; i++) t = t.replace(/^(?:hey|hi|yo|ok|okay|so|please|pls|can you|could you|would you|tell me|show me|explain)[,!]?\s+/i, '')
  if (/0x[0-9a-f]{6,}|https?:\/\//i.test(t)) return null
  // A read never swallows an order riding the same sentence ("why is ETH
  // moving? buy $10 of it", "…, then long $20 of HYPE"): a sized money verb
  // or a "then" leaves it to the ladder (the jobs compiler, the swap gate).
  if (/\bthen\b|\b(?:buy|sell|swap|long|short|stake|supply|lend|bridge|send|deposit)\s+\$?\d/i.test(t)) return null
  const hint = symbolHint ? chartPairFor(symbolHint)?.symbol ?? null : null
  let m: RegExpMatchArray | null
  // "Why is ETH moving?" · "why is tsla down today" · "why's BTC pumping"
  if ((m = t.match(new RegExp(`^why(?:'s|’s| is| are)\\s+(\\$?[A-Za-z][A-Za-z0-9.]{0,14})\\s+(?:so\\s+)?(?:${MOVE_VERBS})\\b`, 'i')))) {
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'move' } : null
  }
  // "why ETH is moving" (the word order after "tell me")
  if ((m = t.match(new RegExp(`^why\\s+(\\$?[A-Za-z][A-Za-z0-9.]{0,14})\\s+(?:is|are)\\s+(?:so\\s+)?(?:${MOVE_VERBS})\\b`, 'i')))) {
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'move' } : null
  }
  // "What is moving ETH right now — price, 24h change, and the news behind it?"
  if ((m = t.match(/^what(?:'s|’s| is)\s+(?:moving|driving)\s+(\$?[A-Za-z][A-Za-z0-9.]{0,14})\b/i))) {
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'move' } : null
  }
  // "what's going on with HYPE" · "what is happening with apple" · "how is TSLA doing"
  if ((m = t.match(/^(?:what(?:'s|’s| is)\s+(?:going on|happening|up)\s+with|how(?:'s|’s| is)\s+)\s*(\$?[A-Za-z][A-Za-z0-9.]{0,14})(?:\s+doing)?\b/i))) {
    if (/^how/i.test(t) && !/\bdoing\b/i.test(t)) return null
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'move' } : null
  }
  // "What is the current price and 24h change for ETH?" · "what's the price of bitcoin"
  if ((m = t.match(/^what(?:'s|’s| is)\s+(?:the\s+)?(?:current\s+|live\s+|latest\s+)?price(?:\s+and\s+(?:the\s+)?24h\s+change)?\s+(?:of|for|on)\s+(\$?[A-Za-z][A-Za-z0-9.]{0,14})\b/i))) {
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'price' } : null
  }
  // An OPINION about one market ("is TSLA a good trade right now", "should I
  // buy HYPE", "is aapl a buy"). The planner answered these with invented
  // levels — a live sweep (2026-10-13) read "support near $238 and resistance
  // at $265" for TSLA at $378. The honest answer is the tape and the call
  // left to the reader.
  if ((m = t.match(/^(?:is|are)\s+(?:now\s+(?:a\s+)?good\s+time\s+to\s+(?:buy|sell|get)\s+)?(\$?[A-Za-z][A-Za-z0-9.]{0,14})\s+(?:a\s+|an\s+)?(?:good|bad|smart|safe)?\s*(?:buy|sell|trade|investment|entry|bet|long|short)\b/i))) {
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'opinion' } : null
  }
  if ((m = t.match(/^(?:is\s+(?:it|now)\s+(?:a\s+)?(?:good|bad)\s+time\s+to\s+(?:buy|sell|get|long|short)|should\s+I\s+(?:buy|sell|long|short|get|hold|dump|ape(?:\s+into)?)(?:\s+(?:some|more|any))?|what\s+do\s+you\s+think\s+(?:about|of))\s+(\$?[A-Za-z][A-Za-z0-9.]{0,14})\b/i))) {
    const s = symbolOf(m[1])
    return s ? { symbol: s, kind: 'opinion' } : null
  }
  // "What is the trend in the ETH candles on screen?" · "what's the trend?" (on a symbol page)
  if ((m = t.match(/^what(?:'s|’s| is)\s+the\s+(?:trend|setup|read)\b(?:\s+(?:in|on|for|of)\s+(?:the\s+)?(\$?[A-Za-z][A-Za-z0-9.]{0,14}))?/i))) {
    const s = symbolOf(m[1]) ?? hint
    return s ? { symbol: s, kind: 'trend' } : null
  }
  return null
}

export interface MarketReadFacts {
  pair: Pick<ChartPair, 'symbol' | 'label' | 'source'>
  kind: MarketReadKind
  /** The live last price, or null when every feed was down. */
  last: number | null
  change24hPct: number | null
  /** lib/markets-ai-context techSummary — words, not ids. */
  tech: {
    summary: string
    oscillators: string
    movingAverages: string
    rsi: number | null
    sma50: number | null
    sma200: number | null
  } | null
  /** The chart the tech was computed on ('1d' …). */
  tf?: string
  /** Newest first; empty when every hop came back empty; null = not read. */
  news: { title: string; url: string; source: string; age: string }[] | null
  /** The company / coin name ("Tesla") — a headline must name the symbol or
   *  this to be shown (the search feeds return neighbours: a TSLA read once
   *  carried "U.S. Bancorp Stock Looks Below Fair Value"). */
  name?: string
}

/** Does this headline talk about this market? */
export function headlineAbout(title: string, symbol: string, name?: string): boolean {
  const t = ` ${title.toLowerCase()} `
  const sym = symbol.toLowerCase()
  if (new RegExp(`[^a-z0-9$]\\$?${sym.replace(/[^a-z0-9]/g, '')}[^a-z0-9]`).test(t)) return true
  const word = String(name ?? '').toLowerCase().replace(/[,.]/g, '').split(/\s+/).filter((w) => w.length >= 3 && !/^(inc|corp|corporation|the|class|holdings|group|company|co|ltd|plc|token|coin)$/.test(w))[0]
  return !!word && t.includes(word)
}

export function fmtReadPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${Number(n.toPrecision(4))}`
}

const FEED_WORD: Record<string, string> = { coinbase: 'Coinbase spot', hyperliquid: 'Hyperliquid perp', robinhood: 'Robinhood 24/7 stock' }

/** The reply. Every clause is a number we read; a clause whose number is
 *  missing is left out (never estimated), and the reply still answers. */
export function marketReadWords(f: MarketReadFacts): string {
  const sym = f.pair.symbol
  const out: string[] = []
  if (f.kind === 'opinion') out.push(`🧭 That call is yours to make — here's what the ${sym} tape says, with nothing invented.`)
  if (f.last != null) {
    const ch = f.change24hPct
    const move = ch == null ? '' : Math.abs(ch) < 0.05 ? ', flat over 24h' : `, ${ch > 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(2)}% over 24h`
    out.push(`📈 **${sym}** is **${fmtReadPrice(f.last)}**${move} (${FEED_WORD[f.pair.source] ?? f.pair.source} candles).`)
  } else {
    out.push(`📈 The ${sym} feed didn't answer just now — the live chart below keeps polling.`)
  }
  if (f.tech) {
    const tf = f.tf === '1d' || !f.tf ? 'daily' : f.tf
    const avg: string[] = []
    if (f.last != null && f.tech.sma50 != null) avg.push(`${f.last >= f.tech.sma50 ? 'above' : 'below'} its 50-bar average (${fmtReadPrice(f.tech.sma50)})`)
    if (f.last != null && f.tech.sma200 != null) avg.push(`${f.last >= f.tech.sma200 ? 'above' : 'below'} its 200-bar average (${fmtReadPrice(f.tech.sma200)})`)
    const rsi = f.tech.rsi != null ? `, RSI ${f.tech.rsi.toFixed(0)}` : ''
    out.push(`On the ${tf} chart the 26-indicator rating reads **${f.tech.summary}** (moving averages ${f.tech.movingAverages} · oscillators ${f.tech.oscillators}${rsi})${avg.length ? `; price is ${avg.join(' and ')}` : ''}.`)
  }
  if (f.kind !== 'trend') {
    const about = (f.news ?? []).filter((n) => headlineAbout(n.title, sym, f.name))
    if (f.news && about.length) {
      out.push(`In the news:\n${about.slice(0, 3).map((n) => `- [${n.title.replace(/[[\]]/g, '')}](${n.url}) — ${n.source}, ${n.age}`).join('\n')}`)
    } else if (f.news) {
      out.push(`No ${sym} headlines came back from the news feeds just now, so the read above is the tape alone.`)
    }
  }
  out.push('_Computed from our own tape · not advice._')
  return out.join('\n\n')
}

/** The chips under a read: the chart, then the lead buy-side order the
 *  symbol page itself offers (lib/trade-asks — so a stock buys on Robinhood
 *  Chain, a perp longs on Hyperliquid, SOL longs instead of buying a Base
 *  look-alike). Never a sell — a stranger holds nothing to sell. */
export function marketReadChips(pair: ChartPair): { label: string; resume: string }[] {
  const chips: { label: string; resume: string }[] = [{ label: `Show me the ${pair.symbol} chart`, resume: `Show me the ${pair.symbol} chart` }]
  const lead = execAsks(pair, { usd: 25 }).find((a) => a.tone === 'buy')
  if (lead) chips.push({ label: lead.label.replace(/^(Buy|Long) /, `$1 $25 of `), resume: lead.ask })
  return chips
}
