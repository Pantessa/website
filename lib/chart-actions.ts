// ─────────────────────────────────────────────────────────────────────────
//  Drawings that become orders — the pure composer behind every chart
//  affordance. A horizontal line at a price (or a zone between two) asks
//  "what can this level DO?", and the answer is a list of ChartActions whose
//  `ask` strings are EXACTLY the shapes the native parsers accept:
//
//    limit    → lib/swap-intent LIMIT_RE / LIMIT_BUY_RE (CoW limit orders):
//               "limit order: buy 0.0104 ETH for at most 25 USDC"
//               "limit order: sell 0.0104 ETH for at least 25 USDC"
//    protect  → lib/spot-guard SPOT_ARM_RE (spot stop on Base):
//               "Protect my spot ETH if it drops to $2300"
//             → lib/hl-guardian parseGuardianArm (perps):
//               "Protect my HYPE long with a stop at $30"
//               "Take profit on HYPE at $40"
//    dca      → lib/dca CREATE_RE: "DCA $10 into ETH weekly"
//    buy/sell → the swap grammar ("Buy $25 of AAPL") or the HL open
//               grammar ("Long $25 of HYPE on Hyperliquid")
//
//  Every shape here is pinned through scripts/ask-ladder.ts in the harness
//  (`// ── MARKETS/CHART ──`): a chip that lands on the planner is a bug.
//
//  Honesty rules baked in (each one is a fired-money mistake avoided):
//  • a spot stop is only offered BELOW the last price — the Spot Guardian
//    fires when mark ≤ line, so a line above market would sell on arm;
//  • a limit BUY is only offered below market and a limit SELL above it —
//    CoW fills at-or-better, so the other way round is a market order
//    wearing a limit's clothes (the market chip says so instead);
//  • Robinhood Chain stocks have NO resting book (cow:false on 4663) and
//    the Spot Guardian runs on Base only — a stock level offers market
//    buy/sell + DCA and names why the rest is missing;
//  • coins whose home is not an EVM chain (SOL/XRP/DOGE — lib/token-home)
//    get Hyperliquid perp long/short only — a spot ask on them can only
//    ever answer with the HL door, so the level says the perp out loud.
//
//  Prices inside asks carry NO thousands separators: the guardian and spot
//  grammars capture `[\d.]+`, so "$2,400" would parse as $2.
// ─────────────────────────────────────────────────────────────────────────

import type { ChartSource } from './charts'
import type { ChartAction, ChartActionKind } from './chart-state'
import { tokenHome } from './token-home'

export interface LineActionOffer {
  action: ChartAction
  /** Chip label ("Buy here", "Stop under this"). */
  label: string
  /** One line of honesty under the chip (what the ask really does). */
  hint: string
}

export interface ComposeLineInput {
  symbol: string
  source: ChartSource
  /** The drawn level. */
  price: number
  /** The chart's last close — decides which side of market the level is on. */
  last: number
  /** Dollar size for limit / market asks (default $25). */
  usd?: number
  /** Dollar size per period for DCA asks (default $10). */
  dcaUsd?: number
}

export const DEFAULT_ACTION_USD = 25
export const DEFAULT_DCA_USD = 10

/** A price the grammars read back verbatim: plain digits, a dot, no
 *  separators, no exponent, precision by magnitude. */
export function fmtAskPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0'
  let s: string
  if (p >= 1000) s = p.toFixed(0)
  else if (p >= 1) s = p.toFixed(2)
  else if (p >= 0.01) s = p.toFixed(4)
  else s = p.toPrecision(3)
  if (s.includes('e')) s = p.toFixed(12)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Token units for a dollar size at a price — the limit grammar's AMOUNT
 *  is `\d+(?:\.\d+)?`, so: no exponent, ≤ 8 decimals, ≥ 4 significant. */
export function fmtAskUnits(usd: number, price: number): string | null {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(price) || price <= 0) return null
  const raw = usd / price
  if (!Number.isFinite(raw) || raw <= 0) return null
  let s: string
  if (raw >= 1000) s = raw.toFixed(0)
  else if (raw >= 1) s = raw.toFixed(4)
  else {
    // enough decimals for four significant figures, capped at 8
    const mag = Math.floor(Math.log10(raw))
    s = raw.toFixed(Math.min(8, Math.max(4, 3 - mag)))
  }
  if (s.includes('e')) return null
  s = s.includes('.') ? s.replace(/\.?0+$/, '') : s
  return Number(s) > 0 ? s : null
}

const usdLabel = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)

/** Which kinds a source can execute at all — the toolbar hides tools whose
 *  actions could never compose (a zone on a perp has no DCA). */
export function actionKindsFor(symbol: string, source: ChartSource): ReadonlySet<ChartActionKind> {
  if (source === 'hyperliquid') return new Set<ChartActionKind>(['buy', 'sell', 'stop', 'protect'])
  if (source === 'robinhood') return new Set<ChartActionKind>(['buy', 'sell', 'dca'])
  if (tokenHome(symbol)) return new Set<ChartActionKind>(['buy', 'sell'])
  return new Set<ChartActionKind>(['buy', 'sell', 'stop', 'limit', 'dca', 'protect'])
}

/** Why a level can't do the thing a trader expects — named, never silent. */
export function missingActionNote(symbol: string, source: ChartSource): string | null {
  if (source === 'robinhood') return 'No resting orders on Robinhood Chain yet — buys and sells fill at market; a DCA schedule buys the level over time.'
  if (source === 'hyperliquid') return 'Perp levels arm the Guardian (stop / take-profit on your live position); entries fill at market (IOC).'
  if (tokenHome(symbol)) return `${symbol} lives on ${tokenHome(symbol)} — levels open Hyperliquid perps; no spot limit, stop or DCA here.`
  return null
}

/**
 * The actions a horizontal line at `price` can carry. Order = what a
 * trader reaches for first at that side of market. Empty when the level is
 * malformed (non-positive price, no last).
 */
export function composeLineActions(input: ComposeLineInput): LineActionOffer[] {
  const { symbol, source } = input
  const sym = symbol.toUpperCase()
  const usd = input.usd ?? DEFAULT_ACTION_USD
  const dcaUsd = input.dcaUsd ?? DEFAULT_DCA_USD
  const price = input.price
  const last = input.last
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(last) || last <= 0) return []
  const below = price < last
  const above = price > last
  const px = fmtAskPrice(price)
  const out: LineActionOffer[] = []

  if (source === 'hyperliquid') {
    if (below) {
      out.push({
        action: { kind: 'stop', ask: `Protect my ${sym} long with a stop at $${px}` },
        label: 'Stop under this',
        hint: `Guardian closes your ${sym} long if the mark crosses $${px} — signed once, runs while you sleep.`,
      })
    }
    if (above) {
      out.push({
        action: { kind: 'protect', ask: `Take profit on ${sym} at $${px}` },
        label: 'Take profit here',
        hint: `Guardian closes your ${sym} long when the mark reaches $${px}.`,
      })
    }
    out.push(
      { action: { kind: 'buy', ask: `Long ${usdLabel(usd)} of ${sym} on Hyperliquid` }, label: `Long ${sym}`, hint: 'Market (IOC) — fills now, not at the line.' },
      { action: { kind: 'sell', ask: `Short ${usdLabel(usd)} of ${sym} on Hyperliquid` }, label: `Short ${sym}`, hint: 'Market (IOC) — fills now, not at the line.' },
    )
    return out
  }

  if (source === 'robinhood') {
    out.push(
      { action: { kind: 'buy', ask: `Buy ${usdLabel(usd)} of ${sym}` }, label: `Buy ${sym}`, hint: 'Fills at the pool price now — no resting book on Robinhood Chain yet.' },
      { action: { kind: 'sell', ask: `Sell ${usdLabel(usd)} of ${sym}` }, label: `Sell ${sym}`, hint: 'Fills at the pool price now.' },
      { action: { kind: 'dca', ask: `DCA ${usdLabel(dcaUsd)} into ${sym} weekly` }, label: 'DCA into this', hint: `${usdLabel(dcaUsd)} a week, each buy signed by you — the level is your note, not a trigger.` },
    )
    return out
  }

  if (tokenHome(sym)) {
    // The real coin lives elsewhere (Solana, XRP Ledger…) — a spot "Buy $25
    // of SOL" would only ever answer with the Hyperliquid door, so the level
    // speaks perp directly: the venue's own snapshot refuses a coin it
    // doesn't list, by name, at build time.
    out.push(
      { action: { kind: 'buy', ask: `Long ${usdLabel(usd)} of ${sym} on Hyperliquid` }, label: `Long ${sym}`, hint: `${sym} lives on ${tokenHome(sym)} — a Hyperliquid perp, market (IOC).` },
      { action: { kind: 'sell', ask: `Short ${usdLabel(usd)} of ${sym} on Hyperliquid` }, label: `Short ${sym}`, hint: `${sym} lives on ${tokenHome(sym)} — a Hyperliquid perp, market (IOC).` },
    )
    return out
  }

  // Spot on Base/Ethereum/Arbitrum — CoW limit orders + the Spot Guardian.
  const units = fmtAskUnits(usd, price)
  if (below && units) {
    out.push({
      action: { kind: 'limit', ask: `limit order: buy ${units} ${sym} for at most ${usd} USDC` },
      label: 'Buy here',
      hint: `A CoW limit order: ${units} ${sym} at $${px} — rests until the market gets there, nothing moves before.`,
    })
  }
  if (above && units) {
    out.push({
      action: { kind: 'limit', ask: `limit order: sell ${units} ${sym} for at least ${usd} USDC` },
      label: 'Sell here',
      hint: `A CoW limit order: ${units} ${sym} at $${px} — fills at-or-better when the market reaches it.`,
    })
  }
  if (below) {
    out.push({
      action: { kind: 'stop', ask: `Protect my spot ${sym} if it drops to $${px}` },
      label: 'Stop under this',
      hint: `Spot Guardian sells your ${sym} on Base if it trades at or below $${px} — one signature, fires on its own.`,
    })
  }
  out.push({
    action: { kind: 'dca', ask: `DCA ${usdLabel(dcaUsd)} into ${sym} weekly` },
    label: 'DCA into this',
    hint: `${usdLabel(dcaUsd)} a week, each buy signed by you — the level is your note, not a trigger.`,
  })
  out.push(
    { action: { kind: 'buy', ask: `Buy ${usdLabel(usd)} of ${sym}` }, label: `Buy ${sym} now`, hint: 'Market — fills at today’s price, not the line.' },
    { action: { kind: 'sell', ask: `Sell ${usdLabel(usd)} of ${sym}` }, label: `Sell ${sym} now`, hint: 'Market — fills at today’s price, not the line.' },
  )
  return out
}

export interface ComposeZoneInput {
  symbol: string
  source: ChartSource
  p1: number
  p2: number
  last: number
  usd?: number
  dcaUsd?: number
}

/**
 * A zone between two prices: DCA into it (the schedule is the honest
 * reading of "accumulate here"), plus the limit at its floor when the whole
 * zone sits under market, or at its ceiling when it sits above.
 */
export function composeZoneActions(input: ComposeZoneInput): LineActionOffer[] {
  const { symbol, source, last } = input
  const lo = Math.min(input.p1, input.p2)
  const hi = Math.max(input.p1, input.p2)
  if (!Number.isFinite(lo) || lo <= 0 || !Number.isFinite(hi) || hi <= lo || !Number.isFinite(last) || last <= 0) return []
  const kinds = actionKindsFor(symbol, source)
  const out: LineActionOffer[] = []
  if (kinds.has('dca')) {
    const dca = composeLineActions({ ...input, price: lo }).find((o) => o.action.kind === 'dca')
    if (dca) out.push({ ...dca, label: 'DCA into this zone', hint: `${dca.hint} Zone: $${fmtAskPrice(lo)} – $${fmtAskPrice(hi)}.` })
  }
  if (kinds.has('limit')) {
    if (hi < last) {
      const buy = composeLineActions({ ...input, price: lo }).find((o) => o.action.kind === 'limit')
      if (buy) out.push({ ...buy, label: 'Buy at the floor' })
    } else if (lo > last) {
      const sell = composeLineActions({ ...input, price: hi }).find((o) => o.action.kind === 'limit')
      if (sell) out.push({ ...sell, label: 'Sell at the ceiling' })
    }
  }
  if (kinds.has('stop') && hi < last) {
    const stop = composeLineActions({ ...input, price: lo }).find((o) => o.action.kind === 'stop')
    if (stop) out.push({ ...stop, label: 'Stop under the zone' })
  }
  return out
}
