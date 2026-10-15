// PRINT ALERTS (2026-10-13): the /live trigger rules, armed on the server.
//
// /live's trigger rail (components/live/LiveFeed) runs lib/tape's three
// rules — big print · one taker, repeatedly · one-sided minute — over the
// stream in the browser, and dies with the tab. This module is the pure
// half of the same rules outliving it: a rule a signed-in wallet arms is a
// row (print_alerts), and /api/cron/prints reopens Dune's feed every minute
// from a stored per-venue cursor (`?resume_after=`, feed_cursors), consumes
// the minute it missed, evaluates the SAME detectTriggers over those fills
// and writes a firing through the price alerts' own notification path
// (lib/alerts-exec notifyAlertFired → alert_notifications → the bell, and
// lib/email when the rule named a verified address). Nothing here sends
// the chip: a fired sentence is past tense with measured numbers, and the
// follow chip rides only when lib/trade-venue-gate canTradeAsk passes it.
//
// Measured on HyperCore, 2026-10-13 (scratchpad/dune-horizon-probe.mjs,
// the squad's 60s reading extended):
//   • a cursor 120s old resumes at the very next frame (stride 3) and
//     catches up in 1.4s; 300s old in 2.1s; 89 minutes old is ACCEPTED and
//     replays ~66 seconds of feed per second (11 min of backlog in 10s);
//     25.8 HOURS old is accepted too — the retained range is more than a day.
//   • a cursor outside the retained range (`resume_after=1`) or from the
//     future is refused at the upgrade: close 1006 within ~0.4s, no open,
//     no frame. That is the rejection signature pullOutcome reads.
//   • blocking the reader for 25s on a six-minute backlog provoked no 1008:
//     the venue buffered and delivered on unblock. 1008 (the runbook: a
//     live consumer that fell behind) is still handled — reconnect once
//     from the last durable cursor with backoff.
// The runbook's rules this module keeps: persist the cursor only after the
// frame was handled (the sweep evaluates, then stores); never silently
// restart at the tip — a refused cursor is recorded as a gap (feed_cursors
// gap_from / gap_at / gap_note, read back on the rail) and THEN the pass
// rejoins at the tip and says so; a numeric sequence gap alone proves
// nothing (nothing here reads the stride).
//
// Pinned by scripts/print-alert-pins.ts. No browser, no network, no DB.

import { DUNE_VENUE_IDS, MARKET_PARAM_RE, PERP_VENUES, duneVenue, type DuneVenueId } from '@/lib/dune'
import { DEFAULT_THRESHOLDS, TAPE_VENUES, TAPE_VENUE_LABEL, TRIGGER_LABEL, chainWord, dexAskTicker, detectTriggers, fmtUsd, tapeMarket, type FollowAsk, type TapeFill, type TapeVenue, type TriggerEvent, type TriggerRule, type TriggerThresholds } from '@/lib/tape'

// ── The rules a row can carry ────────────────────────────────────────────────

export const PRINT_RULES: readonly TriggerRule[] = ['big-print', 'whale-repeat', 'flow-skew']

/** The big-print bar the rail offers (the only user-set threshold today). */
export const BIG_PRINT_CHOICES: readonly number[] = [10_000, 50_000, 250_000, 1_000_000]

/** A stream keeps printing: one rule fires at most once per market inside
 *  this window, so a busy minute is one notification, not sixty. */
export const PRINT_ALERT_COOLDOWN_MS = 10 * 60_000
/** Notifications one rule may write in one pass (the newest); the rest are
 *  counted in the newest one's body — a rule on "any market" at $10K can
 *  trip on thirty books in a minute. */
export const PRINT_ALERT_MAX_PER_PASS = 3
/** Notifications one rule may write inside one cooldown window, across
 *  passes: the bell and the inbox are never flooded by a loud rule (a $10K
 *  bar on any HyperCore market trips on a dozen books a minute, measured
 *  2026-10-13). Past the budget a candidate is counted, not written. */
export const PRINT_ALERT_MAX_PER_WINDOW = 6
/** Active rules one wallet may hold (the state each carries is bounded). */
export const PRINT_ALERT_MAX_PER_OWNER = 24
/** The rules read "the last minute" relative to a clock; a backlog is
 *  walked in steps of this so a minute replayed two minutes late still
 *  sees its own window. */
export const PRINT_EVAL_STEP_MS = 10_000
/** Event ids a rule remembers across passes (dedupe: an UPDATE frame
 *  re-delivers a block's prints with the same ids). */
export const PRINT_RECENT_EVENTS_MAX = 300
/** The cron's consumption budget (the route's literal maxDuration is 60;
 *  the rest is the DB and the mail). */
export const PRINT_CRON_BUDGET_MS = 40_000
export const PRINT_CRON_MAX_BUDGET_MS = 45_000
export const PRINT_CRON_MAX_DURATION_S = 60
/** A pass leases a venue this long so a slow pass and the next never read
 *  one venue at once (a cursor is per endpoint, per the runbook). */
export const FEED_LEASE_MS = 55_000

export interface PrintAlertShape {
  id: string
  owner: string
  rule: TriggerRule
  /** The venue's spelling (`HYPE`, `xyz:NVDA`); null = any market. */
  market: string | null
  venues: DuneVenueId[]
  thresholds: TriggerThresholds
  status: 'active' | 'paused'
  email: string | null
  lastFiredAt: string | null
  firedCount: number
  createdAt: string
}

export interface PrintAlertInput {
  rule: TriggerRule
  market: string | null
  venues: DuneVenueId[]
  thresholds: TriggerThresholds
}

/** The body /api/print-alerts takes → a row's fields, or a refusal by name.
 *  `email` is not read here: lib/watchlists-store readAlertEmail owns it
 *  (a verified subscriber only — the price alerts' own rule). */
export function readPrintAlertBody(body: unknown): { input: PrintAlertInput } | { problem: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const rule = b.rule
  if (typeof rule !== 'string' || !PRINT_RULES.includes(rule as TriggerRule)) return { problem: `rule must be ${PRINT_RULES.join(' | ')}.` }
  let market: string | null = null
  if (b.market != null && b.market !== '') {
    if (typeof b.market !== 'string' || !MARKET_PARAM_RE.test(b.market.trim())) return { problem: 'market must be a venue spelling like HYPE or xyz:NVDA, or empty for any market.' }
    market = b.market.trim()
  }
  const venues = parseVenues(b.venues, null)
  if (!venues) return { problem: `venues must name at least one of ${DUNE_VENUE_IDS.join(', ')}.` }
  let bigPrintUsd = DEFAULT_THRESHOLDS.bigPrintUsd
  if (b.bigPrintUsd != null) {
    const n = Number(b.bigPrintUsd)
    if (!BIG_PRINT_CHOICES.includes(n)) return { problem: `bigPrintUsd must be one of ${BIG_PRINT_CHOICES.map((v) => fmtUsd(v)).join(', ')}.` }
    bigPrintUsd = n
  }
  return { input: { rule: rule as TriggerRule, market, venues, thresholds: { ...DEFAULT_THRESHOLDS, bigPrintUsd } } }
}

/** A stored `venues` jsonb (or a request's list) → known ids in table
 *  order, deduped; nothing usable → `fallback` (the perp venues for a row
 *  read back; null for a request, so the caller refuses by name). */
export function parseVenues(raw: unknown, fallback: readonly DuneVenueId[] | null = PERP_VENUES): DuneVenueId[] | null {
  if (raw == null) return fallback ? [...fallback] : [...PERP_VENUES]
  if (!Array.isArray(raw)) return fallback ? [...fallback] : null
  const want = new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toLowerCase()))
  const out = DUNE_VENUE_IDS.filter((id) => want.has(id))
  if (out.length) return out
  return fallback ? [...fallback] : null
}

/** A stored `thresholds` jsonb → the full TriggerThresholds, every field a
 *  finite positive number, the defaults under anything missing or odd. */
export function parseThresholds(raw: unknown): TriggerThresholds {
  const out: TriggerThresholds = { ...DEFAULT_THRESHOLDS }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_THRESHOLDS) as (keyof TriggerThresholds)[]) {
    const n = Number(r[k])
    if (Number.isFinite(n) && n > 0) out[k] = n
  }
  return out
}

/** The rule in words: `Big print ≥ $50.00K on HYPE` · `One taker, repeatedly on any market`. */
export function printAlertLabel(a: Pick<PrintAlertShape, 'rule' | 'market' | 'thresholds'>): string {
  const where = a.market ?? 'any market'
  if (a.rule === 'big-print') return `Big print ≥ ${fmtUsd(a.thresholds.bigPrintUsd)} on ${where}`
  return `${TRIGGER_LABEL[a.rule]} on ${where}`
}

/** `every perp venue` · `every venue` · `Hyperliquid perps + DEX swaps · Base`. */
export function printVenueWords(venues: readonly DuneVenueId[]): string {
  if (venues.length === DUNE_VENUE_IDS.length) return 'every venue'
  if (venues.length === PERP_VENUES.length && PERP_VENUES.every((v) => venues.includes(v))) return 'every perp venue'
  return venues.map((v) => duneVenue(v)?.label ?? v).join(' + ')
}

// ── What a rule remembers between passes ─────────────────────────────────────

export interface PrintRecent {
  /** Event ids already fired or judged (lib/tape's `seen`), newest last. */
  events: string[]
  /** market → the ms stamp of the last firing on it (the cooldown). */
  fires: Record<string, number>
  /** The ms stamps of the notifications written (the per-window budget). */
  sent: number[]
}

export function parseRecent(raw: unknown): PrintRecent {
  const out: PrintRecent = { events: [], fires: {}, sent: [] }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.events)) out.events = r.events.filter((e): e is string => typeof e === 'string').slice(-PRINT_RECENT_EVENTS_MAX)
  if (r.fires && typeof r.fires === 'object') {
    for (const [m, at] of Object.entries(r.fires as Record<string, unknown>)) {
      const n = Number(at)
      if (MARKET_PARAM_RE.test(m) && Number.isFinite(n) && n > 0) out.fires[m] = n
    }
  }
  if (Array.isArray(r.sent)) out.sent = r.sent.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(-PRINT_ALERT_MAX_PER_WINDOW * 4)
  return out
}

/** Drop what no longer matters: fires and sent stamps older than the cooldown, events past the cap. */
export function trimRecent(r: PrintRecent, nowMs: number, cooldownMs = PRINT_ALERT_COOLDOWN_MS): PrintRecent {
  const fires: Record<string, number> = {}
  for (const [m, at] of Object.entries(r.fires)) if (nowMs - at < cooldownMs) fires[m] = at
  return { events: r.events.slice(-PRINT_RECENT_EVENTS_MAX), fires, sent: r.sent.filter((t) => nowMs - t < cooldownMs) }
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface PrintFire {
  event: TriggerEvent
  /** The fill the event hangs on: the big print itself, or the market's
   *  newest fill inside the window (whale / skew). */
  price: number
  venue: TapeVenue
  chainId: number | null
}

export interface PrintEvaluation {
  fires: PrintFire[]
  /** Candidates past the per-pass cap or the per-window budget — folded
   *  into the newest notification's body when one is written, else counted. */
  more: number
  /** Fires skipped by the cooldown (a market that fired within the window). */
  cooled: number
  recent: PrintRecent
}

/** The fill tags a venue id reaches: `hypercore` → hyperliquid fills,
 *  `dex-base` → dex fills on chain 8453. */
function venueMatcher(venues: readonly DuneVenueId[]): (f: Pick<TapeFill, 'venue' | 'chainId'>) => boolean {
  const tags = venues.map((id) => duneVenue(id)).filter((v): v is NonNullable<typeof v> => !!v).map((v) => `${v.venue}|${v.chainId ?? ''}`)
  const set = new Set(tags)
  return (f) => set.has(`${f.venue}|${f.chainId ?? ''}`)
}

/**
 * Run one rule over the fills a pass consumed (any order, any venue — the
 * row's venues and market scope it here). The window walks the fills in
 * PRINT_EVAL_STEP_MS steps so a replayed backlog is judged minute by
 * minute the way the browser judged it live; `recent` dedupes across
 * passes and cools a market down after a firing; the newest
 * PRINT_ALERT_MAX_PER_PASS survivors fire — inside the rule's
 * PRINT_ALERT_MAX_PER_WINDOW budget — and the rest are counted.
 */
export function evaluatePrintAlert(
  alert: Pick<PrintAlertShape, 'rule' | 'market' | 'venues' | 'thresholds'>,
  fills: readonly TapeFill[],
  recent: PrintRecent,
  opts: { stepMs?: number; cooldownMs?: number; maxFires?: number; maxPerWindow?: number; now?: number } = {},
): PrintEvaluation {
  const stepMs = opts.stepMs ?? PRINT_EVAL_STEP_MS
  const cooldownMs = opts.cooldownMs ?? PRINT_ALERT_COOLDOWN_MS
  const maxFires = opts.maxFires ?? PRINT_ALERT_MAX_PER_PASS
  const maxPerWindow = opts.maxPerWindow ?? PRINT_ALERT_MAX_PER_WINDOW
  const inVenue = venueMatcher(alert.venues)
  const scope = fills.filter((f) => inVenue(f) && (!alert.market || f.market === alert.market) && Number.isFinite(f.at)).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
  const seen = new Set(recent.events)
  if (scope.length === 0) return { fires: [], more: 0, cooled: 0, recent: trimRecent({ events: [...seen], fires: recent.fires, sent: recent.sent }, opts.now ?? Date.now(), cooldownMs) }
  const newest = scope[0].at
  const oldest = scope[scope.length - 1].at
  const byId = new Map(scope.map((f) => [f.id, f] as const))
  const candidates: PrintFire[] = []
  let T = Math.ceil(oldest / stepMs) * stepMs
  const marks: number[] = []
  while (T < newest) {
    marks.push(T)
    T += stepMs
  }
  marks.push(newest)
  for (const t of marks) {
    const window = scope.filter((f) => f.at <= t && f.at >= t - 70_000)
    if (window.length === 0) continue
    for (const e of detectTriggers(window, t, seen, alert.thresholds)) {
      if (e.rule !== alert.rule) continue
      const own = e.rule === 'big-print' ? byId.get(e.id.slice('big:'.length)) : window.find((f) => f.market === e.market)
      if (!own) continue
      candidates.push({ event: e, price: own.price, venue: own.venue, chainId: own.chainId })
    }
  }
  candidates.sort((a, b) => a.event.at - b.event.at)
  const fires: Record<string, number> = { ...recent.fires }
  const accepted: PrintFire[] = []
  let cooled = 0
  for (const c of candidates) {
    const last = fires[c.event.market]
    if (last != null && c.event.at - last < cooldownMs) {
      cooled++
      continue
    }
    fires[c.event.market] = c.event.at
    accepted.push(c)
  }
  const at = opts.now ?? newest
  const budget = Math.max(0, maxPerWindow - recent.sent.filter((t) => at - t < cooldownMs).length)
  const kept = accepted.slice(Math.max(0, accepted.length - Math.min(maxFires, budget)))
  const more = accepted.length - kept.length
  const sent = [...recent.sent, ...kept.map((f) => f.event.at)]
  return { fires: kept.reverse(), more, cooled, recent: trimRecent({ events: [...seen], fires, sent }, at, cooldownMs) }
}

// ── The notification ─────────────────────────────────────────────────────────

export interface PrintNotice {
  /** The bell quotes a live price beside the symbol it hit (the /t symbol when there is one). */
  symbol: string
  title: string
  body: string
  actionAsk: string | null
  price: number
  /** Where the mail points: the tape, filtered to the market. */
  href: string
}

/** The words the bell and the mail carry. Past tense, measured numbers
 *  (lib/tape wrote the sentence from the fills), the venue named, the chip
 *  only when the caller's gate passed it. */
export function printNotification(alert: Pick<PrintAlertShape, 'rule'>, fire: PrintFire, follow: FollowAsk | null, more = 0): PrintNotice {
  const m = tapeMarket(fire.event.market)
  const ticker = fire.venue === 'dex' ? dexAskTicker(fire.event.market) : m.ticker
  const symbol = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PRINT'
  const chain = chainWord(fire.chainId)
  const where = `${TAPE_VENUE_LABEL[fire.venue]}${chain ? ` · ${chain}` : ''}`
  const parts = [fire.event.text, `${where}, through Dune's feed.`]
  if (more > 0) parts.push(`${more} more in the same pass.`)
  if (follow) parts.push('The chip is ready to send — it moves nothing until you sign.')
  return {
    symbol,
    title: `${TRIGGER_LABEL[alert.rule]} on ${fire.event.market}`,
    body: parts.join(' '),
    actionAsk: follow?.ask ?? null,
    price: fire.price,
    href: `/live?m=${encodeURIComponent(fire.event.market)}`,
  }
}

// ── The cursor ───────────────────────────────────────────────────────────────

export type PullOutcome = 'tip' | 'budget' | 'idle' | 'closed' | 'rejected' | 'fell-behind' | 'unconfigured' | 'error'

/** A resumed socket the venue refuses dies inside this window with no
 *  open and no frame (measured: 1006 at ~0.4s for a cursor outside the
 *  retained range, and for one from the future). */
export const CURSOR_REJECT_WINDOW_MS = 2_000
/** A frame whose block is this close to the clock is the tip. */
export const CAUGHT_UP_MS = 3_000
/** Once at the tip a pull reads this much more, then stops: the next pass
 *  resumes strictly after the last frame, so passes are contiguous. */
export const TIP_SETTLE_MS = 2_000
/** No frame for this long after the open = a quiet venue; stop, keep the cursor. */
export const PULL_IDLE_MS = 12_000

export interface PullFacts {
  resumed: boolean
  opened: boolean
  frames: number
  closeCode: number | null
  livedMs: number
  caughtUp: boolean
  budgetHit: boolean
  idle: boolean
  unconfigured?: boolean
}

export function pullOutcome(f: PullFacts): PullOutcome {
  if (f.unconfigured) return 'unconfigured'
  if (f.closeCode === 1008) return 'fell-behind'
  if (f.resumed && f.frames === 0 && !f.opened && f.livedMs < CURSOR_REJECT_WINDOW_MS) return 'rejected'
  if (f.budgetHit) return 'budget'
  if (f.caughtUp) return 'tip'
  if (f.idle) return 'idle'
  if (f.frames > 0) return 'closed'
  return 'error'
}

export function ageWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** The gap a refused cursor leaves, in words the rail and the cron report
 *  carry — recorded, never papered over (the runbook). */
export function gapNote(venueLabel: string, cursor: string, cursorAgeMs: number | null): string {
  const age = cursorAgeMs != null ? ` from ${ageWords(cursorAgeMs)} ago` : ''
  return `${venueLabel} refused the stored cursor${age} (${cursor}); the prints since then were not watched. Rejoined at the tip.`
}

// ── The rail's status line ───────────────────────────────────────────────────

export interface FeedStatusShape {
  venue: DuneVenueId
  cursor: string | null
  tipAt: string | null
  lastOutcome: string | null
  lastPassAt: string | null
  gapAt: string | null
  gapNote: string | null
}

export function feedStatusWords(f: FeedStatusShape, nowMs: number): string {
  const label = duneVenue(f.venue)?.label ?? f.venue
  if (!f.lastPassAt) return `${label}: no pass yet — the first opens the feed at the tip.`
  const pass = ageWords(nowMs - Date.parse(f.lastPassAt))
  const tip = f.tipAt ? `, read up to ${ageWords(nowMs - Date.parse(f.tipAt))} ago` : ''
  const gap = f.gapAt && nowMs - Date.parse(f.gapAt) < 24 * 60 * 60_000 ? ` Gap ${ageWords(nowMs - Date.parse(f.gapAt))} ago: ${f.gapNote ?? 'the feed refused the cursor'}` : ''
  return `${label}: last pass ${pass} ago${tip} (${f.lastOutcome ?? 'no outcome'}).${gap}`
}

// ── The cron's fixture (internal runs only) ─────────────────────────────────

export const FIXTURE_MAX_FILLS = 2_000

/** The harness proves "a rule fires on a fill" without waiting for a
 *  $50K print: a POST to the cron carries fills, honored only on an
 *  internal run and only against is_internal rows (the price cron's own
 *  fixture rule). Every row is checked; a bad one is dropped by shape. */
export function fixtureFills(raw: unknown): TapeFill[] {
  if (!Array.isArray(raw)) return []
  const out: TapeFill[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    const id = typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 64 ? x.id : null
    const market = typeof x.market === 'string' && MARKET_PARAM_RE.test(x.market) ? x.market : null
    const side = x.side === 'buy' || x.side === 'sell' ? x.side : null
    const size = Number(x.size)
    const price = Number(x.price)
    const at = Number(x.at)
    if (!id || !market || !side || !(size > 0) || !(price > 0) || !Number.isFinite(at)) continue
    const usd = Number(x.usd)
    const venue = typeof x.venue === 'string' && TAPE_VENUES.includes(x.venue as TapeVenue) ? (x.venue as TapeVenue) : 'hyperliquid'
    const chainId = Number.isFinite(Number(x.chainId)) && x.chainId != null ? Number(x.chainId) : null
    out.push({
      id,
      market,
      side,
      size,
      price,
      usd: usd > 0 ? usd : size * price,
      at,
      taker: typeof x.taker === 'string' && x.taker.length <= 80 ? x.taker.toLowerCase() : null,
      maker: null,
      hash: null,
      effect: null,
      block: null,
      source: 'dune',
      venue,
      chainId: venue === 'dex' ? chainId : null,
    })
    if (out.length >= FIXTURE_MAX_FILLS) break
  }
  return out
}

// ── The held arm (a guest's tap survives the door) ──────────────────────────

export const HELD_PRINT_ARM_KEY = 'pantessa.prints.heldArm.v1'
export const HELD_PRINT_ARM_TTL_MS = 10 * 60_000

export interface HeldPrintArm {
  rule: TriggerRule
  market: string | null
  bigPrintUsd: number
}

export function heldPrintArmRecord(arm: HeldPrintArm, path: string, nowMs: number): string {
  return JSON.stringify({ v: 1, rule: arm.rule, market: arm.market, bigPrintUsd: arm.bigPrintUsd, path, at: nowMs })
}

/** The record back, only for the same path inside the TTL, only a rule the
 *  body reader would accept; anything else is nothing. */
export function readHeldPrintArm(raw: string | null | undefined, path: string, nowMs: number): HeldPrintArm | null {
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as Record<string, unknown>
    if (r.v !== 1 || r.path !== path) return null
    const at = Number(r.at)
    if (!Number.isFinite(at) || nowMs - at > HELD_PRINT_ARM_TTL_MS || at > nowMs + 60_000) return null
    const read = readPrintAlertBody({ rule: r.rule, market: r.market, bigPrintUsd: r.bigPrintUsd })
    if ('problem' in read) return null
    return { rule: read.input.rule, market: read.input.market, bigPrintUsd: read.input.thresholds.bigPrintUsd }
  } catch {
    return null
  }
}
