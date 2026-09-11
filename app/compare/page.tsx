import type { Metadata } from 'next'
import Link from 'next/link'
import Footer from '@/components/Footer'
import { SITE } from '@/lib/docs'
import {
  HONEST_RISKS,
  KILLER_LINE,
  PANTESSA_PRICING_ROW,
  REGIONAL_NOTE,
  SIX_LINES,
  TAPE_FOOTNOTE,
  THEY_HAVE,
  TV_IMPORT,
  TV_PRICING_AS_OF_LABEL,
  TV_PRICING_TABLE,
  UNLIMITED_LINE,
} from '@/lib/markets-copy'
import { SWAP_FEE_PCT } from '@/lib/fees'

/** /compare — their meters vs ours, said plainly. TradingView is NAMED here
 * (comparative, factual, their public pricing page on a stated date) and
 * nowhere else on the site; never a logo, never a trademark set larger than
 * body copy (rule 7). Credibility comes from the second half: what they
 * have that we don't, and the risks we say out loud. Zero JS. */

const TITLE = 'Every line on a charting subscription’s pricing page. Free.'
const DESCRIPTION = `TradingView meters looking — charts per tab, indicators, bars, alerts, watchlists. Pantessa meters nothing you look at: unlimited watchlists and alerts, every timeframe, no ads, €0. We earn ${SWAP_FEE_PCT} when a chart becomes a trade. Their table verbatim, our column, and what they have that we don’t.`

export const metadata: Metadata = {
  title: `${TITLE} — Pantessa Markets`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/compare` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE}/compare`, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: TITLE,
  description: DESCRIPTION,
  url: `${SITE}/compare`,
  isPartOf: { '@type': 'WebSite', name: 'Pantessa', url: SITE },
})

const eur = (n: number) => (n === 0 ? '€0' : `€${n.toFixed(2)}`)

export default function ComparePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <main className="x-main">
        <section className="cmp">
          <p className="cmp__eyebrow mono">
            Markets <span>·</span> a comparison <span>·</span> as of {TV_PRICING_AS_OF_LABEL}
          </p>
          <h1 className="cmp__h1">{TITLE}</h1>
          <p className="cmp__lede">
            A charting subscription sells the view: every tier on TradingView&rsquo;s pricing page is a cap on
            looking. Pantessa sells the trade — we earn {SWAP_FEE_PCT} when a chart becomes a signed
            transaction — so everything they meter is free here, at every tier, structurally.{' '}
            <strong>{UNLIMITED_LINE}.</strong>
          </p>

          {/* ── their table, verbatim, with our row ── */}
          <h2 className="cmp__h2 mono">Their pricing page, verbatim · annual billing, EUR · {TV_PRICING_AS_OF_LABEL}</h2>
          <div className="cmp__tablewrap">
            <table className="cmp__table" data-pricing-as-of="2026-09-11">
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">€ / month</th>
                  <th scope="col">Charts per tab</th>
                  <th scope="col">Indicators per chart</th>
                  <th scope="col">Historical bars</th>
                  <th scope="col">Price alerts</th>
                  <th scope="col">Watchlist alerts</th>
                </tr>
              </thead>
              <tbody>
                {TV_PRICING_TABLE.map((r) => (
                  <tr key={r.tier}>
                    <th scope="row">
                      <span className="cmp__vendor mono">TradingView</span> {r.tier}
                    </th>
                    <td className="mono">{eur(r.eurPerMonth)}</td>
                    <td className="mono">{r.chartsPerTab}</td>
                    <td className="mono">{r.indicators}</td>
                    <td className="mono">{r.bars}</td>
                    <td className="mono">{r.priceAlerts}</td>
                    <td className="mono">{r.watchlistAlerts}</td>
                  </tr>
                ))}
                <tr className="cmp__ours">
                  <th scope="row">
                    <span className="cmp__vendor mono">Pantessa</span> every tier
                  </th>
                  <td className="mono">{eur(PANTESSA_PRICING_ROW.eurPerMonth)}</td>
                  <td className="mono">{PANTESSA_PRICING_ROW.chartsPerTab}</td>
                  <td className="mono">{PANTESSA_PRICING_ROW.indicators}</td>
                  <td className="mono">{PANTESSA_PRICING_ROW.bars}</td>
                  <td className="mono">{PANTESSA_PRICING_ROW.priceAlerts}</td>
                  <td className="mono">{PANTESSA_PRICING_ROW.watchlistAlerts}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="cmp__note mono">
            Source: tradingview.com/pricing, read {TV_PRICING_AS_OF_LABEL}, annual plans in EUR. Their numbers are
            theirs and may change; ours are ∞ by construction — the day we meter a watchlist we are a charting
            subscription with worse charts. &ldquo;Indicators&rdquo; on our side means every gauge, oscillator,
            moving average and pivot we compute, on every chart, at once.
          </p>

          {/* ── the six things they cannot sell ── */}
          <h2 className="cmp__h2 mono">What they cannot sell at any price</h2>
          <ol className="cmp__six">
            {SIX_LINES.map((l, i) => (
              <li key={l.title} className="cmp__line">
                <span className="cmp__num mono">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{l.title}</strong>
                  <p>{l.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* ── the killer line ── */}
          <blockquote className="cmp__killer" data-killer-line>
            <p className="cmp__killer-h">{KILLER_LINE.sentence}</p>
            <p className="cmp__killer-sub">
              Our organic fee is {KILLER_LINE.feePct}{' '}per trade, on-chain, zero when you&rsquo;re idle. A trader who
              does a year of Ultimate&rsquo;s price in volume — {KILLER_LINE.ultimatePerYear} — pays us{' '}
              {KILLER_LINE.smallTraderFee}. Looking is free forever; the second thing you do is one tap.
            </p>
          </blockquote>

          {/* ── the honest half ── */}
          <h2 className="cmp__h2 mono">What they have that we don&rsquo;t</h2>
          <p className="cmp__lede cmp__lede--tight">
            Saying this is the point. TradingView is fifteen years of charting for every market on earth; we are
            one chart surface where the chart is the order form. If you need any of these today, they are better.
          </p>
          <ul className="cmp__they" data-honest-section>
            {THEY_HAVE.map((t) => (
              <li key={t.title}>
                <strong>{t.title}</strong> <span>{t.body}</span>
              </li>
            ))}
          </ul>

          <h2 className="cmp__h2 mono">Risks, said out loud</h2>
          <ul className="cmp__they cmp__they--risks">
            {HONEST_RISKS.map((t) => (
              <li key={t.title}>
                <strong>{t.title}</strong> <span>{t.body}</span>
              </li>
            ))}
          </ul>

          {/* ── the doors ── */}
          <div className="cmp__ctas">
            <Link className="btn btn--solid" href="/markets">
              Open Markets
            </Link>
            <Link className="btn btn--ghost" href="/t/AAPL">
              See the AAPL chart
            </Link>
            <Link className="btn btn--ghost" href="/markets?import=1">
              {TV_IMPORT.cta}
            </Link>
          </div>
          <p className="cmp__foot mono">
            {TAPE_FOOTNOTE} <span>·</span> {REGIONAL_NOTE} <span>·</span>{' '}
            <Link href="/docs/markets">How the chart executes</Link>
          </p>
        </section>
      </main>
      <Footer />
    </>
  )
}
