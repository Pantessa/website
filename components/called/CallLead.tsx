// ONE CALL LEADS (squad called-gtm, lane CALL, 2026-11-16).
//
// CallLead is the first screen of /x/<handle>/<SYM>?call=<postId>: the link an
// account is sent about ONE of its calls, opened on a phone inside X's own
// browser. In reading order: the verdict (spec's word, one colour, upright; a
// thin rule and a dot carry the verdict's colour), who said it and the day,
// the post in full with the labeled span marked, the price that day and the
// record's own move words, then, on the same screen, the record's WHOLE tally
// in its own headline's words and its standing line, and one button: the live
// chart with this call open. The trade buttons (lane TRADE's CallActs) sit
// under it.
//
// BestCall is the same call as a highlight on the plain record page: the hit
// the record is shown by (gtm bestCallOf), linking to its own address. A
// record with no hit shows none.
//
// HONESTY. Every number here is the record's. "called it" is printed only for
// a call whose verdict is right (the word is spec's VERDICT_WORDS, whatever
// the verdict). A post is X's text: a React text node inside <bdi>, never
// HTML; the one link out is rebuilt from the handle and the post's id. A post
// a viewer pasted wears spec's mark and is never called part of the tally.
import Link from 'next/link'
import { Fragment, type CSSProperties } from 'react'
import CallActs from '@/components/called/CallActs'
import { ADDED_MARK, VERDICT_WORDS, judgedLine, postUrl, sinceLine, type CalledCall, type CalledRecord } from '@/lib/called-it/spec'
import { callHref, callPlaceOf, chartCallHref } from '@/lib/called-it/gtm'
import { cleanLine, fmtCallPrice, fmtCount, fmtUtcDate, fmtUtcDateTime, headlineParts, initialOf, linePaths, plotScale, sentenceCase, splitQuote, unreadShare, type ClosePoint } from '@/lib/called-it/card-layout'

type Unit = 'usd' | 'level' | 'yield'
/** A post longer than this is folded in the lead: the call's own words lead, the whole post opens in place. */
export const FOLD_AT = 320
/** With no labeled span to lead with, this much of a folded post is shown. */
const FOLD_KEEP = 220
const STANCE_WORDS = { bull: 'Bull', bear: 'Bear' } as const
const pct = (f: number) => `${Math.round(f * 10000) / 100}%`

/** The post's words as text around a <mark> on the labeled span. Never HTML. */
function PostText({ call }: { call: CalledCall }) {
  const parts = splitQuote(call.text, call.quote)
  return (
    <bdi>
      {parts ? (
        <>
          {parts[0]}
          <mark className="xcl-quote">{parts[1]}</mark>
          {parts[2]}
        </>
      ) : (
        call.text
      )}
    </bdi>
  )
}

/** The record's own headline, each count behind a dot in its verdict's colour. Read with the tags off it is the headline to the letter. */
function RecordTally({ record }: { record: CalledRecord }) {
  const parts = headlineParts(record.words.headline)
  if (!parts) return <>{record.words.headline}</>
  return (
    <>
      <span className="xcl-record__who">{parts.who}</span>
      {parts.counts.map((c, i) => (
        <Fragment key={c.kind}>
          <span className={`xcl-count is-${c.kind}`}>{c.text}</span>
          <span className="xcl-sr">{i < parts.counts.length - 1 ? ', ' : parts.end}</span>
        </Fragment>
      ))}
    </>
  )
}

/** The daily closes with THIS call's day marked; every other call of the record is a small dot in its verdict's colour. No script, nothing measured. */
function CallSpark({ record, call, closes }: { record: CalledRecord; call: CalledCall; closes: readonly ClosePoint[] }) {
  const scale = plotScale(closes, record.calls.map((c) => c.priceAt))
  if (!scale) return null
  const { line } = linePaths(closes, scale, { x: 0, y: 0, w: 1000, h: 200 })
  const unread = unreadShare(scale, record.coverage?.from)
  const x = scale.x(call.barTime)
  return (
    <div className="xcl-spark" aria-hidden data-spark>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" focusable="false">
        <path d={line} className="xcl-spark__line" vectorEffect="non-scaling-stroke" />
      </svg>
      {unread > 0 && <i className="xcl-spark__unread" style={{ width: pct(unread) }} />}
      {record.calls
        .filter((c) => c.postId !== call.postId)
        .map((c) => (
          <i key={c.postId} className={`xcl-spark__dot is-${c.verdict}${c.origin === 'added' ? ' is-added' : ''}`} style={{ left: pct(scale.x(c.barTime)), top: pct(scale.y(c.priceAt)) }} />
        ))}
      <i className="xcl-spark__day" style={{ left: pct(x) }} />
      <i className={`xcl-spark__dot xcl-spark__dot--this${call.origin === 'added' ? ' is-added' : ''}`} style={{ left: pct(x), top: pct(scale.y(call.priceAt)) }} />
      <span className="xcl-spark__tag" style={{ left: pct(x) } as CSSProperties} data-edge={x > 0.7 ? 'end' : x < 0.3 ? 'start' : undefined}>
        {fmtUtcDate(call.postedAt)}
      </span>
    </div>
  )
}

export interface CallLeadProps {
  record: CalledRecord
  call: CalledCall
  /** The account's avatar as a data URI the server fetched, or null. */
  avatar: string | null
  unit?: Unit
  closes: readonly ClosePoint[]
  /** The share jump is offered when the page has a share row. */
  share?: boolean
}

export default function CallLead({ record, call, avatar, unit = 'usd', closes, share = true }: CallLeadProps) {
  const handle = record.handle
  const symbol = record.symbol
  const added = call.origin === 'added'
  const name = record.profile.name ? cleanLine(record.profile.name, 60) || null : null
  const named = !!name && name.toLowerCase() !== handle && name.toLowerCase() !== `@${handle}`
  const followers = record.profile.followers != null ? `${fmtCount(record.profile.followers)} followers` : null
  const post = call.url ? postUrl(handle, call.postId) : null
  const since = sinceLine(call)
  const day = fmtUtcDate(call.postedAt)
  // A long post is set a step smaller, so the tally and the next press stay on a phone's first screen.
  const length = Array.from(call.text).length
  // A very long post (a thread-sized one) is FOLDED (coordinator, round 2): the lead shows the words that carry the
  // call (the labeled span, between ellipses where the post goes on), and the whole post opens in place with no
  // script. Unfolded it pushed the tally and the next press several screens down a phone.
  const folded = length > FOLD_AT
  const parts = folded ? splitQuote(call.text, call.quote) : null
  const leadText = !folded ? null : parts ? parts[1] : `${Array.from(call.text).slice(0, FOLD_KEEP).join('').trimEnd()}`
  const leadLength = leadText === null ? length : Array.from(leadText).length
  const size = leadLength > 200 ? 'long' : leadLength > 110 ? 'mid' : 'short'
  // Its place among the calls the SCAN found (review F2): M is the tally's total, never a count with pasted posts in it.
  const place = callPlaceOf(record.calls, call.postId)
  return (
    <header className={`xcl is-${call.verdict}`} data-xcl="lead" data-call={call.postId} data-verdict={call.verdict} data-origin={call.origin}>
      <p className="xcl-kicker">
        <span className="xcl-kicker__ctx">
          {symbol} <span aria-hidden>&middot;</span> {STANCE_WORDS[call.stance]} {added ? 'post' : 'call'} <span aria-hidden>&middot;</span>{' '}
          <time dateTime={new Date(call.postedAt).toISOString()} title={fmtUtcDateTime(call.postedAt)}>
            {day}
          </time>
        </span>
        {share && (
          <a href="#share" className="xcl-kicker__jump" data-journey="called_call_jump_share">
            Share
          </a>
        )}
      </p>

      <h1 className="xcl-verdict">
        <i className={`xcl-verdict__mark${added ? ' is-added' : ''}`} aria-hidden />
        <span className="xcl-verdict__word">{sentenceCase(VERDICT_WORDS[call.verdict])}.</span>
        <span className="xcl-sr">
          {' '}
          @{handle} on {symbol}, {day}
        </span>
      </h1>

      <Link href={`/x/${handle}`} className="xcl-who" prefetch={false} data-journey="called_call_handle" aria-label={`@${handle}: every market plotted`}>
        <span className="xcl-who__face" aria-hidden>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URI the server fetched; never a remote address in the visitor's browser
            <img src={avatar} alt="" />
          ) : (
            initialOf(name, handle)
          )}
        </span>
        <span className="xcl-who__id">
          <span className="xcl-who__name">{named ? <bdi>{name}</bdi> : `@${handle}`}</span>
          {(named || followers) && <span className="xcl-who__handle">{[named ? `@${handle}` : null, followers].filter(Boolean).join(' · ')}</span>}
        </span>
      </Link>

      <blockquote className="xcl-post" data-size={size} data-folded={folded ? 'yes' : undefined} cite={post ?? undefined}>
        {folded && leadText !== null ? (
          <>
            <p>
              <bdi>
                {parts ? (
                  <>
                    {parts[0].trim() ? '\u2026 ' : ''}
                    <mark className="xcl-quote">{leadText}</mark>
                    {parts[2].trim() ? ' \u2026' : ''}
                  </>
                ) : (
                  `${leadText}\u2026`
                )}
              </bdi>
            </p>
            <details className="xcl-whole">
              <summary data-journey="called_call_whole_post">Read the whole post</summary>
              <p>
                <PostText call={call} />
              </p>
            </details>
          </>
        ) : (
          <p>
            <PostText call={call} />
          </p>
        )}
      </blockquote>

      <p className="xcl-meta">
        {call.likes !== null && <span>{fmtCount(call.likes)} likes</span>}
        {added && <span className="xcl-meta__added">{ADDED_MARK}</span>}
        {post && (
          <a href={post} target="_blank" rel="noopener noreferrer nofollow" data-journey="called_call_view_on_x">
            Open the post on X
          </a>
        )}
      </p>

      <dl className="xcl-facts">
        <div>
          <dt>{symbol} that day</dt>
          <dd>{fmtCallPrice(call.priceAt, unit)}</dd>
        </div>
        <div className="xcl-facts__move">
          <dt>{call.verdict === 'open' ? 'Since the post' : 'What it did next'}</dt>
          <dd>
            <b>{judgedLine(call)}</b>
            {since && (
              <>
                <span className="xcl-sr">, </span>
                <span>{since}</span>
              </>
            )}
          </dd>
        </div>
      </dl>

      <CallSpark record={record} call={call} closes={closes} />

      <section className="xcl-record" aria-label="The full record" data-record>
        <h2 className="xcl-record__label">
          <span>The full record</span>
          {place && (
            <span className="xcl-record__n">
              This is call {place.n} of {place.of}
            </span>
          )}
        </h2>
        <p className="xcl-record__tally" data-record-headline>
          <RecordTally record={record} />
        </p>
        <p className={`xcl-record__standing${record.verified ? ' is-verified' : ''}`} data-standing>
          {record.words.standing}
        </p>
      </section>

      <div className="xcl-go">
        <Link href={chartCallHref(handle, symbol, call.postId)} className="xcl-btn" prefetch={false} data-journey="called_call_open_chart">
          Open the live {symbol} chart on this call
        </Link>
        <CallActs symbol={symbol} stance={call.stance} handle={handle} postId={call.postId} variant="stack" />
        {/* The account itself lands here from a message: say what signing in changes, and where. */}
        {!record.verified && (
          <p className="xcl-you">
            Is this you?{' '}
            <a href="#plot" data-journey="called_call_jump_verify">
              Sign in with X
            </a>{' '}
            and this record says Verified.
          </p>
        )}
      </div>
    </header>
  )
}

export interface BestCallProps {
  record: CalledRecord
  /** gtm bestCallOf over the record's scanned calls: a hit, or the caller renders nothing. */
  call: CalledCall
  unit?: Unit
}

/** The record's highlight on its own page: the hit it is shown by, as one link to that call's address. */
export function BestCall({ record, call, unit = 'usd' }: BestCallProps) {
  const scanned = record.calls.filter((c) => c.origin === 'scan').length
  return (
    <Link href={callHref(record.handle, record.symbol, call.postId)} className={`xcl-best is-${call.verdict}`} prefetch={false} data-xcl="best" data-call={call.postId} data-journey="called_best_call" aria-label={`${sentenceCase(VERDICT_WORDS[call.verdict])}, ${fmtUtcDate(call.postedAt)}: open this call`}>
      <span className="xcl-best__kicker">
        <i className="xcl-best__mark" aria-hidden />
        <b>{sentenceCase(VERDICT_WORDS[call.verdict])}</b>
        <time dateTime={new Date(call.postedAt).toISOString()}>{fmtUtcDate(call.postedAt)}</time>
        <span className="xcl-best__of">
          one of {scanned} {scanned === 1 ? 'call' : 'calls'}
        </span>
      </span>
      <span className="xcl-best__text">
        <PostText call={call} />
      </span>
      <span className="xcl-best__foot">
        <span className="xcl-best__move">
          {fmtCallPrice(call.priceAt, unit)} that day, then {judgedLine(call)}
        </span>
        <span className="xcl-best__go">Open this call</span>
      </span>
    </Link>
  )
}
