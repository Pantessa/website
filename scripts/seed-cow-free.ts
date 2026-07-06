#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party CoW Protocol MCP — `cow-free`
// (repo Yeetful/free-mcps, service `cow`) — as a directory row with one
// mcp_endpoints child per TOOL, mirroring seed-free-mcps.ts exactly
// (endpoint url convention `<base>/<toolName>` where base = <origin>/mcp;
// the planner posts tools/call to the /mcp base — see lib/endpoint-planner.ts
// mcpToolOf). priceUsd '0' = explicitly free; calls skip the 402 handshake
// but stay policy-gated + ledgered.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints.
//
// ⚠️ DO NOT RUN YET — this ships for the OWNER to run once the MCP is
// deployed at cow-mcp.yeetful.com (post-deploy step, same as the other free
// MCPs). Until then, test locally via the EXTRA_MCP_ROWS env (lib/catalog.ts)
// without touching the shared Neon DB. Run:
//   DATABASE_URL=... npx tsx scripts/seed-cow-free.ts
import { Prisma } from '@prisma/client'
import prisma from '../lib/db'

type Param = {
  group: 'body'
  name: string
  type: string
  description: string
  required: boolean
  enumValues?: string[]
}

const p = (name: string, type: string, description: string, required = false): Param => ({
  group: 'body',
  name,
  type,
  description,
  required,
})

const COW_BASE = process.env.FREE_COW_MCP_BASE ?? 'https://cow-mcp.yeetful.com/mcp'

const token = (which: string, required = true) =>
  p(which, 'string', `${which} — symbol (USDC, WETH, COW…) or 0x address on Base.`, required)

const user = (name: string, what: string, required = true) =>
  p(name, 'string', `${what} — an EVM address; for the user's own wallet use "$USER_ADDRESS".`, required)

const SERVICE = {
  slug: 'cow-free',
  name: 'CoW Protocol (Free)',
  description:
    'CoW Protocol on Base, free and non-gated: live quotes from the CoW order book, MEV-protected swap + limit orders built into the exact EIP-712 order the user signs, plus open orders, trade history, portfolio, and the CoW docs. Builds only — never holds keys, never submits unsigned. Rate-limited. By Yeetful.',
  category: 'Trading',
  kind: 'data',
  priceUsd: '0',
  networks: ['Base'],
  websiteUrl: 'https://github.com/Yeetful/free-mcps',
  // callable:false like snapshot-free/uniswap-free — free MCP rows are
  // PLANNER-driven: the endpoint planner picks among the mcp_endpoints
  // children below (a callable data row without a wired `tool` matches none
  // of the chat orchestrator's dispatch buckets and would go dead).
  callable: false,
  protocol: 'mcp',
  endpoint: COW_BASE,
  tags: ['trading', 'swap', 'limit-order', 'defi', 'mev-protection', 'transaction-building'],
  exampleQueries: [
    'quote 100 USDC to WETH on CoW',
    'show my open CoW orders',
    'how do CoW solvers work?',
  ],
  source: 'yeetful',
}

const TOOLS = [
  {
    name: 'quote',
    description:
      'Live CoW Protocol swap quote on Base: sell amount in → buy amount out, fee, and the price the solvers currently offer. No order is created.',
    params: [token('sellToken'), token('buyToken'), p('amount', 'string', 'Human sell amount, e.g. "100" or "0.05".', true)],
  },
  {
    name: 'build_swap_order',
    description:
      'Build a signable CoW market-swap order: fresh quote → min-buy with slippage bound → the EIP-712 GPv2 order the user signs. Receiver is always the payer. Nothing is signed or submitted.',
    params: [
      token('sellToken'),
      token('buyToken'),
      p('amount', 'string', 'Human sell amount.', true),
      user('from', "Payer's wallet address (order owner + receiver)"),
      p('slippageBps', 'number', 'Slippage bound in bps (optional).'),
    ],
  },
  {
    name: 'build_limit_order',
    description:
      'Build a signable CoW LIMIT order at the user\'s price: sell amount + minimum buy amount → EIP-712 GPv2 order (feeAmount 0, fee from surplus, partially fillable). Nothing is signed or submitted.',
    params: [
      token('sellToken'),
      token('buyToken'),
      p('sellAmount', 'string', 'Human sell amount.', true),
      p('buyAmountAtLeast', 'string', 'Minimum human buy amount — the limit price.', true),
      user('from', "Payer's wallet address (order owner + receiver)"),
      p('validForSec', 'number', 'Order validity window in seconds (optional).'),
    ],
  },
  {
    name: 'user_orders',
    description:
      "Open + recent CoW orders for an address on Base ('show my open CoW orders' → address:\"$USER_ADDRESS\"). Status, amounts, fill progress per order.",
    params: [user('address', "Order owner's wallet address"), p('first', 'number', 'Max results.')],
  },
  {
    name: 'user_trades',
    description:
      "Settled CoW trades for an address on Base ('what did I trade on CoW' → address:\"$USER_ADDRESS\"), newest first, with settlement tx hashes.",
    params: [user('address', "Trader's wallet address"), p('first', 'number', 'Max results.')],
  },
  {
    name: 'portfolio',
    description:
      "Token balances for an address on Base with USD estimates ('what's in my wallet' → address:\"$USER_ADDRESS\").",
    params: [user('address', "The wallet address to inspect")],
  },
  {
    name: 'order_status',
    description: 'Status of one CoW order by uid: open/filled/cancelled/expired, fill amounts, and the settlement tx when filled.',
    params: [p('uid', 'string', 'CoW order uid (0x…, 56 bytes).', true)],
  },
  {
    name: 'native_price',
    description: 'Current CoW order-book native price for a token on Base (the price solvers quote against ETH).',
    params: [token('token')],
  },
  {
    name: 'docs_search',
    description: 'Search the CoW Protocol documentation — how solvers, batch auctions, fees, and MEV protection work.',
    params: [p('query', 'string', 'Free-text search query, e.g. "how do solvers settle a batch".', true)],
  },
  {
    name: 'docs_page',
    description: 'Fetch one CoW Protocol docs page by path/id (as returned by docs_search) for the full text.',
    params: [p('page', 'string', 'Docs page path or id from docs_search results.', true)],
  },
] as const

async function main() {
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
      provider: 'Yeetful (free)',
      position: i,
      parameters: (t as { plannable?: boolean }).plannable === false ? Prisma.DbNull : (t.params as unknown as object),
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${COW_BASE}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
