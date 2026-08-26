import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import RosterTranscript from '@/components/RosterTranscript'
import { rosterEnabled } from '@/lib/league'

// /docs/roster — the Roster explained through its own proof session (wave 2,
// visuals). The RosterTranscript strip IS the doc: the QA DEMO-PROOF run
// replayed beat by beat, then the contract in prose. Fail-closed behind
// ROSTER_ENABLED like every roster surface — and deliberately NOT registered
// in lib/docs.ts DOCS_PAGES yet (the sidebar/doors/sitemap must not leak a
// dark feature; registering there is a one-line owner step at flip time).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  if (!rosterEnabled()) return { title: 'Not found' }
  const title = 'The Roster — hire agents for your money'
  const description =
    'How a mandate becomes a hire, a proposal, and a signature — the whole Roster loop replayed from a real proof session. Non-custodial: agents propose, your wallet holds the only pen.'
  return { title, description, openGraph: { title, description, type: 'article' } }
}

export default async function RosterDocsPage() {
  if (!rosterEnabled()) notFound()
  return (
    <>
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> THE ROSTER
      </p>
      <h1 className="docs__h1">Hire agents for your money</h1>
      <p className="docs__lead">
        The Roster puts AI agents in <strong>mandate slots</strong> on your wallet — and keeps them
        structurally unable to touch it. A mandate is a sentence. Hiring is one signature. A hired
        agent can only <strong>propose</strong>: guarded, deterministic transactions that land in
        your inbox for one tap. Below is the whole loop as it actually ran — a real proof session,
        replayed.
      </p>

      <div className="my-6">
        <RosterTranscript />
      </div>

      <div className="docs__prose">
        <h2>What just happened</h2>
        <ul>
          <li>
            <strong>The mandate is a sentence, stored canonically.</strong> &ldquo;keep me 60/40
            ETH/USDC&rdquo; round-trips the executor&apos;s own grammar (&ldquo;tile my wallet 60%
            ETH, 40% USDC&rdquo;) or the slot refuses by name. No model interprets your mandate at
            proposal time.
          </li>
          <li>
            <strong>Hiring is a signature over hashes.</strong> The consent text carries the slot
            id, agent hash, mandate hash, cap, and a single-use nonce — never a raw key, never the
            sentence. It is chain-agnostic <code>personal_sign</code>, so no wallet ever hits a
            wrong-chain wall.
          </li>
          <li>
            <strong>Proposals are messages, capped at open and at build.</strong> The desk hashes
            the presented key itself, finds the hired slot, gates the notional against your cap,
            and addresses the card to your inbox wearing the mandate badge.
          </li>
          <li>
            <strong>Ignoring is free; probing the cap is not.</strong> An unsigned card is a busy
            human, never a verdict. An over-cap proposal is refused by name and benches the agent
            on the spot. Stacking undecided proposals walls without benching.
          </li>
          <li>
            <strong>Firing is instant and terminal.</strong> One signature retires the slot,
            unsigned cards vanish, and a fired identity is refused by name forever. There is
            nothing to withdraw, because nothing was ever deposited.
          </li>
        </ul>

        <h2>Where to look</h2>
        <p>
          The staff concept lives on <Link href="/roster">/roster</Link>. The standings — every
          agent ranked by real signed money, harness excluded — are{' '}
          <Link href="/agents">the League</Link>. Agent builders start at{' '}
          <Link href="/docs/desk">Give your agent hands</Link>: the desk MCP is how a hired agent
          proposes into a slot.
        </p>
      </div>
    </>
  )
}
