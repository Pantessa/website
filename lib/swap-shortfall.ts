// lib/swap-shortfall.ts — the answer a market swap gives when the wallet can't
// fund its spend side, and the card door that rides along with it.
//
// Born 2026-09-15. A visitor arrived from a tweet on /t/ETH, signed up with
// Google (a fresh, empty embedded wallet), tapped "Buy $50 of ETH", then typed
// "Buy $10 of ETH". Both times the reply was "The swap sells 50 USDC on Base
// and the wallet holds 0. Across Base, Arbitrum, Ethereum and Optimism I found
// no movable ETH or USDC — the smallest plan for the swap moves ~$58 (solver
// fees included). Top up any of those chains and ask again." No chip, no way
// forward, and they left. The Robinhood stock buy in the same state has
// offered the card chip since #668; the generic swap never did, and its copy
// talked about selling USDC to someone who had asked to buy ETH.
//
// PURE. The route hands this the ask as the swap layer resolved it plus the
// funding layer's honest refusal (its text and the facts behind it);
// scripts/audit-funding.ts drives the same function over fabricated wallets
// and the harness pins every variant, so the copy a stranger reads is the copy
// that was checked.
//
// Two kinds of card chip, because the on-ramp delivers ETH:
//
//   • A BUY OF ETH. The delivery IS the buy. The chip presets the asked dollars
//     (deliveryFundUsd) and completes on arrival: nothing fires afterwards.
//     Re-running "Buy $50 of ETH" there would plan ETH → USDC → ETH off the
//     ETH that just landed and charge both swaps for the round trip.
//
//   • A BUY OF ANYTHING ELSE. The chip carries the ask restated as its resume,
//     presets the plan the refusal priced (planFundUsd, headroom and L1
//     keep-back included), and the existing cascade spends the delivered ETH
//     when the resume fires: the move to the swap chain, then the buy. Same
//     contract as the stock buy's chip.
//
// A SELL (the spend side is not dollars, "Swap $5 of ETH to USDC") gets no
// chip and keeps its old answer. The card delivers ETH, and buying ETH in
// order to sell it is not what anyone asked for.

import type { ClarifyOption, ClarifyRequest } from '@/lib/clarify'
import type { FundingRefusalFacts } from '@/lib/funding-plan'
import { fundChipFor, ONRAMP_ASSET, ONRAMP_DEFAULT_NETWORK, ONRAMP_MAX_USD, ONRAMP_NETWORK_LABEL, planFitsOneCheckout } from '@/lib/onramp'

export interface SwapShortfallAsk {
  /** The swap chain's registry name ("Base"), for copy. */
  chainName: string
  /** The swap chain as resume strings spell it (lib/funding-plan FUNDING_CHAIN_WORD). */
  chainWord: string
  /** The spend token as the swap layer resolved it. "Buy $50 of ETH" names
   *  none, so this is the chain stable the route filled in. */
  sellToken: string
  buyToken: string
  /** The spend amount in token units (a dollar ask is already priced into it). */
  sellAmountHuman: string
  /** Set when the ask was dollar-denominated ("Buy $50 of ETH"). */
  sellAmountUsd?: string
  /** The spend token is a USD stable on the swap chain (lib/chains `stables`). */
  sellIsStable: boolean
  /** The spend token's balance on the swap chain, as the pre-read printed it. */
  heldHuman: string
}

export interface SwapShortfallTurn {
  reply: string
  clarify?: ClarifyRequest
  buildPath: 'native-swap-short'
}

/** Whole dollars stay whole ("$50"); anything else keeps its cents ("$12.50"). */
const dollarsWord = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/** The dollars a buy spends, or null when the spend side isn't dollars (a
 *  sell). A dollar ask carries its own figure; a token-amount spend of a
 *  stable ("Swap 50 USDC for UNI") is worth its amount. */
export function buyDollarsOf(ask: Pick<SwapShortfallAsk, 'sellIsStable' | 'sellAmountUsd' | 'sellAmountHuman'>): number | null {
  if (!ask.sellIsStable) return null
  const n = Number(ask.sellAmountUsd ?? ask.sellAmountHuman)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The ask restated as a chip resume. It must round-trip the parse ladder
 *  (audit:asks, audit:funding) and mean the same thing when it fires minutes
 *  later: a dollar buy stays a dollar buy, re-priced on return; a token-amount
 *  swap keeps its amount; both pin the chain, so a chain picker moved in the
 *  meantime can't move the buy. */
export function swapBuyResume(ask: Pick<SwapShortfallAsk, 'chainWord' | 'sellToken' | 'buyToken' | 'sellAmountHuman' | 'sellAmountUsd'>): string {
  const buy = ask.buyToken.toUpperCase()
  if (ask.sellAmountUsd) return `Buy $${dollarsWord(Number(ask.sellAmountUsd))} of ${buy} on ${ask.chainWord}`
  return `Swap ${ask.sellAmountHuman} ${ask.sellToken.toUpperCase()} for ${buy} on ${ask.chainWord}`
}

/** The card chip for a buy this refusal can't fund, or null. Null when the
 *  door is closed (lib/onramp fails closed), when the spend side isn't dollars,
 *  when stranded USDC already covers the plan (that wallet needs a dollar of
 *  gas, and a card purchase for the whole buy would be an upsell), and when
 *  one checkout can't carry the buy: the preset caps at ONRAMP_MAX_USD, and a
 *  capped chip would land short of its own label. The swap layer has no
 *  downsize offer to catch that, so its resume would come back to this wall
 *  and offer the card again. */
export function swapBuyFundChip(ask: SwapShortfallAsk, facts: FundingRefusalFacts): ClarifyOption | null {
  const dollars = buyDollarsOf(ask)
  if (dollars === null || facts.strandedCovers) return null
  const buy = ask.buyToken.toUpperCase()
  const what = ask.sellAmountUsd ? `$${dollarsWord(dollars)} of ${buy}` : `${buy} with ${ask.sellAmountHuman} ${ask.sellToken.toUpperCase()}`
  const resume = swapBuyResume(ask)
  if (buy === ONRAMP_ASSET) {
    return Math.ceil(dollars) <= ONRAMP_MAX_USD ? fundChipFor({ needUsd: dollars, actionLabel: `buy ${what}`, resume, completes: true }) : null
  }
  return planFitsOneCheckout(facts.needUsd) ? fundChipFor({ needUsd: facts.needUsd, actionLabel: `buy ${what} on ${ask.chainName}`, resume }) : null
}

/**
 * The whole answer to a buy the wallet can't fund: plain copy (the empty
 * wallet gets its own sentence), the funding layer's refusal kept intact
 * wherever there is money to name, and the card chip when the door is open.
 */
export function swapShortfallTurn(params: { ask: SwapShortfallAsk; refusal: { insufficient: string } & FundingRefusalFacts }): SwapShortfallTurn {
  const { ask, refusal } = params
  const sell = ask.sellToken.toUpperCase()
  const buy = ask.buyToken.toUpperCase()
  const dollars = buyDollarsOf(ask)
  if (dollars === null) {
    return {
      reply: `🔄 The swap sells ${ask.sellAmountHuman} ${sell} on ${ask.chainName} and the wallet holds ${ask.heldHuman}. ${refusal.insufficient}`,
      buildPath: 'native-swap-short',
    }
  }

  const what = ask.sellAmountUsd ? `$${dollarsWord(dollars)} of ${buy}` : `${buy} with ${ask.sellAmountHuman} ${sell}`
  // Empty means the scan found nothing worth naming AND the spend token (which
  // may be a stable the scan doesn't read, like DAI) isn't on the swap chain
  // either. Only then is "there's no ETH or USDC here yet" true.
  const empty = refusal.empty && !(Number(ask.heldHuman) > 0)
  const chip = swapBuyFundChip(ask, refusal)
  const fund = chip?.fund
  const lane = ONRAMP_NETWORK_LABEL[fund?.network ?? ONRAMP_DEFAULT_NETWORK]

  let door = ''
  if (fund?.completes) {
    // The lane is Ethereum even when the swap chain is Base (#716: Stripe
    // walled ETH-on-Base at a US home address, after KYC). Said before the
    // user pays, never discovered in the wallet afterwards.
    const elsewhere = ask.chainName !== lane ? ` (card funding can't deliver ETH to ${ask.chainName} for every address)` : ''
    const floor = fund.presetFiatUsd > Math.ceil(dollars)
      ? ` Card checkouts here start at $${fund.presetFiatUsd}, so it opens there — you can change the amount before you pay.`
      : ''
    door = empty
      ? ` You can buy it with a card or bank below. It lands in this wallet as ETH on ${lane}${elsewhere}, and that's the whole buy — nothing to swap afterward.${floor}`
      : ` Or buy the ETH with a card or bank below — it lands in this wallet as ETH on ${lane}${elsewhere}, and that's the whole buy.${floor}`
  } else if (fund) {
    const next = ask.chainName === lane ? `the ${buy} buy` : `the move to ${ask.chainName} and the ${buy} buy`
    door = empty
      ? ` You can add it with a card or bank below: it lands as ETH on ${lane}, which also pays the gas, and once it's there I'll lay out ${next} for you to sign. The checkout opens at $${fund.presetFiatUsd}, a little over the buy, so the card fee, the gas and the conversion don't leave you short.`
      : ` Or add it with a card or bank below — it lands as ETH on ${lane}, and once it's there I'll lay out ${next} for you to sign.`
  } else if (empty) {
    door = ' Send ETH or USDC to this wallet on any of those chains, then ask again — nothing was built.'
  }

  const reply = empty
    ? `🔄 To buy ${what}, this wallet needs money in it first — I checked ${refusal.chainsRead} and there's no ETH or USDC here yet.${door}`
    : `🔄 This buy spends ${ask.sellAmountHuman} ${sell} on ${ask.chainName} and the wallet holds ${ask.heldHuman} there. ${refusal.insufficient}${door}`

  return {
    reply,
    ...(chip
      ? {
          clarify: {
            question: fund?.completes ? 'Buy the ETH with a card or bank?' : 'Add the funds and run it?',
            options: [chip, { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }],
          },
        }
      : {}),
    buildPath: 'native-swap-short',
  }
}
