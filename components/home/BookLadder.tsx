'use client'

// THE STREAMING ORDER BOOK on the deck (components/home/Deck, 2026-10-13 —
// Nate: "a little option called Streaming Order book that the user can flick
// and see the streams coming"). Hyperliquid's l2Book for the channel's market
// over the venue's keyless socket (lib/depth-feed — the Depth view's own
// feed; when a socket is refused it polls the book route and the foot says
// "every 5s", never a silent downgrade), cut to a ladder of eight rungs a
// side within ±2% of the mid (lib/deck deckLadder), with the prints the
// channel's feed carries landing on the rung they hit and fading over eight
// seconds (lib/depth PRINT_FADE_MS). The book is the venue's; the prints are
// the feed's; the door is the symbol page's Depth view, where a rung becomes
// a resting order. Nothing here fires on its own.
//
// The market can change second to second (the hot market, the leading army),
// so a change is held a moment before the socket re-aims; the ladder keeps
// the old book until the new one answers.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import Link from 'next/link'
import { openBookFeed, type BookFeedHandle } from '@/lib/depth-feed'
import { EMPTY_BOOK, type BookFeedStatus, type DepthBook } from '@/lib/depth'
import { DECK_LADDER_RUNGS, deckBookDoor, deckBookWords, deckLadder, deckLadderFoot, deckPrintRung, deckPrints, fmtLadderPrice, fmtLadderUsd, type DeckPrint } from '@/lib/deck'
import { fmtClock, fmtUsd, tapeMarket, type TapeFill, type TapeSource } from '@/lib/tape'

/** How long a new market is held before the socket re-aims at it. */
const SETTLE_MS = 1500
/** The ladder repaints at most this often (the venue pushes on every change). */
const FLUSH_MS = 250
/** A book that never answers is said so after this long. */
const MISSING_MS = 12_000

export default function BookLadder({ market, fillsRef, source }: { market: string | null; fillsRef: RefObject<readonly TapeFill[]>; source: TapeSource }) {
  const [aim, setAim] = useState<string | null>(market)
  useEffect(() => {
    if (market === aim) return
    const id = window.setTimeout(() => setAim(market), market && aim ? SETTLE_MS : 0)
    return () => window.clearTimeout(id)
  }, [market, aim])

  const [book, setBook] = useState<DepthBook>(EMPTY_BOOK)
  const [status, setStatus] = useState<BookFeedStatus>('idle')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const bookRef = useRef<DepthBook>(EMPTY_BOOK)
  const flushRef = useRef<number | null>(null)

  useEffect(() => {
    if (!aim) return
    let handle: BookFeedHandle | null = null
    let gotOne = false
    setStatus('connecting')
    setDetail(undefined)
    const missing = window.setTimeout(() => {
      if (!gotOne) {
        setStatus('missing')
        setDetail('no resting book on this feed')
      }
    }, MISSING_MS)
    handle = openBookFeed(
      'hyperliquid',
      { symbol: aim, source: 'hyperliquid', pair: aim },
      {
        onBook: (b) => {
          gotOne = true
          bookRef.current = b
          if (flushRef.current === null) {
            flushRef.current = window.setTimeout(() => {
              flushRef.current = null
              setBook(bookRef.current)
            }, FLUSH_MS)
          }
        },
        onStatus: (s, d) => {
          if (s === 'live' || s === 'polling') gotOne = true
          setStatus(s)
          setDetail(d)
        },
      },
    )
    return () => {
      window.clearTimeout(missing)
      handle?.close()
      if (flushRef.current !== null) window.clearTimeout(flushRef.current)
      flushRef.current = null
    }
  }, [aim])

  // The second hand: the prints age on it.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const ladder = useMemo(() => (aim ? deckLadder(book, DECK_LADDER_RUNGS) : null), [book, aim])
  const prints: DeckPrint[] = useMemo(() => (aim ? deckPrints(fillsRef.current ?? [], aim, now) : []), [aim, now, fillsRef, book])
  const hits = useMemo(() => {
    const m = new Map<string, 'buy' | 'sell'>()
    if (!ladder) return m
    for (const p of prints) {
      const r = deckPrintRung(ladder, p.fill.price)
      if (r && !m.has(`${r.side}${r.index}`)) m.set(`${r.side}${r.index}`, p.fill.side)
    }
    return m
  }, [ladder, prints])
  const tm = aim ? tapeMarket(aim) : null
  const door = aim ? deckBookDoor(aim) : null
  const words = deckBookWords(status, aim)
  const n = ladder?.asks.length ?? DECK_LADDER_RUNGS

  return (
    <aside className="deck__book" aria-label="Streaming order book">
      <div className="ladder" data-status={status} data-market={aim ?? undefined} data-prints={prints.length}>
        <div className="ladder__head">
          <span className="ladder__title">
            {tm ? (
              <>
                {tm.dex && <span className="deck__dex">{tm.dex}</span>}
                {tm.ticker} · order book
              </>
            ) : (
              'Order book'
            )}
          </span>
          <span className="ladder__status" role="status">
            {words}
            {detail && status !== 'live' ? ` · ${detail}` : ''}
          </span>
        </div>
        {ladder ? (
          <>
            <div className="ladder__rows" aria-label="Asks, furthest first">
              {ladder.asks.map((r, i) => {
                const hit = hits.get(`ask${n - 1 - i}`)
                return (
                  <Rung key={`a${i}`} side="ask" px={r.px} usd={r.cumUsd} share={r.share} hit={hit} />
                )
              })}
            </div>
            <div className="ladder__mid">
              <span>
                mid <b>{fmtLadderPrice(ladder.mid)}</b>
              </span>
              <span>spread {ladder.spread != null ? <b>{fmtLadderPrice(ladder.spread)}</b> : '—'}</span>
              <span>{ladder.bids.length} a side</span>
            </div>
            <div className="ladder__rows" aria-label="Bids, nearest first">
              {ladder.bids.map((r, i) => (
                <Rung key={`b${i}`} side="bid" px={r.px} usd={r.cumUsd} share={r.share} hit={hits.get(`bid${i}`)} />
              ))}
            </div>
            <ol className="ladder__prints" aria-label="Prints landing on the book">
              {prints.length === 0 && <li className="ladder__print" style={{ color: 'var(--muted-2)' }}>waiting for a print on {tm?.ticker ?? 'this market'}</li>}
              {prints.map((p) => (
                <li key={p.fill.id} className={`ladder__print ladder__print--${p.fill.side}`} style={{ opacity: 0.35 + 0.65 * p.alpha }}>
                  <span>
                    {p.fill.side === 'buy' ? '▲' : '▼'} {p.fill.side === 'buy' ? 'bought' : 'sold'} {fmtUsd(p.fill.usd)} at {fmtLadderPrice(p.fill.price)}
                  </span>
                  <time dateTime={new Date(p.fill.at).toISOString()}>{fmtClock(p.fill.at).slice(0, 8)}</time>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="ladder__empty">{!aim ? 'The ladder follows the channel’s market — the first fill names it.' : status === 'missing' ? `Hyperliquid keeps no resting book for ${tm?.ticker ?? aim} on this socket.` : `Reaching Hyperliquid’s book for ${tm?.ticker ?? aim}…`}</div>
        )}
        <p className="ladder__foot">
          {deckLadderFoot(ladder, source, prints.length)}
          {door && (
            <>
              <br />
              <Link href={door} className="ladder__door" prefetch={false} data-journey="Open the depth view">
                {door.includes('view=depth') ? 'Open the depth view' : `Open ${tm?.ticker}`} <span aria-hidden>→</span>
              </Link>
            </>
          )}
        </p>
      </div>
    </aside>
  )
}

function Rung({ side, px, usd, share, hit }: { side: 'ask' | 'bid'; px: number; usd: number; share: number; hit?: 'buy' | 'sell' }) {
  return (
    <>
      <span className={`ladder__px ladder__px--${side}`}>{fmtLadderPrice(px)}</span>
      <span className="ladder__seat">
        <span className={`ladder__bar${side === 'bid' ? ' ladder__bar--bid' : ''}`} style={{ width: `${Math.max(1, Math.round(share * 100))}%` }} />
        {hit && <span className={`ladder__hit${hit === 'sell' ? ' ladder__hit--sell' : ''}`} aria-hidden />}
      </span>
      <span className="ladder__usd">{fmtLadderUsd(usd)}</span>
    </>
  )
}
