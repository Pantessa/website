'use client'

// THE DECK's seat on the splash (2026-10-13 — Nate: "make it easier to find
// tape, the front, the siege … a little option called Streaming Order book
// that the user can flick and see the streams coming"). The pulse band grew
// a BAR of channels (five since The Flyover joined, 2026-10-15) and a STAGE: Pulse (the band as it was, less its
// own head and foot — the deck carries them), Tape (/live's tape, small), The
// Front and The Siege (the battle views in their stage seat). A channel tab
// is a real link to its /live page (a URL never fires a turn; pasted or with
// JS off it still opens the page) that switches the stage in place on a
// plain click. The STREAMING ORDER BOOK switch at the bar's right end splits
// the stage with a ladder of Hyperliquid's resting orders for the channel's
// market (components/home/BookLadder), remembered per browser.
//
// The rules live in lib/deck (pure, pinned). This file is the browser: the
// channel state, the switch's memory (read after mount so the server frame
// and the first paint agree), the stage's reports (status · source · the
// market the ladder follows · the merged buffer the ladder lands prints
// from), and the foot. Every chip inside the stages goes through the
// connect-to-act door the way every markets chip does; the deck itself never
// calls the chat route.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import PulseSlot from '@/components/home/PulseSlot'
import TapeStage from '@/components/home/TapeStage'
import BookLadder from '@/components/home/BookLadder'
import Battle from '@/components/live/Battle'
import ShareLive from '@/components/live/ShareLive'
import ArmAlert from '@/components/live/ArmAlert'
import PickSheet from '@/components/live/PickSheet'
import PickReads from '@/components/live/PickReads'
import { applyPickLink, useMarketPick } from '@/lib/use-market-pick'
import { useTradable } from '@/lib/use-tradable'
import { PULSE_WHY_BY_SOURCE } from '@/lib/pulse'
import { DECK_BOOK_KEY, DECK_CHANNELS, DECK_DEFAULT_CHANNEL, deckBookMarket, deckChannel, deckHref, deckSearch, deckSourceLine, deckSwitchWords, deckWritesPick, isDeckBattle, parseDeckBook, parseDeckView, serializeDeckBook, type DeckChannel, type StageReport } from '@/lib/deck'
import { PICK_PARAM, pickParam } from '@/lib/market-pick'
import type { TapeFill } from '@/lib/tape'
import '@/components/live/battle.css'
import '@/components/live/flyover.css'
import './deck.css'

// The Flyover channel (2026-10-15): /live's world in its stage seat, loaded only
// when picked — `/` never carries its shell (three.js is lazier still, inside it).
const Flyover = dynamic(() => import('@/components/live/Flyover'), { ssr: false, loading: () => <div className="deck__tapeempty mono">raising the land…</div> })

const FRESH: StageReport = { status: 'connecting', source: 'dune', markets: 0, hidden: false }

export default function Deck() {
  const [ch, setCh] = useState<DeckChannel>(DECK_DEFAULT_CHANNEL)
  const [book, setBook] = useState(false)
  const [report, setReport] = useState<StageReport>(FRESH)
  /** The pulse's picked chip — the tape doors carry it as /live's ?m=. */
  const [pick, setPick] = useState<string | null>(null)
  /** The channel's own market: the hot market, or the leading army. */
  const [hot, setHot] = useState<string | null>(null)
  const fillsRef = useRef<readonly TapeFill[]>([])
  const tradable = useTradable()
  // THE ONE PICK on the deck (GTM squad 2026-10-13): the same store the
  // channels read; the ladder follows its first market (lane PICK's line),
  // and on a phone the bar carries ARENA's sheet trigger (the pulse's own
  // row is hidden there by the band's height budget — the first board row
  // must stay inside 740px at 375×812, lib/deck DECK_STAGE_MIN_H's reason).
  const marketPick = useMarketPick({ seat: 'stage' })
  const tabsRef = useRef<HTMLElement>(null)

  // The switch's memory, read after mount: the server frame starts off.
  useEffect(() => {
    try {
      setBook(parseDeckBook(window.localStorage.getItem(DECK_BOOK_KEY)))
    } catch {}
  }, [])
  // THE ADDRESS (2026-10-20 — Nate: "set urls to each of the view settings so
  // people can share tokens selected, time frame and view"). Read after mount
  // (`/` is ISR: the server frame is always the pulse), then mirrored with
  // replaceState in /live's own words (lib/deck deckSearch): `?view=` the
  // channel, `?t=` the pick, the stage's own keys beside them. Nothing is
  // written before the read, so a link's settings survive the first paint.
  const [urlRead, setUrlRead] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const linked = parseDeckView(q.get('view'))
    if (linked !== DECK_DEFAULT_CHANNEL) setCh(linked)
    applyPickLink(q.get(PICK_PARAM))
    setUrlRead(true)
  }, [])
  useEffect(() => {
    if (!urlRead || !marketPick.ready || window.location.pathname !== '/') return
    const here = window.location.search
    const write = deckWritesPick(ch, marketPick.source, new URLSearchParams(here).has(PICK_PARAM))
    const next = '/' + deckSearch(here, ch, marketPick.markets, write)
    if (next !== '/' + here) window.history.replaceState(window.history.state, '', next)
  }, [urlRead, ch, marketPick.ready, marketPick.source, marketPick.markets])
  const toggleBook = useCallback(() => {
    setBook((b) => {
      const next = !b
      try {
        window.localStorage.setItem(DECK_BOOK_KEY, serializeDeckBook(next))
      } catch {}
      return next
    })
  }, [])

  const onFills = useCallback((buffer: readonly TapeFill[]) => {
    fillsRef.current = buffer
  }, [])
  // PHONE (lane PHONE, R1): the bar scrolls under 640px, so a switched-to
  // channel can sit past the right edge — bring it into view, never the page.
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-channel="${ch}"]`)
    el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [ch])
  const switchTo = useCallback((id: DeckChannel) => {
    setCh(id)
    setReport(FRESH)
    setHot(null)
    fillsRef.current = []
  }, [])
  const onTab = (e: MouseEvent<HTMLAnchorElement>, id: DeckChannel) => {
    // A modified click keeps the link's own behaviour (new tab, new window).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    if (id !== ch) switchTo(id)
  }

  // A navigation onto `/` from `/` (the logo, back/forward) keeps this
  // component mounted, so the deck follows the address it lands on. The
  // deck's own writes always agree with the channel, so only a real arrival
  // moves it. The Navigation API where the browser has one; popstate always.
  const chRef = useRef(ch)
  chRef.current = ch
  const pickRef = useRef(marketPick.markets)
  pickRef.current = marketPick.markets
  useEffect(() => {
    if (!urlRead) return
    const follow = () => {
      if (window.location.pathname !== '/') return
      const q = new URLSearchParams(window.location.search)
      const linked = parseDeckView(q.get('view'))
      if (linked !== chRef.current) switchTo(linked)
      const t = q.get(PICK_PARAM)
      if (t && t !== pickParam(pickRef.current)) applyPickLink(t)
    }
    const nav = (window as unknown as { navigation?: EventTarget }).navigation
    window.addEventListener('popstate', follow)
    nav?.addEventListener('currententrychange', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      nav?.removeEventListener('currententrychange', follow)
    }
  }, [urlRead, switchTo])

  const def = deckChannel(ch)
  const live = report.status === 'live'
  const bookMarket = deckBookMarket([marketPick.markets[0] ?? null, pick, hot]) // the ladder follows the FIRST of the one pick (GTM squad 2026-10-13, lane PICK)
  const href = deckHref(ch, pick)

  return (
    <section className="deck" data-deck data-channel={ch} data-book={book ? 'on' : 'off'} data-status={report.status} aria-label="Live channels">
      <PickReads />{/* the page's ONE watchlist + holdings subscriber for the pick (lib/use-market-pick) — renders nothing */}
      <div className="deck__bar">
        <nav className="deck__tabs" role="tablist" aria-label="Channels" ref={tabsRef}>
          {DECK_CHANNELS.map((c) => {
            const on = c.id === ch
            return (
              <Link
                key={c.id}
                href={deckHref(c.id, pick)}
                prefetch={false}
                role="tab"
                aria-selected={on}
                className={`deck__ch${on ? ' is-on' : ''}`}
                onClick={(e) => onTab(e, c.id)}
                data-channel={c.id}
                data-journey={`Channel ${c.label}`}
                title={c.blurb}
              >
                <b className="deck__chname">
                  {on && <i className={`mk-dot ${live ? 'mk-dot--open' : 'mk-dot--closed'} deck__dot`} aria-hidden />}
                  {c.label}
                </b>
                <small className="deck__chblurb mono">{c.blurb}</small>
              </Link>
            )
          })}
        </nav>
        {/* The phone's door: the foot steps out under 640px (the phone band's
            budget), so the channel's door rides the chip row there. */}
        <PickSheet pick={marketPick} seat="deck" />{/* seat: ARENA (GTM squad 2026-10-13) — the phone's trigger; renders nothing on a desktop */}
        <Link href={href} className="deck__ch deck__ch--door" prefetch={false} data-journey={def.door} aria-label={def.door}>
          <b className="deck__chname">
            {def.door.replace(/^Open /, '')} <span aria-hidden>→</span>
          </b>
        </Link>
        <ShareLive view={def.view} seat="deck" />{/* seat: CARD (GTM squad 2026-10-13) */}
        {bookMarket && <ArmAlert market={bookMarket} seat="deck" />}{/* seat: ALERTS (GTM squad 2026-10-13) */}
        <button type="button" role="switch" aria-checked={book} className={`deck__flick${book ? ' is-on' : ''}`} onClick={toggleBook} data-journey="Streaming order book">
          <span className="deck__flicklab">
            <b>
              <span className="deck__flick-long">Streaming order book</span>
              <span className="deck__flick-short">Book</span>
            </b>
            <small className="mono">{deckSwitchWords(book, bookMarket)}</small>
          </span>
          <span className="deck__sw" aria-hidden />
        </button>
      </div>

      <div className="deck__stage">
        <div className="deck__chan" role="tabpanel" aria-label={def.label}>
          {ch === 'pulse' && <PulseSlot seat="stage" onReport={setReport} onFills={onFills} onBookMarket={setHot} onPick={setPick} />}
          {ch === 'tape' && <TapeStage onReport={setReport} onFills={onFills} onBookMarket={setHot} />}
          {isDeckBattle(ch) && <Battle key={ch} view={ch} tradable={tradable} seat="stage" url onReport={setReport} onFills={onFills} onLeader={setHot} />}
          {ch === 'flyover' && <Flyover tradable={tradable} seat="stage" url onReport={setReport} onBookMarket={setHot} />}
        </div>
        {book && <BookLadder market={bookMarket} fillsRef={fillsRef} source={report.source} />}
      </div>

      <footer className="deck__foot mono">
        <span className="deck__src" role="status">{deckSourceLine(ch, report)}</span>
        <span className="deck__why">{PULSE_WHY_BY_SOURCE[report.source].why}</span>
        <Link href={href} className="deck__door" prefetch={false} data-journey={def.door}>
          {def.door} <span aria-hidden>→</span>
        </Link>
      </footer>
    </section>
  )
}
