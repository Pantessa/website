// Pure helpers that turn a source's numbers into a TileViz — server-safe
// (sources.ts) and client-safe (the harness). The client draws; nothing
// here formats money.

import type { MoneyFact, TileViz, VizSlice } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Holdings → the allocation bar: the biggest `keep` slices by USD, the rest
 *  folded into one "other" slice so the legend stays short. Null when nothing
 *  is priced (a bar of unknowns would be a lie). */
export function allocationViz(
  rows: { symbol: string; valueUsd: number | null | undefined; chain?: string | null }[],
  keep = 5,
): Extract<TileViz, { kind: 'allocation' }> | null {
  const priced = rows
    .filter((r): r is { symbol: string; valueUsd: number; chain?: string | null } => typeof r.valueUsd === 'number' && Number.isFinite(r.valueUsd) && r.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd)
  if (priced.length === 0) return null
  // Same symbol on several chains is one slice (ETH on Base + ETH on Arbitrum
  // → "ETH"): the bar is about WHAT you hold; the rows say where.
  const bySymbol = new Map<string, number>()
  for (const r of priced) bySymbol.set(r.symbol, (bySymbol.get(r.symbol) ?? 0) + r.valueUsd)
  const merged = [...bySymbol.entries()].sort((a, b) => b[1] - a[1])
  const head = merged.slice(0, keep)
  const tail = merged.slice(keep)
  const slices: VizSlice[] = head.map(([symbol, usd]) => ({ label: symbol, symbol, usd: round2(usd) }))
  const rest = tail.reduce((n, [, usd]) => n + usd, 0)
  if (rest > 0) slices.push({ label: `${tail.length} more`, usd: round2(rest) })
  const totalUsd = round2(merged.reduce((n, [, usd]) => n + usd, 0))
  return { kind: 'allocation', slices, totalUsd }
}

/** "$20.13" / "20.13" / "$1,204.50" → 20.13 / 1204.5; anything else → null.
 *  Sources that receive pre-formatted USD strings (Aave) recover the number
 *  for the chart only — the display row keeps the string verbatim. */
export function usdOfString(s: string | null | undefined): number | null {
  if (typeof s !== 'string') return null
  const n = Number(s.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Protocol receipt tokens the WALLET holdings card must not count — the
 *  protocol's own card owns that money (Aave aTokens, Lido stETH/wstETH,
 *  Morpho vault shares). ETH + USDC are excluded separately: the briefing's
 *  funding scan owns them on every scan chain. */
export const RECEIPT_TOKEN_RE = /^(a[A-Z]|aBas|aArb|aEth|aOpt|aPol|st|wst|m[A-Z]|mw|steak)/

const SCAN_OWNED = new Set(['ETH', 'WETH', 'USDC', 'USDBC'])

/** The long tail a holdings card owns on the money map: priced, not
 *  ETH/USDC (the scan's), not a receipt token (the protocol's). */
export function holdingsFacts(
  rows: { symbol: string; valueUsd: number | null | undefined; chain?: string | null }[],
  where?: string,
): MoneyFact[] {
  const facts: MoneyFact[] = []
  for (const r of rows) {
    const usd = typeof r.valueUsd === 'number' ? r.valueUsd : NaN
    if (!(usd > 0)) continue
    const sym = r.symbol.toUpperCase()
    if (SCAN_OWNED.has(sym) || RECEIPT_TOKEN_RE.test(r.symbol)) continue
    facts.push({ bucket: 'spot', usd: round2(usd), label: `${r.symbol} on ${r.chain ?? where ?? 'chain'}` })
  }
  return facts
}
