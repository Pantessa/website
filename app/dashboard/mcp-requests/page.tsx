'use client'

// ─────────────────────────────────────────────────────────────────────────
//  MCP requests — the admission queue (reviewers). Every user-requested
//  directory row lands here `pending`: private to the requester, callable by
//  nobody, until a trusted reviewer wallet (MCP_REVIEWER_WALLETS ∪ admins)
//  approves it. Approve = live everywhere at once; reject = the requester
//  sees why and their pending slot frees. Rulebook: lib/mcp-review.ts;
//  API: /api/admin/mcp-requests. Born of SECURITY-AUDIT-2026-09-08 §A.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { Inbox, RefreshCw, Check, X, ExternalLink } from 'lucide-react'
import { useSession } from '@/lib/session'

interface Row {
  id: string
  slug: string
  name: string
  description: string
  endpoint: string | null
  websiteUrl: string | null
  logoUrl: string | null
  ownerAddress: string | null
  reviewStatus: string
  requestNote: string | null
  reviewNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  requestedAt: string | null
  createdAt: string
  tools: string[]
}

interface Feed {
  reviewer: string
  pending: Row[]
  decided: Row[]
}

const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

export default function McpRequestsPage() {
  const { status } = useSession()
  const [feed, setFeed] = useState<Feed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/mcp-requests', { cache: 'no-store' })
      if (res.status === 401) {
        setError('Sign in with a reviewer wallet to see the queue.')
        setFeed(null)
        return
      }
      if (res.status === 403) {
        setError('This wallet is not an MCP reviewer. Reviewers are MCP_REVIEWER_WALLETS plus the admin allowlist.')
        setFeed(null)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setFeed((await res.json()) as Feed)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authed') void load()
  }, [status, load])

  const decide = async (row: Row, decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !window.confirm(`Reject "${row.name}"? The requester will see your note.`)) return
    setBusy(row.id)
    try {
      const res = await fetch('/api/admin/mcp-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, decision, note: notes[row.id] ?? '' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  const Card = ({ row, actions }: { row: Row; actions: boolean }) => (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4 space-y-2" data-testid="mcp-request-row">
      <div className="flex items-start gap-3">
        {row.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <span className="w-8 h-8 rounded-lg bg-[var(--surf-2)] flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[color:var(--fg)]">{row.name}</span>
            <span className="mono text-[10px] uppercase px-1.5 py-0.5 rounded border border-[var(--line)] text-[color:var(--muted)]">
              {row.reviewStatus}
            </span>
          </div>
          <p className="text-[12px] text-[color:var(--muted)] leading-relaxed">{row.description}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="mono text-[color:var(--muted-2)]">MCP base</dt>
        <dd className="break-all">
          {row.endpoint ? (
            <a href={row.endpoint} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[color:var(--fg)] hover:underline">
              {row.endpoint} <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-[color:var(--muted)]">none (listing only — no tools discovered)</span>
          )}
        </dd>
        <dt className="mono text-[color:var(--muted-2)]">Tools</dt>
        <dd className="text-[color:var(--muted)]">{row.tools.length ? row.tools.join(', ') : '—'}</dd>
        <dt className="mono text-[color:var(--muted-2)]">Requested by</dt>
        <dd className="mono text-[color:var(--muted)]" title={row.ownerAddress ?? ''}>
          {short(row.ownerAddress)} · {when(row.requestedAt ?? row.createdAt)}
        </dd>
        {row.requestNote && (
          <>
            <dt className="mono text-[color:var(--muted-2)]">Their note</dt>
            <dd className="text-[color:var(--fg)] whitespace-pre-wrap">{row.requestNote}</dd>
          </>
        )}
        {!actions && (
          <>
            <dt className="mono text-[color:var(--muted-2)]">Decided</dt>
            <dd className="text-[color:var(--muted)]">
              {short(row.reviewedBy)} · {when(row.reviewedAt)}
              {row.reviewNote ? ` — ${row.reviewNote}` : ''}
            </dd>
          </>
        )}
      </dl>
      {actions && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <input
            type="text"
            value={notes[row.id] ?? ''}
            maxLength={500}
            placeholder="note to the requester (optional)"
            onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
            className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--line)] text-[12px] text-[color:var(--fg)] placeholder-[color:var(--muted-2)] focus:outline-none focus:border-[var(--line-2)]"
          />
          <button
            type="button"
            disabled={busy === row.id}
            onClick={() => void decide(row, 'approve')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-[color:var(--accent)] text-black hover:opacity-90 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" strokeWidth={3} /> Approve
          </button>
          <button
            type="button"
            disabled={busy === row.id}
            onClick={() => void decide(row, 'reject')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-[var(--line-2)] text-[color:var(--fg)] hover:bg-[var(--surf-2)] disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" strokeWidth={3} /> Reject
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 grid place-items-center rounded-lg bg-[var(--surf-1)] border border-[var(--line)] text-[color:var(--accent)]">
          <Inbox className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-[color:var(--fg)]">MCP requests</h1>
          <p className="text-[12px] text-[color:var(--muted)]">
            User-requested MCPs wait here. Nothing routes until you approve it; approving makes it live for everyone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] border border-[var(--line)] text-[color:var(--muted)] hover:text-[color:var(--fg)] disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {status !== 'authed' && <p className="text-[12px] text-[color:var(--muted)]">Sign in with a reviewer wallet to see the queue.</p>}
      {error && <p className="text-[12px] text-[color:var(--fail)]">{error}</p>}

      {feed && (
        <>
          <section className="space-y-3">
            <h2 className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Pending · {feed.pending.length}
            </h2>
            {feed.pending.length === 0 ? (
              <p className="text-[12px] text-[color:var(--muted)]">Queue is empty.</p>
            ) : (
              feed.pending.map((r) => <Card key={r.id} row={r} actions />)
            )}
          </section>
          <section className="space-y-3">
            <h2 className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Recent decisions · {feed.decided.length}
            </h2>
            {feed.decided.length === 0 ? (
              <p className="text-[12px] text-[color:var(--muted)]">None yet.</p>
            ) : (
              feed.decided.map((r) => <Card key={r.id} row={r} actions={false} />)
            )}
          </section>
        </>
      )}
    </div>
  )
}
