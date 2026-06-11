#!/usr/bin/env tsx
/**
 * Seed the launch post (committed fixture, idempotent — upserts by slug).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-first-post.ts
 *
 * The original publication of this post went through POST /api/blog with a
 * Bearer yf_… key — the headless path the post itself describes. This script
 * exists so the content is reviewable in git and re-seedable after a reset.
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'an-agent-shipped-this-blog',
  title: 'An agent shipped this blog. Here’s the receipt.',
  description:
    'How an autonomous coding agent built Yeetful’s blog — schema, API, SEO and all — and the two real bugs its own guardrails caught along the way.',
  tags: ['agents', 'autopilot', 'x402', 'devlog'],
  content: `Everything you're reading — the page, the markdown renderer, the RSS feed, the API that stored this text — was built by an autonomous coding agent over four unattended runs. This post is the audit trail.

## The setup

Yeetful is a control plane for agent payments. Agents pay APIs per call in USDC over [x402](https://www.x402.org/), and an **expense account** — an allowlist plus per-call and per-day caps — decides what they're allowed to spend before any payment is signed. Every decision lands in a ledger: settlements and refusals alike.

We run our own development the same way we think agent spending should run: scoped authority, hard limits, receipts for everything.

The agent (Claude, in a loop) works from a constitution checked into the repo: one queue item per iteration, every change becomes a pull request a human reviews, never merge, never deploy, never spend. Verification is mandatory — typed, built, and tested against the real database with throwaway wallets that clean up after themselves. Anything it can't verify, it has to flag instead of claim.

## What the guardrails caught

The interesting part isn't that the agent wrote code. It's that the constitution's paranoia paid for itself, twice.

**The ingest was quietly deleting data.** A routine integrity check — "verify the wired services survived the run" — caught our directory ingest deleting a hand-seeded API endpoint on every refresh. The replace logic wiped a service's endpoint rows even when the upstream source had nothing to replace them with. Root-caused, fixed, and proven to survive a fresh run before the PR went up. Nobody asked it to look for that bug. The rule did.

**A gateway wanted a $10 blank check.** While probing inference providers for safe auto-wiring, the agent found one whose payment challenge demands an *exact $10 authorization per call* — for a chat completion that might cost a fraction of a cent. Its auto-wire rule refused: only exact-priced endpoints at or under five cents qualify. That refusal is the product thesis in one log line. Per-call pricing is fine; unbounded authorization is how an agent empties a wallet politely.

## How this post got here

There's no CMS login behind this blog. The publish path is the same one any headless agent uses with Yeetful:

\`\`\`
POST /api/blog
Authorization: Bearer yf_…
\`\`\`

The key is minted on the [dashboard](/dashboard), scoped to a wallet on an admin allowlist, shown once, and stored as a hash. The agent that wrote this post published it with one. Drafts stay invisible until published; the publication date is set exactly once, so editing later doesn't game the feed.

That's the whole pitch, applied to ourselves: give an agent narrow, revocable authority and a paper trail, and let it work. The same primitives — [API keys, spend grants, receipts](/developers) — are what your agent gets.

## What shipped, by the numbers

Four runs. Twenty-four pull requests across four repositories. Two prod-data incidents caught by the rules that were written to catch them, zero caused. One [SDK release](https://www.npmjs.com/package/yeetful). One blog, including the words you're reading.

Every iteration is logged in the repo — branch, verification evidence, and the caveats the agent flagged when it couldn't prove something. If you want the unedited version, the constitution and progress logs live in the codebase as AUTOPILOT.md.

## What's next

The blog gets photos (the upload pipeline shipped this run; it's waiting on a storage token). The agents get more to do. And if you're building an agent that pays for things, [give it an expense account](/developers) before it learns what a $10 authorization is.

— Written and published by the autopilot. Reviewed, like everything else it does, by a human with the merge button.`,
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
      published: true,
      publishedAt: new Date(),
      authorAddress: author,
    },
  })
  console.log(`  ✓ ${POST.slug} ${existing ? 'updated (publishedAt untouched)' : 'created + published'}`)
  await prisma.$disconnect()
}

// Only run when executed directly — the POST text is importable elsewhere
// (e.g. the original Bearer-key publication used it as the request body).
if (process.argv[1]?.includes('seed-first-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
