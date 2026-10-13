// lib/pick-alerts.ts — ALERTS ON YOUR PICK (GTM squad 2026-10-13, lane ALERTS).
// Pure: the plan a one-tap control arms on a market, the sentence it shows,
// the chip a fired alert hands back, the one-consent "Watch these" plan over
// the whole pick, the guest rule, and the record a held arm leaves while the
// sign-in door is open. No React, no fetch, no DOM — `scripts/pick-alert-pins.ts`
// pins every rule here without a server.
//
// Everything lands on the EXISTING alerts (POST /api/alerts → lib/watchlists-
// store createAlert, the per-minute sweep in lib/alerts-exec, the bell in
// shell/RailAlerts). This module composes bodies that API already accepts;
// it never invents a condition.
//
// Honesty rules:
//   • A market the sweep cannot PRICE gets no control. The sweep quotes
//     through lib/quotes → chartPairFor, so a pick the chart can't name
//     (ZK, AZTEC, PURR, kPEPE today) would arm an alert that never fires.
//     `alertSymbolFor` returns null for those and the control renders
//     nothing — never a button that can't do what it says.
//   • ±N% is ONE row: the API's `pct_move` fires on |move| ≥ N either way
//     (lib/watchlists alertFires), so "both directions" needs no second row.
//   • The base is the server's: a body with no `basePrice` makes createAlert
//     anchor the rule on its own quote read (the same feed the sweep prices
//     with). The client never names the level it is measured from.
//   • The fired chip is the battle's own follow ask (lib/tape followAsk —
//     "Long $25 of HYPE on Hyperliquid", "Buy $25 of NVDA"), and only when
//     the venue gate passes it; otherwise the alert notifies and hands no
//     chip. A chip that would be refused at the door is never stored.
//   • Alerts are an account's (rule 6: connect to act, SIGN IN to keep): a
//     guest or a connect-only wallet gets the unified sign-in door, never a
//     raw connect modal, and the arm it held runs once the session lands.

import { chartPairFor } from '@/lib/charts'
import { MAX_PICK } from '@/lib/market-pick'
import { FOLLOW_USD, followAsk, tapeMarket } from '@/lib/tape'
import { alertLabel, type AlertCondition } from '@/lib/watchlists'

/** The default distance, both ways (Decision for Nate: ±5%). */
export const DEFAULT_ALERT_PCT = 5
/** "Watch these" arms at most this many rows in one consent = the pick's own cap. */
export const WATCH_CAP = MAX_PICK
/** sessionStorage: the arm a guest tapped while the door was open. */
export const HELD_ARM_KEY = 'pantessa.alerts.heldArm.v1'
/** A held arm is honored this long after the tap (the Google lane leaves the page). */
export const HELD_ARM_TTL_MS = 10 * 60_000
/** Fired on `window` after an arm that had no shared alerts instance to tell
 *  (the deck on `/` sits outside the index's side column), so the page's
 *  bell re-reads at once instead of at its next 30s poll. */
export const ALERTS_CHANGED_EVENT = 'pantessa:alerts-changed'

/** A tap retries ONCE, this long after a "no live price" answer: the server's
 *  quote read missed the venue for a moment (measured: the first read seconds
 *  after a cold start answered nothing for HYPE while the venue was fine). */
export const ARM_RETRY_MS = 1500
/** The server's own refusal when its quote read found no price (createAlert). */
export function isNoPriceYet(message: string | null | undefined): boolean {
  return /^No live price for /.test(String(message ?? ''))
}

export type ArmSeat = 'scoreboard' | 'deck' | 'strip'

/** The body POST /api/alerts takes for a pick alert. `basePrice` is left to
 *  the server on purpose (see the header). */
export interface PickAlertBody {
  symbol: string
  condition: AlertCondition
  value: number
  actionAsk: string | null
}

export interface PickAlertPlan {
  /** The venue's market name, as the pick spells it (HYPE, xyz:NVDA). */
  market: string
  /** The symbol the alerts API stores and the sweep quotes (HYPE, NVDA). */
  symbol: string
  pct: number
  body: PickAlertBody
  /** What the control says: "Tell me when HYPE moves 5%". */
  sentence: string
  /** The chip the bell hands back when it fires, or null when no venue can fill it. */
  chip: string | null
}

/** Only an active or paused rule counts as "already armed" — a fired one is done. */
export interface ArmedRuleLike {
  symbol: string
  condition: string
  value: number
  status: string
}

/**
 * The symbol an alert on this market is stored and priced under, or null
 * when the sweep could not price it (no chart pair → no quote → it would
 * never fire). `xyz:NVDA` → `NVDA`; `HYPE` → `HYPE`; `ZK` → null (today).
 */
export function alertSymbolFor(market: string): string | null {
  const raw = String(market ?? '').trim()
  if (!raw) return null
  const t = tapeMarket(raw)
  if (!/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(t.ticker)) return null
  const pair = chartPairFor(t.ticker)
  return pair?.symbol ?? null
}

/** The ticker a sentence names for this market (the stock perp drops its dex). */
export function armTicker(market: string): string {
  return tapeMarket(String(market ?? '').trim()).ticker
}

/** A percent distance the API accepts: a finite number in (0, 100), else the default. */
export function cleanPct(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return DEFAULT_ALERT_PCT
  return Math.round(n * 100) / 100
}

/** "Tell me when HYPE moves 5%" — the chat lane's own alert grammar
 *  (lib/markets-ai parseAlertAsk reads this exact shape), so the control
 *  says what a typed ask would. */
export function armSentence(market: string, pct = DEFAULT_ALERT_PCT): string {
  return `Tell me when ${armTicker(market)} moves ${cleanPct(pct)}%`
}

/** The follow ask a fired alert hands back: the battle's own recruit
 *  sentence for the market's buy side (a coin → an HL long, a stock perp →
 *  the Robinhood Chain buy). Null when lib/tape composes none. */
export function alertFollowAsk(market: string): string | null {
  return followAsk({ market: String(market ?? '').trim(), side: 'buy' }, FOLLOW_USD)?.ask ?? null
}

/**
 * The plan one tap arms: ONE `pct_move` row at ±pct, no base (the server's
 * read), the follow ask as the chip only when `canAct` passes it. Null when
 * the market can't be priced.
 */
export function pickAlertPlan(market: string, pct: number = DEFAULT_ALERT_PCT, canAct: (ask: string) => boolean = () => true): PickAlertPlan | null {
  const symbol = alertSymbolFor(market)
  if (!symbol) return null
  const p = cleanPct(pct)
  const follow = alertFollowAsk(market)
  const chip = follow && canAct(follow) ? follow : null
  return {
    market: String(market).trim(),
    symbol,
    pct: p,
    body: { symbol, condition: 'pct_move', value: p, actionAsk: chip },
    sentence: armSentence(market, p),
    chip,
  }
}

/** True when the owner already has a live ±pct rule on this symbol. */
export function isPctAlertOn(existing: readonly ArmedRuleLike[] | null | undefined, symbol: string, pct: number = DEFAULT_ALERT_PCT): boolean {
  const p = cleanPct(pct)
  return !!existing?.some((a) => a.symbol === symbol && a.condition === 'pct_move' && a.value === p && (a.status === 'active' || a.status === 'paused'))
}

/** What an armed control reads: the API's own label ("HYPE moves 5% from $x"). */
export function armedWords(symbol: string, pct: number, basePrice: number | null | undefined): string {
  return alertLabel({ symbol, condition: 'pct_move', value: cleanPct(pct), basePrice: basePrice ?? null })
}

export interface WatchPlan {
  plans: PickAlertPlan[]
  /** Markets left out, each named by its reason. */
  skipped: { unpriceable: string[]; already: string[]; overCap: string[] }
  /** The one consent: "Watch these 3 · tell me when any moves 5%". */
  sentence: string
}

/**
 * "Watch these": one alert per pick in one consent — every market the sweep
 * can price that has no live ±pct rule yet, in the pick's order, capped at
 * WATCH_CAP. The skipped markets are named so the control can say why.
 */
export function watchPlan(markets: readonly string[], existing: readonly ArmedRuleLike[] | null | undefined, pct: number = DEFAULT_ALERT_PCT, canAct: (ask: string) => boolean = () => true): WatchPlan {
  const p = cleanPct(pct)
  const plans: PickAlertPlan[] = []
  const skipped = { unpriceable: [] as string[], already: [] as string[], overCap: [] as string[] }
  const seen = new Set<string>()
  for (const m of markets) {
    const plan = pickAlertPlan(m, p, canAct)
    if (!plan) {
      skipped.unpriceable.push(m)
      continue
    }
    if (seen.has(plan.symbol)) continue
    seen.add(plan.symbol)
    if (isPctAlertOn(existing, plan.symbol, p)) {
      skipped.already.push(m)
      continue
    }
    if (plans.length >= WATCH_CAP) {
      skipped.overCap.push(m)
      continue
    }
    plans.push(plan)
  }
  const n = plans.length
  const sentence = n === 0 ? `Nothing to arm${skipped.already.length ? ' · every pick is already watched' : ''}` : `Watch these ${n} · tell me when any moves ${p}%`
  return { plans, skipped, sentence }
}

export type ArmGate = 'ready' | 'loading' | 'door'

/**
 * The guest rule. Alerts are an account surface (rule 6): a SIWE session is
 * `ready`; a session still loading waits; a guest AND a connect-only wallet
 * (connected, never signed in) both get the unified sign-in door aimed back
 * at the page they are on — never a raw connect modal.
 */
export function armGate(status: 'loading' | 'authed' | 'guest', address: string | null): ArmGate {
  if (status === 'loading') return 'loading'
  if (status === 'authed' && !!address) return 'ready'
  return 'door'
}

export interface HeldArm {
  market: string
  pct: number
  /** The page the tap happened on; the arm runs only back on it. */
  path: string
  at: number
}

/** The record a guest's tap leaves while the door is open. */
export function heldArmRecord(market: string, pct: number, path: string, at = Date.now()): string {
  return JSON.stringify({ v: 1, market: String(market).trim(), pct: cleanPct(pct), path, at } satisfies HeldArm & { v: 1 })
}

/** The held arm, if it is ours, fresh, and for this page — else null. */
export function readHeldArm(raw: string | null | undefined, path: string, now = Date.now()): HeldArm | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<HeldArm & { v: number }>
    if (o?.v !== 1 || typeof o.market !== 'string' || !o.market.trim() || typeof o.at !== 'number' || typeof o.path !== 'string') return null
    if (o.path !== path) return null
    if (!(now - o.at >= 0 && now - o.at <= HELD_ARM_TTL_MS)) return null
    if (!alertSymbolFor(o.market)) return null
    return { market: o.market.trim(), pct: cleanPct(o.pct), path: o.path, at: o.at }
  } catch {
    return null
  }
}

/** The control's short label per seat. */
export function armLabel(seat: ArmSeat, market: string, pct = DEFAULT_ALERT_PCT): string {
  const p = cleanPct(pct)
  if (seat === 'deck') return `Alert ${armTicker(market)} ±${p}%`
  if (seat === 'strip') return `Watch these`
  return `±${p}%`
}
