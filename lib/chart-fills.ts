'use client'

// YOUR FILLS ON THE CHART — the client side (VIZ lane). A fill is one of the
// wallet's own SIGNED executions on this symbol, read from
// /api/markets/viz/fills (public by address, like /api/wallet). MarketChart
// draws each as a receipt glyph on its bar in the venue's series ink; the
// legend under the chart carries the words + the explorer link.

import { useEffect, useState } from 'react'

export interface FillMarker {
  /** Stable id (the turn / step id). */
  id: string
  /** Unix seconds of the signature. */
  t: number
  side: 'buy' | 'sell'
  usd: number | null
  /** Venue label (Uniswap v3, CoW, Hyperliquid, …) and its stable entity id for the ink. */
  venue: string
  venueId: string
  chainId: number | null
  chain: string | null
  txUrl: string | null
  /** Where the row came from: a chat/embed turn or a job step. */
  source: 'turn' | 'job-step'
}

export interface FillsResponse {
  symbol: string
  address: string
  fills: FillMarker[]
  asOf: number
  cached?: boolean
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** The wallet's fills on a symbol — [] until read, [] with no wallet. Re-reads
 *  every 60s (the server caches 60s per symbol+address). */
export function useSymbolFills(symbol: string, address: string | null | undefined): FillMarker[] {
  const [fills, setFills] = useState<FillMarker[]>([])
  const addr = address && ADDRESS_RE.test(address) ? address.toLowerCase() : null
  useEffect(() => {
    setFills([])
    if (!addr || !symbol) return
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch(`/api/markets/viz/fills?symbol=${encodeURIComponent(symbol)}&address=${addr}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as FillsResponse
        if (alive && Array.isArray(body.fills)) setFills(body.fills)
      } catch {
        /* the chart reads fine without its fills */
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [symbol, addr])
  return fills
}

/** One line per fill: "Bought $12 of AAPL · Uniswap v3 · Robinhood Chain · 09-08 14:02". */
export function fillLabel(f: FillMarker, symbol: string): string {
  const d = new Date(f.t * 1000)
  const when = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  const amt = f.usd != null && Number.isFinite(f.usd) ? ` $${f.usd >= 100 ? Math.round(f.usd).toLocaleString('en-US') : f.usd.toFixed(2)}` : ''
  return `${f.side === 'buy' ? 'Bought' : 'Sold'}${amt} of ${symbol} · ${f.venue}${f.chain ? ` · ${f.chain}` : ''} · ${when}`
}
