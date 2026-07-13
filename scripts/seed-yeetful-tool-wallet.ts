#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party multichain Wallet MCP —
// `yeetful-tool-wallet` (repo Yeetful/free-mcps, service `yeetful-tool-wallet`;
// the yeetful-tool-* prefix marks internal Yeetful utility MCPs) — as a directory row with one
// mcp_endpoints child per TOOL, mirroring seed-hyperliquid-free.ts exactly.
// priceUsd '0' = explicitly free; calls skip the 402 handshake but stay
// policy-gated + ledgered.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/wallet/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Re-align if the service surface changes.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run:
//   DATABASE_URL=... npx tsx scripts/seed-yeetful-tool-wallet.ts
// Local-dev overlay without touching Neon:
//   npx tsx scripts/seed-yeetful-tool-wallet.ts --print-extra-env
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

const WALLET_BASE = process.env.FREE_WALLET_MCP_BASE ?? 'https://wallet-mcp.yeetful.com/mcp'

const owner = () =>
  p(
    'owner',
    'string',
    'The wallet address (0x…) to inspect — for the connected user ALWAYS pass "$USER_ADDRESS". Read-only, no signature needed.',
    true,
  )

const chains = () =>
  p(
    'chains',
    'array',
    'Chains to cover, e.g. ["base","arbitrum"]. Omit for ALL ten (eth, base, arb, op, pol, bsc, avax, scroll, gnosis, rh = Robinhood Chain). Names, keys, and chainIds all work.',
  )

const SERVICE = {
  slug: 'yeetful-tool-wallet',
  name: 'Yeetful Wallet',
  description:
    'Multichain wallet reads, free and non-gated: USD-priced whole-wallet portfolios across 10 top EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche, Scroll, Gnosis, Robinhood Chain), native gas balances, precise per-token balances, recent transfers with scam-symbol flagging, and transaction confirmation status. The fresh-data layer after any swap or transfer settles. Read-only by construction. Rate-limited. By Yeetful.',
  category: 'Wallets',
  kind: 'data',
  priceUsd: '0',
  networks: ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Scroll', 'Gnosis', 'Robinhood Chain'],
  websiteUrl: 'https://github.com/Yeetful/free-mcps',
  // callable:false like the sibling free rows — free MCP rows are
  // PLANNER-driven: the endpoint planner picks among the mcp_endpoints
  // children below.
  callable: false,
  protocol: 'mcp',
  endpoint: WALLET_BASE,
  tags: ['wallet', 'portfolio', 'balances', 'multichain', 'transactions', 'gas'],
  exampleQueries: [
    'show my portfolio on base and arbitrum',
    'do I have gas on optimism?',
    'did my transaction confirm?',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; plannable?: boolean }> = [
  {
    name: 'portfolio',
    description:
      'THE answer to "show my portfolio / what do I hold / balances on X and Y": every native + ERC-20 holding across the covered chains in ONE call, live, USD-priced, spam filtered, sorted richest-first with per-chain subtotals. ALWAYS call fresh after a transaction settles — balances change the moment a tx lands. The chat renders the result as a rich card (owner:"$USER_ADDRESS").',
    params: [owner(), chains(), p('minUsd', 'number', 'Hide holdings below this USD value (default 0.01 — filters airdrop spam).')],
  },
  {
    name: 'gas_balances',
    description:
      'Just the NATIVE token balance on every covered chain in one call — "do I have gas on Arbitrum?" before building a transaction there. Faster than a full portfolio when only gas matters.',
    params: [owner(), chains()],
  },
  {
    name: 'token_balance',
    description:
      'One token\'s live balance for a wallet on one chain — the precise post-transaction check ("did the USDC arrive on Arbitrum?"). token = the 0x contract address, or "native" for the gas token. Unknown contract address → use portfolio instead.',
    params: [
      owner(),
      p('chain', 'string', 'One chain — name, key, or EVM chainId (base, arbitrum, 8453, …).', true),
      p('token', 'string', 'The token\'s 0x contract address on that chain, or "native" for the gas token.', true),
    ],
  },
  {
    name: 'recent_transactions',
    description:
      'A wallet\'s most recent sent + received transfers (external + ERC-20) across the covered chains, merged newest-first with explorer links; spoofed scam-token symbols are flagged. Answers "what did I do recently?" and finds a deposit/delivery transaction after a swap.',
    params: [owner(), chains(), p('limit', 'number', 'Max transfers returned after merging (default 10, max 50).')],
  },
  {
    name: 'transaction_status',
    description:
      'One transaction\'s live status by hash: CONFIRMED (with confirmation count), REVERTED (no state changed), or still pending — plus the explorer link. Call right after the user signs something, then re-read balances with portfolio to show fresh numbers.',
    params: [
      p('chain', 'string', 'The chain the transaction was sent on — name, key, or chainId.', true),
      p('hash', 'string', 'The 0x…64-hex transaction hash.', true),
    ],
  },
  {
    name: 'chains',
    description: 'The chains this service reads (9 top EVM ecosystems) with native symbols. Free, instant.',
    params: [],
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.filter((t) => t.plannable !== false).map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${WALLET_BASE}/${t.name}`,
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
      url: `${WALLET_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'multichain',
      provider: 'Yeetful (free)',
      position: i,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${WALLET_BASE}`)
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
