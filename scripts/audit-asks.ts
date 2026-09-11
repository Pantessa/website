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
  { ask: '2X long $12 of HYPE, then protect my HYPE long with a 5% stop', source: 'typed reel (mint stage ghost, 2026-09-04)', expect: 'action' },
  // MARKETS/MSG (2026-09-11): the hero reel's Markets moment — a chart ask is
  // the native chart gate (the overlay opens, no turn burned), never the planner.
  { ask: 'Show me the AAPL chart', source: 'hero reel (Markets moment, 2026-09-11)', expect: 'action' },
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
  // The voice door (2026-09-09): spoken asks land here after
  // lib/voice-ask.ts normalizes them ("ten dollars worth of eth" → "$10
  // worth of eth"); these are the normalized forms the ladder must read.
  { ask: 'show me the ETH chart', source: 'voice door (chart read → overlay)', expect: 'action' },
  { ask: 'pull up bitcoin candles', source: 'voice door (chart read, spoken name)', expect: 'action' },
  { ask: 'show me the USDC chart', source: 'voice door (chartless → refused by name)', expect: 'clarify-ok' },
  { ask: 'buy $10 worth of eth', source: 'voice door (normalized spoken buy)', expect: 'action' },
  { ask: 'Buy $50 of ETH', source: 'chart overlay buy chip', expect: 'action' },
  { ask: 'Sell $50 of ETH', source: 'chart overlay sell chip (live 2026-07-28 dead-end)', expect: 'action' },
  { ask: 'DCA $10 into ETH weekly', source: 'chart overlay DCA chip', expect: 'action' },
  // Stock charts (2026-09-10): the same overlay chips on an AAPL chart land
  // on the Robinhood Chain builders (stock → 4663 inference), and the chart
  // ask itself pops the overlay by ticker or company name.
  { ask: 'Buy $50 of AAPL', source: 'chart overlay buy chip on a stock chart', expect: 'action' },
  { ask: 'Sell $50 of AAPL', source: 'chart overlay sell chip on a stock chart', expect: 'action' },
  { ask: 'DCA $10 into AAPL weekly', source: 'chart overlay DCA chip on a stock chart', expect: 'action' },
  { ask: 'show me the AAPL chart', source: 'stock chart ask (ticker)', expect: 'action' },
  { ask: 'show me the apple chart', source: 'stock chart ask (company name, spoken)', expect: 'action' },
  { ask: 'pull up the nvidia candles', source: 'stock chart ask (company name)', expect: 'action' },
  { ask: 'Sell $50 of HYPE', source: 'chart overlay sell chip on an HL perp', expect: 'action' },
  // Whole-holding sells — sized from the live balance at build (live
  // 2026-09-07: fell to the planner's walkthrough; the numbered twin built).
  { ask: 'Sell all my AAPL for USDG on Robinhood Chain', source: 'live 2026-09-07 (sell-all → planner walkthrough)', expect: 'action' },
  { ask: 'sell my entire ETH balance', source: 'sell-all, bare (route buys the chain stable)', expect: 'action' },

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
  // A Robinhood-destination leg is a LiFi FUNDING move (NEAR can't reach
  // 4663) and $5 is under the $9 parity floor — the honest answer is the
  // floor chips, never a leg built to be withheld (#694). $20 compiles.
  { ask: 'Swap 5 USDC from base to USDG on robinhood', source: 'funding-plan leg chip (under the $9 floor → floor chips)', expect: 'clarify-ok' },
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

  // ── GTM squad 2026-09-08 (PATHS): UI strings the sweep found OUTSIDE the
  //    corpus. Every one is tappable or printed somewhere a stranger lands.
  { ask: 'Buy $12 of AAPL', source: 'hero typed reel + mint starter chip (typed-asks.ts)', expect: 'action' },
  { ask: 'Tile my wallet 50% ETH, 30% USDC, 20% wstETH', source: 'hero typed reel + /mosaic', expect: 'action' },
  { ask: 'tile my wallet 60% ETH, 40% USDC', source: 'house mosaic /i/tile-classic', expect: 'action' },
  { ask: 'tile my wallet 45% ETH, 45% USDC, 10% CBBTC', source: 'house mosaic /i/tile-barbell', expect: 'action' },
  { ask: 'tile my wallet 50% USDC, 30% ETH, 20% WSTETH', source: 'house mosaic /i/tile-steady', expect: 'action' },
  { ask: 'protect my eth long with a 5% stop', source: '/docs/guardian', expect: 'action' },
  { ask: 'take profit on my eth long at $2100', source: '/docs/guardian (take-profit grammar)', expect: 'action' },
  { ask: 'buy $25 of ETH every week on base', source: '/docs/dca', expect: 'action' },
  { ask: 'buy $10 of AAPL every week on robinhood', source: '/docs/dca', expect: 'action' },
  { ask: 'list my dcas', source: '/docs/dca + splash', expect: 'action' },
  { ask: 'pause my ETH dca', source: '/docs/dca', expect: 'action' },
  { ask: 'cancel my ETH dca', source: '/docs/dca', expect: 'action' },
  { ask: 'make my ETH dca autonomous', source: '/docs/dca (autopilot arm)', expect: 'action' },
  { ask: 'turn off my dca autopilot', source: '/docs/dca (autopilot disarm)', expect: 'action' },
  { ask: 'dca $25 into ETH daily on base', source: '/docs/jobs', expect: 'action' },
  { ask: 'Swap $5 of ETH to USDC on Base', source: '/docs/desk', expect: 'action' },
  { ask: 'Swap $40 of USDC to ETH on Base', source: 'RosterTranscript', expect: 'action' },
  { ask: 'Swap 3.5 USDC from Base to USDC on Arbitrum', source: '/docs/_paid-doors', expect: 'action' },
  { ask: 'buy $25 of ETH weekly', source: 'roster mandate example', expect: 'action' },
  { ask: 'protect my ETH in my wallet with a 10% stop', source: 'roster mandate example (spot guard)', expect: 'action' },
  { ask: 'supply 25 USDC to aave', source: 'roster mandate example', expect: 'action' },
  { ask: 'stake 0.5 ETH on lido', source: 'roster mandate example', expect: 'action' },
  { ask: 'Stake 0.0132 ETH on Lido as wstETH', source: 'lido chip (as wstETH form)', expect: 'action' },
  { ask: 'Buy $10 of NVDA on Robinhood Chain', source: 'robinhood splash chip (non-AAPL ticker)', expect: 'action' },
  { ask: 'Swap 0.5 NVDA for USDG on Robinhood Chain', source: 'robinhood splash chip (stock sell)', expect: 'action' },
  { ask: 'Swap 0.01 ETH for USDG on Robinhood Chain', source: 'robinhood splash chip (ETH → USDG)', expect: 'action' },
  { ask: 'send all my USDG on robinhood to nate.eth', source: 'transfer chain chip (USDG lane)', expect: 'action' },
  { ask: 'Fund robinhood chain with $30 from ethereum using eth including gas, then buy $25 of NVDA', source: 'funding chip (using-eth + gas variant)', expect: 'action' },
  { ask: 'Fund robinhood chain with $9 from optimism, then buy $12 of SPY', source: 'funding chip (Optimism origin, #707)', expect: 'action' },
  { ask: 'lend 100 USDC on morpho', source: 'morpho seeded chip', expect: 'action' },
  { ask: 'lend 100 USDG on Morpho on Robinhood Chain', source: 'robinhood seeded chip', expect: 'action' },
  { ask: 'Build a Uniswap swap: 50 USDC for cbBTC', source: 'uniswap seeded chip (colon after the verb)', expect: 'action' },
  { ask: '2x short $25 of BTC on hyperliquid', source: 'HL size chip (short + 2x)', expect: 'action' },
  { ask: 'Protect my SYRUP short with a 10% stop loss', source: 'briefing chip (short side)', expect: 'action' },
  { ask: 'Sell $50 of HYPE', source: 'chart overlay chip (HL-only symbol → HL door)', expect: 'any' },
  // Prod ask_failures 2026-08-31 → 09-07 (the shapes strangers typed):
  { ask: 'buy $12 orth of AAPL', source: 'prod 2026-09-07 (typo of "worth")', expect: 'action' },
  { ask: 'buy $12 worth of APPL using vredit cartd', source: 'prod 2026-08-31 (fiat spend clause)', expect: 'action' },
  { ask: 'buy $12 of AAPL with my credit card', source: 'stranger phrasing of the on-ramp intent', expect: 'action' },
  // Robinhood-destination cross-chain asks are FUNDING moves (NEAR can't reach
  // 4663): the jobs layer claims them ahead of the NEAR door. $1 is under the
  // $9 parity floor → chips for the smallest clean move (never a leg built to
  // be withheld).
  { ask: 'Convert $1 USDC from Base to USDG on Robinhood Chain via cross-chain swap', source: 'prod 2026-09-04 (under the $9 floor → floor chips)', expect: 'clarify-ok' },
  { ask: 'Swap 20 USDC from Base to USDG on Robinhood Chain', source: 'prod 2026-09-04 shape, fundable size', expect: 'action' },
  { ask: 'bridge 20 USDC from arbitrum to robinhood', source: 'bridge phrasing, Robinhood destination', expect: 'action' },
  { ask: 'move 25 USDC from optimism to robinhood chain', source: 'OP origin → 4663 (#707 origin)', expect: 'action' },
  { ask: 'swap 0.01 ETH from base to robinhood', source: 'ETH-sized funding ask → dollar chips', expect: 'clarify-ok' },
  { ask: 'swap 20 USDC from base to AAPL on robinhood', source: 'funded buy phrased as a bridge → fund-then-buy chip', expect: 'clarify-ok' },
  // Non-EVM coins: the chart overlay's own chips on a SOL/XRP/DOGE chart.
  // Base's open list carries look-alikes; the door refuses by name with the
  // Hyperliquid side chips.
  { ask: 'Buy $50 of SOL', source: 'chart overlay chip (non-EVM home → HL door)', expect: 'clarify-ok' },
  { ask: 'Sell $50 of SOL', source: 'chart overlay chip (non-EVM home → HL door)', expect: 'clarify-ok' },
  { ask: 'Buy $50 of XRP', source: 'chart overlay chip (no EVM home at all)', expect: 'clarify-ok' },
  { ask: 'DCA $10 into SOL weekly', source: 'chart overlay chip (hidden now; typed form refuses by name)', expect: 'clarify-ok' },
  { ask: 'long $50 of SOL on hyperliquid', source: 'the HL door chip resume', expect: 'action' },
  // The flagship link's most natural follow-up — a READ we hold.
  { ask: 'what stocks can I buy on robinhood', source: 'prod 2026-09-08 (planner → brokerage prose / paid x402 call)', expect: 'action' },
  { ask: 'show a list of all the available stocks i can buy on robinhood', source: 'prod 2026-09-08 verbatim', expect: 'action' },
  { ask: 'which tokenized stocks do you support', source: 'stranger phrasing', expect: 'action' },
  { ask: 'swap 10 USDG → AAPL on Uniswap', source: 'prod 2026-09-02 (card-title arrow retyped)', expect: 'action' },
  { ask: 'Swap 12 USDG → TSLA', source: 'card title retyped', expect: 'action' },
  { ask: 'Send 5 USDC to 0x1111111111111111111111111111111111111111 on Optimism', source: 'squad replay (OP send, #707 gap)', expect: 'action' },
  // ── GTM squad 2026-09-08 (PATHS round 3): spelled-out dollars + the Aave tail ──
  // A link's A/B phrasing (links.md r2): "two dollars" fell past every dollar
  // grammar to the planner, whose tool read it as 2 ETH — for a $0 wallet.
  { ask: 'Convert two dollars of ETH to USDC on Base', source: 'links r2 A/B phrasing (planner fall → $5k build for a $0 wallet)', expect: 'action' },
  { ask: "swap five dollars' worth of ETH for USDC", source: 'spelled dollars + possessive', expect: 'action' },
  { ask: 'buy a hundred bucks of AAPL', source: 'spelled dollars (hundred)', expect: 'action' },
  { ask: 'buy twenty-five dollars of TSLA on robinhood', source: 'spelled dollars (compound)', expect: 'action' },
  { ask: 'long ten dollars of HYPE on hyperliquid', source: 'spelled dollars → HL grammar', expect: 'action' },
  { ask: 'supply two dollars of USDC to aave', source: 'spelled dollars → Aave grammar', expect: 'action' },
  // SECURITY r2: a supply naming another wallet must refuse by name, never
  // half-parse and build for the signer.
  { ask: 'supply 5 USDC to aave for nate.eth', source: 'security r2 (Aave tail)', expect: 'clarify-ok' },

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
  // ── GTM squad 2026-09-08 — three more things real users do ───────────────
  // Every first-class chain, not just the one the example happened to name:
  // an ask that says "on Base" must land the same way "on Optimism" (#707's
  // half-added chain reached prod because nothing replayed the other four).
  const onChain = ask.match(/\bon\s+(base|ethereum|arbitrum|optimism|robinhood(?:\s+chain)?)\b/i)
  // NFT asks are exempt: OpenSea has no market on Optimism / Robinhood Chain
  // and the NFT gate refuses those BY NAME (an honest limit, not a dead-end).
  if (onChain && !/\bnfts?\b/i.test(ask)) {
    for (const c of ['Base', 'Ethereum', 'Arbitrum', 'Optimism', 'Robinhood Chain']) {
      if (c.toLowerCase().startsWith(onChain[1].toLowerCase().slice(0, 4))) continue
      out.push({ label: `chain:${c}`, ask: ask.replace(onChain[0], `on ${c}`) })
    }
  }
  // A one-edit typo of the "worth" we print on every card ("$12 orth of").
  if (/\$\d+(?:\.\d+)?\s+worth\s+of\b/i.test(ask)) out.push({ label: 'typo:orth', ask: ask.replace(/\bworth\s+of\b/i, 'orth of') })
  else if (/\$\d+(?:\.\d+)?\s+of\s+[A-Za-z]/i.test(ask)) out.push({ label: 'typo:orth', ask: ask.replace(/(\$\d+(?:\.\d+)?)\s+of\b/i, '$1 orth of') })
  // The arrow our own cards print ("USDG → AAPL"), retyped by the user.
  const pair = ask.match(/\b(swap|sell|convert|trade)\s+(\$?\d+(?:\.\d+)?(?:\s+worth)?(?:\s+of)?\s+\$?[A-Za-z]{2,12})\s+(for|to|into)\s+(\$?[A-Za-z]{2,12})\b(?!\s+(?:on|to)\s)/i)
  // (limit orders keep "for at least/most" — that phrase IS the grammar)
  if (pair && !/\bfrom\b/i.test(ask) && !/^at$/i.test(pair[4])) out.push({ label: 'arrow', ask: ask.replace(pair[0], `${pair[1]} ${pair[2]} → ${pair[4]}`) })
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

  // Link origin must not change the outcome CLASS either: the same sentence
  // minted as an /i link reaches the same rung (squad PATHS r3 — the ladder's
  // `origin` flag is where a deliberate divergence gets mirrored).
  const viaLink = simulateLadder(entry.ask, { origin: 'link' })
  if (viaLink.gate !== base.gate || viaLink.kind !== base.kind) {
    console.log(header)
    flag(`link origin drifted from chat: ${base.gate}/${base.kind} → ${viaLink.gate}/${viaLink.kind}${viaLink.note ? ` — "${viaLink.note}"` : ''}`)
  }

  // Mutations must not change the outcome CLASS (gate + kind) of a working ask.
  if (base.kind !== 'action') continue
  for (const m of mutationsOf(entry.ask)) {
    const got = simulateLadder(m.ask)
    if (got.gate === base.gate && got.kind === base.kind) continue
    // A typo'd chain word landing in the SAME kind via the cross-chain gate
    // (or vice versa) still serves the user — only kind downgrades count.
    if (got.kind === 'action') continue
    // Robinhood Chain as a cross-chain DESTINATION is a funding move (NEAR
    // Intents can't deliver to 4663): the jobs layer claims it, and a leg
    // under the $9 parity floor or sized in ETH answers with chips that
    // round-trip — by design (#694), not a dead-end.
    if (m.label === 'chain:Robinhood Chain' && got.gate === 'jobs' && got.kind === 'clarify' && got.chips) continue
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
