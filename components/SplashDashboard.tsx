'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Vote, Wallet } from 'lucide-react'
import type { McpServer } from '@/lib/store'
import type { HoldingsTile, ProposalsTile, SplashTile, SuggestedPrompt } from '@/lib/splash/types'

/**
 * The connected-wallet splash: when someone jumps into the chat with a wallet
 * and connected MCPs, we scan the address and paint a per-MCP dashboard
 * (Uniswap portfolio, Snapshot proposals, …) instead of an empty box. The
 * moment they start typing (`dismissed`), it fades and collapses into chat.
 *
 * Everything below the fold is data-driven off SplashTile.render — a new MCP
 * that returns one of these shapes gets a tile with no new code here.
 */
export function SplashDashboard({
  address,
  servers,
  onPick,
  dismissed,
  onResolve,
}: {
  address?: string
  servers: McpServer[]
  onPick: (prompt: string, slug?: string) => void
  dismissed: boolean
  /** Reports how many tiles resolved (0 → caller shows its normal empty state). */
  onResolve?: (count: number) => void
}) {
  const [tiles, setTiles] = useState<SplashTile[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Only sources that can contribute — avoids a fetch when nothing matches.
  const relevant = useMemo(
    () => servers.filter((s) => /uniswap|snapshot/i.test(`${s.slug} ${s.name}`)),
    [servers],
  )
  // A stable string key so the scan re-runs only when the wallet or the set of
  // dashboard-capable MCPs actually changes — not on every render (relevant is
  // a fresh array each time). Depending on the string (not the array) also
  // keeps React 18 StrictMode's mount→cleanup→mount from aborting the only
  // in-flight fetch and leaving the skeleton up forever.
  const key = `${address ?? ''}|${relevant.map((s) => s.id).sort().join(',')}`

  useEffect(() => {
    if (!address || relevant.length === 0) {
      setTiles(null)
      return
    }
    let alive = true
    setLoading(true)
    setTiles(null)
    fetch('/api/splash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, servers: relevant }),
    })
      .then((r) => r.json())
      .then((data: { tiles?: SplashTile[] }) => {
        if (!alive) return
        const next = Array.isArray(data.tiles) ? data.tiles : []
        setTiles(next)
        onResolve?.(next.length)
      })
      .catch(() => {
        if (!alive) return
        setTiles([])
        onResolve?.(0)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Nothing to show — let the caller render its normal empty state.
  if (!address || relevant.length === 0) return null
  if (!loading && tiles && tiles.length === 0) return null

  return (
    <div
      aria-hidden={dismissed}
      className="w-full transition-all duration-500 ease-out"
      style={{
        maxHeight: dismissed ? 0 : 2400,
        opacity: dismissed ? 0 : 1,
        transform: dismissed ? 'translateY(-8px) scale(0.98)' : 'none',
        pointerEvents: dismissed ? 'none' : 'auto',
        overflow: 'hidden',
      }}
    >
      <div className="mx-auto w-full max-w-3xl px-1 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-[color:var(--muted-2)]" />
          <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
            Connected · {shortAddr(address)}
          </span>
        </div>

        {loading || !tiles ? (
          <SkeletonTiles count={relevant.length} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {tiles.map((tile) => (
              <TileCard key={tile.id} tile={tile} onPick={onPick} />
            ))}
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-[color:var(--muted-2)]">
          Start typing to ask about any of this.
        </p>
      </div>
    </div>
  )
}

// ── Tile router ──────────────────────────────────────────────────────────────

function TileCard({ tile, onPick }: { tile: SplashTile; onPick: (p: string, slug?: string) => void }) {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 text-left">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{tile.title}</h3>
        {tile.subtitle && <span className="mono text-[10px] text-[color:var(--muted-2)]">{tile.subtitle}</span>}
      </div>
      {tile.render === 'holdings' && <HoldingsBody tile={tile} />}
      {tile.render === 'proposals' && <ProposalsBody tile={tile} />}
      {tile.render === 'empty' && <p className="text-xs text-[color:var(--muted)]">{tile.message}</p>}
      <PromptChips prompts={tile.prompts} slug={tile.mcpSlug} onPick={onPick} />
    </div>
  )
}

// ── Holdings (portfolio) ─────────────────────────────────────────────────────

function HoldingsBody({ tile }: { tile: HoldingsTile }) {
  return (
    <div className="flex-1">
      {tile.totalUsd !== null && (
        <div className="mb-3">
          <span className="text-2xl font-semibold tracking-tight text-white">{usd(tile.totalUsd)}</span>
          <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">total on {tile.chain}</span>
        </div>
      )}
      <div className="space-y-1.5">
        {tile.holdings.map((h) => (
          <div key={h.address + h.symbol} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white/5 text-[10px] font-semibold text-[color:var(--muted)]">
                {h.symbol.slice(0, 3)}
              </span>
              <span className="font-medium text-white">{h.symbol}</span>
              {h.native && <span className="mono text-[9px] text-[color:var(--muted-2)]">native</span>}
            </div>
            <div className="text-right">
              <div className="text-white">{h.valueUsd !== null ? usd(h.valueUsd) : '—'}</div>
              <div className="text-[10px] text-[color:var(--muted-2)]">{trimNum(h.balance)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Proposals (governance) ───────────────────────────────────────────────────

function ProposalsBody({ tile }: { tile: ProposalsTile }) {
  return (
    <div className="flex-1">
      {tile.spaces.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {tile.spaces.slice(0, 8).map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full bg-white/5 py-0.5 pl-0.5 pr-2">
              <Avatar url={s.avatarUrl} label={s.name} size={16} />
              <span className="text-[10px] text-[color:var(--muted)]">{s.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {tile.proposals.slice(0, 4).map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            <Avatar url={p.avatarUrl} label={p.spaceName} size={22} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white" title={p.title}>
                {p.title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[color:var(--muted-2)]">
                <span className="flex items-center gap-1">
                  <Vote className="h-3 w-3" /> {p.spaceName}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {endsIn(p.endsAt)}
                </span>
                {p.leadingChoice && <span className="text-[color:var(--accent)]">{p.leadingChoice} leading</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function PromptChips({
  prompts,
  slug,
  onPick,
}: {
  prompts: SuggestedPrompt[]
  slug: string
  onPick: (p: string, slug?: string) => void
}) {
  if (prompts.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
      {prompts.map((p) => (
        <button
          key={p.label}
          type="button"
          title={p.prompt}
          onClick={() => onPick(p.prompt, slug)}
          className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

function Avatar({ url, label, size }: { url: string; label: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-semibold text-[color:var(--muted)]"
        style={{ height: size, width: size }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={label}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ height: size, width: size }}
    />
  )
}

function SkeletonTiles({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {Array.from({ length: Math.max(1, Math.min(count, 2)) }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
          <div className="mb-3 h-3 w-24 animate-pulse rounded bg-white/10" />
          <div className="mb-4 h-7 w-32 animate-pulse rounded bg-white/10" />
          <div className="space-y-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-4 w-full animate-pulse rounded bg-white/5" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── formatters ───────────────────────────────────────────────────────────────

function usd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`
}

function trimNum(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

function endsIn(unixSec: number): string {
  const ms = unixSec * 1000 - Date.now()
  if (ms <= 0) return 'ended'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m left`
  if (h < 48) return `${h}h left`
  return `${Math.floor(h / 24)}d left`
}
