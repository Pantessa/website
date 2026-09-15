'use client'

// 7-day sparkline closes for the index ledger (MK2 R2) — a client hook over
// VIZ's `GET /api/markets/viz/sparks?symbols=` (≤60 per request, 10-min
// server cache; a feed miss lists the symbol in `missing`, never a flat
// array). Batched per 60; `{}` until the first read lands; a symbol with no
// spark simply draws nothing (never a crash, never a fake flat line).

import { useEffect, useMemo, useState } from 'react'

export type SparkMap = Record<string, number[] | undefined>

const BATCH = 60
let sparksRouteMissing = false

export function useSparks(symbols: readonly string[]): SparkMap {
  const key = symbols.join(',')
  const list = useMemo(() => key.split(',').filter(Boolean), [key])
  const [sparks, setSparks] = useState<SparkMap>({})
  useEffect(() => {
    if (list.length === 0 || sparksRouteMissing) return
    let stopped = false
    const run = async () => {
      for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH)
        try {
          const res = await fetch(`/api/markets/viz/sparks?symbols=${encodeURIComponent(chunk.join(','))}`, { cache: 'no-store' })
          if (res.status === 404) {
            sparksRouteMissing = true
            return
          }
          if (!res.ok) continue
          const body = (await res.json()) as { sparks?: Record<string, number[]> }
          if (stopped || !body.sparks) return
          setSparks((prev) => ({ ...prev, ...body.sparks }))
        } catch {
          /* the column stays empty for this chunk */
        }
      }
    }
    void run()
    return () => {
      stopped = true
    }
  }, [list])
  return sparks
}
