// One call on the landing (squad called-it, lane RECORD): the post as X
// served it, what the price did next, and the verdict in a word.
//
// The post's text is rendered as TEXT: React text nodes around a <mark> on the
// span the label quoted (lib/called-it/card-layout splitQuote). Nothing in it
// is ever treated as HTML and nothing in it becomes a link. The one link out
// is rebuilt here from the handle and the post's id (spec postUrl); a call
// with no address on X (the fixture's) shows none.
//
// The text sits inside <bdi>: a post may carry right-to-left or override
// characters, and they must not reorder the date, the verdict or the numbers
// beside it. A post a viewer pasted wears spec's mark (ADDED_MARK) and a
// dashed edge: it is shown, and it is never counted.
import { ADDED_MARK, JUDGE_DAYS, VERDICT_WORDS, fmtMove, moveLine, postUrl, type CalledCall } from '@/lib/called-it/spec'
import { fmtCallPrice, fmtCount, fmtUtcDateTime, splitQuote } from '@/lib/called-it/card-layout'

export interface CallCardProps {
  call: CalledCall
  /** The call's number on the chart: its place in the record, by date, from 1. */
  n: number
  handle: string
  unit?: 'usd' | 'level' | 'yield'
}

const STANCE_WORDS = { bull: 'Bull', bear: 'Bear' } as const

export default function CallCard({ call, n, handle, unit = 'usd' }: CallCardProps) {
  const parts = splitQuote(call.text, call.quote)
  const href = call.url ? postUrl(handle, call.postId) : null
  const horizons: [string, number | null][] = [
    ['7 days', call.d7],
    [`${JUDGE_DAYS} days`, call.d30],
    ['90 days', call.d90],
  ]
  return (
    <li className={`xrc-call is-${call.verdict}${call.picked ? ' is-picked' : ''}${call.origin === 'added' ? ' is-added' : ''}`} id={`call-${n}`} data-call={call.postId} data-verdict={call.verdict} data-origin={call.origin}>
      <span className="xrc-call__n" aria-label={`Call ${n}`}>
        {n}
      </span>
      <div className="xrc-call__body">
        <p className="xrc-call__result">
          <b className="xrc-call__verdict">{VERDICT_WORDS[call.verdict]}</b>
          <span className="xrc-call__judged">{moveLine(call)}</span>
        </p>
        <p className="xrc-call__meta">
          <span className={`xrc-call__stance is-${call.stance}`}>{STANCE_WORDS[call.stance]}</span>
          <time dateTime={new Date(call.postedAt).toISOString()}>{fmtUtcDateTime(call.postedAt)}</time>
          {call.origin === 'added' && <span className="xrc-call__added">{ADDED_MARK}</span>}
        </p>
        <p className="xrc-call__text">
          <bdi>
            {parts ? (
              <>
                {parts[0]}
                <mark className="xrc-call__quote">{parts[1]}</mark>
                {parts[2]}
              </>
            ) : (
              call.text
            )}
          </bdi>
        </p>
        <dl className="xrc-call__moves">
          <div>
            <dt>Price that day</dt>
            <dd>{fmtCallPrice(call.priceAt, unit)}</dd>
          </div>
          {horizons.map(([label, v]) => (
            <div key={label} className={label.startsWith(String(JUDGE_DAYS)) ? 'is-judged' : undefined}>
              <dt>{label}</dt>
              <dd>{v === null ? 'not yet' : fmtMove(v)}</dd>
            </div>
          ))}
          <div>
            <dt>So far</dt>
            <dd>{fmtMove(call.now)}</dd>
          </div>
        </dl>
        <p className="xrc-call__foot">
          {call.likes !== null && <span>{fmtCount(call.likes)} likes</span>}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" data-journey="called_view_on_x">
              View on X
            </a>
          )}
        </p>
      </div>
    </li>
  )
}
