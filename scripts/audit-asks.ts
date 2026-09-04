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
 * The ladder (scripts/ask-ladder.ts, shared with audit:funding) mirrors app/api/chat/route.ts gate ORDER (vote → aave →
 * dca → jobs → guardian → lido → hyperliquid → robinhood bridge → nft →
 * transfer → swap/cross-chain) with the working set assumed to be ALL free
 * MCPs (usable), no chain picker, no pending context. Route-level gating
 * that needs live data (stock-list warm, balances) is approximated and
 * noted — this audits PARSE outcomes, not builds.
 */
import { simulateLadder } from './ask-ladder'

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

  // Live funded misses 2026-08-12 (the /dashboard/failures funded=1 queue).
  // The flagship shape without a size: an unsized HL open answers SIZE CHIPS
  // (clarify-ok — the resumes round-trip into full 2x orders); the sized
  // venue-less form and the size chips themselves are actions.
  { ask: 'I want to buy some HYPE and 2x long', source: 'live 2026-08-12 (funded, fell to the planner)', expect: 'clarify-ok' },
  { ask: '2x long $12 of HYPE', source: 'live 2026-08-12 variant (leverage is venue evidence)', expect: 'action' },
  { ask: '2x long $12 of HYPE on hyperliquid', source: 'hl unsized size chip', expect: 'action' },
  { ask: 'short 2x on BTC', source: 'live 2026-08-12 variant', expect: 'clarify-ok' },
  { ask: 'tile my wallet 42% ETH, 39% DAI, 19% CETH on ethereum', source: 'live 2026-08-12 (mosaic, cETH resolves on mainnet)', expect: 'action' },

  // Stranger phrasings (squad 2026-08-18, Ideation's ask inventory) — what
  // the ten-strangers drill will type. Grammar grown where the shape was
  // small; real gaps clarify with chips that round-trip (clarify-ok).
  { ask: 'buy $20 eth on base', source: 'stranger inventory ("of"-less dollar buy)', expect: 'action' },
  { ask: 'set up a weekly $10 ETH buy', source: 'stranger inventory (DCA noun form)', expect: 'action' },
  { ask: 'make my wallet 60% ETH 40% USDC', source: 'stranger inventory (mosaic synonym)', expect: 'action' },
  { ask: 'send $5 to nate.eth', source: 'stranger inventory (dollar send → USDC, chain chips)', expect: 'clarify-ok' },
  { ask: 'send 5 USDC to @nate', source: 'stranger inventory (handle is not payable — named refusal)', expect: 'clarify-ok' },
  { ask: 'sell my eth when it hits $4000', source: 'stranger inventory (price-triggered sell → limit chips)', expect: 'clarify-ok' },
  { ask: 'Protect my ETH on Base with a 10% stop', source: 'WALLET-MATRIX §4 row 6 (spot guardian, chain word = spot)', expect: 'action' },

  // lib/examples.ts EXAMPLE_PROMPTS + TRY_PROMPTS
  { ask: 'Swap $1 of ETH to USDC', source: 'examples', expect: 'action' },
  { ask: "What's in my wallet?", source: 'examples', expect: 'planner' },
  { ask: 'Buy $10 of AAPL every week on Robinhood Chain', source: 'examples', expect: 'action' },
  { ask: 'Set a stop-loss on my ETH position at -8%', source: 'examples', expect: 'action' },
  { ask: 'Swap 1 USDC from Base to Arbitrum.', source: 'examples/try', expect: 'action' },
  { ask: 'Buy $2 of AAPL', source: 'examples/try + FundAnything', expect: 'action' },
  { ask: 'Quote 100 USDC to WETH on Base — which fee tier is best?', source: 'examples/try', expect: 'planner' },

  // Wallet-briefing chips (the "what Pantessa noticed" tile + /w pages) —
  // every briefing chip is a complete ask; the guardian/DCA ones are
  // already covered by the splash rows above.
  { ask: 'Swap 0.001 ETH from base to arbitrum', source: 'briefing unstick chip (L2 donor)', expect: 'action' },
  { ask: 'Swap 0.004 ETH from base to ethereum', source: 'briefing unstick chip (mainnet dest)', expect: 'action' },
  { ask: 'Swap $50 of USDC for ETH on Base', source: 'briefing idle-USDC chip', expect: 'action' },

  // Rebalance (the idle-capital answer — briefing "Put it to work" chip,
  // the Pantessa Finance card, and the bare grammar). The offer's own chip
  // resumes are representative planner outputs: multi-leg strings compile
  // as jobs, single legs land on their venue gate.
  { ask: 'Rebalance my portfolio', source: 'briefing "Put it to work" chip + finance card', expect: 'action' },
  { ask: 'Where could my money earn more?', source: 'finance card preview', expect: 'action' },
  { ask: 'put my idle money to work', source: 'rebalance grammar', expect: 'action' },
  { ask: 'What movable funds do I have across my chains?', source: 'finance card preview (scan read → planner)', expect: 'planner' },
  { ask: 'Swap 118.40 USDC from Base to USDC on Ethereum, then supply 113.66 USDC to aave', source: 'rebalance combined chip', expect: 'action' },
  { ask: 'Swap 0.024 ETH from Base to ETH on Ethereum, then supply 113.66 USDC to aave', source: 'rebalance gas-leg chip', expect: 'action' },
  { ask: 'supply 120 USDC to aave', source: 'rebalance single-leg (mainnet USDC)', expect: 'action' },
  { ask: 'stake 0.05 eth on lido', source: 'rebalance single-leg (mainnet ETH)', expect: 'action' },
  {
    ask: 'Swap 0.03 ETH from Arbitrum to ETH on Ethereum, then supply 120 USDC to aave, then stake 0.05 eth on lido',
    source: 'rebalance full batch', expect: 'action',
  },

  // Spot Guardian (briefing chip + manage verbs)
  { ask: 'Protect my spot ETH with a 10% stop loss', source: 'briefing spot-guard chip', expect: 'action' },
  { ask: 'Protect 0.5 spot ETH with a stop loss at $1500', source: 'spot-guard sized variant', expect: 'action' },
  { ask: 'cancel my ETH spot protection', source: 'spot-guard manage', expect: 'action' },

  // Chart-overlay act-on-it chips (SEND on click since 2026-07-28; rendered
  // for every chartable symbol). The HL-perp row parses as a swap and the
  // route answers the Hyperliquid door chips instead of "unknown token".
  { ask: 'Buy $50 of ETH', source: 'chart overlay buy chip', expect: 'action' },
  { ask: 'Sell $50 of ETH', source: 'chart overlay sell chip (live 2026-07-28 dead-end)', expect: 'action' },
  { ask: 'DCA $10 into ETH weekly', source: 'chart overlay DCA chip', expect: 'action' },
  { ask: 'Sell $50 of HYPE', source: 'chart overlay sell chip on an HL perp', expect: 'action' },

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
  { ask: 'can I fo $2 of USDC on AAVE', source: 'live 2026-09-04 /p/bAUVA5uz2Axn (planner invented a spoke)', expect: 'action' },
  { ask: 'supply $100 of USDC on aave at the best rate', source: 'dollar + rate preference', expect: 'action' },
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
  { ask: 'I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop', source: 'house link /i/protected-long (pure intent — funding auto-offered, 2x set venue-side)', expect: 'action' },
  { ask: 'Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop', source: 'retired house-link phrasing (row history / shared links)', expect: 'action' },
  // The NFT READS — each answers with a live OpenSea artifact (website#573
  // for the gallery, this PR for the two market chips that fell through to
  // "I can't check real-time floor prices").
  { ask: 'Show my NFTs', source: 'house link /i/my-nfts', expect: 'action' },
  {
    ask: 'What are my NFTs worth right now — check the floor prices of my collections on OpenSea?',
    source: 'splash/opensea chip', expect: 'action',
  },
  { ask: 'Are there any offers on the NFTs I own?', source: 'splash/opensea chip', expect: 'action' },
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
  // Limit orders, BOTH operand orders (live 2026-08-03: the buy-led form fell
  // to the planner, which recommended Uniswap/CoW Swap/1inch by name).
  { ask: 'place a limit order to buy 1 UNI for 4 USDC on base', source: 'live 2026-08-03 (buy-led limit)', expect: 'action' },
  { ask: 'limit sell 5 USDC for 2 UNI on base', source: 'live 2026-08-03 (sell-led control)', expect: 'action' },
  { ask: 'limit order: buy 2 WETH for at most 6000 USDC', source: 'limit clarify example (buy-led)', expect: 'action' },
  { ask: 'limit order: sell 0.5 WETH for at least 1750 USDC', source: 'limit clarify example (sell-led)', expect: 'action' },

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
