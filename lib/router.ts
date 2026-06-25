// ─────────────────────────────────────────────────────────────────────────
//  Auto-Router engine — the brain behind "Auto Router" chat mode.
//
//  In manual mode the user hand-picks which MCP services a chat turn may call.
//  In Auto-Router mode the user picks nothing: given the message, the engine
//  decides — across the WHOLE directory — which service + which endpoint best
//  answers it, why, and at what price, then phrases the answer with a live
//  inference engine.
//
//  This module is pure orchestration. It does NOT pay or stream: the caller
//  injects `runInference` (the house-paid inference call) and may pass an
//  `onStep` hook to observe the reasoning trace live (the streaming chat path
//  forwards those steps to the browser; the engine window renders them).
//
//  It reuses the endpoint planner (lib/endpoint-planner): the same plannable
//  endpoint loader, pick validator, and request builder the manual smart path
//  already uses — Auto-Router just runs them over the entire catalog and adds
//  a routing prompt that also explains its choices.
// ─────────────────────────────────────────────────────────────────────────

import type { McpServer } from '@/lib/store'
import {
  loadPlannableEndpoints,
  parsePlannerPicks,
  buildSmartRequest,
  type PlannableEndpoint,
  type ConversationTurn,
  type SmartRequest,
} from '@/lib/endpoint-planner'
import { buildSignableArtifact, type SignableArtifact } from '@/lib/transaction-layer'

// ── Canonical trace contract ────────────────────────────────────────────────
// One ordered list of these IS the "engine window" content. The streaming chat
// path (B2) serializes each step as it's produced and adds `pay`/`receipt`/
// `reply`/`error` events over the wire; keep these four shapes STABLE — the UI
// renders them by `type`.
export type TraceStep =
  | { type: 'status'; label: string }
  | { type: 'analyze'; intent: string; needs: string[] }
  // The relevant tools the engine narrowed to before choosing — the "what it's weighing" view.
  | { type: 'shortlist'; candidates: { service: string; endpoint?: string; priceUsd?: string }[] }
  | { type: 'candidate'; service: string; endpoint?: string; priceUsd?: string; score: number; reason: string; proven?: number; successRate?: number }
  | { type: 'select'; service: string; endpoint?: string; priceUsd?: string; reason: string }
  // A non-paid TOOL step (resolve an id, list proposals, relay a vote, read
  // results) — the engine's action/governance tools, shown live in the terminal.
  | { type: 'tool'; name: string; status: 'run' | 'ok' | 'error'; detail?: string }
  // The general EIP-712 signing tool: what's being signed + by which signer.
  | { type: 'eip712'; scheme: string; signer: string; summary: string }
  // Diagnostics surfaced in the engine window so misses/errors are explained, not silent.
  | { type: 'note'; level: 'info' | 'warn'; label: string }

// ── Picks ─────────────────────────────────────────────────────────────────
/** A live-data call the engine chose to make (a planned, ready-to-pay request). */
export interface SmartPick {
  role: 'smart'
  endpointId: string
  serverSlug: string
  serverName: string
  endpointUrl: string
  request: SmartRequest
  priceUsd: string
  reason: string
}
/** The inference engine chosen to phrase the final answer. */
export interface InferencePick {
  role: 'inference'
  server: McpServer
  priceUsd: string
  reason: string
}
export type RouterPick = SmartPick | InferencePick

export interface RouterDecision {
  /** The chosen inference engine (null when none is callable). */
  inference: McpServer | null
  /** Live-data calls to make before answering. */
  smartPicks: SmartPick[]
  /** All picks in execution order: data calls first, inference last. */
  picks: RouterPick[]
  /** The reasoning trace (same list emitted via onStep, if provided). */
  trace: TraceStep[]
  /** Honest diagnostics (why a service was skipped, directory offline, …). */
  notes: string[]
  /** Gathered live-data context blocks (LOOP mode only — what `executeCall`
   *  returned across steps). The caller feeds these to the answer prompt.
   *  Empty in single-pass (plan) mode, where the caller executes the picks. */
  context: string[]
  /** A signable action (vote / on-chain tx) a tool returned for the user to
   *  approve — the transaction layer's output. Present only when a routed call
   *  yielded one (LOOP mode). The caller surfaces it for signing. */
  artifact?: SignableArtifact
}

/** Result of executing one chosen call: the data to observe, or an error to
 *  feed back for a repair attempt. The caller owns payment + gating. */
export interface ExecuteResult {
  data?: unknown
  error?: string
}

export interface RouteOptions {
  message: string
  history?: ConversationTurn[]
  /** The full directory (callable + listed) — what /api/servers returns. */
  catalog: McpServer[]
  /** House-paid inference call, injected so this module stays pure/testable. */
  runInference: (inference: McpServer, prompt: string) => Promise<{ text: string; txHash?: string }>
  /**
   * Execute a chosen data call (pay + gate is the caller's job). When provided,
   * routeMessage runs the MULTI-STEP reason→act→observe LOOP: it can call a
   * lookup to resolve an id, observe the result, then make the data call —
   * feeding each result back into the next step. When omitted, it does a single
   * planning pass and returns the picks unexecuted (wallet plan→sign→execute).
   */
  executeCall?: (pick: SmartPick) => Promise<ExecuteResult>
  /** Max tool calls in the loop (default 3). Hard cap against runaway loops. */
  maxSteps?: number
  /** Hard ceiling on total DATA spend in one turn (USD). When the next call
   *  would exceed it, the loop stops + notes it — so a multi-step turn can't
   *  overspend regardless of the model. Default 0.05. */
  maxTurnUsd?: number
  /** Pre-loaded candidate endpoints. When omitted they're loaded from the DB
   *  (loadPlannableEndpoints over the catalog). Injecting them keeps the module
   *  unit-testable with no DB. */
  endpoints?: PlannableEndpoint[]
  /** Live trace hook — called as each step is produced (for streaming). */
  onStep?: (step: TraceStep) => void
}

/**
 * Pick the inference engine that phrases the answer. Deterministic, no model
 * call: prefer Yeetful · Claude (our flat-priced, proven MCP), else the
 * cheapest callable inference provider. Selection across providers is a
 * follow-up (B5); one good default keeps the routing call cheap and reliable.
 */
export function selectInferenceProvider(catalog: McpServer[], preferSlug?: string): McpServer | null {
  const inf = catalog.filter(
    (s) => s.kind === 'inference' && s.callable && s.endpoint && (s.protocol === 'mcp' || s.protocol === 'http'),
  )
  if (inf.length === 0) return null
  // Optional explicit pin (e.g. the live-service test rotating engines). Falls
  // through to the default when the requested slug isn't a callable inference.
  if (preferSlug) {
    const pinned = inf.find((s) => s.slug === preferSlug)
    if (pinned) return pinned
  }
  const preferred = inf.find((s) => s.slug === 'yeetful-claude')
  if (preferred) return preferred
  return inf.slice().sort((a, b) => Number(a.priceUsd ?? '1') - Number(b.priceUsd ?? '1'))[0]
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'is', 'are', 'what', 'whats', 'how', 'much',
  'me', 'my', 'i', 'do', 'does', 'can', 'you', 'get', 'give', 'show', 'tell', 'current', 'latest', 'please',
  'with', 'from', 'about', 'this', 'that', 'it', 'now', 'today',
])

/**
 * Retrieve→plan shortlist: narrow the full plannable catalog (often ~200
 * endpoints) to the handful actually relevant to the query BEFORE the routing
 * model sees them — a small, legible menu yields reliable picks (and lets it
 * pick MULTIPLE services when several fit). Cheap + deterministic: keyword
 * overlap of the query against each endpoint's service name, (enriched)
 * description and path, plus a nudge for proven endpoints. Diversity-capped so
 * one chatty service can't crowd out the rest. Pure — exported for tests.
 */
export function shortlistEndpoints(message: string, endpoints: PlannableEndpoint[], limit = 14): PlannableEndpoint[] {
  const tokens = new Set((message.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t)))
  const score = (ep: PlannableEndpoint): number => {
    let hay = `${ep.serverName} ${ep.serverSlug} ${ep.category ?? ''} ${ep.description ?? ''}`.toLowerCase()
    try {
      hay += ' ' + new URL(ep.url).pathname.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    } catch {
      /* ignore */
    }
    let s = 0
    for (const t of tokens) if (hay.includes(t)) s += 1
    // Reputation bonus: a higher-rated MCP (proven settle rate + volume) ranks
    // above an equivalent un-rated one, so the engine converges on the best.
    s += (ep.reliability?.rating ?? 0) * 1.5
    return s
  }
  const ranked = endpoints
    .map((ep) => ({ ep, s: score(ep) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  const perService = new Map<string, number>()
  const out: PlannableEndpoint[] = []
  for (const { ep } of ranked) {
    const n = perService.get(ep.serverSlug) ?? 0
    if (n >= 3) continue // diversity: ≤3 endpoints per service in the shortlist
    perService.set(ep.serverSlug, n + 1)
    out.push(ep)
    if (out.length >= limit) break
  }
  return out
}

// Capability tags — a lightweight taxonomy so the engine can deterministically
// refuse to pay two MCPs for the SAME kind of answer (beyond the prompt rule).
// First match wins; order specific → general. Untagged endpoints are never
// deduped against (so distinct/unknown capabilities always survive).
const CAPABILITY_RULES: { tag: string; re: RegExp }[] = [
  { tag: 'crypto-price', re: /\b(spot price|price by symbol|token price|market quote|quotes? latest|market cap|crypto price)\b/i },
  { tag: 'web-search', re: /\b(web search|search the web|find pages|search results|article search|news search)\b/i },
  { tag: 'travel', re: /\b(hotel|restaurant|flight|airfare|attraction|itinerary|trip|travel)\b/i },
  { tag: 'governance', re: /\b(dao|governance|proposal|snapshot|voting space)\b/i },
  { tag: 'weather', re: /\b(weather|forecast|temperature|precipitation|humidity)\b/i },
  { tag: 'onchain-analytics', re: /\b(wallet analytics|smart money|token flows|holder|onchain analytics)\b/i },
  { tag: 'math', re: /\b(compute|equation|calculus|integral|derivative|math)\b/i },
]

/** The capability an endpoint serves (or undefined). Pure (B21). */
export function capabilityOf(ep: PlannableEndpoint): string | undefined {
  const hay = `${ep.serverName} ${ep.serverSlug} ${ep.category ?? ''} ${ep.description ?? ''}`.toLowerCase()
  return CAPABILITY_RULES.find((r) => r.re.test(hay))?.tag
}

/**
 * Keep ONE provider per capability — the best (higher rating, then cheaper).
 * Untagged items always survive. Returns kept + dropped. Pure + tested (B21).
 */
export function dedupeByCapability<T extends { capability?: string; rating: number; price: number }>(items: T[]): { kept: T[]; dropped: T[] } {
  const bestIdx = new Map<string, number>()
  items.forEach((it, i) => {
    if (!it.capability) return
    const b = bestIdx.get(it.capability)
    if (b === undefined || it.rating > items[b].rating || (it.rating === items[b].rating && it.price < items[b].price)) {
      bestIdx.set(it.capability, i)
    }
  })
  const kept: T[] = []
  const dropped: T[] = []
  items.forEach((it, i) => {
    if (!it.capability || bestIdx.get(it.capability) === i) kept.push(it)
    else dropped.push(it)
  })
  return { kept, dropped }
}

/** What the routing model is asked to return (a planner pick + its reasoning). */
export interface RouterModelDecision {
  intent: string
  needs: string[]
  picks: { endpointId: string; params: Record<string, string | number | boolean>; reason: string; score: number }[]
}

function conversationBlock(history: ConversationTurn[]): string {
  if (history.length === 0) return ''
  const lines = history.map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`)
  return `Conversation so far (the user's newest message is separate, below):\n${lines.join('\n')}`
}

/**
 * The routing prompt. A superset of the planner prompt: alongside the pick
 * format the planner already validates, it asks the model to name the user's
 * intent, the live data it needs, and a one-line reason + confidence per pick —
 * the human-readable narration the engine window shows.
 */
export function routerPrompt(
  message: string,
  endpoints: PlannableEndpoint[],
  history: ConversationTurn[] = [],
  observations: string[] = [],
): string {
  const byService = new Map<string, PlannableEndpoint[]>()
  for (const e of endpoints) byService.set(e.serverSlug, [...(byService.get(e.serverSlug) ?? []), e])

  const menu = [...byService.entries()]
    .map(([slug, eps]) => {
      const lines = eps.map((e) => {
        const params = e.parameters
          .map((p) => {
            const ex =
              p.example !== undefined && p.example !== null && p.example !== ''
                ? ` e.g. ${JSON.stringify(p.example)}`
                : ''
            return `${p.name}(${p.group}${p.required ? ',required' : ''}:${p.type ?? 'string'}${ex})`
          })
          .join(', ')
        const proven =
          e.reliability && e.reliability.settled > 0
            ? ` ✓proven(${e.reliability.settled} settled, ${Math.round((e.reliability.successRate ?? 1) * 100)}% ok${e.reliability.recent ? ', recent' : ''})`
            : ''
        return `  - id=${e.id} ${e.method} ${e.url} — ${e.description ?? 'no description'} [$${e.priceUsd}]${proven} params: ${params}`
      })
      return `service ${slug} (${eps[0].serverName}):\n${lines.join('\n')}`
    })
    .join('\n\n')

  // Loop mode: what earlier steps already fetched, so the model resolves an id
  // first and then makes the data call (and stops once it has enough).
  const observed = observations.length
    ? `You have ALREADY gathered this in earlier steps:\n${observations.join('\n')}\n\nIf that is enough to answer the user, return {"picks":[]} (done). Otherwise pick the NEXT single call — e.g. use an id/address you just resolved above to fill a parameter. Do NOT repeat a call you already made.`
    : ''

  const convo = conversationBlock(history)
  return [
    `You are Yeetful's routing engine. You decide which paid MCP/x402 endpoints (if any) to call to best answer a user, then explain the choice. You may work in STEPS: if a call needs an id/address/code you don't have (e.g. a DAO id, a token contract, an airport code), first call a lookup/search endpoint to resolve it, then on the next step call the data endpoint with the resolved value.`,
    ...(convo ? [convo] : []),
    `The user asked${history.length ? ' (interpret it in the context of the conversation above)' : ''}:\n"""${message}"""`,
    ...(observed ? [observed] : []),
    `Below are paid API endpoints, grouped by service, each tagged with its price in [$…]; some are tagged ✓proven with a settle rate (the higher, the more reliable). Pick AT MOST ONE endpoint per service. Pick MULTIPLE services ONLY when the question spans DISTINCT needs (e.g. a price AND news) — NEVER call two services that return the SAME kind of data (e.g. two crypto-price sources): that just double-charges the user. When several services provide the same thing, choose the SINGLE best — highest ✓proven settle rate, then cheapest. A single inference call then synthesizes everything into one answer. Only call an endpoint if it would genuinely help. Anything needing LIVE or REAL-TIME data — a price, quote, weather, scores, listings, search, on-chain or market data — should route to a relevant endpoint rather than be answered from memory. Still pick an un-proven endpoint when it is clearly the best (or only) fit.`,
    `Fill parameter values from the user's message and conversation (respect types; include every required param; skip optional params you can't infer). You MAY include query parameters even for an endpoint that lists no params, when it clearly needs one to answer — infer the obvious key/value (e.g. for a "latest quote" endpoint, "symbol":"ETH"; for a search endpoint, "query":"…"). Only pick nothing when the question genuinely needs no live data (general knowledge, chit-chat).`,
    menu || '(no endpoints available)',
    `Respond with ONLY this JSON, no prose, no code fences:`,
    `{"intent":"<one short sentence: what the user wants>","needs":["<live data this requires, if any>"],"picks":[{"endpointId":"<id>","params":{"<name>":"<value>"},"reason":"<why this endpoint, one short clause>","score":<0..1 confidence>}]}`,
    `If nothing is needed: {"intent":"<…>","needs":[],"picks":[]}`,
  ].join('\n\n')
}

/**
 * Parse + validate the routing model's reply. Pick validation (known id, at
 * most one per service, coerced param types) is delegated to the planner's
 * proven `parsePlannerPicks`; this layer adds the intent/needs narration and
 * threads each pick's reason + confidence back onto the validated picks.
 */
export function parseRouterDecision(text: string, offered: PlannableEndpoint[]): RouterModelDecision {
  const empty: RouterModelDecision = { intent: '', needs: [], picks: [] }
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return empty
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return empty
  }

  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim().slice(0, 200) : ''
  const needs = Array.isArray(parsed.needs)
    ? parsed.needs.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 120)).slice(0, 6)
    : []

  // Reuse the planner's validator for the picks themselves.
  const validated = parsePlannerPicks(match[0], offered)

  // Best-effort reason/score per pick, keyed by endpointId from the raw reply.
  const rawById = new Map<string, { reason?: unknown; score?: unknown; confidence?: unknown }>()
  if (Array.isArray(parsed.picks)) {
    for (const p of parsed.picks) {
      const id = (p as { endpointId?: unknown }).endpointId
      if (typeof id === 'string') rawById.set(id, p as Record<string, unknown>)
    }
  }
  const picks = validated.map((v) => {
    const raw = rawById.get(v.endpointId) ?? {}
    const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 160) : ''
    const rawScore = typeof raw.score === 'number' ? raw.score : typeof raw.confidence === 'number' ? raw.confidence : 1
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : 1
    return { endpointId: v.endpointId, params: v.params, reason, score }
  })
  return { intent, needs, picks }
}

/**
 * Route a message: decide which live-data endpoints to call and which engine
 * answers, narrating each step. The actual paying/answering is the caller's
 * job — this returns the plan + the trace.
 */
export async function routeMessage(opts: RouteOptions): Promise<RouterDecision> {
  const { message, catalog } = opts
  const history = opts.history ?? []
  const trace: TraceStep[] = []
  const notes: string[] = []
  const emit = (s: TraceStep) => {
    trace.push(s)
    opts.onStep?.(s)
  }
  // A diagnostic the user should SEE: recorded for the reply footer AND streamed
  // into the engine window as a note line (so a miss is explained, not silent).
  const addNote = (label: string, level: 'info' | 'warn' = 'info') => {
    notes.push(label)
    emit({ type: 'note', level, label })
  }

  emit({ type: 'status', label: 'Reading your question…' })

  const inference = selectInferenceProvider(catalog)
  if (!inference) {
    emit({ type: 'status', label: 'No inference engine available.' })
    addNote('No live inference engine is available — connect or enable one (e.g. Yeetful · Claude).', 'warn')
    return { inference: null, smartPicks: [], picks: [], trace, notes, context: [] }
  }

  emit({ type: 'status', label: `Scanning the MCP directory (${catalog.length} services)…` })
  let endpoints: PlannableEndpoint[] = opts.endpoints ?? []
  if (!opts.endpoints) {
    try {
      endpoints = await loadPlannableEndpoints(catalog.map((s) => s.slug).filter(Boolean))
    } catch (err) {
      addNote(`The endpoint directory is unavailable (${err instanceof Error ? err.message : 'error'}); answering from the inference engine alone.`, 'warn')
    }
  }

  // Retrieve→plan: narrow the full catalog to the relevant few BEFORE the model
  // sees them, so it picks reliably (and can pick several). The shortlist IS the
  // menu + the byId universe from here on.
  const shortlisted = endpoints.length ? shortlistEndpoints(message, endpoints) : []

  const smartPicks: SmartPick[] = []
  const context: string[] = []
  let artifact: SignableArtifact | undefined
  const byId = new Map(shortlisted.map((e) => [e.id, e]))

  // Build one SmartPick + emit candidate→select; null if the call can't be built.
  const planPick = (pick: RouterModelDecision['picks'][number]): SmartPick | null => {
    const ep = byId.get(pick.endpointId)
    if (!ep) return null
    emit({
      type: 'candidate',
      service: ep.serverName,
      endpoint: ep.url,
      priceUsd: ep.priceUsd,
      score: pick.score,
      reason: pick.reason || 'relevant to the request',
      proven: ep.reliability?.settled,
      successRate: ep.reliability?.successRate,
    })
    const built = buildSmartRequest(ep, pick.params)
    if ('error' in built) {
      addNote(`${ep.serverName}: planned call skipped — ${built.error}.`, 'warn')
      return null
    }
    emit({ type: 'select', service: ep.serverName, endpoint: ep.url, priceUsd: ep.priceUsd, reason: pick.reason || 'best fit for the request' })
    return {
      role: 'smart',
      endpointId: ep.id,
      serverSlug: ep.serverSlug,
      serverName: ep.serverName,
      endpointUrl: ep.url,
      request: built.request,
      priceUsd: ep.priceUsd,
      reason: pick.reason || 'best fit for the request',
    }
  }

  if (shortlisted.length === 0) {
    // No relevant tool (directory empty, or nothing matched the query) — answer
    // directly, honestly narrated. No model routing call.
    emit({ type: 'analyze', intent: 'General question — no live MCP data required.', needs: [] })
    if (endpoints.length > 0) addNote(`No directory endpoint matched this question (scanned ${endpoints.length}) — answering directly.`)
    emit({ type: 'status', label: 'No paid MCP needed — answering directly.' })
  } else if (!opts.executeCall) {
    // ── SINGLE-PASS (plan) mode: one routing call, return picks UNEXECUTED so
    //    the caller (wallet) can sign + execute them. ────────────────────────
    emit({ type: 'shortlist', candidates: shortlisted.map((e) => ({ service: e.serverName, endpoint: e.url, priceUsd: e.priceUsd })) })
    let decision: RouterModelDecision = { intent: '', needs: [], picks: [] }
    let routingFailed = false
    try {
      const { text } = await opts.runInference(inference, routerPrompt(message, shortlisted, history))
      decision = parseRouterDecision(text, shortlisted)
    } catch (err) {
      routingFailed = true
      addNote(`Routing call failed (${err instanceof Error ? err.message : 'error'}); answering from the inference engine alone.`, 'warn')
    }
    emit({ type: 'analyze', intent: decision.intent || 'Answering the question.', needs: decision.needs })
    // Capability dedup: never plan two providers for the same capability — keep
    // the best (higher rating, then cheaper); the rest are dropped + noted.
    const tagged = decision.picks
      .map((pick) => ({ pick, ep: byId.get(pick.endpointId) }))
      .filter((x): x is { pick: typeof x.pick; ep: PlannableEndpoint } => !!x.ep)
      .map((x) => ({ pick: x.pick, ep: x.ep, capability: capabilityOf(x.ep), rating: x.ep.reliability?.rating ?? 0, price: Number(x.ep.priceUsd) || 0 }))
    const { kept, dropped } = dedupeByCapability(tagged)
    for (const d of dropped) addNote(`Skipped ${d.ep.serverName} — same capability (${d.capability}); kept the better-rated/cheaper provider.`)
    for (const k of kept) {
      const sp = planPick(k.pick)
      if (sp) smartPicks.push(sp)
    }
    if (smartPicks.length === 0 && !routingFailed) emitConsideredNone(shortlisted, addNote, emit)
  } else {
    // ── LOOP mode: bounded reason→act→observe. Resolve ids with a lookup, see
    //    the result, then make the data call — up to maxSteps. ───────────────
    const maxSteps = opts.maxSteps ?? 3
    const maxTurnUsd = opts.maxTurnUsd ?? 0.05
    const observations: string[] = []
    const calledIds = new Set<string>()
    let spentThisTurn = 0
    let ceilingHit = false
    let firstAnalyze = true
    emit({ type: 'shortlist', candidates: shortlisted.map((e) => ({ service: e.serverName, endpoint: e.url, priceUsd: e.priceUsd })) })
    for (let step = 0; step < maxSteps; step++) {
      emit({ type: 'status', label: step === 0 ? `Choosing among ${shortlisted.length} shortlisted endpoints…` : `Refining (step ${step + 1}/${maxSteps})…` })
      let decision: RouterModelDecision = { intent: '', needs: [], picks: [] }
      try {
        const { text } = await opts.runInference(inference, routerPrompt(message, shortlisted, history, observations))
        decision = parseRouterDecision(text, shortlisted)
      } catch (err) {
        addNote(`Routing call failed (${err instanceof Error ? err.message : 'error'}); answering with what's gathered.`, 'warn')
        break
      }
      if (firstAnalyze) {
        emit({ type: 'analyze', intent: decision.intent || 'Answering the question.', needs: decision.needs })
        firstAnalyze = false
      }
      const fresh = decision.picks.filter((p) => !calledIds.has(p.endpointId))
      if (fresh.length === 0) break // model has enough (or only repeats) → done
      // Within-step capability dedup: if the model picks two providers for the
      // SAME capability in one step (e.g. CoinGecko + CoinMarketCap for price),
      // keep the best and don't pay twice. (Across STEPS we don't dedup — a
      // resolve→fetch chain legitimately reuses a capability.)
      const freshTagged = fresh
        .map((pick) => ({ pick, ep: byId.get(pick.endpointId) }))
        .filter((x): x is { pick: typeof x.pick; ep: PlannableEndpoint } => !!x.ep)
        .map((x) => ({ pick: x.pick, ep: x.ep, capability: capabilityOf(x.ep), rating: x.ep.reliability?.rating ?? 0, price: Number(x.ep.priceUsd) || 0 }))
      const deduped = dedupeByCapability(freshTagged)
      for (const d of deduped.dropped) {
        calledIds.add(d.pick.endpointId)
        addNote(`Skipped ${d.ep.serverName} — same capability (${d.capability}) as another pick this step; kept the better-rated/cheaper one.`)
      }
      let progressed = false
      for (const k of deduped.kept) {
        const pick = k.pick
        calledIds.add(pick.endpointId)
        const sp = planPick(pick)
        if (!sp) continue
        // Per-turn cost ceiling: never let a multi-step turn overspend.
        const price = Number(sp.priceUsd) || 0
        if (spentThisTurn + price > maxTurnUsd) {
          addNote(`Stopped at the per-turn budget ($${maxTurnUsd}) — skipped ${sp.serverName} ($${sp.priceUsd}).`, 'warn')
          ceilingHit = true
          break
        }
        const res = await opts.executeCall(sp)
        if (res.error) {
          // Feed the failure back so the next step can repair (try a different call).
          observations.push(`${sp.serverName} ${shortUrl(sp.endpointUrl)} → ERROR: ${truncate(res.error, 200)}`)
        } else {
          smartPicks.push(sp)
          context.push(`### ${sp.serverName}\n${compactForSynthesis(res.data, 3500)}`)
          observations.push(`${sp.serverName} ${shortUrl(sp.endpointUrl)} → ${compactForSynthesis(res.data, 600)}`)
          spentThisTurn += price
          progressed = true
          // Transaction layer: a tool that returned a signable action (a vote /
          // on-chain tx) short-circuits the loop — we have something to sign, not
          // synthesize. The caller surfaces it for explicit approval.
          const art = buildSignableArtifact(res.data)
          if (art) {
            artifact = art
            addNote(`Prepared a signable ${art.kind === 'eip712-vote' ? 'vote' : 'transaction'} for you to approve.`)
            break
          }
        }
      }
      if (artifact || ceilingHit || !progressed) break // action ready, budget hit, or no progress → stop
    }
    if (smartPicks.length === 0 && !artifact) emitConsideredNone(shortlisted, addNote, emit)
  }

  // The inference engine always answers last.
  emit({
    type: 'select',
    service: inference.name,
    priceUsd: inference.priceUsd ?? undefined,
    reason: smartPicks.length ? 'Synthesizes the answer from the fetched data' : 'Answers the question',
  })

  const inferencePick: InferencePick = {
    role: 'inference',
    server: inference,
    priceUsd: inference.priceUsd ?? '0.01',
    reason: smartPicks.length ? 'Synthesizes the answer from the fetched data' : 'Answers the question',
  }

  return {
    inference,
    smartPicks,
    picks: [...smartPicks, inferencePick],
    trace,
    notes,
    context,
    artifact,
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// Keys that bloat a tool result without carrying the answer — long tag lists,
// logos, descriptions, platform metadata. Stripping them keeps the value-bearing
// fields (price, quote, value, result) inside the synthesis budget instead of
// being truncated away. Live-check finding: CMC quotes/latest buried
// `quote.USD.price` behind a ~30-entry `tags` array, past the old 1500-char cut.
const NOISY_KEYS = new Set([
  'tags', 'tag_names', 'tag_groups', 'self_reported_tags',
  'description', 'logo', 'urls', 'notice', 'platform', 'date_added',
])

function stripNoisy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNoisy)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (NOISY_KEYS.has(k)) continue
      out[k] = stripNoisy(val)
    }
    return out
  }
  return v
}

/** Compact a tool result for the synthesis prompt: drop noisy keys from JSON,
 *  then cap length. Strings pass through untouched (just capped). */
export function compactForSynthesis(data: unknown, limit: number): string {
  if (typeof data === 'string') return truncate(data, limit)
  const s = JSON.stringify(stripNoisy(data) ?? '')
  return truncate(s, limit)
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

/** Emit the honest "I looked but couldn't build a call" diagnostic. */
function emitConsideredNone(
  endpoints: PlannableEndpoint[],
  addNote: (label: string, level?: 'info' | 'warn') => void,
  emit: (step: TraceStep) => void,
): void {
  const services = [...new Set(endpoints.map((e) => e.serverName))]
  const considered = services.slice(0, 8).join(', ') + (services.length > 8 ? `, +${services.length - 8} more` : '')
  addNote(`Considered ${services.length} service${services.length === 1 ? '' : 's'} (${considered}) — none had an endpoint I could build a call for here, so answering directly.`)
  emit({ type: 'status', label: 'No usable live-data call — answering directly.' })
}
