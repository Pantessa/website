#!/usr/bin/env tsx
/**
 * Seed the intent-links onboarding post as a DRAFT (committed fixture,
 * idempotent — upserts by slug, never flips `published`).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-links-post.ts
 *
 * Publishing stays owner-gated: the API route requires a wallet on
 * ADMIN_WALLETS, so when Nate is ready it's one command:
 *
 *   curl -X PATCH https://www.pantessa.com/api/blog/onboarding-is-a-link-problem \
 *     -H 'authorization: Bearer yf_…' -H 'content-type: application/json' \
 *     -d '{"published": true}'
 *
 * (publishedAt is set exactly once, so re-publishing never games the feed.)
 *
 * Art is code, not uploads. The head is a bespoke BlogCoverArt composition for
 * this slug (one intent fanning into a batch of links, all landing on one
 * signature) reusing the shared blogart__route / blogart__ping animations; the
 * in-body diagrams are ```figure blocks rendered by BlogFigure.
 */
import { PrismaClient } from '@prisma/client'

export const POST = {
  slug: 'onboarding-is-a-link-problem',
  title: 'Crypto onboarding is a link problem',
  description:
    'Most web3 onboarding dies in the gap between wallet connect and the first transaction. Intent links close it: the user brings an intent, and we do the rest — scan, fund, bridge, build, guard. They just sign.',
  tags: ['onboarding', 'intent links', 'conversion', 'web3 ux'],
  content: `Every team shipping onchain has the same funnel, and it fails in the same place. Not at the ad. Not at the landing page. It fails in the corridor between *I'm interested* and *I did the thing*.

The numbers are unkind and remarkably consistent. Roughly **68% of users who connect a wallet never complete a first action**, and across the category somewhere between 60% and 90% churn before their first transaction. That is not a traffic problem. You can buy more clicks and lose them at exactly the same rate.

\`\`\`chart
{"type":"stat","value":"68%","label":"of users who connect a wallet never reach a first activation — the drop-off happens after the click, not before it.","source":"Formo, DeFi Onboarding: 3 UX Patterns That Fix Your First Activation Rate (2026)"}
\`\`\`

## Where web3 onboarding actually breaks

Count the decisions between a link on a timeline and a completed action. Install a wallet. Write down a seed phrase. Get funds in. Notice they're on the wrong chain. Bridge. Discover you need gas on the destination chain too. Pick a venue. Set slippage. Sign something you can't read.

Eight decisions, every one of them a place to quit, and none of them is the thing the user actually wanted.

\`\`\`figure
{"name":"onboarding-wall","title":"The corridor is the product problem","caption":"Every step is a chance to leave. The measured wall sits early — right after connect, before anything of value has happened."}
\`\`\`

The usual response is to explain better: guided actions, prefilled defaults, microcopy at the point of risk. Those are real improvements and they do move activation. But they optimize the corridor rather than removing it. The user is still the one assembling the transaction — you've just given them a nicer instruction manual.

## The smallest possible ask is a sentence

There's a better primitive, and the intent-based crowd named it years ago: **an intent is an outcome request, not a set of instructions.** The user says what they want. The system is responsible for the how.

We took that literally. An intent link is a short URL that carries an ask as a plain sentence:

- [/i/buy-aapl](/i/buy-aapl) — *"Buy $10 of AAPL"*
- [/i/dca-eth](/i/dca-eth) — *"DCA $25 into ETH weekly"*
- [/i/stake-eth](/i/stake-eth) — *"Stake 0.05 ETH with Lido"*
- [/i/protected-long](/i/protected-long) — *"2X long $12 of HYPE, then protect it with a 5% stop"*

That last one is worth staring at. It's a bridge, a deposit, a leverage change, an order, and a standing stop-loss policy. As an onboarding flow it's a nightmare. As a link it's a sentence.

\`\`\`figure
{"name":"link-anatomy","title":"What's in the link, and what isn't","caption":"The link carries a sentence and nothing else. The transaction is rebuilt on our side by deterministic builders and refused by a guard that fails closed — which is why a link is safe to hand to a stranger."}
\`\`\`

The visitor does three things: tap, connect, sign. Between the second and the third we scan their wallet across every chain, work out that they're $6 short on the chain that matters, plan the funding legs, bridge, cover destination gas, build the calldata, price it, and put it through the guardrails. If they can't afford it, they get an honest sentence naming what they actually hold — not "insufficient funds."

That's the whole pitch, and it's the reason this reads as an onboarding story rather than a feature: **the key to onboarding users is letting them have an intent and doing the rest yourself.**

## Batching links: one page, one paste, one campaign

One link is a demo. A batch is a distribution channel — and batching is where this stops being a nicer button and starts being how you actually acquire users.

\`\`\`figure
{"name":"link-batch","title":"Many links, one engine","caption":"A creator page, a set of buttons on your site, a campaign's worth of phrasings — every ask is its own link with its own funnel, and all of them are rebuilt by the same guarded layer. No per-link integration, because the link is just a sentence."}
\`\`\`

Batched links show up in three shapes, and they're the same object underneath:

1. **A creator page.** Claim a handle and every link you mint lands on \`yeetful.com/l/<handle>\` — a linktree, except the rows move money. Wallets are never the key to a page; only a claimed handle is.
2. **Buttons on your own site.** The [generator](/links/embed) mints a link and hands back a copy-paste snippet. Visitors tap, sign with their own wallet, and a validated return button brings them home. Zero SDK, zero integration.
3. **Variants of one ask.** A link can carry up to three alternate phrasings alongside the base. Same destination, different sentence — A/B the ask itself, which is the only copy that matters, because the ask *is* the interface.

Mint them by typing an ask, from any chat message you liked, or straight from an agent through the hands MCP. Same object every time.

## What a batch reports back

Every link keeps its own funnel, and the numbers come from receipts, not from the browser.

\`\`\`figure
{"name":"link-funnel","title":"Opens → connects → builds → signed","caption":"Per link, server-truth. Signed turns are the only ones that count, which makes the funnel boring in the right way: you can see exactly which phrasing of an ask survives contact with a real wallet."}
\`\`\`

A batch of links is therefore also an experiment rig. Ten asks in a campaign, ten funnels, and the one that converts tells you something no landing-page test can: which *intent* people actually have, phrased the way they'd phrase it.

## Why a stranger's link is safe to open

The scary version of this idea is a URL that executes. That's phishing with better UX, so the contract is narrow and it has no exceptions:

- **The link carries a sentence.** Never calldata, never addresses, never a signed artifact. Nothing inside a link can execute; the action is rebuilt from scratch on our side by per-venue builders and checked by a guard that refuses before a signature rather than apologizing after one.
- **"Connect & build" is the consent.** Nothing runs until the visitor presses it. Nothing moves until their wallet signs.
- **Transfer-shaped asks never auto-run.** *"Send X to 0x…"* is the phishing shape. Those land prefilled and wait for a deliberate press of send.
- **Return URLs are validated at mint,** stored server-side, and only ever offered as a button after a signature — never read from the query string, which is what kills open-redirect tampering.
- **Non-custodial, structurally.** The signer is the visitor's own wallet. We never hold keys and never hold funds. The worst case for a bad link is that someone reads a sentence and closes the tab.

## Start with one

Onboarding advice usually amounts to *explain it better*. The alternative is to need less explaining: take the outcome, own every step between, and hand back a receipt.

Open one of the house links above and watch what happens after you connect — the funding plan is usually the moment it lands. Then [mint your own](/dashboard/links), put a [button on your site](/links/embed), or read [how it works](/docs/links).

You have an intent. We do the rest.`,
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
if (process.argv[1]?.includes('seed-links-post')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
