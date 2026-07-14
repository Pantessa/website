#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party Robinhood Chain MCP —
// `robinhood-free` (repo Yeetful/free-mcps, service `robinhood`, deploys to
// robinhood-mcp.yeetful.com) — as a directory row with one mcp_endpoints
// child per TOOL, mirroring seed-lido-free.ts exactly. priceUsd '0' =
// explicitly free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/robinhood/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Amounts are decimal strings in HUMAN units
// ("100" USDG, "0.5" AAPL), never wei/atoms; `user` is an 0x… address
// ($USER_ADDRESS); `marketId` is the 32-byte Morpho id from lending_markets.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run AFTER the service is
// live:
//   DATABASE_URL=... npx tsx scripts/seed-robinhood-free.ts
// Local-dev overlay without touching Neon:
//   FREE_ROBINHOOD_MCP_BASE=http://localhost:3271/mcp npx tsx scripts/seed-robinhood-free.ts --print-extra-env
import { Prisma } from '@prisma/client'

type Param = {
  group: 'body'
  name: string
  type: string
  description: string
  required: boolean
}

const p = (name: string, type: string, description: string, required = false): Param => ({
  group: 'body',
  name,
  type,
  description,
  required,
})

const ROBINHOOD_BASE = process.env.FREE_ROBINHOOD_MCP_BASE ?? 'https://robinhood-mcp.yeetful.com/mcp'

const user = (role: string): Param =>
  p('user', 'string', `EVM address (0x…) of ${role} — pass "$USER_ADDRESS" for the connected user.`, true)
const amount = (what: string): Param =>
  p('amount', 'string', `${what} as a decimal string in HUMAN units, e.g. "100" or "0.5" (not wei/atoms).`, true)
const amountOrMax = (what: string): Param =>
  p('amount', 'string', `${what} as a decimal string in HUMAN units, or "max" for the full balance/debt.`, true)
const marketId = (): Param =>
  p('marketId', 'string', 'The 32-byte Morpho market id (0x…, 64 hex chars) — from `lending_markets`. Never a name or symbol.', true)
const token = (name: string, what: string, required = true): Param =>
  p(name, 'string', `${what} — token SYMBOL ("AAPL", "TSLA", "USDG", case-insensitive) or 0x… address on Robinhood Chain.`, required)

const SERVICE = {
  slug: 'robinhood-free',
  name: 'Robinhood Chain (Free)',
  description:
    'Tokenized stocks & ETFs on Robinhood Chain (chain id 4663), free and non-gated: live Chainlink prices with corporate-action multipliers, whole-wallet portfolios (AAPL/TSLA/SPY/… + USDG), Morpho lending & borrowing (markets, positions, health factor), Uniswap v4 stock-token swap quotes with a Chainlink cross-check, the canonical Ethereum bridge, and construction-only build_* tools that return UNSIGNED transactions the user signs — swap, lend, post collateral, borrow, repay, withdraw, bridge. Swap builds are re-decoded and guard-verified before they are returned; lending builds fail closed on health factor. Never holds keys, never signs, never submits. Rate-limited. By Yeetful.',
  category: 'DeFi',
  kind: 'data',
  priceUsd: '0',
  networks: ['Robinhood Chain'],
  websiteUrl: 'https://github.com/Yeetful/free-mcps',
  // callable:false like the sibling free rows — planner-driven via the
  // mcp_endpoints children below.
  callable: false,
  protocol: 'mcp',
  endpoint: ROBINHOOD_BASE,
  tags: ['defi', 'stocks', 'robinhood', 'tokenized-stocks', 'morpho', 'lending', 'uniswap', 'bridge'],
  exampleQueries: [
    'what stocks can I trade on Robinhood Chain?',
    'buy AAPL with 500 USDG on robinhood',
    'lend 100 USDG on Morpho on Robinhood Chain',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; featured?: boolean }> = [
  {
    name: 'portfolio',
    featured: true,
    description:
      "Whole-wallet view on Robinhood Chain: native ETH, every tokenized stock/ETF (AAPL, TSLA, SPY, …), USDG/USDe/WETH — balances with live Chainlink USD values and a total. The 'what do I hold on Robinhood Chain?' tool. Morpho lending positions live in lending_position.",
    params: [user('the account')],
  },
  {
    name: 'prices',
    featured: true,
    description:
      "Batch Chainlink USD prices for Robinhood Chain tokens — pass symbols for specific ones or nothing for the whole board. Prices are staleness-checked and already include corporate-action multipliers. 'Price check TSLA and NVDA on-chain.'",
    params: [p('tokens', 'string[]', 'Symbols/addresses to price, e.g. ["TSLA","NVDA"]. Omit for every token with a feed.')],
  },
  {
    name: 'stock_tokens',
    description:
      "The tokenized stocks & ETFs on Robinhood Chain (AAPL, TSLA, NVDA, SPY, QQQ, …) plus the money tokens (USDG, USDe, WETH) — symbol, name, contract address, decimals, Chainlink feed. 'Which stocks can I trade on Robinhood Chain?'",
    params: [],
  },
  {
    name: 'token_info',
    description:
      "One Robinhood Chain token in depth: live Chainlink USD price (staleness-checked), total supply, and ERC-8056 corporate-action state (uiMultiplier, pending multiplier changes, oracle pause). 'What's AAPL trading at on-chain?'",
    params: [token('token', 'The token to inspect')],
  },
  {
    name: 'chain_info',
    description:
      'Robinhood Chain (chain id 4663) at a glance: the Arbitrum-Orbit stack, RPC/explorer endpoints, and where each protocol lives — Uniswap v4 for stock trading, Morpho for lending, the canonical bridge.',
    params: [],
  },
  {
    name: 'lending_markets',
    description:
      "Morpho lending markets on Robinhood Chain: loan/collateral pair, supply & borrow APY, utilization, LLTV, market size — returns the marketId every build_* lending tool needs. Curated markets by default; includeUnlisted adds permissionless ones (early stock-collateral markets). 'What can I lend or borrow on Robinhood Chain?'",
    params: [p('includeUnlisted', 'boolean', 'Also show permissionless (unvetted) markets. Default false.')],
  },
  {
    name: 'lending_position',
    description:
      "A wallet's Morpho position on Robinhood Chain, computed from on-chain state: supplied assets (earning), posted collateral, borrowed debt with accrued interest, borrowing power, health factor per market. 'How are my loans doing / can I get liquidated?'",
    params: [user('the account'), p('marketIds', 'string[]', 'Specific 32-byte market ids to check. Omit to scan all known markets.')],
  },
  {
    name: 'quote',
    description:
      "Live Uniswap v4 swap quote on Robinhood Chain — tokenized stocks quote against USDG ('how much AAPL for 500 USDG?'). Scans the standard no-hook pools, best price wins, and cross-checks against Chainlink with a divergence warning. Quote only — build_swap prepares the signable transactions.",
    params: [token('sellToken', 'Token to sell'), token('buyToken', 'Token to buy'), amount('Amount of sellToken to swap')],
  },
  {
    name: 'build_swap',
    description:
      "Prepare a Uniswap v4 stock-token swap on Robinhood Chain — returns UNSIGNED {action:'send_transaction'} steps for the USER to sign: exact-amount Permit2 approvals only when live allowances are short, then ONE Universal Router swap whose output credits the signer. Every build is re-decoded and guard-verified against the quote; balance checked first. 'Buy AAPL with 500 USDG.'",
    params: [
      user('the wallet that swaps, receives the output, and signs'),
      token('sellToken', 'Token to sell'),
      token('buyToken', 'Token to buy'),
      amount('Amount of sellToken to swap'),
      p('slippageBps', 'number', 'Slippage tolerance in basis points (100 = 1%). Default 100.'),
    ],
  },
  {
    name: 'build_lend',
    description:
      "Prepare a Morpho SUPPLY on Robinhood Chain — UNSIGNED steps lending the market's LOAN asset to earn the supply APY (exact-amount approve step only when the live allowance is short; balance checked first). 'Lend 100 USDG.'",
    params: [user('the wallet that lends and signs'), marketId(), amount('LOAN-asset amount to supply')],
  },
  {
    name: 'build_supply_collateral',
    description:
      "Prepare UNSIGNED steps posting COLLATERAL into a Morpho market on Robinhood Chain (collateral doesn't earn; it unlocks borrowing the loan asset). 'Post 1 TSLA as collateral.'",
    params: [user('the wallet that posts collateral and signs'), marketId(), amount('COLLATERAL-asset amount to post')],
  },
  {
    name: 'build_borrow',
    description:
      "Prepare an UNSIGNED Morpho borrow against posted collateral on Robinhood Chain. Fails closed: refuses beyond borrowing power or market liquidity, states the resulting health factor, warns when it's thin. 'Borrow 50 USDG against my TSLA.'",
    params: [user('the wallet that borrows, receives the loan asset, and signs'), marketId(), amount('LOAN-asset amount to borrow')],
  },
  {
    name: 'build_repay',
    description:
      'Prepare UNSIGNED steps repaying Morpho debt on Robinhood Chain. amount:"max" clears the debt exactly (repaid by shares, immune to interest drift between build and sign). Approve step included when needed.',
    params: [user('the wallet that repays and signs'), marketId(), amountOrMax('LOAN-asset amount to repay')],
  },
  {
    name: 'build_withdraw',
    description:
      'Prepare an UNSIGNED withdrawal of assets supplied to a Morpho market on Robinhood Chain (amount:"max" empties the position including accrued interest). Refuses when high utilization leaves too little un-borrowed liquidity.',
    params: [user('the wallet that withdraws and signs'), marketId(), amountOrMax('LOAN-asset amount to withdraw')],
  },
  {
    name: 'build_withdraw_collateral',
    description:
      'Prepare an UNSIGNED Morpho collateral withdrawal on Robinhood Chain. Fails closed: refuses any withdrawal that would leave outstanding debt under-collateralized or the health factor razor-thin.',
    params: [user('the wallet that withdraws and signs'), marketId(), amountOrMax('COLLATERAL-asset amount to withdraw')],
  },
  {
    name: 'bridge_info',
    description:
      'How to move funds between Ethereum and Robinhood Chain over the canonical Arbitrum bridge: routes, timing (deposits ≈ minutes, withdrawals ≈ 7 days + an L1 claim), contracts, and what needs the bridge UI instead.',
    params: [],
  },
  {
    name: 'build_bridge_deposit',
    description:
      "Prepare an UNSIGNED ETHEREUM-MAINNET transaction (chainId 1!) bridging ETH into Robinhood Chain via the canonical Delayed Inbox — the same address is credited on the L2 within minutes; L1 balance checked first. The wallet must be on Ethereum to sign. 'Bridge 0.1 ETH to Robinhood Chain.'",
    params: [user('the wallet that deposits on L1 and receives on Robinhood Chain'), amount('ETH amount to bridge in')],
  },
  {
    name: 'build_bridge_withdraw',
    description:
      "Prepare an UNSIGNED Robinhood Chain transaction starting an ETH withdrawal to Ethereum over the canonical bridge. NOT instant: the exit waits out the ~7-day challenge period, then needs a one-time claim on Ethereum (bridge UI). 'Withdraw 0.5 ETH back to mainnet.'",
    params: [
      user('the wallet exiting from Robinhood Chain'),
      amount('ETH amount to withdraw'),
      p('destination', 'string', 'Ethereum address to receive the ETH. Defaults to the sender.'),
    ],
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${ROBINHOOD_BASE}/${t.name}`,
    description: t.description,
    priceUsd: '0',
    parameters: t.params,
    category: SERVICE.category,
    tags: SERVICE.tags,
    exampleQueries: SERVICE.exampleQueries,
  }))
  console.log(`EXTRA_MCP_ROWS='${JSON.stringify(rows)}'`)
  console.log(`EXTRA_MCP_ENDPOINTS='${JSON.stringify(endpoints)}'`)
}

async function main() {
  const { default: prisma } = await import('../lib/db')
  const server = await prisma.mcpServer.upsert({
    where: { slug: SERVICE.slug },
    create: { ...SERVICE, gated: false },
    update: { ...SERVICE, gated: false },
  })

  await prisma.mcpEndpoint.deleteMany({ where: { serverId: server.id } })
  await prisma.mcpEndpoint.createMany({
    data: TOOLS.map((t, i) => ({
      serverId: server.id,
      method: 'POST',
      url: `${ROBINHOOD_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'robinhood-chain',
      provider: 'Yeetful (free)',
      position: i,
      featured: t.featured === true,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${ROBINHOOD_BASE} (featured: portfolio, prices)`)
  await prisma.$disconnect()
}

if (process.argv.includes('--print-extra-env')) {
  printExtraEnv()
} else {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
