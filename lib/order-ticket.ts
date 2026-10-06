// ─────────────────────────────────────────────────────────────────────────
//  The order ticket — pure, no React (2026-10-06, Nate: "allow users to
//  enter the number they want to buy, something similar to Coinbase's buy /
//  sell section… the amount can then trigger the app to build the
//  transaction with the amount").
//
//  Until now every act chip on a symbol page carried a hidden size ($50 on
//  the header chips, $25 in the ask bar) and the only way to size an order
//  was to type the sentence. The ticket is the Coinbase-shaped form in front
//  of the SAME grammar: side · Market / Limit · an amount in dollars or in
//  the token · presets and a slider over what the wallet actually holds ·
//  leverage and a stop for a perp · the sentence it composes, printed, and
//  one button that sends it. Nothing here builds, prices or signs: the
//  sentence goes through the page's build door (the chart's own order
//  ticket) exactly like a chip, and the wallet signature is the gate.
//
//  Every sentence composed here is a parser's own phrasing (memory
//  chip-send-contract: the chip IS the contract), pinned through the ladder
//  replica in scripts/order-ticket-pins.ts:
//    Buy $25 of UNI · Sell 2.5 UNI · Sell $25 of UNI · Sell all my UNI
//    limit order: buy 2.9412 UNI for at most 25 USDC on Base
//    limit order: sell 2.5 UNI for at least 22.5 USDC on Base
//    2x Long $25 of UNI on Hyperliquid[, then protect my UNI long with a 5% stop]
//    Protect my UNI in my wallet with a 5% stop · Stake 0.0104 ETH on Lido
//    Supply $25 of LINK to Aave
//
//  Honesty rules (each one a refusal avoided, never a silent fix):
//  • a BUY is sized in what you spend (the swap layer builds exact-input),
//    so a buy typed in token units converts to dollars at the live price and
//    the sentence says the dollars; the "≈ units" line is the estimate;
//  • a SELL typed as the whole holding sends "Sell all my X": the build sizes
//    it from the live balance, never from a rounded number;
//  • a limit BUY rests UNDER the market and a limit SELL OVER it (CoW fills
//    at-or-better; the other way round is a market order in a limit's
//    clothes) — the ticket refuses by name instead of composing one;
//  • Hyperliquid takes orders from $10; a smaller perp refuses here, not at
//    the venue;
//  • prices and units inside a sentence carry no separators and no
//    exponent (the grammars capture `\d+(?:\.\d+)?`).
// ─────────────────────────────────────────────────────────────────────────

import type { ChartPair } from '@/lib/charts'
import { composeAsk, execSidesFor, EXEC_SIDE_LABEL, type ExecSide } from '@/lib/trade-asks'
import { fmtAskPrice, fmtAskUnits } from '@/lib/chart-actions'
import { ROBINHOOD_CHAIN_ID, SPOT_CHAINS, fundDestChainFor } from '@/lib/symbol-venues'
import { tokenHome } from '@/lib/token-home'

export type TicketSide = ExecSide
export type TicketType = 'market' | 'limit'
/** Which box the amount was typed in: dollars, or units of the symbol. */
export type TicketUnit = 'usd' | 'token'

export const TICKET_USD_PRESETS = [10, 25, 50, 100] as const
export const TICKET_PCT_PRESETS = [25, 50, 75, 100] as const
export const TICKET_STOP_PRESETS = [5, 10, 15] as const
export const TICKET_LEVERAGE_PRESETS = [1, 2, 3, 5, 10] as const
/** Limit distance presets, percent from the last price (under for a buy, over for a sell). */
export const TICKET_LIMIT_PRESETS = [1, 2, 5] as const
export const TICKET_DEFAULT_USD = 25
/** Remembered per browser: the last dollar size, and whether the strip's ticket was open. */
export const TICKET_USD_KEY = 'pantessa.markets.ticket.usd'
export const TICKET_OPEN_KEY = 'pantessa.markets.ticket.open'
/** The strip's ticket opens by itself from this viewport width up; a phone starts on the chips. */
export const TICKET_AUTO_OPEN_MIN_PX = 900

/** Venue floors the ticket refuses under, by name. */
export const HL_MIN_USD = 10
export const SPOT_MIN_USD = 1

export interface TicketState {
  side: TicketSide
  type: TicketType
  unit: TicketUnit
  /** The typed amount, in `unit`. Null = nothing typed yet. */
  amount: number | null
  /** The whole holding (a sell at 100%): "Sell all my X", sized at build. */
  sellAll: boolean
  limitPrice: number | null
  /** The chain word a CoW limit order names ("Base"). */
  limitChain: string
  /** 1 = the venue's own setting (no leverage clause). */
  leverage: number
  /** A perp open also arms a Guardian stop (", then protect …"). */
  withStop: boolean
  stopPct: number
}

export type TicketCompose =
  | { ok: true; ask: string; label: string; usd: number | null; units: number | null }
  | { ok: false; problem: string }

/** The sides the ticket can show for a pair — the header strip's honest set (lib/trade-asks). */
export const ticketSidesFor = (pair: ChartPair): TicketSide[] => execSidesFor(pair)

export const ticketSideLabel = (pair: ChartPair, side: TicketSide): string => EXEC_SIDE_LABEL[side](pair)

/** The chains a CoW limit order can rest on for this symbol: the spot chains
 *  with a CoW book, the coin's home chain first (lib/symbol-venues). */
export function limitChainsFor(symbol: string): { id: number; word: string }[] {
  const first = fundDestChainFor(symbol)
  const cow = SPOT_CHAINS.filter((c) => c.cow).map((c) => ({ id: c.id, word: c.word }))
  return [...cow.filter((c) => c.id === first), ...cow.filter((c) => c.id !== first)]
}

/** Market only, or Market + Limit: a resting CoW order exists for a coin on
 *  the EVM spot chains — never for a stock (no book on Robinhood Chain), a
 *  perp chart, or a coin whose home is not an EVM chain (its spot ask only
 *  ever answers with the Hyperliquid door). */
export function ticketTypesFor(pair: ChartPair, side: TicketSide): TicketType[] {
  if (side !== 'buy' && side !== 'sell') return ['market']
  if (pair.source === 'robinhood' || pair.source === 'hyperliquid') return ['market']
  if (tokenHome(pair.symbol)) return ['market']
  return ['market', 'limit']
}

/** Which input the side takes. `none` = no amount at all (a stop is a percent). */
export function ticketAmountKind(side: TicketSide): 'usd' | 'either' | 'none' {
  if (side === 'protect') return 'none'
  if (side === 'buy' || side === 'sell' || side === 'stake') return 'either'
  return 'usd'
}

/** The unit a side opens on: a sell and a stake in the token, everything else in dollars. */
export const defaultUnitFor = (side: TicketSide): TicketUnit => (side === 'sell' || side === 'stake' ? 'token' : 'usd')

export const sideTone = (side: TicketSide): 'buy' | 'sell' | 'neutral' =>
  side === 'buy' || side === 'long' ? 'buy' : side === 'sell' || side === 'short' ? 'sell' : 'neutral'

export const isPerpSide = (side: TicketSide): boolean => side === 'long' || side === 'short'

const round2 = (n: number) => Math.round(n * 100) / 100

/** "$25" or "$12.50" — the dollar word every grammar reads (`\$\d+(?:\.\d+)?`). */
export function usdWord(usd: number): string {
  const n = round2(usd)
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

/** Token units a sentence carries: no separators, no exponent, ≤ 8 decimals,
 *  at least four significant figures below 1 (the limit and sell grammars
 *  capture `\d+(?:\.\d+)?`). Null for nothing / a non-positive number. */
export function fmtTicketUnits(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  let s: string
  if (n >= 1000) s = n.toFixed(2)
  else if (n >= 1) s = n.toFixed(4)
  else {
    const mag = Math.floor(Math.log10(n))
    s = n.toFixed(Math.min(8, Math.max(4, 3 - mag)))
  }
  if (s.includes('e')) return null
  s = s.includes('.') ? s.replace(/\.?0+$/, '') : s
  return Number(s) > 0 ? s : null
}

/** Both sizes of the typed amount, when the live price allows the conversion. */
export function ticketSizes(st: Pick<TicketState, 'unit' | 'amount'>, last: number | null): { usd: number | null; units: number | null } {
  const a = st.amount
  if (a == null || !Number.isFinite(a) || a <= 0) return { usd: null, units: null }
  const px = last != null && Number.isFinite(last) && last > 0 ? last : null
  if (st.unit === 'usd') return { usd: round2(a), units: px ? a / px : null }
  return { usd: px ? round2(a * px) : null, units: a }
}

/** The amount a percent of a basis sizes: a sell at 100% is the whole
 *  holding (sellAll) so the build reads the live balance; anything else is
 *  the share, in the unit the basis is in. */
export function sizeFromPct(pct: number, basis: number, side: TicketSide): { amount: number; sellAll: boolean } {
  const share = Math.max(0, Math.min(100, pct)) / 100
  if (side === 'sell' && share >= 1) return { amount: basis, sellAll: true }
  const raw = basis * share
  // Dollars round down to the cent (never ask for more than is there);
  // token units keep eight decimals.
  const amount = side === 'sell' || side === 'stake' ? Math.floor(raw * 1e8) / 1e8 : Math.floor(raw * 100) / 100
  return { amount, sellAll: false }
}

/** A limit's default price: 1% under the market for a buy, 1% over for a sell. */
export function defaultLimitPrice(side: 'buy' | 'sell', last: number, pct: number = TICKET_LIMIT_PRESETS[0]): number {
  return Number(fmtAskPrice(side === 'buy' ? last * (1 - pct / 100) : last * (1 + pct / 100)))
}

/** Signed distance of a limit price from the market, in percent (negative = under). */
export function limitDistancePct(price: number, last: number): number | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(last) || last <= 0) return null
  return ((price - last) / last) * 100
}

const no = (problem: string): TicketCompose => ({ ok: false, problem })
const yes = (ask: string, label: string, usd: number | null, units: number | null): TicketCompose => ({ ok: true, ask, label, usd, units })

function composeLimit(sym: string, side: 'buy' | 'sell', st: TicketState, last: number | null): TicketCompose {
  if (last == null || !(last > 0)) return no('Waiting for a live price before sizing a limit order.')
  const price = st.limitPrice
  if (price == null || !(price > 0)) return no('Set a limit price.')
  if (side === 'buy' && price >= last) return no(`A limit buy rests UNDER the market: pick a price below $${fmtAskPrice(last)}, or use Market to buy now.`)
  if (side === 'sell' && price <= last) return no(`A limit sell rests OVER the market: pick a price above $${fmtAskPrice(last)}, or use Market to sell now.`)
  if (!limitChainsFor(sym).some((c) => c.word === st.limitChain)) return no('Pick the chain the order rests on.')
  if (st.amount == null || !(st.amount > 0)) return no('Enter an amount.')
  // Units at the LIMIT price: that is what the order fills at.
  const unitsRaw = st.unit === 'token' ? st.amount : Number(fmtAskUnits(st.amount, price) ?? 0)
  const units = fmtTicketUnits(unitsRaw)
  if (!units) return no('Enter an amount.')
  const usdc = fmtAskPrice(Number(units) * price)
  if (Number(usdc) < SPOT_MIN_USD) return no(`Limit orders start at $${SPOT_MIN_USD}.`)
  const px = fmtAskPrice(price)
  if (side === 'buy') {
    return yes(`limit order: buy ${units} ${sym} for at most ${usdc} USDC on ${st.limitChain}`, `Buy ${units} ${sym} at $${px}`, Number(usdc), Number(units))
  }
  return yes(`limit order: sell ${units} ${sym} for at least ${usdc} USDC on ${st.limitChain}`, `Sell ${units} ${sym} at $${px}`, Number(usdc), Number(units))
}

/**
 * The sentence the ticket sends for its state, or the one reason it can't.
 * Every `ask` round-trips a native parser (pinned).
 */
export function composeTicketAsk(pair: ChartPair, st: TicketState, last: number | null): TicketCompose {
  const sym = pair.symbol
  const { usd, units } = ticketSizes(st, last)
  switch (st.side) {
    case 'buy': {
      if (st.type === 'limit') return composeLimit(sym, 'buy', st, last)
      if (st.unit === 'token' && usd == null) return no(units ? 'Waiting for a live price to size the buy in dollars.' : 'Enter an amount.')
      if (usd == null) return no('Enter an amount.')
      if (usd < SPOT_MIN_USD) return no(`Buys start at $${SPOT_MIN_USD}.`)
      const ask = `Buy ${usdWord(usd)} of ${sym}`
      return yes(ask, ask, usd, units)
    }
    case 'sell': {
      if (st.type === 'limit') return composeLimit(sym, 'sell', st, last)
      if (st.sellAll) return yes(`Sell all my ${sym}`, `Sell all my ${sym}`, usd, units)
      if (st.unit === 'token') {
        const u = units != null ? fmtTicketUnits(units) : null
        if (!u) return no('Enter an amount.')
        return yes(`Sell ${u} ${sym}`, `Sell ${u} ${sym}`, usd, Number(u))
      }
      if (usd == null) return no('Enter an amount.')
      if (usd < SPOT_MIN_USD) return no(`Sells start at $${SPOT_MIN_USD}.`)
      const ask = `Sell ${usdWord(usd)} of ${sym}`
      return yes(ask, ask, usd, units)
    }
    case 'long':
    case 'short': {
      if (usd == null) return no('Enter an amount.')
      if (usd < HL_MIN_USD) return no(`Hyperliquid takes orders from $${HL_MIN_USD}.`)
      const lev = st.leverage > 1 ? `${Math.round(st.leverage)}x ` : ''
      const verb = st.side === 'long' ? 'Long' : 'Short'
      const open = `${lev}${verb} ${usdWord(usd)} of ${sym} on Hyperliquid`
      const ask = st.withStop ? `${open}, then protect my ${sym} ${st.side} with a ${st.stopPct}% stop` : open
      const label = st.withStop ? `${lev}${verb} ${usdWord(usd)} of ${sym} + ${st.stopPct}% stop` : `${lev}${verb} ${usdWord(usd)} of ${sym}`
      return yes(ask, label, usd, units)
    }
    case 'protect': {
      const ask = composeAsk(pair, 'protect', { pct: st.stopPct })
      return yes(ask, `Protect ${sym} with a ${st.stopPct}% stop`, null, null)
    }
    case 'stake': {
      if (sym !== 'ETH') return no('Only ETH stakes on Lido.')
      const raw = st.unit === 'token' ? units : usd != null && last != null && last > 0 ? Number(fmtAskUnits(usd, last) ?? 0) : null
      const u = raw != null ? fmtTicketUnits(raw) : null
      if (!u) return no(st.unit === 'usd' && last == null ? 'Waiting for a live price to size the stake in ETH.' : 'Enter an amount.')
      return yes(`Stake ${u} ETH on Lido`, `Stake ${u} ETH`, usd, Number(u))
    }
    case 'supply': {
      if (usd == null) return no('Enter an amount.')
      if (usd < SPOT_MIN_USD) return no(`Supplies start at $${SPOT_MIN_USD}.`)
      const ask = `Supply ${usdWord(usd)} of ${sym} to Aave`
      return yes(ask, ask, usd, units)
    }
  }
}

/** A fresh ticket for a side: the remembered dollar size for a dollar side,
 *  an empty token box for a sell or a stake, a 1%-away limit when the type
 *  is limit, the venue's own leverage, a 5% stop. */
export function freshTicket(pair: ChartPair, side: TicketSide, opts: { usd?: number; last?: number | null; type?: TicketType } = {}): TicketState {
  const unit = defaultUnitFor(side)
  const type: TicketType = opts.type && ticketTypesFor(pair, side).includes(opts.type) ? opts.type : 'market'
  const last = opts.last ?? null
  const chains = limitChainsFor(pair.symbol)
  return {
    side,
    type,
    unit,
    amount: unit === 'usd' && ticketAmountKind(side) !== 'none' ? (opts.usd ?? TICKET_DEFAULT_USD) : null,
    sellAll: false,
    limitPrice: type === 'limit' && last != null && last > 0 && (side === 'buy' || side === 'sell') ? defaultLimitPrice(side, last) : null,
    limitChain: chains[0]?.word ?? 'Base',
    leverage: 1,
    withStop: false,
    stopPct: TICKET_STOP_PRESETS[0],
  }
}

/** The typed box's text → a number the ticket keeps (digits, one dot, ≤ 8
 *  decimals; separators dropped). Null for an empty or malformed box. */
export function parseTicketAmount(text: string): number | null {
  const t = text.replace(/[,\s$]/g, '')
  if (!/^\d*\.?\d{0,8}$/.test(t) || t === '' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── What the wallet can put behind the order (the "Available" line) ──────

/** One chain of GET /api/wallet/balances (lib/use-stable-balances). */
export interface StableRead {
  id: number
  name: string
  ok: boolean
  stable?: { symbol: string; balance: number } | null
}

export interface Available {
  /** "Available · $383.60 USDC on Base" — the richest chain the order can draw from. */
  text: string
  /** Dollars the percent presets and the slider scale against (null = none readable). */
  usd: number | null
  chainId: number | null
  symbol: string | null
}

/**
 * The stable the wallet holds where a BUY of this pair settles: USDG on
 * Robinhood Chain for a stock, USDC on the spot chains for a coin. The
 * richest chain leads; the rest are named when they hold anything. Chains
 * that didn't answer are never read as zero. Null = nothing to say (no
 * reads yet, or every chain unread).
 */
export function availableFor(pair: ChartPair, reads: readonly StableRead[] | null): Available | null {
  if (!reads || reads.length === 0) return null
  const wanted = pair.source === 'robinhood' ? [ROBINHOOD_CHAIN_ID] : SPOT_CHAINS.map((c) => c.id)
  const rows = reads.filter((r) => wanted.includes(r.id))
  if (rows.length === 0) return null
  const read = rows.filter((r) => r.ok)
  if (read.length === 0) return null
  const funded = read
    .filter((r) => r.stable && r.stable.balance > 0)
    .sort((a, b) => (b.stable!.balance - a.stable!.balance))
  if (funded.length === 0) {
    const names = read.map((r) => r.name)
    const where = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0]
    return {
      text: pair.source === 'robinhood' ? 'No USDG on Robinhood Chain yet · the build offers a funding path from your other chains' : `No stables on ${where} yet · the build offers a funding path`,
      usd: null,
      chainId: null,
      symbol: null,
    }
  }
  const lead = funded[0]
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const rest = funded.slice(1).map((r) => `${fmt(r.stable!.balance)} on ${r.name}`)
  return {
    text: `Available · ${fmt(lead.stable!.balance)} ${lead.stable!.symbol} on ${lead.name}${rest.length ? ` · ${rest.join(' · ')}` : ''}`,
    usd: Math.floor(lead.stable!.balance * 100) / 100,
    chainId: lead.id,
    symbol: lead.stable!.symbol,
  }
}

/** The side a ticket re-opens on when its side leaves the honest set (a
 *  wallet that stopped holding the token, a venue that shut): the first side
 *  still offered, or none. */
export function fallbackSide(wanted: TicketSide, offered: readonly TicketSide[]): TicketSide | null {
  if (offered.includes(wanted)) return wanted
  return offered[0] ?? null
}

/** The ticket's status line after a send — where the build lands. */
export const TICKET_SENT_NOTE: Record<'strip' | 'card', string> = {
  strip: 'Sent — it builds in Ask the chart, under the chart. Your wallet signs it there.',
  card: 'Sent — it builds in Ask the chart, above the tabs. Your wallet signs it there.',
}
