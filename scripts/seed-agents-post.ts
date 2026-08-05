#!/usr/bin/env tsx
/**
 * Seed the agent-budgets launch post as a DRAFT (committed fixture,
 * idempotent — upserts by slug, never flips `published`).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-agents-post.ts
 *
 * Publish-blocked by design: ADMIN_WALLETS is unset (locally and on Vercel)
 * as of 2026-06-12, so the API route can't publish this and neither does the
 * script. When the owner is ready — ideally after `yeetful` 0.4 is on npm,
 * since the post presents 0.4 as available — publishing is one command:
 *
 *   curl -X PATCH https://www.pantessa.com/api/blog/give-your-agent-an-allowance \
 *     -H 'authorization: Bearer yf_…' -H 'content-type: application/json' \
 *     -d '{"published": true}'
 *
 * (The Bearer key must belong to a wallet on ADMIN_WALLETS; publishedAt is
 * set exactly once, so re-publishing never games the feed.)
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'give-your-agent-an-allowance',
  title: 'Give your agent an allowance',
  description:
    'Per-agent budgets: every app connected to your expense account gets its own daily USD cap, a spent-today meter, and an SDK that refuses to overspend.',
  tags: ['agents', 'budgets', 'sdk', 'x402'],
  content: `Your agent has an [expense account](/docs/expense-account) — an allowlist plus caps that decide what it may pay for, before any payment is signed. As of this release it also has an allowance.

## Two questions, two controls

Spend control is two different questions wearing one trenchcoat:

1. **Where may money go?** That's *approvals* — the per-service toggles on your [dashboard](/dashboard) that shape your account's allowlist. Off by default.
2. **Who may spend it, and how much?** That's *agents* — the apps spending on your behalf through the [yeetful SDK](https://www.npmjs.com/package/yeetful), each with its own per-day budget.

The first has been there since the expense account shipped. The second is new.

## An agent is an API key

There's no separate registration step, no agent manifest. The app holds one of your \`yf_…\` keys; the key **is** the agent. Every receipt it syncs is attributed to it, the [Agents tab](/dashboard/agents) shows each key with a spent-today meter, and the budget field next to it is the allowance. Revoke the key and the agent is disconnected.

One deliberate wrinkle: budgets are edited with your wallet session only. The key itself is not accepted on that route — an agent that could raise its own allowance wouldn't have one.

## The SDK does the refusing

Honesty first: your agent pays x402 challenges from its **own wallet**, so Pantessa can't reach in and block a payment in flight. What we can do is make the SDK refuse to sign one. \`yeetful\` 0.4 asks one question before the first payment:

\`\`\`
GET /api/agent/policy
Authorization: Bearer yf_…

{ "agent": { "perDayUsd": 5, "spentTodayUsd": 4.97,
             "remainingTodayUsd": 0.03, "overBudget": false } }
\`\`\`

Over budget — or quoted a price that would go over — it throws \`GrantError('OVER_AGENT_BUDGET')\` before any money moves, and syncs the refusal to your ledger like any other receipt. An audit trail that only shows successes isn't one.

The snapshot stays fresh for free: every receipt-sync response echoes the updated budget, and \`flushLedger()\` re-checks the policy, so an allowance you cut at lunch applies mid-run. If the policy can't be fetched at all, payments proceed under the grant alone — a budget outage shouldn't strand your agent.

For adversarial guarantees — code that bypasses the SDK entirely — the answer is an on-chain allowance, and that's where this is headed: Coinbase Spend Permissions, with the wallet contract as the enforcement point. The budget you set today is the same number that moves on-chain.

## Why a per-agent number matters

The grant already caps the account. The allowance caps the *app*. When one of your agents hits a retry loop, or a prompt-injected tool call starts calling something expensive, a $5/day budget makes that a five-dollar problem with a paper trail — not a wallet problem with a story.

## Try it

1. Mint a key at [/dashboard/keys](/dashboard/keys) — the secret shows once.
2. Wire \`yeetful({ wallet, grant, apiKey, ledgerUrl })\` around your agent's paid calls.
3. Set the allowance at [/dashboard/agents](/dashboard/agents).

The full model — the policy endpoint, the sync echo, who can change what — is written up in [Agents & budgets](/docs/agents). The three-step version lives on [/developers](/developers).

— The autopilot wrote this one too. Its budget held.`,
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
if (process.argv[1]?.includes('seed-agents-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
