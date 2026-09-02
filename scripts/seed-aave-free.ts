#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party Aave v4 MCP — `aave-free` (repo
// Yeetful/free-mcps, service `aave`, LIVE at aave-mcp.yeetful.com) — as a
// directory row with one mcp_endpoints child per TOOL, mirroring
// seed-near-intents-free.ts exactly. priceUsd '0' = explicitly free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/aave/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. NOTE the address-regex params: currency
// and spokeAddress take 0x… ADDRESSES (from `reserves`), never symbols —
// sending "USDC" is the exact -32602 the native supply layer
// (lib/aave-supply.ts) exists to prevent.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run:
//   DATABASE_URL=... npx tsx scripts/seed-aave-free.ts
// Local-dev overlay without touching Neon:
//   FREE_AAVE_MCP_BASE=http://localhost:3266/mcp npx tsx scripts/seed-aave-free.ts --print-extra-env
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

const AAVE_BASE = process.env.FREE_AAVE_MCP_BASE ?? 'https://aave-mcp.yeetful.com/mcp'

const user = (role: string): Param =>
  p('user', 'string', `EVM address (0x…) of ${role} — pass "$USER_ADDRESS" for the connected user.`, true)
const chainId = (): Param => p('chainId', 'number', 'Chain id (default 1 = Ethereum mainnet, the only live Aave v4 chain today).')
const spokeAddress = (required = true): Param =>
  p('spokeAddress', 'string', 'The spoke (market) contract 0x… ADDRESS — from `reserves` or `markets`. Never a name or symbol.', required)
const currency = (): Param =>
  p('currency', 'string', 'The underlying token 0x… ADDRESS — `asset.address` from `reserves` or `portfolio`. NEVER a symbol like "USDC".', true)
const amount = (extra = ''): Param =>
  p('amount', 'string', `Token amount as a decimal string in HUMAN units, e.g. "100" or "0.5" (not wei).${extra}`, true)

const SERVICE = {
  slug: 'aave-free',
  name: 'Aave (Free)',
  description:
    'Aave v4 lending on Ethereum via the official AaveKit API, free and non-gated: markets + pools with live supply/borrow APYs, full account portfolios (health factor, earned interest, accrued debt), health-factor previews, and construction-only build_* tools that return UNSIGNED approve→act transactions the user signs — supply, withdraw, borrow, repay, collateral toggles. Never holds keys, never signs, never submits. Rate-limited. By Pantessa.',
  category: 'DeFi',
  kind: 'data',
  priceUsd: '0',
  networks: ['Ethereum'],
  websiteUrl: 'https://github.com/Pantessa/free-mcps',
  // callable:false like the sibling free rows — planner-driven via the
  // mcp_endpoints children below (and the NATIVE supply layer calls
  // reserves/build_supply directly through `endpoint`).
  callable: false,
  protocol: 'mcp',
  endpoint: AAVE_BASE,
  tags: ['defi', 'lending', 'aave', 'yield', 'borrow'],
  exampleQueries: [
    'add 1 USDC to an Aave pool on Ethereum',
    'what am I earning on Aave?',
    'where can I earn on USDC?',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; featured?: boolean }> = [
  {
    name: 'portfolio',
    featured: true,
    description:
      "Full Aave v4 account view for an address: per-market positions (net balance, net APY, HEALTH FACTOR, borrowing power), every supply with EARNED INTEREST, every borrow with accrued debt — the 'show my Aave position / what am I earning?' tool.",
    params: [user('the Aave account'), chainId()],
  },
  {
    name: 'reserves',
    featured: true,
    description:
      "Aave v4 pool list with LIVE rates: supply APY, borrow APY, size, caps, collateral flags per asset. Filter with spokeAddress or symbols (['USDC']). Answers 'where can I earn on USDC?'. Use the returned asset.address + spokeAddress with the build_* tools.",
    params: [
      spokeAddress(false),
      p('symbols', 'string', 'Asset symbol filter, e.g. "USDC,WETH".'),
      chainId(),
      p('first', 'number', 'How many to return (default 30, max 100).'),
    ],
  },
  {
    name: 'markets',
    description:
      "Aave v4 market map: liquidity hubs (with TVL + utilization) and the spokes (user-facing markets) connected to them — 'what markets does Aave have?'.",
    params: [chainId()],
  },
  {
    name: 'balances',
    description:
      "Aave-listed tokens a wallet HOLDS (not yet deposited), each with USD value and best supply APY — 'what could I put to work on Aave?'. Follow up with build_supply.",
    params: [user('the wallet'), chainId()],
  },
  {
    name: 'activities',
    description: 'Recent Aave v4 history for an address — supplies, borrows, repays, withdrawals with amounts, market, timestamp, tx hash. Paginated via cursor.',
    params: [user('the account'), chainId(), p('cursor', 'string', "Pagination cursor from a previous call's nextCursor.")],
  },
  {
    name: 'preview',
    description:
      "Simulate a supply/borrow/withdraw/repay BEFORE building it: health factor now vs after, net APY, borrowing power. Nothing is built or signed — use before build_borrow / large withdrawals.",
    params: [
      p('action', 'string', 'One of "supply" | "borrow" | "withdraw" | "repay".', true),
      spokeAddress(),
      currency(),
      p('amount', 'string', 'Amount to simulate — omit with max:true (withdraw/repay only).'),
      p('max', 'boolean', 'Simulate the maximum (withdraw all / repay everything).'),
      user('the wallet the action would run as'),
      chainId(),
    ],
  },
  {
    name: 'build_supply',
    description:
      "Prepare an Aave v4 SUPPLY (deposit) — returns UNSIGNED {action:'send_transaction'} steps (approve first when allowance is short) for the USER to sign. Get spokeAddress + the token's 0x address from `reserves` first — both params validate ADDRESSES, not symbols.",
    params: [spokeAddress(), currency(), amount(), user('the wallet that supplies and signs'), chainId()],
  },
  {
    name: 'build_withdraw',
    description: 'Prepare an Aave v4 WITHDRAW back to the wallet (max:true = everything incl. accrued interest). Unsigned steps for the user.',
    params: [
      spokeAddress(),
      currency(),
      p('amount', 'string', 'Amount to withdraw — omit with max:true for "withdraw all".'),
      p('max', 'boolean', 'Withdraw the full balance (overrides amount).'),
      user('the wallet that withdraws and signs'),
      chainId(),
    ],
  },
  {
    name: 'build_borrow',
    description: "Prepare an Aave v4 BORROW against supplied collateral. Check `portfolio` first for remaining borrowing power; warn on tight health factors. Unsigned steps.",
    params: [spokeAddress(), currency(), amount(), user('the wallet that borrows and signs'), chainId()],
  },
  {
    name: 'build_repay',
    description: 'Prepare an Aave v4 REPAY of borrowed debt (max:true = clear it in full, accrued interest included). Unsigned steps.',
    params: [
      spokeAddress(),
      currency(),
      p('amount', 'string', 'Amount to repay — omit with max:true for "repay everything".'),
      p('max', 'boolean', 'Repay the full outstanding debt (overrides amount).'),
      user('the wallet that repays and signs'),
      chainId(),
    ],
  },
  {
    name: 'build_collateral_toggle',
    description: 'Prepare a transaction that enables/disables a SUPPLIED token as collateral. Disabling can drop the health factor — preview first when debt exists.',
    params: [
      spokeAddress(),
      currency(),
      p('enable', 'boolean', 'true = use as collateral, false = stop using as collateral.', true),
      user('the wallet that signs'),
      chainId(),
    ],
  },
  {
    name: 'check_transaction',
    description: 'After a prepared transaction is sent, confirm Aave has indexed it (true = portfolio data is current) before re-reading the portfolio.',
    params: [
      p('txHash', 'string', 'The transaction hash the wallet returned.', true),
      p('operation', 'string', 'One of SPOKE_SUPPLY | SPOKE_BORROW | SPOKE_WITHDRAW | SPOKE_REPAY.', true),
    ],
  },
  {
    name: 'graphql_query',
    description: 'Escape hatch: any READ-ONLY query against the official AaveKit v4 GraphQL API for data the other tools miss (holders, incentives, EUR summaries). Guarded allowlist.',
    params: [
      p('query', 'string', 'The GraphQL query text (a single query operation).', true),
      p('variables', 'string', 'Variables as a JSON object/string.'),
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
    url: `${AAVE_BASE}/${t.name}`,
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
      url: `${AAVE_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'ethereum',
      provider: 'Pantessa (free)',
      position: i,
      featured: t.featured === true,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${AAVE_BASE} (featured: portfolio, reserves)`)
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
