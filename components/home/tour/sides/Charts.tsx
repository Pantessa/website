'use client'

// THE TOUR · CHARTS — the order form in miniature (squad landing,
// 2026-11-10; lane SIDES-A). The claim is "every chart is the order form",
// so the miniature IS one: three real markets (a tokenized stock, a coin, a
// perp), the picked one's live price and its week of hourly closes, and
// under it the ticket — a side, a size, and the sentence the wallet would
// sign. Change the size and the sentence changes: that is the lesson.
//
// Real in every part:
//   • the price, the 24h change and the line are the symbol page's own
//     hourly candles route, read once a minute and only while this panel is
//     on screen and the tab is in view (./a/useLive); ether's price is on
//     the first frame from THE READ's snapshot, which the page already holds;
//   • the sides are the ones that market's own order ticket offers, and the
//     sentence is composed by the ticket's composer (./a/mini-market over
//     lib/order-ticket) — never by hand;
//   • the button runs it through the tour's one connect-to-act door, and is
//     not offered when the venue gate says the sentence cannot run.

import { useId, useMemo, useState } from 'react'
import LandingLink from '@/components/home/LandingLink'
import { meta } from '@/lib/home-tour/charts'
import { tourJourney } from '@/lib/home-tour'
import { fmtQuotePrice } from '@/lib/markets-quotes'
import { HL_MIN_USD } from '@/lib/order-ticket'
import { fmtReadPct, readChart, readTone } from '@/lib/read'
import { useTour } from '../context'
import { TourPanel } from '../Panel'
import { Seg } from './a/Seg'
import { MINI_DEFAULT_USD, MINI_SIZES, acceptMiniMarket, miniMarketUrl, miniMarkets, miniSideLabel, miniTicket, miniUnits, splitAtAmount, type MiniMarket, type MiniSide } from './a/mini-market'
import { useOnScreen, usePolled } from './a/useLive'
import './a/kit.css'
import './charts.css'

/** The words column without its chips: on this side the ticket is the chip. */
const COPY = { ...meta, asks: [] }
const MARKETS = miniMarkets()
const REFRESH_MS = 60_000
const J = (what: string) => tourJourney(meta.id, what)

export default function ChartsSide() {
  const { read, act, canAct } = useTour()
  const [sym, setSym] = useState(MARKETS[0]?.symbol ?? '')
  const [wantSide, setWantSide] = useState<MiniSide>('buy')
  const [usd, setUsd] = useState(MINI_DEFAULT_USD)
  const [root, active] = useOnScreen<HTMLDivElement>()
  const gradId = useId()
  const panelId = useId()

  // One cached read per market (three markets, fixed order: the hooks never move).
  const a = usePolled(miniMarketUrl(MARKETS[0]?.symbol ?? 'AAPL'), REFRESH_MS, active && MARKETS.length > 0, acceptMiniMarket)
  const b = usePolled(miniMarketUrl(MARKETS[1]?.symbol ?? 'ETH'), REFRESH_MS, active && MARKETS.length > 1, acceptMiniMarket)
  const c = usePolled(miniMarketUrl(MARKETS[2]?.symbol ?? 'HYPE'), REFRESH_MS, active && MARKETS.length > 2, acceptMiniMarket)
  const live = useMemo(() => {
    const out: Record<string, { data: MiniMarket | null; failed: boolean }> = {}
    ;[a, b, c].forEach((r, i) => {
      if (MARKETS[i]) out[MARKETS[i].symbol] = r
    })
    return out
  }, [a, b, c])
  // Ether's price is already on the page (THE READ): the first frame shows it.
  const seedEth = read.quotes.eth
  const lastOf = (s: string): number | null => live[s]?.data?.last ?? (s === 'ETH' ? (seedEth?.last ?? null) : null)
  const chgOf = (s: string): number | null => live[s]?.data?.chg ?? (s === 'ETH' ? (seedEth?.chg ?? null) : null)

  const market = MARKETS.find((m) => m.symbol === sym) ?? MARKETS[0]
  const chart = useMemo(() => readChart(live[sym]?.data?.points ?? [], null), [live, sym])
  if (!market) return <TourPanel side={COPY} />

  const side: MiniSide = market.sides.includes(wantSide) ? wantSide : market.sides[0]
  const last = lastOf(market.symbol)
  const chg = chgOf(market.symbol)
  const tone = readTone(chg)
  const ticket = miniTicket(market.pair, side, usd, last)
  const ask = ticket.ok ? ticket.ask : null
  const parts = ask ? splitAtAmount(ask, usd) : null
  const units = miniUnits(side, usd, last)
  const runnable = ask !== null && canAct(ask)
  const failed = !live[market.symbol]?.data && live[market.symbol]?.failed

  return (
    <TourPanel side={COPY} demoLabel="The order form in miniature">
      <div className="ta tc" ref={root} data-tour-mini="charts" data-sym={market.symbol} data-side={side} data-usd={usd}>
        {/* Three markets, one picked. */}
        <div className="tc__tiles" role="tablist" aria-label="A stock, a coin and a perp">
          {MARKETS.map((m) => {
            const on = m.symbol === market.symbol
            const t = readTone(chgOf(m.symbol))
            return (
              <button key={m.symbol} type="button" role="tab" id={`${panelId}-${m.symbol}`} aria-selected={on} aria-controls={panelId} tabIndex={on ? 0 : -1} className={`tc__tile is-${t}${on ? ' is-on' : ''}`} onClick={() => setSym(m.symbol)} onKeyDown={(e) => onTileKey(e, m.symbol, setSym)} data-mini-tile={m.symbol} data-journey={J(`market ${m.symbol}`)}>
                <span className="tc__tilehead">
                  <span className="tc__sym">{m.symbol}</span>
                  <span className="tc__kind mono">{m.kind}</span>
                </span>
                <span className="tc__tilelast mono">{lastOf(m.symbol) == null ? '—' : `$${fmtQuotePrice(lastOf(m.symbol))}`}</span>
                <span className="tc__tilechg mono">{chgOf(m.symbol) == null ? '—' : fmtReadPct(chgOf(m.symbol) as number)}</span>
              </button>
            )
          })}
        </div>

        {/* The picked market: whose it is, the price, the week. */}
        <div className="tc__market" role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${market.symbol}`}>
          <p className="ta-eyebrow mono">
            {market.kindWords} · {market.venueWords}
          </p>
          <p className="tc__quote">
            <span className="tc__last">{last == null ? '—' : `$${fmtQuotePrice(last)}`}</span>
            {chg != null && (
              <span className={`tc__chg mono is-${tone}`}>
                {fmtReadPct(chg)} <span className="tc__basis">in 24 hours</span>
              </span>
            )}
          </p>
          <div className={`tc__plot is-${tone}`} data-points={live[market.symbol]?.data?.points.length ?? 0}>
            {chart ? (
              <>
                <svg className="tc__svg" viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" aria-label={`${market.symbol}, the past week of hourly closes`}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" className="tc__stop" stopOpacity="0.24" />
                      <stop offset="1" className="tc__stop" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={chart.area} fill={`url(#${gradId})`} />
                  <path d={chart.line} className="tc__path" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="tc__axis tc__axis--max mono">${fmtQuotePrice(chart.max)}</span>
                <span className="tc__axis tc__axis--min mono">${fmtQuotePrice(chart.min)}</span>
                <span className="tc__span mono">Past week, hourly</span>
              </>
            ) : (
              <p className="tc__empty mono">{failed ? 'The chart did not answer. The order form still works.' : 'Reading the week…'}</p>
            )}
          </div>
        </div>

        {/* The ticket: a side, a size, the sentence. */}
        <div className="tc__ticket">
          <div className="tc__controls">
            {market.sides.length > 1 && (
              <div className="ta-field">
                <span className="ta-eyebrow mono">Side</span>
                <Seg label="Side" value={side} onChange={setWantSide} options={market.sides.map((s) => ({ value: s, label: miniSideLabel(s) }))} journey={(s) => J(`side ${s}`)} />
              </div>
            )}
            <div className="ta-field">
              <span className="ta-eyebrow mono">Size</span>
              <Seg label="Size in dollars" value={usd} onChange={setUsd} options={MINI_SIZES.map((n) => ({ value: n, label: `$${n}`, say: `${n} dollars` }))} journey={(n) => J(`size ${n}`)} />
            </div>
          </div>
          <div className="tc__order">
            <p className="ta-eyebrow mono">The sentence your wallet signs</p>
            <p className="tc__sentence" aria-live="polite" data-mini-ask={ask ?? ''}>
              {ask === null ? (
                <span className="tc__problem">{ticket.ok ? '' : ticket.problem}</span>
              ) : parts ? (
                <q>
                  {parts.before}
                  <b className="tc__amt">{parts.amount}</b>
                  {parts.after}
                </q>
              ) : (
                <q>{ask}</q>
              )}
            </p>
            <p className="ta-note tc__est">
              {side === 'long' ? `It opens on Hyperliquid, which takes orders from $${HL_MIN_USD}.` : units ? `About ${units} ${market.symbol} at $${fmtQuotePrice(last)}. The build quotes it exactly.` : 'The build quotes it before you sign.'}
            </p>
          </div>
          <div className="tc__go">
            {runnable && ask ? (
              <button type="button" className="ta-run" onClick={() => act(ask)} title={ask} data-ask={ask} data-journey={J('build the order')}>
                Build this order <span aria-hidden>→</span>
              </button>
            ) : (
              ask && <p className="ta-note">No venue is filling this one right now. The chart is still open.</p>
            )}
            <LandingLink href={`/t/${market.symbol}`} className="ta-door" prefetch={false} data-journey={J(`open ${market.symbol}`)}>
              The full {market.symbol} chart <span aria-hidden>→</span>
            </LandingLink>
          </div>
        </div>
      </div>
    </TourPanel>
  )
}

/** Left and right walk the three tiles (a tablist's own keys). */
function onTileKey(e: React.KeyboardEvent<HTMLButtonElement>, current: string, pick: (s: string) => void): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  const i = MARKETS.findIndex((m) => m.symbol === current)
  const next = MARKETS[(i + (e.key === 'ArrowRight' ? 1 : MARKETS.length - 1)) % MARKETS.length]
  if (!next) return
  e.preventDefault()
  pick(next.symbol)
  e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-mini-tile="${next.symbol}"]`)?.focus()
}
