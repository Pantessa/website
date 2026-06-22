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
  /** Settlement history for this endpoint's host (the engine's feedback signal):
   *  how many paid calls it has actually settled, and whether recently. Absent =
   *  no history (unproven, NOT penalized — see plannerPrompt). */
  reliability?: { settled: number; recent: boolean }
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
    include: { server: { select: { slug: true, name: true } } },
    orderBy: { position: 'asc' },
  })

  const perService = new Map<string, number>()
  const out: PlannableEndpoint[] = []
  for (const r of rows) {
    const price = Number(r.priceUsd)
    // Only exact, known prices within the ceiling — "upto" schemes can charge
    // far more than the listed minimum, so they stay out of auto-planning.
    if (r.scheme === 'upto') continue
    if (!Number.isFinite(price) || price <= 0 || price > SMART_MAX_PER_CALL_USD) continue
    const params = (r.parameters as EndpointParam[] | null) ?? []
    // A param-less endpoint is still callable when it's a GET with no path
    // token to fill — a plain fetch (e.g. "list all teams"). buildSmartRequest
    // already builds these (empty query/body). Anything that needs a value we
    // can't supply — a POST body or an unresolved :path/{path} token — stays
    // out. Test the PATHNAME (not the raw url, whose "://" contains a colon).
    if (params.length === 0) {
      let pathname: string
      try {
        pathname = new URL(r.url).pathname
      } catch {
        continue
      }
      if (r.method !== 'GET' || /[:{]/.test(pathname)) continue
    }
    const n = perService.get(r.server.slug) ?? 0
    if (n >= MENU_CAP_PER_SERVICE) continue
    perService.set(r.server.slug, n + 1)
    out.push({
      id: r.id,
      serverSlug: r.server.slug,
      serverName: r.server.name,
      method: r.method,
      url: r.url,
      description: r.description,
      priceUsd: r.priceUsd!,
      parameters: params,
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
    const rows = await prisma.spendLedgerEntry.groupBy({
      by: ['host'],
      where: { ok: true, amountUsd: { gt: 0 }, createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
    })
    const byHost = new Map<string, { settled: number; recent: boolean }>()
    for (const r of rows) {
      const last = r._max.createdAt
      byHost.set(hostnameOf(r.host), {
        settled: r._count._all,
        recent: !!last && Date.now() - last.getTime() <= RECENT_MS,
      })
    }
    for (const e of endpoints) {
      const rel = byHost.get(hostnameOf(e.url))
      if (rel) e.reliability = rel
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

  // Path params: replace :name and {name} tokens.
  let url = ep.url
  for (const p of byGroup.path) {
    const v = params[p.name]
    if (v === undefined) continue
    url = url.replace(`:${p.name}`, encodeURIComponent(String(v))).replace(`{${p.name}}`, encodeURIComponent(String(v)))
  }
  const u = new URL(url)
  // Any unresolved :token or {token} left in the path → guaranteed 404. Skip.
  if (/[:{]/.test(u.pathname)) return { error: 'unresolved path parameter' }
  for (const p of byGroup.query) {
    const v = params[p.name]
    if (v !== undefined) u.searchParams.set(p.name, String(v))
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  let body: string | undefined
  if (ep.method === 'POST') {
    const bodyObj: Record<string, unknown> = {}
    for (const p of byGroup.body) {
      const v = params[p.name]
      if (v !== undefined) bodyObj[p.name] = v
    }
    body = JSON.stringify(bodyObj)
    headers['content-type'] = 'application/json'
  }

  return { request: { url: u.toString(), method: ep.method, headers, body } }
}
