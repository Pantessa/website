'use client'

// The 24h range for the symbol header's range bar (MK2/MARKETS): one read of
// the hourly series through the existing candles proxy (5s server TTL), the
// pure stats24h over it, re-read each minute. The header never blocks on it
// — null until it lands, and a feed that never answers leaves the bar out.

import { useEffect, useState } from 'react'
import type { Candle } from '@/lib/charts'
import { stats24h } from '@/lib/markets'

export interface DayStats {
  high: number
  low: number
  volume: number
}

export function useDayStats(symbol: string | null): DayStats | null {
  const [stats, setStats] = useState<DayStats | null>(null)
  useEffect(() => {
    setStats(null)
    if (!symbol) return
    let alive = true
    const run = async () => {
      try {
        const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1h`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { candles?: Candle[]; error?: string }
        if (!alive || body.error || !body.candles?.length) return
        setStats(stats24h(body.candles))
      } catch {
        /* the bar simply stays out */
      }
    }
    void run()
    const id = setInterval(() => void run(), 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [symbol])
  return stats
}
