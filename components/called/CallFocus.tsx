'use client'

// THE CALL CARD (2026-11-16): one call, opened ON the chart.
//
// A dot or a summary bubble pressed on the chart used to scroll the page down
// to that call's row in the list under it (Nate: "the screen's scroll is
// disorientating"). Now the page stays where it is and the call opens here:
// the verdict, the whole post, the numbers it was judged on, and the post on X
// one press away. It docks on the side of the chart the call's bar is NOT on
// (lib/tv/called-pins `dockFor`), so it never covers the dot it is about, and
// the bar itself wears a dashed rule. Older / newer walk the record in order;
// on a phone it is a sheet at the bottom of the screen.
//
// Words: the verdict's word, the judged move and the "since" line are the
// spec's. A post's text is rendered as text.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ExternalLink, Heart, Pin, Share2, X } from 'lucide-react'
import { fmtPrice } from '@/components/CandleChart'
import CallActs from '@/components/called/CallActs'
import { PostText, avatarOf } from '@/components/called/CallsPanel'
import { chartPairFor, chartUnitOf } from '@/lib/charts'
import { callHref } from '@/lib/called-it/gtm'
import { ADDED_MARK, VERDICT_WORDS, judgedLine, sinceLine } from '@/lib/called-it/spec'
import { useCalled } from '@/lib/called-it/use-record'
import { VERDICT_GLYPH, cleanPostText, pinDate } from '@/lib/tv/called-pins'
import './called-chart.css'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

// The card is a sheet on a phone (called-chart.css, max-width 640px): its trade buttons stack there.
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
  const sheet = useSheet()
  const index = record && focusId ? record.calls.findIndex((c) => c.postId === focusId) : -1
  const open = index >= 0

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
  const avatar = avatarOf(record.profile.avatarUrl)
  const rawName = cleanPostText(record.profile.name).slice(0, 60)
  const named = !!rawName && rawName.toLowerCase() !== record.handle.toLowerCase() && rawName.toLowerCase() !== who.toLowerCase()
  const since = sinceLine(call)
  const day = pinDate(call.postedAt)

  return (
    <aside
      ref={ref}
      className="xcf"
      data-dock={dock}
      data-verdict={call.verdict}
      data-called-card={call.postId}
      role="dialog"
      aria-label={`${who} on ${record.symbol}, ${day}: ${VERDICT_WORDS[call.verdict]}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
      }}
    >
      <header className="xcf__band">
        <span className="xcf__verdict">
          <i className="xcf__glyph" aria-hidden>
            {VERDICT_GLYPH[call.verdict]}
          </i>
          {VERDICT_WORDS[call.verdict]}
        </span>
        <span className="xcf__stance mono" data-stance={call.stance}>
          {call.stance === 'bull' ? 'Bull' : 'Bear'}
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
        <div className="xcf__who">
          <span className="xcf__avatar" aria-hidden>
            {avatar ? <img src={avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" /> : (rawName || record.handle).slice(0, 1).toUpperCase()}
          </span>
          <span className="xcf__names">
            <span className="xcf__name">{named ? <bdi>{rawName}</bdi> : who}</span>
            <span className="xcf__sub mono">
              {named ? `${who} · ` : ''}
              {day}
            </span>
          </span>
          {call.likes !== null ? (
            <span className="xcf__likes mono" title={`${call.likes.toLocaleString('en-US')} likes on X`}>
              <Heart aria-hidden />
              {compact.format(call.likes)}
            </span>
          ) : null}
        </div>
        {call.origin === 'added' ? <p className="xcf__added mono">{ADDED_MARK}. Shown, and not in the count.</p> : null}
        <p className="xcf__text">
          <PostText call={call} />
        </p>
        {call.target ? (
          <p className="xcf__level mono">
            Level it names <b>{call.target.stated}</b>
          </p>
        ) : null}
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

      {/* The trade for this market, the app's own sentence (lib/called-it/acts). Nothing renders where nothing can run. */}
      <CallActs symbol={record.symbol} stance={call.stance} handle={record.handle} postId={call.postId} variant={sheet ? 'stack' : 'row'} className="xca--card" />

      <footer className="xcf__foot">
        {call.url ? (
          <a className="xcf__x" href={call.url} target="_blank" rel="noopener noreferrer nofollow" data-journey="called_card_x">
            Open the post on X
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
      <Link className="xca-share" href={callHref(record.handle, record.symbol, call.postId)} data-journey="called_card_share">
        <Share2 aria-hidden />
        Share this call
      </Link>
    </aside>
  )
}
