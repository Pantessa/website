#!/usr/bin/env tsx
/**
 * Seed the agentic-finance direction post (committed fixture, idempotent —
 * upserts by slug). The committed fixture represents the final, published state.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-agentic-finance-post.ts            # publish
 *   DATABASE_URL=… DRAFT=1 npx tsx scripts/seed-agentic-finance-post.ts    # stage as draft
 *
 * No coverImage on purpose: the post uses the generated BlogCoverArt routing
 * network (animated 402→200 settle). Charts are ```chart fenced blocks (JSON)
 * rendered by components/BlogChart.tsx.
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'agentic-finance-from-one-prompt',
  title: 'Agentic finance runs on glue: one prompt, any on-chain action',
  description:
    'Agents can now act on-chain from a single prompt. Pantessa is the glue — combining MCPs, live data, and a security layer that makes transactions bulletproof.',
  tags: ['agentic-finance', 'mcp', 'x402', 'agents', 'security'],
  content: `Agentic finance stopped being a thesis this year. Exchanges ship MCP toolkits, chains run their own MCP servers, and the estimate floating around the desks is that most crypto trading volume is already machine-driven. An AI agent with a wallet can quote a swap, check a DAO proposal, or read funding rates — each through a different crypto MCP server, each from a plain-English prompt.

\`\`\`chart
{"type":"stat","value":"60–80%","label":"of global crypto trading volume is already AI-driven, by analyst estimates — and climbing.","source":"CoinDesk, 2026"}
\`\`\`

Here's the part the demos skip: one MCP is a party trick. Real work spans several.

## One prompt, any on-chain action

The ask that actually matters looks like this:

> "Swap 2,000 USDC into ETH at the best price, then vote yes on the Uniswap DAO treasury proposal before it closes tonight."

That single prompt touches a DEX for the quote, a price feed for sanity, a governance MCP for the proposal state, and a signature at the end — plus an approval transaction the user never mentioned because they shouldn't have to know it exists. No single MCP does this. No human wants to do it across four tabs either.

This is the product: **anything on-chain, from one prompt, whether a human typed it or an agent did.** The model reasons; the MCPs act; something in the middle has to stitch it together and keep it safe.

That middle layer is Pantessa.

## Combining MCPs is where the leverage is

Every crypto MCP server is an island. Uniswap's tools don't know Snapshot exists; Snapshot's don't know your swap just changed your voting power. An agent doing real work bounces from MCP to MCP to endpoint — quote here, resolve a token list there, check proposal state, build the transaction, settle — with as little human intervention as the risk allows.

Pantessa's router does the bouncing. It reads the whole catalog, picks the right server *and* the right endpoint, fills the parameters (including who's asking — your address flows through as context, so "my open orders" just works), and pays per call in USDC over x402 when the data costs money. Swap on Uniswap while voting on any Snapshot DAO — including Uniswap's own — in the same turn, from the same sentence.

Agents that combine tools this way aren't a niche. They're where the whole industry is pointed:

\`\`\`chart
{"type":"bar","title":"Finance teams are adopting agentic AI fast","unit":"share of finance teams using agentic AI","note":"a 600%+ jump year over year","source":"Wolters Kluwer, 2026","data":[{"label":"2025","value":6,"display":"~6%"},{"label":"2026","value":44,"display":"44%"}]}
\`\`\`

## The security layer is the product

An agent that can touch four MCPs in one turn can also lose your money four ways in one turn. So Pantessa's focus is the part everyone else calls a follow-up: making the transaction path bulletproof.

- **Guardrails fire on every step, not just the first.** A multi-step chain — approve, then swap — re-quotes at the moment each step advances and re-runs policy on the fresh numbers. Stale quotes don't get signed.
- **Signatures break the loop.** The agent plans and builds; it never holds your keys. Anything that moves funds or casts a vote stops and waits for a signature.
- **The expense account bounds the spending.** An allowlist of services the agent may pay, per-call and daily caps, and a freeze switch that stops everything cold. A denial is enforced before a cent moves — and it's [ledgered](/activity), so you can read exactly what was refused and why.
- **Receipts for everything.** Every settle, every denial, every route considered. Trust the agent because you can audit it, not because it asked nicely.

Bulletproof isn't a vibe. It's re-checking the transaction every time the world moves between steps.

## Making MCPs more powerful than they shipped

Most MCP servers were built to answer one tool call, not to survive an agent economy. Pantessa adds the missing pieces from the outside: we grade every server in the catalog on whether an agent can actually route to it — schemas, parameter hints, planner behavior — and overlay what's missing, so a server with thin docs still gets picked correctly and called safely. The better the MCPs get, the more one prompt can do; the more one prompt can do, the more the security layer matters.

## Where this goes

The direction is a financial layer agents can stand on: live data paid per call, MCPs combined instead of siloed, and every on-chain action wrapped in policy, signatures, and receipts. Humans set intent and sign; agents do the rest.

Try a prompt in the [chat](/), watch routes settle on the [activity feed](/activity), or [give your agent an expense account](/developers) and let it get to work.`,
}

async function main() {
  const prisma = new PrismaClient()
  const draft = process.env.DRAFT === '1'
  const author =
    (process.env.ADMIN_WALLETS ?? '').split(',')[0]?.trim().toLowerCase() ||
    '0x0000000000000000000000000000000000000000'
  const existing = await prisma.blogPost.findUnique({ where: { slug: POST.slug } })
  // Publish-once: a non-draft run flips an existing draft live and stamps
  // publishedAt exactly once; an already-published row keeps its date (editing
  // never games the feed).
  const publishNow = !draft && !existing?.published
  await prisma.blogPost.upsert({
    where: { slug: POST.slug },
    update: {
      title: POST.title,
      description: POST.description,
      content: POST.content,
      tags: POST.tags,
      ...(publishNow ? { published: true, publishedAt: new Date() } : {}),
    },
    create: {
      ...POST,
      published: !draft,
      publishedAt: draft ? null : new Date(),
      authorAddress: author,
    },
  })
  const action = !existing
    ? draft
      ? 'created as DRAFT'
      : 'created + published'
    : publishNow
      ? 'updated + PUBLISHED'
      : 'updated (publishedAt untouched)'
  console.log(`  ✓ ${POST.slug} ${action}`)
  await prisma.$disconnect()
}

if (process.argv[1]?.includes('seed-agentic-finance-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
