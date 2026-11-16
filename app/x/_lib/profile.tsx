// THE ACCOUNT PAGE'S PIECES (squad called-gtm, lane PROFILE, 2026-11-16):
// what /x/<handle> is drawn from, below its header. Server components. The
// client pieces mounted here are other lanes' and are used exactly as they
// are: HandleDoor (the door), VerifyWithX (prove the handle), ShareRow (send
// a post this file's rules wrote), LandingLink (the landing's one link).
//
// Two readers. THE ACCOUNT'S OWNER, sent here by a message that says "you
// called this one": the page is their record, stated fairly, with what they
// can do about it at the foot (verify it, earn from it, have it taken down).
// A FOLLOWER: the tally at a glance, the calls that carry it, and one press
// onto the live chart.
//
// Every count, date, move and coverage line is the record's own (a
// BoardEntry, lib/called-it/gtm). Third-party words (a post, a display name)
// are text nodes, cleaned (card-layout cleanLine) and isolated (<bdi>).
// Every fee figure is read from lib/fees.
import Link from 'next/link'
import HandleDoor from '@/components/called/HandleDoor'
import ShareRow from '@/components/called/ShareRow'
import VerifyWithX from '@/components/called/VerifyWithX'
import LandingLink from '@/components/home/LandingLink'
import { CREATOR_FEE_SPLIT, LINK_FEE_PCT } from '@/lib/fees'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { callHref, type BoardEntry } from '@/lib/called-it/gtm'
import { DELETED_NOTE, chartHref, fmtDay, recordHref } from '@/lib/called-it/spec'
import { cleanLine, headlineParts } from '@/lib/called-it/card-layout'
import type { SharePost } from '@/lib/share-posts'
import { agoWords } from './plotted'
import { TAKEDOWN_EMAIL, creatorShareWords, rateSentence, sumTally, type ProfileCall } from './profile-rules'

const NUM_WORDS = /^(\d+) (.+)$/

// ── The one line across markets ─────────────────────────────────────────

/**
 * The summed tally as a row of figures: who, then every count the line
 * states. Read with the tags off it is the line to the letter (the colon,
 * the commas and the full stop are in the text, out of sight where the
 * columns already separate the counts). A count wears its verdict's colour
 * on a thin rule; the figures themselves are all one colour and one size.
 */
export function ProfileSum({ line, entries }: { line: string; entries: readonly BoardEntry[] }) {
  const parts = headlineParts(line)
  const rate = rateSentence(sumTally(entries))
  if (!parts) {
    return (
      <section className="xpf-sum" aria-label="The tally" data-xpf="sum">
        <p className="xpf-sum__who">{line}</p>
      </section>
    )
  }
  return (
    <section className="xpf-sum" aria-label="The tally across every market scanned" data-xpf="sum">
      <p className="xpf-sum__who">
        {parts.who.replace(/: $/, '')}
        <span className="xrc-sr">: </span>
      </p>
      <ul className="xpf-cells">
        {parts.counts.map((c, i) => {
          const m = NUM_WORDS.exec(c.text)
          return (
            <li key={c.kind} className={`xpf-cell is-${c.kind}`}>
              {m ? (
                <>
                  <b>{m[1]}</b> <span className="xpf-cell__w">{m[2]}</span>
                </>
              ) : (
                <span className="xpf-cell__w">{c.text}</span>
              )}
              <span className="xrc-sr">{i < parts.counts.length - 1 ? ', ' : parts.end}</span>
            </li>
          )
        })}
      </ul>
      {rate && (
        <p className="xpf-sum__rate" data-xpf="rate">
          {rate}
        </p>
      )}
    </section>
  )
}

// ── The calls that carry it ─────────────────────────────────────────────

function CallRow({ handle, item }: { handle: string; item: ProfileCall }) {
  const { symbol, call } = item
  // The words that carry the call; the whole post when the label kept no span.
  const words = cleanLine(call.quote || call.text, 180)
  return (
    <li className={`is-${call.verdict}`}>
      <Link href={callHref(handle, symbol, call.postId)} className="xpf-call" prefetch={false} data-journey={`called_profile_call_${call.verdict}`}>
        <span className="xpf-call__top">
          <span className="xpf-call__verdict">
            <i className="xpf-mark" aria-hidden />
            {call.verdictWords}
          </span>
          <span>{symbol}</span>
          <span>{call.stance}</span>
          <span>{fmtDay(call.postedAt)}</span>
        </span>
        <span className="xpf-call__quote">
          <bdi>{words}</bdi>
        </span>
        <span className="xpf-call__foot">
          <span className="xpf-call__move">{call.move}</span>
          <span className="xpf-call__go">See the call</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * The hits and the misses, one per market, the same size and the same row.
 * The hits are absent when no market has one (a miss is never dressed as a
 * highlight); the misses are absent when there are none.
 */
export function ProfileCalls({ handle, best, misses }: { handle: string; best: readonly ProfileCall[]; misses: readonly ProfileCall[] }) {
  if (!best.length && !misses.length) return null
  const groups = (best.length ? 1 : 0) + (misses.length ? 1 : 0)
  return (
    <div className="xpf-callgroups" data-groups={groups} data-xpf="calls">
      {best.length > 0 && (
        <section className="xpf-sec" aria-labelledby="xpf-best-title" data-xpf="best" data-count={best.length}>
          <h2 className="xpf-sec__title" id="xpf-best-title">
            Best calls
          </h2>
          <p className="xpf-sec__lede">The strongest call the scan found that held up, one per market.</p>
          <ul className="xpf-calls">
            {best.map((item) => (
              <CallRow key={item.call.postId} handle={handle} item={item} />
            ))}
          </ul>
        </section>
      )}
      {misses.length > 0 && (
        <section className="xpf-sec" aria-labelledby="xpf-misses-title" data-xpf="misses" data-count={misses.length}>
          <h2 className="xpf-sec__title" id="xpf-misses-title">
            Misses
          </h2>
          <p className="xpf-sec__lede">The strongest call the scan found that did not, one per market.</p>
          <ul className="xpf-calls">
            {misses.map((item) => (
              <CallRow key={item.call.postId} handle={handle} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ── Market by market ────────────────────────────────────────────────────

/** The market's daily closes over the scan's window, a dot on the day of each call. Numbers only: nothing here is a post's text. */
function Spark({ entry }: { entry: BoardEntry }) {
  if (!entry.line) {
    return (
      <div className="xpf-spark xpf-spark--none">
        <span>The {entry.symbol} chart did not answer just now.</span>
      </div>
    )
  }
  return (
    <div className="xpf-spark" role="img" aria-label={`${entry.symbol} daily closes over the scan's window, with a dot on the day of each call.`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d={entry.line} />
      </svg>
      {entry.dots.map((d) => (
        <i key={d.postId} className={`xpf-spark__dot is-${d.verdict}`} style={{ left: `${d.x}%`, top: `${d.y}%` }} />
      ))}
    </div>
  )
}

function MarketTile({ entry, now }: { entry: BoardEntry; now: number }) {
  const parts = headlineParts(entry.headline)
  const rate = rateSentence(entry.tally)
  return (
    <li className="xpf-mkt" data-symbol={entry.symbol}>
      <p className="xpf-mkt__head">
        <span className="xpf-mkt__sym">{entry.symbol}</span>
        <span className="xpf-mkt__when">scanned {agoWords(entry.scannedAt, now)}</span>
      </p>
      <Spark entry={entry} />
      {parts ? (
        <ul className="xpf-marks" aria-label={`The tally on ${entry.symbol}`}>
          {parts.counts.map((c, i) => (
            <li key={c.kind} className={`is-${c.kind}`}>
              {c.text}
              <span className="xrc-sr">{i < parts.counts.length - 1 ? ', ' : parts.end}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="xpf-mkt__note">{entry.headline}</p>
      )}
      {(rate || entry.coverage) && (
        <p className="xpf-mkt__note">
          {rate && <span data-xpf="mkt-rate">{rate} </span>}
          {entry.coverage && <span data-xpf="mkt-coverage">{entry.coverage}</span>}
        </p>
      )}
      <p className="xpf-mkt__acts">
        <Link href={chartHref(entry.handle, entry.symbol)} className="xpf-btn xpf-btn--main" prefetch={false} data-journey="called_profile_chart">
          Open on the chart
        </Link>
        <Link href={recordHref(entry.handle, entry.symbol)} className="xpf-link" prefetch={false} data-journey="called_profile_record">
          Full record
        </Link>
      </p>
    </li>
  )
}

export function ProfileMarkets({ entries, now }: { entries: readonly BoardEntry[]; now: number }) {
  return (
    <section className="xpf-sec" aria-labelledby="xpf-markets" data-xpf="markets" data-count={entries.length}>
      <h2 className="xpf-sec__title" id="xpf-markets">
        {entries.length === 1 ? 'The market' : 'Market by market'}
      </h2>
      <p className="xpf-sec__lede">Each call is a dot on the day it was posted. The chart opens with every one of them pinned.</p>
      <ul className="xpf-mkts" data-many={entries.length > 1 ? '' : undefined}>
        {entries.map((e) => (
          <MarketTile key={e.symbol} entry={e} now={now} />
        ))}
      </ul>
    </section>
  )
}

// ── For the account's owner ─────────────────────────────────────────────

/**
 * What the account's owner can do with the page: prove the handle, earn from
 * it, have it taken down. Quiet, at the foot. Verify with X is lane AUTH's
 * button, mounted with no path of this file's making (it reads its own page
 * when it is pressed). The fee is lib/fees' own figure, and the claim is
 * about a swap: a path that carries no fee pays its link's creator nothing.
 */
export function OwnerBlock({ handle, symbol, verified, listed = true }: { handle: string; symbol?: string; verified: boolean; listed?: boolean }) {
  const share = creatorShareWords(CREATOR_FEE_SPLIT)
  return (
    <section className="xpf-sec xpf-owner" aria-labelledby="xpf-owner" data-xpf="owner">
      <h2 className="xpf-sec__title" id="xpf-owner">
        Is this you?
      </h2>
      <p className="xpf-sec__lede">
        {listed
          ? `This page is drawn from @${handle}\u2019s public posts. If the account is yours, three things are yours to do.`
          : `If @${handle} is your account, verify it: a market a scan has found calls on is then listed here, whatever the follower count.`}
      </p>
      <div className="xpf-owner__grid">
        <div className="xpf-owner__item" data-xpf="owner-verify">
          <h3>Verify it</h3>
          <p>
            {verified ? 'This page already says Verified: the account signed in with X. ' : listed ? 'Sign in with X and this page says Verified. ' : 'Sign in with X and your plots say Verified. '}
            Signed in, Share writes your post in the first person. It proves the handle and nothing else: no wallet, no posting.
          </p>
          <VerifyWithX symbol={symbol} />
        </div>
        <div className="xpf-owner__item" data-xpf="owner-earn">
          <h3>Earn from it</h3>
          <p>
            Mint a short link from one sentence and post it. A follower who opens it signs with their own wallet. On a swap through your link, {share} of Pantessa&rsquo;s fee is yours: the link fee is {LINK_FEE_PCT} on a Uniswap or CoW swap. A path with no fee, like staking or lending, pays nothing.
          </p>
          <p className="xpf-owner__links">
            <LandingLink href={LINKS_STUDIO_HREF} className="xpf-link" prefetch={false} data-journey="called_profile_mint">
              Mint a link
            </LandingLink>
            <Link href="/docs/creator-earnings" className="xpf-link" prefetch={false} data-journey="called_profile_earn_docs">
              How creators get paid
            </Link>
          </p>
        </div>
        <div className="xpf-owner__item" data-xpf="owner-remove">
          <h3>Take it down</h3>
          <p>
            {listed ? 'Want this page taken down?' : 'Want a record of your posts taken down?'} Write to{' '}
            <a href={`mailto:${TAKEDOWN_EMAIL}?subject=${encodeURIComponent(`Take down /x/${handle}`)}`} className="xpf-link" data-journey="called_profile_takedown">
              {TAKEDOWN_EMAIL}
            </a>
            . {DELETED_NOTE}
          </p>
        </div>
      </div>
    </section>
  )
}

// ── Beside the record: share it, plot somebody else ─────────────────────

/** The account page's share row. The post is written by profile-rules profilePost and handed in whole; lane CALL's row only sends it. */
export function ProfileShare({ handle, post, mine }: { handle: string; post: SharePost; mine: boolean }) {
  return (
    <section className="xpf-aside xpf-share" id="share" aria-labelledby="xpf-share" data-xpf="share" data-mine={mine ? 'yes' : 'no'}>
      <h2 className="xpf-aside__title" id="xpf-share">
        {mine ? 'Share your record' : 'Share this record'}
      </h2>
      <p className="xpf-aside__lede">The post states the whole tally, hits and misses, and links back here.</p>
      <ShareRow post={post} imageHref={`/api/og/called?handle=${handle}`} fileName={`called-it-${handle}.png`} />
    </section>
  )
}

/** The door, without a second Verify button: the owner's block above carries the one this page needs. */
export function PlotDoor({ heading = 'Plot anyone', initialHandle }: { heading?: string; initialHandle?: string }) {
  return (
    <section className="xpf-aside" id="plot" aria-label="Plot a handle" data-xpf="door">
      <h2 className="xpf-aside__title">{heading}</h2>
      <p className="xpf-aside__lede">Type any X handle. Every post where the account took a side is pinned to the day it was posted and judged the same way.</p>
      <div className="xpf-aside__form">
        <HandleDoor variant="page" initialHandle={initialHandle} />
      </div>
    </section>
  )
}
