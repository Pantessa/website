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
 *   4. round trip ⇒ when the need names the token its follow-up BUYS
 *      (FundingNeed.buyToken), no chip converts that token into anything
 *      else. "Buy $50 of ETH" once planned ETH → USDC → ETH (2026-09-16).
 *      Moving the token to itself on another chain is not a round trip.
 *   5. apps ⇒ a chip that lands on the cross-chain gate on its own (not a
 *      job) composes NEAR Intents into its apps (lib/ask-apps). The ladder
 *      above assumes every free dapp is on, but the default chat set has no
 *      NEAR Intents; the chip send is what turns it on.
 *
 *   npm run audit:funding           # report + nonzero exit on findings
 *   npm run audit:funding -- -v     # also print every outcome row
 */
import {
  classifyFundingBalances,
  decideFundingTurn,
  DEST_GAS_FLOOR_ETH,
  FUNDING_CHAIN_WORD,
  fundingPlanUsd,
  type FundingBalanceRead,
  type FundingNeed,
} from '../lib/funding-plan'
import { askAppSlugs } from '../lib/ask-apps'
import { simulateLadder } from './ask-ladder'

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
function gasUsdFor(need: FundingNeed, reads: FundingBalanceRead[]): number {
  if (need.token.toUpperCase() === 'ETH') return 0
  const dest = reads.find((r) => r.chainId === need.chainId)
  const floor = DEST_GAS_FLOOR_ETH[need.chainId] ?? 0.0002
  const shortEth = Math.max(0, floor - (dest?.nativeEth ?? 0))
  return shortEth > 0 ? Math.max(MIN_GAS_LEG_USD, Math.ceil(shortEth * ETH_USD * 1.15 * 2) / 2) : 0
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
// funds the swap (invariant 4). A sell spends the token and buys the stable.
const swapNeed = (sell: string, amount: number, buy: string, chainId = 8453): FundingNeed => ({
  chainId,
  token: sell,
  amountHuman: amount,
  followupResume: `swap ${amount} ${sell} for ${buy} on ${FUNDING_CHAIN_WORD[chainId]}`,
  actionLabel: 'the swap',
  buyToken: buy,
})
const NFT_NEED: FundingNeed = {
  chainId: 8453,
  token: 'ETH',
  amountHuman: 0.0062,
  followupResume: 'buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198',
  actionLabel: 'the buy',
}

interface Scenario {
  name: string
  need: FundingNeed
  reads: FundingBalanceRead[]
  /** Chain words whose scan "failed" (unknown, never empty). */
  failed?: string[]
  expect: 'offer' | 'refusal' | 'fallthrough'
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
  // A holding of the token a swap BUYS never funds it (invariant 5).
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
    // ETH and WETH share one address in lib/chains, and a move lands native
    // ETH, not the wrapped token the ask named — so no move, no round trip.
    name: 'ETH on Arbitrum only → "Buy $50 of WETH" on Base: WETH is ETH for funding — refusal, no ETH → USDC → WETH plan',
    need: swapNeed('USDC', 50, 'WETH'),
    reads: [R(8453, 0, 0), R(42161, 0.05, 0), R(10, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
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
]

/** Legs of a chip resume that convert the token the follow-up BUYS into
 *  something else (invariant 4). ETH and WETH are one asset, as they are in
 *  lib/funding-plan. */
function roundTripLegs(need: FundingNeed, resume: string): string[] {
  if (!need.buyToken) return []
  const asset = (t: string) => (t.toUpperCase() === 'WETH' ? 'ETH' : t.toUpperCase())
  const buy = asset(need.buyToken)
  return resume.split(', then ').filter((leg) => {
    const m = leg.match(/^swap\s+[\d.]+\s+([a-z]+)\b.*?\b(?:for|to)\s+([a-z]+)\s+on\b/i)
    return !!m && asset(m[1]) === buy && asset(m[2]) !== buy
  })
}

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
  }
}

console.log(`\naudit:funding — ${SCENARIOS.length} wallet-state scenarios through the real funding pipeline (no RPC, no signing).`)
if (findings) {
  console.log(`${findings} finding(s). A wallet in one of these states gets chips that dead-end or a refusal that hides their money.`)
  process.exit(1)
}
console.log('Every scenario lands where it should: chips compile, refusals name every dollar.')
