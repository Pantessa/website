'use client'

// Quotes for the Markets shell — a client hook over the WATCH lane's
// `GET /api/quotes?symbols=…` contract (squad README: batched, ≤15s cache,
// never 500; a missing feed omits the symbol / marks chartable:false).
//
// SHELL builds against the contract before the route exists: while
// /api/quotes is missing the rows degrade to dashes (integration 2026-09-11:
// WATCH's route is the one source; the pre-integration candles fallback is gone).
// Everything else degrades to dashes, never a crash.

import { useEffect, useMemo, useState } from 'react'

export interface Quote {
  last: number
  chg: number
  chgPct: number
  asOf: number
  feed: string
  session: 'open' | 'closed' | '24/7'
  chartable: boolean
  /** Index quotes only: the close the change is measured from and the
   *  printing session's range (lib/quotes indexQuoteFrom). */
  prevClose?: number
  dayHigh?: number
  dayLow?: number
}

export type QuoteMap = Record<string, Quote | undefined>

const REFRESH_MS = 20_000

let quotesRouteMissing = false

interface QuotesRead {
  quotes: QuoteMap
  /** Symbols the venue no longer lists (lib/quotes QuoteRead.unlisted). */
  unlisted: string[]
}

async function fetchQuotes(symbols: string[]): Promise<QuotesRead | null> {
  if (quotesRouteMissing) return null
  try {
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' })
    if (res.status === 404) {
      quotesRouteMissing = true
      return null
    }
    if (!res.ok) return null
    const body = (await res.json()) as { quotes?: QuoteMap; unlisted?: unknown }
    if (!body.quotes) return null
    return { quotes: body.quotes, unlisted: Array.isArray(body.unlisted) ? body.unlisted.filter((s): s is string => typeof s === 'string') : [] }
  } catch {
    return null
  }
}

/** Live quotes for a symbol list; `{}` until the first read lands, and a
 *  symbol stays undefined (→ dashes) when no feed answers. `unlisted` names
 *  the symbols the route said NO market answers to (a venue delisted them) —
 *  a board that lists venue markets by name drops those rows. */
export function useQuotes(symbols: readonly string[]): { quotes: QuoteMap; live: boolean; failed: boolean; unlisted: string[] } {
  const key = symbols.join(',')
  const list = useMemo(() => key.split(',').filter(Boolean), [key])
  const [quotes, setQuotes] = useState<QuoteMap>({})
  const [live, setLive] = useState(false)
  // The last read failed (route down / offline) — a caller can say so instead
  // of waiting on "Reading…" forever. Cleared by the next good read.
  const [failed, setFailed] = useState(false)
  const [unlisted, setUnlisted] = useState<string[]>([])

  useEffect(() => {
    if (list.length === 0) return
    let stopped = false
    const tick = async () => {
      const fromRoute = await fetchQuotes(list)
      if (stopped) return
      if (fromRoute) {
        setQuotes((prev) => ({ ...prev, ...fromRoute.quotes }))
        // Same names → same array, so a board keyed on it does not re-render every poll.
        setUnlisted((prev) => (prev.join() === fromRoute.unlisted.join() ? prev : fromRoute.unlisted))
        setLive(true)
        setFailed(false)
      } else setFailed(true)
    }
    void tick()
    const id = setInterval(() => void tick(), REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [list])

  return { quotes, live, failed, unlisted }
}

/** Price + change formatting shared by rows, headers and tiles. */
export function fmtQuotePrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

/**
 * THE LIVE PRICE'S DECIMALS (2026-10-20, Nate: "show the same decimal in both
 * spots, main header and title"). One ladder for the number that moves with
 * the prints — the symbol strip's last and the tab's title — so a 10s tick
 * on a $7 coin shows (7.1329 → 7.1330), the way Coinbase titles its tab.
 * Thousands keep their separators (the header's $2,365.12); the 24h stats
 * beside it stay on fmtQuotePrice (hour candles, two places is their truth).
 */
export function fmtLivePrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 10_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  if (n >= 0.01) return n.toFixed(5)
  return n.toPrecision(3)
}

/** The tab's title while the chart is live: `$7.1329 · UNI · Pantessa` (the
 *  price leads, as Coinbase does, so a pinned tab reads at a glance); no
 *  price yet → null, the page keeps its SEO title. */
export function liveTabTitle(symbol: string, last: number | null | undefined): string | null {
  if (last == null || !Number.isFinite(last) || !(last > 0)) return null
  return `$${fmtLivePrice(last)} · ${symbol} · Pantessa`
}

/** The same title for a value that is not a dollar price — an index level, a
 *  yield, an FX rate — already formatted the way its header prints it:
 *  `4.837% · US10Y · Pantessa`, `27,495.25 · NDX · Pantessa`. No value → null. */
export function liveTabTitleOf(symbol: string, value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v || v === '—' || !/^\d/.test(v)) return null
  return `${v} · ${symbol} · Pantessa`
}

/** Is this title one of ours (a live value) rather than the page's SEO title
 *  (`… | Pantessa Markets`)? The page tells React's metadata write from its
 *  own. A dollar price, or a bare number for an index (liveTabTitleOf). */
export function isLiveTabTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && /^[$\d]/.test(title) && title.endsWith(' · Pantessa')
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function chgClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return 'mkt-chg--flat'
  return n > 0 ? 'mkt-chg--up' : 'mkt-chg--down'
}
