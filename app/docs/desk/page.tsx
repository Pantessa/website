import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import DeskTranscript from '@/components/DeskTranscript'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'desk')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function DeskDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> GIVE YOUR AGENT HANDS
      </p>
      <h1 className="docs__h1">Give your agent hands</h1>
      <p className="docs__lead">
        Every agent framework is bolting on a wallet. None of them want to carry the liability of
        letting a language model write calldata. Pantessa already solved that — so connect your
        agent over MCP and it gets <strong>money-hands that can&apos;t steal</strong>: it plans in
        plain sentences, deterministic guarded builders write every transaction, and a human (or
        the agent&apos;s own key, under caps) is the only signer. Nothing this surface hands your
        agent can execute by itself.
      </p>

      <div className="my-6">
        <DeskTranscript />
      </div>

      <div className="docs__prose">
        <h2>Two doors</h2>
        <p>
          Both talk in sentences and links — never calldata, typed data, or deposit addresses. Pick
          by whether your agent needs to hear back.
        </p>
        <ul>
          <li>
            <strong>The hands MCP</strong> — fire-and-forget. Your agent scans a wallet, plans an
            action, and mints one sign link to hand its human. Free, no key, instant. Best when a
            human is in the loop and your agent just needs to produce the link.
          </li>
          <li>
            <strong>The desk MCP</strong> — stateful. Your agent opens an intent, negotiates funding
            routes, hands off, and then <em>polls back</em> (<code>broker_status</code>) to learn
            whether its human actually signed — the feedback loop the fire-and-forget hands lacks.
            It also carries the agent-signed path (<code>broker_execute</code>) for sequenced flows
            the agent drives with its own key, and <code>broker_send</code> to address an intent
            straight to a wallet or <code>@handle</code>&apos;s <Link href="/docs/desk">inbox</Link>{' '}
            (they open it and sign — no link to pass, they never had to ask).
          </li>
        </ul>

        <h2>Connect in five minutes</h2>
        <p>The hands MCP — one line in Claude Code (or any MCP client that speaks Streamable HTTP):</p>
        <pre className="splash__code mono">
          claude mcp add --transport http pantessa-hands https://hands-mcp.yeetful.com/mcp
        </pre>
        <p>The desk MCP — the stateful sibling:</p>
        <pre className="splash__code mono">
          claude mcp add --transport http pantessa-desk https://www.pantessa.com/api/broker/mcp
        </pre>
        <p>
          Any MCP client works — point it at the same URLs. Start by calling{' '}
          <code>what_pantessa_can_do</code> (hands) or <code>broker_capabilities</code> (desk): each
          returns the capability map and the handoff contract before you do anything else.
        </p>

        <h2>The loop</h2>
        <ol>
          <li>
            <strong>Scan</strong> — <code>scan_wallet</code> reads a wallet&apos;s movable money
            across Base, Arbitrum, and Ethereum (gas-reserve aware), so your plan is grounded in
            what the human actually holds.
          </li>
          <li>
            <strong>Plan</strong> — decide what should happen and phrase it as one plain sentence
            (<em>&ldquo;Buy $12 of AAPL&rdquo;</em>, <em>&ldquo;Swap $5 of ETH to USDC on Base&rdquo;</em>,{' '}
            <em>&ldquo;Protect my HYPE long with a 5% stop&rdquo;</em>). See{' '}
            <Link href="/docs">what Pantessa can build</Link>.
          </li>
          <li>
            <strong>Hand off</strong> — <code>prepare_handoff</code> (hands) or{' '}
            <code>broker_handoff</code> (desk) mints a <code>/i/&lt;slug&gt;</code> sign link. Give
            it to your human: they connect their own wallet, Pantessa rebuilds and guard-checks the
            ask from scratch, and only their signature moves anything.
          </li>
          <li>
            <strong>Hear back</strong> (desk only) — poll <code>broker_status</code> for the
            server-truth funnel: opened → connected → built → signed → settled, with the signed USD.
            Or skip the poll: pass a <code>callback_url</code> to <code>broker_open</code> and
            Pantessa POSTs you a signed webhook the moment your human signs or the move settles
            (<code>X-Pantessa-Signature</code> = HMAC-SHA256 of the body under a secret returned once
            at open). <code>broker_status</code> stays the fallback.
          </li>
        </ol>

        <h2>The agent-signed path</h2>
        <p>
          When your agent holds the funds <em>and</em> the key, <code>broker_execute</code> compiles
          a sequenced ask (fund → wait for settlement → act) into a job the agent drives leg by leg:
          it fetches each leg from the job API as the runner builds it (guarded, policy-checked, one
          at a time), signs and broadcasts with its own key, and posts completion — wait legs verify
          on-chain arrival before the next leg builds. No transaction material ever travels through
          the MCP surface.
        </p>
        <p>
          Because this path has no human in the loop, it runs under a tighter fence: it requires a
          bound identity (<code>agent_key</code>, refused by name without one), a per-intent
          notional cap, and a desk-level kill switch. The agent-signed path is rolling out — the
          human-handoff loop above is the front door, and it is live today.
        </p>

        <h2>What it costs</h2>
        <p>
          The desk is <strong>free to call</strong> by default — Pantessa earns the link-tier fee on
          the signed volume it clears, not on the calls. When an operator turns on the paid door, the
          value tools (<code>broker_open</code>, <code>broker_execute</code>, <code>broker_send</code>,{' '}
          <code>broker_tile</code>) cost a few cents in USDC per call over x402, while capabilities,
          status, and close stay free. <code>broker_capabilities</code> always advertises the current
          price, so an agent knows before it calls. Your x402 payer address is your desk identity —
          the same address that carries your caps and your{' '}
          <Link href="/docs/desk">track record</Link>.
        </p>

        <h2>The safety contract</h2>
        <p>
          This is the whole point, so it is mechanical, not a promise: the desk re-checks that no
          reply carries transaction bytes, and the deterministic guarded builders — not any model —
          write every transaction on the sign side. Read the{' '}
          <Link href="/docs/trust">trust model</Link> for how a build is guarded, priced, capped,
          and receipted before anyone signs.
        </p>
      </div>
    </>
  )
}
