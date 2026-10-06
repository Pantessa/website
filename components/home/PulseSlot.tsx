'use client'

// THE LIVE PULSE's seat on the splash (squad front-door, 2026-10-06). PULSE
// lane owns this file and everything it mounts: the venue's fills read in
// the browser (lib/tape-feed, keyless) and aggregated into a calm band —
// notional per second, the hot market, the largest print, the taker split —
// where every number is the sentence that does the same thing, through
// lib/use-connect-to-act. No tape rows here: that is /live's job, and the
// band is the door to it.
//
// The rules live in lib/pulse (pure, pinned). What this file adds is the
// browser: the socket (opened on the fallback list the moment the band
// mounts, re-aimed on the SAME socket when the venue's universe answers —
// the read measured 2.6–3.6s in the browser, half the time to the first
// fill — and open only while the tab is looked at: lib/pulse
// pulseStreamWanted), the one-second clock, the repaint throttle, and the
// act door — the LiveFeed pattern verbatim: a connected
// wallet runs the sentence in the ask door's sheet (the band keeps running
// behind it); a stranger connects first; the held ask runs when a wallet
// lands. The server renders the whole frame at its final height with
// "connecting" in the status slot, so the first fill changes numbers, never
// layout.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useTradable } from '@/lib/use-tradable'
import { FOLLOW_USD, fmtAxisClock, fmtAxisUsd, fmtPrice, fmtUsd, niceCeil, type TapeFill, type TapeMarket } from '@/lib/tape'
import { connectHlTape, readTapeUniverse, type FeedStatus, type HlTapeHandle } from '@/lib/tape-feed'
import {
  PULSE_FALLBACK_MARKETS,
  PULSE_FLUSH_MS,
  PULSE_KEEP_MS,
  PULSE_LIVE_HREF,
  PULSE_TILE_WINDOW_SEC,
  PULSE_UNIVERSE_TIMEOUT_MS,
  PULSE_VIEW_LINKS,
  PULSE_WAITING,
  PULSE_WHY,
  PULSE_WINDOW_SEC,
  mergePulseFills,
  pulseBars,
  pulseMarketsFrom,
  pulseNoChipWords,
  pulseStatusWords,
  pulseStreamWanted,
  pulseTiles,
  pulseVisibilityStep,
  type PulseTileChip,
  type PulseVisibility,
} from '@/lib/pulse'
import './pulse.css'

/** The bars' share of the plot; the rest is air under the max label. */
const PLOT_TOP = 8

export default function PulseSlot() {
  const tradable = useTradable()
  // The fallback list first; the venue's own pick re-aims the open socket.
  const [markets, setMarkets] = useState<readonly string[]>(PULSE_FALLBACK_MARKETS)
  const [fills, setFills] = useState<TapeFill[]>([])
  // 'connecting' from the server render on: the words the frame wears until
  // the venue answers (the feed sets the same word when it opens).
  const [status, setStatus] = useState<FeedStatus>('connecting')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  // null until mounted: the server and the first client paint agree, and a
  // tab opened in the background never opens the stream before it is seen.
  const [vis, setVis] = useState<PulseVisibility | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const bufRef = useRef<TapeFill[]>([])
  const flushRef = useRef<number | null>(null)
  const handleRef = useRef<HlTapeHandle | null>(null)

  // Visibility: read at mount, then every change (lib/pulse pulseVisibilityStep).
  useEffect(() => {
    const read = () => setVis((prev) => pulseVisibilityStep(prev, document.hidden, Date.now()))
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])

  // The markets: the venue's busiest books, read once; a half that fails or
  // dawdles past the timeout keeps the fallback's half (lib/pulse
  // pulseMarketsFrom). The aim lands on the open socket below.
  useEffect(() => {
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), PULSE_UNIVERSE_TIMEOUT_MS)
    let gone = false
    readTapeUniverse(ac.signal).then(({ main, xyz }) => {
      window.clearTimeout(timer)
      if (gone) return
      setMarkets(pulseMarketsFrom(main, xyz))
    })
    return () => {
      gone = true
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [])

  // The stream: open while the tab is looked at (and for the hold after it
  // hides), closed otherwise. The feed reconnects itself; this effect only
  // opens and closes it, on whatever the aim is at that moment. Batches land
  // in a ref and the band repaints at most every PULSE_FLUSH_MS — the first
  // fill into an empty buffer paints at once.
  const streamOn = vis ? pulseStreamWanted(vis, now) : false
  const marketsRef = useRef(markets)
  marketsRef.current = markets
  useEffect(() => {
    if (!streamOn) return
    const flush = () => {
      flushRef.current = null
      setFills(bufRef.current)
    }
    const handle = connectHlTape(marketsRef.current, {
      onFills: (batch) => {
        const wasEmpty = bufRef.current.length === 0
        bufRef.current = mergePulseFills(bufRef.current, batch, Date.now())
        if (wasEmpty) {
          if (flushRef.current !== null) window.clearTimeout(flushRef.current)
          flush()
        } else if (flushRef.current === null) {
          flushRef.current = window.setTimeout(flush, PULSE_FLUSH_MS)
        }
      },
      onStatus: (s, d) => {
        setStatus(s)
        setDetail(d)
      },
    })
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.close()
      if (flushRef.current !== null) window.clearTimeout(flushRef.current)
      flushRef.current = null
    }
  }, [streamOn])

  // The aim follows the pick on the open socket — subscribe what it adds,
  // drop what it leaves (lib/tape subscriptionDelta) — never a reconnect.
  useEffect(() => {
    handleRef.current?.setMarkets(markets)
  }, [markets])

  // The clock the bars and tiles read: once a second. The buffer is pruned on
  // the same beat, so a quiet market's window still empties — and a tab that
  // comes back after a long hide shows the gap, never a stale minute.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      const buf = bufRef.current
      if (buf.length && buf[buf.length - 1].at < t - PULSE_KEEP_MS) {
        bufRef.current = mergePulseFills(buf, [], t)
        setFills(bufRef.current)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // The act door — the LiveFeed pattern: the ask runs in the ask door's sheet
  // with the apps its sentence needs; a stranger meets the connect-only door.
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })

  const chipOk = useCallback((ask: string) => canTradeAsk(ask, tradable), [tradable])
  const bars = useMemo(() => pulseBars(fills, now), [fills, now])
  const tiles = useMemo(() => pulseTiles(fills, now, chipOk), [fills, now, chipOk])
  const have = fills.length > 0
  const max = useMemo(() => niceCeil(Math.max(0, ...bars.map((b) => b.total))), [bars])
  const hidden = vis !== null && !vis.visible
  const live = status === 'live'
  const words = pulseStatusWords(status, detail, { markets: markets.length, hidden })
  // The phone's head has ~110px for the status: the venue and the state, no count.
  const shortWords = pulseStatusWords(status, detail, { hidden })
  const hb = hover !== null ? bars[hover] : null

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * bars.length)
    setHover(i >= 0 && i < bars.length ? i : null)
  }

  return (
    <section className="pulse-seat" aria-label="Live pulse">
      <div className="pulse" data-status={status} data-hidden={hidden || undefined} data-fills={have ? 'yes' : 'no'} data-markets={markets.length}>
        <header className="pulse__head">
          <span className={`mk-dot ${live ? 'mk-dot--open' : 'mk-dot--closed'} pulse__dot`} aria-hidden />
          <span className="pulse__title">Live pulse</span>
          <span className="pulse__status mono" role="status">
            <span className="pulse__venue">Hyperliquid · </span>
            <span className="pulse__status-long">{words}</span>
            <span className="pulse__status-short">{shortWords}</span>
          </span>
          <nav className="pulse__views mono" aria-label="Live views">
            {PULSE_VIEW_LINKS.map((v) => (
              <Link key={v.id} href={v.href} className="pulse__view" prefetch={false}>
                {v.label}
              </Link>
            ))}
          </nav>
          <Link href={PULSE_LIVE_HREF} className="pulse__door" prefetch={false}>
            <span className="pulse__door-long">Open the live tape</span>
            <span className="pulse__door-short">Live tape</span> <span aria-hidden>→</span>
          </Link>
        </header>

        <div className="pulse__body">
          <div className="pulse__chart">
            <div className="pulse__cap mono">
              <span>USD notional per second · {PULSE_WINDOW_SEC}s ago → now</span>
              <span className="pulse__cap-r">
                <i className="pulse__swatch pulse__swatch--up" aria-hidden /> buys <i className="pulse__swatch pulse__swatch--down" aria-hidden /> sells
              </span>
            </div>
            <div className="pulse__plot">
              <svg
                className="pulse__svg"
                viewBox={`0 0 ${bars.length} 100`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`USD notional per second over the last ${PULSE_WINDOW_SEC} seconds, buys and sells`}
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
              >
                {bars.map((b, i) => {
                  if (!b.total) return null
                  const span = 100 - PLOT_TOP
                  const upTop = 100 - (b.up / max) * span
                  const downTop = upTop - (b.down / max) * span
                  return (
                    <g key={b.sec}>
                      {b.up > 0 && <rect x={i + 0.1} y={upTop} width={0.8} height={100 - upTop} className="pulse__bar pulse__bar--up" />}
                      {b.down > 0 && <rect x={i + 0.1} y={downTop} width={0.8} height={upTop - downTop} className="pulse__bar pulse__bar--down" />}
                    </g>
                  )
                })}
                {hover !== null && <rect x={hover} y={0} width={1} height={100} className="pulse__hoverband" />}
              </svg>
              <span className="pulse__ax pulse__ax--max mono">{have ? `${fmtAxisUsd(max)}/s` : ''}</span>
            </div>
            <div className="pulse__split" data-empty={tiles.split.buyPct === null || undefined} aria-hidden>
              <span className="pulse__split-buy" style={{ width: `${tiles.split.buyPct ?? 50}%` }} />
            </div>
            <div className="pulse__splitk mono" aria-live="off">
              {hb ? (
                <span>
                  {fmtAxisClock(hb.sec)} · {fmtUsd(hb.total)} · {hb.count} fills
                </span>
              ) : tiles.split.buyPct === null ? (
                <span>{PULSE_WAITING}</span>
              ) : (
                <span>
                  taker flow · {PULSE_TILE_WINDOW_SEC}s · <b className="pulse__up">{tiles.split.buyPct}% buys</b> / <b className="pulse__down">{100 - tiles.split.buyPct}% sells</b>
                </span>
              )}
            </div>
          </div>

          <div className="pulse__tiles">
            <Tile
              k={<>Hot market<span className="pulse__tk-win"> · {PULSE_TILE_WINDOW_SEC}s</span></>}
              v={tiles.hot ? <MarketName m={tiles.hot.market} /> : <span className="pulse__dim">—</span>}
              sub={tiles.hot ? `${fmtUsd(tiles.hot.usd)} traded · ${tiles.hot.buyPct}% buys` : PULSE_WAITING}
              chip={tiles.hot?.chip ?? null}
              noChip={tiles.hot && !tiles.hot.chip ? pulseNoChipWords(tiles.hot.market, tiles.hot.side) : null}
              onAct={act}
            />
            <Tile
              k={<><span className="pulse__tk-long">Largest print</span><span className="pulse__tk-short">Largest</span><span className="pulse__tk-win"> · {PULSE_TILE_WINDOW_SEC}s</span></>}
              v={tiles.largest ? fmtUsd(tiles.largest.fill.usd) : <span className="pulse__dim">—</span>}
              sub={tiles.largest ? `${tiles.largest.market.ticker} · ${tiles.largest.fill.side === 'buy' ? 'bought' : 'sold'} at ${fmtPrice(tiles.largest.fill.price)}` : PULSE_WAITING}
              chip={tiles.largest?.chip ?? null}
              noChip={tiles.largest && !tiles.largest.chip ? pulseNoChipWords(tiles.largest.market, tiles.largest.fill.side) : null}
              onAct={act}
            />
            <Tile k="Trades / s" v={have ? tiles.tradesPerSec : <span className="pulse__dim">—</span>} sub={have ? `${fmtUsd(tiles.notionalPerMin)} / min` : PULSE_WAITING} mod="rate" />
          </div>
        </div>

        <footer className="pulse__foot mono">
          <span className="pulse__why-long">
            {PULSE_WHY.what} {PULSE_WHY.why}
          </span>
          <span className="pulse__why-phone">{PULSE_WHY.phone}</span>
        </footer>
        {door}
      </div>
    </section>
  )
}

/** `xyz:` in small caps before a dex ticker, the /live idiom. */
function MarketName({ m }: { m: TapeMarket }) {
  return (
    <>
      {m.dex && <span className="pulse__dex mono">{m.dex}</span>}
      {m.ticker}
    </>
  )
}

function Tile({ k, v, sub, chip, noChip, onAct, mod }: { k: ReactNode; v: ReactNode; sub: string; chip?: PulseTileChip | null; noChip?: string | null; onAct?: (ask: string) => void; mod?: string }) {
  return (
    <div className={`pulse__tile${mod ? ` pulse__tile--${mod}` : ''}`}>
      <div className="pulse__tk">{k}</div>
      <div className="pulse__tv">{v}</div>
      <div className="pulse__ts mono">{sub}</div>
      {chip && onAct ? (
        <button type="button" className={`pulse__chip pulse__chip--${chip.tone}`} onClick={() => onAct(chip.ask)} title={chip.ask}>
          {chip.label} <span className="pulse__chip-usd">${FOLLOW_USD}</span>
        </button>
      ) : noChip ? (
        <span className="pulse__noact mono">{noChip}</span>
      ) : null}
    </div>
  )
}
