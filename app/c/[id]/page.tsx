import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import Footer from '@/components/Footer'
import CallChart from '@/components/markets/call/CallChart'
import CallShareRow from '@/components/markets/call/CallShareRow'
import CallComments from '@/components/markets/call/CallComments'
import { readCall } from '@/lib/chart-calls-read'
import { STAMP_FRAMES, callTweetHref, callUrl, fillTiming, fillWords, fmtCallPrice, fmtCallTime, fmtMove, fmtSpan } from '@/lib/chart-calls'
import { symbolName } from '@/lib/markets-seo'
import '@/components/markets/comm.css'

// /c/<id> — a CALL: one chart post as a public, stamped claim.
//
// The page answers three questions a screenshot never can (lib/chart-calls):
//   WHEN was this said        the server's timestamp on the post
//   WHAT was the price then   the tape's last fully closed bar before it
//   DID they act on it        the author's receipt-verified fills on the symbol
// It states the move since the stamp and stops there: the reader judges the
// call. A post has no edit route, so what is drawn here is what was drawn then.
//
// By-id read, like /i/<slug>: an internal (harness) post renders for whoever
// holds its id, is never indexed, and shows no fills.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const call = await readCall(id)
  if (!call) return { title: 'Call · Pantessa', robots: { index: false, follow: false } }
  const { post, stamp, move } = call
  const title = `${post.symbol}: ${post.title} · a call on Pantessa`
  const description = [
    `Called ${fmtCallTime(post.createdAt)} by ${post.authorLabel}`,
    stamp ? `at $${fmtCallPrice(stamp.price)}` : null,
    move !== null ? `(${fmtMove(move)} since)` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .concat('. Time and price stamped; trades verified on-chain.')
  return {
    title,
    description,
    alternates: { canonical: callUrl(post.id) },
    robots: post.isInternal ? { index: false, follow: false } : undefined,
    openGraph: { title, description, url: callUrl(post.id), siteName: 'Pantessa', type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function CallPage({ params }: Params) {
  const { id } = await params
  const call = await readCall(id)
  if (!call) notFound()
  const { post, stamp, last, move, fills, heldAtCall } = call
  const frame = stamp ? STAMP_FRAMES.find((f) => f.tf === stamp.tf)!.label : null
  const stood = fmtSpan(Math.floor(Date.now() / 1000) - post.createdAt)
  const before = fills.filter((f) => f.t <= post.createdAt)
  const after = fills.filter((f) => f.t > post.createdAt)

  return (
    <>
      <main className="callpg">
        <div className="callpg__kicker mono">
          <Link href={`/t/${post.symbol}`}>
            {post.symbol} · {symbolName(post.symbol)}
          </Link>
          <span aria-hidden>·</span>
          <span>call by {post.authorLabel}</span>
          {heldAtCall && (
            <span className="callpg__badge">
              <ShieldCheck className="h-3 w-3" aria-hidden /> position verified
            </span>
          )}
        </div>
        <h1 className="callpg__title">{post.title}</h1>

        {/* the stamp */}
        <dl className="callpg__stamp">
          <div>
            <dt>Stamped</dt>
            <dd>
              <time dateTime={new Date(post.createdAt * 1000).toISOString()}>{fmtCallTime(post.createdAt)}</time>
            </dd>
            <small>our server&apos;s clock · {stood} ago</small>
          </div>
          <div>
            <dt>Price at the call</dt>
            <dd>{stamp ? `$${fmtCallPrice(stamp.price)}` : '—'}</dd>
            <small>{stamp ? `the last ${frame} close before the post` : 'the tape had no bar at that minute'}</small>
          </div>
          <div>
            <dt>Now</dt>
            <dd>{last !== null ? `$${fmtCallPrice(last)}` : '—'}</dd>
            <small>live tape</small>
          </div>
          <div>
            <dt>Since the call</dt>
            <dd className={move === null ? undefined : move >= 0 ? 'callpg__up' : 'callpg__down'}>{move !== null ? fmtMove(move) : '—'}</dd>
            <small>price move, not a verdict</small>
          </div>
        </dl>

        <CallChart symbol={post.symbol} state={post.chartState} fills={fills} callT={post.createdAt} callLabel={`The call · ${fmtCallTime(post.createdAt)}${stamp ? ` · $${fmtCallPrice(stamp.price)}` : ''}`} />

        {post.body && <p className="callpg__body">{post.body}</p>}

        {/* the proof */}
        <section className="callpg__proof" aria-label="Verified trades">
          <h2 className="mono">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Verified on-chain
          </h2>
          {fills.length === 0 ? (
            <p className="callpg__muted">
              No verified trade on {post.symbol} from this wallet yet. A trade made through Pantessa appears here once the chain confirms the transaction — nobody can type one in.
            </p>
          ) : (
            <ul>
              {[...before, ...after].map((f) => {
                const timing = fillTiming(f.t, post.createdAt)
                return (
                  <li key={f.id} className={timing.when === 'before' ? 'is-before' : undefined}>
                    <span className={f.side === 'buy' ? 'callpg__up' : 'callpg__down'}>{f.side === 'buy' ? '▲' : '▼'}</span>
                    <span className="callpg__fill">{fillWords(f, post.symbol)}</span>
                    <span className="callpg__timing mono">{timing.words}</span>
                    {f.txUrl && (
                      <a href={f.txUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label="View the transaction on the block explorer">
                        tx <ExternalLink className="inline h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* act on it, or pass it on */}
        <div className="callpg__actions">
          {post.linkSlug && (
            <Link href={`/i/${post.linkSlug}`} className="mkp__exec" title="Opens the guarded runtime — only your wallet signs">
              Take this trade
              <small>{post.executedBy > 0 ? `· taken by ${post.executedBy} wallet${post.executedBy === 1 ? '' : 's'}` : '· your wallet signs'}</small>
            </Link>
          )}
          <Link href={`/t/${post.symbol}?tab=community`} className="mkt-share__btn">
            Open the {post.symbol} chart
          </Link>
          <CallShareRow tweetHref={callTweetHref({ id: post.id, symbol: post.symbol, title: post.title, verified: heldAtCall })} url={callUrl(post.id)} title={`$${post.symbol}: ${post.title}`} />
        </div>

        {/* the conversation: the link on X lands here, so this is where people answer the idea */}
        <CallComments postId={post.id} initial={post.commentList} />

        <p className="callpg__fine mono">
          how this is stamped · the time is the moment our server stored the post · the price is our own tape, never a number the author typed · the lines cannot be edited after posting · a trade shows only when the chain confirms its transaction, sender and target
        </p>
      </main>
      <Footer />
    </>
  )
}
