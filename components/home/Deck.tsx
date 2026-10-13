'use client'

// THE DECK's seat on the splash (2026-10-13 — Nate: "make it easier to find
// tape, the front, the siege … a little option called Streaming Order book
// that the user can flick and see the streams coming"). The pulse band grew
// a BAR of four channels and a STAGE: Pulse (the band as it was, less its
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
import PulseSlot from '@/components/home/PulseSlot'
import TapeStage from '@/components/home/TapeStage'
import BookLadder from '@/components/home/BookLadder'
import Battle from '@/components/live/Battle'
import ShareLive from '@/components/live/ShareLive'
import ArmAlert from '@/components/live/ArmAlert'
import PickSheet from '@/components/live/PickSheet'
import { useMarketPick } from '@/lib/use-market-pick'
import { useTradable } from '@/lib/use-tradable'
import { PULSE_WHY_BY_SOURCE } from '@/lib/pulse'
import { DECK_BOOK_KEY, DECK_CHANNELS, DECK_DEFAULT_CHANNEL, deckBookMarket, deckChannel, deckHref, deckSourceLine, deckSwitchWords, isDeckBattle, parseDeckBook, serializeDeckBook, type DeckChannel, type StageReport } from '@/lib/deck'
import type { TapeFill } from '@/lib/tape'
import '@/components/live/battle.css'
import './deck.css'

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

  const def = deckChannel(ch)
  const live = report.status === 'live'
  const bookMarket = deckBookMarket([pick, hot])
  const href = deckHref(ch, pick)

  return (
    <section className="deck" data-deck data-channel={ch} data-book={book ? 'on' : 'off'} data-status={report.status} aria-label="Live channels">
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
          {isDeckBattle(ch) && <Battle key={ch} view={ch} tradable={tradable} seat="stage" onReport={setReport} onFills={onFills} onLeader={setHot} />}
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
