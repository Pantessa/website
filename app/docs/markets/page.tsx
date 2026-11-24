import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsCallout, DocsCrumbs, DocsFacts, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import {
  ALERT_MODES,
  CHART_ATTRIBUTION,
  CHIP_CONTRACT,
  FEED_NOTE,
  REGIONAL_NOTE,
  TAPE_FOOTNOTE,
  TV_IMPORT,
  UNLIMITED_LINE,
} from '@/lib/markets-copy'
import { CREATOR_FEE_SPLIT, HL_BUILDER_FEE_TENTH_BPS, LINK_FEE_PCT, SWAP_FEE_PCT, feePctLabel } from '@/lib/fees'
import { SITE_CARD } from '@/lib/og-defaults'
import { MARKETS_HREF, MARKET_TABS } from '@/lib/markets'

// Markets, said for a trader (squad docs-clean, 2026-11-24). Look free, press
// a price or a chip, sign. Every fee comes from lib/fees, every tab from
// MARKET_TABS, every alert word from the form's own (ALERT_MODES). The
// SpineLink on MARKETS_HREF is pinned (scripts/front-door-pins.ts).

const PAGE = DOCS_PAGES.find((p) => p.slug === 'markets')!

/** Hyperliquid's builder fee, in the venue's tenths of a basis point, as a percent. */
const PERP_FEE_PCT = feePctLabel(HL_BUILDER_FEE_TENTH_BPS / 10)
const CREATOR_SHARE = CREATOR_FEE_SPLIT === 0.5 ? 'half' : `${Math.round(CREATOR_FEE_SPLIT * 100)}%`
const TABS = MARKET_TABS.map((t) => t.label).join(' · ')

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function MarketsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <DocsCrumbs slug="markets" />
      <h1 className="docs__h1">Markets: every chart is a trade</h1>
      <p className="docs__lead">
        Watch stocks, crypto and perps live, for free. Press a price or a chip and your own wallet signs the trade.
      </p>

      <DocsSummary>
        <li>Charts are public. No wallet and no account to look.</li>
        <li>Tokenized stocks trade 24/7 on Robinhood Chain, beside crypto spot and Hyperliquid perps.</li>
        <li>A chip builds the trade. The sign card shows venue, amounts, chain and fee before you sign.</li>
        <li>
          A swap pays <span className="mono">{SWAP_FEE_PCT}</span>. A perp order pays a{' '}
          <span className="mono">{PERP_FEE_PCT}</span> Hyperliquid builder fee.
        </li>
        <li>{UNLIMITED_LINE}.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Open a chart</h2>
        <p>
          <SpineLink href={MARKETS_HREF}>Markets</SpineLink> lists every market we chart. Open one, like{' '}
          <SpineLink href="/t/AAPL">/t/AAPL</SpineLink>, and you get the live chart. Signed in, the same list is at{' '}
          <SpineLink href="/markets">/markets</SpineLink>.
        </p>
        <p>
          Each market has the same tabs: <strong>{TABS}</strong>. The order ticket sits beside the chart on every tab.
          An index, like the VIX, is a chart to read only: it has no Trade tab.
        </p>

        <h2>Make a trade</h2>
        <DocsSteps>
          <DocsStep title="Press a price or a chip">
            <p>A chip is a sentence, like &ldquo;Buy $10 of AAPL&rdquo;. Pressing it is the ask.</p>
          </DocsStep>
          <DocsStep title="Connect a wallet if asked">
            <p>
              No wallet connected? The door opens and your ask waits. No wallet app?{' '}
              <Link href="/docs/embedded-wallet">Sign in with Google or email</Link>.
            </p>
          </DocsStep>
          <DocsStep title="Read the sign card">
            <p>Pantessa builds the trade and shows it: venue, amounts, chain, fee.</p>
          </DocsStep>
          <DocsStep title="Sign, or decline">
            <p>Your signature is the confirmation. Nothing moves without it.</p>
          </DocsStep>
        </DocsSteps>
        <p>
          <strong>{CHIP_CONTRACT}</strong> In the app a chip sends its ask when you press it. A link from a page or a
          post only fills in the ask and waits for you.
        </p>

        <h2>What a chip can do</h2>
        <ul>
          <li>
            <strong>Buy and sell.</strong> Stocks, crypto spot, and long or short on Hyperliquid perps.
          </li>
          <li>
            <strong>Protect.</strong> &ldquo;Protect my HYPE long with a 5% stop&rdquo; arms a{' '}
            <Link href="/docs/guardian">Guardian</Link>, checked every minute.
          </li>
          <li>
            <strong>Draw a level.</strong> A line on a crypto chart can become a limit order (CoW) or a stop. On a stock
            a level offers a market buy or sell: Robinhood Chain has no resting order book.
          </li>
          <li>
            <strong>Act on a verdict.</strong> The Technicals tab computes its gauges from the same candles you see, and
            each verdict carries a chip. Every number there is <em>{TAPE_FOOTNOTE}</em>.
          </li>
        </ul>

        <h2>Watchlists</h2>
        <p>
          Lists, tickers and sections are unlimited, public or private. Connect a wallet and the list fills with what the
          wallet holds, with your position beside each price. A guest&rsquo;s list lives in the browser and is kept when you
          sign in. A public list has its own page and anyone can copy it.
        </p>
        <h3>{TV_IMPORT.cta}</h3>
        <p>
          {TV_IMPORT.sub} Paste TradingView&rsquo;s plain export (<span className="mono">EXCHANGE:SYMBOL</span>, with{' '}
          <span className="mono">###Section</span> headers). A symbol we cannot chart stays on the list, marked{' '}
          <em>{TV_IMPORT.notTradable}</em>.
        </p>

        <h2>Alerts</h2>
        <p>Set an alert from a watchlist row&rsquo;s menu: a price drops to, rises to, or moves by a percent. Then pick:</p>
        <DocsFacts
          rows={[
            [<strong key="n">{ALERT_MODES.notify}</strong>, 'A ping on the alerts bell the minute it fires, and by email if you add one.'],
            [<strong key="c">{ALERT_MODES.chip}</strong>, 'The ping comes with a chip to act on it. You send it and your wallet signs.'],
            [
              <strong key="a">{ALERT_MODES.auto}</strong>,
              'Instead of an alert, arm a Guardian stop or a CoW limit order now. You sign once; it watches the price for you.',
            ],
          ]}
        />
        <p>Fired and armed alerts live behind the bell at the top of the page. Alerts belong to an account, so they need a sign-in.</p>

        <h2>See who called it</h2>
        <p>
          Type an X handle on a chart and every call that account made on the market is pinned to the day it was posted,
          judged by what the price did next. See <Link href="/docs/called-it">Called it</Link>.
        </p>

        <h2>Reference</h2>
        <h3>Fees</h3>
        <ul>
          <li>Looking is free.</li>
          <li>
            A swap from the chart pays Pantessa <span className="mono">{SWAP_FEE_PCT}</span>, shown on the sign card.
          </li>
          <li>
            A Hyperliquid perp order pays a builder fee of <span className="mono">{PERP_FEE_PCT}</span>, taken from the fill
            by Hyperliquid. You approve it once.
          </li>
          <li>
            A swap that came through someone&rsquo;s shared link pays <span className="mono">{LINK_FEE_PCT}</span>, and{' '}
            {CREATOR_SHARE}{' '}of it goes to the link&rsquo;s creator. Perp orders do not pay creators.
          </li>
        </ul>
        <p>
          See <Link href="/pricing">pricing</Link>.
        </p>

        <h3>Feeds</h3>
        <p>{FEED_NOTE}</p>

        <h3>Liquidity and regions</h3>
        <p>
          The chart is the tape. The sign card quotes the pool you will actually trade against. When they disagree, the
          card is the truth and you can decline it.
        </p>
        <DocsCallout kind="warn" title="Stocks are regional">
          {REGIONAL_NOTE}
        </DocsCallout>

        <h3>Chart engine</h3>
        <p>
          The main chart is TradingView&rsquo;s Advanced Charts; its foot reads &ldquo;{CHART_ATTRIBUTION.text}&rdquo;. The{' '}
          <strong>Classic chart</strong>{' '}button switches to the built-in chart, made with TradingView&rsquo;s Lightweight
          Charts; its foot reads &ldquo;{CHART_ATTRIBUTION.classic}&rdquo;. Both link to{' '}
          <a href={CHART_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer">
            tradingview.com
          </a>
          . The prices, verdicts and orders are Pantessa&rsquo;s. See <Link href="/compare">the comparison</Link>.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/called-it', desc: 'An X account’s calls on the chart, judged by the price.' },
          { href: '/docs/embedded-wallet', desc: 'A wallet, Google or email. Looking needs none.' },
          { href: '/docs/guardian', desc: 'Stops that watch a position for you.' },
        ]}
      />
    </>
  )
}
