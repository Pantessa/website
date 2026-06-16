import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight, KeyRound, Wallet } from 'lucide-react'
import CopyBlock from '@/components/CopyBlock'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'claude-code')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

// The deliverable: a self-contained prompt for Claude Code. Plain text on
// purpose (no markdown fences inside) so a single copy-paste survives intact.
const CLAUDE_PROMPT = `Add Yeetful spend-controlled x402 payments to this agent project.

Yeetful gives an agent an "expense account": an allowlist of hosts plus
per-call/per-day USDC budgets, enforced locally BEFORE any payment is
signed, with a receipt for every decision. Docs: https://yeetful.com/docs

Do the following, asking me to confirm anything ambiguous:

1. Install: npm install yeetful viem (or the pnpm/yarn equivalent this
   repo already uses).

2. Find where this project makes HTTP calls to paid or x402 APIs. Create a
   single shared payer in src/lib/pay.ts (adjust path to repo conventions):

   import { yeetful } from 'yeetful/agent'
   import { createWalletClient, http } from 'viem'
   import { base } from 'viem/chains'
   import { privateKeyToAccount } from 'viem/accounts'

   const wallet = createWalletClient({
     // If this project already has a Coinbase Developer Platform (CDP)
     // wallet or another viem account, use THAT as the account instead.
     account: privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`),
     chain: base,
     transport: http(),
   })

   export const pay = yeetful({
     wallet,
     grant: {
       id: process.env.YEETFUL_GRANT_ID,
       allow: [], // TODO: add the exact hostnames this agent may pay
       perCallUsd: 0.05,
       perDayUsd: 2,
     },
     apiKey: process.env.YEETFUL_API_KEY,
     // www origin on purpose: fetch drops auth headers on cross-origin
     // redirects, and the apex currently redirects to www.
     ledgerUrl: 'https://www.yeetful.com',
     onEvent: (m) => console.log('[yeetful]', m),
   })

   Replace direct fetch calls to those paid hosts with pay(), and add each
   host to the grant's allow list. Call await pay.flushLedger() before
   short-lived scripts exit.

3. Env setup: add PRIVATE_KEY (or wire the existing CDP signer),
   YEETFUL_API_KEY, and YEETFUL_GRANT_ID to .env; make sure .env is
   gitignored; add the three keys to .env.example with placeholder values.

4. Now walk me through the two Yeetful dashboard steps INTERACTIVELY —
   one at a time, waiting for me to confirm each before continuing:
   a. Tell me to open https://yeetful.com/dashboard/keys, connect my
      wallet, sign in, and mint an API key. Remind me the yf_ secret is
      shown only once. Wait for me to paste nothing — I'll put it in .env
      myself — then continue when I say done.
   b. Tell me to copy YEETFUL_GRANT_ID from the "Your expense account"
      chip on that same page into .env, and to flip ON the agents I trust
      at https://yeetful.com/dashboard/approvals. Continue when I say done.

5. Verify without spending: run the agent against one free (non-402)
   allowlisted endpoint, confirm a $0 "settled" receipt logs and a ledger
   sync POST succeeds (no 401s). Show me the output. Do NOT make a paid
   call unless I explicitly say so.

Keep the caps small. Never print or commit secrets. If this repo's paid
hosts speak x402 v1 or v2, no extra handling is needed — the SDK detects
the protocol version per challenge.`

export default function ClaudeCodePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> ADD WITH CLAUDE CODE
      </p>
      <h1 className="docs__h1">Add Yeetful to your agent with one prompt</h1>
      <p className="docs__lead">
        Paste the prompt below into Claude Code (or any capable coding agent) in your project. It
        wires the SDK in — working with whatever wallet your agent already uses, including a
        Coinbase Developer Platform account — then walks <em>you</em> through the two dashboard
        clicks — minting an API key and copying your grant id — at the right moment, with the right
        links.
      </p>

      <div className="docs__prose">
        <h2>The prompt</h2>
        <CopyBlock text={CLAUDE_PROMPT} label="Copy prompt" />

        <h2>What it sets up</h2>
        <ul>
          <li>
            One shared <code>pay()</code> — a grant-aware fetch with an allowlist and small
            default caps ($0.05/call, $2/day) you can raise later
          </li>
          <li>
            Your existing <strong>CDP wallet works as the signer</strong> — CDP accounts satisfy
            viem&apos;s account interface, so no separate key is needed
          </li>
          <li>
            Hosted ledger sync pointed at the canonical origin (a cross-origin redirect would
            silently strip the auth header — <Link href="/docs/ledger-sync">details</Link>)
          </li>
          <li>A no-spend verification step — the first paid call only happens when you say so</li>
        </ul>

        <h2>The two clicks Claude will ask you for</h2>
      </div>

      <div className="docs__cards" style={{ maxWidth: '80ch' }}>
        <Link href="/dashboard/keys" className="docs__card">
          <span className="docs__cardtitle flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Mint an API key
            <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
          </span>
          <span className="docs__carddesc">
            yeetful.com/dashboard/keys — the yf_ secret shows once; the same page has your
            YEETFUL_GRANT_ID with one-click copy.
          </span>
        </Link>
        <Link href="/dashboard/approvals" className="docs__card">
          <span className="docs__cardtitle flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Approve your agents
            <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
          </span>
          <span className="docs__carddesc">
            Toggles are enforcement: your expense account refuses to pay anything you haven&apos;t
            switched on.
          </span>
        </Link>
      </div>

      <div className="docs__prose">
        <h2>Why route a Coinbase agent through Yeetful?</h2>
        <p>
          CDP gives your agent a wallet; Yeetful gives it <strong>spending policy</strong> — the
          allowlist, the budgets, the typed refusals, and a receipt trail your dashboard (and
          your team) can audit. The two compose: CDP signs, Yeetful decides whether it should.
          When you want hard on-chain guarantees on top, the same grant terms are built to map
          onto Coinbase Spend Permissions — that&apos;s the direction of travel for the{' '}
          <Link href="/docs/expense-account">expense account</Link>.
        </p>
      </div>
    </>
  )
}
