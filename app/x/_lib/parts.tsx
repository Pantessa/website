// The pieces the three /x pages share (squad called-it, lane RECORD): the
// avatar, the door block, the picture of what a plot is, and "How this is
// judged". Server components; the two client pieces inside them (lane CHART's
// HandleDoor, lane AUTH's VerifyWithX) are mounted as they are.
import Link from 'next/link'
import HandleDoor from '@/components/called/HandleDoor'
import VerifyWithX from '@/components/called/VerifyWithX'
import { ADDED_MARK, DEAD_BAND, DELETED_NOTE, JUDGE_DAYS, LABEL_CAVEAT, METHOD_LINE, SCAN_WINDOW_DAYS, VERDICT_WORDS, type CalledSide, type CallVerdict } from '@/lib/called-it/spec'
import { initialOf } from '@/lib/called-it/card-layout'

/** The account's picture when the server could fetch it, its initial otherwise. Decorative: the name is printed beside it. */
export function Avatar({ uri, name, handle, size = 'md' }: { uri: string | null; name?: string | null; handle: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`xrc-avatar xrc-avatar--${size}`} aria-hidden>
      {uri ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI the server fetched; never a remote address in the visitor's browser
        <img src={uri} alt="" />
      ) : (
        initialOf(name, handle)
      )}
    </span>
  )
}

/**
 * The feature's name, linking to its front door, and the jumps a phone needs
 * on its first screen: the door ("Plot a handle") and, on a record with calls,
 * the share row. From a desk both stand beside the record and the jumps hide.
 */
export function Eyebrow({ children, jump, share }: { children?: React.ReactNode; jump?: boolean; share?: boolean }) {
  return (
    <p className="xrc-eyebrow">
      <Link href="/x" className="xrc-eyebrow__name" data-journey="called_home">
        Called it
      </Link>
      {children}
      {(jump || share) && (
        <span className="xrc-eyebrow__jumps">
          {share && (
            <a href="#share" className="xrc-eyebrow__jump" data-journey="called_jump_share">
              Share
            </a>
          )}
          {jump && (
            <a href="#plot" className="xrc-eyebrow__jump" data-journey="called_jump_plot">
              Plot a handle
            </a>
          )}
        </span>
      )}
    </p>
  )
}

/**
 * The next move: plot somebody else, or plot yourself. `owner` is how the
 * second half is worded: "Is this you?" on somebody's record that is not
 * verified, "Plot yourself" everywhere else.
 */
export function DoorBlock({ symbol, side, initialHandle, heading = 'Plot anyone', lede, owner = 'yourself', level = 2 }: { symbol?: string; side?: CalledSide; initialHandle?: string; heading?: string; lede?: string; owner?: 'this' | 'yourself'; level?: 1 | 2 }) {
  const H = level === 1 ? 'h1' : 'h2'
  return (
    <section className="xrc-door" id="plot" aria-label="Plot a handle">
      <H className={level === 1 ? 'xrc-door__title xrc-door__title--page' : 'xrc-door__title'}>{heading}</H>
      <p className="xrc-door__lede">{lede ?? `Type any X handle. Every post where the account took a side${symbol ? ` on ${symbol}` : ''} is pinned to the day it was posted and judged the same way.`}</p>
      <div className="xrc-door__form">
        <HandleDoor variant="page" symbol={symbol} side={side} initialHandle={initialHandle} />
      </div>
      <div className="xrc-door__you">
        <h3 className="xrc-door__sub">{owner === 'this' ? 'Is this you?' : 'Plot yourself'}</h3>
        <p className="xrc-door__lede">Sign in with X and your own plots say Verified. It proves the handle and nothing else: no wallet, no posting.</p>
        {/* No `next`: the button reads this page's own path when it is pressed (never a path composed here). */}
        <VerifyWithX symbol={symbol} />
      </div>
    </section>
  )
}

/**
 * What a plot is, drawn: a price line that is nobody's price, three posts
 * that are nobody's posts (grey bars where words would be), each tied to its
 * day and stamped with a verdict. An illustration, labelled as one, so an
 * empty list never leaves the door page bare.
 */
export function Schematic() {
  const pts: [number, number][] = []
  for (let i = 0; i <= 64; i++) {
    const x = 16 + (608 * i) / 64
    const y = 168 + Math.sin(i / 6.6) * 34 + Math.sin(i / 2.4) * 9 - (i - 32) * 0.7
    pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10])
  }
  const line = `M${pts.map((p) => p.join(' ')).join('L')}`
  // Words only on the stamps: an illustration carries no figure anyone could take for a result.
  const ghosts: { i: number; top: boolean; verdict: CallVerdict }[] = [
    { i: 11, top: true, verdict: 'right' },
    { i: 33, top: false, verdict: 'wrong' },
    { i: 54, top: true, verdict: 'open' },
  ]
  return (
    <figure className="xrc-schema">
      <svg viewBox="0 0 640 336" role="img" aria-label="An illustration: three posts tied to the days they were posted on a price line, each stamped called it, missed or too early to say.">
        <path d={line} className="xrc-schema__line" />
        {ghosts.map((g) => {
          const [x, y] = pts[g.i]
          const w = 188
          const h = 84
          const cx = Math.min(Math.max(x - w / 2, 8), 632 - w)
          const cy = g.top ? 10 : 336 - 10 - h
          const stampY = g.top ? cy + h - 24 : cy
          const bodyY = g.top ? cy : cy + 24
          return (
            <g key={g.i} className={`is-${g.verdict}`}>
              <line x1={x} y1={g.top ? cy + h : cy} x2={x} y2={y} className="xrc-schema__lead" />
              <rect x={cx} y={cy} width={w} height={h} rx="10" className="xrc-schema__card" />
              <circle cx={cx + 20} cy={bodyY + 18} r="8" className="xrc-schema__bar" />
              <rect x={cx + 36} y={bodyY + 13} width="64" height="9" rx="4.5" className="xrc-schema__bar" />
              <rect x={cx + 12} y={bodyY + 34} width={w - 40} height="8" rx="4" className="xrc-schema__bar" />
              <rect x={cx + 12} y={bodyY + 47} width={w - 86} height="8" rx="4" className="xrc-schema__bar" />
              <rect x={cx} y={stampY} width={w} height="24" className="xrc-schema__stamp" />
              <text x={cx + 12} y={stampY + 16} className="xrc-schema__word">
                {VERDICT_WORDS[g.verdict]}
              </text>
              <circle cx={x} cy={y} r="5.5" className="xrc-schema__dot" />
            </g>
          )
        })}
      </svg>
      <figcaption>An illustration, not anyone's record. A real plot uses the account's own posts and the chart's own closes.</figcaption>
    </figure>
  )
}

const pctWords = `${Math.round(DEAD_BAND * 100)}%`

export function MethodBlock() {
  return (
    <section className="xrc-method" aria-label="How this is judged">
      <h2 className="xrc-method__title">How this is judged</h2>
      <p>{METHOD_LINE}</p>
      <p className="xrc-method__caveat">{LABEL_CAVEAT}</p>
      <dl className="xrc-method__rules">
        <div className="is-right">
          <dt>{VERDICT_WORDS.right}</dt>
          <dd>
            The close {JUDGE_DAYS} days later moved {pctWords} or more the way the post said.
          </dd>
        </div>
        <div className="is-wrong">
          <dt>{VERDICT_WORDS.wrong}</dt>
          <dd>It moved {pctWords} or more the other way.</dd>
        </div>
        <div className="is-flat">
          <dt>{VERDICT_WORDS.flat}</dt>
          <dd>It moved less than {pctWords} either way.</dd>
        </div>
        <div className="is-open">
          <dt>{VERDICT_WORDS.open}</dt>
          <dd>The post is under {JUDGE_DAYS} days old. The move so far is shown and nothing is judged yet.</dd>
        </div>
      </dl>
      <p>
        A scan looks back up to {SCAN_WINDOW_DAYS} days and can stop sooner; each record says how far it read. Every call the scan found is counted, whichever ones are pinned. A post marked "{ADDED_MARK}" is shown and never counted. {DELETED_NOTE}
      </p>
      <p className="xrc-method__fine">Not investment advice. Posts belong to their authors.</p>
    </section>
  )
}
