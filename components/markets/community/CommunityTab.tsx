'use client'

// Community — the symbol page's forum. A feed of posts (newest / most
// executed), each an annotated chart with the actions its lines carry:
//   · action chips — the ask string of every line action. In the app (an
//     `onAsk` from a chat surface) a chip SENDS (the chip-send contract); on
//     the standalone /t page it PREFILLS /chat?prompt= (a URL never fires a
//     turn — the page's own trade buttons already do exactly this)
//   · "Execute this idea" — the /i door for the intent link the AUTHOR
//     minted from the post's primary action; the kickback follows them
//   · "executed by N wallets" — receipt-counted signed events on that link
//   · "Copy these lines to my chart" — a fork: a new post with fork_of, and
//     `onLoadChart` hands the lines to the page's chart when one is wired
//   · comments (plain text), a composer behind the unified sign-in door
//     (rule 6), and "attach my current chart" which takes the page's
//     ChartState (SHELL/CHART pass it; null hides the checkbox)
// Every author is a wallet or a claimed @handle; every string is a text node.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ExternalLink, GitFork, MessageSquare, Link2 } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import type { ChartPair } from '@/lib/charts'
import type { ChartState } from '@/lib/chart-state'
import type { PublicComment, PublicPost, PostSort } from '@/lib/chart-posts'
import { ageLabel } from '@/lib/news-shared'
import ChartSketch from './ChartSketch'
import '../comm.css'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export interface CommunityTabProps {
  symbol: string
  pair: ChartPair
  /** The page's live chart annotations — "attach my current chart". */
  chartState?: ChartState | null
  /** In-app: send an ask (chip-send). Absent on the standalone page → prefill links. */
  onAsk?: (ask: string) => void
  /** CHART hook: load a post's lines onto the page chart (fork / "view on chart"). */
  onLoadChart?: (state: ChartState) => void
}

export default function CommunityTab({ symbol, pair, chartState = null, onAsk, onLoadChart }: CommunityTabProps) {
  const sym = pair.symbol || symbol
  const session = useSession()
  const pathname = usePathname()
  const search = useSearchParams()
  const here = useMemo(() => `${pathname}${search?.toString() ? `?${search.toString()}` : ''}`, [pathname, search])
  const [sort, setSort] = useState<PostSort>('new')
  const [posts, setPosts] = useState<PublicPost[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch(`/api/posts?symbol=${encodeURIComponent(sym)}&sort=${sort}&limit=30`, { cache: 'no-store' })
      const d = (await r.json()) as { posts?: PublicPost[]; error?: string }
      if (!r.ok) throw new Error(d.error ?? `posts ${r.status}`)
      setPosts(d.posts ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The board is unavailable right now.')
    }
  }, [sym, sort])

  useEffect(() => {
    void load()
  }, [load])

  const ideas = posts?.filter((p) => p.kind === 'idea') ?? []

  return (
    <div className="flex flex-col gap-4">
      {session.address ? (
        <Composer symbol={sym} chartState={chartState} onPosted={load} />
      ) : (
        <div className="mkp__door">
          <span>Post an idea on {sym} — lines, levels, and the trade they carry. One free signature, no account form.</span>
          {/* Rule 6: the unified door, redirect back to this tab. */}
          <CreateAccountButton className="mkc__cta" label="Sign in to post" redirectTo={here} />
        </div>
      )}

      <div className="mkc__head">
        <span className="mkc__eyebrow">
          {ideas.length} idea{ideas.length === 1 ? '' : 's'} on {sym}
        </span>
        <div className="mkp__sort" role="tablist" aria-label="Sort posts">
          <button type="button" role="tab" aria-selected={sort === 'new'} className={sort === 'new' ? 'mkp__sortbtn is-active' : 'mkp__sortbtn'} onClick={() => setSort('new')}>
            Newest
          </button>
          <button type="button" role="tab" aria-selected={sort === 'executed'} className={sort === 'executed' ? 'mkp__sortbtn is-active' : 'mkp__sortbtn'} onClick={() => setSort('executed')}>
            Most executed
          </button>
        </div>
      </div>

      {err && <p className="mkc__err">{err}</p>}
      {posts && ideas.length === 0 && !err && (
        <div className="mkc__empty">
          No ideas on {sym} yet. The first post here is a chart with a line on it — and a line can carry the trade.
        </div>
      )}
      <div className="mkp__feed">
        {ideas.map((p) => (
          <PostCard key={p.id} post={p} sessionAddress={session.address} here={here} onAsk={onAsk} onLoadChart={onLoadChart} onChanged={load} />
        ))}
      </div>
    </div>
  )
}

// ── composer ────────────────────────────────────────────────────────────────

function Composer({ symbol, chartState, onPosted }: { symbol: string; chartState: ChartState | null; onPosted: () => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const attachable = !!chartState && chartState.symbol === symbol && chartState.lines.length > 0
  const [attach, setAttach] = useState(true)
  const [mint, setMint] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const hasAction = attachable && chartState!.lines.some((l) => (l.kind === 'h' || l.kind === 'zone') && l.action)

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          symbol,
          kind: 'idea',
          title: title.trim(),
          body,
          ...(attachable && attach ? { chartState, mint: mint && hasAction } : {}),
        }),
      })
      const d = (await r.json()) as { error?: string; mintError?: string; link?: { url: string } }
      if (!r.ok) throw new Error(d.error ?? `post ${r.status}`)
      setTitle('')
      setBody('')
      setMsg(d.link ? `Posted — and minted as ${d.link.url}.` : d.mintError ? `Posted. Link not minted: ${d.mintError}` : 'Posted.')
      await onPosted()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not post.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="mkp__composer"
      aria-label={`Post an idea on ${symbol}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && title.trim().length >= 3) void submit()
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Your call on ${symbol} — one line`} maxLength={120} aria-label="Title" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Why. Plain text, up to 2,000 characters." maxLength={2000} aria-label="Body" />
      <div className="mkp__crow">
        <div className="flex flex-wrap items-center gap-4">
          {attachable ? (
            <label className="mkp__check">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              Attach my current chart ({chartState!.lines.length} line{chartState!.lines.length === 1 ? '' : 's'})
            </label>
          ) : (
            <span className="mkc__note">Draw a line on the chart to attach it — a line can carry the trade.</span>
          )}
          {attachable && attach && hasAction && (
            <label className="mkp__check">
              <input type="checkbox" checked={mint} onChange={(e) => setMint(e.target.checked)} />
              Mint the first action as a link (readers execute it; you earn the creator share)
            </label>
          )}
        </div>
        <button type="submit" className="mkc__cta" disabled={busy || title.trim().length < 3}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
      {msg && <span className={/^Posted/.test(msg) ? 'mkc__note' : 'mkc__err'}>{msg}</span>}
    </form>
  )
}

// ── post card ───────────────────────────────────────────────────────────────

function PostCard({
  post,
  sessionAddress,
  here,
  onAsk,
  onLoadChart,
  onChanged,
}: {
  post: PublicPost
  sessionAddress: string | null
  here: string
  onAsk?: (ask: string) => void
  onLoadChart?: (state: ChartState) => void
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<PublicComment[] | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState<'comment' | 'fork' | 'mint' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const mine = !!sessionAddress && sessionAddress.toLowerCase() === post.author

  const loadComments = useCallback(async () => {
    const r = await fetch(`/api/posts/${post.id}`, { cache: 'no-store' })
    const d = (await r.json()) as { post?: PublicPost & { commentList: PublicComment[] } }
    setComments(d.post?.commentList ?? [])
  }, [post.id])

  const toggleComments = () => {
    const next = !open
    setOpen(next)
    if (next && comments === null) void loadComments()
  }

  const sendComment = async () => {
    setBusy('comment')
    setNote(null)
    try {
      const r = await fetch(`/api/posts/${post.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: reply }) })
      const d = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(d.error ?? `comment ${r.status}`)
      setReply('')
      await loadComments()
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not comment.')
    } finally {
      setBusy(null)
    }
  }

  const fork = async () => {
    if (!post.chartState) return
    setBusy('fork')
    setNote(null)
    try {
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: post.symbol, kind: 'idea', title: `Fork of ${post.title}`.slice(0, 120), body: '', forkOf: post.id }),
      })
      const d = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(d.error ?? `fork ${r.status}`)
      onLoadChart?.(post.chartState)
      setNote(onLoadChart ? 'Copied to your chart and posted as a fork.' : 'Posted as a fork — open the chart to edit the lines.')
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not fork.')
    } finally {
      setBusy(null)
    }
  }

  const mintLink = async () => {
    setBusy('mint')
    setNote(null)
    try {
      const r = await fetch(`/api/posts/${post.id}/mint`, { method: 'POST' })
      const d = (await r.json()) as { error?: string; url?: string }
      if (!r.ok) throw new Error(d.error ?? `mint ${r.status}`)
      setNote(`Minted ${d.url ?? ''} — readers can execute it now.`)
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not mint.')
    } finally {
      setBusy(null)
    }
  }

  const chip = (ask: string, i: number) =>
    onAsk ? (
      <button key={i} type="button" className="mkp__chip" onClick={() => onAsk(ask)} title="Sends this ask in chat — your wallet signs">
        {ask}
      </button>
    ) : (
      <Link key={i} href={promptHref(ask)} className="mkp__chip" title="Prefills chat — you send it">
        {ask}
      </Link>
    )

  return (
    <article id={`post-${post.id}`} className={post.chartState ? 'mkp__card' : 'mkp__card mkp__card--nochart'} aria-label={post.title}>
      <div className="min-w-0">
        <div className="mkp__meta">
          <span className="mkp__author">{post.authorLabel}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(post.createdAt * 1000).toISOString()}>{ageLabel(post.createdAt)}</time>
          {post.forkOf && (
            <>
              <span aria-hidden>·</span>
              <span className="mkp__kind">
                <GitFork className="inline h-2.5 w-2.5" aria-hidden /> fork
              </span>
            </>
          )}
          {post.linkSlug && (
            <>
              <span aria-hidden>·</span>
              <span className="mkp__kind">executable</span>
            </>
          )}
        </div>
        <h3 className="mkp__title">
          {post.kind === 'link' && post.linkUrl ? (
            <a href={post.linkUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
              {post.title} <ExternalLink className="inline h-3 w-3 opacity-60" aria-hidden />
              <span className="mkp__host">{hostOf(post.linkUrl)}</span>
            </a>
          ) : (
            post.title
          )}
        </h3>
        {post.body && <p className="mkp__body">{post.body}</p>}

        {(post.asks.length > 0 || post.linkSlug) && (
          <div className="mkp__chips">
            {post.linkSlug && (
              <Link href={`/i/${post.linkSlug}`} className="mkp__exec" title="Opens the guarded runtime — only your wallet signs">
                Execute this idea
                <small>{post.executedBy > 0 ? `· executed by ${post.executedBy} wallet${post.executedBy === 1 ? '' : 's'}` : '· not executed yet'}</small>
              </Link>
            )}
            {post.asks.map(chip)}
          </div>
        )}

        <div className="mkp__foot">
          <button type="button" onClick={toggleComments} aria-expanded={open}>
            <MessageSquare className="inline h-3 w-3" aria-hidden /> {post.comments} comment{post.comments === 1 ? '' : 's'}
          </button>
          {post.chartState && (
            <button type="button" onClick={() => void fork()} disabled={!!busy || !sessionAddress} title={sessionAddress ? 'Fork: a new post with these lines, credited to this one' : 'Sign in to fork'}>
              <GitFork className="inline h-3 w-3" aria-hidden /> {busy === 'fork' ? 'Forking…' : 'Copy these lines to my chart'}
            </button>
          )}
          {mine && !post.linkSlug && post.asks.length > 0 && (
            <button type="button" onClick={() => void mintLink()} disabled={!!busy} title="Mint the first action as an intent link">
              <Link2 className="inline h-3 w-3" aria-hidden /> {busy === 'mint' ? 'Minting…' : 'Mint as link'}
            </button>
          )}
          {post.forkOf && (
            <span className="mkp__lineage">
              forked from <a href={`#post-${post.forkOf}`}>{post.forkOf}</a>
            </span>
          )}
        </div>
        {note && <p className={/^(Copied|Posted|Minted)/.test(note) ? 'mkc__note' : 'mkc__err'}>{note}</p>}
      </div>

      {post.chartState && <ChartSketch state={post.chartState} />}

      {open && (
        <div className="mkp__comments">
          {comments === null && <span className="mkc__note">Loading…</span>}
          {comments && comments.length === 0 && <span className="mkc__note">No comments yet.</span>}
          {comments?.map((c) => (
            <p key={c.id} className="mkp__comment">
              <b>{c.authorLabel}</b>
              {c.body}
            </p>
          ))}
          {sessionAddress ? (
            <form
              className="mkp__creply"
              onSubmit={(e) => {
                e.preventDefault()
                if (reply.trim() && !busy) void sendComment()
              }}
            >
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply (plain text)" maxLength={1000} aria-label="Reply" />
              <button type="submit" className="mkc__ghost" disabled={!!busy || !reply.trim()}>
                {busy === 'comment' ? 'Sending…' : 'Reply'}
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <span className="mkc__note">Sign in to reply.</span>
              <CreateAccountButton className="mkc__ghost" label="Sign in" redirectTo={here} />
            </div>
          )}
        </div>
      )}
    </article>
  )
}
