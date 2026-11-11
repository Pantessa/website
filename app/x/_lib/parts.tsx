// The pieces the three /x pages share (squad called-it, lane RECORD): the
// avatar, the door block and "How this is judged". Server components; the two
// client pieces inside them (lane CHART's HandleDoor, lane AUTH's VerifyWithX)
// are mounted as they are.
import Link from 'next/link'
import HandleDoor from '@/components/called/HandleDoor'
import VerifyWithX from '@/components/called/VerifyWithX'
import { DEAD_BAND, JUDGE_DAYS, METHOD_LINE, SCAN_WINDOW_DAYS, VERDICT_WORDS, type CalledSide } from '@/lib/called-it/spec'
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

/** The feature's name, linking to its front door. */
export function Eyebrow({ children, jump }: { children?: React.ReactNode; jump?: boolean }) {
  return (
    <p className="xrc-eyebrow">
      <Link href="/x" className="xrc-eyebrow__name" data-journey="called_home">
        Called it
      </Link>
      {children}
      {jump && (
        <a href="#plot" className="xrc-eyebrow__jump" data-journey="called_jump_plot">
          Plot a handle
        </a>
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
        <div className="xrc-door__verify">
          <VerifyWithX />
        </div>
      </div>
    </section>
  )
}

const pctWords = `${Math.round(DEAD_BAND * 100)}%`

export function MethodBlock() {
  return (
    <section className="xrc-method" aria-label="How this is judged">
      <h2 className="xrc-method__title">How this is judged</h2>
      <p>{METHOD_LINE}</p>
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
        A scan reads the last {SCAN_WINDOW_DAYS} days. Every call found is counted, whichever ones are pinned. A post X no longer serves leaves the record.
      </p>
      <p className="xrc-method__fine">Not investment advice. Posts belong to their authors.</p>
    </section>
  )
}
