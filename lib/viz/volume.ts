// VOLUME — 24h dollar volume per charted symbol, for the MarketMap's cell
// size (VIZ lane). Server only, cached 120s, one inflight read shared.
// Three feeds, each its own failure domain; a symbol no feed answers is
// simply ABSENT (the map sizes it at the median and says so) — never 0.
//   coinbase   /products/<pair>/stats  volume (base, 24h) × last
//   hyperliquid metaAndAssetCtxs       dayNtlVlm (USD)
//   robinhood  batch historicals day/week — the LAST real (non-interpolated)
//              session's volume × close — "last session", the 24/7 token tape
//              has no 24h volume of its own.

import { chartPairFor } from '@/lib/charts'
import { marketSections } from '@/lib/markets'

export const VOLUME_TTL_MS = 120_000
const UA = 'Mozilla/5.0 (compatible; Pantessa/1.0; +https://www.pantessa.com)'
const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const RH_BATCH = 40
const CB_CONCURRENCY = 6
const TIMEOUT_MS = 6_000

export interface VolumeRead {
  /** symbol → 24h (or last-session) dollar volume. */
  volumes: Record<string, number>
  /** Which feed answered each symbol. */
  feeds: Record<string, 'coinbase' | 'hyperliquid' | 'robinhood'>
  asOf: number
  cached?: boolean
}

let cache: { at: number; body: VolumeRead } | null = null
let inflight: Promise<VolumeRead> | null = null

const timed = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })

async function readCoinbase(pairs: { symbol: string; pair: string }[], out: VolumeRead) {
  let i = 0
  const worker = async () => {
    while (i < pairs.length) {
      const p = pairs[i++]
      try {
        const res = await timed(`https://api.exchange.coinbase.com/products/${p.pair}/stats`, { headers: { 'user-agent': UA } })
        if (!res.ok) continue
        const raw = (await res.json()) as { volume?: string; last?: string }
        const v = Number(raw.volume) * Number(raw.last)
        if (v > 0) {
          out.volumes[p.symbol] = v
          out.feeds[p.symbol] = 'coinbase'
        }
      } catch {
        /* this symbol stays absent */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CB_CONCURRENCY, pairs.length) }, worker))
}

async function readHyperliquid(coins: string[], out: VolumeRead) {
  if (!coins.length) return
  try {
    const res = await timed(HL_INFO_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) })
    if (!res.ok) return
    const [meta, ctxs] = (await res.json()) as [{ universe?: { name: string }[] }, { dayNtlVlm?: string }[]]
    const want = new Set(coins)
    meta?.universe?.forEach((u, i) => {
      if (!want.has(u.name)) return
      const v = Number(ctxs?.[i]?.dayNtlVlm)
      if (v > 0) {
        out.volumes[u.name] = v
        out.feeds[u.name] = 'hyperliquid'
      }
    })
  } catch {
    /* the perps stay absent */
  }
}

async function readRobinhood(symbols: string[], out: VolumeRead) {
  for (let i = 0; i < symbols.length; i += RH_BATCH) {
    const chunk = symbols.slice(i, i + RH_BATCH)
    try {
      const res = await timed(`https://api.robinhood.com/marketdata/historicals/?symbols=${encodeURIComponent(chunk.join(','))}&interval=day&span=week&bounds=24_7`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      })
      if (!res.ok) continue
      const raw = (await res.json()) as { results?: { symbol?: string; historicals?: { close_price?: string; volume?: number | string; interpolated?: boolean }[] }[] }
      for (const r of raw.results ?? []) {
        const sym = r.symbol?.toUpperCase()
        if (!sym) continue
        const real = (r.historicals ?? []).filter((h) => !h.interpolated)
        const last = real[real.length - 1]
        const v = last ? Number(last.volume) * Number(last.close_price) : 0
        if (v > 0) {
          out.volumes[sym] = v
          out.feeds[sym] = 'robinhood'
        }
      }
    } catch {
      /* this chunk stays absent */
    }
  }
}

/** Every charted symbol's dollar volume, by feed. */
export async function readVolumes(now = Date.now()): Promise<VolumeRead> {
  if (cache && now - cache.at < VOLUME_TTL_MS) return { ...cache.body, cached: true }
  if (inflight) return inflight
  inflight = (async () => {
    const out: VolumeRead = { volumes: {}, feeds: {}, asOf: Date.now() }
    const cb: { symbol: string; pair: string }[] = []
    const hl: string[] = []
    const rh: string[] = []
    for (const s of marketSections()) {
      for (const r of s.rows) {
        const pair = chartPairFor(r.symbol)
        if (!pair) continue
        if (pair.source === 'coinbase') cb.push({ symbol: r.symbol, pair: pair.pair })
        else if (pair.source === 'hyperliquid') hl.push(pair.symbol)
        else if (pair.source === 'robinhood') rh.push(r.symbol)
      }
    }
    await Promise.all([readCoinbase(cb, out), readHyperliquid(hl, out), readRobinhood(rh, out)])
    out.asOf = Date.now()
    cache = { at: out.asOf, body: out }
    return out
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
