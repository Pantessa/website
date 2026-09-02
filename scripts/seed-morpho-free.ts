#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party Morpho (Blue) MCP — `morpho-free`
// (repo Yeetful/free-mcps, service `morpho`, deploys to
// morpho-mcp.yeetful.com) — as a directory row with one mcp_endpoints child
// per TOOL, mirroring seed-aave-free.ts exactly. priceUsd '0' = free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/morpho/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. TWO traps the descriptions must keep the
// planner out of:
//   · marketId is the 32-BYTE MARKET ID (0x…, 64 hex chars) returned by
//     `markets` — NEVER a token symbol or a token address. Sending "USDC"
//     is the exact -32602 the native layer (lib/morpho-supply.ts) prevents.
//   · chainId is 1 (Ethereum) or 8453 (Base), DEFAULT 8453 — market ids are
//     chain-specific, so a market found on Base must be used with 8453.
//     (Morpho on Robinhood Chain 4663 lives in the robinhood MCP, not here.)
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run AFTER the service is
// deployed to morpho-mcp.yeetful.com:
//   DATABASE_URL=... npx tsx scripts/seed-morpho-free.ts
// Local-dev overlay without touching Neon:
//   FREE_MORPHO_MCP_BASE=http://localhost:3273/mcp npx tsx scripts/seed-morpho-free.ts --print-extra-env
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

const MORPHO_BASE = process.env.FREE_MORPHO_MCP_BASE ?? 'https://morpho-mcp.yeetful.com/mcp'

const user = (role: string): Param =>
  p('user', 'string', `EVM address (0x…) of ${role} — pass "$USER_ADDRESS" for the connected user.`, true)
const chainId = (): Param =>
  p('chainId', 'number', 'Chain id: 8453 = Base (default), 1 = Ethereum mainnet. Market ids are chain-specific — use the chainId the market came from.')
const marketId = (): Param =>
  p('marketId', 'string', 'The 32-byte Morpho market id (0x…, 64 hex chars) from `markets` — NEVER a token symbol or address.', true)
const amount = (which: string): Param =>
  p('amount', 'string', `${which} as a decimal string in HUMAN units, e.g. "100" USDC or "0.5" WETH (not wei/atoms).`, true)
const amountOrMax = (which: string): Param =>
  p('amount', 'string', `${which} as a decimal string in HUMAN units, or "max" for the full balance/debt.`, true)

const SERVICE = {
  slug: 'morpho-free',
  name: 'Morpho (Free)',
  description:
    'Morpho (Blue) lending on Base and Ethereum, computed from on-chain state, free and non-gated: curated markets with live supply/borrow APYs, per-market deep-dives, full account positions (supplied, collateral, debt, health factor), health-factor previews, and construction-only build_* tools that return UNSIGNED approve→act transactions the user signs — lend, post/withdraw collateral, borrow, repay, withdraw. Never holds keys, never signs, never submits. Rate-limited. By Pantessa.',
  category: 'DeFi',
  kind: 'data',
  priceUsd: '0',
  networks: ['Base', 'Ethereum'],
  websiteUrl: 'https://github.com/Pantessa/free-mcps',
  // callable:false like the sibling free rows — planner-driven via the
  // mcp_endpoints children below (and the NATIVE morpho layer calls
  // markets/market_info/build_* directly through `endpoint`).
  callable: false,
  protocol: 'mcp',
  endpoint: MORPHO_BASE,
  tags: ['defi', 'lending', 'morpho', 'yield', 'borrow'],
  exampleQueries: [
    'lend 100 USDC on morpho',
    'what am I earning on morpho?',
    'where can I borrow against cbBTC on morpho?',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; featured?: boolean }> = [
  {
    name: 'markets',
    featured: true,
    description:
      "Morpho (Blue) lending markets on Base or Ethereum: loan/collateral pair, supply & borrow APY, utilization, LLTV, and market size in USD. Curated (listed) markets by default; includeUnlisted adds permissionless ones. Answers 'what can I lend/borrow on Morpho?' — use the returned 32-byte marketId (never a symbol) with the build_* tools.",
    params: [chainId(), p('includeUnlisted', 'boolean', 'Also show permissionless (unvetted) markets. Default false.')],
  },
  {
    name: 'market_info',
    description:
      "One Morpho market in depth, straight from the chain: loan + collateral assets (addresses, decimals), LLTV, live supply/borrow APY, utilization, available liquidity, fee, and the oracle's collateral price. Use before lending or borrowing to sanity-check the market.",
    params: [chainId(), marketId()],
  },
  {
    name: 'position',
    featured: true,
    description:
      "A wallet's Morpho position on Base or Ethereum, computed from on-chain state: supplied assets (earning), posted collateral, borrowed debt with accrued interest, borrowing power, and health factor per market. This is the 'show my Morpho position / can I get liquidated?' tool. Scans the 100 largest indexed markets by default; pass marketIds to narrow or to reach a niche market.",
    params: [
      user('the account'),
      chainId(),
      p('marketIds', 'string', 'Specific 32-byte market ids to check (array, max 20). Omit to scan all known markets.'),
    ],
  },
  {
    name: 'preview',
    description:
      'Simulate a lend/supply_collateral/borrow/repay/withdraw/withdraw_collateral BEFORE building it: health factor now vs after, borrowing power after — computed locally from live on-chain state and the market\'s oracle. Nothing is built or signed. Use this before build_borrow / a large build_withdraw_collateral so the user sees the health-factor impact first.',
    params: [
      p('action', 'string', 'One of "lend" | "supply_collateral" | "borrow" | "repay" | "withdraw" | "withdraw_collateral".', true),
      user('the wallet the action would run as'),
      chainId(),
      marketId(),
      amountOrMax('Amount to simulate ("max" for repay/withdraw/withdraw_collateral only)'),
    ],
  },
  {
    name: 'build_lend',
    description:
      "Prepare transactions to lend an asset into a Morpho market and start earning the supply APY — returns UNSIGNED {action:'send_transaction'} steps (exact-amount approve first when allowance is short) for the USER to sign. Get the 32-byte marketId from `markets` first — the param validates a MARKET ID, not a symbol.",
    params: [user('the wallet that lends and signs'), chainId(), marketId(), amount('LOAN-asset amount to supply')],
  },
  {
    name: 'build_supply_collateral',
    description:
      "Prepare transactions to post collateral into a Morpho market (collateral doesn't earn; it unlocks borrowing the loan asset). Unsigned steps for the user.",
    params: [user('the wallet that posts and signs'), chainId(), marketId(), amount('COLLATERAL-asset amount to post')],
  },
  {
    name: 'build_borrow',
    description:
      'Prepare a borrow against posted Morpho collateral. Fails closed: refuses when the amount exceeds borrowing power or market liquidity, warns when the resulting health factor is thin. Unsigned steps.',
    params: [user('the wallet that borrows and signs'), chainId(), marketId(), amount('LOAN-asset amount to borrow')],
  },
  {
    name: 'build_repay',
    description:
      'Prepare transactions to repay Morpho debt. Pass "max" to clear the debt exactly (repaid by shares, immune to interest drift — the approve carries a ~0.05% buffer). Unsigned steps.',
    params: [user('the wallet that repays and signs'), chainId(), marketId(), amountOrMax('Amount to repay ("max" clears the debt)')],
  },
  {
    name: 'build_withdraw',
    description:
      'Prepare a withdrawal of assets supplied to a Morpho market ("max" empties the position including accrued interest). Refuses when market utilization leaves too little un-borrowed liquidity. Unsigned steps.',
    params: [user('the wallet that withdraws and signs'), chainId(), marketId(), amountOrMax('Amount to withdraw ("max" empties the position)')],
  },
  {
    name: 'build_withdraw_collateral',
    description:
      'Prepare a collateral withdrawal from a Morpho market. Fails closed: refuses any withdrawal that would leave outstanding debt under-collateralized or the health factor razor-thin. Unsigned steps.',
    params: [user('the wallet that withdraws and signs'), chainId(), marketId(), amountOrMax('Collateral amount to withdraw ("max" for all of it)')],
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${MORPHO_BASE}/${t.name}`,
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
      url: `${MORPHO_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'base',
      provider: 'Pantessa (free)',
      position: i,
      featured: t.featured === true,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${MORPHO_BASE} (featured: markets, position)`)
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
