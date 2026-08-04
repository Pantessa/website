#!/usr/bin/env tsx
/**
 * Seed the orchestration (Jobs layer) launch post as a DRAFT (committed
 * fixture, idempotent — upserts by slug, never flips `published`).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-orchestration-post.ts
 *
 * Publishing stays owner-gated: the API route requires a wallet on
 * ADMIN_WALLETS, so when Nate is ready it's one command:
 *
 *   curl -X PATCH https://www.yeetful.com/api/blog/one-sentence-four-transactions \
 *     -H 'authorization: Bearer yf_…' -H 'content-type: application/json' \
 *     -d '{"published": true}'
 *
 * (publishedAt is set exactly once, so re-publishing never games the feed.)
 *
 * The cover art is code, not an upload: BlogCoverArt.tsx has a bespoke
 * composition for this slug (the bouncing intent-arrow) that reuses the same
 * blogart__route / blogart__ping animations every other post gets.
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'one-sentence-four-transactions',
  title: 'One sentence, four transactions',
  description:
    'Compound intents are live: one prompt can bridge, swap, open a long, and arm a stop-loss guardian — every step deterministically built, guarded, and receipted.',
  tags: ['orchestration', 'jobs', 'guardian', 'transactions'],
  content: `"Deposit 12 USDC to Hyperliquid, then long $12 of ETH, then protect it with a 5% stop."

That's one sentence. Until now it was also three apps, a bridge UI you double-check twice, a perps exchange, a price alert you promise yourself you'll act on, and five signatures with addresses you paste in at 1 a.m. The hard part of DeFi was never the signing. It was the seventeen tabs.

As of this release, that sentence is the whole interface. Pantessa compiles it into an ordered job, builds each transaction deterministically, gates every one behind the same guardrails, and walks you through the signatures one at a time. When the last step is a standing instruction — "protect it" — a guardian keeps watching after you close the tab.

## What a job is

A job is a compound intent turned into steps:

1. **Compile.** The planner reads the sentence and produces a plan — bridge, deposit, open, guard — with the amounts and venues resolved. The planner writes *no* calldata and *no* addresses. It never has.
2. **Build, one step at a time.** Each step goes through the native transaction layer: quotes fetched live, calldata constructed by per-venue builders, then checked by a guard that fails closed. Cross-chain transfers are verified to move exactly the quoted amount to the tool's one-time deposit address. Anything with a deadline ships with a refresh recipe, so a stale quote gets re-quoted instead of re-signed on hope.
3. **Sign and advance.** You sign step one; the job builds step two against the world as it actually is *after* step one — not against a plan from five minutes ago. Every step lands as a receipt.
4. **Guard.** Steps can outlive the chat. A stop-loss becomes a policy watched by a per-minute cron holding a delegated agent key — it can close the position you told it to protect, and can't do anything else. No custody, ever.

## We didn't ship this on faith

Before writing this post, we ran the whole chain with real money on mainnet. One prompt: a burner wallet bridged USDC from Base to Arbitrum via NEAR Intents, deposited $25 into Hyperliquid, opened an ETH long, and armed a stop. The guardian watched it from a cron, on a delegated key, with the guard between it and the exchange. The position closes itself; we get a receipt and a line in the ledger.

The interesting finding wasn't that it worked. It's *where* the work moved. Orchestration used to mean the model doing more — more freedom, more ways to be wrong. Ours means the model doing less: it picks the steps, and everything that can lose money is deterministic code checked by deterministic guards. Each step is only built once the previous one has settled, so the plan can't drift from reality. That's what makes a five-step job as safe to sign as a one-step swap: you're never signing the plan, only the next verified transaction.

## Adoption is one HTTP call

You don't integrate venues, chains, or our chat to use this. You send the sentence:

\`\`\`
POST /api/jobs
Authorization: Bearer yf_…

{
  "intent": "deposit 12 usdc to hyperliquid, then long $12 of eth, then protect it with a 5% stop",
  "dryRun": true
}
\`\`\`

\`dryRun\` compiles the full plan and builds + guards the first step against live quotes — and creates nothing. No rows, no signatures, $0. It's the honest demo mode: you see exactly what would be built before any money is asked to move. Drop \`dryRun\` and the job is created for real, advancing as signatures land.

The same layer sits under everything else. In [/chat](/chat), a compound ask becomes a job card that walks the steps. In the [embed](/docs) — five lines of script on your own site — it signs with the host page's wallet. An external agent with a \`yf_\` key gets the exact same compiler, builders, and guards as a human in the chat. One layer, every front door.

## Why the guardrails are the adoption story

It sounds backwards, but the strictness is what makes this easy to hand to people. A chat that could be talked into an unquoted transfer is a demo; a chat where the model physically cannot author calldata is a product. Every job step carries its priced value into the receipt, every build traces its decisions, and every guard refuses before a signature rather than apologizing after one.

Bridge, swap, long, guarded — one sentence, four receipts. Try the dry run first; it's free, and it shows you everything.

— Written by the same agent that armed the stop.`,
}

async function main() {
  const prisma = new PrismaClient()
  const author =
    (process.env.ADMIN_WALLETS ?? '').split(',')[0]?.trim().toLowerCase() ||
    '0x0000000000000000000000000000000000000000'
  const existing = await prisma.blogPost.findUnique({ where: { slug: POST.slug } })
  await prisma.blogPost.upsert({
    where: { slug: POST.slug },
    update: { title: POST.title, description: POST.description, content: POST.content, tags: POST.tags },
    create: {
      ...POST,
      published: false, // DRAFT — the owner publishes (see header comment)
      authorAddress: author,
    },
  })
  console.log(`  ✓ ${POST.slug} ${existing ? 'updated (draft status untouched)' : 'created as draft'}`)
  await prisma.$disconnect()
}

// Only run when executed directly — the POST text is importable elsewhere.
if (process.argv[1]?.includes('seed-orchestration-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
