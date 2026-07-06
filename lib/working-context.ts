// ─────────────────────────────────────────────────────────────────────────
//  Working context (RR2) — the STRUCTURED conversation state the router
//  carries between turns, replacing regex-over-prose continuity.
//
//  The contract: a turn that offers the user entities (a numbered proposal
//  list, a vote handoff, …) RETURNS a WorkingContext next to the reply; the
//  client stores it on the assistant message's meta and echoes the most
//  recent one back with the next message (same trust model as `history` —
//  client-supplied, sanitized here, and never able to move money on its own:
//  votes/orders still end at an explicit wallet signature + the policy gate).
//  The next turn resolves follow-ups ("vote yes", "the second one")
//  DETERMINISTICALLY against what the user actually saw — never against a
//  re-fetch that may have reordered, and never by scraping the last reply's
//  prose. Server-agnostic by design: scope/offers speak in kinds and ids,
//  not Snapshot specifics, so the same primitive carries swaps, orders,
//  flights, or any MCP's entities.
// ─────────────────────────────────────────────────────────────────────────

export interface OfferedItem {
  /** The number the user SAW (1-based) — ordinals resolve against this. */
  n: number
  /** Stable id (proposal id, order uid, token address, …). */
  id: string
  title: string
  /** Small extras a resolver needs later (e.g. a proposal's spaceId). */
  data?: Record<string, string>
}

/** A concrete value a tool result RESOLVED this conversation (RR18) — the
 *  cross-MCP carry: snapshot resolves "Balancer" → balancer.eth + token BAL,
 *  and the NEXT turn's "swap 1 USDC for its token" plans against the exact
 *  value on a different MCP. Names are how the user would say it; values are
 *  what a tool param needs. */
export interface EntityRef {
  /** 'proposal' | 'space' | 'token' | 'address' | … */
  kind: string
  /** How the user refers to it — "Balancer", "Fee switch pilot", "BAL". */
  name: string
  /** The exact param value — space id, proposal id, symbol/address. */
  value: string
}

export interface WorkingContext {
  v: 1
  /** Where the conversation is operating — e.g. a resolved Snapshot space.
   *  `server` names the tool family ('snapshot', 'uniswap', …). */
  scope?: { server: string; label: string; params: Record<string, string> }
  /** The exact list the assistant last offered, in shown order. */
  offers?: { kind: string; items: OfferedItem[] }
  /** An action offered and awaiting the user (vote ready on X, quote shown). */
  pending?: { kind: string; summary: string; data: Record<string, string> }
  /** Values tool results resolved this conversation (RR18) — newest first. */
  entities?: EntityRef[]
  /** Turns since this context was written — computed by the client at send
   *  time (distance from the message that carried it). Sections expire by age. */
  age: number
}

// Expiry by section: a pending action is abandoned fast (an unrelated next
// message must not resurrect a vote); offered lists live a short conversation;
// scope (the space/venue we're operating in) lingers longest.
const PENDING_MAX_AGE = 2
const OFFERS_MAX_AGE = 6
const SCOPE_MAX_AGE = 12
const ENTITIES_MAX_AGE = 8
export const MAX_ENTITIES = 12

const MAX_ITEMS = 12
const MAX_STR = 220
const MAX_PARAMS = 8

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.slice(0, MAX_STR) : undefined
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, MAX_PARAMS)) {
      const s = str(val)
      if (s) out[k.slice(0, 64)] = s
    }
  }
  return out
}

/** Validate + expire a client-echoed working context. Returns undefined when
 *  nothing usable survives. Every field is shape-checked and length-capped —
 *  this is untrusted input. */
export function sanitizeWorkingContext(raw: unknown): WorkingContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (r.v !== 1) return undefined
  const age = typeof r.age === 'number' && Number.isFinite(r.age) && r.age >= 0 ? Math.floor(r.age) : 0
  const ctx: WorkingContext = { v: 1, age }

  const scope = r.scope as Record<string, unknown> | undefined
  if (age <= SCOPE_MAX_AGE && scope && typeof scope === 'object') {
    const server = str(scope.server)
    const label = str(scope.label)
    if (server && label) ctx.scope = { server, label, params: strMap(scope.params) }
  }

  const offers = r.offers as Record<string, unknown> | undefined
  if (age <= OFFERS_MAX_AGE && offers && typeof offers === 'object' && Array.isArray(offers.items)) {
    const kind = str(offers.kind)
    const items: OfferedItem[] = []
    for (const it of (offers.items as unknown[]).slice(0, MAX_ITEMS)) {
      if (!it || typeof it !== 'object') continue
      const o = it as Record<string, unknown>
      const id = str(o.id)
      const title = str(o.title)
      const n = typeof o.n === 'number' && Number.isInteger(o.n) && o.n >= 1 ? o.n : undefined
      if (id && title && n) items.push({ n, id, title, ...(o.data ? { data: strMap(o.data) } : {}) })
    }
    if (kind && items.length) ctx.offers = { kind, items }
  }

  const pending = r.pending as Record<string, unknown> | undefined
  if (age <= PENDING_MAX_AGE && pending && typeof pending === 'object') {
    const kind = str(pending.kind)
    const summary = str(pending.summary)
    if (kind && summary) ctx.pending = { kind, summary, data: strMap(pending.data) }
  }

  if (age <= ENTITIES_MAX_AGE && Array.isArray(r.entities)) {
    const entities: EntityRef[] = []
    for (const e of (r.entities as unknown[]).slice(0, MAX_ENTITIES)) {
      if (!e || typeof e !== 'object') continue
      const o = e as Record<string, unknown>
      const kind = str(o.kind)
      const name = str(o.name)
      const value = str(o.value)
      if (kind && name && value) entities.push({ kind, name, value })
    }
    if (entities.length) ctx.entities = entities
  }

  if (!ctx.scope && !ctx.offers && !ctx.pending && !ctx.entities) return undefined
  return ctx
}

// ── Entity extraction (RR18) ────────────────────────────────────────────────
const PROPOSAL_ID_RE = /^0x[0-9a-fA-F]{64}$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const SPACE_ID_RE = /^[a-z0-9][a-z0-9-]*\.(eth|xyz|sol)$/i

/**
 * Pull carry-worthy entities out of a raw tool RESULT (parsed JSON), merging
 * with what's already known (new findings first, deduped, capped). Pure and
 * shape-generic: it recognizes VALUE PATTERNS (proposal hashes, space ids,
 * token symbol+address pairs) rather than any specific MCP's schema, so a new
 * blockchain MCP's results carry entities with zero wiring.
 */
export function extractEntities(data: unknown, prior: EntityRef[] = []): EntityRef[] {
  const found: EntityRef[] = []
  const seen = new Set(prior.map((e) => `${e.kind}:${e.value.toLowerCase()}`))
  const push = (kind: string, name: string, value: string) => {
    const key = `${kind}:${value.toLowerCase()}`
    if (seen.has(key) || found.length >= MAX_ENTITIES) return
    seen.add(key)
    found.push({ kind, name: name.slice(0, MAX_STR), value: value.slice(0, MAX_STR) })
  }
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || found.length >= MAX_ENTITIES) return
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 20)) walk(item, depth + 1)
      return
    }
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : undefined
    const label = [o.title, o.name, o.symbol].find((x): x is string => typeof x === 'string' && !!x.trim())
    if (id && label) {
      if (PROPOSAL_ID_RE.test(id)) push('proposal', label, id)
      else if (SPACE_ID_RE.test(id)) push('space', label, id)
      else if (ADDRESS_RE.test(id)) push('token', label, id)
    }
    // Token shapes ({symbol, address}) — the value is the SYMBOL: it resolves
    // on any chain's token tools, while a copied address is chain-specific.
    if (typeof o.symbol === 'string' && o.symbol.trim() && typeof o.address === 'string' && ADDRESS_RE.test(o.address)) {
      push('token', o.symbol, o.symbol)
    }
    for (const v of Object.values(o)) walk(v, depth + 1)
  }
  walk(data, 0)
  return [...found, ...prior].slice(0, MAX_ENTITIES)
}

/**
 * The generic reply-side carry: keep the echoed scope/offers alive (a data
 * turn between an offer and its follow-up must not erase the offer), fold in
 * newly extracted entities, and DROP pending (actions expire fast by design —
 * a generic turn never resurrects a vote/swap awaiting signature).
 */
export function carryContext(echoed: WorkingContext | undefined, entities: EntityRef[]): WorkingContext | undefined {
  const merged = extractEntities([], [...entities, ...(echoed?.entities ?? [])])
  const out: WorkingContext = { v: 1, age: 0 }
  if (echoed?.scope) out.scope = echoed.scope
  if (echoed?.offers) out.offers = echoed.offers
  if (merged.length) out.entities = merged
  return out.scope || out.offers || out.entities ? out : undefined
}

/** Resolve an ordinal reference ("1", "the second one", "last") against the
 *  OFFERED list — the numbering the user actually saw. Pure + tested. */
export function resolveOrdinalFromOffers(message: string, ctx: WorkingContext | undefined): OfferedItem | undefined {
  const items = ctx?.offers?.items
  if (!items?.length) return undefined
  const ord = message.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|last|(?:#|number\s+)?([1-9]\d?))(?:\s+(?:one|proposal|option|item))?\b/i)
  if (!ord) return undefined
  const named: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: items[items.length - 1].n }
  const n = ord[2] ? parseInt(ord[2], 10) : named[ord[1].toLowerCase()]
  return items.find((it) => it.n === n)
}

/** Resolve a title mention against the offered list (exact-contains, longest
 *  title wins so a substring title can't steal the match). */
export function resolveTitleFromOffers(message: string, ctx: WorkingContext | undefined): OfferedItem | undefined {
  const items = ctx?.offers?.items
  if (!items?.length) return undefined
  const hay = message.toLowerCase()
  const hits = items
    .filter((it) => hay.includes(it.title.toLowerCase()))
    .sort((a, b) => b.title.length - a.title.length)
  return hits[0]
}

/** The compact block the PLANNER sees — generic continuity for every server:
 *  the scope the conversation is in + the items last offered, so a terse
 *  follow-up ("the second one", "more about 3") plans against real ids. */
export function contextBlockForPlanner(ctx: WorkingContext | undefined): string {
  if (!ctx) return ''
  const lines: string[] = []
  if (ctx.scope) {
    const params = Object.entries(ctx.scope.params).map(([k, v]) => `${k}=${v}`).join(', ')
    lines.push(`Conversation scope: ${ctx.scope.label} (${ctx.scope.server}${params ? `; ${params}` : ''}).`)
  }
  if (ctx.offers) {
    lines.push(
      `Items the assistant last offered (${ctx.offers.kind} — ordinal references like "the second one" mean THESE):`,
      ...ctx.offers.items.map((it) => `${it.n}. ${it.title} [id: ${it.id}]`),
    )
  }
  if (ctx.pending) lines.push(`Pending action awaiting the user: ${ctx.pending.summary}`)
  if (ctx.entities?.length) {
    lines.push(
      `Entities resolved earlier in this conversation — when the user refers to one by name or pronoun ("that token", "its token", "the DAO"), use its EXACT value:`,
      ...ctx.entities.map((e) => `- ${e.kind} "${e.name}" = ${e.value}`),
    )
  }
  return lines.length ? `Conversation working context (structured state from the previous turns):\n${lines.join('\n')}` : ''
}

/** Client-side: pull the most recent working context out of a message list and
 *  stamp its age (turns since the assistant message that carried it). */
export function latestWorkingContext(
  messages: { role: string; meta?: unknown }[],
): WorkingContext | undefined {
  let assistantsAfter = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const ctx = (m.meta as { workingContext?: unknown } | undefined)?.workingContext
    if (ctx && typeof ctx === 'object') {
      return { ...(ctx as WorkingContext), age: assistantsAfter }
    }
    assistantsAfter++
  }
  return undefined
}
