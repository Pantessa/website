import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'quickstart')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function QuickstartPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> QUICKSTART
      </p>
      <h1 className="docs__h1">Quickstart</h1>
      <p className="docs__lead">
        Install the SDK, define a spend grant, make a paid call. About twenty lines, no API keys
        to the services you call — payment is USDC on Base via the x402 protocol.
      </p>

      <div className="docs__callout">
        <p>
          <strong>Fastest path — let Claude wire it in.</strong> Paste{' '}
          <Link href="/docs/claude-code">one prompt</Link> into Claude Code (or any capable coding
          agent) in your project and it installs the SDK, adds a shared <code>pay()</code>, and
          walks you through the dashboard clicks. Prefer to do it by hand? Read on.
        </p>
      </div>

      <div className="docs__prose">
        <h2>1. Install</h2>
        <pre>
          <code>{`npm install yeetful viem`}</code>
        </pre>
        <p>
          <code>viem</code> is a peer dependency, so the SDK stays light and tracks whatever viem
          version your app already uses.
        </p>

        <h2>2. A wallet</h2>
        <p>
          Any viem <code>WalletClient</code>{' '}works — a small dedicated burner for development, or
          a Coinbase Developer Platform wallet in production (CDP accounts satisfy viem&apos;s
          account interface, so they drop straight in). Fund it with a few dollars of USDC on
          Base; payments are gasless EIP-3009 authorizations, so no ETH is needed.
        </p>
        <pre>
          <code>{`import { createWalletClient, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`),
  chain: base,
  transport: http(),
})`}</code>
        </pre>

        <h2>3. The expense account</h2>
        <pre>
          <code>{`import { yeetful, GrantError } from 'yeetful/agent'

const pay = yeetful({
  wallet,
  grant: {
    allow: ['tripadvisor.x402.paysponge.com', 'anthropic.yeetful.com'],
    perCallUsd: 0.05, // refuse any single call above 5¢
    perDayUsd: 2,     // refuse once today's spend would pass $2
    expiresAt: '2026-12-31',
  },
  onReceipt: (r) => console.log(r.host, \`$\${r.amountUsd}\`, r.txHash ?? r.note),
})`}</code>
        </pre>

        <h2>4. Pay per call</h2>
        <pre>
          <code>{`try {
  const res = await pay('https://tripadvisor.x402.paysponge.com/api/v1/location/search?searchQuery=tokyo')
  console.log(await res.json())
  console.log(\`spent today: $\${pay.spentTodayUsd()} / left: $\${pay.remainingTodayUsd()}\`)
} catch (e) {
  // GrantError.code: NOT_ALLOWED | OVER_PER_CALL | BUDGET_EXCEEDED | EXPIRED | REVOKED
  if (e instanceof GrantError) console.error(\`blocked: \${e.code}\`)
}`}</code>
        </pre>
        <p>
          <code>pay()</code> behaves like <code>fetch</code>: non-402 responses pass straight
          through (still allowlist-checked and receipted at $0), and a 402 challenge triggers the
          grant check → sign → retry flow automatically. Off-policy calls throw{' '}
          <strong>before any network or payment activity</strong>.
        </p>

        <h2>Next</h2>
        <ul>
          <li>
            <Link href="/docs/claude-code">Add with Claude Code</Link> — skip the manual wiring:
            one prompt installs the SDK and sets up <code>pay()</code> for you
          </li>
          <li>
            <Link href="/docs/expense-account">The expense account</Link> — what grants enforce
            and what receipts contain
          </li>
          <li>
            <Link href="/docs/ledger-sync">Dashboard ledger sync</Link> — see this agent&apos;s
            receipts on yeetful.com
          </li>
          <li>
            <a href="https://github.com/Yeetful/example-agent">Yeetful/example-agent</a> — this
            quickstart as a runnable repo with a free demo mode
          </li>
        </ul>
      </div>
    </>
  )
}
