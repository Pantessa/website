'use client'

// THE CALLS STRIP under the symbol page's chart (squad called-it, lane CHART).
// Shown only while a handle is plotted. It carries everything the pins on the
// chart cannot: the full tally, who plotted it, every call with its whole
// text, and the doors (add a post, fit, share, clear).
//
// Words: the headline, the standing line, the verdict words and the move line
// all come from lib/called-it/spec or from the server's record. Nothing here
// rewords them, and a post's text is rendered as text.
//
// States, each with words and somewhere to go: loading · unscanned (what a
// scan does, the button, the allowance) · scanning (the scan's own note) ·
// ready · refused · failed · no scans on this server (one pasted post still
// works).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ExternalLink, Heart, Maximize, Pin, Share2, X } from 'lucide-react'
import { fmtPrice } from '@/components/CandleChart'
import { SIDES } from '@/components/called/HandleDoor'
import { chartPairFor, chartUnitOf } from '@/lib/charts'
import { DEAD_BAND, GUEST_SCANS_PER_DAY, JUDGE_DAYS, PROVEN_SCANS_PER_DAY, SCAN_WINDOW_DAYS, VERDICT_WORDS, moveLine, recordHref, type CalledCall, type CalledRecord, type CalledSide } from '@/lib/called-it/spec'
import { safeNextHref, useCalled, useCalledAddress } from '@/lib/called-it/use-record'
import { xIntentHref } from '@/lib/share-posts'
import { VERDICT_GLYPH, cleanPostText, pinDate } from '@/lib/tv/called-pins'
import './called-chart.css'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** An avatar is shown only from X's own image hosts (lane SOURCE keeps no other); anything else is an initial. */
function avatarOf(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'pbs.twimg.com' || u.hostname === 'abs.twimg.com') ? u.toString() : null
  } catch {
    return null
  }
}

/** The post's text with the span that carries the call marked. Text nodes only. */
function PostText({ call }: { call: Pick<CalledCall, 'text' | 'quote'> }) {
  const text = cleanPostText(call.text)
  const quote = cleanPostText(call.quote)
  const at = quote ? text.indexOf(quote) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="xcc-quote">{quote}</mark>
      {text.slice(at + quote.length)}
    </>
  )
}

/** The share text until lane RECORD's `calledPost` lands in lib/share-posts: the record's own headline (ASCII by rule), then what the page is. */
function sharePost(record: CalledRecord): string {
  return `${record.words.headline} Every post pinned on the chart at the day it was posted.`
}

function SideToggle({ record, side, onSide, busy }: { record: CalledRecord | null; side: CalledSide; onSide: (s: CalledSide) => void; busy: boolean }) {
  const count = (s: CalledSide): number | null => (!record ? null : s === 'all' ? record.bySide.bull.total + record.bySide.bear.total : record.bySide[s].total)
  return (
    <div className="xcc-seg" role="group" aria-label="Which calls are plotted" aria-busy={busy || undefined}>
      {SIDES.map((s) => {
        const n = count(s.side)
        return (
          <button key={s.side} type="button" className="xcc-seg__btn mono" aria-pressed={side === s.side} title={s.title} onClick={() => onSide(s.side)} data-side={s.side}>
            {s.label}
            {n !== null ? <span className="xcc-seg__n">{n}</span> : null}
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

function Row({ call, index, px, focused, onFocus, onPin }: { call: CalledCall; index: number; px: string; focused: boolean; onFocus: () => void; onPin: () => void }) {
  const ref = useRef<HTMLLIElement | null>(null)
  const by = useCalled((s) => (focused ? s.focusBy : null))
  useEffect(() => {
    // A pin clicked on the chart brings its words into view; a row clicked here is already under the pointer.
    if (focused && by === 'chart') ref.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [focused, by])
  const word = VERDICT_WORDS[call.verdict]
  return (
    <li ref={ref} className={`xcc-row${focused ? ' is-focus' : ''}${call.picked ? ' is-picked' : ''}`} data-verdict={call.verdict} data-post={call.postId} data-picked={call.picked ? '' : undefined}>
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
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setShareOpen(false)
    setCopied(false)
  }, [plot?.handle, plot?.side])

  if (!here || !plot) return null
  const { setSide, togglePin, focus, fit, clear, scan, retry, rulePins } = useCalled.getState()
  const pair = chartPairFor(symbol)
  const px = chartUnitOf(pair) === 'usd' ? '$' : ''
  const who = `@${plot.handle}`
  const state = record ? 'ready' : phase === 'loading' ? 'loading' : phase === 'failed' ? 'failed' : (response?.status ?? 'loading')
  const avatar = record ? avatarOf(record.profile.avatarUrl) : null

  const head = (title: ReactNode, sub?: ReactNode) => (
    <header className="xcc__head">
      <span className="xcc__avatar" aria-hidden>
        {avatar ? <img src={avatar} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" /> : (record?.profile.name ?? plot.handle).slice(0, 1).toUpperCase()}
      </span>
      <div className="xcc__who">
        <p className="xcc__k mono">
          Called it
          {record ? <span className="xcc__name"> · {record.profile.name}</span> : null}
        </p>
        <h2 className="xcc__headline">{title}</h2>
        {sub}
      </div>
      <div className="xcc__headtools">
        <SideToggle record={record} side={plot.side} onSide={setSide} busy={phase === 'loading'} />
        <button type="button" className="xcc__clear" onClick={clear} title="Take this plot off the chart" data-journey="called_clear">
          <X className="xcc-row__icon" aria-hidden />
          Clear
        </button>
      </div>
    </header>
  )

  let body: ReactNode
  if (record) {
    const pinned = record.calls.filter((c) => c.picked).length
    const origin = () => window.location.origin
    body = (
      <>
        {head(
          record.words.headline,
          <p className="xcc__standing" data-verified={record.verified ? '' : undefined}>
            {record.words.standing}
          </p>,
        )}
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
          </p>
        ) : null}
        {record.calls.length > 0 ? (
          <ol className="xcc__rows" aria-label={`Calls by ${who} on ${record.symbol}, oldest first`}>
            {record.calls.map((c, i) => (
              <Row key={c.postId} call={c} index={i} px={px} focused={focusId === c.postId} onFocus={() => focus(focusId === c.postId ? null : c.postId, 'strip')} onPin={() => togglePin(c.postId)} />
            ))}
          </ol>
        ) : (
          <p className="xcc__empty">
            {record.side === 'all' ? `No post by ${who} took a side on ${record.symbol} in this window.` : `No ${record.side === 'bull' ? 'bullish' : 'bearish'} call here. The other side may have some.`} A post the scan did not find can be added by its link.
          </p>
        )}
        <footer className="xcc__foot">
          <AddPost handle={plot.handle} />
          <div className="xcc__tools">
            {record.calls.length > 0 ? (
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
            <span className="xcc-share">
              <button type="button" className="xcc-btn xcc-btn--go" aria-haspopup="menu" aria-expanded={shareOpen} onClick={() => setShareOpen((o) => !o)} data-journey="called_share">
                <Share2 className="xcc-row__icon" aria-hidden />
                Share
              </button>
              {shareOpen ? (
                <span className="xcc-share__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="xcc-share__item"
                    onClick={() => {
                      const link = `${origin()}${recordHref(record.handle, record.symbol, record.side)}`
                      void navigator.clipboard?.writeText(link).then(
                        () => setCopied(true),
                        () => setCopied(false),
                      )
                    }}
                    data-journey="called_share_copy"
                  >
                    {copied ? 'Link copied' : 'Copy link'}
                  </button>
                  <a
                    role="menuitem"
                    className="xcc-share__item"
                    href={xIntentHref(sharePost(record), `https://www.pantessa.com${recordHref(record.handle, record.symbol, record.side)}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      // The address is this site's own, read on press (a preview shares its own page).
                      e.currentTarget.href = xIntentHref(sharePost(record), `${origin()}${recordHref(record.handle, record.symbol, record.side)}`)
                    }}
                    data-journey="called_share_x"
                  >
                    Post on X
                  </a>
                  <a role="menuitem" className="xcc-share__item" href={recordHref(record.handle, record.symbol, record.side)} data-journey="called_share_open">
                    Open the record&rsquo;s page
                  </a>
                </span>
              ) : null}
            </span>
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
            {record.words.method} Right from +{Math.round(DEAD_BAND * 100)}%, wrong from -{Math.round(DEAD_BAND * 100)}%. {pinned} of {record.calls.length} pinned; every call is counted. Not investment advice.
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
        <p className="xcc__line">It reads the last {SCAN_WINDOW_DAYS} days, so it can take up to a minute. The pins land here when it is done; you can keep using the chart.</p>
      </>
    )
  } else if (response?.status === 'unscanned') {
    body = (
      <>
        {head(
          `Nobody has plotted ${who} on ${symbol} yet`,
          <p className="xcc__standing">
            {response.canScan
              ? `A scan reads ${who}'s public posts about ${symbol} from the last ${SCAN_WINDOW_DAYS} days, marks each one bullish or bearish from its own words, and judges it on this chart's daily close ${JUDGE_DAYS} days later.`
              : (response.reason ?? 'Scans are not available here right now.')}
          </p>,
        )}
        <div className="xcc__actions">
          {response.canScan ? (
            <>
              <button type="button" className="xcc-btn xcc-btn--go" onClick={() => void scan()} disabled={scanning} data-journey="called_scan">
                Scan {who} on {symbol}
              </button>
              <span className="xcc__allow">
                {response.reason ? `${response.reason} ` : ''}
                {GUEST_SCANS_PER_DAY} scans a day for a visitor, {PROVEN_SCANS_PER_DAY} once you verify with X or sign in. A handle somebody already plotted costs none.
              </span>
            </>
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
