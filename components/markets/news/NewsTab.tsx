'use client'

// News for the symbol — the headline list off /api/news (source · age ·
// title · one-line summary), click-through in a new tab, and "show on
// chart": a toggle per headline that publishes a marker to lib/chart-markers
// for CHART's `MarketChart` to draw on the matching bar. Below the feed,
// links the community PINNED to this symbol (kind 'link' posts) and, signed
// in, a one-field pin form (https only; the server scrapes the title through
// the SSRF fence — nothing is fetched from the browser).
//
// Every string here renders as a text node: titles and summaries were
// HTML-stripped server-side and are never re-interpreted as markup.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Pin, PinOff, ExternalLink, RefreshCw } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import type { ChartPair } from '@/lib/charts'
import { ageLabel, NEWS_FEED_LABELS, type NewsItem, type NewsResponse } from '@/lib/news-shared'
import { isMarked, toggleChartMarker, useChartMarkers } from '@/lib/chart-markers'
import type { PublicPost } from '@/lib/chart-posts'
import '../comm.css'

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export default function NewsTab({ symbol, pair }: { symbol: string; pair: ChartPair }) {
  const sym = pair.symbol || symbol
  const [news, setNews] = useState<NewsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const markers = useChartMarkers(sym)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/news?symbol=${encodeURIComponent(sym)}&limit=30`, { cache: 'no-store' })
      const d = (await r.json()) as NewsResponse & { error?: string }
      if (!r.ok) throw new Error(d.error ?? `news ${r.status}`)
      setNews(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'News is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }, [sym])

  useEffect(() => {
    void load()
  }, [load])

  const feedLabel = news && news.feed !== 'none' ? NEWS_FEED_LABELS[news.feed] : null

  return (
    <div className="flex flex-col gap-4">
      <div className="mkc__head">
        <span className="mkc__eyebrow">
          {feedLabel ? `${sym} headlines · via ${feedLabel}` : `${sym} headlines`}
          {news?.asOf ? ` · as of ${ageLabel(news.asOf)}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {markers.length > 0 && (
            <span className="mkc__eyebrow" aria-live="polite">
              {markers.length} on the chart
            </span>
          )}
          <button type="button" className="mkc__ghost" onClick={() => void load()} disabled={loading} aria-label="Refresh headlines">
            <RefreshCw className="inline h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {err && <p className="mkc__err">{err}</p>}
      {!err && news && news.items.length === 0 && (
        <div className="mkc__empty">No headlines for {sym} in the last two weeks from any feed we read. The tape still trades — try the community tab.</div>
      )}
      {news && news.items.length > 0 && (
        <ul className="mkn__list" aria-label={`${sym} headlines`}>
          {news.items.map((it) => (
            <NewsRow key={it.id} item={it} symbol={sym} on={isMarked(sym, it.id) && markers.some((m) => m.id === it.id)} />
          ))}
        </ul>
      )}

      <PinnedLinks symbol={sym} />
    </div>
  )
}

function NewsRow({ item, symbol, on }: { item: NewsItem; symbol: string; on: boolean }) {
  return (
    <li className={on ? 'mkn__row is-on' : 'mkn__row'}>
      <div className="min-w-0">
        <div className="mkn__meta">
          <span className="mkn__src">{item.source}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(item.publishedAt * 1000).toISOString()}>{ageLabel(item.publishedAt)}</time>
        </div>
        <a className="mkn__title" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
          {item.title} <ExternalLink className="inline h-3 w-3 opacity-60" aria-hidden />
        </a>
        {item.summary && <p className="mkn__sum">{item.summary}</p>}
      </div>
      <button
        type="button"
        className={on ? 'mkn__pin is-on' : 'mkn__pin'}
        aria-pressed={on}
        onClick={() => toggleChartMarker(symbol, { id: item.id, t: item.publishedAt, label: `${item.source}: ${item.title}`, url: item.url })}
        title={on ? 'Remove from the chart' : 'Pin this headline to the bar it broke on'}
      >
        {on ? <PinOff className="h-3 w-3" aria-hidden /> : <Pin className="h-3 w-3" aria-hidden />}
        {on ? 'On chart' : 'Show on chart'}
      </button>
    </li>
  )
}

/** Links the community pinned to this symbol — kind 'link' posts. */
function PinnedLinks({ symbol }: { symbol: string }) {
  const session = useSession()
  const pathname = usePathname()
  const search = useSearchParams()
  const [posts, setPosts] = useState<PublicPost[]>([])
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const here = useMemo(() => `${pathname}${search?.toString() ? `?${search.toString()}` : ''}`, [pathname, search])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/posts?symbol=${encodeURIComponent(symbol)}&kind=link&limit=20`, { cache: 'no-store' })
      const d = (await r.json()) as { posts?: PublicPost[] }
      setPosts(d.posts ?? [])
    } catch {
      /* the list is optional */
    }
  }, [symbol])

  useEffect(() => {
    void load()
  }, [load])

  const pin = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol, kind: 'link', linkUrl: url.trim(), title: title.trim() }),
      })
      const d = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(d.error ?? `pin ${r.status}`)
      setUrl('')
      setTitle('')
      setMsg('Pinned.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not pin that link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Community-pinned links">
      <div className="mkc__head">
        <span className="mkc__eyebrow">Pinned by the community</span>
      </div>
      {posts.length === 0 && <p className="mkc__note">Nothing pinned to {symbol} yet. Paste an https link below — the page&rsquo;s own title rides along.</p>}
      {posts.length > 0 && (
        <ul className="mkn__list">
          {posts.map((p) => (
            <li key={p.id} className="mkn__row">
              <div className="min-w-0">
                <div className="mkn__meta">
                  <span className="mkn__src">{p.linkUrl ? hostOf(p.linkUrl) : 'link'}</span>
                  <span aria-hidden>·</span>
                  <span className="mkp__author">pinned by {p.authorLabel}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={new Date(p.createdAt * 1000).toISOString()}>{ageLabel(p.createdAt)}</time>
                </div>
                {p.linkUrl && (
                  <a className="mkn__title" href={p.linkUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
                    {p.title} <ExternalLink className="inline h-3 w-3 opacity-60" aria-hidden />
                  </a>
                )}
                {p.body && <p className="mkn__sum">{p.body}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {session.address ? (
        <form
          className="mkn__pinform"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && url.trim()) void pin()
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (public https page)" inputMode="url" aria-label="Link to pin" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional — read from the page)" maxLength={120} aria-label="Pinned link title" style={{ flexBasis: 200 }} />
          <button type="submit" className="mkc__cta" disabled={busy || !url.trim()}>
            {busy ? 'Pinning…' : 'Pin link'}
          </button>
          {msg && <span className={msg === 'Pinned.' ? 'mkc__note' : 'mkc__err'}>{msg}</span>}
        </form>
      ) : (
        <div className="mkp__door">
          <span>Pin a link to {symbol} — one free signature, no account form.</span>
          {/* Rule 6: the unified sign-in door, redirect back to this tab. */}
          <CreateAccountButton className="mkc__cta" label="Sign in to pin" redirectTo={here} />
        </div>
      )}
    </section>
  )
}
