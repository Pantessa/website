import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import CopyBlock from '@/components/CopyBlock'

// A copy-paste Claude Code prompt: it installs the yeetful SDK into the
// operator's MCP and wires the earnings-tracking sync, so every settled call
// shows up on their dashboard with one paste. Kept here (not inline JSX) so the
// text streams into the SSR HTML and stays crawlable.
const TRACK_EARNINGS_PROMPT = `Install the yeetful SDK in this MCP server and wire it up so I can track its
earnings on my Pantessa dashboard:

1. Run: npm install yeetful
2. Wrap the x402-paid handler with yeetful's server helper so every settled
   call is reported to the hosted ledger.
3. Read PANTESSA_API_KEY and PANTESSA_GRANT_ID from the environment and pass them
   as { apiKey, ledgerUrl: 'https://www.pantessa.com' } so receipts sync.
4. Print a one-line confirmation showing the server is reporting earnings.

I'll mint the yf_ API key at yeetful.com/dashboard/keys and claim this MCP at
its service page first.`

const PAGE = DOCS_PAGES.find((p) => p.slug === 'launchpad')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function LaunchpadDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> LAUNCHPAD
      </p>
      <h1 className="docs__h1">Launchpad: claim &amp; launch</h1>
      <p className="docs__lead">
        Own a piece of an MCP. Its operator <strong>claims</strong>{' '}it by signing in with the
        wallet it&apos;s paid to, <strong>launches</strong> a token on a bonding curve, and from then on a
        share of <em>every paid call</em> flows to whoever stakes the token — in USDC, as the agents
        work. The better the MCP does, the more value flows.
      </p>

      <div className="docs__prose">
        <p>
          <strong>Testnet.</strong> The launchpad runs on Base Sepolia today. Addresses and the
          token are test-only; no real funds. This page is the walk-through.
        </p>

        <h2>The take rate, not a markup</h2>
        <p>
          Stakers earn a <strong>maker-side take rate</strong> — a slice the MCP gives up out of
          its own per-call revenue (default <strong>10%</strong>), in exchange for distribution and
          a token that capitalizes its future earnings. The agent paying for the call is{' '}
          <strong>not</strong>{' '}surcharged: it pays the same price it would anywhere. That&apos;s the
          point — Pantessa routes agents to the best, cheapest MCP, so a markup would defeat the
          whole thing.
        </p>

        <h2>Step 1 — Claim your MCP</h2>
        <p>
          Claiming binds the MCP to your wallet — the creator-of-record for its token. You prove you
          operate it by signing in with the wallet it&apos;s <strong>paid to</strong>: the x402{' '}
          <code>payTo</code>{' '}receiver in your MCP&apos;s own config. Pantessa reads that address
          straight from your MCP&apos;s 402 challenge — so only whoever collects its revenue can
          claim it. No file, no DNS, no deploy.
        </p>
        <ol>
          <li>
            Open your service page at <code>yeetful.com/servers/&lt;your-mcp&gt;</code> and find the{' '}
            <strong>Token</strong> panel.
          </li>
          <li>Connect the wallet your MCP is paid to (its x402 receiver) and sign in.</li>
          <li>
            Click <strong>Claim</strong>. Pantessa checks your wallet against the <code>payTo</code>{' '}
            the MCP itself returns — match, and it&apos;s yours.
          </li>
        </ol>
        <p>
          That&apos;s <code>POST /api/mcp/&lt;slug&gt;/claim</code>, gated by your SIWE session. You
          can release the claim from the same panel.
        </p>
        <p className="mono" style={{ color: 'var(--smoke)' }}>
          Don&apos;t control the payee wallet — e.g. your MCP runs behind a shared gateway whose
          address you don&apos;t hold? It needs <strong>admin verification</strong>; reach out and
          Pantessa will verify it.
        </p>

        <h2>Step 2 — Launch the token</h2>
        <p>
          A launch mints the MCP&apos;s token onto Flaunch&apos;s fair-launch curve (it graduates to
          a Uniswap pool on Base) and, in the same call, stands up the token&apos;s{' '}
          <strong>rev-share vault</strong> so call fees have somewhere to land. One call to the{' '}
          <code>YeetfulLaunchFactory</code>:
        </p>
        <pre>
          <code>{`factory.launch(mcpId, name, symbol, creator)
  → (tokenAddress, stakingAddress)`}</code>
        </pre>
        <p>
          <strong>Today this is a contract call, not yet a button.</strong> On testnet a launch is
          run against the factory on Base Sepolia (Pantessa can run it for you, or you call it
          directly), after which the token + vault addresses are linked to your service so the panel
          shows the live token. A one-click <em>Launch</em> button is the next step.
        </p>

        <h2>Step 3 — Earn as the agents work</h2>
        <p>
          Once launched, the token is public. Anyone can <strong>buy</strong> it on the curve and{' '}
          <strong>stake</strong>{' '}it; the configured take rate of every settled call to that MCP is
          routed to stakers in USDC, claimable any time. No stakers yet? The fees escrow to the
          creator. The buy / stake / claim controls live on the service page&apos;s Token panel.
        </p>
        <p className="mono" style={{ color: 'var(--smoke)' }}>
          Note: launch is honest about itself — until real routing volume exists, the yield is
          small. The token is a claim on the MCP&apos;s actual usage, not a promise.
        </p>

        <h2>Track your earnings — wire the SDK with one paste</h2>
        <p>
          Once your MCP is claimed, drop the <code>yeetful</code> SDK into it and every settled call
          syncs to your dashboard, where the payTo agents you operate show up under{' '}
          <strong>Track your agents&apos; earnings</strong>. Paste this into{' '}
          <Link href="/docs/claude-code">Claude Code</Link> from your MCP&apos;s repo and it does the
          install + wiring for you:
        </p>
        <CopyBlock text={TRACK_EARNINGS_PROMPT} label="Copy prompt" />
        <p>
          Prefer to do it by hand? It&apos;s one dependency — <code>npm install yeetful</code> — then
          report each paid call to the hosted ledger with your <code>yf_</code> key. See{' '}
          <Link href="/docs/ledger-sync">Dashboard ledger sync</Link> for the full wiring.
        </p>

        <h2>What&apos;s coming</h2>
        <ul>
          <li>A one-click <strong>Launch</strong> from the claimed service page.</li>
          <li>In-page <strong>buy / stake / claim</strong> for holders.</li>
          <li>Mainnet — pending security and legal review.</li>
        </ul>
      </div>
    </>
  )
}
