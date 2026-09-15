// FLOW — "where this symbol's money lives across dapps" (VIZ lane). Server
// only. Each source is its own read with its own timeout; a failed read is a
// labelled gap (usd: null + gap), never a zero. Cached 60s per symbol.
// First push = the shape + cache + the fail-soft frame; the venue reads land
// in R1 (see VIZ.md STATUS).

import type { FlowResponse, FlowSource } from '@/components/markets/viz/FlowPanel'

export type { FlowResponse, FlowSource }

export const FLOW_TTL_MS = 60_000

const cache = new Map<string, { at: number; body: FlowResponse }>()
const inflight = new Map<string, Promise<FlowResponse>>()

export type FlowReader = (symbol: string) => Promise<FlowSource | FlowSource[] | null>

/** A read with a deadline: a timeout is a gap in the source's own words. */
export async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)))])
  } finally {
    if (t) clearTimeout(t)
  }
}

export async function readFlow(symbol: string, readers: readonly { id: string; venue: string; measure: string; read: FlowReader }[] = FLOW_READERS, now = Date.now()): Promise<FlowResponse> {
  const hit = cache.get(symbol)
  if (hit && now - hit.at < FLOW_TTL_MS) return { ...hit.body, cached: true }
  const running = inflight.get(symbol)
  if (running) return running
  const p = (async () => {
    const sources = await Promise.all(
      readers.map(async (r): Promise<FlowSource[]> => {
        try {
          const out = await withDeadline(r.read(symbol), 6_000)
          if (out == null) return []
          return Array.isArray(out) ? out : [out]
        } catch (err) {
          return [{ id: r.id, venue: r.venue, measure: r.measure, usd: null, gap: `unread — ${err instanceof Error ? err.message : String(err)}`.slice(0, 80) }]
        }
      }),
    )
    const body: FlowResponse = { symbol, sources: sources.flat(), asOf: Date.now() }
    cache.set(symbol, { at: Date.now(), body })
    return body
  })()
  inflight.set(symbol, p)
  try {
    return await p
  } finally {
    inflight.delete(symbol)
  }
}

/** The venue readers — appended as they land. Order = display order. */
export const FLOW_READERS: { id: string; venue: string; measure: string; read: FlowReader }[] = []
