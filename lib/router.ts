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

// ── Canonical trace contract ────────────────────────────────────────────────
// One ordered list of these IS the "engine window" content. The streaming chat
// path (B2) serializes each step as it's produced and adds `pay`/`receipt`/
// `reply`/`error` events over the wire; keep these four shapes STABLE — the UI
// renders them by `type`.
export type TraceStep =
  | { type: 'status'; label: string }
  | { type: 'analyze'; intent: string; needs: string[] }
  | { type: 'candidate'; service: string; endpoint?: string; priceUsd?: string; score: number; reason: string; proven?: number }
  | { type: 'select'; service: string; endpoint?: string; priceUsd?: string; reason: string }
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
}

export interface RouteOptions {
  message: string
  history?: ConversationTurn[]
  /** The full directory (callable + listed) — what /api/servers returns. */
  catalog: McpServer[]
  /** House-paid inference call, injected so this module stays pure/testable. */
  runInference: (inference: McpServer, prompt: string) => Promise<{ text: string; txHash?: string }>
  /** Live trace hook — called as each step is produced (for streaming). */
  onStep?: (step: TraceStep) => void
}

/**
 * Pick the inference engine that phrases the answer. Deterministic, no model
 * call: prefer Yeetful · Claude (our flat-priced, proven MCP), else the
 * cheapest callable inference provider. Selection across providers is a
 * follow-up (B5); one good default keeps the routing call cheap and reliable.
 */
export function selectInferenceProvider(catalog: McpServer[]): McpServer | null {
  const inf = catalog.filter(
    (s) => s.kind === 'inference' && s.callable && s.endpoint && (s.protocol === 'mcp' || s.protocol === 'http'),
  )
  if (inf.length === 0) return null
  const preferred = inf.find((s) => s.slug === 'yeetful-claude')
  if (preferred) return preferred
  return inf.slice().sort((a, b) => Number(a.priceUsd ?? '1') - Number(b.priceUsd ?? '1'))[0]
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
            ? ` ✓proven(${e.reliability.settled} settled${e.reliability.recent ? ', recent' : ''})`
            : ''
        return `  - id=${e.id} ${e.method} ${e.url} — ${e.description ?? 'no description'} [$${e.priceUsd}]${proven} params: ${params}`
      })
      return `service ${slug} (${eps[0].serverName}):\n${lines.join('\n')}`
    })
    .join('\n\n')

  const convo = conversationBlock(history)
  return [
    `You are Yeetful's routing engine. You decide which paid MCP/x402 endpoints (if any) to call to best answer a user, then explain the choice.`,
    ...(convo ? [convo] : []),
    `The user asked${history.length ? ' (interpret it in the context of the conversation above)' : ''}:\n"""${message}"""`,
    `Below are paid API endpoints, grouped by service, each tagged with its price in [$…]; some are tagged ✓proven (they have successfully settled paid calls before). Pick AT MOST ONE endpoint per service — only if calling it would genuinely help answer the user. Anything the user asks that needs LIVE or REAL-TIME data — a price, a quote, weather, scores, listings, search results, on-chain or market data — should route to a relevant endpoint here rather than be answered from memory. When two endpoints answer the need equally well, prefer the ✓proven one, then the cheaper one — but still pick an un-proven endpoint when it is clearly the better fit.`,
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
    return { inference: null, smartPicks: [], picks: [], trace, notes }
  }

  emit({ type: 'status', label: `Scanning the MCP directory (${catalog.length} services)…` })
  let endpoints: PlannableEndpoint[] = []
  try {
    endpoints = await loadPlannableEndpoints(catalog.map((s) => s.slug).filter(Boolean))
  } catch (err) {
    addNote(`The endpoint directory is unavailable (${err instanceof Error ? err.message : 'error'}); answering from the inference engine alone.`, 'warn')
  }

  const smartPicks: SmartPick[] = []

  if (endpoints.length === 0) {
    // Nothing routable — answer directly, honestly narrated (no model call).
    emit({ type: 'analyze', intent: 'General question — no live MCP data required.', needs: [] })
    emit({ type: 'status', label: 'No paid MCP needed — answering directly.' })
  } else {
    emit({ type: 'status', label: `Choosing among ${endpoints.length} candidate endpoints…` })
    let decision: RouterModelDecision = { intent: '', needs: [], picks: [] }
    let routingFailed = false
    try {
      const { text } = await opts.runInference(inference, routerPrompt(message, endpoints, history))
      decision = parseRouterDecision(text, endpoints)
    } catch (err) {
      routingFailed = true
      addNote(`Routing call failed (${err instanceof Error ? err.message : 'error'}); answering from the inference engine alone.`, 'warn')
    }

    emit({
      type: 'analyze',
      intent: decision.intent || 'Answering the question.',
      needs: decision.needs,
    })

    const byId = new Map(endpoints.map((e) => [e.id, e]))
    for (const pick of decision.picks) {
      const ep = byId.get(pick.endpointId)
      if (!ep) continue
      emit({
        type: 'candidate',
        service: ep.serverName,
        endpoint: ep.url,
        priceUsd: ep.priceUsd,
        score: pick.score,
        reason: pick.reason || 'relevant to the request',
        proven: ep.reliability?.settled,
      })
      const built = buildSmartRequest(ep, pick.params)
      if ('error' in built) {
        addNote(`${ep.serverName}: planned call skipped — ${built.error}.`, 'warn')
        continue
      }
      emit({
        type: 'select',
        service: ep.serverName,
        endpoint: ep.url,
        priceUsd: ep.priceUsd,
        reason: pick.reason || 'best fit for the request',
      })
      smartPicks.push({
        role: 'smart',
        endpointId: ep.id,
        serverSlug: ep.serverSlug,
        serverName: ep.serverName,
        endpointUrl: ep.url,
        request: built.request,
        priceUsd: ep.priceUsd,
        reason: pick.reason || 'best fit for the request',
      })
    }

    if (smartPicks.length === 0 && !routingFailed) {
      // Explain WHY nothing was chosen rather than silently answering — the user
      // should see which services were on the table.
      const services = [...new Set(endpoints.map((e) => e.serverName))]
      const considered = services.slice(0, 8).join(', ') + (services.length > 8 ? `, +${services.length - 8} more` : '')
      addNote(`Considered ${services.length} service${services.length === 1 ? '' : 's'} (${considered}) — none had an endpoint I could build a call for here, so answering directly.`)
      emit({ type: 'status', label: 'No usable live-data call — answering directly.' })
    }
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
  }
}
