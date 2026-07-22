import type { Metadata } from 'next'
import Link from 'next/link'
import Footer from '@/components/Footer'
import ActivityOverview from '@/components/ActivityOverview'
import IntentLinksBoard from '@/components/IntentLinksBoard'
import SignInFlowLink from '@/components/SignInFlowLink'
import LiveRoutingFeed from '@/components/LiveRoutingFeed'
import { LinksDaily } from '@/components/LazyCharts'
import { linksBoard, feeSummary, linkDailySeries } from '@/lib/links-board'

// Public system overview — the whole money story on one page: every dollar
// the system moved (swaps, lending, staking, cross-chain, votes + x402
// fees) broken down by venue and MCP, the intent-links board, and the fee
// split (creators' half vs Yeetful's). Server shell owns the SEO surface
// and the link-economy section; the overview polls /api/activity/overview
// (aggregates + artifact labels only — the privacy filtering happens
// server-side, never in the client).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Network activity — money moved · Yeetful',
  description:
    'The Yeetful system, live: notional USD moved through signed transactions across every venue — swaps, lending, staking, cross-chain — plus the intent-links board and the fees the link economy pays creators.',
  openGraph: {
    title: 'Yeetful network activity',
    description:
      'Money moved through the whole system, live — per-venue flow, the intent-links board, and where the fees go.',
    type: 'website',
  },
}

const fmtUsd = (n: number) =>
  n >= 1000
    ? `$${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toFixed(2)}`

/** The link economy — the board + where the fees go. Fee figures are the
 *  ledgered estimate (the claims-rail formula, FEES_LIVE_SINCE-windowed);
 *  the on-chain treasury stays the source of truth for collections. */
async function LinkEconomy() {
  const [board, fees, daily] = await Promise.all([linksBoard(5), feeSummary(), linkDailySeries(30)])
  if (board.byClaims.length === 0 && !fees) return null
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
        <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
          The link economy
        </h2>
        <Link
          href="/links"
          className="mono text-[11px] text-[color:var(--accent)] hover:underline underline-offset-2"
        >
          Full board →
        </Link>
      </div>

      {fees && fees.feeBearingUsd > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3">
            <p className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Fee-bearing conversions
            </p>
            <p className="mono text-[20px] tabular-nums text-[color:var(--fg)] mt-1">
              {fmtUsd(fees.feeBearingUsd)}
            </p>
            <p className="mono text-[10.5px] text-[color:var(--muted-2)] tabular-nums">
              {fees.conversions} signed swaps
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3">
            <p className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Fees to creators
            </p>
            <p className="mono text-[20px] tabular-nums text-[color:var(--accent)] mt-1">
              {fmtUsd(fees.creatorUsd)}
            </p>
            <p className="mono text-[10.5px] text-[color:var(--muted-2)]">
              half the fee on link conversions
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3">
            <p className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Fees to Yeetful
            </p>
            <p className="mono text-[20px] tabular-nums text-[color:var(--fg)] mt-1">
              {fmtUsd(fees.yeetfulUsd)}
            </p>
            <p className="mono text-[10.5px] text-[color:var(--muted-2)]">
              ledgered estimate · on-chain treasury is truth
            </p>
          </div>
        </div>
      )}

      {daily.length > 0 && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3 mb-5">
          <p className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
            The link economy, daily — minted · conversions · $ moved (30d)
          </p>
          <LinksDaily daily={daily} />
        </div>
      )}

      {board.byClaims.length > 0 && <IntentLinksBoard board={board} />}
      <p className="mono text-[11px] text-[color:var(--muted-2)] mt-3">
        Dollars are guardrail-priced signed notional — the same source as the figures above. Every
        row is a live link.{' '}
        <SignInFlowLink href="/dashboard/links" className="text-[color:var(--accent)] hover:underline underline-offset-2">
          Mint yours
        </SignInFlowLink>
        .
      </p>
    </section>
  )
}

export default async function ActivityPage() {
  return (
    <>
      <main className="x-main x-main--fluid">
        {/* The header rides INSIDE the overview's hero row — title left, the
            money-moved figure right, one accent glow spanning both. */}
        {/* The link economy leads the page — slotted right under the hero,
            before the overview's own sections. */}
        <ActivityOverview
          header={
            <header className="hero" style={{ paddingBottom: 0 }}>
              <p className="hero__eyebrow">NETWORK ACTIVITY</p>
              <h1 className="hero__h1 hero__h1--sm">
                The system, <em className="hero__em">moving money.</em>
              </h1>
              <p className="hero__sub">
                Every surface reports here — intent links, chat, every embedded agent, the guardian,
                and the x402 payment rail. Watch what gets built, what gets signed, and where the
                money goes.
              </p>
            </header>
          }
          lead={<LinkEconomy />}
        />
        <LiveRoutingFeed />
      </main>
      <Footer />
    </>
  )
}
