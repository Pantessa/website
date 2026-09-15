// MK2/AI — the structured context the model narrates from (server). Every
// number here is read from our own modules: the deep candle series
// (lib/candles-server), the 26-indicator table (lib/technicals), the news
// ladder (lib/news), the session (lib/markets), and — for the uncached
// position paragraph only — the wallet view (lib/wallet-view) plus the
// Hyperliquid snapshot. The model never fetches; it gets this and writes.

import { changePct24h, chartPairFor, type ChartPair, type ChartTf } from './charts'
import { loadCandleSeries, resolveTf, type LoadedSeries } from './candles-server'
import { computeTechnicals, type Technicals } from './technicals'
import { getNews } from './news'
import { performanceFromCandles, sessionState, stats24h, symbolName } from './markets'
import { chipMenu, venueWordsFor, type AiChip, type BriefContext, type PositionContext } from './markets-ai'
import { ladderFilterMenu } from './markets-ai-ladder'

export interface TapeRead {
  pair: ChartPair
  tf: ChartTf
  loaded: LoadedSeries
  last: number | null
  change24hPct: number | null
  tech: Technicals | null
}

/** The deep tape + technicals for a symbol. null = chartless (refuse by
 *  name); throws when every feed is down (the route answers a retryable
 *  refusal, never a 500). */
export async function readTape(symbolRaw: string, tfRaw?: string | null): Promise<TapeRead | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair) return null
  const tf = resolveTf(tfRaw)
  const loaded = await loadCandleSeries(pair.symbol, tf, { deep: true })
  if (!loaded) return null
  const candles = loaded.series.candles
  const last = candles.length ? candles[candles.length - 1].c : null
  return { pair, tf, loaded, last, change24hPct: changePct24h(candles), tech: computeTechnicals(candles, tf) }
}

function rowValue(t: Technicals | null, re: RegExp): number | null {
  if (!t) return null
  const r = [...t.rows.oscillators, ...t.rows.movingAverages].find((x) => re.test(x.name))
  return r && Number.isFinite(r.value) ? r.value : null
}

export function techSummary(t: Technicals | null): BriefContext['tech'] {
  if (!t) return null
  return {
    summary: t.summary.rating,
    oscillators: t.oscillators.rating,
    movingAverages: t.movingAverages.rating,
    score: t.summary.score,
    rsi: rowValue(t, /^Relative Strength Index|^RSI/i),
    macd: rowValue(t, /^MACD/i),
    sma50: rowValue(t, /^Simple Moving Average \(50\)/i),
    sma200: rowValue(t, /^Simple Moving Average \(200\)/i),
    s1: t.pivots?.classic.s1 ?? null,
    r1: t.pivots?.classic.r1 ?? null,
    pivot: t.pivots?.classic.p ?? null,
  }
}

/** The whole brief context. The menu is ladder-filtered here so the model
 *  only ever sees chips that build. */
export async function composeBriefContext(tape: TapeRead): Promise<{ ctx: BriefContext; dropped: { ask: string; why: string }[] }> {
  const { pair, tf, loaded, last, tech } = tape
  const candles = loaded.series.candles
  const s24 = stats24h(candles)
  const perfAll = performanceFromCandles(candles)
  const news = await getNews(pair.symbol, 8).catch(() => null)
  const { chips: menu, dropped } = ladderFilterMenu(chipMenu({ pair, last, tech }))
  const ctx: BriefContext = {
    symbol: pair.symbol,
    name: symbolName(pair.symbol),
    pair,
    tf,
    feed: loaded.series.feed,
    sessionLine: sessionState(pair).line,
    last,
    change24hPct: tape.change24hPct,
    high24h: s24?.high ?? null,
    low24h: s24?.low ?? null,
    volume24h: s24?.volume ?? null,
    perf: { '1W': perfAll['1W'], '1M': perfAll['1M'], '3M': perfAll['3M'], YTD: perfAll.YTD, '1Y': perfAll['1Y'] },
    bars: candles.length,
    tech: techSummary(tech),
    news: (news?.items ?? []).map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt })),
    menu,
    venues: venueWordsFor(pair),
  }
  return { ctx, dropped }
}

export function menuFor(tape: TapeRead): AiChip[] {
  return ladderFilterMenu(chipMenu({ pair: tape.pair, last: tape.last, tech: tape.tech })).chips
}

// ── The position (address-keyed, never cached here) ─────────────────────────

const ALIASES: Record<string, string> = { WETH: 'ETH', WBTC: 'BTC', CBBTC: 'BTC' }

/** What this wallet holds in the symbol, across the app chains, plus an
 *  open Hyperliquid perp when the symbol is one. Read-only; the address is
 *  used for the read and never written anywhere. Fail-soft: an unreadable
 *  chain is simply absent. */
export async function readPosition(address: `0x${string}`, pair: ChartPair, last: number | null, change24hPct: number | null): Promise<PositionContext> {
  const rows: PositionContext['rows'] = []
  try {
    const { getWalletViewCached } = await import('./wallet-view')
    const { view } = await getWalletViewCached(address)
    for (const chain of view.chains) {
      for (const h of chain.holdings) {
        const sym = (ALIASES[h.symbol.toUpperCase()] ?? h.symbol.toUpperCase())
        if (sym !== pair.symbol) continue
        const amount = Number(h.balance)
        if (!(amount > 0)) continue
        const existing = rows.find((r) => r.chain === chain.name)
        if (existing) {
          existing.amount += amount
          if (h.valueUsd != null) existing.valueUsd = (existing.valueUsd ?? 0) + h.valueUsd
        } else rows.push({ chain: chain.name, amount, valueUsd: h.valueUsd ?? (last ? amount * last : null) })
      }
    }
  } catch {
    /* fail-soft */
  }
  let perp: PositionContext['perp'] = null
  if (pair.source === 'hyperliquid') {
    try {
      const { fetchHlSnapshot } = await import('./hyperliquid-exec')
      const snap = await fetchHlSnapshot(pair.symbol, address)
      if (snap.positionSzi !== 0) perp = { side: snap.positionSzi > 0 ? 'long' : 'short', size: Math.abs(snap.positionSzi), markPx: snap.markPx }
    } catch {
      /* fail-soft */
    }
  }
  return { symbol: pair.symbol, last, change24hPct, rows, perp }
}
