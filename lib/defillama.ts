// DEFILLAMA FUNDAMENTALS — the pure half of the /t Technicals tab's
// "Fundamentals" panel: which DefiLlama subject a crypto symbol maps to
// (a PROTOCOL like uniswap, or a CHAIN like Ethereum), which of its metric
// series we draw, and the shapes on the wire. No I/O here — lib/defillama-read
// does the fetching, this file is what the harness pins.
//
// Why a table of rules and not a hand map: DefiLlama lists ~8,300 protocols
// with a `symbol` field, and the mapping has to survive a new listing without
// a deploy. The rules are conservative on purpose — a wrong subject draws a
// stranger's chart under our symbol, so anything ambiguous maps to nothing.

/** The five daily series a subject can carry. `tvl` is a level (drawn as an
 *  area); the rest are daily flows (drawn as bars). */
export type LlamaMetricKey = 'tvl' | 'fees' | 'revenue' | 'holdersRevenue' | 'volume'

export interface LlamaMetricDef {
  key: LlamaMetricKey
  label: string
  /** Level vs daily flow — decides the series type and the 30d roll-up. */
  kind: 'level' | 'flow'
  /** One line for the panel's foot / a tooltip. */
  note: string
}

/** Draw order is chip order. `tvl` leads because every subject carries it. */
export const LLAMA_METRICS: readonly LlamaMetricDef[] = [
  { key: 'tvl', label: 'TVL', kind: 'level', note: 'value locked in the protocol' },
  { key: 'fees', label: 'Fees', kind: 'flow', note: 'paid by users, per day' },
  { key: 'revenue', label: 'Revenue', kind: 'flow', note: 'the protocol keeps, per day' },
  { key: 'holdersRevenue', label: 'Holders revenue', kind: 'flow', note: 'paid to token holders, per day' },
  { key: 'volume', label: 'DEX volume', kind: 'flow', note: 'spot traded, per day' },
]

export const LLAMA_METRIC_KEYS: readonly LlamaMetricKey[] = LLAMA_METRICS.map((m) => m.key)

export function llamaMetricDef(key: LlamaMetricKey): LlamaMetricDef {
  return LLAMA_METRICS.find((m) => m.key === key) ?? LLAMA_METRICS[0]
}

/** A point is [unix seconds (UTC midnight), USD]. */
export type LlamaPoint = [number, number]

export interface LlamaSeries {
  key: LlamaMetricKey
  label: string
  kind: 'level' | 'flow'
  points: LlamaPoint[]
  /** Flows: the last 30 daily points summed. Levels: the latest point. */
  last30d: number | null
  /** Flows: the latest daily point. Levels: same as last30d. */
  latest: number | null
}

export interface LlamaSubject {
  kind: 'protocol' | 'chain'
  /** The API slug (protocol) or the chain's display name (chain). */
  slug: string
  name: string
  /** The public DefiLlama page — attribution is a condition of the free API. */
  url: string
  category?: string
}

export interface LlamaFundamentals {
  symbol: string
  subject: LlamaSubject
  series: LlamaSeries[]
  /** Metric keys the subject does not carry (a 404 / empty chart upstream). */
  missing: LlamaMetricKey[]
  stats: {
    tvl: number | null
    mcap: number | null
    fees30d: number | null
    revenue30d: number | null
    volume30d: number | null
  }
  asOf: string
  cached?: boolean
}

export interface LlamaNoSubject {
  symbol: string
  subject: null
  reason: string
}

export type LlamaFundamentalsApi = LlamaFundamentals | LlamaNoSubject

// ── Subject resolution ────────────────────────────────────────────────────

/** The slice of a `/protocols` row we keep in memory (the full index is ~8k
 *  rows with descriptions; we hold five fields each). */
export interface LlamaProtocolRow {
  slug: string
  name: string
  symbol: string | null
  tvl: number | null
  category: string | null
  /** `parent#uniswap` on a child; the parent slug aggregates every version. */
  parentProtocol: string | null
}

/** The slice of a `/v2/chains` row we keep. */
export interface LlamaChainRow {
  name: string
  tokenSymbol: string | null
  tvl: number | null
}

/** Categories whose rows describe a CHAIN or a FOUNDATION, never the
 *  product the token is for. ETH's only "protocol" is ethereum-foundation;
 *  ARB's are its bridges and the foundation. Those symbols map to their chain. */
export const LLAMA_NON_PRODUCT_CATEGORIES: ReadonlySet<string> = new Set(['Foundation', 'Chain', 'Canonical Bridge', 'CEX', 'Treasury Manager'])

/** A protocol under this TVL is a squat or a farm wearing a big token's
 *  symbol (a $245 "solana-farm" lists SOL). The chain wins instead. */
export const LLAMA_PROTOCOL_MIN_TVL_USD = 1_000_000

/** Bridge rows never LEAD a parent's category (they may still win the pick). */
export const LLAMA_BRIDGE_CATEGORIES: ReadonlySet<string> = new Set(['Bridge', 'Canonical Bridge'])

export const LLAMA_SITE = 'https://defillama.com'

export function normalizeLlamaSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const parentSlug = (p: LlamaProtocolRow): string | null => (p.parentProtocol && p.parentProtocol.startsWith('parent#') ? p.parentProtocol.slice('parent#'.length) : null)

/** The protocol candidates for a symbol, best first: product categories
 *  only, above the TVL floor, by TVL. Exported so the harness can pin the
 *  ranking on a fixture. */
export function llamaProtocolCandidates(symbol: string, protocols: readonly LlamaProtocolRow[]): LlamaProtocolRow[] {
  const sym = normalizeLlamaSymbol(symbol)
  if (!sym) return []
  return protocols
    .filter((p) => (p.symbol ?? '').toUpperCase() === sym)
    .filter((p) => !LLAMA_NON_PRODUCT_CATEGORIES.has(p.category ?? ''))
    .filter((p) => (p.tvl ?? 0) >= LLAMA_PROTOCOL_MIN_TVL_USD)
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
}

/** Resolve a symbol to ONE DefiLlama subject, or null. A protocol wins over
 *  a chain (HYPE → the Hyperliquid protocol, whose fees exist; not the
 *  "Hyperliquid L1" chain row). A child version resolves to its PARENT slug
 *  (uniswap-v3 → uniswap), which is the page that aggregates every version. */
export function pickLlamaSubject(symbol: string, protocols: readonly LlamaProtocolRow[], chains: readonly LlamaChainRow[]): LlamaSubject | null {
  const sym = normalizeLlamaSymbol(symbol)
  if (!sym) return null
  const [top] = llamaProtocolCandidates(sym, protocols)
  if (top) {
    const parent = parentSlug(top)
    const slug = parent ?? top.slug
    // A parent's display name: strip the version suffix the child carries
    // ("Uniswap V3" → "Uniswap"); the reader overwrites it with the API's own
    // name once it has fetched the parent.
    const name = parent ? top.name.replace(/\s+v\d+(\.\d+)?$/i, '') : top.name
    // A parent's category is not on the index. Take the richest child's, but
    // never a bridge's when a product child exists: Hyperliquid's biggest
    // child by TVL is its bridge, and "Hyperliquid · Bridge" is the wrong story.
    const category = (llamaProtocolCandidates(sym, protocols).find((c) => !LLAMA_BRIDGE_CATEGORIES.has(c.category ?? '')) ?? top).category ?? undefined
    return { kind: 'protocol', slug, name, url: `${LLAMA_SITE}/protocol/${slug}`, category }
  }
  const chain = chains
    .filter((c) => (c.tokenSymbol ?? '').toUpperCase() === sym && (c.tvl ?? 0) > 0)
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))[0]
  if (chain) return { kind: 'chain', slug: chain.name, name: chain.name, url: `${LLAMA_SITE}/chain/${encodeURIComponent(chain.name)}` }
  return null
}

// ── Series shaping ────────────────────────────────────────────────────────

const DAY = 86_400

/** Snap a unix second to its UTC day (DefiLlama's TVL points carry the
 *  snapshot's real time; the fee/volume points are already midnight). */
export function llamaDay(ts: number): number {
  return Math.floor(ts / DAY) * DAY
}

/** `[[ts, v], …]` (fees / volume) or `[{date, totalLiquidityUSD|tvl}, …]`
 *  (TVL) → sorted, de-duplicated daily points; junk dropped, never thrown.
 *  Two points on one day keep the later one (a same-day TVL re-snapshot). */
export function parseLlamaChart(raw: unknown): LlamaPoint[] {
  if (!Array.isArray(raw)) return []
  const byDay = new Map<number, number>()
  for (const row of raw) {
    let ts: unknown
    let v: unknown
    if (Array.isArray(row)) [ts, v] = row
    else if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>
      ts = o.date
      v = o.totalLiquidityUSD ?? o.tvl
    }
    const t = typeof ts === 'string' ? Number(ts) : ts
    const n = typeof v === 'string' ? Number(v) : v
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) continue
    byDay.set(llamaDay(t), n)
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0])
}

/** The last N daily points summed (flows) — the panel's "30d" figures. */
export function sumLastDays(points: readonly LlamaPoint[], days: number): number | null {
  if (points.length === 0) return null
  const tail = points.slice(-days)
  return tail.reduce((s, [, v]) => s + v, 0)
}

export function llamaSeries(key: LlamaMetricKey, points: LlamaPoint[]): LlamaSeries | null {
  const def = llamaMetricDef(key)
  if (points.length === 0) return null
  const latest = points[points.length - 1][1]
  return {
    key,
    label: def.label,
    kind: def.kind,
    points,
    last30d: def.kind === 'level' ? latest : sumLastDays(points, 30),
    latest,
  }
}

/** The two metrics a subject opens on: TVL plus the richest flow it carries
 *  (fees before revenue before volume). One metric when only one exists. */
export function defaultLlamaPicks(available: readonly LlamaMetricKey[]): LlamaMetricKey[] {
  const picks: LlamaMetricKey[] = []
  if (available.includes('tvl')) picks.push('tvl')
  const flow = (['fees', 'revenue', 'volume', 'holdersRevenue'] as const).find((k) => available.includes(k))
  if (flow) picks.push(flow)
  if (picks.length === 0 && available[0]) picks.push(available[0])
  return picks
}

/** The chart's opening window, in days, for a range chip. `all` = 0. */
export const LLAMA_RANGES: readonly { key: '3m' | '1y' | '2y' | 'all'; label: string; days: number }[] = [
  { key: '3m', label: '3M', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: '2y', label: '2Y', days: 730 },
  { key: 'all', label: 'All', days: 0 },
]
export type LlamaRange = (typeof LLAMA_RANGES)[number]['key']

/** Points inside the range, measured back from the LAST point (not from
 *  now — a subject whose feed lags a day still opens on a full window). */
export function windowPoints(points: readonly LlamaPoint[], range: LlamaRange): LlamaPoint[] {
  const days = LLAMA_RANGES.find((r) => r.key === range)?.days ?? 0
  if (days <= 0 || points.length === 0) return [...points]
  const end = points[points.length - 1][0]
  const from = end - days * DAY
  return points.filter(([t]) => t >= from)
}

/** Which of the wire's series the panel may draw together: at most two, the
 *  first on the left axis, the second on the right. A third pick replaces the
 *  oldest. Pure so the chip logic is pinnable. */
export function togglePick(picks: readonly LlamaMetricKey[], key: LlamaMetricKey): LlamaMetricKey[] {
  if (picks.includes(key)) {
    const next = picks.filter((k) => k !== key)
    return next.length === 0 ? [...picks] : next // never draw nothing
  }
  return picks.length >= 2 ? [picks[1], key] : [...picks, key]
}
