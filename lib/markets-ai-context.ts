// MK2/AI — the structured context the model narrates from (server). Every
// number here is read from our own modules: the deep candle series
// (lib/candles-server), the 26-indicator table (lib/technicals), the news
// ladder (lib/news), the session (lib/markets), and — for the uncached
// position paragraph only — the wallet view (lib/wallet-view) plus the
// Hyperliquid snapshot. The model never fetches; it gets this and writes.

import { changePct24h, chartPairFor, type ChartPair, type ChartTf } from './charts'
import { loadCandleSeries, resolveTf, type LoadedSeries } from './candles-server'
import { computeTechnicals, RATING_LABELS, type Technicals } from './technicals'
import { getNews } from './news'
import { performanceFromCandles, sessionState, stats24h, symbolName } from './markets'
import { chipMenu, tapeSymbols, venueWordsFor, type AiChip, type BriefContext, type PositionContext, type TapeRow } from './markets-ai'
import type { SymbolPosition } from './symbol-position'
import { RATING_LABELS as RATING_WORDS } from './technicals'
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
    // Words, not ids: the live proof read "signaling a strong_sell".
    summary: RATING_LABELS[t.summary.rating],
    oscillators: RATING_LABELS[t.oscillators.rating],
    movingAverages: RATING_LABELS[t.movingAverages.rating],
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
    venues: venueWordsFor(pair, last),
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

// ── EXEC's position route, hopped server-side ───────────────────────────────
// `GET /api/markets/position` composes spot (every app chain) + the HL
// clearinghouse + Aave + Lido, and returns Pantessa's own standing rows
// (DCA · guardian · spot guard) ONLY to the wallet's own SIWE session (QA-3,
// rule 6). The brief route forwards the request's cookie so an own-session
// caller gets them and a stranger gets them NAMED as private. On any hop
// failure the chain-only reader above answers (fail-soft, never a 500).
export async function readSymbolPosition(origin: string, cookie: string | null, pair: ChartPair, address: `0x${string}`, last: number | null, change24hPct: number | null): Promise<PositionContext> {
  try {
    const res = await fetch(`${origin}/api/markets/position?symbol=${encodeURIComponent(pair.symbol)}&address=${address}`, {
      headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`position ${res.status}`)
    const p = (await res.json()) as SymbolPosition
    const rows: PositionContext['rows'] = []
    for (const h of p.spot) {
      const existing = rows.find((r) => r.chain === h.chainName)
      if (existing) {
        existing.amount += h.balance
        if (h.valueUsd != null) existing.valueUsd = (existing.valueUsd ?? 0) + h.valueUsd
      } else rows.push({ chain: h.chainName, amount: h.balance, valueUsd: h.valueUsd ?? (last ? h.balance * last : null) })
    }
    return {
      symbol: pair.symbol,
      last,
      change24hPct,
      rows,
      perp: p.perp ? { side: p.perp.side, size: p.perp.sizeUnits, markPx: p.perp.markPx ?? p.perp.entryPx, pnlUsd: p.perp.pnlUsd, leverage: p.perp.leverage } : null,
      lend: p.lend ? { suppliedUsd: p.lend.suppliedUsd, borrowedUsd: p.lend.borrowedUsd, healthFactor: p.lend.healthFactor } : null,
      stake: p.stake ? { stEth: p.stake.stEth, usd: p.stake.usd, aprPct: p.stake.aprPct } : null,
      privateRows: p.private ?? [],
      failed: p.failed ?? [],
    }
  } catch {
    return readPosition(address, pair, last, change24hPct)
  }
}

// ── The morning tape ────────────────────────────────────────────────────────
/** One row per symbol of the list (deep tape + technicals, all cached by
 *  candles-server) plus a chip menu drawn from the two biggest movers. A
 *  symbol whose tape is down is simply absent from the rows (named in
 *  `missing`), never a zero. */
export async function composeTapeContext(symbolsRaw: readonly string[]): Promise<{ rows: TapeRow[]; menu: AiChip[]; missing: string[] }> {
  const symbols = tapeSymbols(symbolsRaw)
  const reads = await Promise.allSettled(symbols.map((s) => readTape(s, '1d')))
  const rows: TapeRow[] = []
  const missing: string[] = []
  const tapes: TapeRead[] = []
  reads.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) {
      missing.push(symbols[i])
      return
    }
    const t = r.value
    tapes.push(t)
    rows.push({
      symbol: t.pair.symbol,
      name: symbolName(t.pair.symbol),
      last: t.last,
      change24hPct: t.change24hPct,
      verdict: t.tech ? RATING_WORDS[t.tech.summary.rating] : null,
      s1: t.tech?.pivots?.classic.s1 ?? null,
      r1: t.tech?.pivots?.classic.r1 ?? null,
      sessionLine: sessionState(t.pair).line,
    })
  })
  // Chips: the two biggest movers' first buy and sell, then the rest's
  // first chip — the model picks; every one is ladder-filtered.
  const movers = [...tapes].sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
  const menuRaw: AiChip[] = []
  for (const t of movers) {
    const chips = chipMenu({ pair: t.pair, last: t.last, tech: t.tech })
    for (const c of chips.slice(0, menuRaw.length < 4 ? 2 : 1)) menuRaw.push({ ...c, id: `m${menuRaw.length}` })
    if (menuRaw.length >= 10) break
  }
  const { chips: menu } = ladderFilterMenu(menuRaw)
  return { rows, menu: menu.map((c, i) => ({ ...c, id: `m${i}` })), missing }
}
