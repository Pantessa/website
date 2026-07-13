#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party Lido staking MCP — `lido-free` (repo
// Yeetful/free-mcps, service `lido`, deploys to lido-mcp.yeetful.com) — as a
// directory row with one mcp_endpoints child per TOOL, mirroring
// seed-aave-free.ts exactly. priceUsd '0' = explicitly free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/lido/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Amounts are decimal strings in HUMAN units
// ("0.5" ETH), never wei; `user` is an 0x… address ($USER_ADDRESS).
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run AFTER the service is
// live:
//   DATABASE_URL=... npx tsx scripts/seed-lido-free.ts
// Local-dev overlay without touching Neon:
//   FREE_LIDO_MCP_BASE=http://localhost:3270/mcp npx tsx scripts/seed-lido-free.ts --print-extra-env
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

const LIDO_BASE = process.env.FREE_LIDO_MCP_BASE ?? 'https://lido-mcp.yeetful.com/mcp'

const user = (role: string): Param =>
  p('user', 'string', `EVM address (0x…) of ${role} — pass "$USER_ADDRESS" for the connected user.`, true)
const amount = (what: string, required = false): Param =>
  p('amount', 'string', `${what} as a decimal string in HUMAN units, e.g. "0.5" (not wei).`, required)
const maxFlag = (what: string): Param => p('max', 'boolean', `${what} (overrides amount).`)

const SERVICE = {
  slug: 'lido-free',
  name: 'Lido (Free)',
  description:
    'Lido liquid staking on Ethereum, free and non-gated: protocol stats with live staking APR, full per-address positions (stETH + wstETH balances, staked value in ETH and USD), EARNINGS history from Lido’s reward backend (lifetime rewards, average APR, daily rebases), withdrawal-queue tracking with wait estimates, and construction-only build_* tools that return UNSIGNED transactions the user signs — stake, wrap/unwrap, request withdrawal, claim. Never holds keys, never signs, never submits. Rate-limited. By Yeetful.',
  category: 'DeFi',
  kind: 'data',
  priceUsd: '0',
  networks: ['Ethereum'],
  websiteUrl: 'https://github.com/Yeetful/free-mcps',
  // callable:false like the sibling free rows — planner-driven via the
  // mcp_endpoints children below.
  callable: false,
  protocol: 'mcp',
  endpoint: LIDO_BASE,
  tags: ['defi', 'staking', 'lido', 'steth', 'yield', 'ethereum'],
  exampleQueries: [
    'stake 0.5 ETH with Lido',
    'show my Lido position and what I have earned',
    "what's the Lido staking APR?",
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; featured?: boolean }> = [
  {
    name: 'position',
    featured: true,
    description:
      "Full Lido staking position for an address: ETH / stETH / wstETH balances (wstETH also valued in stETH), total staked in ETH and USD, the APR it's earning, and withdrawal requests in flight — the 'show my Lido position / how much do I have staked?' tool. For what it has EARNED, use `earnings`.",
    params: [user('the account')],
  },
  {
    name: 'earnings',
    featured: true,
    description:
      "Lido staking EARNINGS for an address from the protocol's reward history: lifetime rewards in stETH and USD, the average APR actually earned, and recent daily rebase events — the 'what have I earned staking? / show my Lido rewards' tool. wstETH holders earn via the rising rate instead; `position` shows that value.",
    params: [user('the account'), p('limit', 'number', 'How many recent reward events to include (default 14, max 60).')],
  },
  {
    name: 'stats',
    description:
      "Lido protocol snapshot: staking APR (7-day average + latest daily), total ETH staked, live stETH↔wstETH rate, stake-rate limit, stETH USD price, withdrawal-queue depth — 'what's the Lido APR?'.",
    params: [],
  },
  {
    name: 'withdrawals',
    description:
      "Withdrawal-queue view for an address: every request with status (pending / claimable / claimed), claimable ETH total, a wait estimate for pending requests — 'where is my unstake? can I claim yet?'. When something is claimable, follow with build_claim.",
    params: [user('the account')],
  },
  {
    name: 'convert',
    description:
      'Convert an amount between ETH, stETH, and wstETH at the live on-chain rate — "how much wstETH is 5 stETH?". ETH↔stETH is 1:1 at the protocol.',
    params: [
      amount('Amount to convert', true),
      p('from', 'string', 'One of "ETH" | "stETH" | "wstETH".', true),
      p('to', 'string', 'One of "ETH" | "stETH" | "wstETH".', true),
    ],
  },
  {
    name: 'build_stake',
    description:
      "Prepare a Lido STAKE — returns UNSIGNED {action:'send_transaction'} steps for the USER to sign: ETH into rebasing stETH 1:1 (default) or straight into wstETH. Balance + the protocol's stake-rate limit are checked live first. Exit is via the withdrawal queue or a DEX swap — say so when asked.",
    params: [
      user('the wallet that stakes, receives the tokens, and signs'),
      amount('ETH amount to stake', true),
      p('receive', 'string', 'Which token to receive: "stETH" (default) or "wstETH".'),
    ],
  },
  {
    name: 'build_wrap',
    description:
      'Prepare UNSIGNED steps wrapping stETH into non-rebasing wstETH (approve step included only when the live allowance is short). max:true wraps the full balance.',
    params: [user('the wallet that wraps and signs'), amount('stETH amount to wrap — omit with max:true'), maxFlag('Wrap the entire stETH balance')],
  },
  {
    name: 'build_unwrap',
    description: 'Prepare an UNSIGNED transaction unwrapping wstETH back into rebasing stETH (no approval needed). max:true unwraps the full balance.',
    params: [user('the wallet that unwraps and signs'), amount('wstETH amount to unwrap — omit with max:true'), maxFlag('Unwrap the entire wstETH balance')],
  },
  {
    name: 'build_request_withdrawal',
    description:
      'Prepare UNSIGNED steps starting a Lido exit: stETH (or wstETH with token:"wstETH") into the withdrawal queue; the wallet gets claimable request NFT(s) and the ETH unlocks after finalization (hours–days, `withdrawals` shows the estimate). Amounts over the 1000-stETH per-request cap are split automatically. NOT instant — a DEX swap is the instant alternative at market price.',
    params: [
      user('the wallet exiting (receives the NFTs, later the ETH)'),
      amount('Amount to withdraw — omit with max:true'),
      maxFlag('Withdraw the entire balance of the chosen token'),
      p('token', 'string', 'Which token funds the withdrawal: "stETH" (default) or "wstETH".'),
    ],
  },
  {
    name: 'build_claim',
    description:
      'Prepare the UNSIGNED claim transaction for EVERY finalized, unclaimed withdrawal request an address holds — the ETH lands in their wallet. Reads the queue live; refuses honestly when nothing is claimable yet.',
    params: [user('the wallet that owns the withdrawal request NFT(s)')],
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${LIDO_BASE}/${t.name}`,
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
      url: `${LIDO_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'ethereum',
      provider: 'Yeetful (free)',
      position: i,
      featured: t.featured === true,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${LIDO_BASE} (featured: position, earnings)`)
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
