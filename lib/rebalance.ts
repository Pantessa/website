// ─────────────────────────────────────────────────────────────────────────
//  Portfolio rebalance — "put my idle money to work" (2026-07-28).
//
//  The briefing already NAMES idle capital ("$118 USDC idle on Base ·
//  earning nothing"); this module is the ANSWER: take the wallet's full
//  multi-chain picture (the funding scan — the same movable/stranded rules
//  as every funding offer) plus the LIVE venue rates (Aave v4 USDC supply
//  APY, Lido stETH APR — both read fail-soft, never guessed), and turn it
//  into ONE batch the user signs step by step: bridge legs first (NEAR
//  Intents, settlement waits handled by the jobs runner), then the supply /
//  stake on Ethereum, where both native venues live.
//
//  The chips ARE the contract (the funding-plan doctrine): every resume
//  string this planner emits must round-trip the native ladder — multi-leg
//  plans compile under lib/jobs.ts, single-leg plans land on their own
//  native gate ("supply 120 USDC to aave" → the Aave gate). The harness
//  feeds fabricated wallet states through planRebalance and replays every
//  ask; a chip that stops compiling is a red build, not a live 404.
//
//  Honesty rules, in order of precedence:
//  · A venue whose rate couldn't be read is SKIPPED BY NAME — no invented
//    APYs, no "about 4%" from memory.
//  · The math must beat the move: estimated yearly earnings ≥ 2× the
//    estimated move cost (solver fees + mainnet action gas), else the
//    balance is named with the arithmetic instead of offered ("at 4.1%
//    that's $0.74/yr — the move costs more"). Refusing to compile an
//    uneconomical plan is the product working, not a missing feature.
//  · Stranded balances (the #549 rule) and failed chain reads are named,
//    never silently dropped — a partial scan must not become a confident
//    "nothing to do".
//  · Estimates are labeled estimates. Rates float; nothing here is
//    financial advice and the copy says so.
//
//  Pure module: no RPC, no fetch — lib/rebalance-exec.ts is the I/O shell
//  (scan + rate reads), mirroring the funding-plan / briefing seam so the
//  harness drives THE rules on fabricated wallets.
// ─────────────────────────────────────────────────────────────────────────

import type { FundingScan, FundingSource } from './funding-plan'

/** Live venue rates, read fail-soft — null = unreadable = venue skipped. */
export interface RebalanceRates {
  /** Aave v4 USDC supply APY on Ethereum, percent (the native Aave layer is
   *  mainnet-only — a named other chain is a compile failure by design). */
  aaveUsdcSupplyApyPct: number | null
  /** Lido stETH APR, percent (7-day SMA — the position payload's number). */
  lidoAprPct: number | null
}

/** What's ALREADY earning — shown so the picture is whole, never re-moved. */
export interface RebalanceEarning {
  aaveSuppliedUsd: number | null
  lidoStakedUsd: number | null
}

export interface RebalanceInputs {
  scan: Pick<FundingScan, 'sources' | 'stranded' | 'ethUsd' | 'readChains' | 'failedChains'>
  rates: RebalanceRates
  earning: RebalanceEarning
}

export interface RebalanceMove {
  venue: 'aave' | 'lido'
  /** Cross-chain legs, in order — each parses under parseCrossChainSwap. */
  bridgeLegs: string[]
  /** A mainnet gas top-up leg when the wallet couldn't sign there. Kept on
   *  the move so its STANDALONE chip is always self-funding; the combined
   *  batch drops it when the ETH move's arrivals cover mainnet gas anyway. */
  gasLeg: string | null
  /** The drag the cost math attributes to the gas leg (0 when none) — the
   *  solver fee + spread, NOT the leg's full size (the bought ETH stays
   *  usable gas; the burn is the per-action term). Lets the combined plan
   *  drop it along with the leg. */
  gasCostUsd: number
  /** True when this move is only signable INSIDE the combined batch (no
   *  mainnet gas, no donor — the ETH move's arrivals are the gas). Its
   *  standalone chip must not be offered. */
  combinedOnly: boolean
  /** The venue action — parses under the Aave supply / Lido stake gate. */
  actionLeg: string
  /** Value being put to work (USD, post-haircut arrival estimate). */
  amountUsd: number
  /** amountUsd × the live rate — the headline number. */
  estYearUsd: number
  /** Solver fees + mainnet action gas, the honest drag on the plan. */
  costUsd: number
  /** One pre-formatted line for the reply ("$118.40 USDC idle on Base →
   *  Aave at 4.12%"). Client-string doctrine: no client money math. */
  summary: string
}

export type RebalancePlan =
  | {
      kind: 'plan'
      moves: RebalanceMove[]
      /** The combined batch — every move's legs merged into one job ask. */
      ask: string
      totalMoveUsd: number
      totalEstYearUsd: number
      totalCostUsd: number
      /** Honesty lines: stranded funds, failed reads, skipped venues,
       *  balances whose math didn't clear the floor. */
      notes: string[]
    }
  | { kind: 'quiet'; notes: string[] }

// Floors + cost model — documented so the refusal math is auditable.
/** Idle balances below this aren't offered (matches the briefing floor). */
export const REBALANCE_MIN_IDLE_USD = 25
/** Estimated solver drag on a NEAR Intents leg, for the COST math. */
const BRIDGE_COST_BPS = 50
/** Haircut when SIZING the venue action off a bridged amount — the action
 *  must never ask for more than actually arrives (lib/lifi-bridge sizes its
 *  legs with the same 400bps headroom, just in the other direction). */
const ARRIVAL_HAIRCUT_BPS = 400
/** Estimated gas burn per mainnet venue action (approve + the op). */
const MAINNET_ACTION_GAS_USD = 2
/** The mainnet gas top-up a standalone move buys when the wallet can't sign
 *  there (the #551 mainnet floor: below ~$6 the leg isn't worth quoting). */
const MAINNET_GAS_LEG_USD = 6
/** What the COST math charges for that leg: the solver fee + spread on the
 *  top-up. The bought ETH itself isn't lost — it sits as signable mainnet
 *  gas, and the actual burn is already the per-action gas term (charging
 *  the full $6 would double-count and veto plans the math actually favors). */
const GAS_LEG_DRAG_USD = 1
/** Earnings must beat the move cost by this multiple, and clear the flat
 *  floor, or the balance is named instead of offered. */
const PAYBACK_MULT = 2
const MIN_EST_YEAR_USD = 5
/** ETH kept ON TOP of the scan's per-chain keep-back so the wallet can
 *  still sign the supply/stake after the plan lands (mainnet keep-back
 *  0.002 + this ≈ the 0.003 destination gas floor, with headroom). */
const MAINNET_HEADROOM_ETH = 0.002
/** Below this a stake isn't worth mainnet gas regardless of the rate. */
const MIN_STAKE_ETH = 0.005

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number) => `${n.toFixed(2)}%`
const floorTo = (n: number, dp: number) => Math.floor(n * 10 ** dp) / 10 ** dp
const fmt = (n: number, dp: number) => floorTo(n, dp).toFixed(dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')

// ── The ask grammar (the ladder gate) ───────────────────────────────────────
// Disjoint from every other gate by construction: no other parser claims
// "rebalance", and the to-work/earn-more shapes carry no amount+token pair
// (so the Aave/swap grammars never collide). "balance" alone must NOT match
// ("what's my balance" is a read, not a rebalance).
const REBALANCE_RE = /\bre-?balanc(?:e|ing)\b/i
const TO_WORK_RE =
  /\bput\s+(?:my|the|some(?:\s+of)?(?:\s+my)?|all(?:\s+of)?(?:\s+my)?|it|this|that)?\s*(?:idle\s+)?(?:money|cash|funds?|capital|stables?|savings|usdc|eth|portfolio|balances?)\s+to\s+work\b/i
const EARN_MORE_RE =
  /\bwhere\s+(?:could|can|should)\s+(?:my\s+(?:money|cash|funds?|portfolio|wallet)|i)\s+(?:be\s+)?earn(?:ing)?\s+more\b/i
const MAKE_WORK_RE =
  /\bmake\s+my\s+(?:money|cash|funds?|portfolio|wallet)\s+(?:work(?:\s+harder)?|earn(?:\s+more)?|grow)\b/i

/** Does this ask want the rebalance read? Pure, cheap, collision-audited. */
export function parseRebalanceAsk(message: string): boolean {
  return (
    REBALANCE_RE.test(message) || TO_WORK_RE.test(message) || EARN_MORE_RE.test(message) || MAKE_WORK_RE.test(message)
  )
}

// ── The planner ─────────────────────────────────────────────────────────────

const ethSrc = (sources: FundingSource[], chainId: number) =>
  sources.find((s) => s.token === 'ETH' && s.chainId === chainId)
const usdcSrc = (sources: FundingSource[], chainId: number) =>
  sources.find((s) => s.token === 'USDC' && s.chainId === chainId)

/**
 * The pure planner: scan + rates in → an executable plan (or an honest
 * quiet) out. Every emitted leg string is grammar the native ladder already
 * compiles — the harness round-trips them all.
 */
export function planRebalance(inputs: RebalanceInputs): RebalancePlan {
  const { scan, rates, earning } = inputs
  const notes: string[] = []
  const moves: RebalanceMove[] = []

  // Honesty first: name what a partial scan can't claim, and what exists
  // but can't move (the #549 rule — owned money is never invisible).
  for (const chain of scan.failedChains) {
    notes.push(`${chain} didn't answer — its balances aren't counted here (try again in a minute).`)
  }
  for (const s of scan.stranded) {
    notes.push(
      s.token === 'ETH'
        ? `${usd(s.usd)} of ETH on ${s.chainWord} sits under the gas floor — not movable, it can stay as headroom.`
        : `${usd(s.usd)} ${s.token} on ${s.chainWord} has no gas to move — send a little ETH there to unstick it.`,
    )
  }

  // Can the wallet sign on Ethereum? The scan's mainnet ETH source already
  // has the 0.002 keep-back deducted, so ANY mainnet ETH source means the
  // wallet clears the 0.003 destination floor with the keep-back included.
  const mainnetEth = ethSrc(scan.sources, 1)
  const mainnetCanSign = (mainnetEth?.balance ?? 0) > 0.001

  // ── ETH → Lido (compute FIRST: its arrivals double as mainnet gas, which
  //    lets a combined plan drop the USDC move's explicit gas leg). ────────
  let ethMove: RebalanceMove | null = null
  if (rates.lidoAprPct !== null && rates.lidoAprPct > 0 && scan.ethUsd !== null) {
    const l2Eth = scan.sources
      .filter((s) => s.token === 'ETH' && s.chainId !== 1 && s.usd >= REBALANCE_MIN_IDLE_USD * 2)
      .sort((a, b) => b.usd - a.usd)
    const bridgeLegs = l2Eth.map(
      (s) => `Swap ${fmt(s.balance, 6)} ETH from ${s.chainWord} to ETH on Ethereum`,
    )
    const arrivals = l2Eth.reduce((a, s) => a + s.balance, 0) * (1 - ARRIVAL_HAIRCUT_BPS / 10_000)
    const stakeEth = floorTo((mainnetEth?.balance ?? 0) + arrivals - MAINNET_HEADROOM_ETH, 5)
    if (stakeEth >= MIN_STAKE_ETH) {
      const amountUsd = stakeEth * scan.ethUsd
      const estYearUsd = (amountUsd * rates.lidoAprPct) / 100
      const bridgedUsd = l2Eth.reduce((a, s) => a + s.usd, 0)
      const costUsd = (bridgedUsd * BRIDGE_COST_BPS) / 10_000 + MAINNET_ACTION_GAS_USD
      if (estYearUsd >= MIN_EST_YEAR_USD && estYearUsd >= costUsd * PAYBACK_MULT) {
        ethMove = {
          venue: 'lido',
          bridgeLegs,
          gasLeg: null, // its own arrivals + headroom fund the signature
          gasCostUsd: 0,
          combinedOnly: false,
          actionLeg: `stake ${fmt(stakeEth, 5)} eth on lido`,
          amountUsd,
          estYearUsd,
          costUsd,
          summary: `${fmt(stakeEth, 5)} ETH idle (${[...l2Eth.map((s) => s.chainWord), ...(mainnetEth ? ['Ethereum'] : [])].join(' + ')}) → Lido at ${pct(rates.lidoAprPct)} APR ≈ ${usd(estYearUsd)}/yr`,
        }
        moves.push(ethMove)
      } else if (amountUsd > 1) {
        notes.push(
          `${fmt(stakeEth, 5)} ETH (~${usd(amountUsd)}) at Lido's ${pct(rates.lidoAprPct)} would earn ~${usd(estYearUsd)}/yr — the move costs ~${usd(costUsd)}, so it doesn't clear the floor yet.`,
        )
      }
    }
  } else if (rates.lidoAprPct === null) {
    notes.push("Couldn't read Lido's live APR — not guessing, so staking sits this one out.")
  }

  // ── USDC → Aave on Ethereum ─────────────────────────────────────────────
  if (rates.aaveUsdcSupplyApyPct !== null && rates.aaveUsdcSupplyApyPct > 0) {
    const mainnetUsdc = usdcSrc(scan.sources, 1)
    const l2Usdc = scan.sources
      .filter((s) => s.token === 'USDC' && s.chainId !== 1 && s.usd >= REBALANCE_MIN_IDLE_USD)
      .sort((a, b) => b.usd - a.usd)
    const bridgeLegs = l2Usdc.map(
      (s) => `Swap ${fmt(s.balance, 2)} USDC from ${s.chainWord} to USDC on Ethereum`,
    )
    const arrivals = l2Usdc.reduce((a, s) => a + s.balance, 0) * (1 - ARRIVAL_HAIRCUT_BPS / 10_000)
    const supplyUsdc = floorTo((mainnetUsdc?.balance ?? 0) + arrivals, 2)
    const idleUsd = (mainnetUsdc?.usd ?? 0) + l2Usdc.reduce((a, s) => a + s.usd, 0)
    if (supplyUsdc >= REBALANCE_MIN_IDLE_USD) {
      const estYearUsd = (supplyUsdc * rates.aaveUsdcSupplyApyPct) / 100
      // Gas: covered by mainnet ETH, by an explicit top-up leg from the
      // richest L2 ETH donor (so the STANDALONE chip is always
      // self-funding), or — combined-only — by the ETH move's arrivals.
      // No gas anywhere = the move is named, not offered (funds that land
      // where the wallet can't sign are stranded, not delivered).
      let gasLeg: string | null = null
      let gasCostUsd = 0
      let combinedOnly = false
      if (!mainnetCanSign) {
        const donor = scan.sources
          .filter((s) => s.token === 'ETH' && s.chainId !== 1 && s.usd >= MAINNET_GAS_LEG_USD + 1)
          .sort((a, b) => b.usd - a.usd)[0]
        if (donor && scan.ethUsd !== null) {
          const gasEth = Math.min(MAINNET_GAS_LEG_USD / scan.ethUsd, donor.balance)
          gasLeg = `Swap ${fmt(gasEth, 6)} ETH from ${donor.chainWord} to ETH on Ethereum`
          gasCostUsd = GAS_LEG_DRAG_USD
        } else if (ethMove) {
          combinedOnly = true // the batch's ETH arrivals are the gas
        } else {
          notes.push(
            `${usd(idleUsd)} of USDC could earn ${pct(rates.aaveUsdcSupplyApyPct)} on Aave, but the wallet can't sign on Ethereum (no mainnet gas and no chain can donate ~$${MAINNET_GAS_LEG_USD} of ETH) — top up mainnet gas first.`,
          )
        }
      }
      if (mainnetCanSign || ethMove || gasLeg) {
        const bridgedUsd = l2Usdc.reduce((a, s) => a + s.usd, 0)
        const costUsd = (bridgedUsd * BRIDGE_COST_BPS) / 10_000 + MAINNET_ACTION_GAS_USD + gasCostUsd
        if (estYearUsd >= MIN_EST_YEAR_USD && estYearUsd >= costUsd * PAYBACK_MULT) {
          moves.push({
            venue: 'aave',
            bridgeLegs,
            gasLeg,
            gasCostUsd,
            combinedOnly,
            actionLeg: `supply ${fmt(supplyUsdc, 2)} USDC to aave`,
            amountUsd: supplyUsdc,
            estYearUsd,
            costUsd,
            summary: `${usd(idleUsd)} USDC idle (${[...(mainnetUsdc ? ['Ethereum'] : []), ...l2Usdc.map((s) => s.chainWord)].join(' + ')}) → Aave at ${pct(rates.aaveUsdcSupplyApyPct)} APY ≈ ${usd(estYearUsd)}/yr`,
          })
        } else {
          notes.push(
            `${usd(idleUsd)} USDC at Aave's ${pct(rates.aaveUsdcSupplyApyPct)} would earn ~${usd(estYearUsd)}/yr — the move costs ~${usd(costUsd)}, so it doesn't clear the floor yet.`,
          )
        }
      }
    } else if (idleUsd >= 1) {
      notes.push(
        `${usd(idleUsd)} of idle USDC is under the ${usd(REBALANCE_MIN_IDLE_USD)} floor — at ${pct(rates.aaveUsdcSupplyApyPct)} the move would cost more than it earns.`,
      )
    }
  } else if (rates.aaveUsdcSupplyApyPct === null) {
    notes.push("Couldn't read Aave's live USDC rate — not guessing, so lending sits this one out.")
  }

  // What's already working belongs in the picture (and proves the read).
  if (earning.aaveSuppliedUsd !== null && earning.aaveSuppliedUsd > 0.5) {
    notes.push(`Already working: ${usd(earning.aaveSuppliedUsd)} supplied on Aave.`)
  }
  if (earning.lidoStakedUsd !== null && earning.lidoStakedUsd > 0.5) {
    notes.push(`Already working: ${usd(earning.lidoStakedUsd)} staked with Lido.`)
  }

  if (moves.length === 0) return { kind: 'quiet', notes }

  // The combined batch: ETH bridges land first (their arrivals double as
  // mainnet gas, so the USDC move's explicit gas leg is dropped when the
  // ETH move rides along), then USDC bridges, then the venue actions —
  // supply before stake so the stake's headroom math stays the last word
  // on mainnet ETH.
  const lidoMoves = moves.filter((m) => m.venue === 'lido')
  const aaveMoves = moves.filter((m) => m.venue === 'aave')
  const gasCovered = lidoMoves.length > 0
  const legs = [
    ...(gasCovered ? [] : moves.flatMap((m) => (m.gasLeg ? [m.gasLeg] : []))),
    ...lidoMoves.flatMap((m) => m.bridgeLegs),
    ...aaveMoves.flatMap((m) => m.bridgeLegs),
    ...aaveMoves.map((m) => m.actionLeg),
    ...lidoMoves.map((m) => m.actionLeg),
  ]
  const droppedGasUsd = gasCovered ? moves.reduce((a, m) => a + m.gasCostUsd, 0) : 0
  return {
    kind: 'plan',
    moves,
    ask: legs.join(', then '),
    totalMoveUsd: moves.reduce((a, m) => a + m.amountUsd, 0),
    totalEstYearUsd: moves.reduce((a, m) => a + m.estYearUsd, 0),
    totalCostUsd: moves.reduce((a, m) => a + m.costUsd, 0) - droppedGasUsd,
    notes,
  }
}

/** One move's standalone ask (the "just this venue" chip) — carries its own
 *  gas provisioning even when the combined plan wouldn't need it. Never
 *  offer it for a `combinedOnly` move: alone, that move can't pay its own
 *  mainnet gas. */
export function moveAsk(move: RebalanceMove): string {
  return [...(move.gasLeg ? [move.gasLeg] : []), ...move.bridgeLegs, move.actionLeg].join(', then ')
}
