// THE EXECUTIONS STRIP (2026-11-02). Nate: "add the data from Dune to show the
// order executions … split the empty space with the heatmap below to show the
// Dune executions in realtime." The pure half: the words for the strip's
// three honest states, the row's dashes, the explorer link, the age, the
// newest-first ring. WHICH Dune markets an instrument has is the chart's own
// live-feed map (lib/chart-live chartLiveFeed) — one rule, never two — and the
// prints arrive off the chart's ONE relay stream (MarketChart hands each batch
// to the strip's sink), so the strip opens no socket of its own.
//
// Rules kept from the tape: a field the wire does not carry is a dash, never
// a guess (a spot swap has no position effect; a venue without an explorer
// has no link); the credit names Dune only where Dune drew; a market Dune's
// feeds do not carry says so, and says what IS carried, instead of dressing
// another venue's trades as Dune's. Pinned in scripts/exec-strip-pins.ts.

import { APP_CHAINS } from '@/lib/chains'
import { DEX_PRINT_SYMBOLS, type ChartLiveFeed } from '@/lib/chart-live'
import type { ChartSource } from '@/lib/charts'
import type { FeedStatus } from '@/lib/tape-feed'
import type { TapeFill } from '@/lib/tape'

/** Rows the strip keeps on screen, newest first. */
export const STRIP_MAX = 20

/** The head, lettered (no partner mark exists on file). */
export const STRIP_HEAD = 'Executions · Dune'

/** Where Dune's feeds reach today, in words — what an uncovered market is told. */
export function duneCoverageWords(): string {
  return `DEX spot on Ethereum, Base and Arbitrum for ${DEX_PRINT_SYMBOLS.join(', ')} · perps on HyperCore, Lighter and Lighter · Robinhood`
}

/** The words under the head for the state the strip is in. */
export function stripWords(status: FeedStatus | null, feed: ChartLiveFeed | null, source: ChartSource): string {
  if (!feed) {
    return source === 'robinhood'
      ? `no Dune feed for this market yet · the Robinhood tape is one instrument, Dune's xyz stock perps another · Dune streams ${duneCoverageWords()}`
      : `no Dune feed for this market yet · Dune streams ${duneCoverageWords()}`
  }
  switch (status) {
    case 'live':
      return `${feed.label} · live`
    case 'reconnecting':
      return `${feed.label} · reconnecting`
    case 'unconfigured':
      return 'Dune relay has no key · nothing drawn'
    case 'closed':
      return 'Dune stream closed · nothing drawn'
    case 'connecting':
    case 'idle':
    case null:
      return `${feed.label} · connecting`
  }
}

/** The empty row's words: why there is nothing yet. */
export function stripEmptyWords(status: FeedStatus | null, feed: ChartLiveFeed | null): string {
  if (!feed) return 'nothing to show'
  if (status === 'unconfigured' || status === 'closed') return 'nothing drawn'
  return 'waiting for the first execution'
}

/** Position effect: what the fill did to the taker's position. Dune's perp
 *  feeds carry it; a spot swap has none — a dash, never inferred. */
export function effectWords(fill: Pick<TapeFill, 'effect'>): string {
  return fill.effect ?? '—'
}

/** The explorer page for the fill's transaction, when the wire carried a
 *  hash AND the venue has an explorer we pin. Null = no link (the row shows
 *  the hash's first characters, or a dash). */
export function txHref(fill: Pick<TapeFill, 'hash' | 'venue' | 'chainId'>): string | null {
  if (!fill.hash || /^0x0+$/.test(fill.hash)) return null
  if (fill.venue === 'dex') {
    const chain = fill.chainId == null ? null : APP_CHAINS.find((c) => c.id === fill.chainId)
    return chain ? `${chain.explorerTx}${fill.hash}` : null
  }
  if (fill.venue === 'hyperliquid') return `https://app.hyperliquid.xyz/explorer/tx/${fill.hash}`
  return null
}

/** `0x1a2b…9f` for a hash the row shows without a link. */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash
}

/** `3s` · `2m` · `1h` — how long ago the venue stamped the fill. */
export function ageWords(nowMs: number, atMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - atMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

/** Newest first, one row per venue id, cut at `max`. */
export function mergeStripFills(prev: readonly TapeFill[], incoming: readonly TapeFill[], max = STRIP_MAX): TapeFill[] {
  if (!incoming.length) return [...prev]
  const seen = new Set<string>()
  const out: TapeFill[] = []
  for (const f of [...incoming, ...prev].sort((a, b) => b.at - a.at)) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f)
    if (out.length >= max) break
  }
  return out
}
