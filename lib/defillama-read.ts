// DEFILLAMA FUNDAMENTALS — the I/O half. Keyless, read-only calls to
// api.llama.fi, composed into lib/defillama's wire shape. Every metric is
// fetched in parallel and fail-soft: a 404 (the subject carries no such
// series) or a timeout drops THAT metric into `missing`, never the whole
// panel. The protocol/chain indexes are held in memory for six hours; a
// composed subject for ten minutes.
//
// Server-only (globalThis caches; fetch with timeouts).

import {
  llamaSeries,
  parseLlamaChart,
  pickLlamaSubject,
  LLAMA_METRIC_KEYS,
  normalizeLlamaSymbol,
  type LlamaChainRow,
  type LlamaFundamentals,
  type LlamaFundamentalsApi,
  type LlamaMetricKey,
  type LlamaProtocolRow,
  type LlamaSeries,
  type LlamaSubject,
} from '@/lib/defillama'

export const LLAMA_API = 'https://api.llama.fi'
const INDEX_TTL_MS = 6 * 60 * 60_000
const SUBJECT_TTL_MS = 10 * 60_000
const FETCH_TIMEOUT_MS = 12_000
const INDEX_TIMEOUT_MS = 20_000

type Indexes = { at: number; protocols: LlamaProtocolRow[]; chains: LlamaChainRow[] }
type Slot = {
  indexes: Indexes | null
  indexesInflight: Promise<Indexes> | null
  subjects: Map<string, { at: number; body: LlamaFundamentalsApi }>
  inflight: Map<string, Promise<LlamaFundamentalsApi>>
}
const g = globalThis as unknown as { __llamaRead?: Slot }
const slot: Slot = (g.__llamaRead ??= { indexes: null, indexesInflight: null, subjects: new Map(), inflight: new Map() })

async function getJson(path: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown | null> {
  const res = await fetch(`${LLAMA_API}${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' }, cache: 'no-store' })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`llama ${res.status} ${path}`)
  return res.json()
}

async function loadIndexes(): Promise<Indexes> {
  const [protocolsRaw, chainsRaw] = await Promise.all([getJson('/protocols', INDEX_TIMEOUT_MS), getJson('/v2/chains', INDEX_TIMEOUT_MS)])
  if (!Array.isArray(protocolsRaw) || !Array.isArray(chainsRaw)) throw new Error('llama index unreadable')
  const protocols: LlamaProtocolRow[] = protocolsRaw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).slug === 'string')
    .map((p) => ({
      slug: String(p.slug),
      name: typeof p.name === 'string' ? p.name : String(p.slug),
      symbol: typeof p.symbol === 'string' && p.symbol !== '-' ? p.symbol : null,
      tvl: typeof p.tvl === 'number' ? p.tvl : null,
      category: typeof p.category === 'string' ? p.category : null,
      parentProtocol: typeof p.parentProtocol === 'string' ? p.parentProtocol : null,
    }))
  const chains: LlamaChainRow[] = chainsRaw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).name === 'string')
    .map((c) => ({ name: String(c.name), tokenSymbol: typeof c.tokenSymbol === 'string' ? c.tokenSymbol : null, tvl: typeof c.tvl === 'number' ? c.tvl : null }))
  return { at: Date.now(), protocols, chains }
}

/** The two indexes, six hours warm; a stale copy serves while a refresh
 *  fails (an index outage must not blank every panel). */
export async function llamaIndexes(): Promise<Indexes> {
  if (slot.indexes && Date.now() - slot.indexes.at < INDEX_TTL_MS) return slot.indexes
  try {
    slot.indexesInflight ??= loadIndexes().finally(() => {
      slot.indexesInflight = null
    })
    slot.indexes = await slot.indexesInflight
    return slot.indexes
  } catch (e) {
    if (slot.indexes) return slot.indexes
    throw e
  }
}

/** Resolve a symbol to its subject through the live indexes. */
export async function resolveLlamaSubject(symbol: string): Promise<LlamaSubject | null> {
  const { protocols, chains } = await llamaIndexes()
  return pickLlamaSubject(symbol, protocols, chains)
}

// ── Per-metric readers ────────────────────────────────────────────────────

type Reader = (s: LlamaSubject) => Promise<{ points: ReturnType<typeof parseLlamaChart>; extra?: Partial<LlamaFundamentals['stats']> & { name?: string } }>

const chartOf = (body: unknown): unknown => (body && typeof body === 'object' ? (body as Record<string, unknown>).totalDataChart : null)

const READERS: Record<LlamaMetricKey, Reader> = {
  async tvl(s) {
    if (s.kind === 'protocol') {
      const body = (await getJson(`/protocol/${encodeURIComponent(s.slug)}`)) as Record<string, unknown> | null
      const points = parseLlamaChart(body?.tvl)
      const mcap = typeof body?.mcap === 'number' ? body.mcap : null
      const name = typeof body?.name === 'string' ? body.name : undefined
      return { points, extra: { mcap, name } }
    }
    const body = await getJson(`/v2/historicalChainTvl/${encodeURIComponent(s.slug)}`)
    return { points: parseLlamaChart(body) }
  },
  async fees(s) {
    const path = s.kind === 'protocol' ? `/summary/fees/${encodeURIComponent(s.slug)}?dataType=dailyFees` : `/overview/fees/${encodeURIComponent(s.slug)}?excludeTotalDataChartBreakdown=true&dataType=dailyFees`
    return { points: parseLlamaChart(chartOf(await getJson(path))) }
  },
  async revenue(s) {
    const path = s.kind === 'protocol' ? `/summary/fees/${encodeURIComponent(s.slug)}?dataType=dailyRevenue` : `/overview/fees/${encodeURIComponent(s.slug)}?excludeTotalDataChartBreakdown=true&dataType=dailyRevenue`
    return { points: parseLlamaChart(chartOf(await getJson(path))) }
  },
  async holdersRevenue(s) {
    // Chain-level holders revenue is not a DefiLlama series.
    if (s.kind !== 'protocol') return { points: [] }
    return { points: parseLlamaChart(chartOf(await getJson(`/summary/fees/${encodeURIComponent(s.slug)}?dataType=dailyHoldersRevenue`))) }
  },
  async volume(s) {
    const path = s.kind === 'protocol' ? `/summary/dexs/${encodeURIComponent(s.slug)}` : `/overview/dexs/${encodeURIComponent(s.slug)}?excludeTotalDataChartBreakdown=true`
    return { points: parseLlamaChart(chartOf(await getJson(path))) }
  },
}

async function compose(symbol: string, subject: LlamaSubject): Promise<LlamaFundamentals> {
  const results = await Promise.allSettled(LLAMA_METRIC_KEYS.map((k) => READERS[k](subject)))
  const series: LlamaSeries[] = []
  const missing: LlamaMetricKey[] = []
  let mcap: number | null = null
  let name = subject.name
  LLAMA_METRIC_KEYS.forEach((key, i) => {
    const r = results[i]
    const s = r.status === 'fulfilled' ? llamaSeries(key, r.value.points) : null
    if (s) series.push(s)
    else missing.push(key)
    if (r.status === 'fulfilled' && r.value.extra) {
      if (typeof r.value.extra.mcap === 'number') mcap = r.value.extra.mcap
      if (r.value.extra.name) name = r.value.extra.name
    }
  })
  const byKey = (k: LlamaMetricKey) => series.find((s) => s.key === k) ?? null
  // A holders-revenue series identical to revenue (Uniswap: every dollar of
  // revenue goes to holders) is real data, but drawing both is one bar twice.
  // Keep it on the wire; the panel decides.
  return {
    symbol,
    subject: { ...subject, name },
    series,
    missing,
    stats: {
      tvl: byKey('tvl')?.latest ?? null,
      mcap,
      fees30d: byKey('fees')?.last30d ?? null,
      revenue30d: byKey('revenue')?.last30d ?? null,
      volume30d: byKey('volume')?.last30d ?? null,
    },
    asOf: new Date().toISOString(),
  }
}

/** The panel's read: cached ten minutes per symbol, one in-flight compose
 *  per symbol, a subject-less answer cached too (a stock or a stable asks
 *  every visit). Throws only when the indexes themselves are unreadable AND
 *  nothing stale is held — the route turns that into a named answer. */
export async function readLlamaFundamentals(symbolRaw: string): Promise<LlamaFundamentalsApi> {
  const symbol = normalizeLlamaSymbol(symbolRaw)
  const hit = slot.subjects.get(symbol)
  if (hit && Date.now() - hit.at < SUBJECT_TTL_MS) return { ...hit.body, ...(hit.body.subject ? { cached: true } : {}) }
  let p = slot.inflight.get(symbol)
  if (!p) {
    p = (async (): Promise<LlamaFundamentalsApi> => {
      const subject = await resolveLlamaSubject(symbol)
      if (!subject) return { symbol, subject: null, reason: `${symbol} has no DefiLlama page — it isn't a protocol or a chain the site tracks.` }
      const body = await compose(symbol, subject)
      // A subject whose EVERY series failed is an outage, not a subject: don't
      // cache it, the next visitor retries.
      if (body.series.length === 0) throw new Error(`llama: no series for ${subject.slug}`)
      return body
    })().finally(() => {
      slot.inflight.delete(symbol)
    })
    slot.inflight.set(symbol, p)
  }
  try {
    const body = await p
    slot.subjects.set(symbol, { at: Date.now(), body })
    return body
  } catch (e) {
    if (hit) return { ...hit.body, ...(hit.body.subject ? { cached: true } : {}) }
    throw e
  }
}
