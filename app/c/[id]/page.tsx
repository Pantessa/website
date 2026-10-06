import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import Footer from '@/components/Footer'
import CallChart from '@/components/markets/call/CallChart'
import CallShareRow from '@/components/markets/call/CallShareRow'
import CallComments from '@/components/markets/call/CallComments'
import CallTicket from '@/components/markets/call/CallTicket'
import CallInfo from '@/components/markets/call/CallInfo'
import { readCall } from '@/lib/chart-calls-read'
import { STAMP_FRAMES, callTweetHref, callUrl, fmtCallPrice, fmtCallTime, fmtMove, fmtSpan } from '@/lib/chart-calls'
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
  const { post, stamp, last, move, fills, heldAtCall, pair, authorLinks } = call
  const frame = stamp ? STAMP_FRAMES.find((f) => f.tf === stamp.tf)!.label : null
  const stood = fmtSpan(Math.floor(Date.now() / 1000) - post.createdAt)

  return (
    <>
      {/* Full width: the chart and the replies on the left, the ticket docked
          on the right (sticky on a desk, under the chart on a phone). The
          proof and the fine print live behind the ⓘ; the author's links close
          the page. */}
      <main className="callpg">
        <div className="callpg__main">
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
              <small>{stood} ago</small>
            </div>
            <div>
              <dt>Price at the call</dt>
              <dd>{stamp ? `$${fmtCallPrice(stamp.price)}` : '—'}</dd>
              <small>{stamp ? `last ${frame} close before the post` : 'no bar at that minute'}</small>
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

          {/* one line of proof; the detail is the ⓘ */}
          <div className="callpg__proofline">
            <CallInfo symbol={post.symbol} fills={fills} callT={post.createdAt} heldAtCall={heldAtCall} />
            <CallShareRow tweetHref={callTweetHref({ id: post.id, symbol: post.symbol, title: post.title, verified: heldAtCall })} url={callUrl(post.id)} />
          </div>

          {/* the conversation, right under the chart: the link on X lands here */}
          <CallComments postId={post.id} initial={post.commentList} />

          {authorLinks.length > 0 && (
            <section className="callpg__links" aria-label={`More from ${post.authorLabel}`}>
              <h2 className="mono">More from {post.authorLabel}</h2>
              <ul>
                {authorLinks.map((l) => (
                  <li key={l.slug}>
                    <Link href={`/i/${l.slug}`} title="Opens the guarded runtime — only your wallet signs">
                      <span className="callpg__linkask">{l.ask}</span>
                      <span className="mono callpg__linkgo">open →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="callpg__side">
          {pair ? (
            <CallTicket symbol={post.symbol} pair={pair} last={last} lines={post.chartState?.lines ?? []} />
          ) : (
            <Link href={`/t/${post.symbol}`} className="mkt-share__btn">
              Open the {post.symbol} chart
            </Link>
          )}
          {post.linkSlug && (
            <Link href={`/i/${post.linkSlug}`} className="mkp__exec callpg__exec" title="Opens the guarded runtime — only your wallet signs">
              Take the author&apos;s trade
              <small>{post.executedBy > 0 ? `· taken by ${post.executedBy} wallet${post.executedBy === 1 ? '' : 's'}` : '· your wallet signs'}</small>
            </Link>
          )}
        </aside>
      </main>
      <Footer />
    </>
  )
}
