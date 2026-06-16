#!/usr/bin/env tsx
/**
 * Seed the 0.5 launch post (org budgets + the remote kill switch) as a DRAFT
 * (committed fixture, idempotent — upserts by slug, never flips `published`).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-killswitch-post.ts
 *
 * Publish-blocked by design: ADMIN_WALLETS gates the publish, so neither this
 * script nor the API flips it live. `yeetful` 0.5 is already on npm (the post
 * presents 0.5 as available), so publishing is one command whenever the owner
 * is ready:
 *
 *   curl -X PATCH https://www.yeetful.com/api/blog/freeze-your-agents-spend \
 *     -H 'authorization: Bearer yf_…' -H 'content-type: application/json' \
 *     -d '{"published": true}'
 *
 * (The Bearer key must belong to a wallet on ADMIN_WALLETS; publishedAt is set
 * exactly once, so re-publishing never games the feed.)
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'freeze-your-agents-spend',
  title: "Freeze your agent's spend",
  description:
    'Org budgets and a remote kill switch: one daily cap over your whole team of agents, and a reversible pause that stops a runaway agent — or the entire account.',
  tags: ['teams', 'orgs', 'kill-switch', 'sdk', 'x402'],
  content: `Your expense account got two new ways to say no.

[Per-agent allowances](/docs/agents) gave each agent its own daily budget. This release answers the next two questions a team asks the moment more than one person — or more than one agent — is spending: *what's our shared limit*, and *how do I stop it right now?*

## A shared account, two budget ceilings

Teams don't share a wallet by passing a private key around. On Yeetful an [organization](/docs/teams) is a shared expense account: add a teammate by wallet address — the address **is** the invite — and the org's API keys are the org's credentials, not any one person's.

The budget is now two-level. Each agent keeps its own per-day allowance, and the org sits **above** them with a daily cap of its own, summed across every agent in it. Five agents at $5/day each, but a $15/day org ceiling? The sixteenth dollar of the day is refused no matter which agent asks for it. Over *either* level stops the payment.

## The kill switch

Budgets are a slow no — they bind at the end of the day. Sometimes you need a fast one.

Two controls, both reversible, both distinct from revoking a key (which is permanent):

- **Pause an agent** — one connected app, frozen. Its row on the [Agents tab](/dashboard/agents) goes amber and every payment it tries is refused with \`AGENT_PAUSED\`.
- **Freeze the account** — the whole expense account, from the [Overview](/dashboard). One switch, everything under it stops, with \`ACCOUNT_FROZEN\`.

Flip it back and spend resumes — the history is intact, nothing was destroyed. It's the control you reach for when something looks wrong and you'll work out *what* later.

## How hard is "stop"?

As hard as the rail allows — and we'll tell you exactly where the line is.

For a chat Yeetful runs, the freeze is a **server-side hard stop**: the payment never leaves. For an external agent paying x402 from its own wallet, we can't reach into the transaction — what we *can* do is make the SDK refuse to sign. \`yeetful\` 0.5 loads your policy before the first payment and again on every ledger sync, and throws \`OVER_ORG_BUDGET\`, \`AGENT_PAUSED\`, or \`ACCOUNT_FROZEN\` — receipted like any other decision — the moment one applies:

\`\`\`
pay.orgBudget() // { name, perDayUsd, spentTodayUsd, overBudget }
pay.status()    // { halted, haltReason: 'AGENT_PAUSED' | 'ACCOUNT_FROZEN' | null }
\`\`\`

A paused agent picks the change up on its next policy refresh and stops on its own. Advisory, yes — but advisory against *your own* agents (a runaway loop, a bug, a prompt-injected tool call) is exactly the threat model this defends.

The adversarial version — a stop that holds even against code that skips the SDK — is the wallet contract itself. That's [Coinbase Spend Permissions](/docs/expense-account), and the pause you flip today points straight at it.

## Try it

1. Build a team at [/docs/teams](/docs/teams) — add members by address, set the org cap.
2. Pause a single agent from [/dashboard/agents](/dashboard/agents); freeze everything from [/dashboard](/dashboard).
3. Upgrade the SDK — \`npm install yeetful@latest\` (0.5) — and read \`pay.status()\` before you trust a run.

— Written by the autopilot. It can be paused too.`,
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
if (process.argv[1]?.includes('seed-killswitch-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
