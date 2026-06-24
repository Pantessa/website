#!/usr/bin/env tsx
/**
 * Seed the sharp-router direction post (committed fixture, idempotent — upserts
 * by slug). The committed fixture represents the final, published state.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-sharp-router-post.ts            # publish
 *   DATABASE_URL=… DRAFT=1 npx tsx scripts/seed-sharp-router-post.ts    # stage as draft
 *
 * Charts are ```chart fenced blocks (JSON) rendered by components/BlogChart.tsx —
 * so this post only renders correctly once that renderer is deployed. Stage it as
 * a draft until then, then re-run without DRAFT (or flip published in the DB).
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'the-sharp-router',
  title: 'The sharp router: pay per call, route per need',
  description:
    'Paying per call for inference aligns incentives. Pair it with live MCP data and a router that picks the cheapest proven route, and agents start doing real work.',
  tags: ['routing', 'x402', 'agents', 'inference', 'mcp'],
  content: `Most "AI" you've used is paid for by someone other than you — an ad, a data trade, a free tier that throttles you the moment it gets interesting. That's fine for a chatbot. It falls apart the moment you want an agent to actually *do* something.

## Paying per call is a feature, not a tax

When an agent pays per call in USDC, the incentives line up. No ads, no data harvesting, no "you are the product." You ask for the best model for the job and you get it — metered to a fraction of a cent, with a receipt. Nothing to provision up front, no seat license, no rate limit that exists only to sell you the next tier.

Paid inference is the honest version of the deal: you pay for what you use, and the thing you're paying gets to be good instead of cheap.

## Inference alone is a closed box

A raw model — ChatGPT included — answers from training data with a cutoff. Ask it for the current USDC price, the live proposals in a DAO's Snapshot space, or whether a flight is delayed, and it guesses or declines. The model is the reasoning engine. It is not the world.

The fix isn't a bigger model. It's letting the model **pay for the live data it needs, the moment it needs it.** That's what MCPs are: priced endpoints — market data, DAO state, flight status, on-chain analytics — an agent can call mid-thought. Paid inference *plus* paid data beats a closed box every time the answer depends on now.

And "now" is most of the valuable questions.

\`\`\`chart
{"type":"bar","title":"The paid-agent market is compounding fast","unit":"AI agents market, USD billions","note":"~46% CAGR","source":"MarketsandMarkets, 2025","data":[{"label":"2025","value":7.84,"display":"$7.8B"},{"label":"2030","value":52.62,"display":"$52.6B"}]}
\`\`\`

## One wallet, paying as it goes

This is the part people keep underestimating. Once an agent can pay per call, it stops needing a human to pre-provision API keys, top up credits, or babysit the task. You hand it a wallet and a goal; it routes, pays, and finishes — buying inference and data the same way, as it goes.

\`\`\`chart
{"type":"stat","value":"1 in 4","label":"enterprise software purchases will be made by AI agents by 2028 — with no human in the loop.","source":"Gartner"}
\`\`\`

That's the real stepping stone to automation: not a smarter prompt, but an agent that can transact. It only works if the spending is bounded — which is the whole reason the next part exists.

## Guardrails are the unlock, not the brake

An agent with an unbounded wallet is a liability. So Yeetful puts a spend-approval layer in front of every payment: an **expense account** with an allowlist of services it may pay, a per-call cap, a daily cap, and a freeze switch that stops everything cold. Approvals are enforcement, not decoration — turn a service off and the next payment to it is refused before a cent moves. Every settle and every refusal lands in a [ledger](/activity) you can read.

The thesis fits on one line: per-call pricing is fine; unbounded authorization is how an agent empties a wallet politely.

## The sharp router

Paid inference, live data, and a wallet with limits is the setup. The router is the payoff. Point it at a need in plain English and it weighs every plannable route in the live catalog, then picks the **cheapest proven route under your cap** — *proven* meaning it has actually settled calls on-network, not just posted a price. It pays, returns the answer, and logs what it considered, picked, spent, and saved versus naive routing.

You can watch it work on the [activity page](/activity): settle rates per service, dollars saved, and the latest calls as they land. The engine is the product; the receipts are public.

\`\`\`chart
{"type":"bar","title":"Agentic software goes mainstream","unit":"share of enterprise software including agentic AI","source":"Gartner","data":[{"label":"2024","value":1,"display":"<1%"},{"label":"2028","value":33,"display":"33%"}]}
\`\`\`

\`\`\`chart
{"type":"stat","value":"15%","label":"of day-to-day work decisions will be made autonomously by agentic AI by 2028 — up from 0% in 2024.","source":"Gartner"}
\`\`\`

## Where this goes

The direction is an agent that pays its own way: grounded in live data, reaching for the best model per task, and bounded by a policy you set instead of a rate limit someone sold you. The router is how it spends well. The expense account is how you sleep at night.

Build on it: read [how routing works](/docs/router), give your agent an [expense account](/developers), or [run an MCP and earn](/docs/earn) when the router routes to you.`,
}

async function main() {
  const prisma = new PrismaClient()
  const draft = process.env.DRAFT === '1'
  const author =
    (process.env.ADMIN_WALLETS ?? '').split(',')[0]?.trim().toLowerCase() ||
    '0x0000000000000000000000000000000000000000'
  const existing = await prisma.blogPost.findUnique({ where: { slug: POST.slug } })
  await prisma.blogPost.upsert({
    where: { slug: POST.slug },
    update: { title: POST.title, description: POST.description, content: POST.content, tags: POST.tags },
    create: {
      ...POST,
      published: !draft,
      publishedAt: draft ? null : new Date(),
      authorAddress: author,
    },
  })
  console.log(
    `  ✓ ${POST.slug} ${existing ? 'updated (publishedAt untouched)' : draft ? 'created as DRAFT' : 'created + published'}`,
  )
  await prisma.$disconnect()
}

if (process.argv[1]?.includes('seed-sharp-router-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
