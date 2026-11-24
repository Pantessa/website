'use client'

// CALLED IT on the symbol page (squad called-it, lane CHART), in two seats,
// both shown only while a handle is plotted:
//
//   CalledHead   the band ABOVE the chart, joined to its card: who the account
//                is (picture, name, followers, standing), the tally as chips,
//                what the scans read, and the plot's controls (All / Bull /
//                Bear, Share, Clear). It is the record page's header, on the
//                chart (Nate, 2026-11-16: the /x tiles open the chart directly).
//   CallsPanel   the strip UNDER the chart: every call with its whole text, and
//                the doors that act on one (add a post, fit, pin).
//
// Words: the headline, the standing line, the verdict words and the move line
// all come from lib/called-it/spec or from the server's record. Nothing here
// rewords them, and a post's text is rendered as text.
//
// States, each with words and somewhere to go: loading · unscanned (what a
// scan does, the button, the allowance) · scanning (the scan's own note) ·
// ready · refused · failed · no scans on this server (one pasted post still
// works).
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BadgeCheck, ExternalLink, Heart, Maximize, Pin, Share2, X } from 'lucide-react'
import ScoreBar from '@/components/sleek/ScoreBar'
import VerdictTile from '@/components/sleek/VerdictTile'
import { fmtPrice } from '@/components/CandleChart'
import { SIDES } from '@/components/called/HandleDoor'
import { appScrollTop, scrollAppTo } from '@/lib/app-scroller'
import { chartPairFor, chartUnitOf } from '@/lib/charts'
import { ADDED_MARK, DEAD_BAND, DELETED_NOTE, FREE_SCANS_PER_DAY, JUDGE_DAYS, LABEL_CAVEAT, SCAN_ANSWER_PRICE, SCAN_POST_CAP, SCAN_WINDOW_DAYS, VERDICT_WORDS, moveLine, recordHref, type CalledCall, type CalledRecord, type CalledSide } from '@/lib/called-it/spec'
import { calledImageHref, fmtCount, headlineParts } from '@/lib/called-it/card-layout'
import { plotStatus, safeNextHref, sideCounts, useCalled, useCalledAddress, useXViewer, viewerOwns } from '@/lib/called-it/use-record'
import { calledPost, myCalledPost, postHref } from '@/lib/share-posts'
import { VERDICT_GLYPH, cleanPostText, pinDate } from '@/lib/tv/called-pins'
import './called-chart.css'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** An avatar is shown only from X's own image hosts (lane SOURCE keeps no other); anything else is an initial. */
export function avatarOf(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    // X's own size suffix: the 48px file is soft in a 56px seat on a 2x screen.
    return u.protocol === 'https:' && (u.hostname === 'pbs.twimg.com' || u.hostname === 'abs.twimg.com') ? u.toString().replace(/_normal(\.[a-z]+)$/i, '_200x200$1') : null
  } catch {
    return null
  }
}

/**
 * The post's text with the span that carries the call marked. Text nodes
 * only, inside a `<bdi>` (a post can hold a right-to-left run; it must not
 * reorder the row around it). Both sides are matched with their whitespace
 * collapsed, because the stored quote is whitespace-normalized.
 */
export function PostText({ call }: { call: Pick<CalledCall, 'text' | 'quote'> }) {
  const text = cleanPostText(call.text)
  const quote = cleanPostText(call.quote)
  const at = quote ? text.indexOf(quote) : -1
  if (at < 0) return <bdi>{text}</bdi>
  return (
    <bdi>
      {text.slice(0, at)}
      <mark className="xcc-quote">{quote}</mark>
      {text.slice(at + quote.length)}
    </bdi>
  )
}

function SideToggle({ record, side, onSide, busy }: { record: CalledRecord | null; side: CalledSide; onSide: (s: CalledSide) => void; busy: boolean }) {
  // What the scan found on each side. A record nobody has scanned has no tally, so the toggle shows no counts.
  const counts = sideCounts(record)
  const count = (s: CalledSide): number | null => (counts ? counts[s] : null)
  return (
    <div className="sk-seg xch__sides" role="group" aria-label="Which calls are plotted" aria-busy={busy || undefined}>
      {SIDES.map((s) => {
        const n = count(s.side)
        return (
          <button key={s.side} type="button" className="xch__side" aria-pressed={side === s.side} title={s.title} onClick={() => onSide(s.side)} data-side={s.side}>
            {s.label}
            {n !== null ? <span className="xch__siden">{n}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

function AddPost({ handle }: { handle: string }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setSaid(null)
    const res = await useCalled.getState().addPost(url)
    setBusy(false)
    if (res.ok) {
      setUrl('')
      setSaid({ ok: true, text: 'Added. It is on the chart and in the count.' })
    } else setSaid({ ok: false, text: res.reason })
  }
  return (
    <form className="xcc-add" onSubmit={submit}>
      <label className="xcc-add__k mono" htmlFor="xcc-add-url">
        Add a post
      </label>
      <input id="xcc-add-url" className="xcc-add__input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`Paste a link to a post by @${handle}`} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} inputMode="url" aria-describedby={said ? 'xcc-add-said' : undefined} />
      <button type="submit" className="xcc-btn" disabled={!url.trim() || busy} aria-busy={busy || undefined} data-journey="called_add_post">
        {busy ? 'Reading…' : 'Add'}
      </button>
      {said ? (
        <p id="xcc-add-said" className={`xcc-add__said${said.ok ? '' : ' is-no'}`} role="status">
          {said.text}
        </p>
      ) : null}
    </form>
  )
}

function Row({ call, index, px, focused, tail, onFocus, onPin }: { call: CalledCall; index: number; px: string; focused: boolean; tail: boolean; onFocus: () => void; onPin: () => void }) {
  const ref = useRef<HTMLLIElement | null>(null)
  const by = useCalled((s) => (focused ? s.focusBy : null))
  useEffect(() => {
    // A call opened on the chart (a dot, a bubble, the call card's own arrows) is shown THERE, in the call card. The page
    // never moves for it (2026-11-16: the jump down to this list was disorienting); only the list's own box scrolls, so
    // the row is in view when the reader comes down to it.
    const li = ref.current
    const list = li?.parentElement
    if (!focused || !li || !list || (by !== 'chart' && by !== 'card') || list.scrollHeight <= list.clientHeight) return
    const row = li.getBoundingClientRect()
    const box = list.getBoundingClientRect()
    if (row.top < box.top) list.scrollTop -= box.top - row.top
    else if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom
  }, [focused, by])
  const word = VERDICT_WORDS[call.verdict]
  return (
    <li ref={ref} className={`xcc-row${focused ? ' is-focus' : ''}${call.picked ? ' is-picked' : ''}`} data-verdict={call.verdict} data-post={call.postId} data-picked={call.picked ? '' : undefined} data-tail={tail ? '' : undefined} data-origin={call.origin}>
      <button type="button" className="xcc-row__main" onClick={onFocus} aria-expanded={focused} title="Show this call on the chart">
        <span className="xcc-row__n mono">{index + 1}</span>
        <span className="xcc-row__when mono">{pinDate(call.postedAt)}</span>
        <span className={`xcc-v xcc-v--${call.verdict} mono`}>
          <i className="xcc-v__g" aria-hidden>
            {VERDICT_GLYPH[call.verdict]}
          </i>
          {word}
        </span>
        <span className="xcc-row__text">
          <span className="xcc-row__stance mono" data-stance={call.stance}>
            {call.stance === 'bull' ? 'Bull' : 'Bear'}
          </span>
          {call.origin === 'added' ? (
            <span className="xcc-row__added mono" title="A viewer pasted this post. It is shown, and it is not in the count.">
              {ADDED_MARK}
            </span>
          ) : null}
          <PostText call={call} />
        </span>
        <span className="xcc-row__nums mono">
          <span className="xcc-row__price" title="This chart's daily close on the day of the post">
            {px}
            {fmtPrice(call.priceAt)}
          </span>
          <span className={`xcc-row__move xcc-v--${call.verdict}`}>{moveLine(call)}</span>
        </span>
      </button>
      <span className="xcc-row__side">
        {call.likes !== null ? (
          <span className="xcc-row__likes mono" title={`${call.likes.toLocaleString('en-US')} likes on X`}>
            <Heart className="xcc-row__icon" aria-hidden />
            {compact.format(call.likes)}
          </span>
        ) : null}
        <button type="button" className="xcc-pin" aria-pressed={call.picked} onClick={onPin} title={call.picked ? 'Pinned on the chart. Unpin it (it still counts).' : 'Pin this call on the chart'} aria-label={call.picked ? `Unpin the call of ${pinDate(call.postedAt)}` : `Pin the call of ${pinDate(call.postedAt)}`} data-journey="called_pin">
          <Pin className="xcc-row__icon" aria-hidden />
        </button>
        {call.url ? (
          <a className="xcc-row__x" href={call.url} target="_blank" rel="noopener noreferrer nofollow" title="Open the post on X">
            View on X
            <ExternalLink className="xcc-row__icon" aria-hidden />
          </a>
        ) : (
          <span className="xcc-row__x is-none" title="A fixture post: it was never on X">
            fixture
          </span>
        )}
      </span>
    </li>
  )
}

/** A count ("34 called it") with its number in a tag of its own, so a phone can set it as a stat. The text reads the same. */
function CountText({ text }: { text: string }) {
  const m = /^(\d[\d,.]*)(\s.*)$/.exec(text)
  if (!m) return <>{text}</>
  return (
    <>
      <b className="xch__num">{m[1]}</b>
      {m[2]}
    </>
  )
}

/** How many rows a phone shows before "Show all" when no call is pinned. */
const FOLD_ROWS = 5
/** Where the strip's top lands when it folds: under the phone's top bar and the stuck tabs. */
const FOLD_LANDS_AT = 112

/**
 * THE BAND above the chart while a handle is plotted: the record page's
 * header, on the chart. Who, the tally, what was read, and the plot's
 * controls. Every word about the record is the record's own (the headline's
 * counts sit under one proportional bar; read with the tags off it is the
 * headline to the letter).
 *
 * SLEEK (2026-11-24): one row of who, the tally as the kit's ScoreBar with
 * the counts on one line under it, the side filter as the kit's segmented
 * control, and the standing and coverage as ONE line a phone clamps behind
 * "more" (the disclosure opens in place; it is never dropped).
 */
export function CalledHead({ symbol, parked = false }: { symbol: string; parked?: boolean }) {
  const here = useCalled((s) => s.symbol === symbol)
  const plot = useCalled((s) => s.plot)
  const phase = useCalled((s) => s.phase)
  const response = useCalled((s) => s.response)
  const record = useCalled((s) => s.record)
  const scanning = useCalled((s) => s.scanning)
  const progress = useCalled((s) => s.progress)
  const viewer = useXViewer()
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [factsOpen, setFactsOpen] = useState(false)
  const shareRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    setShareOpen(false)
    setCopied(false)
    setFactsOpen(false)
  }, [plot?.handle, plot?.side])
  useEffect(() => {
    if (!shareOpen) return
    const away = (e: PointerEvent) => {
      if (!shareRef.current?.contains(e.target as Node)) setShareOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [shareOpen])

  if (!here || !plot) return null
  const { setSide, clear, scan } = useCalled.getState()
  const who = `@${plot.handle}`
  const status = plotStatus({ plot, symbol, phase, response, record, scanning, progress })
  const avatar = record ? avatarOf(record.profile.avatarUrl) : null
  const rawName = record ? cleanPostText(record.profile.name).slice(0, 60) : ''
  const named = !!rawName && rawName.toLowerCase() !== plot.handle && rawName.toLowerCase() !== who
  const followers = record?.profile.followers != null ? `${fmtCount(record.profile.followers)} followers` : null
  const parts = record ? headlineParts(record.words.headline) : null
  const tallied = !!record && record.scanned && record.tally.total > 0
  // Somebody else's record in the third person, the account's own in the first; "own" only when the record is verified
  // AND the viewer's proven X user id is the account's (lane RECORD's posts, lib/share-posts).
  const post = record ? (viewerOwns(record, viewer) ? myCalledPost(record) : calledPost(record)) : null

  return (
    <section className={`xch${parked ? ' is-parked' : ''}`} data-called-head={status.kind} data-called-handle={plot.handle} data-facts={factsOpen ? 'open' : undefined} aria-label={`${who} on ${symbol}: the record`} aria-hidden={parked || undefined}>
      {/* The card's ground: the brand's cut corner, drawn behind the row (a clip on the section itself would cut the Share menu). */}
      <span className="xch__ground" aria-hidden />
      <div className="xch__row">
        <a className="xch__id" href={`/x/${plot.handle}`} title={`${who}: every market plotted`} data-journey="called_head_handle">
          <span className="xch__avatar" aria-hidden>
            {avatar ? <img src={avatar} alt="" width={44} height={44} referrerPolicy="no-referrer" /> : (rawName || plot.handle).slice(0, 1).toUpperCase()}
          </span>
          <span className="xch__idtext">
            <span className="xch__k sk-label">
              Called it <span className="xch__ksym">· {symbol}</span>
            </span>
            <span className="xch__nameline">
              <span className="xch__name">
                {named && record ? <bdi>{cleanPostText(record.profile.name).slice(0, 60)}</bdi> : who}
                {record?.verified ? (
                  <span className="xch__verified" title={record.words.standing}>
                    <BadgeCheck className="xch__vicon" aria-hidden />
                  </span>
                ) : null}
              </span>
              {named || followers ? <span className="xch__sub mono">{[named ? who : null, followers].filter(Boolean).join(' · ')}</span> : null}
            </span>
          </span>
        </a>

        <div className="xch__tally">
          {record ? (
            <>
              {/* One bar, each verdict as wide as its share: the misses sit beside the hits. The counts under it are the headline's own. */}
              {tallied ? <ScoreBar counts={record.tally} words={VERDICT_WORDS} size="lg" bare className="xch__score" /> : null}
              {parts ? (
                <h2 className="xch__counts">
                  <span className="xch-sr">{parts.who}</span>
                  {parts.counts.map((c, i) => (
                    <Fragment key={c.kind}>
                      <span className={`xch__count is-${c.kind}`}>
                        <CountText text={c.text} />
                      </span>
                      <span className="xch-sr">{i < parts.counts.length - 1 ? ', ' : parts.end}</span>
                    </Fragment>
                  ))}
                </h2>
              ) : (
                <h2 className="xch__headline">{record.words.headline}</h2>
              )}
            </>
          ) : (
            <h2 className="xch__headline">
              <span className="xch-sr">
                {who} on {symbol}:{' '}
              </span>
              <span className="xch__state sk-label" data-kind={status.kind}>
                {status.kind === 'scanning' || status.kind === 'loading' ? <span className="xch__pulse" aria-hidden /> : null}
                {status.pill}
              </span>
            </h2>
          )}
          <p className="xch__facts">
            <span className="xch__factstext" id="xch-facts">
              {record ? (
                <>
                  <span className="xch__standing" data-called-standing="" data-verified={record.verified ? '' : undefined}>
                    {record.words.standing}
                  </span>
                  {record.words.coverage ? <span data-called-coverage=""> {record.words.coverage}</span> : null}
                </>
              ) : (
                <span role={status.kind === 'scanning' ? 'status' : undefined}>{status.line}</span>
              )}
            </span>
            {record || status.line ? (
              <button type="button" className="xch__more" aria-expanded={factsOpen} aria-controls="xch-facts" onClick={() => setFactsOpen((o) => !o)} data-journey="called_head_more">
                {factsOpen ? 'less' : 'more'}
              </button>
            ) : null}
          </p>
        </div>

        <div className="xch__tools">
          {!record && status.canScan ? (
            <button type="button" className="sk-btn xch__scan" onClick={() => void scan()} disabled={scanning} aria-busy={scanning || undefined} data-journey="called_scan">
              {scanning ? 'Scanning…' : `Scan ${who} on ${symbol}`}
            </button>
          ) : null}
          {record ? <SideToggle record={record} side={plot.side} onSide={setSide} busy={phase === 'loading'} /> : null}
          {record && post && record.calls.length > 0 ? (
            <span className="xcc-share" ref={shareRef}>
              <button type="button" className="xch__tool" aria-haspopup="menu" aria-expanded={shareOpen} aria-label={`Share ${who} on ${symbol}`} title="Share this record" onClick={() => setShareOpen((o) => !o)} data-journey="called_share">
                <Share2 className="xch__toolicon" aria-hidden />
                <span className="xch__toolword">Share</span>
              </button>
              {shareOpen ? (
                <span className="xcc-share__menu" role="menu">
                  <a role="menuitem" className="xcc-share__item" href={postHref(post)} target="_blank" rel="noopener noreferrer" data-journey="called_share_x">
                    Post on X
                  </a>
                  <button
                    type="button"
                    role="menuitem"
                    className="xcc-share__item"
                    onClick={() => {
                      void navigator.clipboard?.writeText(post.url).then(
                        () => setCopied(true),
                        () => setCopied(false),
                      )
                    }}
                    data-journey="called_share_copy"
                  >
                    {copied ? 'Link copied' : 'Copy link'}
                  </button>
                  <a role="menuitem" className="xcc-share__item" href={calledImageHref(record.handle, record.symbol, record.side, plot.pins)} download={`${record.handle}-${record.symbol}-calls.png`} data-journey="called_share_image">
                    Save image
                  </a>
                  <a role="menuitem" className="xcc-share__item" href={recordHref(record.handle, record.symbol, record.side)} data-journey="called_share_open">
                    Open the share page
                  </a>
                </span>
              ) : null}
            </span>
          ) : null}
          <button type="button" className="xch__tool xch__clear" onClick={clear} title="Take this plot off the chart" aria-label={`Take ${who} off the chart`} data-journey="called_clear">
            <X className="xch__toolicon" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  )
}

export default function CallsPanel({ symbol, parked = false }: { symbol: string; parked?: boolean }) {
  useCalledAddress(symbol)
  const here = useCalled((s) => s.symbol === symbol)
  const plot = useCalled((s) => s.plot)
  const phase = useCalled((s) => s.phase)
  const response = useCalled((s) => s.response)
  const record = useCalled((s) => s.record)
  const scanning = useCalled((s) => s.scanning)
  const progress = useCalled((s) => s.progress)
  const unlabeled = useCalled((s) => s.unlabeled)
  const focusId = useCalled((s) => s.focusId)
  const note = useCalled((s) => s.note)
  const payOffer = useCalled((s) => s.payOffer)
  const advanced = useCalled((s) => s.advanced)
  const cards = useCalled((s) => s.cards)
  // A phone shows the pinned calls (the ones the rule says mattered most) and one button for the rest: sixty rows were ten
  // thousand pixels between the chart and the page under it. The fold is CSS (called-chart.css, a phone only): every row is
  // in the page at every width.
  const [folded, setFolded] = useState(true)
  useEffect(() => setFolded(true), [plot?.handle, plot?.side])
  if (!here || !plot) return null
  const { togglePin, focus, fit, scan, retry, rulePins } = useCalled.getState()
  const pair = chartPairFor(symbol)
  const px = chartUnitOf(pair) === 'usd' ? '$' : ''
  const who = `@${plot.handle}`
  const state = record ? 'ready' : phase === 'loading' ? 'loading' : phase === 'failed' ? 'failed' : (response?.status ?? 'loading')
  // The account, the tally and the plot's controls are in the band above the chart (CalledHead); this strip's head is words only.
  const head = (title: ReactNode, sub?: ReactNode) => (
    <header className="xcc__head">
      <div className="xcc__who">
        <h2 className="xcc__headline">{title}</h2>
        {sub}
      </div>
    </header>
  )

  let body: ReactNode
  if (record) {
    const pinned = record.calls.filter((c) => c.picked).length
    const isTail = (c: CalledCall, i: number) => (pinned > 0 ? !c.picked : i >= FOLD_ROWS)
    const tails = record.calls.filter(isTail).length
    body = (
      <>
        <header className="xcc__head xcc__head--list">
          <p className="xcc__k mono">
            The calls
            <span className="xcc__name"> · oldest first · tap one to open it on the chart</span>
          </p>
          {record.words.added ? <p className="xcc__standing xcc__addednote">{record.words.added}</p> : null}
        </header>
        {!record.scanned ? (
          <div className="xcc__actions" data-called-unscanned="">
            <button type="button" className="xcc-btn xcc-btn--go" onClick={() => void scan()} disabled={scanning} aria-busy={scanning || undefined} data-journey="called_scan">
              {scanning ? 'Scanning…' : `Scan ${who} on ${record.symbol}`}
            </button>
            <span className="xcc__allow">
              {scanning && progress ? `${progress} ` : ''}
              Only posts a viewer pasted are here, so there is no tally. A scan reads the account&rsquo;s own posts and counts what it finds.
            </span>
          </div>
        ) : null}
        {unlabeled > 0 ? (
          <p className="xcc__line" role="status" data-called-unlabeled={unlabeled}>
            {unlabeled} {unlabeled === 1 ? 'post' : 'posts'} still to label.{' '}
            <button type="button" className="xcc-link" onClick={() => void scan()} disabled={scanning} aria-busy={scanning || undefined} data-journey="called_finish">
              {scanning ? 'Labeling…' : 'Finish'}
            </button>
            {scanning && progress ? <span className="xcc__progress"> {progress}</span> : null}
          </p>
        ) : null}
        {note ? (
          <p className="xcc__line xcc__line--note" role="status">
            {note}
            {payOffer ? (
              <>
                {' '}
                <button type="button" className="xcc-link" onClick={() => void scan({ pay: true })} disabled={scanning} data-journey="called_scan_pay">
                  Scan for {payOffer.answers} answers
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {/* What the chart is showing, when it is not a card for every pin (a narrow pane holds fewer; a phone's holds none). */}
        {advanced && pinned > cards && record.calls.length > 0 ? (
          <p className="xcc__line" data-called-cards={cards}>
            {cards === 0
              ? 'On a chart this narrow every call is a mark on its bar. Tap a mark to open its post.'
              : `The chart has room for ${cards} cards at this width. The other pinned calls are marks on their bars, like the rest.`}
          </p>
        ) : null}
        {record.calls.length > 0 ? (
          <>
            <ol className="xcc__rows" data-fold={folded && tails > 0 ? '' : undefined} aria-label={`Calls by ${who} on ${record.symbol}, oldest first`}>
              {record.calls.map((c, i) => (
                <Row key={c.postId} call={c} index={i} px={px} focused={focusId === c.postId} tail={isTail(c, i)} onFocus={() => focus(focusId === c.postId ? null : c.postId, 'strip')} onPin={() => togglePin(c.postId)} />
              ))}
            </ol>
            {tails > 0 ? (
              <button type="button" className="xcc-more" aria-expanded={!folded} onClick={(e) => {
                  // Folding from the foot of sixty rows: the strip's own top comes back, not whatever was under it.
                  const strip = e.currentTarget.closest('section')
                  if (!folded) requestAnimationFrame(() => strip && scrollAppTo(appScrollTop() + strip.getBoundingClientRect().top - FOLD_LANDS_AT))
                  setFolded((f) => !f)
                }} data-journey="called_show_all">
                {folded ? `Show all ${record.calls.length} calls` : pinned > 0 ? 'Show the pinned calls only' : 'Show fewer'}
              </button>
            ) : null}
          </>
        ) : (
          <p className="xcc__empty">
            {record.side === 'all' ? `No post the scan read took a side on ${record.symbol}.` : `No ${record.side === 'bull' ? 'bullish' : 'bearish'} call in what the scan read. The other side may have some.`} A post the scan did not find can be added by its link: it is shown and marked, and it is not counted.
          </p>
        )}
        <footer className="xcc__foot">
          <AddPost handle={plot.handle} />
          <div className="xcc__tools">
            {record.calls.length > 0 && advanced ? (
              <button type="button" className="xcc-btn" onClick={fit} title="Daily bars, every call on screen" data-journey="called_fit">
                <Maximize className="xcc-row__icon" aria-hidden />
                Fit all calls
              </button>
            ) : null}
            {plot.pins.length > 0 ? (
              <button type="button" className="xcc-btn" onClick={rulePins} title="Back to the pins the rule picks: the calls that mattered most, right or wrong">
                The rule&rsquo;s pins
              </button>
            ) : null}
          </div>
          <p className="xcc__method">
            <span className="xcc__legend mono" aria-label="What each mark means">
              {(['right', 'wrong', 'flat', 'open'] as const).map((v) => (
                <span key={v} className={`xcc-v xcc-v--${v}`}>
                  <i className="xcc-v__g" aria-hidden>
                    {VERDICT_GLYPH[v]}
                  </i>
                  {VERDICT_WORDS[v]}
                </span>
              ))}
            </span>
            {record.words.method} Right from +{Math.round(DEAD_BAND * 100)}%, wrong from -{Math.round(DEAD_BAND * 100)}%. <span data-called-caveat="">{LABEL_CAVEAT}</span> {DELETED_NOTE} {pinned} of {record.calls.length} pinned; the count is every call the scan found, pinned or not. Not investment advice.
          </p>
        </footer>
      </>
    )
  } else if (state === 'loading') {
    body = head(`Reading ${who} on ${symbol}`, <p className="xcc__standing">Looking for the posts where the account took a side.</p>)
  } else if (state === 'failed') {
    body = (
      <>
        {head(`${who} on ${symbol} did not load`, <p className="xcc__standing">The record did not answer. Nothing was plotted.</p>)}
        <div className="xcc__actions">
          <button type="button" className="xcc-btn xcc-btn--go" onClick={retry}>
            Try again
          </button>
        </div>
      </>
    )
  } else if (response?.status === 'scanning') {
    body = (
      <>
        {head(
          `Scanning ${who} on ${symbol}`,
          <p className="xcc__standing" role="status" aria-live="polite">
            <span className="xcc__spin" aria-hidden />
            {response.progress || progress || `Reading ${who}'s posts about ${symbol}.`}
          </p>,
        )}
        <p className="xcc__line">It reads up to {SCAN_POST_CAP} posts, so it can take up to a minute. The pins land here when it is done; you can keep using the chart.</p>
      </>
    )
  } else if (response?.status === 'unscanned') {
    body = (
      <>
        {head(
          `Nobody has plotted ${who} on ${symbol} yet`,
          <p className="xcc__standing">
            {response.canScan
              ? `A scan reads up to ${SCAN_POST_CAP} of ${who}'s newest public posts about ${symbol}, back as far as ${SCAN_WINDOW_DAYS} days. A model labels each one bullish or bearish from its own words, and each is judged on this chart's daily close ${JUDGE_DAYS} days later, or on the level it names.`
              : (response.reason ?? 'Scans are not available here right now.')}
          </p>,
        )}
        <div className="xcc__actions">
          {response.canScan ? (
            <span className="xcc__allow">
              {response.reason ? `${response.reason} ` : ''}
              {FREE_SCANS_PER_DAY} new scan a day is free once you verify with X or sign in; more cost {SCAN_ANSWER_PRICE} answers each. A handle somebody already plotted costs none.
            </span>
          ) : (
            <span className="xcc__allow">One post can still be pinned by its link, with no scan.</span>
          )}
        </div>
        <footer className="xcc__foot">
          <AddPost handle={plot.handle} />
        </footer>
      </>
    )
  } else if (response?.status === 'refused') {
    const next = response.next.flatMap((n) => {
      const href = safeNextHref(n.href)
      return href ? [{ label: n.label, href }] : []
    })
    body = (
      <>
        {head(`${who} on ${symbol} was not plotted`, <p className="xcc__standing">{response.reason}</p>)}
        <div className="xcc__actions">
          {response.pay ? (
            <button type="button" className="xcc-btn xcc-btn--go" onClick={() => void scan({ pay: true })} disabled={scanning} aria-busy={scanning || undefined} data-journey="called_scan_pay">
              Scan for {response.pay.answers} answers
            </button>
          ) : null}
          {next.map((n) => (
            <a key={`${n.href}:${n.label}`} className="xcc-btn" href={n.href}>
              {n.label}
            </a>
          ))}
          <button type="button" className="xcc-btn" onClick={retry}>
            Try again
          </button>
        </div>
        <footer className="xcc__foot">
          <AddPost handle={plot.handle} />
        </footer>
      </>
    )
  } else {
    body = head(`Reading ${who} on ${symbol}`)
  }

  return (
    <section className={`xcc${parked ? ' is-parked' : ''}`} data-called={state} data-called-handle={plot.handle} data-called-side={plot.side} aria-label={`Calls by ${who} on ${symbol}`} aria-hidden={parked || undefined}>
      {body}
    </section>
  )
}
