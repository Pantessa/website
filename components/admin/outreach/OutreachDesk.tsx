'use client'

// The outreach desk (squad called-gtm, lane OUTREACH, 2026-11-16).
//
// Nate works from here: one row per scanned account on one market, the call it
// got right, the link to send, and three drafts he copies or opens in X's own
// composer. NOTHING ON THIS PAGE SENDS ANYTHING. The contact status lives in
// this browser's localStorage (said on the page), never on the server.
//
// Reads /api/admin/outreach (admin allowlist enforced server-side; a 401/403
// shows the same "Not authorized" panel as the other admin pages).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, ExternalLink, MessageCircle, Reply, Send } from 'lucide-react'
import { LIST_MIN_FOLLOWERS, fmtDay } from '@/lib/called-it/spec'
import type { BoardCall } from '@/lib/called-it/gtm'
import { OUTREACH_DESK_MAX, OUTREACH_STATUSES, OUTREACH_STATUS_KEY, type OutreachResponse, type OutreachRow, type OutreachStatus, type OutreachText } from '@/lib/called-it/outreach'
import './outreach.css'

const fmtFollowers = (n: number | null) => (n === null ? 'followers unknown' : `${n.toLocaleString('en-US')} followers`)
const statusKey = (r: OutreachRow) => `${r.entry.handle}|${r.entry.symbol}`

function readStatuses(): Record<string, OutreachStatus> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(OUTREACH_STATUS_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, OutreachStatus> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && (OUTREACH_STATUSES as readonly string[]).includes(v)) out[k] = v as OutreachStatus
    return out
  } catch {
    return {}
  }
}

function CopyButton({ text, label, main }: { text: string; label: string; main?: boolean }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1400)
    } catch {
      /* clipboard refused: the text is on the page to select */
    }
  }
  return (
    <button type="button" className={`xod-btn${main ? ' is-main' : ''}`} onClick={() => void copy()}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </button>
  )
}

function Who({ row }: { row: OutreachRow }) {
  const e = row.entry
  const [broken, setBroken] = useState(false)
  return (
    <div className="xod-who">
      {e.avatarUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span className="xod-who__ph" aria-hidden />
      )}
      <div style={{ minWidth: 0 }}>
        <div className="xod-who__name">
          <bdi>{e.name ?? `@${e.handle}`}</bdi>
        </div>
        <div className="xod-who__sub">
          <a href={`https://x.com/${encodeURIComponent(e.handle)}`} target="_blank" rel="noreferrer">
            @{e.handle}
          </a>{' '}
          · {fmtFollowers(e.followers)}
        </div>
        <span className={`xod-tag${e.verified ? ' is-on' : ''}`}>{e.verified ? 'Verified with X' : 'Not verified'}</span>{' '}
        <span className="xod-tag">{e.symbol}</span>
        <div className="xod-tally">
          <b>{e.headline}</b>
          {e.hitRate ? <> · {e.hitRate}</> : null}
          <br />
          Scanned {fmtDay(e.scannedAt)}
        </div>
      </div>
    </div>
  )
}

function Draft({ t }: { t: OutreachText }) {
  return (
    <div className="xod-text">
      <div className="xod-text__head">
        <span>{t.label}</span>
        <span className={t.weight > 280 ? 'is-over' : undefined}>{t.weight} / 280</span>
      </div>
      <p>{t.text}</p>
    </div>
  )
}

/** The strongest miss, the same size as the call it is sent about (review B2): read the miss where the send button is. */
function Miss({ worst }: { worst: BoardCall | null }) {
  if (!worst) return <p className="xod-miss is-none">Their strongest miss: none. The scan found no call that missed.</p>
  return (
    <div className="xod-call is-wrong" data-xod="worst">
      <div className="xod-call__head">
        <span className="xod-call__mark" aria-hidden />
        Their strongest miss: {worst.move}
      </div>
      <blockquote className="xod-call__quote">{worst.quote || worst.text}</blockquote>
      <div className="xod-call__meta">
        Posted {fmtDay(worst.postedAt)}
        {worst.url ? (
          <>
            {' '}
            ·{' '}
            <a href={worst.url} target="_blank" rel="noreferrer">
              the post on X
            </a>
          </>
        ) : null}
      </div>
    </div>
  )
}

function StatusPicker({ value, onPick }: { value: OutreachStatus; onPick: (s: OutreachStatus) => void }) {
  return (
    <div className="xod-status" role="group" aria-label="Contact status">
      {OUTREACH_STATUSES.map((s) => (
        <button key={s} type="button" aria-pressed={value === s} onClick={() => onPick(s)}>
          {s}
        </button>
      ))}
    </div>
  )
}

function HitRow({ row, status, onStatus }: { row: OutreachRow; status: OutreachStatus; onStatus: (s: OutreachStatus) => void }) {
  const kit = row.kit!
  const best = row.entry.best!
  return (
    <article className="xod-row" data-handle={row.entry.handle} data-symbol={row.entry.symbol}>
      <div>
        <Who row={row} />
        <StatusPicker value={status} onPick={onStatus} />
      </div>
      <div className="xod-call">
        <div className="xod-call__head">
          <span className="xod-call__mark" aria-hidden />
          {best.verdictWords}: {best.move}
        </div>
        <blockquote className="xod-call__quote">{best.quote || best.text}</blockquote>
        <div className="xod-call__meta">
          Posted {fmtDay(best.postedAt)}
          {best.likes !== null ? <> · {best.likes.toLocaleString('en-US')} likes</> : null}
          {best.url ? (
            <>
              {' '}
              ·{' '}
              <a href={best.url} target="_blank" rel="noreferrer">
                the post on X
              </a>
            </>
          ) : null}
          {' · '}
          <Link href={kit.path} target="_blank">
            open the page here
          </Link>
        </div>
        <Miss worst={row.entry.worst} />
        <div className="xod-link">
          <code title={kit.link}>{kit.link}</code>
          <CopyButton text={kit.link} label="Copy link" main />
        </div>
        <div className="xod-acts">
          <a className="xod-btn is-main" href={kit.replyIntent} target="_blank" rel="noreferrer">
            <Reply size={13} /> Reply on X
          </a>
          <a className="xod-btn" href={kit.postIntent} target="_blank" rel="noreferrer">
            <Send size={13} /> Post on X
          </a>
          <CopyButton text={kit.dm.text} label="Copy DM" />
          <a className="xod-btn" href={`https://x.com/${encodeURIComponent(row.entry.handle)}`} target="_blank" rel="noreferrer">
            <MessageCircle size={13} /> Their profile
          </a>
        </div>
        <Draft t={kit.reply} />
        <Draft t={kit.dm} />
        <Draft t={kit.post} />
      </div>
      <div className="xod-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={kit.imagePath} alt={`The card for @${row.entry.handle}'s ${row.entry.symbol} call`} loading="lazy" />
        <div className="xod-img__cap">
          The card X draws for the link. <a href={kit.imageUrl} target="_blank" rel="noreferrer">Image address <ExternalLink size={10} /></a>
        </div>
      </div>
    </article>
  )
}

function NoHitRow({ row, status, onStatus }: { row: OutreachRow; status: OutreachStatus; onStatus: (s: OutreachStatus) => void }) {
  return (
    <article className="xod-nohit" data-handle={row.entry.handle} data-symbol={row.entry.symbol}>
      <div>
        <Who row={row} />
        <StatusPicker value={status} onPick={onStatus} />
      </div>
      <div>
        <p>{row.reason}</p>
        <Miss worst={row.entry.worst} />
      </div>
    </article>
  )
}

export default function OutreachDesk() {
  const [data, setData] = useState<OutreachResponse | null>(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, OutreachStatus>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/outreach', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) {
        setDenied(true)
        return
      }
      if (!res.ok) {
        setError(`The outreach API returned ${res.status}. Check the server logs.`)
        return
      }
      setData((await res.json()) as OutreachResponse)
    } catch {
      setError('The outreach API did not answer.')
    }
  }, [])

  useEffect(() => {
    void load()
    setStatuses(readStatuses())
  }, [load])

  const setStatus = (key: string, s: OutreachStatus) => {
    setStatuses((prev) => {
      const next = { ...prev, [key]: s }
      try {
        window.localStorage.setItem(OUTREACH_STATUS_KEY, JSON.stringify(next))
      } catch {
        /* private window: the status lasts until reload */
      }
      return next
    })
  }

  if (denied) {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold mb-2">Not authorized</h1>
        <p className="text-sm text-[color:var(--muted)]">This page is for the Pantessa team.</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold mb-2">Couldn&rsquo;t load the outreach desk</h1>
        <p className="text-sm text-[color:var(--muted)] mb-4">{error}</p>
        <button className="btn btn--solid" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }
  if (!data) return <div className="xod xod-empty" role="status">Reading the board…</div>

  const hits = data.rows.filter((r) => r.kit)
  const none = data.rows.filter((r) => !r.kit)
  const st = (r: OutreachRow) => statuses[statusKey(r)] ?? 'not contacted'
  const sent = data.rows.filter((r) => st(r) !== 'not contacted').length
  // Which server's records these are, and where the links point (review F5): a desk on a test server writes links to records prod may not hold.
  const here = typeof window !== 'undefined' ? window.location.origin : null
  const hostOf = (u: string) => {
    try {
      return new URL(u).host
    } catch {
      return u
    }
  }

  return (
    <div className="xod" data-outreach-desk>
      <Link href="/dashboard/admin" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted)] hover:underline mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Growth
      </Link>
      <h1>Outreach</h1>
      <p className="xod__lede">
        Every scanned account, the call it got right, and the one link to send. Nothing here sends anything: copy a draft or open X&rsquo;s composer and press
        send yourself. Each text carries the full record, hits and misses.
      </p>
      <div className="xod__head">
        <div className="xod__stat">
          <b>{data.counts.accounts}</b>
          <span>accounts scanned ({data.counts.records} records)</span>
        </div>
        <div className="xod__stat">
          <b>{data.counts.withHit}</b>
          <span>with a call to lead with</span>
        </div>
        <div className="xod__stat">
          <b>{data.counts.verified}</b>
          <span>verified with X</span>
        </div>
        <div className="xod__stat">
          <b>{sent}</b>
          <span>marked past &ldquo;not contacted&rdquo;</span>
        </div>
      </div>
      <p className="xod__origin" data-xod="origin">
        Links point at <b>{hostOf(data.origin)}</b>.
      </p>
      {here && here !== data.origin && (
        <p className="xod__warn" role="alert" data-xod="origin-warn">
          This desk reads {hostOf(here)}&rsquo;s database; the links point at {hostOf(data.origin)}.
        </p>
      )}
      <p className="xod__note">
        The board lists public records only (accounts with {LIST_MIN_FOLLOWERS.toLocaleString('en-US')} followers or more, or verified, never an internal run), at most {OUTREACH_DESK_MAX}. The status buttons are kept in this
        browser only, not on the server. Links carry utm_source=x&amp;utm_medium=outreach so an arrival shows in the journey log.
        {data.failed ? ' The list did not load completely: some records may be missing.' : ''}
      </p>

      <h2 className="xod__group">Lead with a call ({hits.length})</h2>
      {hits.length ? hits.map((r) => <HitRow key={statusKey(r)} row={r} status={st(r)} onStatus={(s) => setStatus(statusKey(r), s)} />) : <p className="xod-empty">No record has a hit yet.</p>}

      <h2 className="xod__group">No hit to lead with ({none.length})</h2>
      {none.length ? none.map((r) => <NoHitRow key={statusKey(r)} row={r} status={st(r)} onStatus={(s) => setStatus(statusKey(r), s)} />) : <p className="xod-empty">Every record has a hit.</p>}
    </div>
  )
}
