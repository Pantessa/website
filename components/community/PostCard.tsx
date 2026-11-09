'use client'
// Lane FEED owns this file. The PROPS are the squad contract (lane GROUP
// mounts the card through FeedList; the symbol page's Community tab uses it).
//
// ONE card for four kinds, read in two seconds: who, what market, the claim,
// the proof, the score, one action.
//   idea   the chart sketch, the stamped-call door (/c/<id>: the time and the
//          price are stamped THERE; the card never computes a move from
//          nothing), the action chips the lines carry (through the same
//          gates as the symbol page: canSellAsk, canTradeAsk), and "Execute
//          this idea" when the author minted the link
//   link   host + title, out in a new tab (noopener noreferrer nofollow ugc)
//   video  a poster with a play button; the player frame mounts ONLY after
//          the tap, sandboxed, no referrer. A host with no embed (X) is a
//          link out.
//   trade  a FACT row built from the proof alone (feed-rules tradeFact): side,
//          market, size or "size hidden", chain, "verified on-chain" with the
//          tx link, and one chip that does the same trade. The word
//          "verified" prints only behind feed-rules isVerified.
// Every user string is a text node.

import { useCallback, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ExternalLink, MessageSquare, Play, ShieldCheck } from 'lucide-react'
import ChartSketch from '@/components/markets/community/ChartSketch'
import { ageLabel } from '@/lib/news-shared'
import { canSellAsk } from '@/lib/sell-gate'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useHeld } from '@/lib/use-held'
import { useTradable } from '@/lib/use-tradable'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { communityPath, type FeedPost, type VideoRef } from '@/lib/community/spec'
import { VIDEO_HOST_NAME, VIDEO_IFRAME_SANDBOX, isVerified, postPath, postShareText, sameTradeAsk, tradeFact } from './feed-rules'
import ShareSheet from './ShareSheet'
import VoteButtons from './VoteButtons'
import '@/components/markets/comm.css'
import './community.css'

export interface PostCardProps {
  post: FeedPost
  /** Show the room chip (off inside the room's own feed). */
  showCommunity?: boolean
  /** In-app: send an ask (chip-send). Absent → the chips go through the ask door. */
  onAsk?: (ask: string) => void
  /** The post's own page: the whole body, the title is not a link to itself. */
  full?: boolean
}

const KIND_WORD: Record<FeedPost['kind'], string> = { idea: 'Chart idea', link: 'Link', video: 'Video', trade: 'Trade' }

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export default function PostCard({ post, showCommunity = false, onAsk, full = false }: PostCardProps) {
  const held = useHeld()
  const tradable = useTradable()
  const href = postPath(post.id)
  const verified = isVerified(post)
  const proof = verified ? post.proof : null

  // The asks this reader can actually run: an idea's line actions, or the one
  // sentence that does the same trade as a verified fill.
  const same = post.kind === 'trade' && proof ? sameTradeAsk(proof, post.symbol) : null
  const asks = (post.kind === 'trade' ? (same ? [same.ask] : []) : post.asks).filter((a) => canSellAsk(a, held) && canTradeAsk(a, tradable))

  const outLink = post.kind === 'link' ? post.linkUrl : post.kind === 'video' && post.video && !post.video.embedUrl ? post.video.url : null
  const sketch = post.kind === 'idea' && post.chartState ? post.chartState : null

  let title: ReactNode = post.title
  if (outLink) {
    title = (
      <a href={outLink} target="_blank" rel="noopener noreferrer nofollow ugc">
        {post.title} <ExternalLink className="cmy-card__out" aria-hidden />
        <span className="cmy-card__host">{post.kind === 'video' && post.video ? VIDEO_HOST_NAME[post.video.host] : hostOf(outLink)}</span>
      </a>
    )
  } else if (!full) {
    title = <Link href={href}>{post.title}</Link>
  }

  return (
    <article className="cmy-card" data-post={post.id} data-kind={post.kind} data-has-sketch={sketch ? '' : undefined} aria-label={post.title}>
      <VoteButtons postId={post.id} score={typeof post.score === 'number' ? post.score : null} myVote={post.myVote ?? 0} />

      <div className="cmy-card__main">
        <div className="cmy-card__meta">
          {post.symbol && (
            <Link href={`/t/${post.symbol}`} className="cmy-card__sym" title={`Open the ${post.symbol} chart`}>
              {post.symbol}
            </Link>
          )}
          <span className="cmy-card__kind" data-kind={post.kind}>
            {KIND_WORD[post.kind]}
          </span>
          <span className="cmy-card__author">{post.authorLabel}</span>
          <time dateTime={new Date(post.createdAt * 1000).toISOString()}>{ageLabel(post.createdAt)}</time>
          {showCommunity && post.community && (
            <Link href={communityPath(post.community.slug)} className="cmy-card__room" title={`Open the room ${post.community.name}`}>
              {post.community.name}
            </Link>
          )}
        </div>

        <h3 className="cmy-card__title">{title}</h3>

        {/* A trade: the fact first, from the receipt the chain confirmed. */}
        {post.kind === 'trade' && proof && <TradeFact post={post} />}
        {post.kind === 'trade' && !proof && <p className="cmy-card__noproof">The proof for this trade is not on record, so nothing about it is shown as a fact.</p>}

        {post.body && <p className={full ? 'cmy-card__body' : 'cmy-card__body cmy-card__body--clamp'}>{post.body}</p>}

        {post.kind === 'video' && post.video?.embedUrl && <VideoBlock video={post.video} title={post.title} />}

        {(asks.length > 0 || post.linkSlug) && (
          <div className="cmy-card__chips">
            {post.kind === 'trade' && asks.length > 0 && <span className="cmy-card__chiplead">Do the same</span>}
            {post.linkSlug && (
              <Link href={`/i/${post.linkSlug}`} className="cmy-chip cmy-chip--exec" title="Opens the guarded runtime. Only your wallet signs." data-journey="Execute this idea">
                Execute this idea
                <small>{post.executedBy > 0 ? `executed by ${post.executedBy} wallet${post.executedBy === 1 ? '' : 's'}` : 'not executed yet'}</small>
              </Link>
            )}
            {asks.length > 0 && (onAsk ? <Chips asks={asks} act={onAsk} /> : <DoorChips asks={asks} />)}
          </div>
        )}
      </div>

      {sketch && (
        <Link href={href} className="cmy-card__sketch" aria-label={`Open the stamped call: ${post.title}`} tabIndex={-1}>
          <ChartSketch state={sketch} />
        </Link>
      )}

      <div className="cmy-card__foot">
        <Link href={`${href}#replies`} className="cmy-card__act" data-journey="Open comments">
          <MessageSquare aria-hidden /> {post.comments} <span className="cmy-card__actword">comment{post.comments === 1 ? '' : 's'}</span>
        </Link>
        {post.kind === 'idea' && !full && (
          <Link href={href} className="cmy-card__act" title="This idea as a stamped call: the time, the price then, the author's verified trades" data-journey="Open stamped call">
            <ShieldCheck aria-hidden /> <span className="cmy-card__actword">Stamped call</span>
          </Link>
        )}
        <ShareSheet url={href} text={postShareText(post)} what="post" />
      </div>
    </article>
  )
}

// ── a trade, as a fact ──────────────────────────────────────────────────────

function TradeFact({ post }: { post: FeedPost }) {
  // Only ever mounted behind isVerified(post): the proof is the server's own
  // reading of a receipt row the chain confirmed.
  const proof = post.proof!
  const fact = tradeFact(proof, post.symbol)
  return (
    <div className="cmy-fact" data-proof="verified" data-side={proof.side ?? undefined}>
      <span className="cmy-fact__badge">
        <ShieldCheck aria-hidden /> verified on-chain
      </span>
      <span className="cmy-fact__line">{fact.line}</span>
      <time className="cmy-fact__when" dateTime={new Date(proof.signedAt).toISOString()}>
        {ageLabel(Math.floor(proof.signedAt / 1000))}
      </time>
      {proof.txUrl && (
        <a className="cmy-fact__tx" href={proof.txUrl} target="_blank" rel="noopener noreferrer nofollow" title="The transaction on the chain's own explorer">
          tx <ExternalLink aria-hidden />
        </a>
      )}
    </div>
  )
}

// ── a video: nothing loads from the host until the tap ──────────────────────

function VideoBlock({ video, title }: { video: VideoRef; title: string }) {
  const [playing, setPlaying] = useState(false)
  const host = VIDEO_HOST_NAME[video.host]
  if (playing && video.embedUrl) {
    return (
      <div className="cmy-video" data-video={video.host} data-playing="">
        <iframe
          src={`${video.embedUrl}${video.host === 'youtube' ? '?autoplay=1&rel=0' : video.host === 'vimeo' ? '?autoplay=1' : ''}`}
          title={title}
          sandbox={VIDEO_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          allow="fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }
  return (
    <button type="button" className="cmy-video" data-video={video.host} onClick={() => setPlaying(true)} aria-label={`Play the video: ${title}`} data-journey="Play video">
      {video.poster ? (
        // A static image from the host's own image CDN; no referrer, no cookies of ours.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.poster} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <span className="cmy-video__tile">{host} video</span>
      )}
      <span className="cmy-video__play" aria-hidden>
        <Play />
      </span>
      <span className="cmy-video__host">Plays from {host} after you tap</span>
    </button>
  )
}

// ── the action chips ────────────────────────────────────────────────────────

function Chips({ asks, act }: { asks: string[]; act: (ask: string) => void }) {
  return (
    <>
      {asks.map((ask, i) => (
        <button key={i} type="button" className="cmy-chip" onClick={() => act(ask)} title="Builds this order. Your wallet signs it.">
          {ask}
        </button>
      ))}
    </>
  )
}

/** No chat surface around the card: the chip runs in the ask door's sheet,
 *  behind connect-to-act (a stranger connects first, the ask is held). */
function DoorChips({ asks }: { asks: string[] }) {
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const redirectFor = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor })
  return (
    <>
      <Chips asks={asks} act={act} />
      {door}
    </>
  )
}
