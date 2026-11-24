'use client'

// THE CALL CARD (2026-11-16; SLEEK 2026-11-24): one call, opened ON the chart.
//
// A dot or a summary bubble pressed on the chart used to scroll the page down
// to that call's row in the list under it (Nate: "the screen's scroll is
// disorientating"). Now the page stays where it is and the call opens here:
// the verdict as the brand's tile, the post's own words, the numbers it was
// judged on, the trade for this market and the post on X one press away.
//
// On a desktop it docks on the side of the chart the call's bar is NOT on
// (lib/tv/called-pins `dockFor`), so it never covers the dot it is about. On a
// phone it is a short card at the foot of the screen, above the tab bar: the
// chart stays in view over it, the words are clamped behind "more" (never
// rewritten), and older / newer (or a sideways swipe) walk the record with a
// thumb. "More" opens the whole post, the share link and the pin.
//
// Words: the verdict's word, the judged move and the "since" line are the
// spec's. A post's text is rendered as text.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ExternalLink, Pin, Share2, X } from 'lucide-react'
import { fmtPrice } from '@/components/CandleChart'
import CallActs from '@/components/called/CallActs'
import { PostText } from '@/components/called/CallsPanel'
import VerdictTile from '@/components/sleek/VerdictTile'
import { appScrollTop, scrollAppTo } from '@/lib/app-scroller'
import { chartPairFor, chartUnitOf } from '@/lib/charts'
import { callHref } from '@/lib/called-it/gtm'
import { ADDED_MARK, VERDICT_WORDS, judgedLine, moveLine, sinceLine } from '@/lib/called-it/spec'
import { useCalled } from '@/lib/called-it/use-record'
import { pinDate } from '@/lib/tv/called-pins'
import './called-chart.css'

// The card is a bottom card on a phone (called-chart.css, max-width 640px): its trade buttons stack there.
// A sideways swipe this long, and at least twice as wide as it is tall, walks to the next call.
const SWIPE_PX = 56
// Where the band's top lands when a phone's page moves for an opened call: under the top bar and the stuck tabs.
const PHONE_LANDS_AT = 108
// The chart a phone must show over the card before the page is left where it is.
const PHONE_CHART_ROOM = 200
const SHEET_QUERY = '(max-width: 640px)'
const onSheetChange = (cb: () => void) => {
  const mq = window.matchMedia(SHEET_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const useSheet = () => useSyncExternalStore(onSheetChange, () => window.matchMedia(SHEET_QUERY).matches, () => false)

export default function CallFocus({ symbol }: { symbol: string }) {
  const record = useCalled((s) => (s.symbol && s.symbol.toUpperCase() === symbol.toUpperCase() ? s.record : null))
  const focusId = useCalled((s) => s.focusId)
  const dock = useCalled((s) => s.focusDock)
  const ref = useRef<HTMLElement | null>(null)
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const sheet = useSheet()
  // "More": the whole post (and, on a phone, the share link and the pin). Every call opens short.
  const [more, setMore] = useState(false)
  const [clamped, setClamped] = useState(false)
  const index = record && focusId ? record.calls.findIndex((c) => c.postId === focusId) : -1
  const open = index >= 0

  useEffect(() => setMore(false), [focusId])
  // A PHONE, once per open: when the card opens and would leave the chart mostly covered (the page at its top, or down at
  // the list under the chart), the page moves ONCE so the handle's band sits under the tabs and the chart fills the screen
  // over this card. Walking older / newer never moves it again, and the visitor's own scroll afterwards is theirs.
  const moved = useRef(false)
  useEffect(() => {
    if (!open) {
      moved.current = false
      return
    }
    if (!sheet || moved.current) return
    moved.current = true
    const raf = requestAnimationFrame(() => {
      const card = ref.current
      const canvas = card?.parentElement
      const band = document.querySelector('[data-called-head]')
      if (!card || !canvas || !band) return
      const pane = canvas.getBoundingClientRect()
      const seen = Math.min(card.getBoundingClientRect().top, pane.bottom) - Math.max(pane.top, PHONE_LANDS_AT)
      const by = band.getBoundingClientRect().top - PHONE_LANDS_AT
      if (seen >= PHONE_CHART_ROOM || Math.abs(by) <= 8) return
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      scrollAppTo(appScrollTop() + by, calm ? 'auto' : 'smooth')
    })
    return () => cancelAnimationFrame(raf)
  }, [open, sheet])

  // Whether the post's words are cut where they stand: "more" marks the cut only when there is one.
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el || more) return
    setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [focusId, more, sheet, open])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useCalled.getState().focus(null, 'card')
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  if (!record || index < 0) return null
  const call = record.calls[index]
  const { focus, togglePin } = useCalled.getState()
  const step = (by: number) => {
    const next = record.calls[index + by]
    if (next) focus(next.postId, 'card')
  }
  const px = chartUnitOf(chartPairFor(symbol)) === 'usd' ? '$' : ''
  const who = `@${record.handle}`
  const since = sinceLine(call)
  const day = pinDate(call.postedAt)
  // A phone's "more" also opens the share link and the pin, so it is always there; a desktop shows it only where words are cut.
  const canMore = more || clamped || sheet

  return (
    <aside
      ref={ref}
      className="xcf"
      data-dock={dock}
      data-verdict={call.verdict}
      data-more={more ? '' : undefined}
      data-called-card={call.postId}
      role="dialog"
      aria-label={`${who} on ${record.symbol}, ${day}: ${VERDICT_WORDS[call.verdict]}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
      }}
      onTouchStart={(e) => {
        const t = e.touches[0]
        touch.current = t ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchEnd={(e) => {
        const from = touch.current
        const t = e.changedTouches[0]
        touch.current = null
        if (!from || !t) return
        const dx = t.clientX - from.x
        const dy = t.clientY - from.y
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1)
      }}
    >
      <header className="xcf__band">
        <VerdictTile verdict={call.verdict} size={30} className="xcf__tile" />
        <span className="xcf__lead">
          <span className="xcf__verdict">{VERDICT_WORDS[call.verdict]}</span>
          <span className="xcf__when mono">
            {day}
            <span className="xcf__stance" data-stance={call.stance}>
              {call.stance === 'bull' ? 'Bull' : 'Bear'}
            </span>
          </span>
        </span>
        <span className="xcf__step mono" role="group" aria-label="Walk the calls, oldest to newest">
          <button type="button" className="xcf__icon" onClick={() => step(-1)} disabled={index === 0} aria-label="The call before this one" title="Older call (left arrow)" data-journey="called_card_prev">
            <ChevronLeft aria-hidden />
          </button>
          <span className="xcf__at">
            {index + 1} of {record.calls.length}
          </span>
          <button type="button" className="xcf__icon" onClick={() => step(1)} disabled={index === record.calls.length - 1} aria-label="The call after this one" title="Newer call (right arrow)" data-journey="called_card_next">
            <ChevronRight aria-hidden />
          </button>
        </span>
        <button type="button" className="xcf__icon xcf__close" onClick={() => focus(null, 'card')} aria-label="Close this call" title="Close (Esc)">
          <X aria-hidden />
        </button>
      </header>

      <div className="xcf__body">
        {call.origin === 'added' ? <p className="xcf__added mono">{ADDED_MARK}. Shown, and not in the count.</p> : null}
        {/* The post's own words. Short by default: the cut is marked, and "more" opens every word in place. */}
        <div className="xcf__words" data-clamped={clamped && !more ? '' : undefined}>
          <p ref={textRef} className="xcf__text" id="xcf-text">
            <PostText call={call} />
          </p>
          {canMore ? (
            <button type="button" className="xcf__more" aria-expanded={more} aria-controls="xcf-text" onClick={() => setMore((m) => !m)} data-journey="called_card_more">
              <span className="xcf__moreword">{more ? 'less' : clamped ? '… more' : 'more'}</span>
            </button>
          ) : null}
        </div>
        {call.target ? (
          <p className="xcf__level mono">
            Level it names <b>{call.target.stated}</b>
          </p>
        ) : null}
        {/* A phone's short card says the move on one line (the spec's own sentence); the table under it opens with "more". */}
        <p className="xcf__move mono">{moveLine(call)}</p>
      </div>

      <dl className="xcf__nums">
        <div className="xcf__num">
          <dt className="mono">Price that day</dt>
          <dd>
            {px}
            {fmtPrice(call.priceAt)}
          </dd>
        </div>
        <div className="xcf__num is-judged">
          <dt className="mono">{call.verdict === 'open' ? 'So far' : 'Judged on'}</dt>
          <dd>{judgedLine(call)}</dd>
        </div>
        {since ? (
          <div className="xcf__num" data-sign={call.now >= 0 ? 'up' : 'down'}>
            <dt className="mono">To the last close</dt>
            <dd>{since}</dd>
          </div>
        ) : null}
      </dl>

      <div className="xcf__acts">
        {/* The trade for this market, the app's own sentence (lib/called-it/acts; nothing renders where nothing can run), and the
            call's own page, where its share row lives. */}
        <div className="xca-band" data-sheet={sheet || undefined}>
          <CallActs symbol={record.symbol} stance={call.stance} handle={record.handle} postId={call.postId} variant={sheet ? 'stack' : 'row'} className="xca--card" />
          {/* A pasted post is shown and marked, never a call to share (review F1): its address is the plain record. */}
          {call.origin !== 'added' && (
            <Link className="xca-share" href={callHref(record.handle, record.symbol, call.postId)} data-journey="called_card_share">
              <Share2 aria-hidden />
              Share this call
            </Link>
          )}
        </div>

        <footer className="xcf__foot">
          {call.url ? (
            <a className="xcf__x" href={call.url} target="_blank" rel="noopener noreferrer nofollow" aria-label="Open the post on X" data-journey="called_card_x">
              {/* A phone's short card keeps the row for the trade's whole sentence: the link reads "X" there, and says all of it aloud. */}
              <span className="xcf__xword">
                <span className="xcf__xpre">Open the post on </span>X
              </span>
              <ExternalLink aria-hidden />
            </a>
          ) : (
            <span className="xcf__x is-none">A fixture post: it was never on X</span>
          )}
          <button type="button" className="xcf__pin" aria-pressed={call.picked} onClick={() => togglePin(call.postId)} title={call.picked ? 'Its summary is on the chart. Unpin it (it still counts).' : 'Keep this call’s summary on the chart'} data-journey="called_card_pin">
            <Pin aria-hidden />
            {call.picked ? 'Pinned' : 'Pin'}
          </button>
        </footer>
      </div>
    </aside>
  )
}
