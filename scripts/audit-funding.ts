#!/usr/bin/env tsx
/**
 * Funding scenario audit — fabricated wallet states × real shortfalls,
 * replayed through the REAL funding pipeline (classifyFundingBalances →
 * decideFundingTurn), completely costless: no RPC, no signing, no live
 * wallet needed. Born from the 2026-07-23 HYPE house-link wall: a stranger
 * holding $20 of USDC on Base (no gas) was told "I found no movable ETH or
 * USDC" four times in five minutes — a wallet state we could only test once
 * reality handed us a wallet in it. Now any state is a table row.
 *
 * Invariants per scenario:
 *   1. The outcome CLASS matches the row (offer / refusal / fallthrough).
 *      A behavior change that flips a class fails here until the row is
 *      consciously updated — the flip is the review artifact.
 *   2. offer ⇒ every chip resume replays through the shared ask ladder
 *      (scripts/ask-ladder.ts) as an ACTION — a chip that dead-ends is a
 *      broken contract.
 *   3. refusal ⇒ every holding worth ≥ $0.50 in the snapshot is NAMED in
 *      the copy (money the user owns must never be invisible), and the
 *      copy never claims "found no movable" while money exists.
 *      `knownUnnamed` documents accepted gaps (warn, don't fail) — and a
 *      knownUnnamed entry that is no longer missing FAILS, so a fix must
 *      promote the row to strict in the same PR.
 *   4. card ⇒ a BUY the wallet can't fund answers through the swap layer's
 *      composer (lib/swap-shortfall) with the on-ramp OPEN, and the card chip
 *      matches the row: 'completes' (a buy of the ETH the on-ramp delivers —
 *      preset = the asked dollars, nothing fires on arrival), 'cascade' (any
 *      other buy — the resume replays as an action AND the landing state, the
 *      preset arriving as ETH on the on-ramp lane at $2k–$5k/ETH, plans chips
 *      that compile), or 'none'. The reply still names every holding.
 *   5. layerCard ⇒ a NATIVE LAYER's action the wallet can't fund (the HL open
 *      and deposit, the Aave supply and repay, the Morpho lend, the Lido stake,
 *      the NFT buy) answers through lib/layer-shortfall with the on-ramp OPEN,
 *      and the chip matches the row:
 *      - 'plan': the landed ETH moves or converts first. The resume replays as
 *        an action, and at every price from $2k to $5k/ETH (the chip minted and
 *        the ETH delivered at that price) the landed wallet re-plans into chips
 *        that compile as jobs. The HL open compiles its first chip outright.
 *      - 'direct': the delivery IS the ETH the action spends. At every price,
 *        after a 5% adverse move, the landing still covers the need, so the
 *        resume builds the action itself.
 *      - 'none'.
 *      The reply still names every holding, and an empty wallet reads plainly.
 *   6. round trip ⇒ when the need names the token its follow-up BUYS
 *      (FundingNeed.buyToken), no chip converts that token into anything
 *      else. "Buy $50 of ETH" once planned ETH → USDC → ETH (2026-09-16).
 *      Moving the token to itself on another chain is not a round trip.
 *   7. apps ⇒ a chip that lands on the cross-chain gate on its own (not a
 *      job) composes NEAR Intents into its apps (lib/ask-apps). The ladder
 *      above assumes every free dapp is on, but the default chat set has no
 *      NEAR Intents; the chip send is what turns it on.
 *
 *   npm run audit:funding           # report + nonzero exit on findings
 *   npm run audit:funding -- -v     # also print every outcome row
 */
import { askAppSlugs } from '../lib/ask-apps'
import {
  classifyFundingBalances,
  decideFundingTurn,
  DEST_GAS_FLOOR_ETH,
  FUNDING_CHAIN_WORD,
  fundingPlanUsd,
  type FundingBalanceRead,
  type FundingNeed,
} from '../lib/funding-plan'
import { deliveryFundUsd, ONRAMP_DEFAULT_NETWORK, ONRAMP_ETH_PRICE_CEILING_USD, ONRAMP_MAX_USD, ONRAMP_SETTLE_SLACK_USD, planFundUsd } from '../lib/onramp'
import { buyDollarsOf, swapShortfallTurn, type SwapShortfallAsk } from '../lib/swap-shortfall'
import { laneGasFloorPresetUsd, layerCardKind, layerPlanUsd, layerShortfallTurn, LAYER_SHORTFALL, ONRAMP_LANE_CHAIN_ID, type LayerShortfallAsk } from '../lib/layer-shortfall'
import { compileJobAsk } from '../lib/jobs'
import { simulateLadder } from './ask-ladder'

// The card door reads the environment (lib/onramp fails closed without both).
// The audit is about what an OPEN door offers, so it opens one — no request
// is ever made, and the key is never a real one.
process.env.ONRAMP_ENABLED = 'true'
if (!process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = 'sk_test_audit_funding'

const verbose = process.argv.includes('-v')
let findings = 0
const flag = (msg: string) => {
  findings++
  console.log(`  ❌ ${msg}`)
}

/** Deterministic price — scenarios are about SHAPES, not market levels. */
const ETH_USD = 2000
/** Mirror of lib/funding-plan's per-chain floors the copy/coverage math
 *  keys off (the decision logic itself lives in the imported functions). */
const GAS_RESERVE_ETH: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002, 10: 0.0002 }
const DUST_USD = 0.5
const MIN_GAS_LEG_USD = 1.5

const R = (chainId: number, nativeEth: number, usdcBal: number): FundingBalanceRead => ({
  chainId,
  chainWord: FUNDING_CHAIN_WORD[chainId],
  nativeEth,
  usdcBal,
})

/** Mirror of offerFundingPlan's I/O shell: destination gas need from the
 *  fabricated reads (the shell reads it over RPC; same floors, same sizing). */
function gasUsdFor(need: FundingNeed, reads: FundingBalanceRead[], ethUsd = ETH_USD): number {
  if (need.token.toUpperCase() === 'ETH') return 0
  const dest = reads.find((r) => r.chainId === need.chainId)
  const floor = DEST_GAS_FLOOR_ETH[need.chainId] ?? 0.0002
  const shortEth = Math.max(0, floor - (dest?.nativeEth ?? 0))
  return shortEth > 0 ? Math.max(MIN_GAS_LEG_USD, Math.ceil(shortEth * ethUsd * 1.15 * 2) / 2) : 0
}

const tokenUsdOf = (token: string) => (token.toUpperCase() === 'ETH' ? ETH_USD : 1)

// ── The needs — one per native layer that rides the generic funding path ──
const HL_NEED: FundingNeed = { chainId: 42161, token: 'USDC', amountHuman: 5, followupResume: '', actionLabel: 'the Hyperliquid position' }
const LIDO_NEED: FundingNeed = { chainId: 1, token: 'ETH', amountHuman: 0.002, followupResume: 'stake 0.002 ETH on Lido', actionLabel: 'the stake' }
// The swap gate's GAS-ONLY probe (squad 2026-08-18, the #1 predicted
// stranger failure): the sell token is covered on the swap chain, ETH for
// the approve+swap is not. amountHuman 0 = "token covered, check gas".
const SWAP_GAS_NEED: FundingNeed = { chainId: 8453, token: 'USDC', amountHuman: 0, followupResume: 'swap 20 USDC for ETH on base', actionLabel: 'the swap' }
// The swap gate's pre-read on a short swap: "Buy $50 of ETH" spends the chain
// stable, and buyToken names what the swap gets you — a holding of it never
// funds the swap (invariant 6). A sell spends the token and buys the stable.
const swapNeed = (sell: string, amount: number, buy: string, chainId = 8453): FundingNeed => ({
  chainId,
  token: sell,
  amountHuman: amount,
  followupResume: `swap ${amount} ${sell} for ${buy} on ${FUNDING_CHAIN_WORD[chainId]}`,
  actionLabel: sell.toUpperCase() === 'USDC' ? 'the buy' : 'the swap',
  buyToken: buy,
})
/** Legs of a chip resume that convert the token the follow-up BUYS into
 *  something else (invariant 6). Symbols match exactly, as they do in
 *  lib/funding-plan (a WETH buy may still spend ETH). */
function roundTripLegs(need: FundingNeed, resume: string): string[] {
  if (!need.buyToken) return []
  const buy = need.buyToken.toUpperCase()
  return resume.split(', then ').filter((leg) => {
    const m = leg.match(/^swap\s+[\d.]+\s+([a-z]+)\b.*?\b(?:for|to)\s+([a-z]+)\s+on\b/i)
    return !!m && m[1].toUpperCase() === buy && m[2].toUpperCase() !== buy
  })
}
const NFT_NEED: FundingNeed = {
  chainId: 8453,
  token: 'ETH',
  amountHuman: 0.0062,
  followupResume: 'buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198',
  actionLabel: 'the buy',
}

// ── A BUY on the swap layer: spend a stable, receive a token. The swap gate's
// pre-read hands exactly this need to the funding layer (actionLabel 'the
// buy' for a stable spend), and lib/swap-shortfall answers its refusal.
const buyNeed = (chainId: number, usdc: number, buy: string): FundingNeed => ({
  chainId,
  token: 'USDC',
  amountHuman: usdc,
  followupResume: `swap ${usdc} USDC for ${buy.toUpperCase()} on ${FUNDING_CHAIN_WORD[chainId]}`,
  actionLabel: 'the buy',
  buyToken: buy.toUpperCase(),
})
/** The ask as the swap layer resolved it. `dollarAsk` false = a token-amount
 *  spend ("Swap 50 USDC for UNI on Ethereum"). */
const buyAsk = (chainId: number, usdc: number, buy: string, dollarAsk = true): SwapShortfallAsk => ({
  chainName: FUNDING_CHAIN_WORD[chainId],
  chainWord: FUNDING_CHAIN_WORD[chainId],
  sellToken: 'USDC',
  buyToken: buy,
  sellAmountHuman: String(usdc),
  ...(dollarAsk ? { sellAmountUsd: String(usdc) } : {}),
  sellIsStable: true,
  heldHuman: '0',
})
/** A fresh embedded wallet: nothing on any scanned chain. */
const EMPTY = [R(8453, 0, 0), R(42161, 0, 0), R(10, 0, 0), R(1, 0, 0)]

// ── The native layers' funding needs, exactly as the route hands them to the
// funding layer, and the card ask each one restates (lib/layer-shortfall).
/** The prod ask that walled three times (strangers 08-27, test account 09-04). */
const HL_LONG_ASK = 'I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop'
const hlOpenNeed = (depositUsdc: number, message: string): FundingNeed => ({
  chainId: 42161,
  token: 'USDC',
  amountHuman: depositUsdc,
  followupResume: `deposit ${depositUsdc} USDC to Hyperliquid, then ${message}`,
  actionLabel: 'the Hyperliquid position',
})
const hlOpenAsk = (depositUsdc: number, message: string, what: string, extra: Partial<LayerShortfallAsk> = {}): LayerShortfallAsk => ({
  layer: 'hl-open',
  what,
  resume: message,
  chainId: 42161,
  token: 'USDC',
  lead: `🚫 The position needs about $${depositUsdc} of USDC reaching Hyperliquid and the wallet can't cover it yet.`,
  needLine: `The position needs about $${depositUsdc} of USDC on Hyperliquid as collateral.`,
  ...extra,
})
const hlDepositNeed = (amount: number, heldArb: number): FundingNeed => ({
  chainId: 42161,
  token: 'USDC',
  amountHuman: Number((amount - heldArb).toFixed(2)),
  followupResume: `deposit ${amount} USDC to Hyperliquid`,
  actionLabel: 'the Hyperliquid deposit',
})
const hlDepositAsk = (amount: number, heldArb: number): LayerShortfallAsk => ({
  layer: 'hl-deposit',
  what: `deposit ${amount} USDC to Hyperliquid`,
  resume: `Deposit ${amount} USDC to Hyperliquid`,
  chainId: 42161,
  token: 'USDC',
  lead: `🚫 The deposit needs ${amount} USDC on Arbitrum and the wallet holds ${heldArb.toFixed(2)} there.`,
})
const aaveSupplyNeed = (amount: number, token: string, bestRate = false): FundingNeed => ({
  chainId: 1,
  token,
  amountHuman: amount,
  followupResume: `supply ${amount} ${token} to Aave${bestRate ? ' at the best rate' : ''}`,
  actionLabel: 'the Aave supply',
})
const aaveSupplyAsk = (amount: number, token: string, bestRate = false, extra: Partial<LayerShortfallAsk> = {}): LayerShortfallAsk => ({
  layer: 'aave-supply',
  what: `supply ${amount} ${token} to Aave${bestRate ? ' at the best rate' : ''}`,
  resume: `Supply ${amount} ${token} to Aave${bestRate ? ' at the best rate' : ''}`,
  chainId: 1,
  token,
  lead: `🏦 The Aave supply needs ${amount} ${token} on Ethereum and the wallet holds 0.`,
  ...extra,
})
const morphoLendNeed = (amount: number, chainId: 1 | 8453): FundingNeed => ({
  chainId,
  token: 'USDC',
  amountHuman: amount,
  followupResume: `lend ${amount} USDC on morpho${chainId === 1 ? ' on ethereum' : ''}`,
  actionLabel: 'the Morpho lend',
})
const morphoLendAsk = (amount: number, chainId: 1 | 8453): LayerShortfallAsk => ({
  layer: 'morpho-lend',
  what: `lend ${amount} USDC on Morpho on ${FUNDING_CHAIN_WORD[chainId]}`,
  resume: `Lend ${amount} USDC on Morpho on ${FUNDING_CHAIN_WORD[chainId]}`,
  chainId,
  token: 'USDC',
  lead: `🏦 The Morpho lend needs ${amount} USDC on ${FUNDING_CHAIN_WORD[chainId]} and the wallet holds 0.`,
})
/** Mirror of the route's lidoFundingTurn sizing: the ask floored at the
 *  economical minimum, plus the gas buffer, minus mainnet ETH already held. */
const LIDO_MIN_STAKE_ETH = 0.003
const LIDO_BUFFER_ETH = 0.002
const lidoNeed = (askEth: number | null, heldEth = 0): FundingNeed => ({
  chainId: 1,
  token: 'ETH',
  amountHuman: Number((Math.max(askEth ?? 0, LIDO_MIN_STAKE_ETH) + LIDO_BUFFER_ETH - heldEth).toFixed(6)),
  followupResume: 'stake all my ETH on Lido',
  actionLabel: 'the stake',
  flexMinAmountHuman: Math.max(0, Number((LIDO_MIN_STAKE_ETH + LIDO_BUFFER_ETH - heldEth).toFixed(6))),
})
const lidoAsk = (askEth: number | null): LayerShortfallAsk => {
  const target = Number((Math.max(askEth ?? 0, LIDO_MIN_STAKE_ETH) + LIDO_BUFFER_ETH).toFixed(6))
  const needs = askEth !== null ? `Staking ${askEth} ETH really needs ~${target} ETH on Ethereum once mainnet gas is counted` : `Staking on Lido needs at least ~${target} ETH on Ethereum once mainnet gas is counted`
  return {
    layer: 'lido-stake',
    what: askEth !== null ? `stake ${askEth} ETH on Lido` : 'stake ETH on Lido',
    resume: askEth !== null ? `Stake ${askEth} ETH on Lido` : 'Stake all my ETH on Lido',
    chainId: 1,
    token: 'ETH',
    lead: `🌊 ${needs}, and the wallet holds 0 ETH on Ethereum.`,
    needLine: `${needs}.`,
  }
}
const NFT_ITEM = (slug: string) => `https://opensea.io/item/${slug}/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198`
/** The NFT buy's need: the listing plus the destination gas floor. */
const nftNeed = (chainId: number, listedEth: number): FundingNeed => ({
  chainId,
  token: 'ETH',
  amountHuman: Number((listedEth + (DEST_GAS_FLOOR_ETH[chainId] ?? 0.0002)).toFixed(6)),
  followupResume: `buy the nft ${NFT_ITEM(chainId === 1 ? 'ethereum' : 'base')}`,
  actionLabel: 'the buy',
})
const nftAsk = (chainId: number, listedEth: number): LayerShortfallAsk => ({
  layer: 'nft-buy',
  what: 'buy Freek #198',
  resume: `buy the nft ${NFT_ITEM(chainId === 1 ? 'ethereum' : 'base')}`,
  chainId,
  token: 'ETH',
  lead: `🖼️ Buying needs ${listedEth} ETH but the wallet holds 0 ETH on ${FUNDING_CHAIN_WORD[chainId]} (plus gas).`,
  needLine: `Freek #198 is listed at ${listedEth} ETH on ${FUNDING_CHAIN_WORD[chainId]}, plus gas.`,
})

interface Scenario {
  name: string
  need: FundingNeed
  reads: FundingBalanceRead[]
  /** Chain words whose scan "failed" (unknown, never empty). */
  failed?: string[]
  expect: 'offer' | 'refusal' | 'fallthrough'
  /** The swap layer's card door on this refusal (invariant 4). */
  card?: { ask: SwapShortfallAsk; expect: 'completes' | 'cascade' | 'none' }
  /** A native layer's card door on this refusal (invariant 5). */
  layerCard?: { ask: LayerShortfallAsk; expect: 'plan' | 'direct' | 'none' }
  /** Expected copy mentions that are KNOWN missing today — documented gaps.
   *  Warn instead of fail; a no-longer-missing entry fails (stale). */
  knownUnnamed?: string[]
  /** Aspirational notes — printed, never enforced. */
  gaps?: string[]
}

const SCENARIOS: Scenario[] = [
  {
    name: 'THE PREDICTED STRANGER WALL — $25 USDC on Base, ZERO ETH anywhere → swap USDC→ETH on Base (gas-only probe): honest refusal naming the stranded USDC',
    need: SWAP_GAS_NEED,
    reads: [R(8453, 0, 25), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: '$25 USDC on Base, no Base gas, $3 ETH on Arbitrum → swap on Base (gas-only probe): a gas leg from the donor chain, chips compile',
    need: SWAP_GAS_NEED,
    reads: [R(8453, 0, 25), R(42161, 0.0015, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  // ── Optimism as a funding origin (2026-09-04) ─────────────────────────
  // OP joined FUNDING_SCAN_CHAINS because 1Click lists native ETH + USDC
  // there and the near-intents MCP already builds deposits on it. These
  // pin the three shapes a stranger whose money lives on Optimism hits.
  {
    name: 'THE OPTIMISM STRANGER — $20 USDC + gas on Optimism, nothing else → swap on Base: chips compile from OP',
    need: SWAP_GAS_NEED,
    reads: [R(10, 0.001, 20), R(8453, 0, 0), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'gas-stranded Optimism — $20 USDC on Optimism, ZERO OP gas → HL deposit: refusal must NAME the OP dollars',
    need: HL_NEED,
    reads: [R(10, 0, 20), R(8453, 0, 0), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'Optimism as donor — $20 gasless USDC on Base + $3 ETH on Optimism → HL deposit: donor rescue crosses from OP',
    need: HL_NEED,
    reads: [R(10, 0.0015, 0), R(8453, 0, 20), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'empty wallet → HL deposit',
    need: HL_NEED,
    reads: [R(8453, 0, 0), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'THE LIVE WALL — $20 USDC on Base, zero gas anywhere → HL deposit (2026-07-23)',
    need: HL_NEED,
    reads: [R(8453, 0, 20), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: "$2 of ETH on mainnet + gasless $20 USDC on Base → HL deposit (Nate's probe)",
    need: HL_NEED,
    reads: [R(1, 0.001, 0), R(8453, 0, 20), R(42161, 0, 0)],
    // The $2 sits under mainnet's keep-back — it can't donate (moving it
    // costs more than it's worth), so the refusal must NAME both holdings
    // and hand over the manual rescue.
    expect: 'refusal',
  },
  {
    name: '$2 of ETH on Arbitrum + gasless $20 USDC on Base → HL deposit (donor rescue)',
    need: HL_NEED,
    reads: [R(42161, 0.001, 0), R(8453, 0, 20), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    // The movable Base ETH ($9.6) covers the whole plan by itself, so the
    // NORMAL chips win and the mainnet USDC stays parked — cheaper than
    // burning ~$6 of L1 gas to unstick it. The rescue is a last resort.
    name: 'mainnet-stranded $20 USDC + rich Base donor → HL deposit (movable ETH funds it directly)',
    need: HL_NEED,
    reads: [R(1, 0, 20), R(8453, 0.005, 0), R(42161, 0, 0)],
    expect: 'offer',
  },
  {
    // Donor covers mainnet's ~$6 gas leg but NOT the whole ~$8 plan — the
    // rescue is the only path, and it must price L1 gas honestly.
    name: 'mainnet-stranded $20 USDC + $7 Base donor → HL deposit (true L1 unstick)',
    need: HL_NEED,
    reads: [R(1, 0, 20), R(8453, 0.0037, 0), R(42161, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'mainnet-stranded $20 USDC + $2 Arbitrum donor → HL deposit (donor too poor for L1 gas)',
    need: HL_NEED,
    reads: [R(1, 0, 20), R(42161, 0.001, 0), R(8453, 0, 0)],
    expect: 'refusal',
  },
  {
    name: '$20 USDC + gas on Base → HL deposit (the healthy path)',
    need: HL_NEED,
    reads: [R(8453, 0.001, 20), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'destination-stranded — $20 USDC on Arbitrum, no Arbitrum gas → HL deposit',
    need: HL_NEED,
    reads: [R(42161, 0, 20), R(8453, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'combined origins — $4+gas on Base, $4+gas on Ethereum → HL deposit',
    need: HL_NEED,
    reads: [R(8453, 0.001, 4), R(1, 0.0015, 4), R(42161, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'whale — $5,000 USDC + gas on Base → HL deposit',
    need: HL_NEED,
    reads: [R(8453, 0.01, 5000), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'partial scan — Ethereum unreadable, gasless USDC on Base → HL deposit',
    need: HL_NEED,
    reads: [R(8453, 0, 20), R(42161, 0, 0)],
    failed: ['Ethereum'],
    expect: 'fallthrough',
  },
  {
    name: 'movable ETH on Base → Lido stake on mainnet',
    need: LIDO_NEED,
    reads: [R(8453, 0.003, 0), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    // THE 2026-07-23 LIVE WALL: "Stake 0.05 ETH with Lido" holding 0.0149
    // ETH on mainnet + ~$12 movable on Base — the full ~$83 plan refused,
    // but "stake all my ETH" sizes itself to the arrival, so the flexible
    // need moves what the wallet CAN fund instead of walling.
    name: 'flexible follow-up — big stake ask, small movable wallet → downsized move (the Lido wall)',
    need: { chainId: 1, token: 'ETH', amountHuman: 0.0371, followupResume: 'stake all my ETH on Lido', actionLabel: 'the stake', flexMinAmountHuman: 0 },
    reads: [R(1, 0.0149, 0), R(8453, 0.004, 5), R(42161, 0, 0)],
    expect: 'offer',
  },
  {
    // The flexible floor still holds: when even the smallest useful move
    // can't be funded, the honest refusal stands (no dust-sized stakes).
    name: 'flexible follow-up — capacity under the useful floor → refusal',
    need: { chainId: 1, token: 'ETH', amountHuman: 0.0371, followupResume: 'stake all my ETH on Lido', actionLabel: 'the stake', flexMinAmountHuman: 0.01 },
    reads: [R(1, 0, 0), R(8453, 0.001, 3), R(42161, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'same-chain conversion — $20 USDC + gas on Base → NFT buy on Base',
    need: NFT_NEED,
    reads: [R(8453, 0.001, 20), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'empty wallet → NFT buy on Base',
    need: NFT_NEED,
    reads: [R(8453, 0, 0), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  // ── The round trip (2026-09-16). "Buy $50 of ETH" from a wallet whose only
  // money was ETH planned "Swap 0.02825 ETH for USDC on Base, then swap 50
  // USDC for ETH on Base": two conversions, two fees, the same ETH at the end.
  // A holding of the token a swap BUYS never funds it (invariant 6).
  {
    name: 'THE ROUND TRIP — 0.05 ETH on Base only → "Buy $50 of ETH" on Base: nothing else to spend, so the refusal names the ETH as what the swap gets you',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0.05, 0), R(42161, 0, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'THE ROUND TRIP, one chain over — 0.05 ETH on Arbitrum only → "Buy $50 of ETH" on Base: ONE move of that ETH to Base, no USDC leg, no follow-up swap',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0, 0), R(42161, 0.05, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'ETH on Base AND Arbitrum, nothing else → "Buy $50 of ETH" on Base: the Arbitrum ETH moves, the Base ETH is named',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0.01, 0), R(42161, 0.05, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: '$20 of ETH on Optimism + $30 on Ethereum, neither covers alone → "Buy $50 of ETH" on Base: the move combines into a job',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0, 0), R(42161, 0, 0), R(10, 0.0102, 0), R(1, 0.017, 0)],
    expect: 'offer',
  },
  {
    name: '$10 of ETH on Arbitrum only → "Buy $50 of ETH" on Base: too little to carry the buy — the refusal names it, no round trip',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0, 0), R(42161, 0.0052, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'ETH on Base + $60 USDC with gas on Arbitrum → "Buy $50 of ETH" on Base: the plan spends the USDC, never the ETH',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0.05, 0), R(42161, 0.001, 60), R(10, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'ETH on Base + $20 USDC with gas on Arbitrum → "Buy $50 of ETH" on Base: short on USDC, the ETH named as not counted',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0.05, 0), R(42161, 0.001, 20), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    // Other money exists, so "the only money is ETH" is false and no move is
    // offered; the gasless USDC can't cover the buy, so no rescue either.
    name: 'ETH on Arbitrum + $20 gasless USDC on Optimism → "Buy $50 of ETH" on Base: no move, no round trip, both holdings named',
    need: swapNeed('USDC', 50, 'ETH'),
    reads: [R(8453, 0, 0), R(42161, 0.05, 0), R(10, 0, 20), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    // Symbols match exactly: the scan's ETH is native, and with no wrap builder
    // converting through USDC is the only way to deliver the WETH asked for.
    name: 'ETH on Arbitrum only → "Buy $50 of WETH" on Base: the ETH still funds it (a WETH buy is not an ETH buy)',
    need: swapNeed('USDC', 50, 'WETH'),
    reads: [R(8453, 0, 0), R(42161, 0.05, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    // Why the match is exact: #791's card chip for a WETH buy lands ETH on
    // the on-ramp lane and fires "Buy $50 of WETH" again. Treating that ETH as
    // WETH would refuse the landed money and offer the card a second time.
    name: 'empty → "Buy $50 of WETH" on Base: a card cascade chip whose landed ETH re-plans into chips that compile',
    need: buyNeed(8453, 50, 'WETH'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 50, 'WETH'), expect: 'cascade' },
  },
  {
    name: 'the SELL direction — $60 USDC with gas on Arbitrum → "Sell $50 of ETH" on Base: no USDC → ETH → USDC plan',
    need: swapNeed('ETH', 0.0252, 'USDC'),
    reads: [R(8453, 0, 0), R(42161, 0.001, 60), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    name: 'the SELL direction — $60 gasless USDC on Arbitrum + a $3 ETH donor on Optimism → "Sell $50 of ETH" on Base: no rescue that unsticks the USDC to buy it back',
    need: swapNeed('ETH', 0.0252, 'USDC'),
    reads: [R(8453, 0, 0), R(42161, 0, 60), R(10, 0.0015, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  {
    // The rule is about the token being BOUGHT, nothing wider: ETH still
    // funds a buy of anything else.
    name: 'ETH on Arbitrum only → "Buy $50 of UNI" on Base: ETH still funds a buy of another token',
    need: swapNeed('USDC', 50, 'UNI'),
    reads: [R(8453, 0, 0), R(42161, 0.05, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'offer',
  },
  {
    // THE #590 PATTERN ON THE GENERIC PATH: a gas-included plan runs TWO
    // legs off ONE ETH balance, and leg 1's own fee comes out of the reserve
    // leg 2 spends against. $8.50 movable on mainnet "covers" an $8 plan
    // only by spending the wallet to fee dust — the promise is withdrawn and
    // the copy must explain why money that looks sufficient isn't.
    name: 'ETH row covers the plan only by spending its own leg-1 fee → HL deposit (the two-leg strand)',
    need: HL_NEED,
    reads: [R(1, 0.00625, 0), R(8453, 0, 0), R(42161, 0, 0)],
    expect: 'refusal',
  },
  {
    // One headroom richer and the same wallet funds it — the fix is a
    // sizing haircut, never a blanket "ETH can't fund gas-included plans".
    name: 'ETH row one headroom richer → HL deposit (still funds it)',
    need: HL_NEED,
    reads: [R(1, 0.00725, 0), R(8453, 0, 0), R(42161, 0, 0)],
    expect: 'offer',
  },
  {
    // The all-in chip is where the whole-balance promise used to live: it
    // must now compile at the CAPPED size (the ladder replay proves it).
    name: 'rich mainnet ETH row → HL deposit (all-in chip at the capped size)',
    need: HL_NEED,
    reads: [R(1, 0.017, 0), R(8453, 0, 0), R(42161, 0, 0)],
    expect: 'offer',
  },
  {
    name: 'dust — $0.30 USDC on Base → HL deposit (below naming threshold)',
    need: HL_NEED,
    reads: [R(8453, 0.001, 0.3), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
  // ── The card door on a BUY the wallet can't fund (lib/swap-shortfall). ──
  // THE 2026-09-15 WALL: a stranger from a tweet signed up with Google (a
  // fresh embedded wallet), tapped /t/ETH's "Buy $50 of ETH", then typed "Buy
  // $10 of ETH". Both read "The swap sells 50 USDC on Base and the wallet
  // holds 0 … Top up any of those chains and ask again." with no chip, and
  // they left. The stock buy had offered a card chip in that state since #668.
  {
    name: 'THE TWEET STRANGER (2026-09-15) — empty on every chain → "Buy $50 of ETH" on Base: refusal + a card chip that IS the buy ($50 of ETH, completes on arrival)',
    need: buyNeed(8453, 50, 'ETH'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 50, 'ETH'), expect: 'completes' },
  },
  {
    name: 'the same stranger\'s second ask → "Buy $10 of ETH": the chip opens at the $15 session floor and still completes',
    need: buyNeed(8453, 10, 'ETH'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 10, 'ETH'), expect: 'completes' },
  },
  {
    name: 'empty → "Buy $50 of ETH on Ethereum": the card lane IS the ask\'s chain, completes',
    need: buyNeed(1, 50, 'ETH'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(1, 50, 'ETH'), expect: 'completes' },
  },
  {
    name: 'empty → "Buy $50 of UNI" on Base: the chip carries the ask, and its landing (ETH on Ethereum) funds the move + buy at $2k–$5k/ETH',
    need: buyNeed(8453, 50, 'UNI'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 50, 'UNI'), expect: 'cascade' },
  },
  {
    name: 'empty → "Buy $5 of UNI" on Arbitrum (the smallest buy): the cascade preset still funds its own landing',
    need: buyNeed(42161, 5, 'UNI'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(42161, 5, 'UNI'), expect: 'cascade' },
  },
  {
    name: 'empty → "Swap 50 USDC for UNI on Ethereum" (a token-amount buy): the landed ETH converts right there, no bridge',
    need: buyNeed(1, 50, 'UNI'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(1, 50, 'UNI', false), expect: 'cascade' },
  },
  {
    name: 'empty → "Buy $2000 of UNI" on Base: NO card chip — one $500 checkout can\'t carry it, and the re-run would offer the card again',
    need: buyNeed(8453, 2000, 'UNI'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 2000, 'UNI'), expect: 'none' },
  },
  {
    name: 'empty → "Buy $600 of ETH": NO card chip — past one checkout, a "Buy $500 of ETH" chip would sit under a $600 ask',
    need: buyNeed(8453, 600, 'ETH'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 600, 'ETH'), expect: 'none' },
  },
  {
    name: '$12 USDC + gas on Arbitrum → "Buy $50 of ETH" on Base: the refusal still names both holdings, and the card rides along',
    need: buyNeed(8453, 50, 'ETH'),
    reads: [R(8453, 0, 0), R(42161, 0.001, 12), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
    card: { ask: buyAsk(8453, 50, 'ETH'), expect: 'completes' },
  },
  {
    name: '$60 gasless USDC on Arbitrum → "Buy $50 of ETH" on Base: NO card chip — the money is there and needs a dollar of gas, not a $50 card purchase',
    need: buyNeed(8453, 50, 'ETH'),
    reads: [R(8453, 0, 0), R(42161, 0, 60), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
    card: { ask: buyAsk(8453, 50, 'ETH'), expect: 'none' },
  },
  {
    name: 'empty → "Swap $5 of ETH to USDC" (a SELL): no card chip — buying ETH in order to sell it is not the ask',
    need: { chainId: 8453, token: 'ETH', amountHuman: 0.0027, followupResume: 'swap 0.0025 ETH for USDC on Base', actionLabel: 'the swap' },
    reads: EMPTY,
    expect: 'refusal',
    card: {
      ask: { chainName: 'Base', chainWord: 'Base', sellToken: 'ETH', buyToken: 'USDC', sellAmountHuman: '0.0025', sellAmountUsd: '5', sellIsStable: false, heldHuman: '0' },
      expect: 'none',
    },
  },
  {
    name: 'empty → "Buy $2 of UNI" on Base (the smallest plan the swap layer prices, $5): the preset still funds its own landing at $5,000/ETH (the fixed landing-cost floor; $16 landed $1 short)',
    need: buyNeed(8453, 2, 'UNI'),
    reads: EMPTY,
    expect: 'refusal',
    card: { ask: buyAsk(8453, 2, 'UNI'), expect: 'cascade' },
  },

  // ── The card door on a NATIVE LAYER's action (lib/layer-shortfall). ──
  // Prod ask_failures, 45 days, had_funds=false, every one "found no movable
  // ETH or USDC … Top up any of those chains and ask again." with no chip.
  {
    name: 'THE HL WALL (2026-08-27 ×2, 09-04) — empty → "I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop": a plan chip; the landing compiles the funded job at $2k–$5k/ETH ($21 landed $0.50 short at $5,000)',
    need: hlOpenNeed(6, HL_LONG_ASK),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: hlOpenAsk(6, HL_LONG_ASK, 'go long $12 of HYPE at 2x on Hyperliquid'), expect: 'plan' },
  },
  {
    name: 'empty, but $2 already on Hyperliquid → the same long (the deposit floors at the $5 bridge minimum): NOT the empty wallet\'s copy (the layer read money the scan can\'t see), and the card rides along',
    need: hlOpenNeed(5, HL_LONG_ASK),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: hlOpenAsk(5, HL_LONG_ASK, 'go long $12 of HYPE at 2x on Hyperliquid', { holdsUnscanned: true }), expect: 'plan' },
  },
  {
    name: 'empty → "Deposit 20 USDC to Hyperliquid": a plan chip whose landing funds the move to Arbitrum + the deposit',
    need: hlDepositNeed(20, 0),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: hlDepositAsk(20, 0), expect: 'plan' },
  },
  {
    name: '$3 USDC + gas on Base → "Deposit 20 USDC to Hyperliquid": the refusal still names both holdings, and the card rides along',
    need: hlDepositNeed(20, 0),
    reads: [R(8453, 0.001, 3), R(42161, 0, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
    layerCard: { ask: hlDepositAsk(20, 0), expect: 'plan' },
  },
  {
    name: 'THE AAVE WALL (2026-09-16, an empty CDP account) — "Supply $25 of USDT to Aave at the best rate": a plan chip sized WITHOUT the Ethereum gas leg (the card lane IS Ethereum), and the landing swaps + supplies at $2k–$5k/ETH',
    need: aaveSupplyNeed(25, 'USDT', true),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: aaveSupplyAsk(25, 'USDT', true), expect: 'plan' },
  },
  {
    name: 'empty → "Supply 1 USDC to Aave" (a $2.50 plan): the lane-destination preset floors where its landing still clears Ethereum\'s gas floor at $5,000/ETH',
    need: aaveSupplyNeed(1, 'USDC'),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: aaveSupplyAsk(1, 'USDC'), expect: 'plan' },
  },
  {
    name: '12 USDT held on Ethereum, nothing else → "Supply 25 USDT to Aave": the scan sees no ETH or USDC, but the wallet is NOT empty — the layer\'s own lead stays',
    need: aaveSupplyNeed(13, 'USDT'),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: aaveSupplyAsk(25, 'USDT', false, { lead: '🏦 The Aave supply needs 25 USDT on Ethereum and the wallet holds 12.', holdsUnscanned: true }), expect: 'plan' },
  },
  {
    name: '$40 gasless USDC on Base → "Supply 25 USDT to Aave": NO card chip — the money is there and needs a dollar of gas, not a card purchase',
    need: aaveSupplyNeed(25, 'USDT'),
    reads: [R(8453, 0, 40), R(42161, 0, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
    layerCard: { ask: aaveSupplyAsk(25, 'USDT'), expect: 'none' },
  },
  {
    name: 'empty → "Repay all my USDC debt on Aave" (a $20 debt): a plan chip; the landing swaps + repays on Ethereum',
    need: { chainId: 1, token: 'USDC', amountHuman: 20, followupResume: 'repay all my USDC debt on aave', actionLabel: 'the Aave repayment' },
    reads: EMPTY,
    expect: 'refusal',
    layerCard: {
      ask: { layer: 'aave-repay', what: 'repay your USDC debt on Aave', resume: 'Repay all my USDC debt on Aave', chainId: 1, token: 'USDC', lead: '🏦 The Aave repayment needs 20 USDC on Ethereum and the wallet holds 0.' },
      expect: 'plan',
    },
  },
  {
    name: 'empty → "Lend 2 USDC on Morpho on Base" (a $5 plan): the landing funds the move to Base + the lend at $5,000/ETH ($16 landed $1 short)',
    need: morphoLendNeed(2, 8453),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: morphoLendAsk(2, 8453), expect: 'plan' },
  },
  {
    name: 'empty → "Lend 100 USDC on Morpho on Ethereum": a lane-destination plan chip, no Ethereum gas leg in the preset',
    need: morphoLendNeed(100, 1),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: morphoLendAsk(100, 1), expect: 'plan' },
  },
  {
    name: 'empty → "Lend 2000 USDC on Morpho on Base": NO card chip — one $500 checkout can\'t carry it',
    need: morphoLendNeed(2000, 8453),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: morphoLendAsk(2000, 8453), expect: 'none' },
  },
  {
    name: 'THE LIDO WALL (2026-08-04) — empty → "Stake 0.05 ETH with Lido": a DIRECT chip (the card delivers the stake\'s own ETH on Ethereum), and the landing covers the stake after a 5% price move at $2k–$5k/ETH',
    need: lidoNeed(0.05),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: lidoAsk(0.05), expect: 'direct' },
  },
  {
    name: 'empty → "help me stake on Lido" (no amount): a direct chip at the $15 checkout floor; "Stake all my ETH" sizes itself to what lands',
    need: lidoNeed(null),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: lidoAsk(null), expect: 'direct' },
  },
  {
    name: 'empty → "Stake 0.3 ETH on Lido": NO card chip — the ETH is worth more than one $500 checkout',
    need: lidoNeed(0.3),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: lidoAsk(0.3), expect: 'none' },
  },
  {
    name: 'empty → buy an NFT listed at 0.004 ETH on Base: a plan chip; the landed ETH on Ethereum moves to Base, then the fill',
    need: nftNeed(8453, 0.004),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: nftAsk(8453, 0.004), expect: 'plan' },
  },
  {
    name: 'empty → buy an NFT listed at 0.02 ETH on Ethereum: a DIRECT chip — the delivery IS the ETH the fill spends',
    need: nftNeed(1, 0.02),
    reads: EMPTY,
    expect: 'refusal',
    layerCard: { ask: nftAsk(1, 0.02), expect: 'direct' },
  },
]

/** Price a need at `ethUsd` the way offerFundingPlan does: the token plan, the
 *  destination gas leg, and the flexible floor. */
function decideAt(need: FundingNeed, reads: FundingBalanceRead[], ethUsd: number) {
  const tokenUsd = need.token.toUpperCase() === 'ETH' ? ethUsd : 1
  const scan = { ...classifyFundingBalances(reads, ethUsd), ethUsd, readChains: reads.map((r) => r.chainWord), failedChains: [] }
  const flexMinUsd = typeof need.flexMinAmountHuman === 'number' ? (need.flexMinAmountHuman > 0 ? fundingPlanUsd(need.flexMinAmountHuman, tokenUsd) : 0) : undefined
  return decideFundingTurn({
    need,
    needUsd: need.amountHuman > 0 ? fundingPlanUsd(need.amountHuman, tokenUsd) : 0,
    gasUsd: gasUsdFor(need, reads, ethUsd),
    scan,
    destChainName: FUNDING_CHAIN_WORD[need.chainId],
    flexMinUsd,
  })
}

/** A native layer's card chip, minted AND delivered at each price from $2k to
 *  the ceiling. The chip is re-minted at each price because an ETH-denominated
 *  need (a stake, an NFT) costs more dollars as ETH rises, and a preset is
 *  always sized at the price the wallet saw.
 *  - PLAN: the preset lands (minus the settle slack) as ETH on the lane, and
 *    the SAME need re-plans into chips whose resumes compile as jobs.
 *  - DIRECT: the landing, after a further 5% adverse move, covers the need,
 *    so the layer builds the action itself.
 *  Returns one finding per failing price. */
function layerLandingFindings(s: Scenario & { layerCard: NonNullable<Scenario['layerCard']> }): string[] {
  const out: string[] = []
  for (const ethUsd of [2_000, 3_000, 4_000, ONRAMP_ETH_PRICE_CEILING_USD]) {
    const minted = decideAt(s.need, s.reads, ethUsd)
    // At this price the wallet might be offered a plan instead: no refusal,
    // no card chip, nothing to land.
    if (minted.kind !== 'refusal') continue
    const turn = layerShortfallTurn({ ask: s.layerCard.ask, refusal: { insufficient: minted.insufficient, ...minted.facts } })
    const fund = turn.clarify?.options.find((o) => o.fund)?.fund
    if (!fund) {
      out.push(`no card chip when minted at $${ethUsd}/ETH (the ${ETH_USD}/ETH row had one)`)
      continue
    }
    const laneChainId = ONRAMP_LANE_CHAIN_ID[fund.network]
    if (s.layerCard.expect === 'direct') {
      const landedEth = (fund.presetFiatUsd - ONRAMP_SETTLE_SLACK_USD) / (ethUsd * 1.05)
      if (landedEth < s.need.amountHuman) out.push(`$${fund.presetFiatUsd} direct preset minted at $${ethUsd}/ETH lands ${landedEth.toFixed(6)} ETH after a 5% move — under the ${s.need.amountHuman} ETH the action needs`)
      continue
    }
    const landedEth = (fund.presetFiatUsd - ONRAMP_SETTLE_SLACK_USD) / ethUsd
    const landing = s.reads.some((r) => r.chainId === laneChainId)
      ? s.reads.map((r) => (r.chainId === laneChainId ? { ...r, nativeEth: r.nativeEth + landedEth } : r))
      : [...s.reads, R(laneChainId, landedEth, 0)]
    const rerun = decideAt(s.need, landing, ethUsd)
    if (rerun.kind !== 'offer') {
      out.push(`$${fund.presetFiatUsd} preset landed at $${ethUsd}/ETH re-plans as ${rerun.kind}${rerun.kind === 'refusal' ? ` — "${rerun.insufficient}"` : ''}`)
      continue
    }
    for (const c of rerun.turn.clarify.options) {
      if (c.label === 'Not now') continue
      const o = simulateLadder(c.resume)
      const job = compileJobAsk(c.resume)
      if (o.kind !== 'action') out.push(`landing chip at $${ethUsd}/ETH dead-ends at ${o.gate}/${o.kind}: "${c.resume}"`)
      else if (!job || 'problem' in job || 'clarify' in job) out.push(`landing chip at $${ethUsd}/ETH doesn't compile as a job${job && 'problem' in job ? ` (${job.problem})` : ''}: "${c.resume}"`)
    }
  }
  return out
}

/** The on-ramp's landing state for a cascade chip: the preset converted in
 *  full minus $1 of slack (network fee + drift — Stripe's fee rides ON TOP),
 *  arriving as ETH on the lane, re-planned for the SAME need at a range of ETH
 *  prices. Returns a finding per price where the landed wallet can't be
 *  planned into chips that compile, or [] when every price funds it. */
function cascadeLandingFindings(need: FundingNeed, reads: FundingBalanceRead[], presetUsd: number, laneChainId: number): string[] {
  const out: string[] = []
  for (const ethUsd of [2_000, 3_000, 4_000, 5_000]) {
    const landedEth = (presetUsd - 1) / ethUsd
    const landing = reads.some((r) => r.chainId === laneChainId)
      ? reads.map((r) => (r.chainId === laneChainId ? { ...r, nativeEth: r.nativeEth + landedEth } : r))
      : [...reads, R(laneChainId, landedEth, 0)]
    const scan = { ...classifyFundingBalances(landing, ethUsd), ethUsd, readChains: landing.map((r) => r.chainWord), failedChains: [] }
    const rerun = decideFundingTurn({
      need,
      needUsd: fundingPlanUsd(need.amountHuman, tokenUsdOf(need.token)),
      gasUsd: gasUsdFor(need, landing, ethUsd),
      scan,
      destChainName: FUNDING_CHAIN_WORD[need.chainId],
    })
    if (rerun.kind !== 'offer') {
      out.push(`$${presetUsd} preset landed at $${ethUsd}/ETH re-plans as ${rerun.kind}${rerun.kind === 'refusal' ? ` — "${rerun.insufficient}"` : ''}`)
      continue
    }
    for (const c of rerun.turn.clarify.options) {
      if (c.label === 'Not now') continue
      const o = simulateLadder(c.resume)
      if (o.kind !== 'action') out.push(`landing chip at $${ethUsd}/ETH dead-ends at ${o.gate}/${o.kind}: "${c.resume}"`)
    }
  }
  return out
}

const LANE_CHAIN_ID: Record<string, number> = { base: 8453, ethereum: 1 }

/** Copy mentions the refusal owes the user: every holding ≥ $0.50. */
function expectedMentions(reads: FundingBalanceRead[]): string[] {
  const mentions: string[] = []
  for (const r of reads) {
    if (r.usdcBal >= DUST_USD) mentions.push(`of USDC on ${r.chainWord}`)
    if (r.nativeEth * ETH_USD >= DUST_USD) mentions.push(`ETH on ${r.chainWord}`)
  }
  return mentions
}

for (const s of SCENARIOS) {
  const header = `— ${s.name}`
  const scan = {
    ...classifyFundingBalances(s.reads, ETH_USD),
    ethUsd: ETH_USD,
    readChains: s.reads.map((r) => r.chainWord),
    failedChains: s.failed ?? [],
  }
  const needUsd = s.need.amountHuman > 0 ? fundingPlanUsd(s.need.amountHuman, tokenUsdOf(s.need.token)) : 0
  const gasUsd = gasUsdFor(s.need, s.reads)
  // Mirror of offerFundingPlan's flexible-floor pricing (same formula).
  const flexMinUsd =
    typeof s.need.flexMinAmountHuman === 'number'
      ? s.need.flexMinAmountHuman > 0
        ? fundingPlanUsd(s.need.flexMinAmountHuman, tokenUsdOf(s.need.token))
        : 0
      : undefined
  const decision = decideFundingTurn({
    need: s.need,
    needUsd,
    gasUsd,
    scan,
    destChainName: FUNDING_CHAIN_WORD[s.need.chainId],
    flexMinUsd,
  })
  const got = decision.kind === 'offer' ? 'offer' : decision.kind === 'refusal' ? 'refusal' : 'fallthrough'
  if (verbose) {
    const detail =
      decision.kind === 'offer'
        ? decision.turn.clarify.options.map((o) => o.resume).join(' | ')
        : decision.kind === 'refusal'
          ? decision.insufficient
          : decision.reason
    console.log(`${header}\n    → ${got}: ${detail}`)
  }

  if (got !== s.expect) {
    console.log(header)
    flag(`expected ${s.expect}, got ${got}${decision.kind === 'refusal' ? ` — "${decision.insufficient}"` : ''}`)
    continue
  }
  for (const gap of s.gaps ?? []) console.log(`${verbose ? '' : `${header}\n`}  ⚠ known gap: ${gap}`)

  if (decision.kind === 'offer') {
    for (const chip of decision.turn.clarify.options) {
      // The trailing decline chip is a conversational escape hatch, not a
      // build contract — only action chips owe the ladder an action.
      if (chip.label === 'Not now') continue
      const outcome = simulateLadder(chip.resume)
      if (outcome.kind !== 'action') {
        console.log(header)
        flag(`chip resume dead-ends at ${outcome.gate}/${outcome.kind}${outcome.note ? ` — "${outcome.note}"` : ''}: "${chip.resume}"`)
      }
      for (const leg of roundTripLegs(s.need, chip.resume)) {
        console.log(header)
        flag(`chip sells the ${s.need.buyToken} its follow-up buys back — "${leg}" in "${chip.resume}"`)
      }
      if (outcome.gate === 'cross-chain' && !askAppSlugs(chip.resume).includes('near-intents-mcp-yeetful')) {
        console.log(header)
        flag(`a lone cross-chain chip doesn't compose NEAR Intents, so a default chat set answers the add-the-dapp door: "${chip.resume}"`)
      }
    }
  }

  if (decision.kind === 'refusal') {
    const copy = decision.insufficient
    const owed = expectedMentions(s.reads)
    for (const mention of owed) {
      const missing = !copy.includes(mention)
      const documented = (s.knownUnnamed ?? []).includes(mention)
      if (missing && !documented) {
        console.log(header)
        flag(`refusal copy never names "${mention}" — money the user owns is invisible: "${copy}"`)
      }
      if (missing && documented) console.log(`  ⚠ still unnamed (documented): "${mention}"`)
      if (!missing && documented) {
        console.log(header)
        flag(`knownUnnamed entry "${mention}" is no longer missing — promote this row to strict`)
      }
    }
    if (owed.length > 0 && copy.includes('found no movable')) {
      console.log(header)
      flag(`refusal claims "found no movable" while the snapshot holds money: "${copy}"`)
    }

    // ── Invariant 4: the swap layer's card door on this refusal.
    if (s.card) {
      const turn = swapShortfallTurn({ ask: s.card.ask, refusal: { insufficient: copy, ...decision.facts } })
      const chip = turn.clarify?.options.find((o) => o.fund)
      const gotCard = !chip ? 'none' : chip.fund?.completes ? 'completes' : 'cascade'
      if (verbose) console.log(`    → card ${gotCard}: ${turn.reply}${chip ? `\n      [${chip.label}] resume "${chip.resume}"` : ''}`)
      if (gotCard !== s.card.expect) {
        console.log(header)
        flag(`card door expected ${s.card.expect}, got ${gotCard}: "${turn.reply}"`)
      }
      // The card is an addition to an honest answer, never a replacement:
      // every holding the refusal owed the user is still named.
      for (const mention of owed) {
        if (!turn.reply.includes(mention)) {
          console.log(header)
          flag(`card reply dropped "${mention}" — the money the refusal named is invisible again: "${turn.reply}"`)
        }
      }
      if (owed.length === 0 && buyDollarsOf(s.card.ask) !== null && /The swap sells/.test(turn.reply)) {
        console.log(header)
        flag(`an empty wallet's BUY still reads "The swap sells …": "${turn.reply}"`)
      }
      if (chip?.fund) {
        const outcome = simulateLadder(chip.resume)
        if (outcome.kind !== 'action') {
          console.log(header)
          flag(`card chip resume dead-ends at ${outcome.gate}/${outcome.kind}: "${chip.resume}"`)
        }
        if (chip.fund.network !== ONRAMP_DEFAULT_NETWORK) {
          console.log(header)
          flag(`card chip delivers on ${chip.fund.network}, not the default lane ${ONRAMP_DEFAULT_NETWORK}`)
        }
        const dollars = buyDollarsOf(s.card.ask) ?? 0
        if (gotCard === 'completes' && chip.fund.presetFiatUsd !== deliveryFundUsd(dollars)) {
          console.log(header)
          flag(`a completing chip presets $${chip.fund.presetFiatUsd}, not the asked $${dollars} (floored): "${chip.label}"`)
        }
        if (gotCard === 'cascade') {
          for (const f of cascadeLandingFindings(s.need, s.reads, chip.fund.presetFiatUsd, LANE_CHAIN_ID[chip.fund.network])) {
            console.log(header)
            flag(f)
          }
        }
      }
    }

    // ── Invariant 5: a native layer's card door on this refusal.
    if (s.layerCard) {
      const { ask, expect } = s.layerCard
      const turn = layerShortfallTurn({ ask, refusal: { insufficient: copy, ...decision.facts } })
      const chip = turn.clarify?.options.find((o) => o.fund)
      const gotCard = !chip ? 'none' : layerCardKind(ask, chip.fund!.network)
      if (verbose) console.log(`    → layer card ${gotCard}: ${turn.reply}${chip ? `\n      [${chip.label}] resume "${chip.resume}"` : ''}`)
      if (gotCard !== expect) {
        console.log(header)
        flag(`layer card expected ${expect}, got ${gotCard}: "${turn.reply}"`)
      }
      if (turn.buildPath !== LAYER_SHORTFALL[ask.layer].buildPath) {
        console.log(header)
        flag(`the refusal files as ${turn.buildPath}, not its layer's ${LAYER_SHORTFALL[ask.layer].buildPath}`)
      }
      for (const mention of owed) {
        if (!turn.reply.includes(mention)) {
          console.log(header)
          flag(`layer card reply dropped "${mention}" — the money the refusal named is invisible again: "${turn.reply}"`)
        }
      }
      // Empty on every chain the scan reads AND nothing the layer read itself:
      // the plain answer, never the funding layer's homework.
      const empty = owed.length === 0 && !ask.holdsUnscanned
      if (empty !== /this wallet needs money in it first/.test(turn.reply)) {
        console.log(header)
        flag(`${empty ? 'an empty wallet does not' : 'a wallet holding money'} ${empty ? 'read plainly' : 'reads as empty'}: "${turn.reply}"`)
      }
      if (empty && /found no movable|Top up any of those chains/.test(turn.reply)) {
        console.log(header)
        flag(`an empty wallet still reads the funding layer's homework: "${turn.reply}"`)
      }
      if (chip?.fund) {
        const outcome = simulateLadder(chip.resume)
        if (outcome.kind !== 'action') {
          console.log(header)
          flag(`layer card resume dead-ends at ${outcome.gate}/${outcome.kind}: "${chip.resume}"`)
        }
        if (chip.resume !== ask.resume || chip.fund.completes || chip.fund.network !== ONRAMP_DEFAULT_NETWORK) {
          console.log(header)
          flag(`layer card chip drifted from its ask: resume "${chip.resume}", completes ${chip.fund.completes}, network ${chip.fund.network}`)
        }
        // The preset rule per kind, recomputed from the refusal's own facts.
        const wantPreset =
          gotCard === 'direct'
            ? deliveryFundUsd(decision.facts.needUsd)
            : Math.min(ONRAMP_MAX_USD, Math.max(planFundUsd(layerPlanUsd(ask, decision.facts)), ask.chainId === ONRAMP_LANE_CHAIN_ID[chip.fund.network] ? laneGasFloorPresetUsd() : 0))
        if (chip.fund.presetFiatUsd !== wantPreset) {
          console.log(header)
          flag(`a ${gotCard} chip presets $${chip.fund.presetFiatUsd}, not $${wantPreset}: "${chip.label}"`)
        }
        for (const f of layerLandingFindings({ ...s, layerCard: s.layerCard })) {
          console.log(header)
          flag(f)
        }
      }
    }
  }
}

console.log(`\naudit:funding — ${SCENARIOS.length} wallet-state scenarios through the real funding pipeline (no RPC, no signing).`)
if (findings) {
  console.log(`${findings} finding(s). A wallet in one of these states gets chips that dead-end or a refusal that hides their money.`)
  process.exit(1)
}
console.log('Every scenario lands where it should: chips compile, refusals name every dollar.')
