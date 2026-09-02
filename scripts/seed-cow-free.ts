#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party CoW Protocol MCP — `cow-free`
// (repo Yeetful/free-mcps, service `cow`) — as a directory row with one
// mcp_endpoints child per TOOL, mirroring seed-free-mcps.ts exactly
// (endpoint url convention `<base>/<toolName>` where base = <origin>/mcp;
// the planner posts tools/call to the /mcp base — see lib/endpoint-planner.ts
// mcpToolOf). priceUsd '0' = explicitly free; calls skip the 402 handshake
// but stay policy-gated + ledgered.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/cow/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Re-align if the service surface changes.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints.
//
// SEEDED 2026-07-08 (the MCP is live at cow-mcp.yeetful.com). Idempotent —
// edit + re-run to revise:
//   DATABASE_URL=... npx tsx scripts/seed-cow-free.ts
//
// Test locally WITHOUT touching the shared Neon DB:
//   npx tsx scripts/seed-cow-free.ts --print-extra-env
// prints the EXTRA_MCP_ROWS / EXTRA_MCP_ENDPOINTS values (lib/catalog.ts +
// lib/endpoint-planner.ts overlays) derived from this same tool table.
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

const COW_BASE = process.env.FREE_COW_MCP_BASE ?? 'https://cow-mcp.yeetful.com/mcp'

const chain = () =>
  p('chain', 'string', 'Chain: mainnet | gnosis | arbitrum | base | avalanche | polygon | bnb | sepolia (default mainnet).')

const token = (which: string, required = true) =>
  p(which, 'string', `${which} token — symbol (USDC, WETH, COW…) or 0x address.`, required)

const owner = (what: string) =>
  p('owner', 'string', `${what} — an EVM address; for the user's own wallet use "$USER_ADDRESS".`, true)

const SERVICE = {
  slug: 'cow-free',
  name: 'CoW Protocol (Free)',
  description:
    'CoW Protocol, free and non-gated: live order-book quotes, MEV-protected swap + limit orders built into the exact EIP-712 order the user signs, open orders, trade history, portfolio, solver competition, and the official CoW docs (bundled, searchable). Mainnet, Gnosis, Arbitrum, Base + more. Builds only — never holds keys, never submits unsigned. Rate-limited. By Pantessa.',
  category: 'Trading',
  kind: 'data',
  priceUsd: '0',
  networks: ['Ethereum', 'Base', 'Arbitrum', 'Gnosis'],
  websiteUrl: 'https://github.com/Pantessa/free-mcps',
  // callable:false like snapshot-free/uniswap-free — free MCP rows are
  // PLANNER-driven: the endpoint planner picks among the mcp_endpoints
  // children below (a callable data row without a wired `tool` matches none
  // of the chat orchestrator's dispatch buckets and would go dead).
  callable: false,
  protocol: 'mcp',
  endpoint: COW_BASE,
  tags: ['trading', 'swap', 'limit-order', 'defi', 'mev-protection', 'transaction-building', 'docs'],
  exampleQueries: [
    'quote 100 USDC to WETH on CoW',
    'show my open CoW orders',
    'how do CoW solvers work?',
  ],
  source: 'yeetful',
}

// `plannable:false` → parameters seeded as DbNull so the endpoint is
// browsable in the directory but NEVER enters the planner menu (the
// signature-consuming tools: the planner must not drive signing).
const TOOLS: Array<{ name: string; description: string; params: Param[]; plannable?: boolean }> = [
  {
    name: 'quote',
    description:
      'Live CoW Protocol swap quote (no commitment): sell/buy amounts, network fee, and the price solvers currently offer. kind "sell" = amount is what you sell; "buy" = amount is what you receive.',
    params: [
      chain(),
      token('sellToken'),
      token('buyToken'),
      p('kind', 'string', '"sell" or "buy".', true),
      p('amount', 'string', 'Amount in HUMAN units, e.g. "100" for 100 USDC.', true),
      p('from', 'string', 'Trading wallet — quotes are address-sensitive; use "$USER_ADDRESS" for the connected user.', true),
    ],
  },
  {
    name: 'build_swap_order',
    description:
      'Quote AND build a signable CoW market-swap order in one call: the EIP-712 GPv2 order the user signs (eth_signTypedData_v4) + the vault-relayer approval prerequisite. Nothing is signed or submitted. THE tool for "swap 100 USDC to WETH".',
    params: [
      chain(),
      token('sellToken'),
      token('buyToken'),
      p('kind', 'string', '"sell" or "buy".', true),
      p('amount', 'string', 'Amount in HUMAN units.', true),
      p('from', 'string', 'Order owner + receiver — "$USER_ADDRESS" for the connected user.', true),
      p('slippageBps', 'number', 'Slippage bound in bps (default 50 = 0.5%).'),
      p('validFor', 'number', 'Order validity in seconds from now (default 1800).'),
      p('partiallyFillable', 'boolean', 'Allow partial fills (default false).'),
    ],
  },
  {
    name: 'build_limit_order',
    description:
      'Build a signable CoW LIMIT order at the user\'s price: sellAmount + minimum buyAmount set the limit ("sell 1 WETH at ≥4000 USDC" → sellAmount 1, buyAmount 4000). Gasless, feeAmount 0 (fee from surplus), valid up to 1 year. Returns EIP-712 typed data + approval hint; nothing is signed or submitted.',
    params: [
      chain(),
      token('sellToken'),
      token('buyToken'),
      p('sellAmount', 'string', 'Amount to sell, HUMAN units.', true),
      p('buyAmount', 'string', 'MINIMUM amount to receive, HUMAN units — sets the limit price.', true),
      p('from', 'string', 'Order owner + receiver — "$USER_ADDRESS" for the connected user.', true),
      p('validFor', 'number', 'Validity in seconds from now (default 7 days, max 1 year).'),
      p('partiallyFillable', 'boolean', 'Allow partial fills (default false).'),
    ],
  },
  {
    name: 'submit_order',
    description:
      'POST an already-signed order to the CoW order book → orderUid + explorer link. Only with a signature from the user\'s own wallet over the build step\'s typed data.',
    params: [],
    plannable: false,
  },
  {
    name: 'cancel_orders',
    description:
      'Gasless two-phase order cancellation: without signature returns the OrderCancellations EIP-712 typed data; with signature submits it.',
    params: [],
    plannable: false,
  },
  {
    name: 'order_status',
    description:
      'One CoW order by uid: open/fulfilled/cancelled/expired, fill %, executed amounts, and the explorer link. Answers "did my swap go through?".',
    params: [chain(), p('uid', 'string', 'CoW order uid (0x…, 56 bytes).', true)],
  },
  {
    name: 'user_orders',
    description:
      'An address\'s CoW orders, newest first — open + recent, with status and fill % ("show my open CoW orders" → owner:"$USER_ADDRESS").',
    params: [chain(), owner("Order owner's wallet address"), p('limit', 'number', 'Max results (default 20).')],
  },
  {
    name: 'user_trades',
    description:
      'Settled CoW trades for an address, newest first, with settlement tx hashes ("what did I trade on CoW" → owner:"$USER_ADDRESS").',
    params: [chain(), owner("Trader's wallet address"), p('first', 'number', 'Max results (default 20).')],
  },
  {
    name: 'portfolio',
    description:
      'CoW-centric account view across chains, derived from the order book (not on-chain balances): open orders with fill %, recent fills, trade counts, volume per token ("what\'s my CoW activity" → owner:"$USER_ADDRESS").',
    params: [
      owner('The wallet address to inspect'),
      p('chains', 'string', 'Chains to scan, e.g. "mainnet,base" (default mainnet,gnosis,arbitrum,base).'),
    ],
  },
  {
    name: 'native_price',
    description:
      "The order book's price estimate for a token in the chain's native currency — the feed solvers use for fee math.",
    params: [chain(), token('token')],
  },
  {
    name: 'solver_competition',
    description:
      "Which solvers bid on a settlement and who won — latest auction by default, or by settlement tx hash. CoW's MEV-protected batch auction, made visible.",
    params: [chain(), p('txHash', 'string', 'Settlement tx hash (omit for the latest auction).')],
  },
  {
    name: 'api_get',
    description:
      'Escape hatch: GET any allowlisted CoW order-book path (orders, trades, native prices, app_data, solver competition…) for data the other tools don\'t cover. Read-only by construction.',
    params: [chain(), p('path', 'string', 'Versioned path + query, e.g. "/v1/trades?owner=0x…".', true)],
  },
  {
    name: 'docs_search',
    description:
      'Search the official CoW Protocol documentation (docs.cow.fi, bundled) — batch auctions, solvers, MEV protection, order types, fees, signing, appData, CoW AMM, MEV Blocker, COW token, governance.',
    params: [
      p('query', 'string', 'What to look up, e.g. "how are solvers ranked".', true),
      p('first', 'number', 'Results to return (default 5).'),
    ],
  },
  {
    name: 'docs_page',
    description: 'Fetch one bundled CoW docs page (full text) by its corpus path from docs_search results.',
    params: [p('path', 'string', 'Corpus path from docs_search, e.g. "cow-protocol/reference/core/signing_schemes".', true)],
  },
  {
    name: 'chains',
    description:
      'CoW deployments this service reaches: chainIds, order-book URLs, settlement + vault-relayer contracts, curated token symbols per chain.',
    params: [],
    plannable: false, // param-less POST — discovery metadata, not a planner call
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.filter((t) => t.plannable !== false).map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${COW_BASE}/${t.name}`,
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
      // Path style (`/mcp/<tool>`) — matches the x402 fleet's endpoint
      // display; buildSmartRequest posts the tools/call to the /mcp base.
      url: `${COW_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'Base',
      provider: 'Pantessa (free)',
      position: i,
      parameters: t.plannable === false ? Prisma.DbNull : (t.params as unknown as object),
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${COW_BASE}`)
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
