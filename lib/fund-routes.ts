// lib/fund-routes.ts — the Fund rows ONE wallet can actually use.
//
// 2026-09-16, Nate on /t/AAPL's route table: "it shows options like 'Fund
// from Base' but the user does not have any tokens on base so we should not
// show an option path for this". The venue map listed a funding row per
// origin chain for every visitor, and each one spent USDC: a wallet with ETH
// on Base got a row that would wall, and a wallet with nothing on Base got a
// row it could never use.
//
// PURE. The route (app/api/markets/routes/funding) hands in the SAME scans
// the chat's funding plan spends from, and the rows follow the plan's rules:
//
//   • a Robinhood Chain stock reads lib/lifi-bridge readFundingShortfall. The
//     order moves robinhoodBuyNeedUsd (the USDG already there counts; the gas
//     leg rides when the wallet has no ETH there). A chain gets a row when one
//     of its MOVABLE origins can promise that much (originCapUsd — an ETH row
//     funding two legs keeps its own headroom back). The sentence spends that
//     origin's token: "using eth" / "using usdc.e" when it isn't USDC, exactly
//     as the chat's chips do (lib/lifi-destinations fundSegment);
//   • any other coin reads lib/funding-plan scanFundingSources. A chain other
//     than the buy's own gets a row when its USDC (with gas to sign) or its
//     movable ETH covers the order through NEAR Intents. Buying ETH never
//     spends ETH (the bought token is never a source).
//
// A chain that can't fund the order gets no row. What the wallet DOES hold
// there is still named, as a note: money that can't move (no gas), a balance
// too small for the size, a chain that didn't read. Hiding a row must never
// read as "we don't see your money".
//
// The Trade tab's compound composer ("Chain it — one signed job") takes its
// funding leg from here too (stockFundLegs / coinFundLegs), for the same
// reason: its FROM picker offered Base / Ethereum / Arbitrum / Optimism to
// every visitor and always spent USDC. A stock's leg IS the row's own fund
// segment. A coin's leg feeds a buy on the destination, so it is the chat's
// own funding plan from that chain (lib/funding-plan fundingLegsFrom): the
// buy's USDC with the planner's solver headroom, what's already there
// counted, and a gas leg first when the wallet can't sign there.

import { CROSS_CHAIN_FEE_BPS } from '@/lib/fees'
import { FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD, listWords } from '@/lib/funding-origins'
import {
  destGasLegUsd,
  destGasShortEth,
  FUNDING_CHAIN_WORD,
  fundingLegResume,
  fundingLegsFrom,
  fundingPlanUsd,
  promisableCapacityUsd,
  rankFundingSources,
  sourceAmountFor,
  type FundingNeed,
  type FundingScan,
  type FundingSource,
} from '@/lib/funding-plan'
import { originCapUsd, planRobinhoodFundingChips, robinhoodBuyNeedUsd, type FundingOrigin, type FundingShortfall } from '@/lib/lifi-bridge'
import { fundSegment, ROBINHOOD_CHAIN_ID } from '@/lib/lifi-destinations'
import { LIFI_MAX_QUOTE_SHORTFALL_BPS } from '@/lib/lifi-venue'
import { FUND_UNREAD_NOTE, GAS_FLOOR_ETH, ROUTE_TICKET_NOTE, SETTLES, SPOT_CHAINS, venueChainLabel, type FundLeg, type FundRoutesState, type RouteQuote } from '@/lib/symbol-venues'

export interface FundRoutesPlan {
  routes: RouteQuote[]
  notes: string[]
  state: FundRoutesState
  failed: string[]
}

/** The composer's side of the same read: one funding leg per chain that can
 *  fund the job, and the same kind of notes for the chains that can't. */
export interface FundLegsPlan {
  legs: FundLeg[]
  notes: string[]
  state: FundRoutesState
  failed: string[]
}

/** Under a dollar is dust: never a row, never "your biggest balance" (the
 *  notes print whole dollars, and "~$0 of USDC" names nothing). */
const NAMED_MIN_USD = 1

/** "$50" stays whole; "$54.50" keeps its cents. */
const money = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

const gasLine = (chainId: number): string | null => {
  const floor = GAS_FLOOR_ETH[chainId]
  return floor ? `≈ ${floor} ETH floor on ${venueChainLabel(chainId)}` : null
}

/** "~$12 of USDC on Arbitrum and ~$5 of USDC on Base". */
const holdings = (rows: { usd: number; token: string; word: string }[]): string =>
  listWords(rows.map((r) => `~${money(Math.floor(r.usd))} of ${r.token} on ${r.word}`), 'and')

/** The note for origin chains whose reads failed — unknown, never empty. */
const unreadNote = (words: string[]): string =>
  `Couldn't read ${listWords(words)} just now, so ${words.length === 1 ? 'that chain is' : 'those chains are'} left out.`

/** The plan when the balances couldn't be read at all. */
export function unreadFundRoutes(): FundRoutesPlan {
  return { routes: [], notes: [FUND_UNREAD_NOTE], state: 'unread', failed: ['scan'] }
}

/** The composer's plan when the balances couldn't be read at all. */
export function unreadFundLegs(): FundLegsPlan {
  return { legs: [], notes: [FUND_UNREAD_NOTE], state: 'unread', failed: ['scan'] }
}

// ── Robinhood Chain stocks (LiFi) ────────────────────────────────────────────

export interface StockFundInput {
  sym: string
  /** The order size the table is showing, in dollars. */
  buyUsd: number
  /** USDG already on Robinhood Chain, in dollars. */
  holdingUsd: number
  scan: Pick<FundingShortfall, 'hasGas' | 'origins' | 'gaslessOrigins' | 'failedOrigins'>
}

function lifiRow(o: FundingOrigin, needUsd: number, includeGas: boolean, sym: string, buyUsd: number): RouteQuote {
  const name = venueChainLabel(o.chainId)
  return {
    id: `fund:lifi:${o.chainId}`,
    kind: 'fund',
    venue: 'lifi',
    chainId: o.chainId,
    side: 'buy',
    fee: 'lifi',
    label: `Fund from ${name}`,
    // The chat's own chip sentence (planRobinhoodFundingChips): the order's
    // need, from THIS origin, in the token it holds, then the buy.
    ask: `${fundSegment(needUsd, o.word, includeGas, o.token)}, then buy ${money(buyUsd)} of ${sym}`,
    note: `${o.token} on ${name} → USDG${includeGas ? ' + gas' : ''} on Robinhood Chain, then the buy — one signed job.`,
    // Funding legs are fee-free; the buy step pays the swap tier.
    feeBps: 0,
    quote: { kind: 'none', value: o.usd, label: `${money(o.usd)} ${o.token}`, sub: `in your wallet · moves ~${money(needUsd)}` },
    ticket: {
      out: `USDG${includeGas ? ' + gas' : ''} on Robinhood Chain, then ${money(buyUsd)} of ${sym}`,
      feeBps: 0,
      feeUsd: 0,
      slippageBps: LIFI_MAX_QUOTE_SHORTFALL_BPS,
      minOut: `≥ ${100 - LIFI_MAX_QUOTE_SHORTFALL_BPS / 100}% of our own quote`,
      gas: gasLine(o.chainId),
      settles: SETTLES.lifi,
      signs: `${includeGas ? 'two funding legs' : 'one funding leg'} + a wait + the buy — one job card`,
      note: ROUTE_TICKET_NOTE,
    },
  }
}

/** The composer's funding leg from one origin: the row's own fund segment
 *  (the buy that follows is the composer's, at the same size). */
function lifiLeg(o: FundingOrigin, needUsd: number, includeGas: boolean, buyUsd: number): FundLeg {
  const name = venueChainLabel(o.chainId)
  return {
    chainId: o.chainId,
    name,
    token: o.token,
    usd: needUsd,
    segment: fundSegment(needUsd, o.word, includeGas, o.token),
    // lib/jobs robinhood-funding: a gas leg, then the USDG leg, then ONE wait.
    builders: includeGas ? ['native-lifi-fund', 'native-lifi-fund'] : ['native-lifi-fund'],
    waits: 1,
    label: `Fund from ${name}`,
    hint: `${money(needUsd)} of ${o.token} on ${name} → USDG${includeGas ? ' + gas' : ''} on Robinhood Chain (${includeGas ? 'two legs' : 'one leg'}, a signature each); the job waits for it to land.`,
    forUsd: buyUsd,
    destChainId: ROBINHOOD_CHAIN_ID,
    forBuy: true,
  }
}

interface StockFundPicks {
  picks: { origin: FundingOrigin; needUsd: number; includeGas: boolean }[]
  notes: string[]
  state: FundRoutesState
  failed: string[]
}

export function stockFundRoutes(input: StockFundInput): FundRoutesPlan {
  const { picks, notes, state, failed } = stockFundPicks(input)
  return { routes: picks.map((p) => lifiRow(p.origin, p.needUsd, p.includeGas, input.sym, input.buyUsd)), notes, state, failed }
}

/** The compound composer's funding legs for a stock: the same origins as the
 *  rows, the same sentence, one leg per chain. */
export function stockFundLegs(input: StockFundInput): FundLegsPlan {
  const { picks, notes, state, failed } = stockFundPicks(input)
  return { legs: picks.map((p) => lifiLeg(p.origin, p.needUsd, p.includeGas, input.buyUsd)), notes, state, failed }
}

function stockFundPicks(input: StockFundInput): StockFundPicks {
  const { sym, buyUsd, holdingUsd, scan } = input
  const failed = [...scan.failedOrigins]
  const notes: string[] = []
  // The chat's own gate: USDG on Robinhood Chain covering the buy means the
  // buy builds straight from it, and no funding plan is offered.
  if (holdingUsd >= buyUsd) {
    notes.push(`Your ~${money(Math.floor(holdingUsd * 100) / 100)} of USDG on Robinhood Chain already covers a ${money(buyUsd)} buy, so there's nothing to bring over.`)
    if (failed.length) notes.push(unreadNote(failed))
    return { picks: [], notes, state: 'covered', failed }
  }
  const includeGas = !scan.hasGas
  const needUsd = robinhoodBuyNeedUsd(buyUsd, holdingUsd, includeGas)
  const picks: StockFundPicks['picks'] = []
  for (const chainId of FUNDING_ORIGIN_CHAINS) {
    // origins arrive stables first, richest first: the first one that can
    // promise the need is the one the chat's "Just enough" chip spends.
    const best = scan.origins.find((o) => o.chainId === chainId && originCapUsd(o, includeGas) >= needUsd)
    if (best) picks.push({ origin: best, needUsd, includeGas })
  }
  const moves = `a ${money(buyUsd)} buy needs ~${money(needUsd)} moved over${includeGas ? ' (gas for Robinhood Chain included)' : ''}`

  if (picks.length === 0 && scan.origins.length > 0) {
    const combined = planRobinhoodFundingChips({ origins: scan.origins, needUsd, gasIncluded: includeGas, followup: `buy ${money(buyUsd)} of ${sym}` })
    const richest = [...scan.origins].sort((a, b) => b.usd - a.usd)[0]
    notes.push(
      combined
        ? `No one chain covers it: ${moves}. Buy ${sym} can combine what you hold on ${listWords([...new Set(scan.origins.map((o) => o.word))], 'and')} into one job.`
        : `Your biggest balance is ~${money(richest.usd)} of ${richest.token} on ${richest.word}, and ${moves}. Pick a smaller size above.`,
    )
  }
  const stuck = scan.gaslessOrigins.filter((o) => o.token !== 'ETH' && o.usd >= NAMED_MIN_USD)
  if (stuck.length) notes.push(`${holdings(stuck)} can't move yet: there's no ETH there to pay the gas.`)
  if (failed.length) notes.push(unreadNote(failed))
  if (picks.length === 0 && scan.origins.length === 0 && stuck.length === 0 && failed.length === 0) {
    notes.push(`No USDC or ETH on ${listWords(FUNDING_ORIGIN_CHAINS.map((id) => FUNDING_ORIGIN_WORD[id]))} to bring over yet.`)
  }
  const state: FundRoutesState =
    picks.length > 0 ? 'rows' : scan.origins.length > 0 || stuck.length > 0 ? 'short' : failed.length > 0 ? 'unread' : 'none'
  return { picks, notes, state, failed }
}

// ── Coins (NEAR Intents) ─────────────────────────────────────────────────────

export interface CoinFundInput {
  sym: string
  /** The order size the table is showing, in dollars. */
  usd: number
  /** The chain the buy lands on (lib/symbol-venues fundDestChainFor). */
  destChainId: number
  scan: Pick<FundingScan, 'sources' | 'stranded' | 'failedChains'>
}

/** A need for `token` on `dest` — the shape lib/funding-plan's sentence and
 *  leg builders read. */
const needOn = (dest: (typeof SPOT_CHAINS)[number], token: string, amountHuman: number): FundingNeed => ({
  chainId: dest.id,
  token,
  amountHuman,
  followupResume: '',
  actionLabel: 'the buy',
})

function nearRow(s: FundingSource, sym: string, dest: (typeof SPOT_CHAINS)[number], amount: number): RouteQuote {
  const origin = SPOT_CHAINS.find((c) => c.id === s.chainId)!
  // The chat planner's own amount rule and sentence ("Swap 0.016667 ETH from
  // Arbitrum to UNI on Ethereum"), so a row reads exactly like its chip.
  const spend = sourceAmountFor(s, amount)
  const feeUsd = Math.round(((amount * CROSS_CHAIN_FEE_BPS) / 10_000) * 100) / 100
  return {
    id: `fund:near:${s.chainId}:${s.token.toLowerCase()}`,
    kind: 'fund',
    venue: 'near',
    chainId: s.chainId,
    side: 'buy',
    fee: 'cross-chain',
    label: `Bring ${s.token} from ${origin.name}`,
    ask: fundingLegResume(s, spend, needOn(dest, sym, amount)),
    mcp: 'near-intents',
    note: `${s.token} on ${origin.name} → ${sym} on ${dest.name} through NEAR Intents — one deposit, settles in seconds.`,
    feeBps: CROSS_CHAIN_FEE_BPS,
    quote: { kind: 'none', value: s.usd, label: `${money(Math.floor(s.usd))} ${s.token}`, sub: `in your wallet · spends ${s.token === 'USDC' ? money(amount) : `${spend} ETH`}` },
    ticket: {
      out: `≈ $${(amount * (1 - CROSS_CHAIN_FEE_BPS / 10_000)).toFixed(2)} of ${sym} on ${dest.name}`,
      feeBps: CROSS_CHAIN_FEE_BPS,
      feeUsd,
      slippageBps: null,
      minOut: 'the 1Click quote, guard-verified to the deposit',
      gas: gasLine(s.chainId),
      settles: SETTLES.near,
      signs: 'one deposit transfer to a one-time address',
      note: ROUTE_TICKET_NOTE,
    },
  }
}

export function coinFundRoutes(input: CoinFundInput): FundRoutesPlan {
  const sym = input.sym.toUpperCase()
  const amount = Math.max(1, Math.round(input.usd))
  const dest = SPOT_CHAINS.find((c) => c.id === input.destChainId)
  const failed = [...input.scan.failedChains]
  if (!dest) return { routes: [], notes: [], state: 'none', failed }
  // A holding of the token the order BUYS never funds it (lib/funding-plan
  // FundingNeed.buyToken): ETH elsewhere is a move, not a way to buy ETH.
  const spendable = (s: FundingSource) => !(sym === 'ETH' && s.token === 'ETH')
  const origins = input.scan.sources.filter((s) => s.chainId !== dest.id && spendable(s) && s.usd >= NAMED_MIN_USD)
  const routes: RouteQuote[] = []
  const notes: string[] = []
  for (const c of SPOT_CHAINS) {
    if (c.id === dest.id) continue
    // A stable first (no swap spread), then movable ETH.
    const usdc = origins.find((s) => s.chainId === c.id && s.token === 'USDC' && s.usd >= amount)
    const eth = origins.find((s) => s.chainId === c.id && s.token === 'ETH' && s.usd >= amount)
    const pick = usdc ?? eth
    if (pick) routes.push(nearRow(pick, sym, dest, amount))
  }
  const here = input.scan.sources.find((s) => s.chainId === dest.id && s.token === 'USDC' && s.usd >= amount)
  if (here) notes.push(`Your ~${money(Math.floor(here.usd))} of USDC on ${dest.name} can buy it right there, with no bridge.`)
  // Money on the buy's own chain already answers the order; "pick a smaller
  // size" would send the wallet the wrong way.
  if (routes.length === 0 && origins.length > 0 && !here) {
    const richest = [...origins].sort((a, b) => b.usd - a.usd)[0]
    notes.push(`Your biggest balance elsewhere is ~${money(Math.floor(richest.usd))} of ${richest.token} on ${richest.chainWord}, and this buy spends ${money(amount)}. Pick a smaller size above.`)
  }
  const stuck = input.scan.stranded.filter((s) => s.token === 'USDC' && s.chainId !== dest.id && s.usd >= NAMED_MIN_USD).map((s) => ({ usd: s.usd, token: s.token, word: s.chainWord }))
  if (stuck.length) notes.push(`${holdings(stuck)} can't move yet: there's no ETH there to pay the gas.`)
  if (failed.length) notes.push(unreadNote(failed))
  if (routes.length === 0 && origins.length === 0 && stuck.length === 0 && failed.length === 0 && !here) {
    notes.push(`No USDC${sym === 'ETH' ? '' : ' or ETH'} on ${listWords(SPOT_CHAINS.filter((c) => c.id !== dest.id).map((c) => c.name))} to bring over yet.`)
  }
  const state: FundRoutesState =
    routes.length > 0 ? 'rows' : here ? 'covered' : origins.length > 0 || stuck.length > 0 ? 'short' : failed.length > 0 ? 'unread' : 'none'
  return { routes, notes, state, failed }
}

// ── The compound composer's coin leg (NEAR Intents, the chat's own plan) ────

export interface CoinFundLegsInput {
  sym: string
  /** The composer's order size, in dollars. */
  usd: number
  /** The chain the job buys on (lib/symbol-venues compoundChainFor). */
  destChainId: number
  /** A buy follows the leg on the destination. It then brings what that buy
   *  needs the way the chat's funding offer would (offerFundingPlan): the
   *  shortfall after the USDC already there, with the planner's headroom, and
   *  a gas leg first when the wallet can't sign there. False = a plain bridge
   *  of the size. */
  buy: boolean
  scan: Pick<FundingScan, 'sources' | 'stranded' | 'failedChains' | 'ethUsd' | 'nativeEth'>
}

function nearLeg(s: FundingSource, segs: string[], tokenUsd: number, gasUsd: number, dest: (typeof SPOT_CHAINS)[number], forUsd: number, forBuy: boolean): FundLeg {
  const origin = SPOT_CHAINS.find((c) => c.id === s.chainId)!
  const total = Number((tokenUsd + gasUsd).toFixed(2))
  const lands =
    tokenUsd > 0 && gasUsd > 0
      ? `USDC on ${dest.name}, ~${money(gasUsd)} of it as ETH so ${dest.name} can sign the buy`
      : tokenUsd > 0
        ? `USDC on ${dest.name}`
        : `ETH on ${dest.name} to sign the buy (the USDC is already there)`
  return {
    chainId: s.chainId,
    name: origin.name,
    token: s.token,
    usd: total,
    segment: segs.join(', then '),
    // Each cross-chain segment compiles to a deposit and its own settlement wait.
    builders: segs.map(() => 'native-cross-chain'),
    waits: segs.length,
    label: `Bring ${s.token} from ${origin.name}`,
    hint: `~${money(total)} of ${s.token} on ${origin.name} → ${lands}, through NEAR Intents; the job waits for each settlement.`,
    forUsd,
    destChainId: dest.id,
    forBuy,
  }
}

/** The compound composer's funding legs for a coin: one per chain whose
 *  holdings can fund the job on its own, stables before ETH, never the chain
 *  the job buys on and never ETH on the ETH page. */
export function coinFundLegs(input: CoinFundLegsInput): FundLegsPlan {
  const sym = input.sym.toUpperCase()
  const usd = Math.max(1, Math.round(input.usd))
  const { scan } = input
  const dest = SPOT_CHAINS.find((c) => c.id === input.destChainId)
  const failed = [...scan.failedChains]
  if (!dest) return { legs: [], notes: [], state: 'none', failed }
  const notes: string[] = []

  let shortfall = usd
  let needUsd = usd
  let gasUsd = 0
  let heldUsd = 0
  if (input.buy) {
    // The chat's funding offer reads the destination before it plans; so does this.
    const nativeEth = scan.nativeEth?.[dest.id]
    if (failed.includes(FUNDING_CHAIN_WORD[dest.id]) || nativeEth === undefined) {
      return { legs: [], notes: [`Couldn't read ${dest.name} just now, where the buy runs, so no chain is offered to fund it. Buy still plans the funding when you send it.`], state: 'unread', failed }
    }
    heldUsd = [...scan.sources, ...scan.stranded].filter((s) => s.chainId === dest.id && s.token === 'USDC').reduce((a, s) => a + s.usd, 0)
    shortfall = Math.max(0, Number((usd - heldUsd).toFixed(2)))
    if (destGasShortEth(dest.id, nativeEth) > 0) {
      if (!scan.ethUsd) {
        return { legs: [], notes: [`Couldn't price ETH just now, so the gas for a buy on ${dest.name} can't be sized. Buy still plans the funding when you send it.`], state: 'unread', failed }
      }
      gasUsd = destGasLegUsd(dest.id, nativeEth, scan.ethUsd)
    }
    needUsd = shortfall > 0 ? fundingPlanUsd(shortfall, 1) : 0
    if (needUsd === 0 && gasUsd === 0) {
      notes.push(`Your ~${money(Math.floor(heldUsd))} of USDC on ${dest.name} already covers the buy, and ${dest.name} has the gas to sign it, so there's nothing to bring over.`)
      if (failed.length) notes.push(unreadNote(failed))
      return { legs: [], notes, state: 'covered', failed }
    }
    if (shortfall > 0 && heldUsd >= NAMED_MIN_USD) notes.push(`Your ~${money(Math.floor(heldUsd))} of USDC on ${dest.name} already counts toward the buy.`)
  }

  const need = needOn(dest, 'USDC', shortfall)
  // A holding of the token the job BUYS never funds it (lib/funding-plan
  // FundingNeed.buyToken): ETH elsewhere is a move, not a way to buy ETH.
  const origins = rankFundingSources(
    need,
    scan.sources.filter((s) => s.chainId !== dest.id && !(sym === 'ETH' && s.token === 'ETH') && s.usd >= NAMED_MIN_USD),
  )
  const legs: FundLeg[] = []
  for (const c of SPOT_CHAINS) {
    if (c.id === dest.id) continue
    for (const s of origins.filter((o) => o.chainId === c.id)) {
      const segs = fundingLegsFrom(need, s, needUsd, gasUsd)
      if (segs) {
        legs.push(nearLeg(s, segs, needUsd, gasUsd, dest, usd, input.buy))
        break
      }
    }
  }

  const moves = `the ${input.buy ? 'buy' : 'bridge'} needs ~${money(Number((needUsd + gasUsd).toFixed(2)))} moved over${gasUsd > 0 ? ` (gas for ${dest.name} included)` : ''}`
  if (legs.length === 0 && origins.length > 0) {
    const richest = [...origins].sort((a, b) => b.usd - a.usd)[0]
    notes.push(
      origins.length >= 2 && promisableCapacityUsd(origins, gasUsd > 0) >= needUsd + gasUsd
        ? `No one chain covers it: ${moves}. Sent on its own, the buy plans a move that combines what you hold on ${listWords([...new Set(origins.map((o) => o.chainWord))], 'and')}.`
        : `Your biggest balance elsewhere is ~${money(Math.floor(richest.usd))} of ${richest.token} on ${richest.chainWord}, and ${moves}. Pick a smaller size above.`,
    )
  }
  const stuck = scan.stranded.filter((s) => s.token === 'USDC' && s.chainId !== dest.id && s.usd >= NAMED_MIN_USD).map((s) => ({ usd: s.usd, token: s.token, word: s.chainWord }))
  if (stuck.length) notes.push(`${holdings(stuck)} can't move yet: there's no ETH there to pay the gas.`)
  if (failed.length) notes.push(unreadNote(failed))
  if (legs.length === 0 && origins.length === 0 && stuck.length === 0 && failed.length === 0) {
    notes.push(`No USDC${sym === 'ETH' ? '' : ' or ETH'} on ${listWords(SPOT_CHAINS.filter((c) => c.id !== dest.id).map((c) => c.name))} to bring over yet.`)
  }
  const state: FundRoutesState = legs.length > 0 ? 'rows' : origins.length > 0 || stuck.length > 0 ? 'short' : failed.length > 0 ? 'unread' : 'none'
  return { legs, notes, state, failed }
}
