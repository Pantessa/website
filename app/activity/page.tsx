import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import ActivityBoard from '@/components/ActivityBoard'

// Public network activity — the spend ledger as proof-of-life. Server shell
// owns the SEO surface; the board polls /api/activity (anonymized by the API,
// never by the client — see the Run 7 privacy rules on that route).

export const metadata: Metadata = {
  title: 'Network activity — agents paying per call · Yeetful',
  description:
    'Live x402 payments across the Yeetful network: settled calls, USDC spend, and payments blocked by spend-grant policy — every receipt anonymized and on-chain verifiable.',
  openGraph: {
    title: 'Yeetful network activity',
    description:
      'Live x402 payments across the Yeetful network — settled calls, spend, and policy blocks, on-chain verifiable.',
    type: 'website',
  },
}

export default function ActivityPage() {
  return (
    <>
      <main className="x-main">
        <header className="hero" style={{ paddingBottom: 28 }}>
          <p className="hero__eyebrow">NETWORK ACTIVITY</p>
          <h1 className="hero__h1 hero__h1--sm">
            Agents paying <em className="hero__em">per call.</em>
          </h1>
          <p className="hero__sub">
            Every x402 payment on the network, anonymized: what settled, what the policy layer
            blocked, and the on-chain receipt for each. This is the expense account doing its job.
          </p>
        </header>
        <ActivityBoard />
      </main>
      <Footer />
    </>
  )
}
