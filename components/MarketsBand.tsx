import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import SpineLink from '@/components/SpineLink'
import { candleSvg } from '@/lib/markets-seo'
import {
  CHIP_CONTRACT,
  COMPARE_BAND,
  KILLER_LINE,
  PANTESSA_PRICING_ROW,
  SIX_LINES,
  TAPE_FOOTNOTE,
  TV_PRICING_AS_OF_LABEL,
  TV_PRICING_TABLE,
  UNLIMITED_LINE,
  sessionLine,
} from '@/lib/markets-copy'
import type { Candle } from '@/lib/charts'

// THE COMPARE BAND (mk2 LANDING, 2026-09-15 — was the Markets band). Their
// meters, our answer: every line a charting subscription caps, shown as
// their top-tier cap struck through under our ∞; the still of the symbol
// page with a chip pressed and the sign card it produced (the thing no
// meter buys); the six things they cannot sell; the killer line derived
// from lib/fees. Server component, zero JS.
//
// The competitor is NAMED in body copy only (README §8: "TradingView may
// be NAMED on /compare and in copy, never in a lockup") — never in a
// heading, never as a mark (rule 7). The dated table lives on /compare.

/** Sixty deterministic daily candles — a seeded walk, so SSR and the client
 *  paint the same bars (Math.random here would hydrate-mismatch). */
function stillSeries(): Candle[] {
  let seed = 20260911
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const out: Candle[] = []
  let price = 214
  for (let i = 0; i < 60; i++) {
    const drift = (rnd() - 0.46) * 4.2
    const o = price
    const c = Math.max(150, o + drift)
    const h = Math.max(o, c) + rnd() * 2.4
    const l = Math.min(o, c) - rnd() * 2.4
    out.push({ t: 1_750_000_000 + i * 86400, o, h, l, c, v: 1000 + rnd() * 900 })
    price = c
  }
  return out
}

const SERIES = stillSeries()
const LAST = SERIES[SERIES.length - 1].c
const FIRST = SERIES[Math.max(0, SERIES.length - 2)].c
const CHG = ((LAST - FIRST) / FIRST) * 100
const TABS = ['Overview', 'News', 'Community', 'Technicals', 'Trade']
const WATCH = [
  { s: 'AAPL', p: LAST.toFixed(2), c: CHG },
  { s: 'TSLA', p: '341.60', c: 2.14 },
  { s: 'NVDA', p: '176.09', c: -0.82 },
  { s: 'ETH', p: '2,480.15', c: 1.37 },
  { s: 'HYPE', p: '46.02', c: 4.91 },
]

/** Their top tier's cap per meter (the dated table on /compare) vs ours. */
const TOP = TV_PRICING_TABLE[TV_PRICING_TABLE.length - 1]
const METERS: { k: string; theirs: string; ours: string }[] = [
  { k: 'Charts per tab', theirs: TOP.chartsPerTab, ours: PANTESSA_PRICING_ROW.chartsPerTab },
  { k: 'Indicators', theirs: TOP.indicators, ours: PANTESSA_PRICING_ROW.indicators },
  { k: 'Historical bars', theirs: TOP.bars, ours: PANTESSA_PRICING_ROW.bars },
  { k: 'Price alerts', theirs: TOP.priceAlerts, ours: PANTESSA_PRICING_ROW.priceAlerts },
  { k: 'Watchlist alerts', theirs: TOP.watchlistAlerts, ours: PANTESSA_PRICING_ROW.watchlistAlerts },
  { k: 'Per month', theirs: `€${TOP.eurPerMonth}`, ours: '€0' },
]

export default function MarketsBand() {
  const chart = candleSvg(SERIES, { width: 720, height: 220, up: 'var(--accent)', down: 'var(--sell)', grid: 'var(--line)', count: 60 })
  const session = sessionLine('stock', { exchangeOpen: false })
  return (
    <section className="mkt" id="markets" data-markets-band data-compare-band>
      <div className="mkt__head">
        <span className="lcmp__eyebrow mono">{COMPARE_BAND.eyebrow}</span>
        <h2 className="lcmp__h2">{COMPARE_BAND.h2}</h2>
        <p className="lcmp__sub">{COMPARE_BAND.sub}</p>
      </div>

      {/* their top-tier cap, struck, under our ∞ — every meter */}
      <div className="lcmp__meters" data-compare-meters>
        {METERS.map((m) => (
          <div key={m.k} className="lcmp__m">
            <span className="lcmp__mk mono">{m.k}</span>
            <span className="lcmp__mtheirs mono">
              their top tier: <s>{m.theirs}</s>
            </span>
            <span className="lcmp__mours">{m.ours}</span>
          </div>
        ))}
      </div>
      <p className="lcmp__asof mono">
        {UNLIMITED_LINE} · their figures as of {TV_PRICING_AS_OF_LABEL} · {KILLER_LINE.sentence}
      </p>

      {/* the still: /t/AAPL with the Buy chip pressed — the thing no meter buys */}
      <div className="mkt__still" aria-label="The AAPL symbol page with a Buy chip pressed and the sign card it produced">
        <div className="mkt__page">
          <div className="mkt__bar">
            <div className="mkt__id">
              <span className="mkt__mark mono">AAPL</span>
              <div>
                <div className="mkt__pair">AAPL / USD</div>
                <div className="mkt__src mono">Apple · {session}</div>
              </div>
            </div>
            <div className="mkt__quote">
              <span className="mkt__last mono">${LAST.toFixed(2)}</span>
              <span className={`mkt__chg mono${CHG >= 0 ? ' is-up' : ' is-down'}`}>
                {CHG >= 0 ? '▲' : '▼'} {Math.abs(CHG).toFixed(2)}% 24h
              </span>
            </div>
            <div className="mkt__chips">
              <span className="mkt__chip is-pressed">Buy $10 of AAPL</span>
              <span className="mkt__chip">Sell $50 of AAPL</span>
            </div>
          </div>
          <div className="mkt__tabs mono">
            {TABS.map((t, i) => (
              <span key={t} className={i === 0 ? 'is-active' : undefined}>
                {t}
              </span>
            ))}
          </div>
          <div className="mkt__body">
            <div className="mkt__chart" dangerouslySetInnerHTML={{ __html: chart }} />
            <aside className="mkt__rail">
              <div className="mkt__railhead mono">WATCHLIST · ∞</div>
              {WATCH.map((w) => (
                <div key={w.s} className="mkt__row">
                  <span className="mkt__rowsym mono">{w.s}</span>
                  <span className="mkt__rowpx mono">{w.p}</span>
                  <span className={`mkt__rowchg mono${w.c >= 0 ? ' is-up' : ' is-down'}`}>
                    {w.c >= 0 ? '+' : ''}
                    {w.c.toFixed(2)}%
                  </span>
                </div>
              ))}
              <div className="mkt__railfoot mono">+ add a ticker · no limit</div>
            </aside>
          </div>
          {/* the card the pressed chip produced */}
          <div className="mkt__card">
            <div className="mkt__cardhead">
              <span className="mkt__cardkind mono">SIGN &amp; SEND</span>
              <span className="mkt__cardask">Buy $10 of AAPL</span>
            </div>
            <div className="mkt__cardrows mono">
              <span>
                10.00 USDG → <b>0.0429 AAPL</b>
              </span>
              <span>Uniswap v3 · Robinhood Chain</span>
              <span>guard-checked · your wallet signs</span>
            </div>
            <span className="mkt__cardbtn">Sign</span>
          </div>
        </div>
        <p className="mkt__caption mono">
          {CHIP_CONTRACT} <span>·</span> {TAPE_FOOTNOTE}
        </p>
      </div>

      {/* the six things they cannot sell */}
      <ol className="mkt__six">
        {SIX_LINES.map((l, i) => (
          <li key={l.title} className="mkt__line">
            <span className="mkt__num mono">{String(i + 1).padStart(2, '0')}</span>
            <strong>{l.title}</strong>
            <p>{l.body}</p>
          </li>
        ))}
      </ol>

      <div className="mkt__ctas">
        <SpineLink className="btn btn--solid" href="/markets">
          Open Markets
        </SpineLink>
        <SpineLink className="btn btn--ghost" href="/t/AAPL">
          See the AAPL chart
        </SpineLink>
        <Link href="/compare" className="mkt__more">
          {COMPARE_BAND.cta} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  )
}
