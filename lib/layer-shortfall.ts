// lib/layer-shortfall.ts — the answer a native layer gives when the wallet
// can't fund the action, and the card door that rides along with it.
//
// Born 2026-09-16, the sibling of lib/swap-shortfall. The card door had
// reached the swap and the Robinhood stock buy. Every other native layer that
// rides the universal funding plan still answered an empty wallet with
// "Across … I found no movable ETH or USDC — … Top up any of those chains and
// ask again." and no way forward. Prod ask_failures, 45 days, had_funds=false:
//
//   • "I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long
//     with a 5% stop", three times (two strangers on 08-27, a test account
//     on 09-04),
//   • "Supply $25 of USDT to Aave at the best rate" (09-16),
//   • "Stake 0.05 ETH with Lido" (08-04).
//
// The NFT buy and the Morpho lend refuse through the same shape.
//
// PURE. The route hands this the ask as its layer resolved it, plus the
// funding layer's refusal (its text and the facts behind it).
// scripts/audit-funding.ts drives the same function over fabricated wallets
// and lands each preset at $2k–$5k/ETH; the harness pins every variant.
//
// The on-ramp delivers ETH on the default lane (Ethereum), so there are two
// kinds of chip:
//
//   • PLAN. The landed ETH still has to move, or become something else: USDC
//     on Arbitrum for a Hyperliquid deposit, USDT for an Aave supply. The chip
//     restates the ask as its resume. When the resume fires, the layer runs
//     its funding plan again, and this time the landed ETH is a source. (The
//     HL open compiles the funded job outright.) The preset is planFundUsd
//     over the plan the refusal priced, with one exception: when the
//     destination IS the lane, that plan priced a gas leg to put ETH on the
//     destination, and the card puts ETH there itself. The leg drops out of
//     the sizing, and the preset floors at what clears the destination's gas
//     floor instead.
//
//   • DIRECT. The delivery lands the very asset the action spends, on the
//     very chain it runs on: a Lido stake, or an NFT listed on Ethereum.
//     Nothing converts or bridges, so there's no plan headroom or keep-back
//     to fund. But unlike a completing ETH buy (lib/swap-shortfall), the
//     action still needs its own signature. The preset is deliveryFundUsd
//     over the refusal's need (the plan's 10% + $1 solver margin covers a
//     price move before delivery), and the resume fires on arrival to build
//     the stake or the fill.
//
// No chip when stranded USDC covers the plan (that wallet needs a dollar of
// gas, not a card purchase), when one checkout can't carry it, or when the
// door is closed. Every refusal that names money keeps naming it: the card is
// an addition to an honest answer, never a replacement for one.

import type { ClarifyOption, ClarifyRequest } from '@/lib/clarify'
import { DEST_GAS_FLOOR_ETH, FUNDING_CHAIN_WORD, type FundingRefusalFacts } from '@/lib/funding-plan'
import {
  fundChipFor,
  ONRAMP_ASSET,
  ONRAMP_DEFAULT_NETWORK,
  ONRAMP_ETH_PRICE_CEILING_USD,
  ONRAMP_MAX_USD,
  ONRAMP_NETWORK_LABEL,
  ONRAMP_SETTLE_SLACK_USD,
  planFitsOneCheckout,
  type OnrampNetwork,
} from '@/lib/onramp'

/** The native layers whose funding refusals carry the card door. */
export type ShortfallLayer = 'hl-open' | 'hl-deposit' | 'aave-supply' | 'aave-repay' | 'morpho-lend' | 'lido-stake' | 'nft-buy'

interface LayerVoice {
  /** Leads the empty wallet's plain answer. */
  emoji: string
  /** What the landed money finishes ("the deposit"). */
  noun: string
  /** A step the plan runs between the move and the action ("the Hyperliquid
   *  deposit" before a position opens). */
  via?: string
  /** Stamped on the turn, so a refusal files under its own layer in
   *  lib/ask-failure (a native wall), never as a planner answer. */
  buildPath: string
  /** The resume compiles the funded JOB directly on return (route
   *  hlAutoFundedJobTurn: no ok-step) instead of offering funding chips. */
  oneJob?: true
}

export const LAYER_SHORTFALL: Record<ShortfallLayer, LayerVoice> = {
  'hl-open': { emoji: '📈', noun: 'the position', via: 'the Hyperliquid deposit', buildPath: 'native-hl-exec', oneJob: true },
  'hl-deposit': { emoji: '📈', noun: 'the deposit', buildPath: 'native-hl-exec' },
  'aave-supply': { emoji: '🏦', noun: 'the supply', buildPath: 'native-aave-supply' },
  'aave-repay': { emoji: '🏦', noun: 'the repayment', buildPath: 'native-aave-op' },
  'morpho-lend': { emoji: '🏦', noun: 'the lend', buildPath: 'native-morpho-lend' },
  'lido-stake': { emoji: '🌊', noun: 'the stake', buildPath: 'native-lido' },
  'nft-buy': { emoji: '🖼️', noun: 'the buy', buildPath: 'native-nft-buy' },
}

export interface LayerShortfallAsk {
  layer: ShortfallLayer
  /** The ask as a verb phrase ("deposit 20 USDC to Hyperliquid"). It leads
   *  the empty wallet's answer and labels the chip. */
  what: string
  /** The ask restated as the chip's resume. It must round-trip the parse
   *  ladder (audit:asks, audit:funding) and mean the same thing when it
   *  fires minutes later. */
  resume: string
  /** Where the money has to land: the refusal's FundingNeed chainId + token. */
  chainId: number
  token: string
  /** The layer's own sentence about the shortfall, emoji included. Kept
   *  whenever the wallet holds anything. */
  lead: string
  /** What the action takes, said to an empty wallet too ("The position needs
   *  about $6 of USDC on Hyperliquid as collateral."). */
  needLine?: string
  /** The layer read money the funding scan doesn't (USDT on Ethereum, a
   *  Hyperliquid balance). A wallet holding it isn't empty. */
  holdsUnscanned?: boolean
}

export interface LayerShortfallTurn {
  reply: string
  clarify?: ClarifyRequest
  buildPath: string
}

export type LayerCardKind = 'plan' | 'direct'

/** The chain each on-ramp lane delivers to. */
export const ONRAMP_LANE_CHAIN_ID: Record<OnrampNetwork, number> = { base: 8453, ethereum: 1 }

const NOT_NOW: ClarifyOption = { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }

/** Whole dollars stay whole ("$22"); anything else keeps its cents ("$9.50"). */
const dollarsWord = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/** DIRECT when the delivery IS the asset and chain the action spends; PLAN
 *  otherwise. */
export function layerCardKind(ask: Pick<LayerShortfallAsk, 'chainId' | 'token'>, network: OnrampNetwork = ONRAMP_DEFAULT_NETWORK): LayerCardKind {
  return ask.chainId === ONRAMP_LANE_CHAIN_ID[network] && ask.token.toUpperCase() === ONRAMP_ASSET ? 'direct' : 'plan'
}

/** The plan a PLAN chip funds. When the destination is the lane, the landed
 *  ETH is the destination's gas, so the refusal's gas leg drops out. A
 *  gas-only need there keeps its leg as the plan: without the leg there'd be
 *  nothing left to size. */
export function layerPlanUsd(ask: Pick<LayerShortfallAsk, 'chainId'>, facts: Pick<FundingRefusalFacts, 'needUsd' | 'gasUsd'>, network: OnrampNetwork = ONRAMP_DEFAULT_NETWORK): number {
  if (ask.chainId !== ONRAMP_LANE_CHAIN_ID[network]) return facts.needUsd
  const tokenPlanUsd = Number((facts.needUsd - facts.gasUsd).toFixed(2))
  return tokenPlanUsd > 0 ? tokenPlanUsd : facts.needUsd
}

/** The smallest preset whose landing, after the settle slack, still clears
 *  the lane chain's own gas floor with ETH at the price ceiling: 0.003 ETH ×
 *  $5,000 + $1 = $16 on Ethereum. Below it, a lane-destination landing at
 *  $5,000/ETH sits under the floor, and the re-plan asks for a gas leg that
 *  the ETH already sitting there can't provide. */
export function laneGasFloorPresetUsd(network: OnrampNetwork = ONRAMP_DEFAULT_NETWORK): number {
  const floorEth = DEST_GAS_FLOOR_ETH[ONRAMP_LANE_CHAIN_ID[network]] ?? 0.0002
  return Math.ceil(Number((floorEth * ONRAMP_ETH_PRICE_CEILING_USD + ONRAMP_SETTLE_SLACK_USD).toFixed(2)))
}

/** The card chip for this refusal, or null when:
 *  - the door is closed (lib/onramp fails closed);
 *  - stranded USDC covers the plan (a dollar of gas fixes that wallet);
 *  - one checkout can't carry it. The preset caps at ONRAMP_MAX_USD, and a
 *    capped chip would land short of its own label and walk its resume back
 *    into this wall. */
export function layerFundChip(ask: LayerShortfallAsk, facts: FundingRefusalFacts): ClarifyOption | null {
  if (facts.strandedCovers) return null
  const network = ONRAMP_DEFAULT_NETWORK
  const actionLabel = ask.what
  if (layerCardKind(ask, network) === 'direct') {
    return Math.ceil(facts.needUsd) <= ONRAMP_MAX_USD ? fundChipFor({ needUsd: facts.needUsd, actionLabel, resume: ask.resume, network, direct: true }) : null
  }
  const planUsd = layerPlanUsd(ask, facts, network)
  if (!planFitsOneCheckout(planUsd, network)) return null
  const laneIsDestination = ask.chainId === ONRAMP_LANE_CHAIN_ID[network]
  return fundChipFor({ needUsd: planUsd, actionLabel, resume: ask.resume, network, ...(laneIsDestination ? { minPresetUsd: laneGasFloorPresetUsd(network) } : {}) })
}

/** The sentence that offers the card, sized to the chip it describes.
 *  - Empty string when there is no chip and the wallet holds something (the
 *    refusal already says what to do).
 *  - The one honest next step when there is no chip and the wallet is empty.
 *  Exported for a layer that composes its own reply around extra chips
 *  (Lido's stake-what-you-have offer). */
export function layerCardDoorCopy(ask: LayerShortfallAsk, facts: Pick<FundingRefusalFacts, 'needUsd' | 'gasUsd'>, chip: ClarifyOption | null, empty: boolean): string {
  const fund = chip?.fund
  if (!fund) return empty ? ' Send ETH or USDC to this wallet on any of those chains, then ask again — nothing was built.' : ''
  const voice = LAYER_SHORTFALL[ask.layer]
  const lane = ONRAMP_NETWORK_LABEL[fund.network]

  if (layerCardKind(ask, fund.network) === 'direct') {
    const lands = `it lands as ETH on ${lane}, exactly what ${voice.noun} spends, so nothing gets swapped or bridged`
    if (!empty) return ` Or add it with a card or bank below — ${lands}, and once it's there I'll build ${voice.noun} for you to sign.`
    const opens =
      fund.presetFiatUsd > Math.ceil(facts.needUsd)
        ? ` Card checkouts here start at $${fund.presetFiatUsd}, so it opens there, and whatever ${voice.noun} doesn't use stays in this wallet.`
        : ` The checkout opens at $${fund.presetFiatUsd}, a little over what ${voice.noun} needs, so a price move before it lands doesn't leave you short.`
    return ` You can add it with a card or bank below: ${lands}, and once it's there I'll build ${voice.noun} for you to sign.${opens}`
  }

  const token = ask.token.toUpperCase()
  const destination = FUNDING_CHAIN_WORD[ask.chainId] ?? 'the right chain'
  const laneIsDestination = ask.chainId === ONRAMP_LANE_CHAIN_ID[fund.network]
  const first = laneIsDestination ? `the swap to ${token}` : `the move to ${destination}`
  const steps = voice.via ? `${first}, ${voice.via} and ${voice.noun}` : `${first} and ${voice.noun}`
  const next = voice.oneJob ? `${steps} line up as one job for you to sign` : `I'll lay out ${steps} for you to sign`
  if (!empty) return ` Or add it with a card or bank below — it lands as ETH on ${lane}, and once it's there ${next}.`
  const planUsd = layerPlanUsd(ask, facts, fund.network)
  return (
    ` You can add it with a card or bank below: it lands as ETH on ${lane}, which also pays the gas, and once it's there ${next}.` +
    ` The checkout opens at $${fund.presetFiatUsd}: the ~$${dollarsWord(planUsd)} plan, plus the ETH this wallet keeps to pay its own gas and room for price moves. Whatever isn't spent stays in this wallet.`
  )
}

/**
 * The whole answer to an action the wallet can't fund:
 * - plain copy for an empty wallet;
 * - the funding layer's refusal kept intact wherever there is money to name;
 * - the card chip when the door is open.
 */
export function layerShortfallTurn(params: { ask: LayerShortfallAsk; refusal: { insufficient: string } & FundingRefusalFacts }): LayerShortfallTurn {
  const { ask, refusal } = params
  const voice = LAYER_SHORTFALL[ask.layer]
  // Empty means the scan found nothing worth naming AND the layer's own reads
  // found nothing the scan can't see. Only then is "there's no ETH or USDC
  // here yet" the whole truth.
  const empty = refusal.empty && !ask.holdsUnscanned
  const chip = layerFundChip(ask, refusal)
  const door = layerCardDoorCopy(ask, refusal, chip, empty)
  const reply = empty
    ? `${voice.emoji} To ${ask.what}, this wallet needs money in it first — I checked ${refusal.chainsRead} and there's no ETH or USDC here yet.${ask.needLine ? ` ${ask.needLine}` : ''}${door}`
    : `${ask.lead} ${refusal.insufficient}${door}`
  return {
    reply,
    ...(chip ? { clarify: { question: 'Add the funds and run it?', options: [chip, NOT_NOW] } } : {}),
    buildPath: voice.buildPath,
  }
}
