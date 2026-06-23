import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight, KeyRound, Wallet } from 'lucide-react'
import CopyBlock from '@/components/CopyBlock'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { PAYER_CLAUDE_PROMPT } from '@/lib/prompts'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'claude-code')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}


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
        <CopyBlock text={PAYER_CLAUDE_PROMPT} label="Copy prompt" />

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
