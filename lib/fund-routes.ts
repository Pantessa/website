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

import { CROSS_CHAIN_FEE_BPS } from '@/lib/fees'
import { FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD, listWords } from '@/lib/funding-origins'
import type { FundingScan, FundingSource } from '@/lib/funding-plan'
import { originCapUsd, planRobinhoodFundingChips, robinhoodBuyNeedUsd, type FundingOrigin, type FundingShortfall } from '@/lib/lifi-bridge'
import { fundSegment } from '@/lib/lifi-destinations'
import { LIFI_MAX_QUOTE_SHORTFALL_BPS } from '@/lib/lifi-venue'
import { GAS_FLOOR_ETH, ROUTE_TICKET_NOTE, SETTLES, SPOT_CHAINS, venueChainLabel, type FundRoutesState, type RouteQuote } from '@/lib/symbol-venues'

export interface FundRoutesPlan {
  routes: RouteQuote[]
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
  return { routes: [], notes: ["Couldn't read your balances just now. Buy still plans the funding when you send it."], state: 'unread', failed: ['scan'] }
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

export function stockFundRoutes(input: StockFundInput): FundRoutesPlan {
  const { sym, buyUsd, holdingUsd, scan } = input
  const failed = [...scan.failedOrigins]
  const notes: string[] = []
  // The chat's own gate: USDG on Robinhood Chain covering the buy means the
  // buy builds straight from it, and no funding plan is offered.
  if (holdingUsd >= buyUsd) {
    notes.push(`Your ~${money(Math.floor(holdingUsd * 100) / 100)} of USDG on Robinhood Chain already covers a ${money(buyUsd)} buy, so there's nothing to bring over.`)
    if (failed.length) notes.push(unreadNote(failed))
    return { routes: [], notes, state: 'covered', failed }
  }
  const includeGas = !scan.hasGas
  const needUsd = robinhoodBuyNeedUsd(buyUsd, holdingUsd, includeGas)
  const routes: RouteQuote[] = []
  for (const chainId of FUNDING_ORIGIN_CHAINS) {
    // origins arrive stables first, richest first: the first one that can
    // promise the need is the one the chat's "Just enough" chip spends.
    const best = scan.origins.find((o) => o.chainId === chainId && originCapUsd(o, includeGas) >= needUsd)
    if (best) routes.push(lifiRow(best, needUsd, includeGas, sym, buyUsd))
  }
  const moves = `a ${money(buyUsd)} buy moves ~${money(needUsd)}${includeGas ? ' (gas for Robinhood Chain included)' : ''}`

  if (routes.length === 0 && scan.origins.length > 0) {
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
  if (routes.length === 0 && scan.origins.length === 0 && stuck.length === 0 && failed.length === 0) {
    notes.push(`No USDC or ETH on ${listWords(FUNDING_ORIGIN_CHAINS.map((id) => FUNDING_ORIGIN_WORD[id]))} to bring over yet.`)
  }
  const state: FundRoutesState =
    routes.length > 0 ? 'rows' : scan.origins.length > 0 || stuck.length > 0 ? 'short' : failed.length > 0 ? 'unread' : 'none'
  return { routes, notes, state, failed }
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

/** Units of an ETH source worth `usd`, rounded up to 6dp so the leg never
 *  arrives short, and never past the movable balance. */
function ethUnits(s: FundingSource, usd: number): string {
  const amt = Math.min((usd * s.balance) / s.usd, s.balance)
  const f = 1e6
  const v = amt >= s.balance ? Math.floor(amt * f) / f : Math.ceil(amt * f) / f
  return v.toFixed(6).replace(/\.?0+$/, '')
}

function nearRow(s: FundingSource, sym: string, dest: (typeof SPOT_CHAINS)[number], amount: number): RouteQuote {
  const origin = SPOT_CHAINS.find((c) => c.id === s.chainId)!
  const spend = s.token === 'USDC' ? String(amount) : ethUnits(s, amount)
  const feeUsd = Math.round(((amount * CROSS_CHAIN_FEE_BPS) / 10_000) * 100) / 100
  return {
    id: `fund:near:${s.chainId}:${s.token.toLowerCase()}`,
    kind: 'fund',
    venue: 'near',
    chainId: s.chainId,
    side: 'buy',
    fee: 'cross-chain',
    label: `Bring ${s.token} from ${origin.name}`,
    ask: `Swap ${spend} ${s.token} from ${origin.word} to ${sym} on ${dest.word}`,
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
