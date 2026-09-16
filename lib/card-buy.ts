// lib/card-buy.ts — the answer to a buy the user asked to pay for WITH A CARD.
//
// Born 2026-09-16 (Nate, on /t/AAPL's route table: "should we add a buy with
// Card option here as well?"). The parse already knew the phrase —
// lib/swap-intent strips "with my credit card" / "by card" and flags
// `viaCard` — but nothing read the flag, so "buy $50 of AAPL with a card"
// built from whatever the wallet held, or offered LiFi chips off its Base
// USDC: a payment method the user had just said they didn't want.
//
// PURE. The card door is the empty wallet's door, reached on purpose: the
// preset is sized as if the card is the only money (no scan, no RPC), with
// the SAME chip builders the refusals use, so a "Buy with card" tap and an
// empty wallet's "Buy" tap open the same checkout for the same ask:
//
//   • a Robinhood Chain stock — the rhFundChip parameters an empty wallet
//     gets (robinhoodBuyNeedUsd with nothing held and the gas leg in), resume
//     "Buy $X of SYM": the landed ETH rides the LiFi funding plan onto 4663;
//   • ETH — swapBuyFundChip's completing chip: the delivery IS the buy;
//   • any other coin — swapBuyFundChip over the facts decideFundingTurn
//     hands an empty wallet (the plan at FUNDING_MARGIN_BPS plus the
//     destination gas leg), resume "Buy $X of SYM on <chain>".
//
// The door can be closed (lib/onramp fails closed) or too small (one checkout
// caps at ONRAMP_MAX_USD). Either way the answer says so and offers the same
// buy from the wallet instead — a card ask never builds silently from money
// the user didn't choose, and never dead-ends.

import type { ClarifyOption, ClarifyRequest } from '@/lib/clarify'
import { fundingPlanUsd, destGasLegUsd, type FundingRefusalFacts } from '@/lib/funding-plan'
import { robinhoodBuyNeedUsd } from '@/lib/lifi-bridge'
import {
  fundChipFor,
  onrampEnabled,
  ONRAMP_ASSET,
  ONRAMP_DEFAULT_NETWORK,
  ONRAMP_ETH_PRICE_CEILING_USD,
  ONRAMP_MAX_USD,
  ONRAMP_NETWORK_LABEL,
  planFitsOneCheckout,
} from '@/lib/onramp'
import { swapBuyFundChip, type SwapShortfallAsk } from '@/lib/swap-shortfall'

export type CardBuyAsk =
  /** A tokenized stock on Robinhood Chain ("Buy $50 of AAPL with a card"). */
  | { kind: 'stock'; sym: string; buyUsd: number }
  /** A coin bought with dollars on a funding-scan chain ("Buy $50 of UNI on Ethereum with a card"). */
  | { kind: 'coin'; sym: string; buyUsd: number; chainId: number; chainName: string; chainWord: string }

export interface CardBuyTurn {
  reply: string
  clarify?: ClarifyRequest
  buildPath: 'native-card-buy'
}

/** "$50" stays whole; "$12.50" keeps its cents. */
export const usdWord = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

/** The ask restated without the card clause — "from the wallet instead". */
export function walletBuyResume(ask: CardBuyAsk): string {
  return ask.kind === 'stock' ? `Buy ${usdWord(ask.buyUsd)} of ${ask.sym}` : `Buy ${usdWord(ask.buyUsd)} of ${ask.sym} on ${ask.chainWord}`
}

/** The ask restated WITH the card clause, at another size. */
export function cardBuyResume(ask: CardBuyAsk, buyUsd: number = ask.buyUsd): string {
  return ask.kind === 'stock' ? `Buy ${usdWord(buyUsd)} of ${ask.sym} with a card` : `Buy ${usdWord(buyUsd)} of ${ask.sym} on ${ask.chainWord} with a card`
}

/** The swap layer's view of a coin ask, as the empty-wallet refusal saw it
 *  (the spend side is the chain stable, nothing held). */
function coinShortfallAsk(ask: Extract<CardBuyAsk, { kind: 'coin' }>): SwapShortfallAsk {
  return {
    chainName: ask.chainName,
    chainWord: ask.chainWord,
    sellToken: 'USDC',
    buyToken: ask.sym,
    sellAmountHuman: ask.buyUsd.toFixed(2),
    sellAmountUsd: String(ask.buyUsd),
    sellIsStable: true,
    heldHuman: '0',
  }
}

/** The dollars an EMPTY wallet's plan moves for this ask — what the card has
 *  to fund. A stock: robinhoodBuyNeedUsd with nothing on 4663 and no gas
 *  there. A coin: the facts decideFundingTurn reports for an empty scan,
 *  needUsd = fundingPlanUsd(the stable spend) + the destination gas leg
 *  (priced at the on-ramp's own ETH ceiling when the price is unknown, so
 *  an unpriced read over-provisions rather than lands short). An ETH buy
 *  is its own dollars: the delivery IS the buy. */
export function cardBuyNeedUsd(ask: CardBuyAsk, ethUsd: number | null): number {
  if (ask.kind === 'stock') return robinhoodBuyNeedUsd(ask.buyUsd, 0, true)
  if (ask.sym.toUpperCase() === ONRAMP_ASSET) return ask.buyUsd
  const gasUsd = destGasLegUsd(ask.chainId, 0, ethUsd && ethUsd > 0 ? ethUsd : ONRAMP_ETH_PRICE_CEILING_USD)
  return Number((fundingPlanUsd(ask.buyUsd, 1) + gasUsd).toFixed(2))
}

/** The card chip, or null when the door is closed or one checkout can't
 *  carry the plan. */
export function cardBuyChip(ask: CardBuyAsk, ethUsd: number | null): ClarifyOption | null {
  const needUsd = cardBuyNeedUsd(ask, ethUsd)
  if (ask.kind === 'stock') {
    // Exactly the rhFundChip an empty wallet gets for this buy — but a stock
    // plan past one checkout would land short and the resume would downsize,
    // so a card ask refuses by name instead of capping.
    if (!planFitsOneCheckout(needUsd)) return null
    return fundChipFor({ needUsd, actionLabel: `buy ${usdWord(ask.buyUsd)} of ${ask.sym}`, resume: walletBuyResume(ask) })
  }
  const facts: FundingRefusalFacts = { needUsd, gasUsd: 0, chainsRead: '', empty: true, strandedCovers: false }
  return swapBuyFundChip(coinShortfallAsk(ask), facts)
}

/** The largest round size one checkout can carry for this ask, or null. */
export function largestCardBuyUsd(ask: CardBuyAsk, ethUsd: number | null): number | null {
  for (const usd of [400, 300, 250, 200, 150, 100, 50, 25]) {
    if (usd >= ask.buyUsd) continue
    const smaller = { ...ask, buyUsd: usd }
    const need = cardBuyNeedUsd(smaller, ethUsd)
    const fits = smaller.kind === 'coin' && smaller.sym.toUpperCase() === ONRAMP_ASSET ? Math.ceil(need) <= ONRAMP_MAX_USD : planFitsOneCheckout(need)
    if (fits) return usd
  }
  return null
}

const NOT_NOW: ClarifyOption = { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }

/** The whole answer to a card buy: the chip and what happens after the
 *  checkout, or an honest "can't here" with the wallet path beside it. */
export function cardBuyTurn(ask: CardBuyAsk, ethUsd: number | null): CardBuyTurn {
  const buy = usdWord(ask.buyUsd)
  const chip = cardBuyChip(ask, ethUsd)
  const fromWallet: ClarifyOption = { label: 'Buy from my wallet instead', resume: walletBuyResume(ask) }

  if (!chip) {
    if (!onrampEnabled()) {
      return {
        reply: `💳 Card checkout isn't open here right now, so I can't start one for this buy. I can buy ${buy} of ${ask.sym} from what's already in your wallet instead — if it's on another chain, I'll lay out the move first.`,
        clarify: { question: 'Buy it from your wallet?', options: [fromWallet, NOT_NOW] },
        buildPath: 'native-card-buy',
      }
    }
    const smaller = largestCardBuyUsd(ask, ethUsd)
    const options: ClarifyOption[] = []
    if (smaller) options.push({ label: `Buy ${usdWord(smaller)} with a card`, resume: cardBuyResume(ask, smaller) })
    options.push(fromWallet, NOT_NOW)
    return {
      reply: `💳 One card checkout here tops out at $${ONRAMP_MAX_USD}, and a ${buy} buy of ${ask.sym} needs more than that once the fees and gas are in.${smaller ? ` ${usdWord(smaller)} fits in one checkout.` : ''} Or buy it from what's already in your wallet.`,
      clarify: { question: smaller ? 'A smaller card buy?' : 'Buy it from your wallet?', options },
      buildPath: 'native-card-buy',
    }
  }

  const fund = chip.fund!
  const lane = ONRAMP_NETWORK_LABEL[fund.network ?? ONRAMP_DEFAULT_NETWORK]
  const checkout = `The checkout opens at $${fund.presetFiatUsd}`

  if (fund.completes) {
    const coin = ask as Extract<CardBuyAsk, { kind: 'coin' }>
    const where = coin.chainName !== lane ? `${lane}, not ${coin.chainName} (card funding can't deliver ETH to ${coin.chainName} for every address)` : lane
    const floor = fund.presetFiatUsd > Math.ceil(ask.buyUsd) ? ` Card checkouts here start at $${fund.presetFiatUsd}, so it opens there — you can change the amount before you pay.` : ''
    return {
      reply: `💳 **Buy ${buy} of ETH with a card.** It lands in this wallet as ETH on ${where}, and that's the whole buy — nothing to swap afterward.${floor}`,
      clarify: { question: 'Buy the ETH with a card or bank?', options: [chip, NOT_NOW] },
      buildPath: 'native-card-buy',
    }
  }

  const next =
    ask.kind === 'stock'
      ? `the move to Robinhood Chain and the ${ask.sym} buy`
      : ask.chainName === lane
        ? `the ${ask.sym} buy`
        : `the move to ${ask.chainName} and the ${ask.sym} buy`
  return {
    reply:
      `💳 **Buy ${buy} of ${ask.sym} with a card.** Stripe's checkout delivers ETH to this wallet on ${lane} (ETH pays its own gas, so nothing lands stuck), and once it's there I'll lay out ${next} for you to sign. ` +
      `${checkout}, a little over the buy so the card fee, the gas and the conversion don't leave you short, and you can change it before you pay. Whatever's left over stays in your wallet.`,
    clarify: { question: 'Pay with a card or bank?', options: [chip, fromWallet, NOT_NOW] },
    buildPath: 'native-card-buy',
  }
}
