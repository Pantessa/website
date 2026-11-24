// One call on the landing (squad called-it, lane RECORD; redrawn by squad
// mobile-sleek, 2026-11-24): the verdict as one of the brand's tiles and a
// word, the post as X served it, what the price did next as one tight row of
// numbers, and the one link out.
//
// The post's text is rendered as TEXT: React text nodes around a <mark> on the
// span the label quoted (lib/called-it/card-layout splitQuote). Nothing in it
// is ever treated as HTML and nothing in it becomes a link. The one link out
// is rebuilt here from the handle and the post's id (spec postUrl); a call
// with no address on X (the fixture's) shows none.
//
// A LONG POST IS CLAMPED, NEVER REWRITTEN. The whole text is in the page once;
// a long one shows its first lines and a "More" that opens the rest in place
// with no script (a checkbox ahead of the paragraph, its label after it).
// When the words the label quoted sit past those first lines, the clamp
// starts AT them: the head of the post steps out of sight behind a marked
// ellipsis (the sheet draws the mark; the head's words stay in the page, in
// place, and "More" puts them back). No word is moved, cut or rewritten.
//
// The text sits inside <bdi>: a post may carry right-to-left or override
// characters, and they must not reorder the date, the verdict or the numbers
// beside it. A post a viewer pasted wears spec's mark (ADDED_MARK) and a
// dashed edge: it is shown, and it is never counted.
import { ADDED_MARK, JUDGE_DAYS, VERDICT_WORDS, fmtMove, moveLine, postUrl, type CalledCall } from '@/lib/called-it/spec'
import { fmtCallPrice, fmtCount, fmtUtcDateTime, sentenceCase, splitQuote } from '@/lib/called-it/card-layout'
import VerdictTile from '@/components/sleek/VerdictTile'
import { NumberTile } from '@/components/called/RecordChart'

export interface CallCardProps {
  call: CalledCall
  /** The call's number on the chart: its place in the record, by date, from 1. */
  n: number
  handle: string
  unit?: 'usd' | 'level' | 'yield'
  /** This is the call the page leads with (a call's own address): the card says so, and nothing else about it changes. */
  lead?: boolean
}

const STANCE_WORDS = { bull: 'Bull', bear: 'Bear' } as const
/** A post longer than this (or with more lines than CLAMP_LINES) is clamped behind a "More". */
const CLAMP_CHARS = 190
const CLAMP_LINES = 4
/** A head (the words before the quoted span) longer than this, or with this many line breaks, would push the quoted words past the clamp. */
const HEAD_CHARS = 110
const HEAD_BREAKS = 2

export default function CallCard({ call, n, handle, unit = 'usd', lead = false }: CallCardProps) {
  const parts = splitQuote(call.text, call.quote)
  const href = call.url ? postUrl(handle, call.postId) : null
  const horizons: [string, number | null][] = [
    ['7 days', call.d7],
    [`${JUDGE_DAYS} days`, call.d30],
    ['90 days', call.d90],
  ]
  // The quoted span would fall under the fold: the clamp starts at it, behind a marked ellipsis.
  const cutHead = !!parts && (Array.from(parts[0]).length > HEAD_CHARS || parts[0].split('\n').length > HEAD_BREAKS)
  const long = cutHead || Array.from(call.text).length > CLAMP_CHARS || call.text.split('\n').length > CLAMP_LINES
  const moreId = `more-${call.postId}`
  return (
    <li className={`xrc-call sk-card is-${call.verdict}${call.picked ? ' is-picked' : ''}${call.origin === 'added' ? ' is-added' : ''}${lead ? ' xcl-leadcard' : ''}`} id={`call-${n}`} data-call={call.postId} data-verdict={call.verdict} data-origin={call.origin} data-lead={lead ? 'yes' : undefined}>
      <div className="xrc-call__body">
        <div className="xrc-call__head">
          <VerdictTile verdict={call.verdict} size={32} className="xrc-call__tile" />
          <p className="xrc-call__result">
            <b className="xrc-call__verdict">{sentenceCase(VERDICT_WORDS[call.verdict])}</b>
            <span className="xrc-call__judged">{moveLine(call)}</span>
          </p>
          {/* A pinned call wears the tile it wears on the chart; the rest wear their number plainly. */}
          <span className="xrc-call__n" aria-label={`Call ${n}`}>
            {call.picked ? <NumberTile n={n} /> : `#${n}`}
          </span>
        </div>
        <p className="xrc-call__meta">
          <span className={`xrc-call__stance is-${call.stance}`}>{STANCE_WORDS[call.stance]}</span>
          <time dateTime={new Date(call.postedAt).toISOString()}>{fmtUtcDateTime(call.postedAt)}</time>
          {call.origin === 'added' && <span className="xrc-call__added">{ADDED_MARK}</span>}
          {lead && <span className="xcl-leadcard__mark">the call this link is about</span>}
        </p>
        {long && <input type="checkbox" id={moreId} className="xrc-call__toggle" aria-label="Show the whole post" data-journey="called_card_more" />}
        <p className="xrc-call__text">
          <bdi>
            {parts ? (
              <>
                {cutHead ? (
                  <span className="xrc-call__cut">
                    <span>{parts[0]}</span>
                  </span>
                ) : (
                  parts[0]
                )}
                <mark className="xrc-call__quote">{parts[1]}</mark>
                {parts[2]}
              </>
            ) : (
              call.text
            )}
          </bdi>
        </p>
        {long && (
          <label htmlFor={moreId} className="xrc-call__more" aria-hidden>
            <span className="xrc-call__more-open">More</span>
            <span className="xrc-call__more-shut">Less</span>
          </label>
        )}
        <dl className="xrc-call__moves">
          <div>
            <dt>Price that day</dt>
            <dd>{fmtCallPrice(call.priceAt, unit)}</dd>
          </div>
          {call.target && (
            <div className="is-judged" data-target={call.target.outcome}>
              <dt>Target</dt>
              <dd>
                {call.target.stated}
                {call.target.unit !== 'price' && ` (${fmtCallPrice(call.target.price, unit)})`}
              </dd>
            </div>
          )}
          {horizons.map(([label, v]) => (
            <div key={label} className={!call.target && label.startsWith(String(JUDGE_DAYS)) ? 'is-judged' : undefined}>
              <dt>{label}</dt>
              <dd>{v === null ? 'not yet' : fmtMove(v)}</dd>
            </div>
          ))}
          <div>
            <dt>Since</dt>
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
