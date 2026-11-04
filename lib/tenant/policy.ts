// lib/tenant/policy.ts — the tenant policy engine (TENANT lane, five-million).
//
// PURE. No DB, no fetch, no env. Two functions carry the whole desk:
//
//   evaluateTenantPolicy(doc, ctx, order) — one order against the ACTIVE
//     policy document, DEFAULT-DENY: an order no venue rule admits is refused,
//     an order the desk cannot price is refused (a tenant signer BLOCKS, it
//     never warns), and every refusal names itself with a TenantRefusal code
//     plus one sentence in the desk's own words.
//
//   validatePolicyDoc(raw) — the proposal door's validator: unknown venue /
//     op / chain / side / key, a malformed desk id, a chain outside the venue's
//     own VENUE_CHAINS, a bad IANA zone — each refused naming the FIELD
//     (`venues[1].chains[0]`), so a compliance officer fixes the document, not
//     a guess.
//
// The check order is the contract the pins read (scripts/tenant-pins.ts):
//   paused (key, then tenant) → NO_POLICY → DESK_UNKNOWN → VENUE_DENIED →
//   CHAIN_DENIED → OP_DENIED → TOKEN_DENIED → SIDE_DENIED → SANDBOX_ONLY →
//   OUTSIDE_HOURS → UNPRICED → OVER_ORDER → OVER_DAY → OVER_LEVERAGE →
//   OVER_IMPACT → (allowed, maybe needsApproval).
// Shape before money: a Base-only desk asked for Arbitrum hears CHAIN_DENIED,
// not "unpriced", because that is the fix it needs.

import {
  DESK_ID_RE,
  SIGNING_LANES,
  TENANT_OPS,
  TENANT_SIDES,
  TENANT_VENUES,
  VENUE_CHAINS,
  type TenantContext,
  type TenantDeskRule,
  type TenantOp,
  type TenantOrder,
  type TenantPolicyDoc,
  type TenantSide,
  type TenantVenue,
  type TenantVenueRule,
  type TenantVerdict,
} from '@/lib/tenant/spec'

/** Chains a SANDBOX tenant may touch. 84532 = Base Sepolia (the only testnet
 *  in VENUE_CHAINS); the Sepolia family rides along for completeness. HL has
 *  no chain id — the relay's isTestnet flag decides it (lib/tenant/gate). */
export const TESTNET_CHAIN_IDS: ReadonlySet<number> = new Set([84532, 11155111, 421614, 11155420])

/** Chain names for the desk's sentences (never for logic). */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
  4663: 'Robinhood Chain',
  84532: 'Base Sepolia',
  11155111: 'Sepolia',
  421614: 'Arbitrum Sepolia',
  11155420: 'OP Sepolia',
}
export const chainName = (id: number | null | undefined): string =>
  id == null ? 'off-chain' : CHAIN_NAMES[id] ? `${CHAIN_NAMES[id]} (${id})` : `chain ${id}`

/** Ops that only ever REDUCE exposure: a notional cap must never trap a desk
 *  in a position. They still need their venue, chain, op, token and side to be
 *  admitted; only the size rules (and UNPRICED) skip them. */
export const RISK_REDUCING_OPS: ReadonlySet<TenantOp> = new Set(['perp-close'])

/** A token the way the policy lists it: symbols UPPER, 0x addresses lower. */
export function normToken(t: string): string {
  const s = t.trim()
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : s.toUpperCase()
}

/** The optional pause attribution a resolved desk key carries (lib/tenant/store). */
export type PauseCtx = Pick<TenantContext, 'status' | 'sandbox'> & { pausedBy?: 'key' | 'tenant' | null }

type Refusal = Extract<TenantVerdict, { allowed: false }>
const refuse = (reason: Refusal['reason'], detail: string): Refusal => ({ allowed: false, reason, detail })

const money = (n: number) => `$${Math.round(n * 100) / 100}`

/** Is `at` (ms) inside the desk's trading hours? Fails CLOSED on a zone the
 *  runtime cannot read (the validator refuses one at proposal time). An
 *  overnight window (from > to, e.g. 22:00–06:00) belongs to the day it
 *  started, so its after-midnight half checks the PREVIOUS weekday. */
export function withinHours(hours: NonNullable<TenantDeskRule['hours']>, at: number): boolean {
  const local = localClock(hours.tz, at)
  if (!local) return false
  const from = hhmm(hours.from)
  const to = hhmm(hours.to)
  if (from == null || to == null) return false
  const days = new Set(hours.days)
  if (from === to) return days.has(local.day) // a full-day window
  if (from < to) return days.has(local.day) && local.minute >= from && local.minute < to
  if (local.minute >= from) return days.has(local.day)
  if (local.minute < to) return days.has((local.day + 6) % 7)
  return false
}

function hhmm(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
function localClock(tz: string, at: number): { day: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const day = WEEKDAY[get('weekday')]
    const hour = Number(get('hour'))
    const minute = Number(get('minute'))
    if (day === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { day, minute: (hour % 24) * 60 + minute }
  } catch {
    return null
  }
}

/** A zone the runtime can actually read. */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The chains a rule admits: its own list (when present) INSIDE the venue's
 *  own VENUE_CHAINS — a rule can never widen what a venue runs on. null = the
 *  venue is off-chain (Hyperliquid). */
export function ruleChains(rule: TenantVenueRule): number[] | null {
  const venueChains = VENUE_CHAINS[rule.venue]
  if (venueChains === null) return null
  return rule.chains ? rule.chains.filter((c) => venueChains.includes(c)) : [...venueChains]
}

/** The shape half of the check for ONE rule: chain, op, token, side. null =
 *  the rule admits the order's shape. */
function shapeRefusal(rule: TenantVenueRule, order: TenantOrder): Refusal | null {
  const chains = ruleChains(rule)
  if (chains === null) {
    // Off-chain venue: the order must not claim an EVM chain of its own.
    if (order.chainId != null) return refuse('CHAIN_DENIED', `${rule.venue} settles off-chain — an order on ${chainName(order.chainId)} is not a ${rule.venue} order this desk admits.`)
  } else {
    if (order.chainId == null) return refuse('CHAIN_DENIED', `the desk could not name the chain this ${rule.venue} order settles on, and a tenant desk refuses what it cannot judge — name the chain (e.g. "on Base").`)
    if (!chains.includes(order.chainId)) {
      const admitted = chains.length ? chains.map(chainName).join(', ') : 'none'
      return refuse('CHAIN_DENIED', `${rule.venue} on ${chainName(order.chainId)} is outside this desk's policy — the rule admits ${admitted}.`)
    }
  }
  if (rule.ops && !rule.ops.includes(order.op)) {
    return refuse('OP_DENIED', `${order.op} on ${rule.venue} is not an operation this desk's policy admits — admitted: ${rule.ops.join(', ') || 'none'}.`)
  }
  if (rule.tokens) {
    const listed = new Set(rule.tokens.map(normToken))
    const touched = order.tokens.map(normToken)
    if (touched.length === 0) return refuse('TOKEN_DENIED', `the ${rule.venue} rule lists its tokens and the desk could not name the tokens this order touches — a tenant desk refuses what it cannot judge.`)
    const outside = touched.filter((t) => !listed.has(t))
    if (outside.length) return refuse('TOKEN_DENIED', `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not on this desk's ${rule.venue} token list (${[...listed].join(', ') || 'empty'}).`)
  }
  if (rule.sides && (order.side == null || !rule.sides.includes(order.side))) {
    return refuse('SIDE_DENIED', `${order.side ?? 'an unnamed side'} on ${rule.venue} is not a side this desk's policy admits — admitted: ${rule.sides.join(', ') || 'none'}.`)
  }
  return null
}

/**
 * Judge one order. PURE and DEFAULT-DENY — see the header for the check order.
 * `ctx.pausedBy` (lib/tenant/store) names WHICH pause refused; without it a
 * paused context reads as TENANT_PAUSED.
 */
export function evaluateTenantPolicy(doc: TenantPolicyDoc | null, ctx: PauseCtx, order: TenantOrder): TenantVerdict {
  if (ctx.pausedBy === 'key') return refuse('KEY_PAUSED', 'this desk key is paused by a tenant admin — every tool but broker_status and broker_close refuses until it is resumed.')
  if (ctx.status !== 'active' || ctx.pausedBy === 'tenant') return refuse('TENANT_PAUSED', 'this tenant desk is paused by its admins — nothing is opened, offered or relayed until it is resumed.')
  if (!doc) return refuse('NO_POLICY', 'this tenant has no ACTIVE policy — an admin proposes one and a second admin approves it before the desk trades.')

  const desk = doc.desks.find((d) => d.id === order.deskId)
  if (!desk) return refuse('DESK_UNKNOWN', `desk "${order.deskId}" is not in the active policy (desks: ${doc.desks.map((d) => d.id).join(', ') || 'none'}).`)

  const rules = doc.venues.filter((r) => r.venue === order.venue)
  if (rules.length === 0) {
    const named = [...new Set(doc.venues.map((r) => r.venue))]
    return refuse('VENUE_DENIED', `${order.venue} is not a venue this desk's policy admits — admitted: ${named.join(', ') || 'none'}. The policy is default-deny.`)
  }
  // Several rules may name one venue (Base and Ethereum with different caps):
  // the first rule whose SHAPE admits the order governs it; when none does,
  // the first rule's refusal is the honest answer.
  let rule: TenantVenueRule | null = null
  let firstRefusal: Refusal | null = null
  for (const r of rules) {
    const no = shapeRefusal(r, order)
    if (!no) {
      rule = r
      break
    }
    firstRefusal ??= no
  }
  if (!rule) return firstRefusal ?? refuse('VENUE_DENIED', `no ${order.venue} rule admits this order.`)

  if (ctx.sandbox && order.chainId != null && !TESTNET_CHAIN_IDS.has(order.chainId)) {
    return refuse('SANDBOX_ONLY', `this tenant is in the sandbox — ${chainName(order.chainId)} is a mainnet chain. Testnets (Base Sepolia, 84532) trade here; mainnet opens with a plan that includes it.`)
  }

  const at = typeof order.at === 'number' && Number.isFinite(order.at) ? order.at : Date.now()
  if (desk.hours && !withinHours(desk.hours, at)) {
    return refuse('OUTSIDE_HOURS', `desk "${desk.id}" trades ${desk.hours.from}–${desk.hours.to} ${desk.hours.tz} on days ${desk.hours.days.join(',')} (0 = Sunday) — this order arrived outside them.`)
  }

  const reducing = RISK_REDUCING_OPS.has(order.op)
  const usd = order.usd
  const priced = typeof usd === 'number' && Number.isFinite(usd) && usd >= 0
  if (!priced && !reducing) {
    return refuse('UNPRICED', 'the desk could not price this order in dollars, and a tenant order is never warned through — ask in dollars ("Buy $25 of ETH on Base") so the policy can judge it.')
  }

  if (priced && !reducing) {
    const v = usd as number
    if (rule.maxOrderUsd != null && v > rule.maxOrderUsd) return refuse('OVER_ORDER', `${money(v)} is over the ${rule.venue} rule's ${money(rule.maxOrderUsd)} per-order cap.`)
    if (desk.perOrderUsd != null && v > desk.perOrderUsd) return refuse('OVER_ORDER', `${money(v)} is over desk "${desk.id}"'s ${money(desk.perOrderUsd)} per-order cap.`)
    if (desk.perDayUsd != null) {
      const spent = Math.max(0, Number(order.spentTodayUsd ?? 0) || 0)
      if (spent + v > desk.perDayUsd) return refuse('OVER_DAY', `desk "${desk.id}" has signed ${money(spent)} today (UTC); ${money(v)} more would pass its ${money(desk.perDayUsd)} daily cap.`)
    }
  }

  if (rule.maxLeverage != null) {
    const lev = order.leverage ?? 1
    if (!Number.isFinite(lev) || lev > rule.maxLeverage) return refuse('OVER_LEVERAGE', `${lev}x is over the ${rule.venue} rule's ${rule.maxLeverage}x leverage cap.`)
  }
  // Impact is measured by the BUILD, so an order judged before a quote exists
  // (broker_open) carries none and passes here; the leg the builder priced is
  // judged again with its own number (lib/tenant/order orderOfLeg).
  if (rule.maxPriceImpactBps != null && order.priceImpactBps != null && order.priceImpactBps > rule.maxPriceImpactBps) {
    return refuse('OVER_IMPACT', `the quote moves the price ${order.priceImpactBps} bps — over the ${rule.venue} rule's ${rule.maxPriceImpactBps} bps cap.`)
  }

  if (desk.approvals && priced && !reducing && (usd as number) > desk.approvals.overUsd) {
    return { allowed: true, rule, desk, needsApproval: true, approvers: desk.approvals.approvers }
  }
  return { allowed: true, rule, desk, needsApproval: false }
}

/* ── the proposal door's validator ───────────────────────────────────── */

export type PolicyValidation = { ok: true; doc: TenantPolicyDoc } | { ok: false; field: string; error: string }

const DOC_KEYS = new Set(['version', 'default', 'venues', 'desks', 'hooks', 'signing'])
const RULE_KEYS = new Set(['venue', 'chains', 'ops', 'tokens', 'sides', 'maxOrderUsd', 'maxPriceImpactBps', 'maxLeverage'])
const DESK_KEYS = new Set(['id', 'perOrderUsd', 'perDayUsd', 'approvals', 'hours'])
const TOKEN_RE = /^(0x[0-9a-fA-F]{40}|[A-Za-z0-9.]{1,15})$/
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

class Bad extends Error {
  constructor(public field: string, msg: string) {
    super(msg)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function strictKeys(o: Record<string, unknown>, allowed: Set<string>, at: string) {
  for (const k of Object.keys(o)) if (!allowed.has(k)) throw new Bad(at ? `${at}.${k}` : k, `unknown field "${k}" — allowed: ${[...allowed].join(', ')}.`)
}
function posUsd(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1e12) throw new Bad(field, 'must be a positive dollar amount.')
  return v
}
function list<T>(v: unknown, field: string, each: (x: unknown, f: string) => T, opts: { min?: number; max?: number } = {}): T[] {
  if (!Array.isArray(v)) throw new Bad(field, 'must be an array.')
  if (v.length < (opts.min ?? 0)) throw new Bad(field, `must list at least ${opts.min}.`)
  if (v.length > (opts.max ?? 200)) throw new Bad(field, `lists more than ${opts.max ?? 200}.`)
  return v.map((x, i) => each(x, `${field}[${i}]`))
}
const oneOf = <T extends string>(vocab: readonly T[], what: string) => (x: unknown, f: string): T => {
  if (typeof x !== 'string' || !(vocab as readonly string[]).includes(x)) throw new Bad(f, `unknown ${what} ${JSON.stringify(x)} — the vocabulary is: ${vocab.join(', ')}.`)
  return x as T
}

/** Validate (and normalize) a proposed policy document. Names the first bad field. */
export function validatePolicyDoc(raw: unknown): PolicyValidation {
  try {
    return { ok: true, doc: readDoc(raw) }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, field: e.field, error: `${e.field}: ${e.message}` }
    return { ok: false, field: 'document', error: e instanceof Error ? e.message : 'invalid policy document.' }
  }
}

function readDoc(raw: unknown): TenantPolicyDoc {
  if (!isObj(raw)) throw new Bad('document', 'must be a JSON object (the TenantPolicyDoc).')
  strictKeys(raw, DOC_KEYS, '')
  if (raw.version !== 1) throw new Bad('version', 'must be 1.')
  if (raw.default !== 'deny') throw new Bad('default', 'must be "deny" — a tenant policy is default-deny in v1.')

  const venues = list(raw.venues, 'venues', readRule, { max: 64 })
  const desks = list(raw.desks, 'desks', readDesk, { min: 1, max: 64 })
  const seen = new Set<string>()
  desks.forEach((d, i) => {
    if (seen.has(d.id)) throw new Bad(`desks[${i}].id`, `desk id "${d.id}" appears twice.`)
    seen.add(d.id)
  })

  const doc: TenantPolicyDoc = { version: 1, default: 'deny', venues, desks }
  if (raw.hooks !== undefined) {
    if (!isObj(raw.hooks)) throw new Bad('hooks', 'must be an object { preTrade?, postTrade? }.')
    strictKeys(raw.hooks, new Set(['preTrade', 'postTrade']), 'hooks')
    const hooks: NonNullable<TenantPolicyDoc['hooks']> = {}
    for (const k of ['preTrade', 'postTrade'] as const) {
      const v = raw.hooks[k]
      if (v === undefined) continue
      if (typeof v !== 'string' || v.length > 400 || !/^https:\/\/[^\s]+$/.test(v)) throw new Bad(`hooks.${k}`, 'must be an https URL.')
      hooks[k] = v
    }
    doc.hooks = hooks
  }
  if (raw.signing !== undefined) {
    if (!isObj(raw.signing)) throw new Bad('signing', 'must be an object { lane, wallets }.')
    strictKeys(raw.signing, new Set(['lane', 'wallets']), 'signing')
    const lane = oneOf(SIGNING_LANES, 'signing lane')(raw.signing.lane, 'signing.lane')
    const wallets = list(
      raw.signing.wallets,
      'signing.wallets',
      (x, f) => {
        if (typeof x !== 'string' || !WALLET_RE.test(x)) throw new Bad(f, 'must be a 0x wallet address.')
        return x.toLowerCase()
      },
      { max: 50 },
    )
    doc.signing = { lane, wallets }
  }
  return doc
}

function readRule(x: unknown, at: string): TenantVenueRule {
  if (!isObj(x)) throw new Bad(at, 'must be a venue rule object.')
  strictKeys(x, RULE_KEYS, at)
  const venue: TenantVenue = oneOf(TENANT_VENUES, 'venue')(x.venue, `${at}.venue`)
  const rule: TenantVenueRule = { venue }
  if (x.chains !== undefined) {
    const venueChains = VENUE_CHAINS[venue]
    if (venueChains === null) throw new Bad(`${at}.chains`, `${venue} settles off-chain — omit chains.`)
    rule.chains = list(
      x.chains,
      `${at}.chains`,
      (c, f) => {
        if (typeof c !== 'number' || !Number.isInteger(c)) throw new Bad(f, 'must be an integer chain id.')
        if (!venueChains.includes(c)) throw new Bad(f, `${venue} does not run on chain ${c} — it runs on ${venueChains.join(', ')}.`)
        return c
      },
      { min: 1, max: 16 },
    )
  }
  if (x.ops !== undefined) rule.ops = list(x.ops, `${at}.ops`, oneOf(TENANT_OPS, 'op'), { min: 1, max: TENANT_OPS.length })
  if (x.tokens !== undefined) {
    rule.tokens = list(
      x.tokens,
      `${at}.tokens`,
      (t, f) => {
        if (typeof t !== 'string' || !TOKEN_RE.test(t.trim())) throw new Bad(f, 'must be a token symbol or a 0x address.')
        return normToken(t)
      },
      { min: 1, max: 200 },
    )
  }
  if (x.sides !== undefined) rule.sides = list(x.sides, `${at}.sides`, oneOf(TENANT_SIDES, 'side'), { min: 1, max: TENANT_SIDES.length }) as TenantSide[]
  if (x.maxOrderUsd !== undefined) rule.maxOrderUsd = posUsd(x.maxOrderUsd, `${at}.maxOrderUsd`)
  if (x.maxPriceImpactBps !== undefined) {
    const v = x.maxPriceImpactBps
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) throw new Bad(`${at}.maxPriceImpactBps`, 'must be 0–10000 bps.')
    rule.maxPriceImpactBps = v
  }
  if (x.maxLeverage !== undefined) {
    const v = x.maxLeverage
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 100) throw new Bad(`${at}.maxLeverage`, 'must be 1–100.')
    rule.maxLeverage = v
  }
  return rule
}

function readDesk(x: unknown, at: string): TenantDeskRule {
  if (!isObj(x)) throw new Bad(at, 'must be a desk object.')
  strictKeys(x, DESK_KEYS, at)
  if (typeof x.id !== 'string' || !DESK_ID_RE.test(x.id)) throw new Bad(`${at}.id`, 'must be a desk id: lowercase letters, digits and dashes, 1–32 chars.')
  const desk: TenantDeskRule = { id: x.id }
  if (x.perOrderUsd !== undefined) desk.perOrderUsd = posUsd(x.perOrderUsd, `${at}.perOrderUsd`)
  if (x.perDayUsd !== undefined) desk.perDayUsd = posUsd(x.perDayUsd, `${at}.perDayUsd`)
  if (x.approvals !== undefined) {
    const a = x.approvals
    if (!isObj(a)) throw new Bad(`${at}.approvals`, 'must be { overUsd, approvers }.')
    strictKeys(a, new Set(['overUsd', 'approvers']), `${at}.approvals`)
    if (typeof a.overUsd !== 'number' || !Number.isFinite(a.overUsd) || a.overUsd < 0) throw new Bad(`${at}.approvals.overUsd`, 'must be a dollar amount ≥ 0.')
    if (typeof a.approvers !== 'number' || !Number.isInteger(a.approvers) || a.approvers < 1 || a.approvers > 10) throw new Bad(`${at}.approvals.approvers`, 'must be an integer 1–10.')
    desk.approvals = { overUsd: a.overUsd, approvers: a.approvers }
  }
  if (x.hours !== undefined) {
    const h = x.hours
    if (!isObj(h)) throw new Bad(`${at}.hours`, 'must be { tz, from, to, days }.')
    strictKeys(h, new Set(['tz', 'from', 'to', 'days']), `${at}.hours`)
    if (!validTimeZone(h.tz)) throw new Bad(`${at}.hours.tz`, `${JSON.stringify(h.tz)} is not an IANA time zone (e.g. "America/New_York").`)
    if (typeof h.from !== 'string' || !HHMM_RE.test(h.from)) throw new Bad(`${at}.hours.from`, 'must be "HH:MM" (24h).')
    if (typeof h.to !== 'string' || !HHMM_RE.test(h.to)) throw new Bad(`${at}.hours.to`, 'must be "HH:MM" (24h).')
    const days = list(
      h.days,
      `${at}.hours.days`,
      (d, f) => {
        if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) throw new Bad(f, 'must be a weekday 0–6 (Sunday = 0).')
        return d
      },
      { min: 1, max: 7 },
    )
    if (new Set(days).size !== days.length) throw new Bad(`${at}.hours.days`, 'lists a day twice.')
    desk.hours = { tz: h.tz, from: h.from, to: h.to, days }
  }
  return desk
}

/** The README's demo document: CoW + Uniswap v3 on Base, $500 an order, one
 *  desk `macro` with one approval over $250. The drive and the pins propose it. */
export const SAMPLE_POLICY: TenantPolicyDoc = {
  version: 1,
  default: 'deny',
  venues: [
    { venue: 'cow', chains: [8453], ops: ['swap', 'limit'], maxOrderUsd: 500 },
    { venue: 'uniswap-v3', chains: [8453], ops: ['swap'], maxOrderUsd: 500 },
  ],
  desks: [{ id: 'macro', perOrderUsd: 500, perDayUsd: 5_000, approvals: { overUsd: 250, approvers: 1 } }],
}
