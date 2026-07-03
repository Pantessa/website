#!/usr/bin/env tsx
// Seed the two FREE (non-gated) first-party MCP services — uniswap-free +
// snapshot-free (repo Yeetful/free-mcps) — as directory rows with one
// mcp_endpoints child per TOOL, so the endpoint planner can pick tools and
// fill args. Endpoint url convention: `<base>/mcp#<toolName>` (see
// lib/endpoint-planner.ts mcpToolOf). priceUsd '0' = explicitly free; calls
// skip the 402 handshake (there is none) but stay policy-gated + ledgered.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing them.
// Idempotent: upserts by slug, replaces endpoints. Run:
//   DATABASE_URL=... npx tsx scripts/seed-free-mcps.ts
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

// Deployed 2026-07-03 (Vercel; see free-mcps/DEPLOY.md).
const UNISWAP_BASE = process.env.FREE_UNISWAP_MCP_BASE ?? 'https://uniswap-mcp.yeetful.com/mcp'
const SNAPSHOT_BASE = process.env.FREE_SNAPSHOT_MCP_BASE ?? 'https://snapshot-mcp.yeetful.com/mcp'

const token = (which: string, required = true) => p(which === 'token' ? 'token' : which, 'string', `${which} — symbol (USDC, WETH, UNI…) or 0x address on Base.`, required)

const SERVICES = [
  {
    slug: 'uniswap-free',
    name: 'Uniswap (Free)',
    description:
      'Uniswap v3 + v4 on Base, free and non-gated: live quotes across every fee tier (QuoterV2), spot prices, pool state, and deterministic swap-transaction building the user signs. Builds only — never holds keys, never submits. Rate-limited. By Yeetful.',
    category: 'Trading',
    kind: 'data',
    priceUsd: '0',
    networks: ['Base'],
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    base: UNISWAP_BASE,
    tools: [
      {
        name: 'quote',
        description: 'Live exact-in swap quote across every Uniswap v3 fee tier on Base (QuoterV2, no indexer lag). Returns buy amount, best fee tier, gas estimate, all tiers.',
        params: [token('sellToken'), token('buyToken'), p('amount', 'string', 'Human sell amount, e.g. "100" or "0.05".', true)],
      },
      {
        name: 'price',
        description: 'Current spot price for a token pair from the most liquid Uniswap v3 pool on Base. Both directions returned.',
        params: [token('baseToken'), token('quoteToken')],
      },
      {
        name: 'pool_info',
        description: 'Uniswap pool state for a pair on Base: v3 pools per fee tier + canonical hookless v4 pools (liquidity, sqrtPrice, tick).',
        params: [token('tokenA'), token('tokenB')],
      },
      {
        name: 'build_swap',
        description: 'Build the exact swap transaction to sign: fresh quote → min-out with slippage bound → SwapRouter02 calldata + approve step + dry-run. Recipient is always the payer. Nothing signed or submitted.',
        params: [
          token('sellToken'),
          token('buyToken'),
          p('amount', 'string', 'Human sell amount.', true),
          p('from', 'string', "Payer's wallet address (always the recipient).", true),
          p('slippageBps', 'number', 'Slippage bound in bps (optional).'),
          p('deadlineSec', 'number', 'Tx deadline in seconds, 30–3600 (optional).'),
        ],
      },
      {
        name: 'build_wrap',
        description: 'Build an ETH → WETH deposit transaction to sign.',
        params: [p('amount', 'string', 'Human ETH amount.', true), p('from', 'string', "Payer's wallet address.", true)],
      },
      {
        name: 'build_unwrap',
        description: 'Build a WETH → ETH withdraw transaction to sign.',
        params: [p('amount', 'string', 'Human WETH amount.', true), p('from', 'string', "Payer's wallet address.", true)],
      },
      {
        name: 'convert_amount',
        description: 'Convert a human token amount to atoms (decimals read on-chain). Utility for composing calls to other protocols.',
        params: [token('token'), p('amount', 'string', 'Human amount to convert.', true)],
      },
    ],
  },
  {
    slug: 'snapshot-free',
    name: 'Snapshot DAO (Free)',
    description:
      'Snapshot DAO governance, free and non-gated: browse spaces, proposals, and votes, then build the EIP-712 vote the user signs with their own wallet and relay it to the sequencer. The server never signs, never holds keys. Rate-limited. By Yeetful.',
    category: 'Data',
    kind: 'data',
    priceUsd: '0',
    networks: ['Base', 'Ethereum'],
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    base: SNAPSHOT_BASE,
    tools: [
      {
        name: 'list_proposals',
        description: "Recent Snapshot governance proposals. Filter by space and/or state. Default (no args) = active proposals across all DAOs — answers 'what DAO votes are live right now'.",
        params: [
          p('space', 'string', 'Snapshot space id, e.g. ens.eth.'),
          { ...p('state', 'string', 'Proposal state filter. Use "active" for open/live votes.'), enumValues: ['active', 'closed', 'pending'] } as Param,
          p('first', 'number', 'Max results.'),
        ],
      },
      { name: 'get_proposal', description: 'Full detail for one proposal: choices, scores, state, window.', params: [p('id', 'string', 'Proposal id (0x… hash).', true)] },
      { name: 'list_votes', description: 'Votes cast on a proposal, by voting power.', params: [p('proposal', 'string', 'Proposal id (0x… hash).', true), p('first', 'number', 'Max results.')] },
      { name: 'get_space', description: 'DAO space metadata (name, network, proposal/follower counts).', params: [p('id', 'string', 'Space id, e.g. ens.eth.', true)] },
      { name: 'list_spaces', description: 'Browse DAO spaces, most followed first.', params: [p('first', 'number', 'Max results.')] },
      {
        name: 'prepare_vote',
        description: 'Build the EIP-712 typed data for a Snapshot vote, ready for the voter to sign. Provide choice (1-indexed) or choiceText ("For", "yes", "option 2"). Returns typed data + human summary.',
        params: [
          p('proposal', 'string', 'Proposal id (0x… hash) to vote on.', true),
          p('from', 'string', "The voter's wallet address (the signer).", true),
          p('choice', 'string', '1-indexed choice: number | number[] | {index:weight}.'),
          p('choiceText', 'string', 'Human choice label, e.g. "For", "yes", "Against".'),
          p('reason', 'string', 'Optional reason attached to the vote.'),
        ],
      },
      {
        name: 'submit_vote',
        description: 'Relay a user-signed EIP-712 vote envelope to the Snapshot sequencer. Requires the signature + the exact typed data from prepare_vote.',
        params: [p('sig', 'string', 'EIP-712 signature of the typed data.', true), p('address', 'string', "Voter's address.", true)],
      },
    ],
  },
] as const

async function main() {
  for (const s of SERVICES) {
    const server = await prisma.mcpServer.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        category: s.category,
        kind: s.kind,
        priceUsd: s.priceUsd,
        networks: [...s.networks],
        gated: false,
        callable: false, // no single wired free-text call; the PLANNER calls tools (autoCallable)
        websiteUrl: s.websiteUrl,
        source: 'yeetful',
      },
      update: {
        name: s.name,
        description: s.description,
        priceUsd: s.priceUsd,
        gated: false,
        websiteUrl: s.websiteUrl,
        source: 'yeetful',
      },
    })

    await prisma.mcpEndpoint.deleteMany({ where: { serverId: server.id } })
    await prisma.mcpEndpoint.createMany({
      data: s.tools.map((t, i) => ({
        serverId: server.id,
        method: 'POST',
        url: `${s.base}#${t.name}`,
        description: t.description,
        priceUsd: '0',
        scheme: 'exact',
        network: 'Base',
        provider: 'Yeetful (free)',
        position: i,
        parameters: t.params as unknown as object,
      })),
    })
    console.log(`✓ ${s.slug}: ${s.tools.length} tool endpoints @ ${s.base}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
