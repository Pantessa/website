'use client'

// "Called it on <SYM>" — the scanned X accounts for this market, on the symbol
// page's Community tab (squad called-gtm, lane COMMUNITY).
//
// One read: GET /api/x/board?sym=<SYM> → { entries: BoardEntry[], failed },
// already ranked (never re-sorted here). Each card is one account: who, the
// record's own tally, the hit rate when there are enough judged calls, a small
// price line with a dot per scanned call, and the best call (only a scanned HIT;
// a record with none shows no highlight). The card's press plots the account on
// THIS page's chart, with the best call's card open; "Full record" opens /x.
//
// States: a fixed-height placeholder while loading; one quiet line when nobody
// has been plotted; nothing at all when the read fails (the tab's feed still
// works). Every number is the entry's own; a post and a display name are text
// nodes, cleaned to one line.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { BoardEntry } from '@/lib/called-it/gtm'
import { STANDING_NOT_VERIFIED, fmtDay, type CallVerdict } from '@/lib/called-it/spec'
import { cleanLine, headlineParts, headlineTally, initialOf } from '@/lib/called-it/card-layout'
import CallActs from '@/components/called/CallActs'
import {
  BOARD_DOOR_HREF,
  avatarSrc,
  boardHref,
  boardIntro,
  boardView,
  displayName,
  fullRecordHref,
  handleLine,
  highlightOf,
  noEntriesLine,
  plotHref,
  shownEntries,
} from './called-board-rules'
import './called-board.css'

export interface CalledBoardProps {
  symbol: string
}

type Read = { entries: BoardEntry[]; failed: boolean } | 'loading' | 'error'

export default function CalledBoard({ symbol }: CalledBoardProps) {
  const [read, setRead] = useState<Read>('loading')
  const [all, setAll] = useState(false)

  // A card's press is a same-page query change (/t/<SYM>?x=&call=). The symbol
  // page reads its tab from the address only on mount and on popstate, so a
  // soft navigation would leave this tab open and the chart parked. Once the
  // address has landed, a state-less popstate (Next's router ignores one with
  // no state) tells the page to re-read it: no tab in the address = Overview,
  // where the chart is. Then the reader is taken to the top, to the chart.
  const search = useSearchParams()
  const pending = useRef<string | null>(null)
  useEffect(() => {
    const want = pending.current
    if (!want || !addressLanded(want)) return
    pending.current = null
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    window.scrollTo({ top: 0 })
  }, [search])
  const onPlot = useCallback((href: string) => {
    pending.current = href
  }, [])

  useEffect(() => {
    let dead = false
    setRead('loading')
    setAll(false)
    fetch(boardHref(symbol))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { entries?: BoardEntry[]; failed?: boolean } | null) => {
        if (dead) return
        setRead(d && Array.isArray(d.entries) ? { entries: d.entries, failed: d.failed === true } : 'error')
      })
      .catch(() => {
        if (!dead) setRead('error')
      })
    return () => {
      dead = true
    }
  }, [symbol])

  const view = boardView(read)
  if (view === 'hidden') return null

  const door = (
    <Link href={BOARD_DOOR_HREF} className="xbd__door" data-journey="called_board_door">
      Plot another handle on {symbol}
    </Link>
  )

  if (view === 'none') {
    return (
      <p className="xbd xbd--none" data-called-board="0">
        <span className="mkc__eyebrow">Called it</span>
        <span className="xbd__noneline">
          {noEntriesLine(symbol)}{' '}
          <Link href={BOARD_DOOR_HREF} data-journey="called_board_door">
            Plot a handle.
          </Link>
        </span>
      </p>
    )
  }

  const entries = typeof read === 'object' ? read.entries : []
  const { shown, hidden } = shownEntries(entries, all)

  return (
    <section className="xbd" aria-labelledby={`xbd-title-${symbol}`} data-called-board={view === 'loading' ? 'loading' : String(entries.length)}>
      <header className="xbd__head">
        <h2 className="xbd__title" id={`xbd-title-${symbol}`}>
          Called it on {symbol}
        </h2>
        <p className="xbd__intro">
          {boardIntro}{' '}
          <Link href="/x" className="xbd__how">
            How it is judged
          </Link>
        </p>
      </header>

      {view === 'loading' ? (
        <div className="xbd__placeholder" aria-busy="true" aria-label="Loading the accounts plotted on this market" />
      ) : (
        <ul className="xbd__grid">
          {shown.map((e) => (
            <li key={`${e.handle}:${e.symbol}`}>
              <BoardCard entry={e} onPlot={onPlot} />
            </li>
          ))}
        </ul>
      )}

      <footer className="xbd__foot">
        {hidden > 0 && (
          <button type="button" className="xbd__more" onClick={() => setAll(true)} data-journey="called_board_more">
            Show all {entries.length}
          </button>
        )}
        {door}
      </footer>
    </section>
  )
}

/** The address names the press's page and every one of its params (another hook may reorder or add to them). */
function addressLanded(want: string): boolean {
  const u = new URL(want, window.location.origin)
  const here = new URLSearchParams(window.location.search)
  return window.location.pathname === u.pathname && [...u.searchParams].every(([k, v]) => here.get(k) === v)
}

const INK: Record<CallVerdict, string> = { right: 'is-right', wrong: 'is-wrong', flat: 'is-flat', open: 'is-open' }

function BoardCard({ entry: e, onPlot }: { entry: BoardEntry; onPlot: (href: string) => void }) {
  const [imgOk, setImgOk] = useState(true)
  const src = avatarSrc(e.avatarUrl)
  const parts = headlineParts(e.headline)
  const best = highlightOf(e)
  const name = displayName(e)
  const plot = plotHref(e)

  return (
    <article className="xbd-card" aria-label={`${name} on ${e.symbol}`}>
      <Link href={plot} className="xbd-card__press" data-journey="called_board_plot" onClick={() => onPlot(plot)}>
        <div className="xbd-card__who">
          <span className="xbd-card__avatar" aria-hidden>
            {src && imgOk ? <img src={src} alt="" width={40} height={40} referrerPolicy="no-referrer" onError={() => setImgOk(false)} /> : initialOf(e.name, e.handle)}
          </span>
          <span className="xbd-card__id">
            <span className="xbd-card__name">
              <bdi>{name}</bdi>
              {e.verified && <span className="xbd-card__verified">Verified</span>}
            </span>
            <span className="xbd-card__handle">{handleLine(e)}</span>
          </span>
        </div>

        {parts ? (
          <ul className="xbd-card__tally" aria-label="The record">
            {parts.counts.map((c) => (
              <li key={c.text} className={c.kind === 'total' ? 'xbd-chip xbd-chip--total' : `xbd-chip ${INK[c.kind]}`}>
                {c.kind !== 'total' && <span className="xbd-mark" aria-hidden />}
                {c.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="xbd-card__tallyline">{headlineTally(e.headline)}</p>
        )}
        {e.hitRate && <p className="xbd-card__rate">{e.hitRate}</p>}

        {e.line && (
          <div className="xbd-card__spark" aria-hidden>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={e.line} />
            </svg>
            {e.dots.map((d) => (
              <span key={d.postId} className={`xbd-dot ${INK[d.verdict]}`} style={{ left: `${d.x}%`, top: `${d.y}%` }} />
            ))}
          </div>
        )}

        {best && (
          <div className="xbd-card__best is-right">
            <p className="xbd-card__bestlabel">
              Best call · {fmtDay(best.postedAt)}
            </p>
            <blockquote className="xbd-card__quote">“{cleanLine(best.quote || best.text, 160)}”</blockquote>
            <p className="xbd-card__move">
              {best.verdictWords}: {best.move}
            </p>
          </div>
        )}

        <span className="xbd-card__go">{best ? 'Plot this call on the chart' : 'Plot on the chart'}</span>
      </Link>

      <div className="xbd-card__foot">
        {!e.verified && <p className="xbd-card__standing">{STANDING_NOT_VERIFIED}</p>}
        <div className="xbd-card__acts">
          <Link href={fullRecordHref(e)} className="xbd-card__record" data-journey="called_board_record">
            Full record
          </Link>
          {best && <CallActs symbol={e.symbol} stance={best.stance} handle={e.handle} postId={best.postId} variant="row" />}
        </div>
      </div>
    </article>
  )
}
