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
const GAS_RESERVE_ETH: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002 }
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
  {
    name: 'dust — $0.30 USDC on Base → HL deposit (below naming threshold)',
    need: HL_NEED,
    reads: [R(8453, 0.001, 0.3), R(42161, 0, 0), R(1, 0, 0)],
    expect: 'refusal',
  },
]

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
  const decision = decideFundingTurn({
    need: s.need,
    needUsd,
    gasUsd,
    scan,
    destChainName: FUNDING_CHAIN_WORD[s.need.chainId],
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
