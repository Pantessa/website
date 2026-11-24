import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsSummary, DocsSteps, DocsStep, DocsCallout, DocsNext } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import DeskTranscript from '@/components/DeskTranscript'
import { SITE_CARD } from '@/lib/og-defaults'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'desk')!

// When the agent-signed loop was last driven end to end. The squad coordinator
// updates this the moment the DRIVE lane's live transcript lands; until then it
// is the day `driveJob` was built and proven against a running deployment.
const PROVEN = 'proven 2026-09-23'

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function DeskDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> AGENT DESK (MCP)
      </p>
      <h1 className="docs__h1">Agent desk (MCP)</h1>
      <p className="docs__lead">
        Connect your agent to Pantessa over MCP. It asks in plain sentences, Pantessa&apos;s guarded
        builders write every transaction, and a person or the agent&apos;s own key signs.
      </p>

      <DocsSummary>
        <li>Two MCP servers: the hands (free, no key, one sign link) and the desk (talks back).</li>
        <li>No model writes calldata. Deterministic builders write it and check it before it is offered.</li>
        <li>
          A person signs through a sign link, or the agent signs each leg with its own key under a dollar
          cap.
        </li>
        <li>
          The SDK runs the agent-signed loop in two calls: <code>pantessa/desk</code>.
        </li>
        <li>The desk is free to call. Pantessa earns its fee on the trades that get signed.</li>
      </DocsSummary>

      <div className="my-6">
        <DeskTranscript />
      </div>

      <div className="docs__prose">
        <h2>Connect</h2>
        <p>The hands MCP, in Claude Code or any MCP client that speaks Streamable HTTP:</p>
        <pre className="splash__code mono">
          claude mcp add --transport http pantessa-hands https://hands-mcp.yeetful.com/mcp
        </pre>
        <p>The desk MCP:</p>
        <pre className="splash__code mono">
          claude mcp add --transport http pantessa-desk https://www.pantessa.com/api/broker/mcp
        </pre>
        <p>
          Call <code>what_pantessa_can_do</code> (hands) or <code>broker_capabilities</code> (desk) first.
          Each returns what Pantessa can build and how a hand-off works.
        </p>

        <h2>Pick a server</h2>
        <ul>
          <li>
            <strong>The hands</strong>: fire and forget. <code>scan_wallet</code>{' '}reads a wallet&apos;s
            movable money on Base, Arbitrum and Ethereum, keeping some ETH back for gas.{' '}
            <code>prepare_handoff</code> turns one plain sentence into a <code>pantessa.com/sign</code>{' '}
            link for a person. It never returns calldata, typed data or addresses. Free, no key.
          </li>
          <li>
            <strong>The desk</strong>: it talks back. It quotes an ask, scans funding, offers routes,
            mints a sign link, and reports whether the person signed. It also runs the agent-signed path,
            where your agent signs with its own key.
          </li>
        </ul>

        <h2>Hand off to a person</h2>
        <DocsSteps>
          <DocsStep title="Open the ask">
            <p>
              <code>broker_open</code>{' '}with one plain sentence with amounts, such as &ldquo;Buy $15 of
              AAPL&rdquo;. Pass the person&apos;s <code>wallet</code> to get a real funding scan and
              funding-route options.
            </p>
          </DocsStep>
          <DocsStep title="Choose a route (if offered)">
            <p>
              <code>broker_choose</code> picks an option by id. It rewrites the sentence and the desk quotes
              again. It is the only way to change an ask.
            </p>
          </DocsStep>
          <DocsStep title="Mint the sign link">
            <p>
              <code>broker_handoff</code> returns a <code>pantessa.com/i/&lt;slug&gt;</code> link. The
              person connects their own wallet, Pantessa rebuilds and checks the ask from scratch, and only
              their signature moves anything.
            </p>
          </DocsStep>
          <DocsStep title="Hear back">
            <p>
              Poll <code>broker_status</code>: opened, connected, built, signed, settled, with the signed
              dollar amount. Or pass <code>callback_url</code> to <code>broker_open</code> and get a webhook
              when the person signs or the move settles.
            </p>
          </DocsStep>
        </DocsSteps>
        <p>
          To skip the link, <code>broker_send</code> addresses the ask to a 0x wallet or a claimed{' '}
          <code>@handle</code>. It lands in that person&apos;s Pantessa inbox, where one tap opens it and
          their own signature is still the only one that moves money.
        </p>

        <h2>The agent-signed path</h2>
        <p>
          When your agent holds the funds and the key, it does not need a person.{' '}
          <code>broker_execute</code>{' '}compiles a sequenced ask (fund, wait for settlement, act) into a job
          owned by the agent&apos;s wallet. <code>broker_next</code> then serves each leg as the runner
          builds it, guarded and one at a time. The agent signs and broadcasts it, and{' '}
          <code>broker_done</code> reports the result and answers with the next leg. Wait legs check
          arrival on-chain before the next leg is built.{' '}
          <strong>Round-trip across every settlement boundary, batched within one.</strong>
        </p>
        <p>
          <strong>This is live</strong> ({PROVEN}). The SDK runs the whole loop:{' '}
          <code>pantessa@1.1.0</code>, entry point <code>pantessa/desk</code>. Install it with{' '}
          <code>npm install pantessa viem</code>.
        </p>
        <pre className="splash__code mono">{`import { openAndExecute, driveJob } from 'pantessa/desk'
import { privateKeyToAccount } from 'viem/accounts'

const signer = privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`)
const base = 'https://www.pantessa.com'

const { jobId, token } = await openAndExecute({
  base,
  ask: '2x Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop',
  signer,
  agentKey: process.env.DESK_KEY!,
})

await driveJob({
  base, jobId, token, signer,
  rpc: { 42161: process.env.ARBITRUM_RPC! },
  onLeg: (leg) => console.log(\`leg \${leg.seq} · \${leg.kind} · \${leg.summary}\`),
})`}</pre>
        <p>
          <code>driveJob</code> signs every shape the runner offers: one EVM transaction, a chain of them
          (approve, then swap, re-quoted right before signing), a Hyperliquid action, or a batch of
          Hyperliquid actions signed in one pass and sent in order. A leg whose build has aged out is
          rebuilt, never re-signed. A shape it does not know, such as a CoW or Seaport order, fails{' '}
          <em>closed</em>, by name. A reverted transaction is never reported as done. Pass{' '}
          <code>dryRun: true</code> to see every leg classified without signing anything.
        </p>

        <h2>The fence</h2>
        <p>With no person in the loop, the agent-signed path has tighter rules:</p>
        <ul>
          <li>
            A bound identity: the intent must be opened with <code>agent_key</code>, or execute refuses by
            name. Legs are served to that identity only.
          </li>
          <li>
            Proof of the wallet: <code>wallet_signature</code> is a <code>personal_sign</code>{' '}over the
            desk&apos;s consent text for this intent and wallet. The desk recovers the signer, so nobody can
            compile a job into a wallet they do not hold.
          </li>
          <li>A dollar cap on each agent-signed intent.</li>
          <li>
            A desk-wide switch. While it is off, new intents are refused by name; <code>broker_status</code>{' '}
            and <code>broker_close</code> still work.
          </li>
          <li>
            Completion is <em>advancement, not proof</em>. The runner checks the chain, so a leg result the
            chain disagrees with fails the job one leg later.
          </li>
        </ul>
        <p>
          The desk serves the leg your agent signs. Every other reply carries no transaction material:
          the desk checks each one before it leaves. The legs are written by deterministic guarded
          builders, never by a model. Read the <Link href="/docs/trust">trust model</Link> for how a build
          is guarded, priced and capped before anyone signs.
        </p>

        <h2>What it costs</h2>
        <p>
          The desk is free to call. Pantessa earns its fee on the volume that gets signed, not on calls.{' '}
          <code>broker_capabilities</code> reports the current pricing, so an agent can check before it
          calls anything.
        </p>

        <h2>Reference: desk tools</h2>
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>broker_capabilities</code>
              </td>
              <td>Start here: what the desk can build, both lanes, pricing.</td>
            </tr>
            <tr>
              <td>
                <code>broker_open</code>
              </td>
              <td>Quote one sentence; optional wallet scan, callback, provenance.</td>
            </tr>
            <tr>
              <td>
                <code>broker_choose</code>
              </td>
              <td>Pick an offered option; the desk quotes again.</td>
            </tr>
            <tr>
              <td>
                <code>broker_handoff</code>
              </td>
              <td>Mint the durable sign link for a person.</td>
            </tr>
            <tr>
              <td>
                <code>broker_send</code>
              </td>
              <td>Deliver the ask to a wallet&apos;s or @handle&apos;s inbox.</td>
            </tr>
            <tr>
              <td>
                <code>broker_tile</code>
              </td>
              <td>Mint a portfolio shape (2 to 8 slices summing to 100%) as a sign link.</td>
            </tr>
            <tr>
              <td>
                <code>broker_status</code>
              </td>
              <td>The funnel for a sign link. States only move forward.</td>
            </tr>
            <tr>
              <td>
                <code>broker_execute</code>
              </td>
              <td>Compile the ask into a job owned by the agent&apos;s wallet.</td>
            </tr>
            <tr>
              <td>
                <code>broker_next</code>
              </td>
              <td>The leg the runner is offering, with its guarded artifact.</td>
            </tr>
            <tr>
              <td>
                <code>broker_done</code>
              </td>
              <td>Report a signed leg; get the next one.</td>
            </tr>
            <tr>
              <td>
                <code>broker_close</code>
              </td>
              <td>Walk away before a signature; revokes the link and cancels the job.</td>
            </tr>
          </tbody>
        </table>

        <h2>Reference: webhooks and provenance</h2>
        <ul>
          <li>
            <strong>Webhook</strong>: with <code>callback_url</code>, signed and settled events POST to your
            URL. <code>X-Pantessa-Signature</code> is an HMAC-SHA256 of the body under a secret returned once,
            at open.
          </li>
          <li>
            <strong>Provenance</strong>: <code>broker_open</code> and <code>broker_send</code> take an
            optional <code>origin</code>, where the idea came from. For example{' '}
            <code>{'{ feed: "other", surface: "my screener", ref: "row 42", market: "ETH perp" }'}</code>{' '}
            shows on the sign link as <em>Born from my screener · row 42 · ETH perp</em>. It is your own
            claim: printable text, each field at most 120 characters, hashes and calldata refused. It never
            routes, prices or authorizes anything. <code>broker_capabilities</code> lists the accepted{' '}
            <code>feed</code> values.
          </li>
        </ul>
        <DocsCallout kind="note">
          <p>
            The hands and the desk share the same safety model. The hands only ever hands back a sentence in
            a link; the desk also serves signable legs, but only on the agent-signed path, to the identity
            that opened the intent.
          </p>
        </DocsCallout>
      </div>

      <DocsNext
        links={[
          { href: '/docs/jobs', title: 'Jobs API', desc: 'The same jobs over plain REST.' },
          { href: '/docs/trust', title: 'Trust', desc: 'How a build is guarded and priced before anyone signs.' },
          { href: '/docs/embed', title: 'Embed the chat', desc: 'Put the Pantessa chat on your own site.' },
        ]}
      />
    </>
  )
}
