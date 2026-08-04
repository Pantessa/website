#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party funding-planner MCP —
// `yeetful-tool-funding` (repo Yeetful/free-mcps, service
// `yeetful-tool-funding`; the yeetful-tool-* prefix marks internal Pantessa
// utility MCPs) — as a directory row with one mcp_endpoints child per TOOL,
// mirroring seed-yeetful-tool-wallet.ts exactly. priceUsd '0' = explicitly
// free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/yeetful-tool-funding/lib/tools.ts — the planner sends
// tools/call arguments by these exact names. Re-align if the surface changes.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run AFTER the service is
// live at funding-mcp.yeetful.com:
//   DATABASE_URL=... npx tsx scripts/seed-yeetful-tool-funding.ts
// Local-dev overlay without touching Neon:
//   FREE_FUNDING_MCP_BASE=http://localhost:3271/mcp npx tsx scripts/seed-yeetful-tool-funding.ts --print-extra-env
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

const FUNDING_BASE = process.env.FREE_FUNDING_MCP_BASE ?? 'https://funding-mcp.yeetful.com/mcp'

const user = () =>
  p(
    'user',
    'string',
    'The wallet (0x…) to plan for — for the connected user ALWAYS pass "$USER_ADDRESS". Read-only, no signature needed.',
    true,
  )

const SERVICE = {
  slug: 'yeetful-tool-funding',
  // Display name only — the slug and funding-mcp.yeetful.com stay put so
  // nothing referencing them breaks (renamed from "Pantessa Funding Planner",
  // 2026-07-28: the service is growing past funding into the finance layer —
  // the website's rebalance read wears this card).
  name: 'Pantessa Finance',
  description:
    '"Insufficient funds" is an offer, never a wall: when any action can\'t be funded (a stake, a supply, a deposit, a swap), this planner scans the wallet\'s movable ETH + USDC across Base/Arbitrum/Ethereum and returns an EXECUTABLE cross-chain funding plan — ordered NEAR Intents legs (same-token first, then stables), a destination gas leg when the wallet couldn\'t even sign the follow-up, and honest per-chain numbers when the whole wallet can\'t cover it. Construction-only: reads balances and prices, never signs, never submits; legs execute via the NEAR Intents MCP under its own deposit-address guard. Keyless, rate-limited. By Pantessa.',
  category: 'Wallets',
  kind: 'data',
  priceUsd: '0',
  networks: ['Base', 'Arbitrum', 'Ethereum'],
  websiteUrl: 'https://github.com/Yeetful/free-mcps',
  // callable:false like the sibling free rows — free MCP rows are
  // PLANNER-driven: the endpoint planner picks among the mcp_endpoints
  // children below.
  callable: false,
  protocol: 'mcp',
  endpoint: FUNDING_BASE,
  tags: ['funding', 'bridge', 'cross-chain', 'gas', 'wallet', 'near-intents', 'planner'],
  exampleQueries: [
    'Rebalance my portfolio',
    "I don't have enough USDC on Arbitrum — where can I pull it from?",
    'what movable funds do I have across my chains?',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; plannable?: boolean }> = [
  {
    name: 'plan_funding',
    description:
      'THE answer when any build/action refuses on insufficient funds ("needs 20 USDC on Arbitrum but the wallet holds 3"): turn the shortfall into an executable cross-chain funding plan instead of a dead end. Input = destination chain, the token that must land there, and the SHORTFALL (needed minus held — not the full ask). Returns ranked options of ordered legs; a native-ETH gas leg is prepended automatically when the destination wallet can\'t pay for the follow-up action. Execute each leg IN ORDER via the NEAR Intents MCP\'s build_swap with these exact params and the user\'s own address, wait for settlement, then retry the original action — NEVER invent routes, amounts, or deposit addresses. Construction-only.',
    params: [
      user(),
      p('chain', 'string', 'Destination chain — name or EVM chainId (Base/8453, Arbitrum/42161, Ethereum/1).', true),
      p('token', 'string', 'The token that must LAND on the destination ("ETH", "USDC", …). ETH + major stables are priceable.', true),
      p('amount', 'number', 'The SHORTFALL in token units: how much more must land there (needed minus currently held).', true),
    ],
  },
  {
    name: 'fund_and_build',
    description:
      'The ONE-CALL composite for agents that can sign but can\'t orchestrate: scan + plan + an executable RUNBOOK in a single response. Call when an action refused on insufficient funds and you want the exact ordered tool calls, not just a plan. Returns everything plan_funding returns PLUS `runbook.steps` — numbered steps naming the NEAR Intents MCP tool for each leg (build_swap with verbatim params → submit_deposit_tx → await_completion) and ending with the follow-up action. Execute the steps in order, signing each deposit transfer with the user\'s own wallet; deposit addresses come from build_swap\'s responses, NEVER invented. Construction-only.',
    params: [
      user(),
      p('chain', 'string', 'Destination chain — name or EVM chainId (Base/8453, Arbitrum/42161, Ethereum/1).', true),
      p('token', 'string', 'The token that must LAND on the destination ("ETH", "USDC", …). ETH + major stables are priceable.', true),
      p('amount', 'number', 'The SHORTFALL in token units: how much more must land there (needed minus currently held).', true),
      p('finalAction', 'string', 'Optional: the action this funding is FOR ("supply 12 USDC to Aave on Arbitrum") — echoed into the runbook\'s final step.'),
    ],
  },
  {
    name: 'scan_funding_sources',
    description:
      'Where a wallet\'s movable money sits: ETH + USDC across Base/Arbitrum/Ethereum in one call, gas-reserve aware (ETH counts only above what its own transfer costs; USDC only where the wallet also holds gas to sign). Call when an action failed on balance and you want to see what could fund it — then plan_funding turns it into an executable plan. failedChains means UNKNOWN, never empty.',
    params: [user()],
  },
  {
    name: 'eth_price',
    description:
      "The ETH/USD price the planner sizes gas legs with — one Uniswap v3 QuoterV2 staticcall on Base, no oracle, no key. Use to sanity-check a plan's dollar figures.",
    params: [],
  },
  {
    name: 'chains',
    description:
      "The chains this planner scans as sources and plans onto as destinations, with per-chain destination gas floors. Robinhood Chain funding rides the robinhood MCP's LiFi plan instead. Free, instant.",
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
    url: `${FUNDING_BASE}/${t.name}`,
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
      url: `${FUNDING_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'multichain',
      provider: 'Pantessa (free)',
      position: i,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${FUNDING_BASE}`)
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
