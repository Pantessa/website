'use client'
// Lane FEED owns this file. Props are the squad contract: one composer for
// an idea (a chart), a link, a video, or a trade with proof. Posting needs a
// sign-in (the unified door, rule 6); it opens folded.
//
// Folded it is one row. Open it is four tabs, and a post takes under a minute:
//   Chart idea        market, one line, why; "attach my current chart" when
//                     the page has one, else a door to the chart to draw it
//   Link              a URL (the title is read from the page when left empty)
//   Video             a URL, checked as you type against the hosts that work
//                     (lib/community/spec parseVideoUrl), with the poster
//   Trade with proof  the caller's OWN fills the chain confirmed (GET
//                     /api/me/fills), in plain words; pick one, choose
//                     whether the size shows. Nothing about the trade is typed.
// A signed-out press on Post opens the unified door with NO redirectTo and
// the post is HELD: it goes out when the session lands (useIdentityDoor). The
// draft also rides sessionStorage, so the Google lane's full-page return
// finds it. A room that needs a seat first answers 403 needsJoin: one button
// joins and posts.
//
// A COMPOSER YOU CAN LINK TO (lane SHARE): `?compose=trade` (idea, link,
// video; `&symbol=ETH` pre-picks the market) on any page that mounts this
// opens it on that tab, then the query leaves the address bar so a reload or
// a copied URL does not re-open it (feed-rules readComposeQuery). A stranger
// who arrives that way sees it open, with the sign-in on Post: no wall. On
// the trade tab the one fill that is new since the last look is pre-picked.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { PenLine, X } from 'lucide-react'
import type { ChartState } from '@/lib/chart-state'
import { parseVideoUrl, type FeedKind, type FeedPost, type PublicCommunity } from '@/lib/community/spec'
import type { MyFill } from '@/lib/community/proof'
import { resolveTickerQuery } from '@/lib/markets'
import { ageLabel } from '@/lib/news-shared'
import { useSession } from '@/lib/session'
import { COMPOSER_FOLDED_LINE, COMPOSER_KINDS, FILLS_SEEN_KEY, VIDEO_HOSTS_LINE, VIDEO_HOST_NAME, fillsSeenMark, postPath, preselectFill, readComposeQuery, stripComposeQuery, type ComposeQuery } from './feed-rules'
import { useIdentityDoor } from './useIdentityDoor'
import './community.css'

export interface ComposerProps {
  /** Post into this room. */
  community?: string
  /** Pre-pick the market (the symbol page). */
  symbol?: string
  /** The page's live chart — "attach my current chart". */
  chartState?: ChartState | null
  onPosted?: (post: FeedPost) => void
}

// lib/chart-posts POST_TITLE_MAX / POST_BODY_MAX (that module is server-side; the pins hold these equal).
export const COMPOSER_TITLE_MAX = 120
export const COMPOSER_BODY_MAX = 2000

const DRAFT_KEY = 'pantessa.community.draft'
const DRAFT_TTL_MS = 30 * 60_000

interface Draft {
  kind: FeedKind
  market: string
  title: string
  body: string
  url: string
  room: string
}

export default function Composer({ community, symbol, chartState = null, onPosted }: ComposerProps) {
  const { address } = useSession()
  const scope = `${community ?? ''}|${symbol ?? ''}`
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FeedKind>('idea')
  const [market, setMarket] = useState(symbol ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [room, setRoom] = useState(community ?? '')
  const [attach, setAttach] = useState(true)
  const [mint, setMint] = useState(true)
  const [showSize, setShowSize] = useState(true)
  const [fills, setFills] = useState<MyFill[] | null>(null)
  const [fillsErr, setFillsErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [rooms, setRooms] = useState<PublicCommunity[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string; postId?: string } | null>(null)
  const [needsJoin, setNeedsJoin] = useState(false)
  const { hold, door } = useIdentityDoor()
  const titleRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  // A link asked for a tab: it wins over the tab a saved draft remembers.
  const askedRef = useRef(false)
  const onComposeQuery = useCallback(
    (q: ComposeQuery) => {
      askedRef.current = true
      setKind(q.kind)
      if (!symbol && q.symbol) setMarket(q.symbol)
      setMsg(null)
      setOpen(true)
      window.setTimeout(() => rootRef.current?.scrollIntoView({ block: 'nearest' }), 0)
    },
    [symbol],
  )

  // ── the draft survives the sign-in (the Google lane reloads the page) ──
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw) as { scope?: string; at?: number; draft?: Draft }
      if (d.scope !== scope || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_TTL_MS || !d.draft) return
      const k = COMPOSER_KINDS.find((x) => x.kind === d.draft!.kind)
      if (!k) return
      if (!askedRef.current) setKind(k.kind)
      if (!symbol && !askedRef.current && typeof d.draft.market === 'string') setMarket(d.draft.market.slice(0, 40))
      if (typeof d.draft.title === 'string') setTitle(d.draft.title.slice(0, COMPOSER_TITLE_MAX))
      if (typeof d.draft.body === 'string') setBody(d.draft.body.slice(0, COMPOSER_BODY_MAX))
      if (typeof d.draft.url === 'string') setUrl(d.draft.url.slice(0, 300))
      if (!community && typeof d.draft.room === 'string') setRoom(d.draft.room.slice(0, 40))
      setOpen(true)
    } catch {
      // unreadable or blocked: a blank composer
    }
  }, [scope, symbol, community])
  useEffect(() => {
    if (!open) return
    const has = title.trim() || body.trim() || url.trim()
    try {
      if (has) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ scope, at: Date.now(), draft: { kind, market, title, body, url, room } satisfies Draft }))
      else window.sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      // storage blocked: the draft lives in this page only
    }
  }, [open, scope, kind, market, title, body, url, room])

  // ── what the fields resolve to ──
  const pair = useMemo(() => (market.trim() ? resolveTickerQuery(market) : null), [market])
  const sym = pair?.symbol ?? ''
  const video = useMemo(() => (kind === 'video' && url.trim() ? parseVideoUrl(url) : null), [kind, url])
  const attachable = !!chartState && !!sym && chartState.symbol === sym && chartState.lines.length > 0
  const hasAction = attachable && chartState!.lines.some((l) => (l.kind === 'h' || l.kind === 'zone') && l.action)
  const fill = fills?.find((f) => f.turnId === picked) ?? null
  // A link or a video inside a room may stand without a market; an idea and a trade never do.
  const marketOptional = (kind === 'link' || kind === 'video') && !!room
  const roomName = rooms.find((r) => r.slug === room)?.name ?? null

  // ── the caller's rooms (the "Post in" picker on a page that is not a room) ──
  useEffect(() => {
    if (!open || community || !address) return
    let alive = true
    fetch('/api/me/identity', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { communities?: PublicCommunity[] } | null) => {
        if (alive && Array.isArray(d?.communities)) setRooms(d.communities.slice(0, 40))
      })
      .catch(() => {
        // no picker: the post goes to the market's board
      })
    return () => {
      alive = false
    }
  }, [open, community, address])

  // ── the caller's own confirmed fills (the proof picker) ──
  const loadFills = useCallback(async () => {
    setFillsErr(null)
    try {
      const q = new URLSearchParams({ limit: '20' })
      if (symbol) q.set('symbol', symbol)
      const r = await fetch(`/api/me/fills?${q.toString()}`, { cache: 'no-store' })
      const d = (await r.json().catch(() => ({}))) as { fills?: MyFill[]; error?: string }
      if (!r.ok || !Array.isArray(d.fills)) throw new Error('fills')
      setFills(d.fills)
      // The one fill that is new since the last look is pre-picked (the trade
      // just made); none or several new ones leave the list as it was.
      let seen: number | null = null
      try {
        const raw = Number(window.localStorage.getItem(FILLS_SEEN_KEY))
        seen = Number.isFinite(raw) && raw > 0 ? raw : null
      } catch {
        // storage blocked: every listed fill reads as new
      }
      const pre = preselectFill(d.fills, seen)
      if (pre) setPicked((cur) => cur ?? pre)
      try {
        const mark = fillsSeenMark(d.fills, seen)
        if (mark != null) window.localStorage.setItem(FILLS_SEEN_KEY, String(mark))
      } catch {
        // nothing remembered: the next look pre-picks by the same rule
      }
    } catch {
      setFills(null)
      setFillsErr('Your trades are not answering right now. Try again in a moment.')
    }
  }, [symbol])
  useEffect(() => {
    if (open && kind === 'trade' && address) void loadFills()
  }, [open, kind, address, loadFills])

  // ── can it post? one sentence says what is missing ──
  const missing = ((): string | null => {
    if (kind === 'trade') {
      if (!address) return null
      return fill ? null : 'Pick the trade to post.'
    }
    if (!marketOptional && !sym) return market.trim() ? 'That is not a market we chart yet.' : 'Name the market (UNI, ETH, AAPL).'
    if (kind === 'idea') return title.trim().length < 3 ? 'Add your call in one line.' : null
    if (kind === 'link') return /^https:\/\/\S+\.\S+/.test(url.trim()) ? null : 'Paste an https link.'
    if (!video) return url.trim() ? VIDEO_HOSTS_LINE : 'Paste the video link.'
    return title.trim().length < 3 ? 'Say what the video is in one line.' : null
  })()

  const send = useCallback(
    async (joinFirst = false) => {
      setBusy(true)
      setMsg(null)
      setNeedsJoin(false)
      try {
        if (joinFirst && room) {
          const j = await fetch(`/api/communities/${room}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          if (!j.ok) {
            const jd = (await j.json().catch(() => ({}))) as { error?: string }
            throw new Error(jd.error && jd.error.length < 200 ? jd.error : 'Joining the room did not go through. Try again in a moment.')
          }
        }
        const payload: Record<string, unknown> = { kind, title: title.trim(), body }
        // A trade's market, and its title when none is typed, come from the receipt (the route reads them).
        if (kind !== 'trade' && sym) payload.symbol = sym
        if (room) payload.community = room
        if (kind === 'idea' && attachable && attach) {
          payload.chartState = chartState
          payload.mint = mint && hasAction
        }
        if (kind === 'link') payload.linkUrl = url.trim()
        if (kind === 'video') payload.mediaUrl = video?.url ?? url.trim()
        if (kind === 'trade') {
          payload.proofTurnId = picked
          payload.showSize = showSize
        }
        const r = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        const d = (await r.json().catch(() => ({}))) as { post?: FeedPost; error?: string; needsJoin?: boolean; mintError?: string; link?: { url: string } }
        if (r.status === 401) {
          // No session after all (it expired): the same door, the post held.
          hold(() => void send())
          return
        }
        if (r.status === 403 && d.needsJoin) {
          setNeedsJoin(true)
          setMsg({ tone: 'bad', text: `You post in ${roomName ?? 'this room'} once you have joined it.` })
          return
        }
        if (!r.ok || !d.post) throw new Error(d.error && d.error.length < 240 ? d.error : 'That did not post. Nothing was lost: try again in a moment.')
        try {
          window.sessionStorage.removeItem(DRAFT_KEY)
        } catch {
          // nothing stored
        }
        setTitle('')
        setBody('')
        setUrl('')
        setPicked(null)
        setOpen(false)
        setMsg({ tone: 'ok', text: d.link ? 'Posted, and minted as a link readers can execute.' : d.mintError ? `Posted. The link was not minted: ${d.mintError}` : 'Posted.', postId: d.post.id })
        onPosted?.(d.post)
      } catch (e) {
        setMsg({ tone: 'bad', text: e instanceof Error && e.message && e.message !== 'Failed to fetch' ? e.message : 'That did not post. Nothing was lost: try again in a moment.' })
      } finally {
        setBusy(false)
      }
    },
    [kind, title, body, sym, room, roomName, attachable, attach, chartState, mint, hasAction, url, video, picked, showSize, hold, onPosted],
  )

  // The held post runs the LATEST send (the session it waited for changes nothing in the draft).
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })

  const submit = () => {
    if (busy || missing) return
    // Posting needs a wallet session. A signed-out press opens the unified
    // door in place (no redirectTo) and the post goes out when they land.
    if (!address) {
      hold(() => void sendRef.current())
      return
    }
    void send()
  }

  const openAs = (k: FeedKind) => {
    setKind(k)
    setOpen(true)
    setMsg(null)
    window.setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 0)
  }

  if (!open) {
    return (
      <div className="cmy-compose" id="share-here" data-composer="" data-open="false" ref={(el) => void (rootRef.current = el)}>
        <Suspense fallback={null}>
          <ComposeQueryReader onQuery={onComposeQuery} />
        </Suspense>
        <button type="button" className="cmy-compose__fold" onClick={() => openAs(kind)} aria-expanded="false" data-journey="Open composer">
          <PenLine aria-hidden />
          <span className="cmy-compose__foldline">{COMPOSER_FOLDED_LINE}</span>
          <span className="cmy-compose__foldgo">Post</span>
        </button>
        {msg?.tone === 'ok' && (
          <p className="cmy-compose__msg" style={{ padding: '0 14px 12px' }} role="status">
            {msg.text} {msg.postId && <Link href={postPath(msg.postId)}>Open it</Link>}
          </p>
        )}
        {door}
      </div>
    )
  }

  const titlePlaceholder =
    kind === 'idea' ? (sym ? `Your call on ${sym}, in one line` : 'Your call, in one line') : kind === 'link' ? 'Title (leave empty to use the page title)' : kind === 'video' ? 'What the video is, in one line' : 'What you saw, in one line'

  return (
    <form
      className="cmy-compose"
      id="share-here"
      data-composer=""
      data-open="true"
      data-kind={kind}
      aria-label="Write a post"
      ref={(el) => void (rootRef.current = el)}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Suspense fallback={null}>
        <ComposeQueryReader onQuery={onComposeQuery} />
      </Suspense>
      <div className="cmy-compose__open">
        <div className="cmy-compose__head">
          <div className="cmy-compose__kinds" role="tablist" aria-label="What are you posting">
            {COMPOSER_KINDS.map((k) => (
              <button key={k.kind} type="button" role="tab" aria-selected={kind === k.kind} className="cmy-tabs__tab" onClick={() => openAs(k.kind)} data-compose-kind={k.kind}>
                {k.label}
              </button>
            ))}
          </div>
          <button type="button" className="cmy-compose__close" aria-label="Close the composer" onClick={() => setOpen(false)}>
            <X aria-hidden />
          </button>
        </div>

        {/* TRADE: the proof first. Nothing about the trade is typed. */}
        {kind === 'trade' && (
          <>
            {!address ? (
              <p className="cmy-compose__hint">
                Your confirmed trades show here once you sign in.{' '}
                <button type="button" className="underline underline-offset-2" style={{ color: 'var(--accent)' }} onClick={() => hold(() => void loadFills())}>
                  Sign in
                </button>
              </p>
            ) : fillsErr ? (
              <p className="cmy-compose__hint cmy-compose__hint--bad">
                {fillsErr}{' '}
                <button type="button" className="underline underline-offset-2" onClick={() => void loadFills()}>
                  Try again
                </button>
              </p>
            ) : fills === null ? (
              <p className="cmy-compose__hint">Reading your confirmed trades.</p>
            ) : fills.length === 0 ? (
              <p className="cmy-compose__hint" data-fills-empty="">
                No confirmed trades from this wallet yet{symbol ? ` on ${symbol}` : ''}. Make one and it shows here.{' '}
                <Link href={symbol ? `/t/${symbol}` : '/'}>{symbol ? `Open the ${symbol} chart` : 'Open the markets'}</Link>
              </p>
            ) : (
              <div className="cmy-compose__fills" role="radiogroup" aria-label="Your confirmed trades">
                {fills.map((f) => (
                  <button
                    key={f.turnId}
                    type="button"
                    role="radio"
                    aria-checked={picked === f.turnId}
                    data-fill-picked={picked === f.turnId || undefined}
                    className="cmy-compose__fill"
                    onClick={() => setPicked(f.turnId)}
                  >
                    <span className="cmy-compose__dot" aria-hidden />
                    <span>{f.label}</span>
                    <time dateTime={new Date(f.signedAt).toISOString()}>{ageLabel(Math.floor(f.signedAt / 1000))}</time>
                  </button>
                ))}
              </div>
            )}
            <p className="cmy-compose__hint">Only transactions the chain confirmed from your wallet appear here. The market is your own tag, and the post shows it as yours.</p>
            {fill && (
              <label className="cmy-compose__check">
                <input type="checkbox" checked={showSize} onChange={(e) => setShowSize(e.target.checked)} />
                Show the size (read from the chain when you post: what this wallet moved in that transaction)
              </label>
            )}
          </>
        )}

        {(kind === 'link' || kind === 'video') && (
          <label className="cmy-compose__field">
            <span className="cmy-compose__label">{kind === 'video' ? 'Video link' : 'Link'}</span>
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={kind === 'video' ? 'https://youtube.com/watch?v=...' : 'https://'}
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={kind === 'video' && !!url.trim() && !video ? true : undefined}
            />
          </label>
        )}
        {kind === 'video' &&
          (video ? (
            <div className="cmy-compose__preview" data-video-ok={video.host}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {video.poster && <img src={video.poster} alt="" referrerPolicy="no-referrer" />}
              <div className="min-w-0">
                <b>{VIDEO_HOST_NAME[video.host]} video</b>
                <span>{video.embedUrl ? 'Plays in the post after a tap' : 'Opens on X (X videos do not play here)'}</span>
              </div>
            </div>
          ) : (
            <p className={url.trim() ? 'cmy-compose__hint cmy-compose__hint--bad' : 'cmy-compose__hint'} data-video-hosts="">
              {url.trim() ? `That is not a video link we can show. ${VIDEO_HOSTS_LINE}` : VIDEO_HOSTS_LINE}
            </p>
          ))}

        <div className="cmy-compose__row">
          {!symbol && kind !== 'trade' && (
            <label className="cmy-compose__field cmy-compose__field--sym">
              <span className="cmy-compose__label">{marketOptional ? 'Market (optional)' : 'Market'}</span>
              <input type="text" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="UNI, ETH, Apple" maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={!!market.trim() && !pair ? true : undefined} />
              {market.trim() && <span className={pair ? 'cmy-compose__hint cmy-compose__hint--ok' : 'cmy-compose__hint cmy-compose__hint--bad'}>{pair ? pair.label : 'Not a market we chart yet'}</span>}
            </label>
          )}
          <label className="cmy-compose__field">
            <span className="cmy-compose__label">{kind === 'link' ? 'Title (optional)' : kind === 'trade' ? 'Your read (optional)' : 'In one line'}</span>
            <input ref={titleRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titlePlaceholder} maxLength={COMPOSER_TITLE_MAX} />
          </label>
        </div>

        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'idea' ? 'Why. Plain text.' : 'Anything to add. Plain text.'} maxLength={COMPOSER_BODY_MAX} aria-label="More" />

        {kind === 'idea' &&
          (attachable ? (
            <div className="cmy-compose__row">
              <label className="cmy-compose__check">
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                Attach my current chart ({chartState!.lines.length} line{chartState!.lines.length === 1 ? '' : 's'})
              </label>
              {attach && hasAction && (
                <label className="cmy-compose__check">
                  <input type="checkbox" checked={mint} onChange={(e) => setMint(e.target.checked)} />
                  Mint the first action as a link (readers execute it, you earn the creator share)
                </label>
              )}
            </div>
          ) : (
            <p className="cmy-compose__hint" data-draw-door="">
              A chart idea reads best with its lines.{' '}
              {sym ? (
                <Link href={`/t/${sym}?tab=chart`}>Draw it on the {sym} chart</Link>
              ) : (
                'Name the market to draw it on its chart.'
              )}{' '}
              A line can carry the trade.
            </p>
          ))}

        {!community && rooms.length > 0 && (
          <label className="cmy-compose__field" style={{ flex: '0 0 auto' }}>
            <span className="cmy-compose__label">Post in</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)} className="cmy-compose__select">
              <option value="">No room (the market&apos;s own board)</option>
              {rooms.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="cmy-compose__foot">
          <span className={msg?.tone === 'bad' ? 'cmy-compose__msg cmy-compose__msg--bad' : 'cmy-compose__msg'} role="status">
            {msg?.tone === 'bad' ? msg.text : (missing ?? (address ? '' : 'Posting asks you to sign in. Your draft stays here.'))}{' '}
            {needsJoin && (
              <button type="button" onClick={() => void send(true)} disabled={busy} data-journey="Join room and post">
                Join {roomName ?? 'the room'} and post
              </button>
            )}
          </span>
          <button type="submit" className="cmy-btn" disabled={busy || !!missing} data-journey={`Post ${kind}`}>
            {busy ? 'Posting' : address ? 'Post' : 'Sign in and post'}
          </button>
        </div>
      </div>
      {door}
    </form>
  )
}

/** Reads `?compose=` once it is in the address, hands it up, and takes it out
 *  of the address bar (the page's other query and its hash stay). It renders
 *  nothing; it sits in its own Suspense so a static page stays static. */
function ComposeQueryReader({ onQuery }: { onQuery: (q: ComposeQuery) => void }) {
  const pathname = usePathname()
  const raw = useSearchParams()?.toString() ?? ''
  useEffect(() => {
    // The address bar is the truth (the router's copy can trail a rewrite):
    // once the query is stripped, a re-mount of this reader finds nothing.
    const live = window.location.search
    const q = readComposeQuery(live)
    if (!q) return
    onQuery(q)
    try {
      window.history.replaceState(window.history.state, '', stripComposeQuery(window.location.pathname, live, window.location.hash))
    } catch {
      // an address bar we cannot rewrite: the composer is open all the same
    }
  }, [raw, pathname, onQuery])
  return null
}
