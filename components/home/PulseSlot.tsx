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
import { FOLLOW_USD, fmtAxisClock, fmtAxisUsd, fmtPrice, fmtUsd, niceCeil, tapeMarket, type TapeFill, type TapeMarket, type TapeSource } from '@/lib/tape'
import { connectTape, readTapeUniverse, type FeedStatus, type TapeHandle } from '@/lib/tape-feed'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'
import { resolveMarket } from '@/lib/battle'
import { MAX_OWN_MARKETS, OWN_SOURCE_NOTE, addLiveMarkets, chipRow, knownMarkets, openingOwnMarkets, readLiveMarketMemory, removeLiveMarket, watchlistMarkets, writeLiveMarketMemory, type OwnSource } from '@/lib/live-markets'
import {
  PULSE_FALLBACK_MARKETS,
  PULSE_FLUSH_MS,
  PULSE_KEEP_MS,
  PULSE_PICK_KEY,
  PULSE_PICK_RE,
  PULSE_TILE_WINDOW_SEC,
  PULSE_UNIVERSE_TIMEOUT_MS,
  PULSE_VENUES,
  PULSE_VENUE_WORD,
  PULSE_VIEW_LINKS,
  PULSE_WAITING,
  PULSE_WHY_BY_SOURCE,
  PULSE_WINDOW_SEC,
  mergePulseFills,
  pulseBars,
  pulseLiveHref,
  pulsePick,
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

export interface PulseSlotProps {
  /** Where the band sits: its own framed band (the default — the pins' SSR
   *  frame, head and foot included) or THE DECK's stage (components/home/Deck,
   *  2026-10-13): the deck draws the head and the foot, the band keeps its
   *  chips, the chart and the tiles. */
  seat?: 'band' | 'stage'
  /** The feed's state, for the deck's bar and foot. */
  onReport?: (r: { status: FeedStatus; detail?: string; source: TapeSource; markets: number; hidden: boolean }) => void
  /** The merged buffer after every flush (newest first) — the deck's ladder lands the prints. */
  onFills?: (buffer: readonly TapeFill[]) => void
  /** The market the band would put under a book: the pick, else the hot market. */
  onBookMarket?: (market: string | null) => void
  /** The picked chip, for the deck's doors (/live's `?m=`). */
  onPick?: (pick: string | null) => void
}

export default function PulseSlot({ seat = 'band', onReport, onFills, onBookMarket, onPick }: PulseSlotProps = {}) {
  const tradable = useTradable()
  // The fallback list first; the venue's own pick re-aims the open socket.
  const [markets, setMarkets] = useState<readonly string[]>(PULSE_FALLBACK_MARKETS)
  const [fills, setFills] = useState<TapeFill[]>([])
  // 'connecting' from the server render on: the words the frame wears until
  // the venue answers (the feed sets the same word when it opens).
  const [status, setStatus] = useState<FeedStatus>('connecting')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  // Which transport the band is reading: Dune through the relay, or the
  // venue's keyless socket when the relay says `unconfigured` (connectTape).
  const [source, setSource] = useState<TapeSource>('dune')
  const [now, setNow] = useState(() => Date.now())
  // null until mounted: the server and the first client paint agree, and a
  // tab opened in the background never opens the stream before it is seen.
  const [vis, setVis] = useState<PulseVisibility | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // The token the band reads (lib/pulse pulsePick): null = every book. The
  // remembered pick is read after mount so the server and first paint agree.
  const [pickRaw, setPickRaw] = useState<string | null>(null)
  useEffect(() => {
    // A phone hides the chip row (the 160px budget), so it never wears a
    // remembered pick it could not see or clear.
    if (!window.matchMedia('(min-width: 641px)').matches) return
    try {
      const m = window.localStorage.getItem(PULSE_PICK_KEY)
      if (m && PULSE_PICK_RE.test(m)) setPickRaw(m)
    } catch {}
  }, [])
  const choose = useCallback((m: string | null) => {
    setPickRaw(m)
    setHover(null)
    try {
      if (m) window.localStorage.setItem(PULSE_PICK_KEY, m)
      else window.localStorage.removeItem(PULSE_PICK_KEY)
    } catch {}
  }, [])
  const bufRef = useRef<TapeFill[]>([])
  const flushRef = useRef<number | null>(null)
  const handleRef = useRef<TapeHandle | null>(null)
  // The deck's ears, read through refs so the stream effect never re-arms.
  const onReportRef = useRef(onReport)
  onReportRef.current = onReport
  const onFillsRef = useRef(onFills)
  onFillsRef.current = onFills
  const onBookMarketRef = useRef(onBookMarket)
  onBookMarketRef.current = onBookMarket
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  // Your own markets (lib/live-markets — /live's rule, on the band): a
  // hand's list leads the row and rides the relay's filter; remembered in
  // this browser; the watchlist stands in until a hand touches it.
  const [own, setOwn] = useState<string[]>([])
  const [ownSource, setOwnSource] = useState<OwnSource>(null)
  const [universe, setUniverse] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [addNote, setAddNote] = useState<string | null>(null)
  const handRef = useRef(false)
  const wl = useWatchlists({ holdings: false })
  const watchSymbols = useMemo(() => {
    if (!wl.ready) return [] as string[]
    const activeId = (wl.active as { id?: string } | null)?.id
    const ordered = [...wl.lists].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0))
    const out: string[] = []
    for (const l of ordered) for (const sym of l.symbols) if (!out.includes(sym)) out.push(sym)
    return out
  }, [wl.ready, wl.lists, wl.active])
  useEffect(() => {
    const mem = readLiveMarketMemory()
    if (mem) {
      setOwn(mem.own)
      setOwnSource('memory')
    }
  }, [])
  useEffect(() => {
    if (handRef.current || ownSource === 'memory' || !universe.length) return
    const d = openingOwnMarkets({ memory: null, watch: watchlistMarkets(watchSymbols, universe) })
    if (d.source === 'watchlist') {
      setOwn(d.own)
      setOwnSource('watchlist')
    }
  }, [watchSymbols, universe, ownSource])
  const addOwn = useCallback(
    (raw: string) => {
      const r = addLiveMarkets(raw, knownMarkets(universe, new Set(bufRef.current.map((f) => f.market))), own)
      if (r.added.length) {
        handRef.current = true
        const next = [...own, ...r.added]
        setOwn(next)
        setOwnSource('memory')
        writeLiveMarketMemory(next)
        setDraft('')
      }
      setAddNote(r.unknown.length ? `no venue prints ${r.unknown.map((u) => u.toUpperCase()).join(', ')} yet` : r.full.length ? `the row holds ${MAX_OWN_MARKETS} of yours` : null)
    },
    [own, universe],
  )
  const removeOwn = useCallback(
    (m: string) => {
      handRef.current = true
      const next = removeLiveMarket(own, m)
      setOwn(next)
      setOwnSource('memory')
      writeLiveMarketMemory(next)
    },
    [own],
  )
  // The aim: your own markets first, then the venue's pick.
  const aim = useMemo(() => [...new Set([...own, ...markets])], [own, markets])

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
      setUniverse([...main, ...xyz].filter((r) => !r.delisted).sort((a, b) => b.volumeUsd - a.volumeUsd).map((r) => r.name))
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
  const marketsRef = useRef(aim)
  marketsRef.current = aim
  useEffect(() => {
    if (!streamOn) return
    const flush = () => {
      flushRef.current = null
      setFills(bufRef.current)
      onFillsRef.current?.(bufRef.current)
    }
    const handle = connectTape(marketsRef.current, {
      onSource: setSource,
      onRetract: (venue, block) => {
        bufRef.current = bufRef.current.filter((f) => !(f.venue === venue && f.block === block))
      },
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
    }, { venues: PULSE_VENUES, filter: true })
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.close()
      if (flushRef.current !== null) window.clearTimeout(flushRef.current)
      flushRef.current = null
    }
  }, [streamOn])

  // The aim follows the pick on the open stream — the relay's filter, or on
  // the venue's socket subscribe what it adds and drop what it leaves
  // (lib/tape subscriptionDelta) — never a quiet second.
  useEffect(() => {
    handleRef.current?.setMarkets(aim)
  }, [aim])

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
        onFillsRef.current?.(bufRef.current)
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
  const pick = pulsePick(pickRaw, aim)
  const bars = useMemo(() => pulseBars(fills, now, undefined, pick), [fills, now, pick])
  const tiles = useMemo(() => pulseTiles(fills, now, chipOk, pick), [fills, now, chipOk, pick])
  const have = pick ? fills.some((f) => f.market === pick) : fills.length > 0
  const max = useMemo(() => niceCeil(Math.max(0, ...bars.map((b) => b.total))), [bars])
  const hidden = vis !== null && !vis.visible
  const live = status === 'live'
  const words = pulseStatusWords(status, detail, { markets: aim.length, hidden })
  // The phone's head has ~110px for the status: the venue and the state, no count.
  const shortWords = pulseStatusWords(status, detail, { hidden })
  const hb = hover !== null ? bars[hover] : null

  // The deck hears the band (components/home/Deck): the feed's state for its
  // bar and foot, the pick for its doors, the market its ladder follows.
  useEffect(() => {
    onReportRef.current?.({ status, detail, source, markets: aim.length, hidden })
  }, [status, detail, source, aim.length, hidden])
  useEffect(() => {
    onPickRef.current?.(pick)
  }, [pick])
  const hotName = tiles.hot?.market.name ?? null
  useEffect(() => {
    onBookMarketRef.current?.(pick ?? hotName)
  }, [pick, hotName])

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * bars.length)
    setHover(i >= 0 && i < bars.length ? i : null)
  }

  return (
    <section className="pulse-seat" aria-label="Live pulse">
      <div className="pulse" data-seat={seat} data-status={status} data-source={source} data-hidden={hidden || undefined} data-fills={have ? 'yes' : 'no'} data-markets={aim.length}>
        {seat === 'band' && (
        <header className="pulse__head">
          <span className={`mk-dot ${live ? 'mk-dot--open' : 'mk-dot--closed'} pulse__dot`} aria-hidden />
          <span className="pulse__title">Live pulse</span>
          <span className="pulse__status mono" role="status">
            <span className="pulse__venue">{PULSE_VENUE_WORD[source]} · </span>
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
          <Link href={pulseLiveHref(pick)} className="pulse__door" prefetch={false} data-journey="Open the live tape">
            <span className="pulse__door-long">Open the live tape</span>
            <span className="pulse__door-short">Live tape</span> <span aria-hidden>→</span>
          </Link>
        </header>
        )}

        <div className="pulse__markets" role="group" aria-label="Markets on the pulse">
          <button type="button" className={`pulse__m${pick === null ? ' is-on' : ''}`} aria-pressed={pick === null} onClick={() => choose(null)}>
            All <span className="mono pulse__mcount">{aim.length}</span>
          </button>
          <form
            className="pulse__add"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) addOwn(draft)
            }}
          >
            <input
              id="pulse-add"
              list="pulse-universe"
              value={draft}
              onChange={(e) => {
                const v = e.target.value
                setDraft(v)
                const picked = (e.nativeEvent as InputEvent).inputType === 'insertReplacementText'
                if (picked && resolveMarket(v, universe)) addOwn(v)
              }}
              placeholder={own.length >= MAX_OWN_MARKETS ? 'row is full' : '+ your own'}
              aria-label="Add your own markets, several with commas"
              autoComplete="off"
              disabled={own.length >= MAX_OWN_MARKETS}
              title={addNote ?? (ownSource === 'watchlist' && own.length ? `${OWN_SOURCE_NOTE.watchlist} · remembered once you touch it` : 'commas add several · remembered in this browser')}
            />
            <datalist id="pulse-universe">
              {universe.slice(0, 400).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {addNote && (
              <span className="pulse__addnote mono" role="status">
                {addNote}
              </span>
            )}
          </form>
          {chipRow(own, markets, null, markets.length).map(({ market: m, own: isOwn }) => {
            const tm = tapeMarket(m)
            const chip = (
              <button type="button" className={`pulse__m${pick === m ? ' is-on' : ''}`} aria-pressed={pick === m} data-kind={tm.kind} data-own={isOwn || undefined} onClick={() => choose(pick === m ? null : m)}>
                <MarketName m={tm} />
              </button>
            )
            return isOwn ? (
              <span key={m} className="pulse__mown">
                {chip}
                <button type="button" className="pulse__mx" onClick={() => removeOwn(m)} aria-label={`Remove ${m} from your markets`} title="Remove">
                  ×
                </button>
              </span>
            ) : (
              <span key={m} className="pulse__mseat">{chip}</span>
            )
          })}
        </div>

        <div className="pulse__body">
          <div className="pulse__chart">
            <div className="pulse__cap mono">
              <span>USD notional per second{pick ? ` · ${tapeMarket(pick).ticker}` : ''} · {PULSE_WINDOW_SEC}s ago → now</span>
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

        {seat === 'band' && (
        <footer className="pulse__foot mono">
          <span className="pulse__why-long">
            {PULSE_WHY_BY_SOURCE[source].what} {PULSE_WHY_BY_SOURCE[source].why}
          </span>
          <span className="pulse__why-phone">{PULSE_WHY_BY_SOURCE[source].phone}</span>
        </footer>
        )}
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
