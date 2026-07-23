#!/usr/bin/env tsx
/**
 * Ask audit — every example ask the product itself surfaces (splash chips,
 * empty-state prompts, docs prefills, intent links, funding/DCA chip resume
 * strings, seeded MCP examples) replayed through a PURE replica of the chat
 * route's native-gate ladder, plus mutations real users actually type
 * (chain typos, courtesy words, casing). Born from a live dead-end
 * (2026-07-22): "swap 1 USDC from base to Etheruem" answered "Say the
 * amount and pair…" — everything was in the message; one typo'd chain word
 * dropped it out of the cross-chain layer.
 *
 * Failure classes it catches:
 *   1. An ask WE surface that dead-ends (expected an actionable claim,
 *      got a clarify or planner fall-through).
 *   2. A mutation that CHANGES the outcome class vs the base ask — a typo
 *      or "please" must never turn a build into a dead-end.
 *
 *   npm run audit:asks           # report + nonzero exit on findings
 *   npm run audit:asks -- -v     # also print every outcome row
 *
 * The ladder here mirrors app/api/chat/route.ts gate ORDER (vote → aave →
 * dca → jobs → guardian → lido → hyperliquid → robinhood bridge → nft →
 * transfer → swap/cross-chain) with the working set assumed to be ALL free
 * MCPs (usable), no chain picker, no pending context. Route-level gating
 * that needs live data (stock-list warm, balances) is approximated and
 * noted — this audits PARSE outcomes, not builds.
 */
import { parseVoteIntent } from '../lib/vote-intent'
import { parseAaveSupply, parseAaveOp } from '../lib/aave-supply'
import { parseDcaRun, parseDcaCreate, parseDcaManage } from '../lib/dca'
import { compileJobAsk } from '../lib/jobs'
import { parseGuardianArm } from '../lib/hl-guardian'
import { isLidoGuidedAsk, parseLidoStake } from '../lib/lido-stake'
import { parseHlIntent } from '../lib/hyperliquid-exec'
import { parseRobinhoodBridge } from '../lib/robinhood-bridge'
import { mentionsNft, parseNftAsk } from '../lib/nft-layer'
import { parseTransferSegment } from '../lib/transfer-exec'
import { parseSwapIntent, detectCrossChain } from '../lib/swap-intent'
import { parseCrossChainSwap } from '../lib/cross-chain-swap'

type Kind = 'action' | 'clarify' | 'planner'
interface Outcome {
  gate: string
  kind: Kind
  note?: string
}

const NATIVE_CHAINS = new Set(['base', 'ethereum', 'arbitrum', 'robinhood'])

/** Pure replica of the route ladder — same order, all free MCPs active. */
export function simulateLadder(message: string): Outcome {
  const vote = parseVoteIntent(message)
  if (vote.isVote) return { gate: 'vote', kind: 'action' }

  // Aave gates: with every free MCP active the route's set-hint passes but
  // rival venues exist, so weak verbs fall through — replicate by requiring
  // the explicit venue word (parseAaveSupply itself rejects rival-venue
  // messages via its OTHER_VENUE_RE).
  if (/\baave\b/i.test(message)) {
    const as = parseAaveSupply(message)
    if (as) return 'problem' in as ? { gate: 'aave-supply', kind: 'clarify', note: as.problem } : { gate: 'aave-supply', kind: 'action' }
    const ao = parseAaveOp(message)
    if (ao) return 'problem' in ao ? { gate: 'aave-op', kind: 'clarify', note: ao.problem } : { gate: 'aave-op', kind: 'action' }
  }

  if (parseDcaRun(message)) return { gate: 'dca', kind: 'action', note: 'run chip' }
  const dc = parseDcaCreate(message)
  if (dc) return 'problem' in dc ? { gate: 'dca', kind: 'clarify', note: dc.problem } : { gate: 'dca', kind: 'action' }
  const dm = parseDcaManage(message)
  if (dm) return { gate: 'dca', kind: 'action', note: dm.op }

  const job = compileJobAsk(message)
  if (job) {
    if ('problem' in job) return { gate: 'jobs', kind: 'clarify', note: job.problem }
    if ('clarify' in job) return { gate: 'jobs', kind: 'clarify', note: String((job as { clarify: unknown }).clarify) }
    return { gate: 'jobs', kind: 'action', note: `${(job as { steps: unknown[] }).steps?.length ?? '?'} steps` }
  }

  if (parseGuardianArm(message)) return { gate: 'guardian', kind: 'action' }
  if (isLidoGuidedAsk(message)) return { gate: 'lido', kind: 'action', note: 'guided' }
  const lido = parseLidoStake(message)
  if (lido) return 'problem' in lido ? { gate: 'lido', kind: 'clarify', note: lido.problem } : { gate: 'lido', kind: 'action' }

  if (parseHlIntent(message)) return { gate: 'hyperliquid', kind: 'action' }

  const rb = parseRobinhoodBridge(message)
  if (rb) return 'problem' in rb ? { gate: 'rh-bridge', kind: 'clarify', note: rb.problem } : { gate: 'rh-bridge', kind: 'action' }

  if (mentionsNft(message)) {
    const nft = parseNftAsk(message)
    if (nft) return nft.kind === 'problem' ? { gate: 'nft', kind: 'clarify', note: (nft as { problem?: string }).problem } : { gate: 'nft', kind: 'action', note: nft.kind }
  }

  const tr = parseTransferSegment(message, { fallbackChainId: null })
  if (tr) return 'problem' in tr ? { gate: 'transfer', kind: 'clarify', note: tr.problem } : { gate: 'transfer', kind: 'action' }

  const sw = parseSwapIntent(message)
  const xcEarly = detectCrossChain(message)
  if (sw.isSwap || xcEarly.crossChain) {
    const xc = xcEarly
    const foreign = !xc.crossChain && xc.chains.length === 1 && !NATIVE_CHAINS.has(xc.chains[0])
    if (xc.crossChain || foreign) {
      const cc = parseCrossChainSwap(message)
      if (cc && 'problem' in cc) return { gate: 'cross-chain', kind: 'clarify', note: cc.problem }
      if (cc) return { gate: 'cross-chain', kind: 'action', note: `${cc.amount} ${cc.originToken} ${cc.originChain}→${cc.destinationChain}` }
      return { gate: 'cross-chain', kind: 'planner', note: 'cross-chain-shaped, no imperative parse' }
    }
    if (!sw.isSwap) return { gate: 'planner', kind: 'planner' }
    if (sw.problem) return { gate: 'swap', kind: 'clarify', note: sw.problem }
    return { gate: 'swap', kind: 'action', note: `${sw.sellAmountHuman ?? '$' + sw.sellAmountUsd} ${sw.sellToken ?? '(stable)'}→${sw.buyToken}` }
  }

  return { gate: 'planner', kind: 'planner' }
}

// ── Corpus — the asks WE surface (agent-cataloged 2026-07-22) ──────────────
// expect: 'action' = a native gate must claim it; 'clarify-ok' = the surface
// intentionally under-specifies (blank recipient chip); 'planner' = a
// question, normal routing is right; 'any' = either is defensible.
interface Entry { ask: string; source: string; expect: 'action' | 'clarify-ok' | 'planner' | 'any' }

const CORPUS: Entry[] = [
  // The live dead-end that started this audit
  { ask: 'swap 1 USDC from base to Etheruem', source: 'live 2026-07-22', expect: 'action' },

  // Live asks 2026-07-23 — multi-clause sends + stable acquisition
  {
    ask: 'I want to send all my USDC on arbitrum and an additional 5 USDC on base to 0x2055Fa9E99565181A8509B81cBD0aa3D73be8d56',
    source: 'live 2026-07-23 (two-chain send)', expect: 'action',
  },
  { ask: 'send all my USDC on base to nate.eth', source: 'live 2026-07-23 (all-send)', expect: 'action' },
  { ask: 'I need $50 of USDG on Robinhood, can you make that happen?', source: 'live 2026-07-23 (screenshot)', expect: 'action' },
  { ask: 'I need $20 in USDG on robinhood', source: 'live 2026-07-23 variant', expect: 'action' },

  // lib/examples.ts EXAMPLE_PROMPTS + TRY_PROMPTS
  { ask: 'Swap $1 of ETH to USDC', source: 'examples', expect: 'action' },
  { ask: "What's in my wallet?", source: 'examples', expect: 'planner' },
  { ask: 'Buy $10 of AAPL every week on Robinhood Chain', source: 'examples', expect: 'action' },
  { ask: 'Set a stop-loss on my ETH position at -8%', source: 'examples', expect: 'action' },
  { ask: 'Swap 1 USDC from Base to Arbitrum.', source: 'examples/try', expect: 'action' },
  { ask: 'Buy $2 of AAPL', source: 'examples/try + FundAnything', expect: 'action' },
  { ask: 'Quote 100 USDC to WETH on Base — which fee tier is best?', source: 'examples/try', expect: 'planner' },

  // Splash chips (templates instantiated with representative values)
  { ask: 'Swap 5 USDC for ETH on Base', source: 'splash/holdings', expect: 'action' },
  { ask: 'Swap 0.0100 ETH for USDC on Base', source: 'splash/holdings', expect: 'action' },
  { ask: 'Swap $10 of USDC for UNI on Base', source: 'splash/holdings', expect: 'action' },
  { ask: 'Buy $10 of UNI every week on Base', source: 'splash/holdings', expect: 'action' },
  { ask: 'Buy $25 of ETH every week on Base', source: 'splash/uniswap preview', expect: 'action' },
  { ask: 'Long $12 of ETH on Hyperliquid', source: 'splash/hl', expect: 'action' },
  { ask: 'Close my ETH long on Hyperliquid', source: 'splash/hl', expect: 'action' },
  { ask: 'Protect my ETH long with a 10% stop loss', source: 'splash/hl', expect: 'action' },
  { ask: 'Deposit 10 USDC to Hyperliquid', source: 'splash/hl preview', expect: 'action' },
  {
    ask: 'Deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop',
    source: 'splash/hl preview (job)', expect: 'action',
  },
  { ask: 'Supply 10 USDC to Aave on Ethereum', source: 'splash/aave preview', expect: 'action' },
  { ask: 'Repay all my USDC on Aave', source: 'splash/aave', expect: 'action' },
  { ask: 'Withdraw all my USDC from Aave', source: 'splash/aave', expect: 'action' },
  { ask: 'Stake 0.1 ETH on Lido', source: 'splash/lido', expect: 'action' },
  { ask: 'Help me stake on Lido', source: 'splash/lido', expect: 'action' },
  { ask: 'Buy $10 of AAPL on Robinhood Chain', source: 'splash/robinhood', expect: 'action' },
  { ask: 'Swap 5 USDG for AAPL on Robinhood Chain', source: 'splash/robinhood', expect: 'action' },
  { ask: 'Swap 1 AAPL for USDG on Robinhood Chain', source: 'splash/robinhood', expect: 'action' },
  { ask: 'Bridge 0.01 ETH from Ethereum to Robinhood Chain', source: 'splash/robinhood', expect: 'action' },
  { ask: 'Sell my Pudgy Penguin #2489 NFT on Ethereum for 4.2 ETH', source: 'splash/nft', expect: 'action' },
  { ask: 'Send my Pudgy Penguin #2489 NFT on Ethereum to ', source: 'splash/nft (blank recipient)', expect: 'clarify-ok' },

  // Standing-intent tiles + docs + house links
  { ask: 'Buy $10 of AAPL every week', source: 'standing-intent + docs', expect: 'action' },
  {
    ask: 'Swap 1 USDC from Base to Arbitrum, then send the 1 USDC on Arbitrum to nate.eth',
    source: 'standing-intent (job)', expect: 'action',
  },
  { ask: 'Sell my NFT #4172 for 0.8 ETH', source: 'standing-intent', expect: 'action' },
  { ask: 'Swap 20 USDC for ETH on Base.', source: 'docs', expect: 'action' },
  {
    ask: 'Bridge 5 USDC from Base to Arbitrum, then deposit 5 USDC to Hyperliquid, then long $12 of ETH on Hyperliquid, then protect my ETH long with a 5% stop.',
    source: 'docs STEP 1 · INTENT', expect: 'action',
  },
  {
    // The pre-2026-07-22 docs phrasing — users may still type it; the origin
    // clarify (not a planner fall-through) is the accepted outcome.
    ask: 'Bridge 5 USDC to Arbitrum, then deposit it to Hyperliquid, then long $12 of ETH, then protect it with a 5% stop.',
    source: 'docs STEP 1 (legacy phrasing)', expect: 'clarify-ok',
  },
  {
    ask: 'swap 5 usdc from base to arbitrum, then deposit 5 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop',
    source: 'docs/jobs curl', expect: 'action',
  },
  { ask: 'Buy $10 of AAPL', source: 'house link /i/buy-aapl', expect: 'action' },
  { ask: 'DCA $25 into ETH weekly', source: 'house link /i/dca-eth', expect: 'action' },
  { ask: 'Stake 0.05 ETH with Lido', source: 'house link /i/stake-eth', expect: 'action' },
  { ask: 'Set a stop-loss on my Hyperliquid ETH position at -5%', source: 'retired house link /i/stop-loss (row stays live)', expect: 'action' },
  { ask: 'Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop', source: 'house link /i/protected-long (pure intent — funding auto-offered)', expect: 'action' },
  { ask: 'Show my NFTs', source: 'house link /i/my-nfts', expect: 'planner' },
  { ask: 'Swap 5 USDC from Base to Arbitrum', source: 'house link /i/bridge-usdc', expect: 'action' },
  { ask: 'Buy $5 of AAPL', source: 'onboarding checklist', expect: 'action' },
  { ask: 'Swap $1 worth of ETH to USDC on Base', source: 'dashboard charts + docs', expect: 'action' },

  // Chip resume strings (funding / DCA — the chip IS the contract)
  { ask: 'Fund robinhood chain with $12 from base', source: 'lifi funding chip', expect: 'action' },
  { ask: 'Fund robinhood chain with $12 from base, then buy $10 of AAPL', source: 'lifi funding chip', expect: 'action' },
  { ask: 'Swap 5 USDC from base to USDG on robinhood', source: 'funding-plan leg chip', expect: 'action' },
  { ask: 'Swap 5 USDC from base to ETH on arbitrum', source: 'funding-plan gas-leg chip', expect: 'action' },
  {
    ask: 'Swap 7.5 USDC for ETH on Base, then buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198',
    source: 'funding-plan same-chain chip (nft buy)', expect: 'action',
  },
  { ask: 'Run my $10 AAPL dca (schedule cmd7x2k9q0001ab12cd34ef56)', source: 'dca due chip', expect: 'action' },
  { ask: 'bridge 5 USDC from base to arbitrum', source: 'bridge-verb single leg', expect: 'action' },
  { ask: 'Bridge 5 USDC to Arbitrum', source: 'docs (origin unstated)', expect: 'clarify-ok' },
  { ask: 'swap 1 USDC to arbitrum', source: 'dest-only shorthand', expect: 'clarify-ok' },
  { ask: "What's the cheapest way to convert USDT from Ethereum to Base?", source: 'near-intents card', expect: 'planner' },

  // Seeded MCP example queries (questions → planner is correct)
  { ask: 'swap 1 USDC from base to arbitrum', source: 'seed/near-intents', expect: 'action' },
  { ask: 'move my USDC from base to solana', source: 'seed/near-intents', expect: 'any' },
  { ask: 'stake 0.5 ETH with Lido', source: 'seed/lido', expect: 'action' },
  { ask: 'sell my Pudgy Penguin #2489 for 4.2 ETH', source: 'seed/opensea', expect: 'action' },
  { ask: 'buy AAPL with 500 USDG on robinhood', source: 'seed/robinhood', expect: 'any' },
  { ask: 'add 1 USDC to an Aave pool on Ethereum', source: 'seed/aave', expect: 'any' },
  { ask: 'Swap 100 USDC for WETH', source: 'seed/cow', expect: 'action' },
  { ask: 'Place a limit order: sell 0.5 WETH when it hits 3500 USDC', source: 'seed/cow', expect: 'action' },

  // Transfers (Nate's live phrasing, #473)
  { ask: 'send 1 USDC on arbitrum to 0x1111111111111111111111111111111111111111', source: 'live/#473', expect: 'action' },
  { ask: 'send 1 USDC on arbitrum to nate.eth', source: 'live/#473', expect: 'action' },
]

// ── Mutations — what real users do to our example asks ─────────────────────
const CHAIN_TYPOS: Record<string, string[]> = {
  ethereum: ['Etheruem', 'Etherium', 'Ethreum', 'Ethereom'],
  arbitrum: ['Arbitum', 'Arbitrium', 'Aribtrum'],
  robinhood: ['Robinhod', 'Robbinhood'],
  optimism: ['Optimsim'],
  solana: ['Solona'],
}

interface Mutation { label: string; ask: string }

function mutationsOf(ask: string): Mutation[] {
  const out: Mutation[] = []
  for (const [chain, typos] of Object.entries(CHAIN_TYPOS)) {
    const re = new RegExp(`\\b${chain}\\b`, 'i')
    if (re.test(ask)) for (const t of typos) out.push({ label: `typo:${t}`, ask: ask.replace(re, t) })
  }
  out.push({ label: 'lowercase', ask: ask.toLowerCase() })
  if (!/[?.!]\s*$/.test(ask)) out.push({ label: 'question-mark', ask: `${ask}?` })
  out.push({ label: 'please', ask: `${ask.replace(/[.?!]\s*$/, '')} please` })
  out.push({ label: 'can-you', ask: `can you ${ask[0].toLowerCase()}${ask.slice(1)}` })
  return out
}

// ── Run ────────────────────────────────────────────────────────────────────
const verbose = process.argv.includes('-v') || process.argv.includes('--verbose')
let findings = 0
const flag = (msg: string) => {
  findings++
  console.log(`  ✗ ${msg}`)
}

for (const entry of CORPUS) {
  const base = simulateLadder(entry.ask)
  const header = `[${entry.source}] "${entry.ask}"`
  if (verbose) console.log(`${header}\n    → ${base.gate}/${base.kind}${base.note ? ` (${base.note})` : ''}`)

  if (entry.expect === 'action' && base.kind !== 'action') {
    console.log(header)
    flag(`expected an actionable claim, got ${base.gate}/${base.kind}${base.note ? ` — "${base.note}"` : ''}`)
  }
  if (entry.expect === 'planner' && base.kind === 'clarify') {
    console.log(header)
    flag(`a question dead-ended in a clarify at ${base.gate} — "${base.note}"`)
  }

  // Mutations must not change the outcome CLASS (gate + kind) of a working ask.
  if (base.kind !== 'action') continue
  for (const m of mutationsOf(entry.ask)) {
    const got = simulateLadder(m.ask)
    if (got.gate === base.gate && got.kind === base.kind) continue
    // A typo'd chain word landing in the SAME kind via the cross-chain gate
    // (or vice versa) still serves the user — only kind downgrades count.
    if (got.kind === 'action') continue
    console.log(`${header}\n    ${m.label} → "${m.ask}"`)
    flag(`mutation downgraded ${base.gate}/${base.kind} → ${got.gate}/${got.kind}${got.note ? ` — "${got.note}"` : ''}`)
  }
}

console.log(`\naudit:asks — ${CORPUS.length} surfaced asks, mutations applied to actionable ones.`)
if (findings) {
  console.log(`${findings} finding(s). A user typing one of OUR OWN example asks (or a typo of it) hits a dead-end.`)
  process.exit(1)
}
console.log('No dead-ends: every surfaced ask and mutation lands where it should.')
