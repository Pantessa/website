// THE one door for a market (review R5, R2a, R20; squad called-it, lane FIX).
//
// Every door that keys or stores a symbol (readRecord, the scan, the add, the
// handles list) turns what a caller typed into the spelling the symbol page
// itself canonicalizes to, or a named refusal. Strict characters first
// (letters and digits only, 1 to 12: `B.T.C`, `BTC-`, `^BTC` and `$BTC` are
// refused, never collapsed), then the house resolver the symbol page uses
// (lib/charts resolveChartPair, which collapses WBTC and CBBTC to BTC), then
// the page's own name redirect (`apple` → AAPL). What the resolver answers is
// the one key: six spellings are one record, never six paid scans.
import { chartSymbolByName, resolveChartPair, type ChartPair } from '@/lib/charts'

/** What a caller may type for a market: letters and digits, 1 to 12 (the resolver's own ceiling). */
export const MARKET_RE = /^[A-Za-z0-9]{1,12}$/

export type MarketDoor =
  | { ok: true; symbol: string }
  | { ok: false; http: 400 | 404 | 503; reason: string; next: { label: string; href: string }[] }

export type ResolveFn = (symbol: string) => Promise<Pick<ChartPair, 'symbol'> | null>

const MARKETS = [{ label: 'Markets', href: '/' }]

/** Typed → the canonical symbol, or a named refusal. Never throws. */
export async function marketFor(raw: unknown, opts: { resolve?: ResolveFn; byName?: (s: string) => string | null } = {}): Promise<MarketDoor> {
  const typed = typeof raw === 'string' ? raw.trim() : ''
  if (!MARKET_RE.test(typed)) return { ok: false, http: 400, reason: 'Name a market by its ticker: letters and numbers only, like BTC or AAPL.', next: MARKETS }
  const resolve = opts.resolve ?? resolveChartPair
  const byName = opts.byName ?? chartSymbolByName
  const upper = typed.toUpperCase()
  let pair: Pick<ChartPair, 'symbol'> | null
  try {
    pair = await resolve(upper)
    if (!pair) {
      const named = byName(upper)
      pair = named ? await resolve(named) : null
    }
  } catch {
    return { ok: false, http: 503, reason: 'The market list did not answer. Try again in a moment.', next: MARKETS }
  }
  if (!pair || !MARKET_RE.test(pair.symbol)) return { ok: false, http: 404, reason: `${upper} has no chart here, so there is nothing to pin a post to.`, next: MARKETS }
  return { ok: true, symbol: pair.symbol.toUpperCase() }
}
