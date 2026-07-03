// ─────────────────────────────────────────────────────────────────────────
//  Endpoint planner — makes directory services callable without hand-wiring.
//
//  A service in the directory exposes many x402 endpoints (mcp_endpoints).
//  For the ~250 endpoints where agentic.market publishes structured parameter
//  schemas, we can let the inference model PLAN the call: given the user's
//  message and a menu of endpoints (method, path, description, params), it
//  picks at most one endpoint per service and fills the parameter values.
//  We then pay and execute that exact request.
//
//  Services stay the unit of selection in chat; this resolves WHICH endpoint
//  a selected service should serve the message with. Endpoints without
//  parameter schemas stay display-only (we can't construct a valid call).
// ─────────────────────────────────────────────────────────────────────────

import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'

/** Hard ceiling for auto-planned calls — a planner mistake can cost at most this. */
export const SMART_MAX_PER_CALL_USD = 0.05
/** Cap endpoints listed per service in the planner menu (prompt size control). */
const MENU_CAP_PER_SERVICE = 12

/**
 * Curated metadata for a few high-value endpoints whose ingested description /
 * params are too thin for the router to pick + fill. NOT per-asset hardcoding —
 * we enrich the DESCRIPTION (so keyword retrieval + the model surface it) and
 * declare the query PARAM (so the planner fills it, e.g. symbol=ETH); the model
 * still supplies the value. Matched by URL substring.
 */
interface EndpointHint {
  match: RegExp
  description?: string
  addParams?: EndpointParam[]
  /** Rewrite the URL — used to templatize endpoints that agentic.market ingests
   *  with a value baked into the path (e.g. flightaware /flights/UAL123) back
   *  into a parameterizable form (/flights/{ident}) so the planner can fill it. */
  rewriteUrl?: (url: string) => string
}
const ENDPOINT_HINTS: EndpointHint[] = [
  {
    // The canonical crypto spot-price call — keyword-rich so "price of ETH" finds it.
    match: /coinmarketcap\.com\/x402\/v3\/cryptocurrency\/quotes\/latest/i,
    description:
      'Crypto spot price, value & market quote by symbol — current price of ETH, BTC, SOL and any token. Pass symbol; optionally convert currency.',
    addParams: [
      { group: 'query', name: 'symbol', type: 'string', required: true, example: 'ETH' },
      { group: 'query', name: 'convert', type: 'string', required: false, example: 'USD' },
    ],
  },
  {
    match: /coinmarketcap\.com\/x402\/v3\/cryptocurrency\/listing\/latest/i,
    description: 'Latest crypto listings — top coins ranked by market cap, with price, volume and 24h change.',
  },
  {
    match: /coingecko\.com\/api\/v3\/x402\/onchain\/search/i,
    description: 'Search crypto tokens, pools and networks by name or symbol (CoinGecko onchain).',
    addParams: [{ group: 'query', name: 'query', type: 'string', required: true, example: 'ethereum' }],
  },
  {
    // Wolfram|Alpha endpoints ingest with NO param schema, so the planner only
    // sometimes supplies the `i` query (the input), and the call 400s with
    // "Query Parameter i is required" when it doesn't. Declare it required and
    // describe the result endpoint richly so it's the reliable pick over the
    // image (/v1/simple) and XML (/v2/query) variants.
    match: /wolframalpha\.x402\.paysponge\.com\/v1\/result/i,
    description:
      'Wolfram|Alpha computational answer — math, integrals, derivatives, equations, unit conversions, statistics & facts. Returns a concise text result. Pass the full natural-language or math query as i.',
    addParams: [{ group: 'query', name: 'i', type: 'string', required: true, example: 'integrate x^2 sin(x) dx' }],
  },
  {
    // FlightAware "flight by ident" is ingested as concrete sample URLs
    // (/flights/UAL123, /flights/AA95, …) with the flight baked into the path
    // and NO {ident} token — so the planner can't query the user's flight and
    // falls back to the wrong /flights/search/count (which 400s). Templatize it
    // back to /flights/{ident} and declare `ident` so the planner fills it (the
    // model supplies the value, e.g. "UA123"). Excludes /flights/search*.
    match: /stabletravel\.dev\/api\/flightaware\/flights\/(?!search\b)[A-Za-z0-9]+$/i,
    rewriteUrl: (url) => url.replace(/\/flights\/[A-Za-z0-9]+(\?.*)?$/i, '/flights/{ident}'),
    description:
      'Current flight status by ident — on-time, delays, gate, origin & destination for one specific flight. Use the airline code + number (e.g. flight UA123 → ident "UA123", AA95 → "AA95").',
    addParams: [
      { group: 'path', name: 'ident', type: 'string', required: true, example: 'UA123' },
      { group: 'query', name: 'ident_type', type: 'string', required: false, example: 'designator' },
    ],
  },
]

function applyHint(url: string, description: string | null, params: EndpointParam[]): { url: string; description: string | null; params: EndpointParam[] } {
  const hint = ENDPOINT_HINTS.find((h) => h.match.test(url))
  if (!hint) return { url, description, params }
  const merged = hint.addParams
    ? [...params, ...hint.addParams.filter((ap) => !params.some((p) => p.name === ap.name))]
    : params
  return {
    url: hint.rewriteUrl ? hint.rewriteUrl(url) : url,
    description: hint.description ?? description,
    params: merged,
  }
}

/**
 * When a description is missing/thin, synthesize retrieval keywords from the
 * service category + the URL path segments (dropping noise like v3/x402/api/mcp)
 * so the shortlist + planner menu still have signal. Good descriptions pass
 * through untouched. Pure (B20).
 */
export function deriveDescription(description: string | null, category: string | null, url: string): string | null {
  if (description && description.trim().length >= 16) return description
  let pathWords = ''
  try {
    pathWords = new URL(url).pathname
      .replace(/[^a-zA-Z]+/g, ' ')
      .replace(/\b(v\d+|x402|api|mcp|latest|onchain)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    /* ignore */
  }
  const parts = [description?.trim(), category, pathWords].filter((p): p is string => !!p && p.length > 0)
  const synth = parts.join(' · ').trim()
  return synth.length ? synth : description
}

export interface EndpointParam {
  group: 'query' | 'path' | 'body'
  name: string
  type?: string
  description?: string
  example?: unknown
  required?: boolean
}

export interface PlannableEndpoint {
  id: string
  serverSlug: string
  serverName: string
  method: string
  url: string
  description: string | null
  priceUsd: string
  parameters: EndpointParam[]
  /** The service's directory category (e.g. Data, Trading, Travel) — extra
   *  retrieval signal for the shortlist when descriptions are thin (B20). */
  category?: string | null
  /** Capability tags + example queries (R1, LLM-labeled) — semantic retrieval
   *  signal folded into the shortlist haystack so "transcribe audio" matches a
   *  `transcription` service even with zero keyword overlap. */
  tags?: string[]
  exampleQueries?: string[]
  /** Settlement history for this endpoint's host (the engine's feedback signal /
   *  reputation): settled vs failed paid calls, recency, and a 0–1 `rating`
   *  derived from them. Absent = no history (unproven, NOT penalized — the
   *  router still picks it when it's clearly the best fit; rating just ranks
   *  EQUIVALENT MCPs so the engine converges on the reliable/proven one). */
  reliability?: { settled: number; recent: boolean; failed?: number; successRate?: number; rating?: number }
}

/**
 * Usage-driven MCP reputation, 0–1. Success rate dominates; settled volume and
 * recency modulate. No history → 0 (ranks below rated peers, but the keyword
 * shortlist still surfaces it, so cold-start MCPs stay pickable). Pure + tested.
 */
export function computeRating(input: { settled: number; failed: number; recent: boolean }): number {
  const total = input.settled + input.failed
  if (total === 0) return 0
  const successRate = input.settled / total
  const volumeFactor = Math.min(input.settled / 20, 1) // saturates at 20 settled calls
  const recencyFactor = input.recent ? 1 : 0.6
  return Math.max(0, Math.min(1, successRate * (0.6 + 0.25 * volumeFactor + 0.15 * recencyFactor)))
}

export interface PlannedPick {
  endpointId: string
  params: Record<string, string | number | boolean>
}

/**
 * Load the auto-callable endpoints for the given service slugs: parameter
 * schemas present, exact (non-"upto") pricing at or under the ceiling, and a
 * method we can execute. Grouped + capped per service for the planner menu.
 */
export async function loadPlannableEndpoints(slugs: string[]): Promise<PlannableEndpoint[]> {
  if (slugs.length === 0) return []
  const rows = await prisma.mcpEndpoint.findMany({
    where: {
      server: { slug: { in: slugs } },
      method: { in: ['GET', 'POST'] },
      // Either a published param schema, OR a GET we can fetch with no params
      // (a "list all" endpoint like /mlb/players). Param-less GETs are filtered
      // again below to drop any with an unresolved :path token.
      OR: [{ NOT: { parameters: { equals: Prisma.DbNull } } }, { method: 'GET' }],
    },
    include: { server: { select: { slug: true, name: true, category: true, tags: true, exampleQueries: true } } },
    orderBy: { position: 'asc' },
  })

  // Curated (hinted) endpoints are the highest-value calls for a service, but
  // agentic.market often orders them LATE — flightaware's flight-by-ident sits
  // at position ~60, well past MENU_CAP_PER_SERVICE, so it never reaches the
  // menu and the planner falls back to a worse endpoint. Float hinted rows to
  // the front so they always make the cut. Stable sort → position order is
  // preserved within the hinted and non-hinted groups.
  const isHinted = (u: string) => ENDPOINT_HINTS.some((h) => h.match.test(u))
  rows.sort((a, b) => (isHinted(b.url) ? 1 : 0) - (isHinted(a.url) ? 1 : 0))

  const perService = new Map<string, number>()
  const seenShape = new Set<string>()
  const out: PlannableEndpoint[] = []
  for (const r of rows) {
    const price = Number(r.priceUsd)
    // Only exact, known prices within the ceiling — "upto" schemes can charge
    // far more than the listed minimum, so they stay out of auto-planning.
    if (r.scheme === 'upto') continue
    // price 0 is allowed ONLY when explicitly published as "0" (our free,
    // non-gated MCPs) — a null/absent price also numbers to 0 and must NOT
    // silently become plannable.
    const isExplicitlyFree = r.priceUsd === '0'
    if (!Number.isFinite(price) || (price <= 0 && !isExplicitlyFree) || price > SMART_MAX_PER_CALL_USD) continue
    // Curated enrichment (description + declared params) for thin high-value
    // endpoints, applied first so the filter/shape/menu all see the richer form.
    const hinted = applyHint(r.url, r.description, (r.parameters as EndpointParam[] | null) ?? [])
    const url = hinted.url
    const params = hinted.params
    // Thin/empty descriptions get keyword signal from category + path (B20).
    const description = deriveDescription(hinted.description, r.server.category, url)
    // A param-less endpoint is still callable when it's a GET with no path
    // token to fill — a plain fetch (e.g. "list all teams"). buildSmartRequest
    // already builds these (empty query/body). Anything that needs a value we
    // can't supply — a POST body or an unresolved :path/{path} token — stays
    // out (it would only burn a menu slot and resolve to an "unresolved path
    // parameter" refusal). Test the RAW template, not new URL().pathname, which
    // percent-encodes "{" → "%7B" and hides the token (the trap
    // buildSmartRequest documents).
    if (params.length === 0) {
      try {
        new URL(url)
      } catch {
        continue
      }
      if (r.method !== 'GET' || /\{[^}]+\}/.test(url) || /\/:[A-Za-z_]/.test(url)) continue
    }
    // De-dup near-identical endpoints: agentic.market lists many rows that
    // differ only by a baked-in path value (e.g. CoinGecko's ~20
    // token_price/<address> variants — same method, description, param set).
    // Collapse to one representative per shape so the menu surfaces distinct
    // capabilities, not 20 copies — BEFORE the per-service cap consumes slots.
    const shape = `${r.server.slug}|${r.method}|${(description ?? '').slice(0, 60)}|${params.map((p) => p.name).sort().join(',')}`
    if (seenShape.has(shape)) continue
    seenShape.add(shape)
    const n = perService.get(r.server.slug) ?? 0
    if (n >= MENU_CAP_PER_SERVICE) continue
    perService.set(r.server.slug, n + 1)
    out.push({
      id: r.id,
      serverSlug: r.server.slug,
      serverName: r.server.name,
      method: r.method,
      url,
      description,
      priceUsd: r.priceUsd!,
      parameters: params,
      category: r.server.category,
      tags: r.server.tags,
      exampleQueries: r.server.exampleQueries,
    })
  }
  await attachReliability(out)
  return out
}

const RELIABILITY_WINDOW_MS = 30 * 86_400_000
const RECENT_MS = 7 * 86_400_000

/** Normalize a URL or bare host to a hostname for matching against the ledger. */
function hostnameOf(s: string): string {
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).hostname
  } catch {
    return s
  }
}

/**
 * Attach each endpoint's settlement history from the spend ledger — the routing
 * engine's feedback loop. A host that has actually settled paid calls (ok=true)
 * recently is "proven"; the planner is told to prefer proven endpoints only when
 * choices are otherwise equal, so newly-surfaced services aren't starved (they
 * stay selectable when they're the best fit and earn a track record by being used).
 */
async function attachReliability(endpoints: PlannableEndpoint[]): Promise<void> {
  if (endpoints.length === 0) return
  try {
    const since = new Date(Date.now() - RELIABILITY_WINDOW_MS)
    // Count settled (ok) vs failed (denied/errored) per host so the rating
    // reflects real reliability, not just volume.
    const rows = await prisma.spendLedgerEntry.groupBy({
      by: ['host', 'ok'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
    })
    const byHost = new Map<string, { settled: number; failed: number; lastOk: Date | null }>()
    for (const r of rows) {
      const host = hostnameOf(r.host)
      const cur = byHost.get(host) ?? { settled: 0, failed: 0, lastOk: null }
      if (r.ok) {
        cur.settled += r._count._all
        if (r._max.createdAt && (!cur.lastOk || r._max.createdAt > cur.lastOk)) cur.lastOk = r._max.createdAt
      } else {
        cur.failed += r._count._all
      }
      byHost.set(host, cur)
    }
    for (const e of endpoints) {
      const h = byHost.get(hostnameOf(e.url))
      if (!h || h.settled + h.failed === 0) continue
      const recent = !!h.lastOk && Date.now() - h.lastOk.getTime() <= RECENT_MS
      const total = h.settled + h.failed
      e.reliability = {
        settled: h.settled,
        failed: h.failed,
        recent,
        successRate: total > 0 ? h.settled / total : 0,
        rating: computeRating({ settled: h.settled, failed: h.failed, recent }),
      }
    }
  } catch {
    // Reliability is advisory — never block planning on a ledger read.
  }
}

/**
 * Server IDs that have ≥1 planner-eligible endpoint — i.e. the service is
 * auto-callable in chat the moment a user selects it, no hand-wiring needed.
 * Same per-endpoint predicate as loadPlannableEndpoints, expressed service-wide
 * so the directory can surface "this works" instead of mislabeling it Directory.
 * Price is parsed in code (priceUsd is a String column).
 */
export async function autoCallableServerIds(): Promise<Set<string>> {
  const rows = await prisma.mcpEndpoint.findMany({
    where: {
      NOT: { parameters: { equals: Prisma.DbNull } },
      method: { in: ['GET', 'POST'] },
    },
    select: { serverId: true, priceUsd: true, scheme: true, parameters: true },
  })
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.scheme === 'upto') continue
    const price = Number(r.priceUsd)
    if (!Number.isFinite(price) || price <= 0 || price > SMART_MAX_PER_CALL_USD) continue
    if (((r.parameters as unknown[] | null) ?? []).length === 0) continue
    ids.add(r.serverId)
  }
  return ids
}

/** The planner instruction the inference model answers with strict JSON. */
/** A recent chat turn, threaded into prompts so follow-ups keep context. */
export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

function conversationBlock(history: ConversationTurn[]): string {
  if (history.length === 0) return ''
  const lines = history.map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`)
  return `Conversation so far (the user's newest message is separate, below):\n${lines.join('\n')}`
}

export function plannerPrompt(
  message: string,
  endpoints: PlannableEndpoint[],
  history: ConversationTurn[] = [],
): string {
  const byService = new Map<string, PlannableEndpoint[]>()
  for (const e of endpoints) {
    byService.set(e.serverSlug, [...(byService.get(e.serverSlug) ?? []), e])
  }

  const menu = [...byService.entries()]
    .map(([slug, eps]) => {
      const lines = eps.map((e) => {
        const params = e.parameters
          .map((p) => {
            const ex = p.example !== undefined && p.example !== null && p.example !== '' ? ` e.g. ${JSON.stringify(p.example)}` : ''
            return `${p.name}(${p.group}${p.required ? ',required' : ''}:${p.type ?? 'string'}${ex})`
          })
          .join(', ')
        const proven = e.reliability && e.reliability.settled > 0
          ? ` ✓proven(${e.reliability.settled} settled${e.reliability.recent ? ', recent' : ''})`
          : ''
        return `  - id=${e.id} ${e.method} ${e.url} — ${e.description ?? 'no description'} [$${e.priceUsd}]${proven} params: ${params}`
      })
      return `service ${slug} (${eps[0].serverName}):\n${lines.join('\n')}`
    })
    .join('\n\n')

  const convo = conversationBlock(history)
  return [
    `You are an API-call planner.`,
    ...(convo ? [convo] : []),
    `A user asked${history.length ? ' (interpret it in the context of the conversation above — a terse follow-up like "baseball" continues the previous question)' : ''}:\n"""${message}"""`,
    `Below are paid API endpoints, grouped by service, each tagged with its price in [$…]; some are tagged ✓proven (they have successfully settled paid calls before). Pick AT MOST ONE endpoint per service — only if calling it would genuinely help answer the user. When two endpoints would both answer the need equally well, prefer the ✓proven one, and then the cheaper one — but still pick an un-proven endpoint when it is clearly the better fit for the request. Fill in parameter values derived from the user's message and the conversation (use sensible values; respect types; include every required param; skip optional params you can't infer). If no endpoint of a service helps, skip that service entirely.`,
    menu,
    `Respond with ONLY this JSON, no prose, no code fences:`,
    `{"picks":[{"endpointId":"<id>","params":{"<name>":"<value>"}}]}`,
    `If nothing helps: {"picks":[]}`,
  ].join('\n\n')
}

/** Parse + validate the planner's reply against the offered endpoints. */
export function parsePlannerPicks(text: string, offered: PlannableEndpoint[]): PlannedPick[] {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }
  const picks = (parsed as { picks?: unknown }).picks
  if (!Array.isArray(picks)) return []

  const byId = new Map(offered.map((e) => [e.id, e]))
  const seenServices = new Set<string>()
  const out: PlannedPick[] = []
  for (const p of picks) {
    const endpointId = (p as { endpointId?: unknown }).endpointId
    if (typeof endpointId !== 'string') continue
    const ep = byId.get(endpointId)
    if (!ep || seenServices.has(ep.serverSlug)) continue // unknown id or 2nd pick for service
    const rawParams = (p as { params?: unknown }).params
    const params: Record<string, string | number | boolean> = {}
    if (rawParams && typeof rawParams === 'object') {
      for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
        if (['string', 'number', 'boolean'].includes(typeof v)) params[k] = v as string | number | boolean
      }
    }
    seenServices.add(ep.serverSlug)
    out.push({ endpointId, params })
  }
  return out
}

export interface SmartRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  /** The call is an MCP tools/call — parse the JSON-RPC/SSE envelope, not raw JSON. */
  mcp?: boolean
}

/**
 * MCP-tool endpoint conventions — a row that is one TOOL on an MCP server;
 * the request is a JSON-RPC tools/call POST to `<base>/mcp` with the
 * planner's params as `arguments`:
 *  - `<base>/mcp#<toolName>`  — fragment style, any row.
 *  - `<base>/mcp/<toolName>`  — path style (matches the x402 fleet's display
 *    convention), accepted ONLY for explicitly-free rows (priceUsd '0') so a
 *    third-party HTTP endpoint that genuinely lives at /mcp/<something>
 *    can't be misread as a tools/call.
 */
function mcpToolOf(url: string, priceUsd?: string): { base: string; tool: string } | null {
  const frag = url.match(/^(.+\/mcp)#([A-Za-z0-9_]+)$/)
  if (frag) return { base: frag[1], tool: frag[2] }
  if (priceUsd === '0') {
    const path = url.match(/^(.+\/mcp)\/([A-Za-z0-9_]+)$/)
    if (path) return { base: path[1], tool: path[2] }
  }
  return null
}

/**
 * Local-dev override for free MCP hosts — the shared Neon DB carries the PROD
 * urls, so point specific hosts elsewhere via env (never set in prod):
 * FREE_MCP_URL_OVERRIDES='{"uniswap-free.yeetful.com":"http://localhost:3261"}'
 */
function overrideFreeMcpBase(base: string): string {
  const raw = process.env.FREE_MCP_URL_OVERRIDES
  if (!raw) return base
  try {
    const map = JSON.parse(raw) as Record<string, string>
    const u = new URL(base)
    const target = map[u.host]
    return target ? `${target.replace(/\/$/, '')}${u.pathname}` : base
  } catch {
    return base
  }
}

/**
 * Build the concrete HTTP request for a pick. Returns null (with a reason)
 * when the call can't be constructed safely — missing required params or
 * unresolved path tokens — so we never pay for a guaranteed 4xx.
 */
export function buildSmartRequest(
  ep: PlannableEndpoint,
  params: Record<string, string | number | boolean>,
): { request: SmartRequest } | { error: string } {
  const byGroup = { query: [] as EndpointParam[], path: [] as EndpointParam[], body: [] as EndpointParam[] }
  for (const p of ep.parameters) byGroup[p.group]?.push(p)

  for (const p of ep.parameters) {
    if (p.required && params[p.name] === undefined) {
      return { error: `missing required param "${p.name}"` }
    }
  }

  // MCP tool endpoints (url = <base>/mcp#<tool>): one JSON-RPC tools/call POST,
  // params become the tool arguments verbatim. Free MCPs never 402, so the
  // paid-fetch wrapper passes these through without payment.
  const mcpTool = mcpToolOf(ep.url, ep.priceUsd)
  if (mcpTool) {
    const args: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) if (v !== undefined) args[k] = v
    return {
      request: {
        url: overrideFreeMcpBase(mcpTool.base),
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: mcpTool.tool, arguments: args } }),
        mcp: true,
      },
    }
  }

  // Path params: substitute :name / {name} tokens. Declared path params first,
  // then ANY provided param — agentic.market frequently bakes a {address}/:id
  // token into the URL WITHOUT declaring it as a path param (parameters: null),
  // so without this the token is left in the URL and we pay for a guaranteed 4xx.
  let url = ep.url
  const consumed = new Set<string>()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    const before = url
    url = url.split(`{${k}}`).join(encodeURIComponent(String(v))).split(`:${k}`).join(encodeURIComponent(String(v)))
    if (url !== before) consumed.add(k)
  }
  // Refuse on ANY unresolved token, checked on the RAW template BEFORE new URL()
  // (which percent-encodes "{" → "%7B" and would hide it from a pathname test).
  if (/\{[^}]+\}/.test(url) || /\/:[A-Za-z_]/.test(url)) {
    return { error: 'unresolved path parameter' }
  }
  const u = new URL(url)

  const pathNames = new Set(byGroup.path.map((p) => p.name))
  const queryNames = new Set(byGroup.query.map((p) => p.name))
  const bodyNames = new Set(byGroup.body.map((p) => p.name))

  // Schema query params.
  for (const p of byGroup.query) {
    const v = params[p.name]
    if (v !== undefined) u.searchParams.set(p.name, String(v))
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  const bodyObj: Record<string, unknown> = {}
  for (const p of byGroup.body) {
    const v = params[p.name]
    if (v !== undefined) bodyObj[p.name] = v
  }

  // Inferred (schema-less) params: agentic.market often publishes no parameter
  // schema for an endpoint that clearly takes one (e.g. CoinMarketCap
  // quotes/latest needs ?symbol=ETH). When the planner supplies a param the
  // schema doesn't mention, route it by method — GET → query, POST → body — so
  // schema-poor endpoints become usable instead of dead-ends. Still guarded by
  // the caller's GET/POST + price-cap + grant gates.
  for (const [k, v] of Object.entries(params)) {
    if (consumed.has(k) || pathNames.has(k) || queryNames.has(k) || bodyNames.has(k)) continue
    if (ep.method === 'POST') bodyObj[k] = v
    else u.searchParams.set(k, String(v))
  }

  let body: string | undefined
  if (ep.method === 'POST') {
    body = JSON.stringify(bodyObj)
    headers['content-type'] = 'application/json'
  }

  return { request: { url: u.toString(), method: ep.method, headers, body } }
}
