import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsCrumbs, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'snapshot')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function SnapshotDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <DocsCrumbs slug="snapshot" />
      <h1 className="docs__h1">Snapshot voting</h1>
      <p className="docs__lead">
        Browse live Snapshot proposals and vote on them from the chat. Your wallet signs the vote as a
        gasless message, and voting in the chat is free.
      </p>

      <DocsSummary>
        <li>Ask in the chat for a DAO&apos;s live proposals, then say how you want to vote.</li>
        <li>Your connected wallet signs the vote (EIP-712). No gas, no transaction.</li>
        <li>Voting in the chat costs nothing: Snapshot reads are free and a vote is a signature.</li>
        <li>Pantessa builds the message and relays it. It never holds your key.</li>
        <li>For agent developers, a separate Snapshot MCP endpoint is pay-per-call.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Vote from the chat</h2>
        <DocsSteps>
          <DocsStep title="Ask for proposals">
            <p>
              In the <SpineLink href="/chat">chat</SpineLink>, ask &ldquo;what proposals are live in
              aave.eth?&rdquo;. The answer comes from the live{' '}
              <a href="https://hub.snapshot.org" target="_blank" rel="noopener noreferrer">
                Snapshot hub
              </a>
              .
            </p>
          </DocsStep>
          <DocsStep title="Say your vote">
            <p>
              &ldquo;Vote For&rdquo;, &ldquo;vote against&rdquo; or &ldquo;option 2&rdquo;. The chat finds
              the proposal and builds the vote. If you did not name a choice, it asks which way.
            </p>
          </DocsStep>
          <DocsStep title="Sign">
            <p>
              Your wallet opens with the Snapshot vote message. Sign it, and Pantessa relays the signed
              vote to Snapshot and shows the result. Connect the wallet that holds the voting power: the sign
              button refuses when the connected address is not the voter in the message.
            </p>
          </DocsStep>
        </DocsSteps>

        <h2>Why you sign</h2>
        <p>
          Snapshot counts a vote by the signer&apos;s voting power, so only your own wallet&apos;s signature
          makes it count. Pantessa builds the message and relays the signed result. It never holds your key.
        </p>
        <p>
          Each proposal type encodes its choice differently: a number for single-choice and basic, a list
          for approval and ranked-choice, a weight map for weighted and quadratic. Pantessa reads the
          proposal&apos;s own type and choices, so &ldquo;For&rdquo; or &ldquo;option 2&rdquo; becomes the
          right value.
        </p>

        <h2>For agent developers</h2>
        <p>
          <Link href="/servers/yeetful-snapshot">Pantessa · Snapshot</Link> is a paid MCP server your own
          agent can call at <code>https://snapshot.yeetful.com/mcp</code>: no API key, pay-per-call in USDC
          on Base over x402. That price is for agents calling it directly. A vote in the chat never charges
          you.
        </p>
        <ul>
          <li>
            Read: <code>list_proposals</code>, <code>get_proposal</code>, <code>list_votes</code>,{' '}
            <code>get_space</code>, <code>list_spaces</code>.
          </li>
          <li>
            <code>prepare_vote</code> builds the EIP-712 vote for the voter to sign.
          </li>
          <li>
            <code>submit_vote</code> relays a signed vote to Snapshot.
          </li>
        </ul>
        <pre>
          <code>{`POST https://snapshot.yeetful.com/mcp      // 402 → pay → 200
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "prepare_vote",
    "arguments": {
      "proposal": "0x…",            // from list_proposals
      "from": "0xYourVoterWallet",  // the signer
      "choiceText": "For"           // or a number, "option 2", "A, C"
    }
  }
}
// → { action: "sign_vote", typedData: { …EIP-712… }, summary, submit }
// The voter's wallet signs typedData, then call submit_vote.`}</code>
        </pre>
        <p>
          Prices and the full tool list are on the <Link href="/servers/yeetful-snapshot">server page</Link>.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/trust', desc: 'What Pantessa builds, and why you can sign it.' },
          { href: '/docs/desk', desc: 'Connect an agent to Pantessa over MCP.' },
        ]}
      />
    </>
  )
}
