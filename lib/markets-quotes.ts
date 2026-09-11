'use client'

// Quotes for the Markets shell — a client hook over the WATCH lane's
// `GET /api/quotes?symbols=…` contract (squad README: batched, ≤15s cache,
// never 500; a missing feed omits the symbol / marks chartable:false).
//
// SHELL builds against the contract before the route exists: while
// /api/quotes 404s, a BOUNDED fallback reads the existing candles proxy for
// at most FALLBACK_MAX symbols (the featured rows), so the page is alive on
// this branch. QA deletes the fallback at integration — grep FALLBACK.
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
}

export type QuoteMap = Record<string, Quote | undefined>

const FALLBACK_MAX = 8
const REFRESH_MS = 20_000

let quotesRouteMissing = false

async function fetchQuotes(symbols: string[]): Promise<QuoteMap | null> {
  if (quotesRouteMissing) return null
  try {
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' })
    if (res.status === 404) {
      quotesRouteMissing = true
      return null
    }
    if (!res.ok) return null
    const body = (await res.json()) as { quotes?: QuoteMap }
    return body.quotes ?? null
  } catch {
    return null
  }
}

// FALLBACK (delete at integration): the candles proxy already returns
// `last` + `changePct24h` per symbol; read it for the first few rows only.
async function fetchFallback(symbols: string[]): Promise<QuoteMap> {
  const out: QuoteMap = {}
  await Promise.all(
    symbols.slice(0, FALLBACK_MAX).map(async (symbol) => {
      try {
        const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1h`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { last?: number | null; changePct24h?: number | null; feed?: string | null; error?: string }
        if (body.error || typeof body.last !== 'number') return
        const chgPct = typeof body.changePct24h === 'number' ? body.changePct24h : 0
        out[symbol] = {
          last: body.last,
          chgPct,
          chg: body.last - body.last / (1 + chgPct / 100),
          asOf: Date.now(),
          feed: body.feed ?? 'candles',
          session: '24/7',
          chartable: true,
        }
      } catch {
        /* dashes */
      }
    }),
  )
  return out
}

/** Live quotes for a symbol list; `{}` until the first read lands, and a
 *  symbol stays undefined (→ dashes) when no feed answers. */
export function useQuotes(symbols: readonly string[]): { quotes: QuoteMap; live: boolean } {
  const key = symbols.join(',')
  const list = useMemo(() => key.split(',').filter(Boolean), [key])
  const [quotes, setQuotes] = useState<QuoteMap>({})
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (list.length === 0) return
    let stopped = false
    const tick = async () => {
      const fromRoute = await fetchQuotes(list)
      if (stopped) return
      if (fromRoute) {
        setQuotes((prev) => ({ ...prev, ...fromRoute }))
        setLive(true)
        return
      }
      const fb = await fetchFallback(list)
      if (stopped) return
      setQuotes((prev) => ({ ...prev, ...fb }))
      setLive(Object.keys(fb).length > 0)
    }
    void tick()
    const id = setInterval(() => void tick(), REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [list])

  return { quotes, live }
}

/** Price + change formatting shared by rows, headers and tiles. */
export function fmtQuotePrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function chgClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return 'mkt-chg--flat'
  return n > 0 ? 'mkt-chg--up' : 'mkt-chg--down'
}
