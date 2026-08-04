import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'snapshot')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function SnapshotDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> SNAPSHOT DAO VOTING
      </p>
      <h1 className="docs__h1">Snapshot DAO voting</h1>
      <p className="docs__lead">
        <Link href="/servers/yeetful-snapshot">Yeetful · Snapshot</Link>{' '}is a paid MCP
        service that puts DAO governance in the chat: <strong>browse</strong> live proposals,
        then <strong>cast a vote your own wallet signs</strong>. The vote is an off-chain
        EIP-712 message — Pantessa builds it, <em>you</em>{' '}sign it, because Snapshot voting
        power is bound to your address. Pay-per-call in USDC on Base, no API key.
      </p>

      <div className="docs__prose">
        <h2>Browse proposals</h2>
        <p>
          Add <strong>Yeetful · Snapshot</strong>{' '}to your active agents and ask in plain
          language — &quot;what DAO proposals are live right now?&quot; or &quot;show active
          proposals in aave.eth.&quot; The chat calls the service&apos;s <code>list_proposals</code>{' '}
          tool and answers from the live{' '}
          <a href="https://hub.snapshot.org" target="_blank" rel="noopener noreferrer">
            Snapshot hub
          </a>
          . You can drill into one with <code>get_proposal</code>, see who voted with{' '}
          <code>list_votes</code>, or look up a space with <code>get_space</code>.
        </p>

        <h2>Cast a vote</h2>
        <p>
          Say how you want to vote — &quot;vote For on aave.eth&quot;, &quot;cast my vote against
          proposal 0x…&quot;, or &quot;vote option 2.&quot; The chat resolves the proposal, then
          calls <code>prepare_vote</code> to build the canonical Snapshot{' '}
          <strong>EIP-712 typed data</strong>. That comes back as a{' '}
          <strong>Sign &amp; cast vote</strong> button under the message.
        </p>
        <p>
          Click it and your connected wallet signs the message — the same one-tap signature you
          use anywhere else, no gas, no transaction. Pantessa relays the signed vote to Snapshot
          and shows you a receipt linking to the proposal. Connect the wallet that holds the
          voting power: the button refuses to sign if the connected address doesn&apos;t match the
          voter baked into the message.
        </p>

        <h2>The part that&apos;s easy to get wrong</h2>
        <p>
          A Snapshot vote&apos;s <code>choice</code> is encoded differently per proposal type —
          a single number for <em>single-choice</em> and <em>basic</em> proposals, a list for{' '}
          <em>approval</em> and <em>ranked-choice</em>, and a weight map for <em>weighted</em> and{' '}
          <em>quadratic</em>. The service reads the proposal&apos;s own type and choices and
          builds the right shape, so &quot;For&quot; / &quot;yes&quot; / &quot;option 2&quot;
          resolve to the correct 1-indexed value without you counting options.
        </p>

        <h2>Why you sign, not us</h2>
        <p>
          Snapshot tallies votes by the signer&apos;s on-chain voting power, so a vote is only
          meaningful when <em>your</em> wallet signs it. Pantessa never holds your key and never
          signs on your behalf — it only <strong>constructs</strong> the message and{' '}
          <strong>relays</strong>{' '}the result. Your signature is the authorization; the relay
          carries no extra trust. It&apos;s the same principle as everything else here: Pantessa
          is the control plane, not the custodian.
        </p>

        <h2>For agents: the MCP endpoint</h2>
        <p>
          The same capability is a plain x402-paid MCP service your own agents can call at{' '}
          <code>https://snapshot.yeetful.com/mcp</code> — no API key, pay-per-call in USDC on
          Base. Seven tools:
        </p>
        <ul>
          <li>
            <code>list_proposals</code>, <code>get_proposal</code>, <code>list_votes</code>,{' '}
            <code>get_space</code>, <code>list_spaces</code> — read DAO governance data.
          </li>
          <li>
            <code>prepare_vote</code> — build the EIP-712 vote for the voter to sign.
          </li>
          <li>
            <code>submit_vote</code> — relay a signed vote to the Snapshot sequencer.
          </li>
        </ul>
        <pre>
          <code>{`POST https://snapshot.yeetful.com/mcp        // 402 → pay → 200
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "prepare_vote",
    "arguments": {
      "proposal": "0x…",            // proposal id (from list_proposals)
      "from": "0xYourVoterWallet",  // the signer
      "choiceText": "For"           // or a number / "option 2" / "A, C"
    }
  }
}
// → { action: "sign_vote", typedData: { …EIP-712… }, summary, submit }
// Sign typedData with the voter's wallet, then call submit_vote.`}</code>
        </pre>
        <p>
          Browse the full tool surface and pricing on the{' '}
          <Link href="/servers/yeetful-snapshot">service page</Link>, or give your agent a budget
          for it the same way you would any other connected app.
        </p>
      </div>
    </>
  )
}
