import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import {
  ALERT_MODES,
  CHART_ATTRIBUTION,
  CHIP_CONTRACT,
  FEED_NOTE,
  KILLER_LINE,
  REGIONAL_NOTE,
  TAPE_FOOTNOTE,
  TV_IMPORT,
  UNLIMITED_LINE,
} from '@/lib/markets-copy'
import { SWAP_FEE_PCT } from '@/lib/fees'

// Markets — what the chart can do, said for a user. Every ask on this page is
// a prefill (?prompt= never auto-sends — the #493 doctrine); in the app the
// same asks ride chips that SEND (the chip-send contract). The page names the
// feeds, the fee, the region gate and the chart engine's attribution — the
// things a reader would otherwise have to guess.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'markets')!

/** Prefill deep link into /chat — the ask arrives in the composer, unsent. */
const ask = (prompt: string, mcps?: string) => `/chat?${mcps ? `mcps=${mcps}&` : ''}prompt=${encodeURIComponent(prompt)}`

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function MarketsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> MARKETS
      </p>
      <h1 className="docs__h1">Markets: the chart that executes</h1>
      <p className="docs__lead">
        <Link href="/markets">Markets</Link> is a chart surface where the chart is the order form. Open{' '}
        <Link href="/t/AAPL">/t/AAPL</Link> and you get the live tape; press a chip and Pantessa builds the guarded
        transaction behind it — your own wallet signs, or declines. Tokenized stocks trade 24/7 on Robinhood Chain
        next to crypto spot and Hyperliquid perps, in one wallet. <strong>{UNLIMITED_LINE}.</strong>
      </p>

      <div className="docs__prose">
        <h2>What a chart can do</h2>
        <p>
          Every symbol page carries the same strip: <strong>Overview · News · Community · Technicals · Trade</strong>.
          Each tab ends in an ask. The Trade tab is the order panel; the others earn their place by producing one.
        </p>
        <ul>
          <li>
            <strong>Buy, sell, DCA.</strong>{' '}
            <Link href={ask('Buy $10 of AAPL', 'robinhood-free')}>Buy $10 of AAPL</Link> ·{' '}
            <Link href={ask('Sell $50 of ETH')}>Sell $50 of ETH</Link> ·{' '}
            <Link href={ask('DCA $10 into AAPL weekly', 'robinhood-free')}>DCA $10 into AAPL weekly</Link>. A stock buy
            on an empty wallet turns into a funding path first (card or bank → ETH → the chain that trades it) and
            picks up where it left off when the money lands.
          </li>
          <li>
            <strong>Protect.</strong> <Link href={ask('Protect my HYPE long with a 5% stop')}>Protect my HYPE long with a 5% stop</Link>{' '}
            arms a <Link href="/docs/guardian">Guardian</Link>: a delegated key that can only reduce that position,
            checked every minute, receipted when it fires.
          </li>
          <li>
            <strong>Verdicts you can act on.</strong> The Technicals tab computes its gauges, oscillators, moving
            averages and pivots from the same candles you are looking at, and each verdict carries a chip. Every
            number wears the footnote <em>{TAPE_FOOTNOTE}</em> — it is arithmetic on a tape, not a recommendation.
          </li>
          <li>
            <strong>The line is the order.</strong> Draw a level on the chart and it can become a limit order (CoW) or
            a stop (Guardian); a ladder becomes a schedule. Post the annotated chart and a reader can sign it.
          </li>
          <li>
            <strong>Say it.</strong> The composer has a microphone:{' '}
            <Link href={ask('Show me the AAPL chart')}>&ldquo;show me the AAPL chart&rdquo;</Link> opens the overlay
            without burning a turn; &ldquo;buy ten dollars&rdquo; builds the order.
          </li>
        </ul>

        <h2>The chip contract</h2>
        <p>
          <strong>{CHIP_CONTRACT}</strong> Inside the app a chip sends its ask the moment you press it — the
          signature is the only gate, so there is nothing to confirm twice. From a page, a link or a URL the ask{' '}
          <em>prefills</em> the composer and waits for you: a URL never fires a turn. Either way the sentence goes
          through the same native parser as a typed ask, and the sign card shows exactly what was built — venue,
          amounts, chain, fee — before anything is signed.
        </p>

        <h2>Watchlists</h2>
        <p>
          Unlimited lists, unlimited tickers, sections if you like them, public or private. A guest&rsquo;s list lives
          in the browser and is adopted into the account on sign-in. A public list has a page (
          <span className="mono">/lists/&lt;slug&gt;</span>) and a share card; anyone can fork it. Never a cap — the
          day we meter a watchlist we are a charting subscription with worse charts.
        </p>

        <h2>Alerts that act</h2>
        <p>
          An alert has two buttons: <strong>{ALERT_MODES.notify}</strong> and <strong>{ALERT_MODES.act}</strong>. The
          first pings you. The second is a standing intent — a Guardian, a Spot Guardian or a DCA — signed once and
          then working between your turns, non-custodial, killable from the rail. Price reads are batched per symbol,
          which is why they are free at any volume.
        </p>

        <h2>{TV_IMPORT.cta}</h2>
        <p>
          {TV_IMPORT.sub} The import takes the plain export format —{' '}
          <span className="mono">EXCHANGE:SYMBOL</span> lists separated by commas or newlines, with{' '}
          <span className="mono">###Section</span> headers — so switching is one paste. Symbols we cannot chart yet
          are kept on the list, marked <em>{TV_IMPORT.notTradable}</em>, never silently dropped.
        </p>

        <h2>Feeds, fees, regions</h2>
        <ul>
          <li>
            <strong>Feeds.</strong> {FEED_NOTE}
          </li>
          <li>
            <strong>Fees.</strong> Looking is free. A trade from the chart pays Pantessa {SWAP_FEE_PCT} on-chain, visible
            in the sign card; a trade that arrived through someone&rsquo;s shared link pays the link tier and half of
            it goes to the author. {KILLER_LINE.sentence}
          </li>
          <li>
            <strong>Regions.</strong> {REGIONAL_NOTE}
          </li>
          <li>
            <strong>Liquidity.</strong> The chart is the tape; the sign card quotes the pool you will actually trade
            against. When they disagree, the card is the truth and you can decline it.
          </li>
        </ul>

        <h2>Attribution</h2>
        <p>
          {CHART_ATTRIBUTION.text} —{' '}
          <a href={CHART_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer">
            tradingview.com
          </a>
          , {CHART_ATTRIBUTION.license}. The engine draws the candles; the tape, the verdicts and the orders are ours.
          See <Link href="/compare">the comparison</Link> for what a charting subscription meters and what it cannot sell.
        </p>
      </div>
    </>
  )
}
