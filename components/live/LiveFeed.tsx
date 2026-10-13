'use client'

// /live — the live tape (2026-10-06): every print is a button.
//
// The layout is Dune's HyperCore "Live feed" (notional per second by taker
// flow · five tiles · the tape), because that is the shape a market reads in
// at a glance. What this page adds is the end of every row: the sentence
// that does what the fill did, through the same connect-to-act door every
// markets chip uses (lib/use-connect-to-act), run in the ask door's sheet so
// the tape keeps running behind the ticket. A trigger (lib/tape
// detectTriggers) is a rule on the stream that ARMS such a sentence; the
// wallet still signs it. Nothing here moves money on its own — the chip-send
// contract: the tap is the send, the signature is the gate.
//
// Feeds: lib/tape-feed. Dune's real-time feeds through our relay by default
// (HyperCore, Lighter, Lighter Robinhood perps + the DEX spot trial; the
// taker's position effect and the block on every row; the venues are
// toggles in the Feeds card); the venue's keyless Hyperliquid socket when
// the relay reports `unconfigured` (no effect, no block — those two columns
// say so instead of guessing). A firehose has no subscription to list, so
// the market chips are the busiest books in the last minute, measured.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { Pause, Play } from 'lucide-react'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import type { TradabilityMap } from '@/lib/tradability'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import GuideSeat from '@/components/guide/GuideSeat'
import {
  DEFAULT_THRESHOLDS,
  FALLBACK_MARKETS,
  FLOW_LABEL,
  FLOW_STACK,
  FOLLOW_USD,
  TRIGGER_LABEL,
  busiestMarkets,
  detectTriggers,
  flowBuckets,
  flowClassOf,
  flowTone,
  fmtAddr,
  fmtAxisClock,
  fmtAxisUsd,
  fmtClock,
  fmtPrice,
  fmtSize,
  fmtUsd,
  followAsk,
  mergeFills,
  niceCeil,
  pickTapeMarkets,
  tapeMarket,
  tapeStats,
  triggerDetail,
  venueTag,
  type FlowBucket,
  type FlowClass,
  type FollowAsk,
  type TapeFill,
  type TapeSource,
  type TriggerEvent,
  type TriggerRule,
  type TriggerThresholds,
} from '@/lib/tape'
import { feedFor, openDuneTape, readTapeUniverse, type FeedHandlers, type FeedStatus } from '@/lib/tape-feed'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'
import { resolveMarket } from '@/lib/battle'
import { MAX_OWN_MARKETS, OWN_SOURCE_NOTE, addLiveMarkets, chipRow, knownMarkets, openingOwnMarkets, readLiveMarketMemory, removeLiveMarket, watchlistMarkets, writeLiveMarketMemory, type OwnSource } from '@/lib/live-markets'
import { DEFAULT_LIVE_VENUES, DUNE_VENUES, type DuneVenueId } from '@/lib/dune'

const RULES: readonly TriggerRule[] = ['big-print', 'whale-repeat', 'flow-skew']
const BIG_PRINT_CHOICES = [10_000, 50_000, 250_000, 1_000_000] as const
const TAPE_ROWS = 80
const EVENT_ROWS = 40
/** The chip row on the firehose: this many of the busiest books. */
const CHIP_MARKETS = 22

export default function LiveFeed({ tradable, tabs }: { tradable: TradabilityMap; tabs?: ReactNode }) {
  // Dune first; the relay's `unconfigured` flips this to the venue's socket
  // and the Feeds card says why.
  const [source, setSource] = useState<TapeSource>('dune')
  const [venues, setVenues] = useState<DuneVenueId[]>([...DEFAULT_LIVE_VENUES])
  const [relayNote, setRelayNote] = useState<string | null>(null)
  const feed = feedFor(source)
  const [markets, setMarkets] = useState<string[] | null>(null)
  const [fills, setFills] = useState<TapeFill[]>([])
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState<string | null>(() => readFilter())
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<TapeFill[] | null>(null)
  const [events, setEvents] = useState<TriggerEvent[]>([])
  const [armed, setArmed] = useState<Set<TriggerRule>>(() => new Set<TriggerRule>(['big-print', 'whale-repeat', 'flow-skew']))
  const [thresholds, setThresholds] = useState<TriggerThresholds>(DEFAULT_THRESHOLDS)
  const seenRef = useRef(new Set<string>())
  const fillsRef = useRef<TapeFill[]>([])
  fillsRef.current = fills
  // Your own markets (lib/live-markets): a hand's list leads the chip row,
  // remembered in this browser; the watchlist stands in until a hand
  // touches it. The venue's list + what the stream printed resolve a name.
  const [own, setOwn] = useState<string[]>([])
  const [ownSource, setOwnSource] = useState<OwnSource>(null)
  const [universe, setUniverse] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [addNote, setAddNote] = useState<{ text: string; tone: 'warn' | 'dim' } | null>(null)
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
  // The watchlist default: only while no memory and no hand (fluid until touched).
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
      const known = knownMarkets(universe, new Set(fillsRef.current.map((f) => f.market)))
      const r = addLiveMarkets(raw, known, own)
      if (r.added.length) {
        handRef.current = true
        const next = [...own, ...r.added]
        setOwn(next)
        setOwnSource('memory')
        writeLiveMarketMemory(next)
        setDraft('')
      }
      if (r.unknown.length) setAddNote({ text: `no venue here prints ${r.unknown.map((u) => u.toUpperCase()).join(', ')} yet`, tone: 'warn' })
      else if (r.full.length) setAddNote({ text: `the row holds ${MAX_OWN_MARKETS} of yours`, tone: 'warn' })
      else setAddNote(null)
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

  // The venue's universe, read once: the venue socket's subscription list
  // (its busiest books; the fallback list if the read fails) and the names
  // a typed market resolves against. `?m=` narrows the view, never the
  // subscription.
  useEffect(() => {
    const ac = new AbortController()
    readTapeUniverse(ac.signal).then(({ main, xyz }) => {
      if (ac.signal.aborted) return
      const picked = pickTapeMarkets(main, xyz)
      setMarkets(picked.length ? picked : [...FALLBACK_MARKETS])
      setUniverse([...main, ...xyz].filter((r) => !r.delisted).sort((a, b) => b.volumeUsd - a.volumeUsd).map((r) => r.name))
    })
    return () => ac.abort()
  }, [])

  // The stream. Reconnects itself; this effect only opens and closes it. A
  // block Dune replaces (op UPDATE) is retracted before its new fills merge.
  useEffect(() => {
    const handlers: FeedHandlers = {
      onFills: (batch) => setFills((prev) => mergeFills(prev, batch, Date.now())),
      onRetract: (venue, block) => setFills((prev) => prev.filter((f) => !(f.venue === venue && f.block === block))),
      onStatus: (s, d) => {
        if (s === 'unconfigured' && source === 'dune') {
          setRelayNote(d ?? 'not configured')
          setSource('hyperliquid')
          return
        }
        setStatus(s)
        setStatusDetail(d)
      },
    }
    if (source === 'dune') return openDuneTape([], handlers, { venues, filter: false }).close
    if (!markets) return
    // The venue's socket subscribes per market: your own ride along.
    return feed.connect([...new Set([...markets, ...own])], handlers)
  }, [feed, source, venues, markets, own])

  // The clock the buckets and tiles read: once a second, and the buffer is
  // pruned on the same beat so a quiet market's tape still ages out.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setFills((prev) => (prev.length && prev[prev.length - 1].at < t - 180_000 ? mergeFills(prev, [], t) : prev))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Triggers run on every batch (cheap: the rules read the last minute).
  useEffect(() => {
    if (fills.length === 0) return
    const fresh = detectTriggers(fills, Date.now(), seenRef.current, thresholds)
    if (fresh.length) setEvents((prev) => [...fresh, ...prev].slice(0, EVENT_ROWS))
  }, [fills, thresholds])

  // Pause freezes what is drawn; the buffer keeps filling behind it.
  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (!p) setFrozen(fillsRef.current)
      else setFrozen(null)
      return !p
    })
  }, [])

  const view = paused && frozen ? frozen : fills
  const buckets = useMemo(() => flowBuckets(view, now, 120, filter), [view, now, filter])
  const stats = useMemo(() => tapeStats(view, now, filter), [view, now, filter])
  const rows = useMemo(() => {
    const out: TapeFill[] = []
    for (const f of view) {
      if (filter && f.market !== filter) continue
      out.push(f)
      if (out.length >= TAPE_ROWS) break
    }
    return out
  }, [view, filter])

  // The act door: a connected wallet runs the sentence in the ask door's
  // sheet (the tape keeps running behind it); a stranger connects first.
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })

  const chipFor = useCallback(
    (fill: Pick<TapeFill, 'market' | 'side'>): FollowAsk | null => {
      const f = followAsk(fill, FOLLOW_USD)
      return f && canTradeAsk(f.ask, tradable) ? f : null
    },
    [tradable],
  )

  const pickFilter = useCallback(
    (m: string | null) => {
      setFilter(m)
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      if (m) url.searchParams.set('m', m)
      else url.searchParams.delete('m')
      window.history.replaceState(window.history.state, '', url.toString())
    },
    [],
  )

  const live = status === 'live'
  // The chips: on the firehose the busiest books of the last minute (re-read
  // every five seconds so the row does not reshuffle on every print), the
  // filter kept in view; on the venue's socket, what it is subscribed to.
  const chipBeat = Math.floor(now / 5_000)
  const frozenRef = useRef<TapeFill[] | null>(null)
  frozenRef.current = paused && frozen ? frozen : null
  // Keyed on the beat alone (the buffer is read through its ref): the row
  // reshuffles every five seconds, never on every print.
  const chips = useMemo(() => {
    if (source !== 'dune') return null
    const buf = frozenRef.current ?? fillsRef.current
    const at = chipBeat * 5_000
    return { busiest: busiestMarkets(buf, at, CHIP_MARKETS), count: new Set(buf.filter((f) => f.at >= at - 60_000).map((f) => f.market)).size }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, chipBeat])
  const busiest = chips?.busiest ?? null
  const marketCount = chips?.count ?? null
  const entries = chipRow(own, busiest ?? markets ?? [...FALLBACK_MARKETS], filter, CHIP_MARKETS)
  const marketList = entries.map((e) => e.market)

  return (
    <>
      <main className="mkt-frame__main live" data-status={status} data-paused={paused || undefined}>
        <h1 className="sr-only">Live feed</h1>

        <div className="mkt-frame__bar live__bar">
          <div className="live__title">
            <span className={`mk-dot ${live ? 'mk-dot--open' : 'mk-dot--closed'} live__pulse`} aria-hidden />
            <span className="live__h">Live feed</span>
            <span className="live__sub mono">
              {feed.label} · {statusWords(status, statusDetail)}
            </span>
          </div>
          {tabs}
          <div className="live__controls">
            <button type="button" className="live__pause" onClick={togglePause} aria-pressed={paused} title={paused ? 'Resume the tape' : 'Pause the tape'}>
              {paused ? <Play size={13} strokeWidth={2.2} /> : <Pause size={13} strokeWidth={2.2} />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
          </div>
        </div>

        <div className="live__markets" role="group" aria-label="Markets on the tape">
          <button type="button" className={`live__m${filter === null ? ' is-on' : ''}`} onClick={() => pickFilter(null)}>
            All
            <span className="mono live__mcount">{marketCount ?? marketList.length}</span>
          </button>
          <form
            className="live__add"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) addOwn(draft)
            }}
          >
            <input
              id="live-add"
              list="live-universe"
              value={draft}
              onChange={(e) => {
                const v = e.target.value
                setDraft(v)
                // A pick from the suggestion list lands at once; typing waits for Add.
                const picked = (e.nativeEvent as InputEvent).inputType === 'insertReplacementText'
                if (picked && resolveMarket(v, universe)) addOwn(v)
              }}
              placeholder={own.length >= MAX_OWN_MARKETS ? 'your row is full' : '+ your own · uni, pepe, nvda'}
              aria-label="Add your own markets, several with commas"
              autoComplete="off"
              disabled={own.length >= MAX_OWN_MARKETS}
            />
            <datalist id="live-universe">
              {universe.slice(0, 400).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button type="submit" className="live__addbtn" disabled={own.length >= MAX_OWN_MARKETS || !draft.trim()}>
              Add
            </button>
            {addNote ? (
              <span className={`live__addnote mono live__addnote--${addNote.tone}`} role="status">
                {addNote.text}
              </span>
            ) : ownSource === 'watchlist' && own.length ? (
              <span className="live__addnote mono live__addnote--dim" title="Remembered in this browser once you add or remove one">{OWN_SOURCE_NOTE.watchlist}</span>
            ) : null}
          </form>
          {entries.map(({ market: m, own: isOwn }) => {
            const tm = tapeMarket(m)
            const chip = (
              <button type="button" className={`live__m${filter === m ? ' is-on' : ''}`} onClick={() => pickFilter(filter === m ? null : m)} data-kind={tm.kind} data-own={isOwn || undefined}>
                {tm.dex && <span className="live__dex mono">{tm.dex}</span>}
                {tm.ticker}
              </button>
            )
            return isOwn ? (
              <span key={m} className="live__mown">
                {chip}
                <button type="button" className="live__mx" onClick={() => removeOwn(m)} aria-label={`Remove ${m} from your markets`} title="Remove">
                  ×
                </button>
              </span>
            ) : (
              <span key={m} className="live__mseat">{chip}</span>
            )
          })}
        </div>

        <GuideSeat surface="live" posture="phone" />
        <section className="live__panel" aria-label="USD notional per second">
          <header className="live__ph">
            <span className="live__pk">USD notional per second, by taker flow{filter ? ` · ${filter}` : ''}</span>
            <span className="live__pv mono">Last 2 min</span>
          </header>
          <FlowChart buckets={buckets} effectAware={feed.fields.effect} />
        </section>

        <div className="live__tiles">
          <Tile k="Trades / s" v={<span className="mono">{stats.tradesPerSec}</span>} />
          <Tile k="Notional / min" v={<span className="mono">{fmtUsd(stats.notionalPerMin)}</span>} />
          <Tile
            k="Largest print · 60s"
            v={stats.largestPrint ? <span className="mono">{fmtUsd(stats.largestPrint.usd)}</span> : <span className="mono live__dim">—</span>}
            sub={stats.largestPrint ? `${stats.largestPrint.market} · ${stats.largestPrint.side === 'buy' ? 'bought' : 'sold'} at ${fmtPrice(stats.largestPrint.price)}` : 'no fill yet'}
            chip={stats.largestPrint ? chipFor(stats.largestPrint) : null}
            onAct={act}
          />
          <Tile
            k="Hot market · 60s"
            v={stats.hotMarket ? <span className="mono">{stats.hotMarket.market}</span> : <span className="mono live__dim">—</span>}
            sub={stats.hotMarket ? `${fmtUsd(stats.hotMarket.usd)} traded` : 'no fill yet'}
            chip={stats.hotMarket ? chipFor(stats.hotMarket) : null}
            onAct={act}
          />
          <Tile
            k="Taker flow · 60s"
            split
            v={
              stats.takerFlow.buyPct === null ? (
                <span className="mono live__dim">—</span>
              ) : (
                <span className="mono">
                  <span className="live__up">{stats.takerFlow.buyPct} buys</span> / <span className="live__down">{100 - stats.takerFlow.buyPct} sells</span>
                </span>
              )
            }
            bar={stats.takerFlow.buyPct}
          />
        </div>

        <section className="live__panel live__tape" aria-label="The tape">
          <table className="live__table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th className="num">Size</th>
                <th className="num">Price</th>
                <th className="num">Notional $</th>
                <th>
                  Effect
                  {!feed.fields.effect && <FieldTag />}
                </th>
                <th>Time</th>
                <th className="live__col-wide">Taker</th>
                <th className="live__col-wide num">
                  Block
                  {!feed.fields.block && <FieldTag />}
                </th>
                <th className="live__col-act">Do the same</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="live__empty mono">
                    {status === 'unconfigured' ? statusWords(status, statusDetail) : paused ? 'paused' : 'listening…'}
                  </td>
                </tr>
              )}
              {rows.map((f) => (
                <TapeRow key={f.id} fill={f} chip={chipFor(f)} onAct={act} showVenue={source === 'dune'} />
              ))}
            </tbody>
          </table>
        </section>
        <p className="live__foot mono">
          Every row is the venue&apos;s own fill: side, size, price, time and the taker it names{source === 'dune' ? ', through Dune\'s real-time feed' : ''}. A chip is the sentence that does the same thing, in this
          chat&apos;s grammar; your wallet signs it. Sizes are ${FOLLOW_USD} on purpose. Nothing on this page fires on its own.
        </p>
      </main>

      <MarketsSide label="Triggers">
        <div data-slot="triggers" className="live__rail">
          <GuideSeat surface="live" posture="desktop" />
          <TriggersPanel armed={armed} setArmed={setArmed} thresholds={thresholds} setThresholds={setThresholds} events={events} onAct={act} chipOk={(f) => canTradeAsk(f.ask, tradable)}>
            <FeedsCard source={source} setSource={setSource} status={status} detail={statusDetail} venues={venues} setVenues={setVenues} relayNote={relayNote} />
          </TriggersPanel>
        </div>
      </MarketsSide>
      {door}
    </>
  )
}

function readFilter(): string | null {
  if (typeof window === 'undefined') return null
  const m = new URLSearchParams(window.location.search).get('m')
  return m && /^[A-Za-z0-9:]{1,24}$/.test(m) ? m : null
}

function statusWords(status: FeedStatus, detail?: string): string {
  switch (status) {
    case 'live':
      return `live${detail ? ` · ${detail}` : ''}`
    case 'connecting':
      return 'connecting'
    case 'reconnecting':
      return `reconnecting${detail ? ` ${detail}` : ''}`
    case 'unconfigured':
      return `not configured${detail ? ` · ${detail}` : ''}`
    case 'closed':
      return `closed${detail ? ` · ${detail}` : ''}`
    default:
      return 'idle'
  }
}

/** The small tag on a column the current feed cannot fill. */
function FieldTag() {
  return (
    <span className="live__fieldtag mono" title="Not in the venue's trade feed — a position-aware chain stream (Dune) carries it.">
      stream
    </span>
  )
}

// ── Tiles ────────────────────────────────────────────────────────────────────

function Tile({ k, v, sub, chip, onAct, bar, split }: { k: string; v: React.ReactNode; sub?: string; chip?: FollowAsk | null; onAct?: (ask: string) => void; bar?: number | null; split?: boolean }) {
  return (
    <div className="live__tile">
      <div className="live__tk">{k}</div>
      <div className={`live__tv${split ? ' live__tv--split' : ''}`}>{v}</div>
      {sub && <div className="live__ts mono">{sub}</div>}
      {bar !== undefined && (
        <div className="live__flowbar" aria-hidden>
          <span className="live__flowbar-buy" style={{ width: `${bar ?? 50}%` }} />
        </div>
      )}
      {chip && onAct && (
        <button type="button" className={`live__chip live__chip--${chip.tone}`} onClick={() => onAct(chip.ask)} title={chip.ask}>
          {chip.label} <span className="live__chip-usd">${FOLLOW_USD}</span>
        </button>
      )}
    </div>
  )
}

// ── The tape ─────────────────────────────────────────────────────────────────

function TapeRow({ fill, chip, onAct, showVenue }: { fill: TapeFill; chip: FollowAsk | null; onAct: (ask: string) => void; showVenue?: boolean }) {
  const cls = flowClassOf(fill)
  const tone = flowTone(cls)
  const m = tapeMarket(fill.market)
  return (
    <tr className={`live-row live-row--${tone.dir}${tone.strong ? ' is-strong' : ''}`} data-class={cls} data-venue={fill.venue}>
      <td className="live__market">
        {m.href ? (
          <Link href={m.href} className="live__mlink" prefetch={false}>
            {m.dex && <span className="live__dex mono">{m.dex}</span>}
            {m.ticker}
          </Link>
        ) : (
          <span className="live__mlink live__mlink--plain">
            {m.dex && <span className="live__dex mono">{m.dex}</span>}
            {m.ticker}
          </span>
        )}
        {showVenue && (
          <span className="live__venue mono" title={fill.venue === 'dex' ? 'a spot swap on this chain' : 'a perp fill on this venue'}>
            {venueTag(fill.venue, fill.chainId)}
          </span>
        )}
      </td>
      <td className={`mono live__side live__side--${fill.side}`}>{fill.side}</td>
      <td className="mono num">{fmtSize(fill.size)}</td>
      <td className="mono num">{fmtPrice(fill.price)}</td>
      <td className="mono num live__usd">{fmtUsd(fill.usd)}</td>
      <td className="mono live__effect">{fill.effect ?? <span className="live__dim">—</span>}</td>
      <td className="mono live__time">
        <TapeClock ms={fill.at} />
      </td>
      <td className="mono live__col-wide live__taker">{fill.taker ? fmtAddr(fill.taker) : <span className="live__dim">—</span>}</td>
      <td className="mono live__col-wide num">{fill.block != null ? fill.block.toLocaleString('en-US') : <span className="live__dim">—</span>}</td>
      <td className="live__col-act">
        {chip ? (
          <button type="button" className={`live__chip live__chip--${chip.tone}`} onClick={() => onAct(chip.ask)} title={chip.ask}>
            {chip.label} <span className="live__chip-usd">${FOLLOW_USD}</span>
          </button>
        ) : (
          <span className="live__dim mono live__noact">{(m.kind === 'stock' || fill.venue === 'dex') && fill.side === 'sell' ? 'needs a position' : 'no route here'}</span>
        )}
      </td>
    </tr>
  )
}

/** `14:35:28.411` with the milliseconds in their own span (phones drop them). */
function TapeClock({ ms }: { ms: number }) {
  const full = fmtClock(ms)
  return (
    <>
      {full.slice(0, 8)}
      <span className="live__ms">{full.slice(8)}</span>
    </>
  )
}

// ── The flow chart ───────────────────────────────────────────────────────────

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

const PAD = { l: 46, r: 10, t: 10, b: 22 }
const CHART_H = 230

function FlowChart({ buckets, effectAware }: { buckets: FlowBucket[]; effectAware: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const w = useWidth(ref)
  const [hover, setHover] = useState<number | null>(null)
  const classes: FlowClass[] = effectAware ? ['long-open', 'short-cover', 'long-close', 'short-open'] : ['buy', 'sell']
  const order = FLOW_STACK.filter((c) => classes.includes(c))
  const max = niceCeil(Math.max(0, ...buckets.map((b) => b.total)))
  const plotW = Math.max(0, w - PAD.l - PAD.r)
  const plotH = CHART_H - PAD.t - PAD.b
  const n = buckets.length
  const colW = n ? plotW / n : 0
  const barW = Math.max(1, colW - 1.5)
  const y = (usd: number) => PAD.t + plotH - (usd / max) * plotH
  // No fill in the window yet: no axis numbers (niceCeil(0) printed "1 1 1 0"),
  // one quiet line instead (pre-gtm POLISH r2).
  const empty = !buckets.some((b) => b.total > 0)
  const ticks = empty ? [] : [0.25, 0.5, 0.75, 1].map((f) => f * max)
  // A time label every 15s when a label's 64px fits in 15 columns, else every 30s / 60s.
  const labelStep = colW * 15 >= 64 ? 15 : colW * 30 >= 64 ? 30 : 60
  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || !colW) return
    const i = Math.floor((e.clientX - rect.left - PAD.l) / colW)
    setHover(i >= 0 && i < n ? i : null)
  }
  const hb = hover !== null ? buckets[hover] : null
  return (
    <div className="live__chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={CHART_H} className="live__svg" role="img" aria-label="Notional per second">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className="live__grid" />
              <text x={PAD.l - 8} y={y(t) + 3.5} className="live__axis mono" textAnchor="end">
                {fmtAxisUsd(t)}
              </text>
            </g>
          ))}
          <line x1={PAD.l} x2={w - PAD.r} y1={y(0)} y2={y(0)} className="live__base" />
          {empty && (
            <text x={PAD.l + plotW / 2} y={PAD.t + plotH / 2} className="live__axis mono" textAnchor="middle">
              waiting for the first fill
            </text>
          )}
          {buckets.map((b, i) => {
            if (!b.total) return null
            let acc = 0
            const x = PAD.l + i * colW + (colW - barW) / 2
            return (
              <g key={b.sec} className={hover === i ? 'is-hover' : undefined}>
                {order.map((c) => {
                  const v = b.usd[c]
                  if (!v) return null
                  const top = y(acc + v)
                  const h = Math.max(0.5, y(acc) - top)
                  acc += v
                  return <rect key={c} x={x} y={top} width={barW} height={h} className={`live__bar live__bar--${c}`} />
                })}
              </g>
            )
          })}
          {buckets.map((b, i) => (b.sec % labelStep === 0 ? (
            <text key={`t${b.sec}`} x={PAD.l + i * colW + colW / 2} y={CHART_H - 6} className="live__axis mono" textAnchor="middle">
              {fmtAxisClock(b.sec)}
            </text>
          ) : null))}
          {hb && hover !== null && <rect x={PAD.l + hover * colW} y={PAD.t} width={colW} height={plotH} className="live__hoverband" />}
        </svg>
      )}
      <ul className="live__legend mono" aria-label="Flow classes">
        {[...order].reverse().map((c) => (
          <li key={c}>
            <span className={`live__swatch live__bar--${c}`} aria-hidden />
            {FLOW_LABEL[c]}
          </li>
        ))}
      </ul>
      {hb && (
        <div className="live__readout mono" role="status">
          <span>{fmtAxisClock(hb.sec)}</span>
          <span>{fmtUsd(hb.total)}</span>
          <span>{hb.count} fills</span>
          {order.map((c) => (hb.usd[c] ? (
            <span key={c} className={`live__ro live__ro--${c}`}>
              {FLOW_LABEL[c]} {fmtUsd(hb.usd[c])}
            </span>
          ) : null))}
        </div>
      )}
    </div>
  )
}

// ── Triggers ─────────────────────────────────────────────────────────────────

function TriggersPanel({
  armed,
  setArmed,
  thresholds,
  setThresholds,
  events,
  onAct,
  chipOk,
  children,
}: {
  armed: Set<TriggerRule>
  setArmed: (next: Set<TriggerRule>) => void
  thresholds: TriggerThresholds
  setThresholds: (t: TriggerThresholds) => void
  events: TriggerEvent[]
  onAct: (ask: string) => void
  chipOk: (f: FollowAsk) => boolean
  /** The feeds card, seated between the rules and the fired events. */
  children?: React.ReactNode
}) {
  const shown = events.filter((e) => armed.has(e.rule))
  return (
    <section className="live__triggers" aria-label="Triggers">
      <header className="live__rh">
        <span className="live__rk">Triggers</span>
        <span className="live__rv mono">rules on the stream</span>
      </header>
      <ul className="live__rules">
        {RULES.map((r) => (
          <li key={r} className="live__rule">
            <label className="live__rule-l">
              <input
                type="checkbox"
                checked={armed.has(r)}
                onChange={(e) => {
                  const next = new Set(armed)
                  if (e.target.checked) next.add(r)
                  else next.delete(r)
                  setArmed(next)
                }}
              />
              <span className="live__rule-n">{TRIGGER_LABEL[r]}</span>
            </label>
            <span className="live__rule-d mono">{triggerDetail(r, thresholds)}</span>
            {r === 'big-print' && (
              <select className="live__rule-s mono" value={thresholds.bigPrintUsd} onChange={(e) => setThresholds({ ...thresholds, bigPrintUsd: Number(e.target.value) })} aria-label="Big print threshold">
                {BIG_PRINT_CHOICES.map((v) => (
                  <option key={v} value={v}>
                    ≥ {fmtUsd(v)}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      <p className="live__note mono">A trigger arms the ask. Your wallet signs it — nothing fires on its own.</p>
      {children}
      <header className="live__rh live__rh--fired">
        <span className="live__rk">Fired</span>
        <span className="live__rv mono">{shown.length ? `${shown.length} in the last minutes` : 'newest first'}</span>
      </header>
      <ol className="live__events" aria-live="polite">
        {shown.length === 0 && <li className="live__event live__event--empty mono">Nothing has tripped yet.</li>}
        {shown.map((e) => {
          const ok = e.follow && chipOk(e.follow) ? e.follow : null
          return (
            <li key={e.id} className={`live__event live__event--${e.side}`}>
              <div className="live__eh mono">
                <span className="live__erule">{TRIGGER_LABEL[e.rule]}</span>
                <span className="live__etime">{fmtClock(e.at).slice(0, 8)}</span>
              </div>
              <p className="live__etext">{e.text}</p>
              {ok && (
                <button type="button" className={`live__chip live__chip--${ok.tone}`} onClick={() => onAct(ok.ask)} title={ok.ask}>
                  {ok.label} <span className="live__chip-usd">${FOLLOW_USD}</span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// ── Feeds ────────────────────────────────────────────────────────────────────

function FeedsCard({ source, setSource, status, detail, venues, setVenues, relayNote }: { source: TapeSource; setSource: (s: TapeSource) => void; status: FeedStatus; detail?: string; venues: DuneVenueId[]; setVenues: (v: DuneVenueId[]) => void; relayNote: string | null }) {
  const hl = feedFor('hyperliquid')
  const dune = feedFor('dune')
  const toggle = (id: DuneVenueId) => {
    const next = venues.includes(id) ? venues.filter((v) => v !== id) : DUNE_VENUES.map((v) => v.id).filter((v) => v === id || venues.includes(v))
    if (next.length) setVenues(next)
  }
  return (
    <section className="live__feeds" aria-label="Feeds">
      <header className="live__rh">
        <span className="live__rk">Feeds</span>
        <span className="live__rv mono">lib/tape-feed.ts</span>
      </header>
      <ul className="live__feedlist">
        <li className={`live__feed${source === 'dune' ? ' is-on' : ''}`} data-feed="dune">
          <button type="button" className="live__feed-b" onClick={() => setSource('dune')} aria-pressed={source === 'dune'} disabled={relayNote !== null}>
            <span className="live__feed-n">{dune.label}</span>
            <span className="live__feed-s mono">{source === 'dune' ? statusWords(status, detail) : relayNote ? `relay · ${relayNote}` : 'through our relay · the key stays on the server'}</span>
          </button>
          <div className="live__venues" role="group" aria-label="Venues on the feed">
            {DUNE_VENUES.map((v) => (
              <button key={v.id} type="button" className={`live__venue-t mono${venues.includes(v.id) ? ' is-on' : ''}`} aria-pressed={venues.includes(v.id)} onClick={() => toggle(v.id)} disabled={source !== 'dune'} data-kind={v.kind}>
                {v.label}
              </button>
            ))}
          </div>
          <p className="live__feed-f mono">+ position effect · block · hash · both parties</p>
        </li>
        <li className={`live__feed${source === 'hyperliquid' ? ' is-on' : ''}`} data-feed="hyperliquid">
          <button type="button" className="live__feed-b" onClick={() => setSource('hyperliquid')} aria-pressed={source === 'hyperliquid'}>
            <span className="live__feed-n">{hl.label}</span>
            <span className="live__feed-s mono">{source === 'hyperliquid' ? statusWords(status, detail) : 'keyless · public · the fallback'}</span>
          </button>
          <p className="live__feed-f mono">side · size · price · time · taker · hash</p>
        </li>
      </ul>
      <p className="live__note mono">A feed is a field map (lib/dune, lib/tape). The columns a feed does not carry are marked, never guessed.</p>
    </section>
  )
}
