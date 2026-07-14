import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import ActivityOverview from '@/components/ActivityOverview'
import LiveRoutingFeed from '@/components/LiveRoutingFeed'

// Public system overview — every dollar the system moved (swaps, lending,
// staking, cross-chain, votes + x402 fees), broken down by venue and MCP.
// Server shell owns the SEO surface; the overview polls
// /api/activity/overview (aggregates + artifact labels only — the privacy
// filtering happens server-side, never in the client).

export const metadata: Metadata = {
  title: 'Network activity — money moved · Yeetful',
  description:
    'The Yeetful system, live: notional USD moved through signed transactions across every venue — swaps, lending, staking, cross-chain — plus settled x402 call fees, broken down by MCP.',
  openGraph: {
    title: 'Yeetful network activity',
    description:
      'Money moved through the whole system, live — per-venue flow, built → signed conversion, and the x402 payment rail.',
    type: 'website',
  },
}

export default function ActivityPage() {
  return (
    <>
      <main className="x-main x-main--fluid">
        {/* The header rides INSIDE the overview's hero row — title left, the
            money-moved figure right, one accent glow spanning both. */}
        <ActivityOverview
          header={
            <header className="hero" style={{ paddingBottom: 0 }}>
              <p className="hero__eyebrow">NETWORK ACTIVITY</p>
              <h1 className="hero__h1 hero__h1--sm">
                The system, <em className="hero__em">moving money.</em>
              </h1>
              <p className="hero__sub">
                Every surface reports here — chat, every embedded agent, the guardian, and the x402
                payment rail. Watch what gets built, what gets signed, and where the money goes.
              </p>
            </header>
          }
        />
        <LiveRoutingFeed />
      </main>
      <Footer />
    </>
  )
}
